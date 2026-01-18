import { v } from "convex/values";
import { query } from "../_generated/server";

/**
 * Get the default chatbot for an organization
 * Used as fallback when no chatbotId is specified in widget URL
 */
export const getDefaultByEntityId = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const defaultChatbot = await ctx.db
      .query("chatbots")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId)
      )
      .filter((q) => q.eq(q.field("isDefault"), true))
      .first();

    return defaultChatbot;
  },
});
