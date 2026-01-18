import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

export const upsert = internalMutation({
  args: {
    service: v.union(
      v.literal("vapi"),
      v.literal("beyond_presence"),
      v.literal("salesforce"),
      v.literal("zoho_desk"),
      v.literal("slack"),
      v.literal("clover"),
      v.literal("hubspot"),
    ),
    secretName: v.string(),
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const existingPlugin = await ctx.db
      .query("plugins")
      .withIndex("by_entity_id_and_service", (q) =>
        q.eq("entityId", args.entityId).eq("service", args.service),
      )
      .unique();

    if (existingPlugin) {
      await ctx.db.patch(existingPlugin._id, {
        service: args.service,
        secretName: args.secretName,
      });
    } else {
      await ctx.db.insert("plugins", {
        entityId: args.entityId,
        service: args.service,
        secretName: args.secretName,
      });
    }
  },
});

export const getByEntityIdAndService = internalQuery({
  args: {
    entityId: v.string(),
    service: v.union(
      v.literal("vapi"),
      v.literal("beyond_presence"),
      v.literal("salesforce"),
      v.literal("zoho_desk"),
      v.literal("slack"),
      v.literal("clover"),
      v.literal("hubspot"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("plugins")
      .withIndex("by_entity_id_and_service", (q) =>
        q.eq("entityId", args.entityId).eq("service", args.service),
      )
      .unique();
  },
});

export const listByService = internalQuery({
  args: {
    service: v.union(
      v.literal("vapi"),
      v.literal("beyond_presence"),
      v.literal("salesforce"),
      v.literal("zoho_desk"),
      v.literal("slack"),
      v.literal("clover"),
      v.literal("hubspot"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("plugins")
      .filter((q) => q.eq(q.field("service"), args.service))
      .collect();
  },
});