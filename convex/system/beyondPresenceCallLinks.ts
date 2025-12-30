import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { SESSION_DURATION_MS } from "../constants";
import { generateCaseId } from "../lib/generateCaseId";

export const findLatestUnlinkedConversationForChatbot = internalQuery({
  args: {
    chatbotId: v.id("chatbots"),
    createdAfter: v.number(),
  },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("conversations")
      .withIndex("by_chatbot_id", (q) => q.eq("chatbotId", args.chatbotId))
      .order("desc")
      .take(20);

    for (const c of candidates) {
      if (c._creationTime < args.createdAfter) {
        continue;
      }

      const existing = await ctx.db
        .query("beyondPresenceCallLinks")
        .withIndex("by_conversation_id", (q) => q.eq("conversationId", c._id))
        .unique();

      if (!existing) {
        return { conversationId: c._id, threadId: c.threadId };
      }
    }

    return null;
  },
});

export const findLatestUnlinkedConversationForChatbots = internalQuery({
  args: {
    organizationId: v.string(),
    chatbotIds: v.array(v.id("chatbots")),
    createdAfter: v.number(),
  },
  handler: async (ctx, args) => {
    const chatbotIdSet = new Set(args.chatbotIds.map((id) => String(id)));
    if (chatbotIdSet.size === 0) return null;

    const candidates = await ctx.db
      .query("conversations")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .take(50);

    for (const c of candidates) {
      if (c._creationTime < args.createdAfter) {
        continue;
      }

      if (!c.chatbotId) continue;
      if (!chatbotIdSet.has(String(c.chatbotId))) continue;
      if (c.kind !== "video") continue;
      if (c.isTranscriptPending !== true) continue;

      const existing = await ctx.db
        .query("beyondPresenceCallLinks")
        .withIndex("by_conversation_id", (q) => q.eq("conversationId", c._id))
        .unique();

      if (!existing) {
        return { conversationId: c._id, threadId: c.threadId };
      }
    }

    return null;
  },
});

export const getByCallId = internalQuery({
  args: {
    callId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("beyondPresenceCallLinks")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
  },
});

export const createLink = internalMutation({
  args: {
    callId: v.string(),
    conversationId: v.id("conversations"),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("beyondPresenceCallLinks")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();

    if (existing) {
      return existing;
    }

    await ctx.db.insert("beyondPresenceCallLinks", {
      callId: args.callId,
      conversationId: args.conversationId,
      threadId: args.threadId,
      createdAt: Date.now(),
    });

    return await ctx.db
      .query("beyondPresenceCallLinks")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();
  },
});

export const createConversationAndLink = internalMutation({
  args: {
    callId: v.string(),
    threadId: v.string(),
    organizationId: v.string(),
    chatbotId: v.id("chatbots"),
    userName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("beyondPresenceCallLinks")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();

    if (existing) {
      return {
        conversationId: existing.conversationId,
        threadId: existing.threadId,
        contactSessionId: null as any,
      };
    }

    const contactSessionId = await ctx.db.insert("contactSessions", {
      name: args.userName?.trim() ? args.userName.trim() : "Video Caller",
      email: "",
      organizationId: args.organizationId,
      expiresAt: Date.now() + SESSION_DURATION_MS,
    });

    const conversationId = await ctx.db.insert("conversations", {
      contactSessionId,
      status: "unresolved",
      organizationId: args.organizationId,
      threadId: args.threadId,
      caseId: generateCaseId(),
      chatbotId: args.chatbotId,
      kind: "video",
      isTranscriptPending: true,
    });

    await ctx.db.insert("beyondPresenceCallLinks", {
      callId: args.callId,
      conversationId,
      threadId: args.threadId,
      createdAt: Date.now(),
    });

    return {
      conversationId,
      threadId: args.threadId,
      contactSessionId,
    };
  },
});

export const updateLastProcessedSentAt = internalMutation({
  args: {
    callId: v.string(),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("beyondPresenceCallLinks")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();

    if (!link) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Call link not found",
      });
    }

    if (link.lastProcessedSentAt !== undefined && args.sentAt <= link.lastProcessedSentAt) {
      return;
    }

    await ctx.db.patch(link._id, {
      lastProcessedSentAt: args.sentAt,
    });
  },
});

export const markEnded = internalMutation({
  args: {
    callId: v.string(),
    endedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("beyondPresenceCallLinks")
      .withIndex("by_call_id", (q) => q.eq("callId", args.callId))
      .unique();

    if (!link) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Call link not found",
      });
    }

    await ctx.db.patch(link._id, {
      endedAt: args.endedAt,
    });
  },
});
