import { ConvexError, v } from "convex/values";
import {
  guessMimeTypeFromContents,
  guessMimeTypeFromExtension,
  vEntryId,
  Entry,
  EntryId,
} from "@convex-dev/rag";
import { mutation, query, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { extractTextContent } from "../lib/extractTextContent";
import rag from "../system/ai/rag";
import { Id } from "../_generated/dataModel";
import { paginationOptsValidator } from "convex/server";

/* -------------------------------------------------
   HELPERS
------------------------------------------------- */
function guessMimeType(filename: string, bytes: ArrayBuffer): string {
  return (
    guessMimeTypeFromExtension(filename) ||
    guessMimeTypeFromContents(bytes) ||
    "application/octet-stream"
  );
}

// Get namespace for a knowledge base - must match what WIDGET uses
function getKbNamespace(
  orgId: string,
  kb: { ragNamespace?: string; knowledgeBaseId?: string; _id: Id<"knowledgeBases"> }
): string {
  // Priority: ragNamespace (the canonical value) > fallback construction
  if (kb.ragNamespace) return kb.ragNamespace;
  // Fallback: construct from knowledgeBaseId string or _id
  if (kb.knowledgeBaseId) return `${orgId}_${kb.knowledgeBaseId}`;
  return `${orgId}_${kb._id}`;
}

/* -------------------------------------------------
   UPLOAD URL
------------------------------------------------- */
export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

/* -------------------------------------------------
   DEBUG: LIST ALL NAMESPACES AND FILES
------------------------------------------------- */
export const debugListAll = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all KBs for this org
    const kbs = await ctx.db
      .query("knowledgeBases")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .collect();

    const results: Array<{
      kbName: string;
      kbId: string;
      ragNamespace: string | undefined;
      constructedNamespace: string;
      namespaceFound: boolean;
      fileCount: number;
      uniqueFileNames: string[];
    }> = [];

    for (const kb of kbs) {
      const constructedNs = `${args.organizationId}_${kb.knowledgeBaseId || kb._id}`;
      const nsToUse = kb.ragNamespace || constructedNs;
      
      let namespaceFound = false;
      let fileCount = 0;
      const uniqueNames = new Set<string>();

      try {
        const namespace = await rag.getNamespace(ctx, { namespace: nsToUse });
        if (namespace) {
          namespaceFound = true;
          const res = await rag.list(ctx, {
            namespaceId: namespace.namespaceId,
            paginationOpts: { numItems: 500, cursor: null },
          });
          fileCount = res.page.length;
          
          // Collect unique file names
          for (const entry of res.page) {
            const metadata = entry.metadata as any;
            const name = metadata?.displayName || entry.key || "Unknown";
            uniqueNames.add(name);
          }
        }
      } catch (e) {
        console.error(`Error checking namespace ${nsToUse}:`, e);
      }

      results.push({
        kbName: kb.name,
        kbId: kb._id,
        ragNamespace: kb.ragNamespace,
        constructedNamespace: constructedNs,
        namespaceFound,
        fileCount,
        uniqueFileNames: Array.from(uniqueNames),
      });
    }

    return results;
  },
});

/* -------------------------------------------------
   DEBUG: GET ENTRY BY ID
------------------------------------------------- */
export const debugGetEntry = query({
  args: {
    entryId: vEntryId,
  },
  handler: async (ctx, args) => {
    const entry = await rag.getEntry(ctx, { entryId: args.entryId });
    if (!entry) return { found: false };
    return {
      found: true,
      entryId: entry.entryId,
      key: entry.key,
      status: entry.status,
      metadata: entry.metadata,
    };
  },
});

