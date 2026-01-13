import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

export const getByOrgBaseLanguage = internalQuery({
  args: {
    entityId: v.string(),
    baseAgentId: v.string(),
    language: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_entity_base_language", (q) =>
        q
          .eq("entityId", args.entityId)
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

export const listByEntityId = internalQuery({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_entity_base_language", (q) => q.eq("entityId", args.entityId))
      .collect();
  },
});

export const listByOrgBaseAgentId = internalQuery({
  args: {
    entityId: v.string(),
    baseAgentId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_entity_base_language", (q) =>
        q.eq("entityId", args.entityId).eq("baseAgentId", args.baseAgentId),
      )
      .collect();
  },
});

export const create = internalMutation({
  args: {
    entityId: v.string(),
    baseAgentId: v.string(),
    language: v.string(),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_entity_base_language", (q) =>
        q
          .eq("entityId", args.entityId)
          .eq("baseAgentId", args.baseAgentId)
          .eq("language", args.language),
      )
      .unique();

    if (existing) {
      return existing;
    }

    const id = await ctx.db.insert("beyondPresenceLanguageAgents", {
      entityId: args.entityId,
      baseAgentId: args.baseAgentId,
      language: args.language,
      agentId: args.agentId,
      createdAt: Date.now(),
    });

    return await ctx.db.get(id);
  },
});

export const deleteByAgentId = internalMutation({
  args: {
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_agent_id", (q) => q.eq("agentId", args.agentId))
      .unique();

    if (!existing) return;
    await ctx.db.delete(existing._id);
  },
});

export const deleteByOrgBaseAgentId = internalMutation({
  args: {
    entityId: v.string(),
    baseAgentId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("beyondPresenceLanguageAgents")
      .withIndex("by_entity_base_language", (q) =>
        q.eq("entityId", args.entityId).eq("baseAgentId", args.baseAgentId),
      )
      .collect();

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
  },
});

export const migrateStripLegacyOrganizationId = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows: any[] = await ctx.db.query("beyondPresenceLanguageAgents").collect();

    let updated = 0;
    for (const row of rows) {
      if (row && typeof row === "object" && "organizationId" in row) {
        const { organizationId: _legacy, ...rest } = row as any;
        await ctx.db.replace(row._id, rest);
        updated += 1;
      }
    }

    return { scanned: rows.length, updated };
  },
});
