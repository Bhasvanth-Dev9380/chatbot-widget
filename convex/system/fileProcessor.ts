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
    console.log(`[processFile] Starting async processing for "${args.displayName}"`);

    try {
      // Get the file blob from storage
      const blob = await ctx.storage.get(args.storageId);
      if (!blob) {
        throw new Error("File not found in storage");
      }

      // Convert blob to ArrayBuffer
      const bytes = await blob.arrayBuffer();

      // Extract text content
      const text = await extractTextContent(ctx, {
        storageId: args.storageId,
        filename: args.filename,
        bytes,
        mimeType: args.mimeType,
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

        // Call rag.add directly from action context (not mutation)
        await rag.add(ctx, {
          namespace: args.namespace,
          text: chunk,
          key: chunkKey,
          title: args.displayName,
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

      // Mark the entry as error
      await ctx.runMutation(internal.system.fileProcessor.markAsError, {
        entryId: args.entryId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Create failure notification
      await ctx.runMutation(internal.private.notifications.create, {
        organizationId: args.orgId,
        type: "file_failed",
        title: "File processing failed",
        message: `Failed to process "${args.displayName}": ${error instanceof Error ? error.message : "Unknown error"}`,
        fileId: args.entryId,
        fileName: args.displayName,
      });
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
    error: v.string(),
  },
  handler: async (ctx, args) => {
    console.error(`[markAsError] Entry ${args.entryId} failed: ${args.error}`);
    // The placeholder entry will remain with empty text, showing as "error" status
    // The file list query will detect this and show it as failed
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
