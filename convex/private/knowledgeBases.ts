import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { nanoid } from "nanoid";
import { paginationOptsValidator } from "convex/server";

/* -------------------------------------------------
   CREATE
------------------------------------------------- */
export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = args.organizationId;
    if (!orgId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Organization not found",
      });
    }

    const knowledgeBaseId = `kb_${nanoid(16)}`;
    const ragNamespace = `${orgId}_${knowledgeBaseId}`;
    const now = Date.now();

    const id = await ctx.db.insert("knowledgeBases", {
      organizationId: orgId,
      name: args.name,
      description: args.description,
      knowledgeBaseId,
      ragNamespace, // ✅ CORRECT FIELD
      fileCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return id;
  },
});

/* -------------------------------------------------
   UPDATE
------------------------------------------------- */
export const update = mutation({
  args: {
    organizationId: v.string(),
    knowledgeBaseId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const kb = await ctx.db
      .query("knowledgeBases")
      .withIndex("by_knowledge_base_id", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .unique();

    if (!kb) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Knowledge base not found",
      });
    }

    if (kb.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    await ctx.db.patch(kb._id, {
      name: args.name,
      description: args.description,
      updatedAt: Date.now(),
    });
  },
});

/* -------------------------------------------------
   DELETE
------------------------------------------------- */
export const deleteKnowledgeBase = mutation({
  args: {
    organizationId: v.string(),
    knowledgeBaseId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    const kb = await ctx.db.get(args.knowledgeBaseId);

    if (!kb) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Knowledge base not found",
      });
    }

    if (kb.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    const chatbotsUsingKB = await ctx.db
      .query("chatbots")
      .withIndex("by_knowledge_base_id", (q) =>
        q.eq("knowledgeBaseId", kb._id),
      )
      .collect();

    if (chatbotsUsingKB.length > 0) {
      const chatbotNames = chatbotsUsingKB.map((c) => c.name).join(", ");
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `Cannot delete knowledge base. It is assigned to: ${chatbotNames}`,
      });
    }

    await ctx.db.delete(kb._id);
  },
});

/* -------------------------------------------------
   LIST
------------------------------------------------- */
export const list = query({
  args: {
    organizationId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (!args.organizationId) {
      // Return empty results if no organizationId provided
      return { page: [], isDone: true, continueCursor: "" };
    }

    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId!),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/* -------------------------------------------------
   GET ONE
------------------------------------------------- */
export const getOne = query({
  args: {
    organizationId: v.string(),
    knowledgeBaseId: v.string(),
  },
  handler: async (ctx, args) => {
    const kb = await ctx.db
      .query("knowledgeBases")
      .withIndex("by_knowledge_base_id", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId),
      )
      .unique();

    if (!kb) return null;
    if (kb.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    return kb;
  },
});

/* -------------------------------------------------
   FILE COUNT HELPERS
------------------------------------------------- */
export const incrementFileCount = mutation({
  args: {
    organizationId: v.string(),
    knowledgeBaseId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    const kb = await ctx.db.get(args.knowledgeBaseId);
    if (!kb || kb.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    await ctx.db.patch(args.knowledgeBaseId, {
      fileCount: kb.fileCount + 1,
    });
  },
});

export const decrementFileCount = mutation({
  args: {
    organizationId: v.string(),
    knowledgeBaseId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    const kb = await ctx.db.get(args.knowledgeBaseId);
    if (!kb || kb.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    await ctx.db.patch(args.knowledgeBaseId, {
      fileCount: Math.max(0, kb.fileCount - 1),
    });
  },
});
