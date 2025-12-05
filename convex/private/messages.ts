import { action, mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { paginationOptsValidator } from "convex/server";
import { saveMessage } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { OPERATOR_MESSAGE_ENHANCEMENT_PROMPT } from "../system/ai/constants";

export const enhanceResponse = action({
  args: {
    prompt: v.string(),
    // ✅ pass orgId from the client (BetterAuth → Convex user), same pattern as `create`
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    // At this point we just trust organizationId came from the client.
    // If you ever want to enforce anything, you can look up a user/org here
    // using args.organizationId, similar to conversations.getMany.

    const response = await generateText({
      model: openai("gpt-4o-mini"),
      messages: [
        {
          role: "system",
          content:OPERATOR_MESSAGE_ENHANCEMENT_PROMPT,
            
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


export const create = mutation({
  args: {
    prompt: v.string(),
    conversationId: v.id("conversations"),
    organizationId: v.string(),  // 👈 passed from client (Convex user orgId)
    agentName: v.string(),       // 👈 operator name from BetterAuth session
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    // Ensure this conversation belongs to the given organization
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


     // ✅ NEW: auto-escalate when operator replies to an unresolved conversation
    if (conversation.status === "unresolved") {
      await ctx.db.patch(args.conversationId, {
        status: "escalated",
      });
    }


    // 💬 Save operator message into the thread
    await saveMessage(ctx, components.agent, {
      threadId: conversation.threadId, // ideally Id<"threads">
      agentName: args.agentName,
      message: {
        role: "assistant",
        content: args.prompt,
      },
    });
  },
});

export const getMany = query({
  args: {
    // Ideally this is v.id("threads"). If your schema still uses string,
    // update conversations.threadId to v.id("threads") to match the agent.
    threadId: v.string(),
    organizationId: v.string(),        // 👈 same orgId as above
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Find the conversation for this thread
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

    const paginated = await supportAgent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    return paginated;
  },
});
