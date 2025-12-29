import { v } from "convex/values";
import { internalAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { extractTextContent } from "../lib/extractTextContent";
import rag from "./ai/rag";
import { contentHashFromArrayBuffer, EntryId } from "@convex-dev/rag";
import { Id } from "../_generated/dataModel";

// Process a single uploaded file asynchronously
export const processFile = internalAction({
  args: {
    storageId: v.id("_storage"),
    filename: v.string(),
    displayName: v.string(),
    mimeType: v.string(),
    namespace: v.string(),
    category: v.union(v.string(), v.null()),
    knowledgeBaseId: v.union(v.string(), v.null()),
    sourceType: v.union(v.literal("uploaded"), v.literal("scraped")),
    orgId: v.string(),
    entryId: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`ORG_CONTEXT|${args.orgId}`);
    console.log(`[processFile] Starting async processing for "${args.displayName}"`);

    try {
      // Get the file blob from storage
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) {
        throw new Error("File not found in storage");
      }

      // Convert blob to ArrayBuffer
      const bytes = await blob.arrayBuffer();

      if (bytes.byteLength > 0) {
        await ctx.runMutation((internal as any).system.convexUsageEstimated.record, {
          organizationId: args.orgId,
          fileBytes: bytes.byteLength,
        });
      }

      // Extract text content
      const text = await extractTextContent(ctx, {
        storageId: args.storageId,
        filename: args.filename,
        bytes,
        mimeType: args.mimeType,
        organizationId: args.orgId,
      });

      console.log(`[processFile] Extracted ${text.length} characters from "${args.displayName}"`);

      // Chunk the text
      const chunks = chunkText(text, 2000, 400);
      console.log(`[processFile] Split into ${chunks.length} chunks`);

      // Add all chunks to RAG FIRST (must be done in action context, not mutation)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (!chunk) continue;

        const chunkKey =
          chunks.length > 1
            ? `${args.displayName} (part ${i + 1}/${chunks.length})`
            : args.displayName;

        const chunkBytes = new TextEncoder().encode(chunk);
        const chunkHash = await contentHashFromArrayBuffer(chunkBytes.buffer);

        // Estimated vector write: one embedding vector per chunk.
        // text-embedding-3-small dimension is 1536 floats => 1536 * 4 bytes.
        await ctx.runMutation((internal as any).system.convexUsageEstimated.record, {
          organizationId: args.orgId,
          vectorBytes: 1536 * 4,
        });

        const estimatedEmbeddingTokens = Math.ceil(chunk.length / 4);
        if (estimatedEmbeddingTokens > 0) {
          await ctx.runMutation((internal as any).system.tokenUsage.record, {
            organizationId: args.orgId,
            provider: "openai",
            model: "text-embedding-3-small",
            kind: "rag_add_embedding",
            totalTokens: estimatedEmbeddingTokens,
          });
        }

        // Call rag.add directly from action context (not mutation)
        await rag.add(ctx, {
          namespace: args.namespace,
          text: chunk,
          key: chunkKey,
          title: args.displayName,
          filterValues: [{ name: "storageId", value: args.storageId }],
          metadata: {
            storageId: args.storageId,
            uploadedBy: args.orgId,
            displayName: args.displayName,
            originalFilename: args.filename,
            category: args.category,
            knowledgeBaseId: args.knowledgeBaseId,
            sourceType: args.sourceType,
            chunkIndex: i,
            totalChunks: chunks.length,
            processingStatus: "ready",
          },
          contentHash: chunkHash,
        });

        console.log(`[processFile] Added chunk ${i + 1}/${chunks.length}`);
      }

      // Update the placeholder entry to "ready" status instead of deleting it
      // This ensures the file stays visible in the list
      await ctx.runMutation(internal.system.fileProcessor.updatePlaceholderStatus, {
        entryId: args.entryId,
        status: "ready",
      });

      console.log(`[processFile] Successfully processed "${args.displayName}"`);

      // Delete the old 'file added' notification for this file (using fileName since entryId changes)
      try {
        const oldNotifications = await ctx.runQuery(internal.private.notifications.listByFileName, {
          organizationId: args.orgId,
          fileName: args.displayName,
        });
        
        for (const notif of oldNotifications) {
          await ctx.runMutation(internal.private.notifications.deleteById, {
            notificationId: notif._id,
          });
        }
        console.log(`[processFile] Deleted ${oldNotifications.length} old notifications for "${args.displayName}"`);
      } catch (error) {
        console.error(`[processFile] Failed to delete old notifications:`, error);
      }

      // Create success notification (use first chunk's entryId for reference)
      const firstChunkId = chunks.length > 0 ? `${args.displayName} (part 1/${chunks.length})` : args.displayName;
      console.log(`[processFile] Creating success notification for "${args.displayName}"`);
      try {
        await ctx.runMutation(internal.private.notifications.create, {
          organizationId: args.orgId,
          type: "file_ready",
          title: "✓ File ready",
          message: `"${args.displayName}" is ready to use`,
          fileId: args.entryId, // Keep using old ID for reference
          fileName: args.displayName,
        });
        console.log(`[processFile] Success notification created`);
      } catch (notifError) {
        console.error(`[processFile] Failed to create success notification:`, notifError);
      }

      // Track file change for reactive queries
      try {
        await ctx.runMutation(internal.system.fileProcessor.trackFileChange, {
          organizationId: args.orgId,
          knowledgeBaseId: args.knowledgeBaseId ?? undefined,
        });
      } catch (error) {
        console.error(`[processFile] Failed to track file change:`, error);
      }
    } catch (error) {
      console.error(`[processFile] Error processing "${args.displayName}":`, error);

      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      let errorEntryId = args.entryId;
      try {
        errorEntryId = await ctx.runMutation(internal.system.fileProcessor.markAsError, {
          entryId: args.entryId,
          namespace: args.namespace,
          storageId: args.storageId,
          uploadedBy: args.orgId,
          displayName: args.displayName,
          originalFilename: args.filename,
          category: args.category,
          knowledgeBaseId: args.knowledgeBaseId,
          sourceType: args.sourceType,
          error: errorMessage,
        });
      } catch (markError) {
        console.error(`[processFile] Failed to mark entry as error:`, markError);
      }

      try {
        const oldNotifications = await ctx.runQuery(internal.private.notifications.listByFileName, {
          organizationId: args.orgId,
          fileName: args.displayName,
        });

        for (const notif of oldNotifications) {
          await ctx.runMutation(internal.private.notifications.deleteById, {
            notificationId: notif._id,
          });
        }
      } catch (notifCleanupErr) {
        console.error(`[processFile] Failed to delete old notifications:`, notifCleanupErr);
      }

      // Create failure notification
      await ctx.runMutation(internal.private.notifications.create, {
        organizationId: args.orgId,
        type: "file_failed",
        title: "File processing failed",
        message: `Failed to process "${args.displayName}": ${errorMessage}`,
        fileId: errorEntryId,
        fileName: args.displayName,
      });

      try {
        await ctx.runMutation(internal.system.fileProcessor.trackFileChange, {
          organizationId: args.orgId,
          knowledgeBaseId: args.knowledgeBaseId ?? undefined,
        });
      } catch (trackErr) {
        console.error(`[processFile] Failed to track file change after failure:`, trackErr);
      }
    }
  },
});

