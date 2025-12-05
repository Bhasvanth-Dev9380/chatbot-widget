import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";

/**
 * NOTE:
 * We no longer use ctx.auth.getUserIdentity()
 * The client MUST pass organizationId from BetterAuth session.
 */

export const upsert = mutation({
  args: {
    organizationId: v.string(), // ✅ NEW — passed from client
    greetMessage: v.string(),
    defaultSuggestions: v.object({
      suggestion1: v.optional(v.string()),
      suggestion2: v.optional(v.string()),
      suggestion3: v.optional(v.string()),
    }),
    vapiSettings: v.object({
      assistantId: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const orgId = args.organizationId;

    if (!orgId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Organization ID missing",
      });
    }

    // 🔍 Check if widget settings exist for org
    const existing = await ctx.db
      .query("widgetSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", orgId))
      .unique();

    if (existing) {
      // 🔄 Update existing
      await ctx.db.patch(existing._id, {
        greetMessage: args.greetMessage,
        defaultSuggestions: args.defaultSuggestions,
        vapiSettings: args.vapiSettings,
      });
    } else {
      // ➕ Create new settings
      await ctx.db.insert("widgetSettings", {
        organizationId: orgId,
        greetMessage: args.greetMessage,
        defaultSuggestions: args.defaultSuggestions,
        vapiSettings: args.vapiSettings,
      });
    }
  },
});

export const getOne = query({
  args: {
    organizationId: v.string(), // ✅ NEW — passed from client
  },
  handler: async (ctx, args) => {
    const orgId = args.organizationId;

    if (!orgId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Organization ID missing",
      });
    }

    return await ctx.db
      .query("widgetSettings")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", orgId))
      .unique();
  },
});
