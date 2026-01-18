import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Join the SLM waitlist
 */
export const joinWaitlist = mutation({
  args: {
    entityId: v.string(),
    entityName: v.optional(v.string()),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if entity is already on the waitlist
    const existing = await ctx.db
      .query("slmWaitlist")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .first();

    if (existing) {
      // Update existing entry
      await ctx.db.patch(existing._id, {
        entityName: args.entityName,
        email: args.email,
        updatedAt: Date.now(),
      });
      return { success: true, alreadyOnWaitlist: true, waitlistId: existing._id };
    }

    // Create new waitlist entry
    const waitlistId = await ctx.db.insert("slmWaitlist", {
      entityId: args.entityId,
      entityName: args.entityName,
      email: args.email,
      status: "pending",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true, alreadyOnWaitlist: false, waitlistId };
  },
});

/**
 * Check if an entity is on the waitlist
 */
export const checkWaitlistStatus = query({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const waitlistEntry = await ctx.db
      .query("slmWaitlist")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .first();

    if (!waitlistEntry) {
      return { onWaitlist: false, status: null };
    }

    return {
      onWaitlist: true,
      status: waitlistEntry.status,
      createdAt: waitlistEntry.createdAt,
    };
  },
});

/**
 * Get all waitlist entries (admin only)
 */
export const getAllWaitlistEntries = query({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db
      .query("slmWaitlist")
      .withIndex("by_created_at")
      .order("desc")
      .collect();

    return entries;
  },
});

/**
 * Update waitlist entry status (admin only)
 */
export const updateWaitlistStatus = mutation({
  args: {
    waitlistId: v.id("slmWaitlist"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.waitlistId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