export const finalizeFileProcessingNotification = internalAction({
  args: {
    orgId: v.string(),
    entryId: v.string(),
    displayName: v.string(),
    storageId: v.id("_storage"),
    namespace: v.string(),
    knowledgeBaseId: v.union(v.string(), v.null()),
    cursor: v.optional(v.string()),
    pass: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pass = typeof args.pass === "number" ? args.pass : 0;

    let existingNotifs: any[] = [];
    try {
      existingNotifs = await ctx.runQuery(internal.private.notifications.listByFileName, {
        organizationId: args.orgId,
        fileName: args.displayName,
      });
    } catch (error) {
      console.error(`[finalizeFileProcessingNotification] Failed to load notifications:`, error);
    }

    if (existingNotifs.some((n) => n.type === "file_ready" || n.type === "file_failed")) {
      return;
    }

    const namespace = await rag.getNamespace(ctx, { namespace: args.namespace });
    if (!namespace) {
      return;
    }

    let foundReady = false;
    let foundError = false;
    let foundErrorMessage: string | null = null;

    let cursor: string | null = args.cursor ?? null;
    const BATCH_SIZE = 200;
    const MAX_BATCHES_PER_RUN = 10;
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const res = await rag.list(ctx, {
        namespaceId: namespace.namespaceId,
        paginationOpts: { numItems: BATCH_SIZE, cursor },
      });

      for (const entry of res.page) {
        const m = entry.metadata as any;
        if (m?.storageId !== args.storageId) continue;

        const status = m?.processingStatus;
        if (status === "error") {
          foundError = true;
          foundErrorMessage = typeof m?.error === "string" ? m.error : null;
          break;
        }

        if (status === "ready") {
          foundReady = true;
        }
      }

      if (foundError) break;

      if (res.isDone || !res.continueCursor) {
        cursor = null;
        break;
      }
      cursor = res.continueCursor;
    }

    if (foundError || foundReady) {
      try {
        for (const notif of existingNotifs) {
          await ctx.runMutation(internal.private.notifications.deleteById, {
            notificationId: notif._id,
          });
        }
      } catch (error) {
        console.error(`[finalizeFileProcessingNotification] Failed to delete old notifications:`, error);
      }

      if (foundError) {
        await ctx.runMutation(internal.private.notifications.create, {
          organizationId: args.orgId,
          type: "file_failed",
          title: "File processing failed",
          message: `Failed to process "${args.displayName}": ${foundErrorMessage ?? "Unknown error"}`,
          fileId: args.entryId,
          fileName: args.displayName,
        });
      } else {
        await ctx.runMutation(internal.private.notifications.create, {
          organizationId: args.orgId,
          type: "file_ready",
          title: "✓ File ready",
          message: `"${args.displayName}" is ready to use`,
          fileId: args.entryId,
          fileName: args.displayName,
        });
      }

      try {
        await ctx.runMutation(internal.system.fileProcessor.trackFileChange, {
          organizationId: args.orgId,
          knowledgeBaseId: args.knowledgeBaseId ?? undefined,
        });
      } catch (error) {
        console.error(`[finalizeFileProcessingNotification] Failed to track file change:`, error);
      }

      return;
    }

    const MAX_PASSES = 20;
    if (pass < MAX_PASSES) {
      await ctx.scheduler.runAfter(30_000, internal.system.fileProcessor.finalizeFileProcessingNotification, {
        orgId: args.orgId,
        entryId: args.entryId,
        displayName: args.displayName,
        storageId: args.storageId,
        namespace: args.namespace,
        knowledgeBaseId: args.knowledgeBaseId,
        cursor: cursor ?? undefined,
        pass: pass + 1,
      });
    }
  },
});

