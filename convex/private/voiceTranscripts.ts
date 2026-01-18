import { v, ConvexError } from "convex/values";
import { query } from "../_generated/server";

/* -------------------------------------------------
   GET VOICE TRANSCRIPTS BY CONVERSATION
------------------------------------------------- */
export const getByConversation = query({
  args: {
    conversationId: v.id("conversations"),
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get the conversation to find the contactSessionId
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return [];
    }

    // Validate organization access
    if (conversation.entityId !== args.entityId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Entity ID",
      });
    }

    // First try to find by conversationId
    const transcriptsByConversation = await ctx.db
      .query("voiceTranscripts")
      .withIndex("by_conversation_id", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("desc")
      .collect();

    if (transcriptsByConversation.length > 0) {
      return transcriptsByConversation;
    }

    // Fall back to finding by contactSessionId
    if (conversation.contactSessionId) {
      return await ctx.db
        .query("voiceTranscripts")
        .withIndex("by_contact_session_id", (q) =>
          q.eq("contactSessionId", conversation.contactSessionId)
        )
        .order("desc")
        .collect();
    }

    return [];
  },
});

/* -------------------------------------------------
   GET VOICE TRANSCRIPTS BY ORGANIZATION
------------------------------------------------- */
export const getByOrganization = query({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("voiceTranscripts")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId)
      )
      .order("desc")
      .collect();
  },
});
