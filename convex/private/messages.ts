import { action, mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { paginationOptsValidator } from "convex/server";
import { saveMessage } from "@convex-dev/agent";
import { api, components, internal } from "../_generated/api";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { OPERATOR_MESSAGE_ENHANCEMENT_PROMPT } from "../system/ai/constants";

/* -------------------------------------------------
   ENHANCE RESPONSE
------------------------------------------------- */
export const enhanceResponse = action({
  args: {
    prompt: v.string(),
    entityId: v.string(), // passed from BetterAuth
  },
  handler: async (ctx, args) => {
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

    const usage = (response as any)?.usage;
    const totalTokens =
      typeof usage?.totalTokens === "number"
        ? usage.totalTokens
        : Math.ceil(String(response?.text ?? "").length / 4);

    if (totalTokens > 0) {
      await ctx.runMutation((internal as any).system.tokenUsage.record, {
        entityId: args.entityId,
        provider: "openai",
        model: "gpt-4o-mini",
        kind: "operator_enhance",
        promptTokens:
          typeof usage?.promptTokens === "number" ? usage.promptTokens : undefined,
        completionTokens:
          typeof usage?.completionTokens === "number"
            ? usage.completionTokens
            : undefined,
        totalTokens,
      });
    }

    return response.text;
  },
});

/* -------------------------------------------------
  CREATE OPERATOR MESSAGE
------------------------------------------------- */
export const saveOperatorMessageInternal = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    agentName: v.string(),
  },
  handler: async (ctx, args) => {
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      agentName: args.agentName,
      message: {
        role: "assistant",
        content: args.prompt,
      },
    });
  },
});

export const create = action({
  args: {
    prompt: v.string(),
    conversationId: v.id("conversations"),
    entityId: v.string(), // BetterAuth → Convex user
    agentName: v.string(),      // operator display name
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.runQuery(api.private.conversations.getOne, {
      conversationId: args.conversationId,
      entityId: args.entityId,
    });

    if (conversation.status === "resolved") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Conversation resolved",
      });
    }

    if (conversation.status === "unresolved") {
      await ctx.runAction(internal.system.conversations.escalate, {
        threadId: conversation.threadId,
      });
    }

    await ctx.runMutation(api.private.messages.saveOperatorMessageInternal, {
      threadId: conversation.threadId,
      agentName: args.agentName,
      prompt: args.prompt,
    });

    try {
      if (conversation.caseId) {
        await ctx.runAction(api.private.salesforce.addInternalCaseComment, {
          entityId: args.entityId,
          caseNumberOrId: conversation.caseId,
          commentBody: `${`Agent (${args.agentName}):`} ${String(args.prompt ?? "")}`.trim(),
        });
      }
    } catch (error) {
      console.error(
        "[private.messages.create] Failed to post Salesforce internal case comment",
        error,
      );
    }
  },
});

/* -------------------------------------------------
   GET OPERATOR MESSAGES
------------------------------------------------- */
export const getMany = query({
  args: {
    threadId: v.string(),
    entityId: v.string(),
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

    if (conversation.entityId !== args.entityId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Entity ID",
      });
    }

    return supportAgent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
  },
});