// Delete file chunks asynchronously by storageId (recommended for large files)
export const deleteFileByStorageId = internalAction({
  args: {
    entryId: v.string(),
    displayName: v.string(),
    storageId: v.id("_storage"),
    namespace: v.string(),
    orgId: v.string(),
    knowledgeBaseId: v.union(v.string(), v.null()),
    cursor: v.optional(v.string()),
    pass: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pass = typeof args.pass === "number" ? args.pass : 0;
    console.log(
      `[deleteFileByStorageId] Starting async deletion for "${args.displayName}" (pass=${pass}, cursor=${args.cursor ?? "null"})`,
    );

    try {
      const namespace = await rag.getNamespace(ctx, {
        namespace: args.namespace,
      });

      if (!namespace) {
        console.error(`[deleteFileByStorageId] Namespace "${args.namespace}" not found`);
        try {
          await ctx.runMutation(internal.system.fileProcessor.deleteDeletedFileTombstone, {
            organizationId: args.orgId,
            storageId: args.storageId,
          });
        } catch (error) {
          console.error(`[deleteFileByStorageId] Failed to delete tombstone:`, error);
        }
        await ctx.runMutation(internal.private.notifications.create, {
          organizationId: args.orgId,
          type: "file_ready",
          title: "✓ Deletion complete",
          message: `"${args.displayName}" was removed`,
          fileId: args.entryId,
          fileName: args.displayName,
        });
        return;
      }

      // Process in small batches and reschedule to avoid timeouts on large namespaces/files.
      const BATCH_SIZE = 200;
      const res = await rag.list(ctx, {
        namespaceId: namespace.namespaceId,
        paginationOpts: { numItems: BATCH_SIZE, cursor: args.cursor ?? null },
      });

      let deletedCount = 0;
      for (const entry of res.page) {
        const metadata = entry.metadata as any;
        if (metadata?.storageId === args.storageId) {
          try {
            await rag.delete(ctx, { entryId: entry.entryId });
            deletedCount++;
          } catch (error) {
            console.error(
              `[deleteFileByStorageId] Failed to delete chunk ${entry.entryId}:`,
              error,
            );
          }
        }
      }

      console.log(
        `[deleteFileByStorageId] Batch scanned=${res.page.length}, deleted=${deletedCount}, isDone=${res.isDone} for "${args.displayName}"`,
      );

      // Reactive refresh each batch so UI doesn't get stuck in "deleting" without updates.
      try {
        await ctx.runMutation(internal.system.fileProcessor.trackFileChange, {
          organizationId: args.orgId,
          knowledgeBaseId: args.knowledgeBaseId ?? undefined,
        });
      } catch (error) {
        console.error(`[deleteFileByStorageId] Failed to track file change:`, error);
      }

      if (!res.isDone && res.continueCursor) {
        // Continue scanning the namespace.
        await ctx.scheduler.runAfter(0, internal.system.fileProcessor.deleteFileByStorageId, {
          entryId: args.entryId,
          displayName: args.displayName,
          storageId: args.storageId,
          namespace: args.namespace,
          orgId: args.orgId,
          knowledgeBaseId: args.knowledgeBaseId,
          cursor: res.continueCursor,
          pass: pass + 1,
        });
        return;
      }

      // Once namespace scan is complete, delete the storage object last.
      try {
        await ctx.storage.delete(args.storageId);
      } catch (error) {
        console.error(`[deleteFileByStorageId] Error deleting storage file:`, error);
      }

      // Completion notification
      try {
        await ctx.runMutation(internal.private.notifications.create, {
          organizationId: args.orgId,
          type: "file_ready",
          title: "✓ Deletion complete",
          message: `"${args.displayName}" was successfully removed from your knowledge base`,
          fileId: args.entryId,
          fileName: args.displayName,
        });
      } catch (error) {
        console.error(`[deleteFileByStorageId] Failed to create success notification:`, error);
      }

      // Remove tombstone so the file disappears only after deletion is fully done
      try {
        await ctx.runMutation(internal.system.fileProcessor.deleteDeletedFileTombstone, {
          organizationId: args.orgId,
          storageId: args.storageId,
        });
      } catch (error) {
        console.error(`[deleteFileByStorageId] Failed to delete tombstone:`, error);
      }

      // Reactive refresh
      try {
        await ctx.runMutation(internal.system.fileProcessor.trackFileChange, {
          organizationId: args.orgId,
          knowledgeBaseId: args.knowledgeBaseId ?? undefined,
        });
      } catch (error) {
        console.error(`[deleteFileByStorageId] Failed to track file change:`, error);
      }
    } catch (error) {
      console.error(`[deleteFileByStorageId] Error deleting "${args.displayName}":`, error);
      await ctx.runMutation(internal.private.notifications.create, {
        organizationId: args.orgId,
        type: "file_failed",
        title: "File deletion failed",
        message: `Failed to delete "${args.displayName}": ${error instanceof Error ? error.message : "Unknown error"}`,
        fileId: args.entryId,
        fileName: args.displayName,
      });

      // Retry once quickly; if it keeps failing, tombstone remains so content stays excluded from search.
      const pass = typeof args.pass === "number" ? args.pass : 0;
      if (pass < 5) {
        try {
          await ctx.scheduler.runAfter(1000, internal.system.fileProcessor.deleteFileByStorageId, {
            entryId: args.entryId,
            displayName: args.displayName,
            storageId: args.storageId,
            namespace: args.namespace,
            orgId: args.orgId,
            knowledgeBaseId: args.knowledgeBaseId,
            cursor: args.cursor ?? undefined,
            pass: pass + 1,
          });
        } catch (schedError) {
          console.error(`[deleteFileByStorageId] Failed to schedule retry:`, schedError);
        }
      }

      // Reactive refresh (so UI doesn't get stuck)
      try {
        await ctx.runMutation(internal.system.fileProcessor.trackFileChange, {
          organizationId: args.orgId,
          knowledgeBaseId: args.knowledgeBaseId ?? undefined,
        });
      } catch (error) {
        console.error(`[deleteFileByStorageId] Failed to track file change after failure:`, error);
      }
    }
  },
});

