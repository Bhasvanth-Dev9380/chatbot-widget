import { v } from "convex/values";
import { query } from "../_generated/server";

export const validate = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[validate] Checking organizationId:", args.organizationId);
    
    const users = await ctx.db
      .query("users")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .collect();

    console.log("[validate] Found users:", users.length);

    if (users.length > 0) {
      return { valid: true };
    }

    // Debug: List all users to see what organizationIds exist
    const allUsers = await ctx.db.query("users").collect();
    console.log("[validate] All organizationIds in DB:", allUsers.map(u => u.organizationId));

    return {
      valid: false,
      reason: "Organization not found",
    };
  },
});
