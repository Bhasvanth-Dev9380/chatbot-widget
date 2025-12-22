import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { upsertSecret } from "../lib/secrets";

export const upsert = internalAction({
  args: {
    organizationId: v.string(),
    service: v.union(v.literal("vapi"), v.literal("beyond_presence")),
    value: v.any(),
  },
  handler: async (ctx, args) => {
  const secretName = `tenant/${args.organizationId}/${args.service}`;

  await upsertSecret(secretName, args.value);

  await ctx.runMutation(internal.system.plugin.upsert, {
  service: args.service,
  secretName,
  organizationId: args.organizationId,
});


  return { status: "success" };
}

});