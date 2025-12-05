import { v } from "convex/values";
import { query } from "../_generated/server";

export const validate = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    if (users.length > 0) {
      return { valid: true };
    }

    return {
      valid: false,
      reason: "Organization not found",
    };
  },
});
