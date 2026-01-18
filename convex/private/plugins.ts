import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const remove = mutation({
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
    // ✅ orgId now comes from the client (BetterAuth → Convex user)
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = args.entityId;

    const existingPlugin = await ctx.db
      .query("plugins")
      .withIndex("by_entity_id_and_service", (q) =>
        q.eq("entityId", orgId).eq("service", args.service),
      )
      .unique();

    if (!existingPlugin) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Plugin not found",
      });
    }

    await ctx.db.delete(existingPlugin._id);
  },
});

export const getOne = query({
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
    // ✅ orgId from client
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = args.entityId;

    return await ctx.db
      .query("plugins")
      .withIndex("by_entity_id_and_service", (q) =>
        q.eq("entityId", orgId).eq("service", args.service),
      )
      .unique();
  },
});
