import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { api, internal } from "../_generated/api";

export const setEscalated = internalMutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    await ctx.db.patch(conversation._id, { status: "escalated" });
  },
});

export const escalate = internalAction({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.runQuery(internal.system.conversations.getByThreadId, {
      threadId: args.threadId,
    });

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.caseId) {
      try {
        await ctx.runAction(api.private.salesforce.escalateCaseByNumber, {
          organizationId: conversation.organizationId,
          caseNumber: conversation.caseId,
        });
      } catch (error) {
        console.error("[conversations.escalate] Failed to escalate Salesforce case", error);
      }
    }

    await ctx.runMutation(internal.system.conversations.setEscalated, {
      threadId: args.threadId,
    });

    try {
      await ctx.runAction(api.private.salesforce.sendWebhookEvent, {
        organizationId: conversation.organizationId,
        event: "case.escalated",
        conversationId: String(conversation._id),
        threadId: conversation.threadId,
        caseId: conversation.caseId ?? undefined,
      });
    } catch (error) {
      console.error("[conversations.escalate] Failed to send webhook", error);
    }
  },
});

export const setResolved = internalMutation({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    await ctx.db.patch(conversation._id, { status: "resolved" });
  },
});

export const resolve = internalAction({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.runQuery(internal.system.conversations.getByThreadId, {
      threadId: args.threadId,
    });

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.caseId) {
      try {
        await ctx.runAction(api.private.salesforce.closeCaseByNumber, {
          organizationId: conversation.organizationId,
          caseNumber: conversation.caseId,
        });
      } catch (error) {
        console.error("[conversations.resolve] Failed to close Salesforce case", error);
      }
    }

    await ctx.runMutation(internal.system.conversations.setResolved, {
      threadId: args.threadId,
    });

    try {
      await ctx.runAction(api.private.salesforce.sendWebhookEvent, {
        organizationId: conversation.organizationId,
        event: "case.resolved",
        conversationId: String(conversation._id),
        threadId: conversation.threadId,
        caseId: conversation.caseId ?? undefined,
      });
    } catch (error) {
      console.error("[conversations.resolve] Failed to send webhook", error);
    }
  },
});
export const getByThreadId = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db
      .query("conversations")
      .withIndex("by_thread_id", (q) => q.eq("threadId", args.threadId))
      .unique();

    return conversation;
  },
});

export const markTranscriptReady = internalMutation({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      return;
    }

    if (conversation.isTranscriptPending !== true) {
      return;
    }

    await ctx.db.patch(args.conversationId, {
      isTranscriptPending: false,
    });
  },
});
