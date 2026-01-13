import { v } from "convex/values";
import { query } from "../_generated/server";

export const validate = query({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[validate] Checking entityId:", args.entityId);
    
    const users = await ctx.db
      .query("users")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId)
      )
      .collect();

    console.log("[validate] Found users:", users.length);

    if (users.length > 0) {
      return { valid: true };
    }

    // Debug: List all users to see what entityIds exist
    const allUsers = await ctx.db.query("users").collect();
    console.log("[validate] All entityIds in DB:", allUsers.map(u => u.entityId));

    return {
      valid: false,
      reason: "Organization not found",
    };
  },
});
