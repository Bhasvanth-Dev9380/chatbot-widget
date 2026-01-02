import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

export const getByOrgBaseLanguage = internalQuery({
  args: {
    organizationId: v.string(),
    baseAgentId: v.string(),
    language: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_org_base_language", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("baseAgentId", args.baseAgentId)
          .eq("language", args.language),
      )
      .unique();
  },
});

export const getByAgentId = internalQuery({
  args: {
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", args.agentId))
      .unique();
  },
});

export const create = internalMutation({
  args: {
    organizationId: v.string(),
    baseAgentId: v.string(),
    language: v.string(),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_org_base_language", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("baseAgentId", args.baseAgentId)
          .eq("language", args.language),
      )
      .unique();

    if (existing) {
      return existing;
    }

    const id = await ctx.db.insert("beyondPresenceLanguageAgents", {
      organizationId: args.organizationId,
      baseAgentId: args.baseAgentId,
      language: args.language,
      agentId: args.agentId,
      createdAt: Date.now(),
    });

    return await ctx.db.get(id);
  },
});
