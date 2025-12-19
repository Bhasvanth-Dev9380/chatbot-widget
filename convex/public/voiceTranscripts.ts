import { v, ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";

/* -------------------------------------------------
   SAVE VOICE TRANSCRIPT (called when call ends)
------------------------------------------------- */
export const save = mutation({
  args: {
    contactSessionId: v.id("contactSessions"),
    chatbotId: v.optional(v.string()), // This is the chatbotId string, not Id<"chatbots">
    callId: v.optional(v.string()),
    transcript: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        text: v.string(),
        timestamp: v.optional(v.number()),
      })
    ),
    duration: v.optional(v.number()),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Validate session
    const contactSession = await ctx.db.get(args.contactSessionId);

    if (!contactSession || contactSession.expiresAt < Date.now()) {
      throw new ConvexError("Invalid session");
    }

    const organizationId = contactSession.organizationId;

    // Find the conversation for this contact session (if exists)
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_contact_session_id", (q) =>
        q.eq("contactSessionId", args.contactSessionId)
      )
      .first();

    // Look up the chatbot by chatbotId string to get the actual Id<"chatbots">
    let chatbotDocId = undefined;
    if (args.chatbotId) {
      const chatbot = await ctx.db
        .query("chatbots")
        .withIndex("by_chatbot_id", (q) => q.eq("chatbotId", args.chatbotId))
        .first();
      chatbotDocId = chatbot?._id;
    }

    // Save the voice transcript
    const transcriptId = await ctx.db.insert("voiceTranscripts", {
      organizationId,
      conversationId: conversation?._id,
      contactSessionId: args.contactSessionId,
      chatbotId: chatbotDocId,
      callId: args.callId,
      transcript: args.transcript,
      duration: args.duration,
      startedAt: args.startedAt,
      endedAt: Date.now(),
    });

    return transcriptId;
  },
});

/* -------------------------------------------------
   GET VOICE TRANSCRIPTS BY CONTACT SESSION
------------------------------------------------- */
export const getByContactSession = query({
  args: {
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.contactSessionId);

    if (!session || session.expiresAt < Date.now()) {
      throw new ConvexError("Invalid session");
    }

    return await ctx.db
      .query("voiceTranscripts")
      .withIndex("by_contact_session_id", (q) =>
        q.eq("contactSessionId", args.contactSessionId)
      )
      .order("desc")
      .collect();
  },
});
