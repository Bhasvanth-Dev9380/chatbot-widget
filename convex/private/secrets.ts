import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const upsert = action({
  args: {
    service: v.union(
      v.literal("vapi"),
      v.literal("beyond_presence"),
      v.literal("salesforce"),
      v.literal("zoho_desk"),
      v.literal("slack"),
    ),
    value: v.any(),
    // ✅ orgId from client
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = args.entityId;

    // Run synchronously so the plugin is created immediately
    await ctx.runAction(internal.system.secrets.upsert, {
      service: args.service as any,
      entityId: orgId,
      value: args.value,
    });
  },
});