/* -------------------------------------------------
   CREATE FILE AFTER UPLOAD
------------------------------------------------- */
export const createFileAfterUpload = mutation({
  args: {
    organizationId: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    displayName: v.string(),
    mimeType: v.string(),
    category: v.optional(v.string()),
    knowledgeBaseId: v.optional(v.id("knowledgeBases")),
  },
  handler: async (ctx, args) => {
    const displayName = args.displayName.trim() || args.filename;

    // Get knowledge base and determine namespace
    const kb = args.knowledgeBaseId
      ? await ctx.db.get(args.knowledgeBaseId)
      : null;

    if (args.knowledgeBaseId && !kb) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Knowledge base not found",
      });
    }

    // Use ragNamespace if available, otherwise construct consistently
    const namespace = kb
      ? (kb.ragNamespace || `${args.organizationId}_${kb.knowledgeBaseId || kb._id}`)
      : args.organizationId;

    console.log(`[createFileAfterUpload] Creating file "${displayName}" in namespace: ${namespace}, KB _id: ${args.knowledgeBaseId}, KB ragNamespace: ${kb?.ragNamespace}`);

    const placeholder = await rag.add(ctx, {
      namespace,
      text: "",
      key: displayName,
      title: displayName,
      metadata: {
        storageId: args.storageId,
        uploadedBy: args.organizationId,
        displayName,
        originalFilename: args.filename,
        category: args.category ?? null,
        knowledgeBaseId: args.knowledgeBaseId ?? null,
        sourceType: "uploaded",
        chunkIndex: 0,
        totalChunks: 1,
        processingStatus: "processing",
      },
    });

    console.log(`[createFileAfterUpload] Placeholder created with entryId: ${placeholder.entryId}`);

    await ctx.db.insert("notifications", {
      organizationId: args.organizationId,
      type: "file_processing",
      title: "📁 File added",
      message: `"${displayName}" is being processed`,
      fileId: placeholder.entryId,
      fileName: displayName,
      read: false,
      createdAt: Date.now(),
    });

    await ctx.db.insert("fileChangeTracker", {
      organizationId: args.organizationId,
      knowledgeBaseId: args.knowledgeBaseId ?? undefined,
      lastChange: Date.now(),
      changeType: "add",
    });

    // Schedule async file processing
    await ctx.scheduler.runAfter(0, internal.system.fileProcessor.processFile, {
      storageId: args.storageId,
      filename: args.filename,
      displayName,
      mimeType: args.mimeType,
      namespace,
      category: args.category ?? null,
      knowledgeBaseId: args.knowledgeBaseId ?? null,
      sourceType: "uploaded",
      orgId: args.organizationId,
      entryId: placeholder.entryId,
    });

    return placeholder.entryId;
  },
});

/* -------------------------------------------------
   DELETE FILE
------------------------------------------------- */
export const deleteFile = mutation({
  args: {
    entryId: vEntryId,
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await rag.getEntry(ctx, { entryId: args.entryId });
    if (!entry) {
      // Entry doesn't exist, nothing to delete
      return;
    }

    const metadata = entry.metadata as EntryMetadata | undefined;
    
    // Check authorization - allow deletion if:
    // 1. metadata.uploadedBy matches organizationId, OR
    // 2. No uploadedBy set (legacy or processing files)
    if (metadata?.uploadedBy && metadata.uploadedBy !== args.organizationId) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Forbidden" });
    }

    const kb = metadata?.knowledgeBaseId
      ? await ctx.db.get(metadata.knowledgeBaseId)
      : null;

    // Delete from RAG first
    try {
      await rag.delete(ctx, { entryId: args.entryId });
    } catch (error) {
      console.error("[deleteFile] Error deleting from RAG:", error);
      // Continue anyway to clean up tracking
    }

    // Also delete the storage file if it exists
    if (metadata?.storageId) {
      try {
        await ctx.storage.delete(metadata.storageId);
      } catch (error) {
        console.error("[deleteFile] Error deleting storage file:", error);
        // Continue anyway
      }
    }

    await ctx.db.insert("fileChangeTracker", {
      organizationId: args.organizationId,
      knowledgeBaseId: metadata?.knowledgeBaseId ?? undefined,
      lastChange: Date.now(),
      changeType: "delete",
    });
  },
});

