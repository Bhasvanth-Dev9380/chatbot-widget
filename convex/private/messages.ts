import { action, mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { paginationOptsValidator } from "convex/server";
import { saveMessage } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { OPERATOR_MESSAGE_ENHANCEMENT_PROMPT } from "../system/ai/constants";

/* -------------------------------------------------
   ENHANCE RESPONSE
------------------------------------------------- */
export const enhanceResponse = action({
  args: {
    prompt: v.string(),
    organizationId: v.string(), // passed from BetterAuth
  },
  handler: async (_ctx, args) => {
    const response = await generateText({
      model: openai("gpt-4o-mini") as any,
      messages: [
        {
          role: "system",
          content: OPERATOR_MESSAGE_ENHANCEMENT_PROMPT,
        },
        {
          role: "user",
          content: args.prompt,
        },
      ],
    });

    return response.text;
  },
});

/* -------------------------------------------------
   CREATE OPERATOR MESSAGE
------------------------------------------------- */
export const create = mutation({
  args: {
    prompt: v.string(),
    conversationId: v.id("conversations"),
    organizationId: v.string(), // BetterAuth → Convex user
    agentName: v.string(),      // operator display name
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    if (conversation.status === "resolved") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Conversation resolved",
      });
    }

    // Auto-escalate unresolved → escalated
    if (conversation.status === "unresolved") {
      await ctx.db.patch(args.conversationId, {
        status: "escalated",
      });
    }

    await saveMessage(ctx, components.agent, {
      threadId: conversation.threadId,
      agentName: args.agentName,
      message: {
        role: "assistant",
        content: args.prompt,
      },
    });
  },
});

/* -------------------------------------------------
   GET OPERATOR MESSAGES
------------------------------------------------- */
export const getMany = query({
  args: {
    threadId: v.string(),
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
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

    if (conversation.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    return supportAgent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
  },
});
