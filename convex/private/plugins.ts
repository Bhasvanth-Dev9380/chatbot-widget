import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";

export const remove = mutation({
  args: {
    service: v.union(v.literal("vapi")),
    // ✅ orgId now comes from the client (BetterAuth → Convex user)
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = args.organizationId;

    const existingPlugin = await ctx.db
      .query("plugins")
      .withIndex("by_organization_id_and_service", (q) =>
        q.eq("organizationId", orgId).eq("service", args.service),
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
    service: v.union(v.literal("vapi")),
    // ✅ orgId from client
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = args.organizationId;

    return await ctx.db
      .query("plugins")
      .withIndex("by_organization_id_and_service", (q) =>
        q.eq("organizationId", orgId).eq("service", args.service),
      )
      .unique();
  },
});
