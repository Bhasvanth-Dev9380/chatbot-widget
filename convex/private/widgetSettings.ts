import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";

/**
 * Widget Settings
 * Auth model: organizationId is passed from client (BetterAuth)
 * Behavior aligned EXACTLY with reference implementation
 */

export const upsert = mutation({
  args: {
    organizationId: v.string(),

    chatbotName: v.optional(v.string()),
    greetMessage: v.string(),
    customSystemPrompt: v.optional(v.string()),

    appearance: v.optional(
      v.object({
        primaryColor: v.optional(v.string()),
        size: v.optional(
          v.union(
            v.literal("small"),
            v.literal("medium"),
            v.literal("large"),
          ),
        ),
      }),
    ),

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

    const existing = await ctx.db
      .query("widgetSettings")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", orgId),
      )
      .unique();

    if (existing) {
      // 🔄 UPDATE (exactly like reference)
      await ctx.db.patch(existing._id, {
        chatbotName: args.chatbotName,
        greetMessage: args.greetMessage,
        customSystemPrompt: args.customSystemPrompt,
        appearance: args.appearance,
        defaultSuggestions: args.defaultSuggestions,
        vapiSettings: args.vapiSettings,
      });
    } else {
      // ➕ INSERT (exactly like reference)
      await ctx.db.insert("widgetSettings", {
        organizationId: orgId,
        chatbotName: args.chatbotName,
        greetMessage: args.greetMessage,
        customSystemPrompt: args.customSystemPrompt,
        appearance: args.appearance,
        defaultSuggestions: args.defaultSuggestions,
        vapiSettings: args.vapiSettings,
      });
    }
  },
});

export const getOne = query({
  args: {
    organizationId: v.string(),
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
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", orgId),
      )
      .unique();
  },
});