/* -------------------------------------------------
   LIST FILES
------------------------------------------------- */
export const list = query({
  args: {
    organizationId: v.string(),
    category: v.optional(v.string()),
    knowledgeBaseId: v.optional(v.id("knowledgeBases")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Watch file change tracker to make this query reactive
    const latestChange = await ctx.db
      .query("fileChangeTracker")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .order("desc")
      .first();

    console.log(`[files.list] Query for org ${args.organizationId}, kbFilter: ${args.knowledgeBaseId ?? "ALL"}`);

    let files: PublicFile[] = [];

    if (args.knowledgeBaseId) {
      // Query specific knowledge base
      const kb = await ctx.db.get(args.knowledgeBaseId);
      if (!kb || kb.organizationId !== args.organizationId) {
        console.log(`[files.list] KB ${args.knowledgeBaseId} not found or wrong org`);
        return { page: [], isDone: true, continueCursor: "" };
      }

      // Use ragNamespace if available, otherwise construct from knowledgeBaseId or _id
      const ns = kb.ragNamespace || `${args.organizationId}_${kb.knowledgeBaseId || kb._id}`;
      console.log(`[files.list] Querying KB "${kb.name}" namespace: ${ns}`);

      try {
        const namespace = await rag.getNamespace(ctx, { namespace: ns });
        if (namespace) {
          const res = await rag.list(ctx, {
            namespaceId: namespace.namespaceId,
            paginationOpts: { numItems: 500, cursor: null },
          });
          console.log(`[files.list] Found ${res.page.length} entries in namespace ${ns}`);
          for (const entry of res.page) {
            files.push(await convertEntryToPublicFile(ctx, entry));
          }
        } else {
          console.log(`[files.list] Namespace ${ns} not found in RAG`);
        }
      } catch (error) {
        console.error(`[files.list] Error querying namespace ${ns}:`, error);
      }
    } else {
      // Query all knowledge bases for this organization
      const kbs = await ctx.db
        .query("knowledgeBases")
        .withIndex("by_organization_id", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .collect();

      console.log(`[files.list] Querying ALL ${kbs.length} knowledge bases`);

      for (const kb of kbs) {
        // Use ragNamespace if available, otherwise construct from knowledgeBaseId or _id
        const ns = kb.ragNamespace || `${args.organizationId}_${kb.knowledgeBaseId || kb._id}`;
        
        try {
          const namespace = await rag.getNamespace(ctx, { namespace: ns });
          if (!namespace) {
            console.log(`[files.list] Namespace ${ns} for KB "${kb.name}" not found`);
            continue;
          }

          const res = await rag.list(ctx, {
            namespaceId: namespace.namespaceId,
            paginationOpts: { numItems: 500, cursor: null },
          });

          console.log(`[files.list] KB "${kb.name}" (${ns}): ${res.page.length} entries`);

          for (const entry of res.page) {
            files.push(await convertEntryToPublicFile(ctx, entry));
          }
        } catch (error) {
          console.error(`[files.list] Error with KB "${kb.name}":`, error);
          continue;
        }
      }
    }

    console.log(`[files.list] Total files before dedup: ${files.length}`);

    if (args.category) {
      files = files.filter((f) => f.category === args.category);
    }

    files = deduplicateFiles(files);
    console.log(`[files.list] After dedup: ${files.length} unique files`);

    const limit = args.paginationOpts.numItems;
    return {
      page: files.slice(0, limit),
      isDone: files.length <= limit,
      continueCursor: "",
    };
  },
});

/* -------------------------------------------------
   RETRY FILE PROCESSING
------------------------------------------------- */
export const retryFileProcessing = mutation({
  args: {
    entryId: vEntryId,
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const entry = await rag.getEntry(ctx, { entryId: args.entryId });
    if (!entry) {
      throw new ConvexError({ code: "NOT_FOUND", message: "File not found" });
    }

    const metadata = entry.metadata as EntryMetadata | undefined;
    if (metadata?.uploadedBy !== args.organizationId) {
      throw new ConvexError({ code: "UNAUTHORIZED", message: "Forbidden" });
    }

    const storageId = metadata?.storageId;
    if (!storageId) {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: "File has no storage reference",
      });
    }

    const kb = metadata?.knowledgeBaseId
      ? await ctx.db.get(metadata.knowledgeBaseId)
      : null;

    // Use the KB's ragNamespace if available
    const namespace = kb
      ? getKbNamespace(args.organizationId, kb)
      : args.organizationId;

    const displayName = metadata?.displayName ?? "unknown";
    const originalFilename = metadata?.originalFilename ?? "unknown";
    const sourceType = metadata?.sourceType ?? "uploaded";

    // Delete the old entry
    await rag.delete(ctx, { entryId: args.entryId });

    // Create a new placeholder entry with processing status
    const placeholder = await rag.add(ctx, {
      namespace,
      text: "",
      key: displayName,
      title: displayName,
      metadata: {
        storageId,
        uploadedBy: args.organizationId,
        displayName,
        originalFilename,
        category: metadata?.category ?? null,
        knowledgeBaseId: metadata?.knowledgeBaseId ?? null,
        sourceType,
        chunkIndex: 0,
        totalChunks: 1,
        processingStatus: "processing",
      },
    });

    // Re-schedule file processing
    await ctx.scheduler.runAfter(0, internal.system.fileProcessor.processFile, {
      storageId,
      filename: originalFilename,
      displayName,
      mimeType: "application/octet-stream",
      namespace,
      category: metadata?.category ?? null,
      knowledgeBaseId: metadata?.knowledgeBaseId ?? null,
      sourceType,
      orgId: args.organizationId,
      entryId: placeholder.entryId,
    });

    return { success: true };
  },
});

