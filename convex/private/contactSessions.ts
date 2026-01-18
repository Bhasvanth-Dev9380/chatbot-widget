import { ConvexError, v } from "convex/values";
import { query } from "../_generated/server";

export const getOneByConversationId = query({
  args: {
    conversationId: v.id("conversations"),
    entityId: v.string(), // 👈 now required
  },
  handler: async (ctx, args) => {
    const { conversationId, entityId } = args;

    if (!entityId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Organization not provided",
      });
    }

    const conversation = await ctx.db.get(conversationId);

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.entityId !== entityId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Entity ID",
      });
    }

    const contactSession = await ctx.db.get(conversation.contactSessionId);

    if (!contactSession) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contact session not found",
      });
    }

    return contactSession;
  },
});
