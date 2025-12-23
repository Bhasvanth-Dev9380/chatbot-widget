import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const upsert = action({
  args: {
    service: v.union(v.literal("vapi"), v.literal("beyond_presence")),
    value: v.any(),
    // ✅ orgId from client
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = args.organizationId;

    // Run synchronously so the plugin is created immediately
    await ctx.runAction(internal.system.secrets.upsert, {
      service: args.service,
      organizationId: orgId,
      value: args.value,
    });
  },
});
