import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import { Id } from "../_generated/dataModel";

export const getByKnowledgeBaseId = internalQuery({
  args: { knowledgeBaseId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knowledgeBases")
      .withIndex("by_knowledge_base_id", (q) => q.eq("knowledgeBaseId", args.knowledgeBaseId))
      .unique();
  },
});

export const getById = internalQuery({
  args: { id: v.id("knowledgeBases") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