export const deleteDeletedFileTombstone = internalMutation({
  args: {
    organizationId: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("deletedFiles")
      .withIndex("by_org_and_storage", (q) =>
        q.eq("organizationId", args.organizationId).eq("storageId", args.storageId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// Update placeholder status by deleting it (since we already have chunks with correct status)
export const updatePlaceholderStatus = internalMutation({
  args: {
    entryId: v.string(),
    status: v.union(v.literal("ready"), v.literal("error"), v.literal("processing")),
  },
  handler: async (ctx, args) => {
    // Since we can't update RAG metadata directly, we'll just delete the placeholder
    // The chunks already have the correct "ready" status
    try {
      await rag.deleteAsync(ctx, { entryId: args.entryId as EntryId });
      console.log(`[updatePlaceholderStatus] Deleted placeholder ${args.entryId}, chunks with status "${args.status}" remain`);
    } catch (error) {
      console.error("[updatePlaceholderStatus] Error:", error);
    }
  },
});

// Delete placeholder entry (keeping for backward compatibility)
export const deletePlaceholder = internalMutation({
  args: {
    entryId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      await rag.deleteAsync(ctx, { entryId: args.entryId as EntryId });
    } catch (error) {
      console.error("[deletePlaceholder] Error:", error);
    }
  },
});

// Mark entry as error
export const markAsError = internalMutation({
  args: {
    entryId: v.string(),
    namespace: v.string(),
    storageId: v.id("_storage"),
    uploadedBy: v.string(),
    displayName: v.string(),
    originalFilename: v.string(),
    category: v.union(v.string(), v.null()),
    knowledgeBaseId: v.union(v.string(), v.null()),
    sourceType: v.union(v.literal("uploaded"), v.literal("scraped")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    console.error(`[markAsError] Entry ${args.entryId} failed: ${args.error}`);

    try {
      await rag.deleteAsync(ctx, { entryId: args.entryId as EntryId });
    } catch (error) {
      console.error("[markAsError] Failed to delete placeholder:", error);
    }

    const errorEntry = await rag.add(ctx, {
      namespace: args.namespace,
      text: "",
      key: args.displayName,
      title: args.displayName,
      filterValues: [{ name: "storageId", value: args.storageId }],
      metadata: {
        storageId: args.storageId,
        uploadedBy: args.uploadedBy,
        displayName: args.displayName,
        originalFilename: args.originalFilename,
        category: args.category,
        knowledgeBaseId: args.knowledgeBaseId,
        sourceType: args.sourceType,
        chunkIndex: 0,
        totalChunks: 1,
        processingStatus: "error",
        error: args.error,
      },
    });

    return errorEntry.entryId;
  },
});

// Delete file chunks asynchronously
export const deleteFileChunks = internalAction({
  args: {
    entryId: v.string(),
    displayName: v.string(),
    storageId: v.union(v.id("_storage"), v.null()),
    namespace: v.string(),
    orgId: v.string(),
  },
  handler: async (ctx, args) => {
    console.log(`[deleteFileChunks] Starting async deletion for "${args.displayName}"`);

    // Skip deletion if displayName is empty or "Unknown file" (file already deleted)
    if (!args.displayName || args.displayName === "Unknown file") {
      console.log(`[deleteFileChunks] Skipping deletion - file already removed or invalid displayName`);
      return;
    }

    try {
      // Get the namespace to convert string to namespaceId
      const namespace = await rag.getNamespace(ctx, {
        namespace: args.namespace,
      });

      if (!namespace) {
        console.error(`[deleteFileChunks] Namespace "${args.namespace}" not found`);
        // Still create success notification since the file is effectively deleted
        await ctx.runMutation(internal.private.notifications.create, {
          organizationId: args.orgId,
          type: "file_ready",
          title: "✓ Deletion complete",
          message: `"${args.displayName}" was successfully removed`,
          fileId: args.entryId,
          fileName: args.displayName,
        });
        return;
      }

      let deletedCount = 0;
      let hasMore = true;
      let cursor: string | null = null;
      let totalScanned = 0;
      let emptyBatchCount = 0;
      const MAX_EMPTY_BATCHES = 3; // Stop after 3 consecutive empty batches

      // Paginate through all chunks with the same displayName
      while (hasMore) {
        const listResult = await rag.list(ctx, {
          namespaceId: namespace.namespaceId,
          paginationOpts: {
            cursor,
            numItems: 100,
          },
        });

        totalScanned += listResult.page.length;

        // Filter entries by displayName
        const matchingEntries = listResult.page.filter((entry) => {
          const metadata = entry.metadata as any;
          return metadata?.displayName === args.displayName;
        });

        console.log(`[deleteFileChunks] Found ${matchingEntries.length} matching entries out of ${listResult.page.length} in this batch`);

        // Track empty batches to avoid infinite loops
        if (matchingEntries.length === 0) {
          emptyBatchCount++;
          if (emptyBatchCount >= MAX_EMPTY_BATCHES) {
            console.log(`[deleteFileChunks] No matches found in ${MAX_EMPTY_BATCHES} batches, stopping search`);
            break;
          }
        } else {
          emptyBatchCount = 0; // Reset counter when we find matches
        }

        // Delete each matching chunk
        for (const entry of matchingEntries) {
          try {
            await rag.delete(ctx, { entryId: entry.entryId });
            deletedCount++;
          } catch (error) {
            console.error(`[deleteFileChunks] Failed to delete chunk ${entry.entryId}:`, error);
          }
        }

        hasMore = !!listResult.continueCursor;
        cursor = listResult.continueCursor ?? null;

        // If we've deleted some entries and found no more matches, stop
        if (deletedCount > 0 && matchingEntries.length === 0 && !listResult.continueCursor) {
          break;
        }
      }

      console.log(`[deleteFileChunks] Scanned ${totalScanned} total entries, deleted ${deletedCount} chunks for "${args.displayName}"`);

      // Only proceed with storage deletion and notification if we actually deleted something
      // or if this is the first deletion attempt (deletedCount could be 0 if already deleted)
      if (deletedCount === 0) {
        console.log(`[deleteFileChunks] No entries found to delete for "${args.displayName}" - file may already be deleted`);
        // Don't send notification if nothing was deleted (file already gone)
        return;
      }

      // Delete the storage file if it exists
      if (args.storageId) {
        try {
          await ctx.storage.delete(args.storageId);
          console.log(`[deleteFileChunks] Deleted storage file for "${args.displayName}"`);
        } catch (error) {
          console.error(`[deleteFileChunks] Error deleting storage file:`, error);
        }
      }

      // Create success notification (only if we deleted something)
      console.log(`[deleteFileChunks] Creating success notification for "${args.displayName}"`);
      
      try {
        await ctx.runMutation(internal.private.notifications.create, {
          organizationId: args.orgId,
          type: "file_ready",
          title: "✓ Deletion complete",
          message: `"${args.displayName}" was successfully removed from your knowledge base`,
          fileId: args.entryId,
          fileName: args.displayName,
        });
        console.log(`[deleteFileChunks] Success notification created for "${args.displayName}"`);
      } catch (notifError) {
        console.error(`[deleteFileChunks] Failed to create success notification:`, notifError);
      }

      console.log(`[deleteFileChunks] Successfully completed deletion of "${args.displayName}"`);
    } catch (error) {
      console.error(`[deleteFileChunks] Error deleting "${args.displayName}":`, error);

      // Create failure notification
      await ctx.runMutation(internal.private.notifications.create, {
        organizationId: args.orgId,
        type: "file_failed",
        title: "File deletion failed",
        message: `Failed to delete "${args.displayName}": ${error instanceof Error ? error.message : "Unknown error"}`,
        fileId: args.entryId,
        fileName: args.displayName,
      });
    }
  },
});

// Track file change for reactive queries
export const trackFileChange = internalMutation({
  args: {
    organizationId: v.string(),
    knowledgeBaseId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("fileChangeTracker", {
      organizationId: args.organizationId,
      knowledgeBaseId: args.knowledgeBaseId ?? undefined,
      lastChange: Date.now(),
      changeType: "update",
    });
  },
});

/**
 * Advanced text chunking with overlap for RAG
 */
function chunkText(
  text: string,
  chunkSize: number = 2000,
  overlapSize: number = 400
): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize;

    if (endIndex < text.length) {
      const chunkText = text.slice(startIndex, endIndex);
      const lastPeriod = chunkText.lastIndexOf(". ");
      const lastNewline = chunkText.lastIndexOf("\n");
      const lastBreak = Math.max(lastPeriod, lastNewline);

      if (lastBreak > chunkSize * 0.7) {
        endIndex = startIndex + lastBreak + (lastPeriod > lastNewline ? 2 : 1);
      }
    } else {
      endIndex = text.length;
    }

    const chunk = text.slice(startIndex, endIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    if (endIndex >= text.length) {
      break;
    }

    const nextStart = endIndex - overlapSize;
    startIndex = Math.max(nextStart, startIndex + 1);
  }

  return chunks.length > 0 ? chunks : [text];
}