/* -------------------------------------------------
   TYPES
------------------------------------------------- */
export type PublicFile = {
  id: EntryId;
  name: string;
  originalFilename: string;
  type: string;
  size: string;
  status: "ready" | "processing" | "error";
  url: string | null;
  category?: string;
  knowledgeBaseId?: Id<"knowledgeBases">;
  sourceType?: "uploaded" | "scraped";
};

type EntryMetadata = {
  storageId: Id<"_storage">;
  uploadedBy: string;
  displayName: string;
  originalFilename: string;
  category: string | null;
  knowledgeBaseId?: Id<"knowledgeBases">;
  processingStatus?: "processing" | "ready" | "error";
  sourceType?: "uploaded" | "scraped";
};

/* -------------------------------------------------
   TRANSFORMS
------------------------------------------------- */
async function convertEntryToPublicFile(
  ctx: QueryCtx,
  entry: Entry,
): Promise<PublicFile> {
  const metadata = entry.metadata as EntryMetadata | undefined;
  const storageId = metadata?.storageId;

  let size = "unknown";
  if (storageId) {
    const meta = await ctx.db.system.get(storageId);
    if (meta) size = formatFileSize(meta.size);
  }

  return {
    id: entry.entryId,
    name: metadata?.displayName || entry.key || "Unknown",
    originalFilename: metadata?.originalFilename || entry.key || "Unknown",
    type: (metadata?.originalFilename || "").split(".").pop() || "txt",
    size,
    status:
      metadata?.processingStatus === "ready"
        ? "ready"
        : metadata?.processingStatus === "error"
        ? "error"
        : "processing",
    url: storageId ? await ctx.storage.getUrl(storageId) : null,
    category: metadata?.category ?? undefined,
    knowledgeBaseId: metadata?.knowledgeBaseId,
    sourceType: metadata?.sourceType ?? "uploaded",
  };
}

function formatFileSize(bytes: number): string {
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function deduplicateFiles(files: PublicFile[]): PublicFile[] {
  const map = new Map<string, PublicFile>();
  for (const f of files) {
    // Create unique key combining file name and knowledge base ID
    const key = `${f.name}-${f.knowledgeBaseId ?? "default"}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, f);
    } else {
      // Prioritize "ready" > "error" > "processing" status
      const statusPriority = { ready: 3, error: 2, processing: 1 };
      const existingPriority = statusPriority[existing.status] || 0;
      const currentPriority = statusPriority[f.status] || 0;

      if (currentPriority > existingPriority) {
        map.set(key, f);
      }
    }
  }
  return [...map.values()];
}
