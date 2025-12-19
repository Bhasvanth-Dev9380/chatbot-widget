import { v, ConvexError } from "convex/values";
import { query } from "../_generated/server";

/* -------------------------------------------------
   GET VOICE TRANSCRIPTS BY CONVERSATION
------------------------------------------------- */
export const getByConversation = query({
  args: {
    conversationId: v.id("conversations"),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get the conversation to find the contactSessionId
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return [];
    }

    // Validate organization access
    if (conversation.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
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
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("voiceTranscripts")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .order("desc")
      .collect();
  },
});
