import { v, ConvexError } from "convex/values";
import { action, query } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { paginationOptsValidator } from "convex/server";
import { saveMessage } from "@convex-dev/agent";
import { search } from "../system/ai/tools/search";
import { resolveConversation } from "../system/ai/tools/resolveConversation";
import { escalateConversation } from "../system/ai/tools/escalateConversation";
import { createCustomAgentPrompt } from "../system/ai/constants";

/* -------------------------------------------------
   CREATE MESSAGE (WIDGET → AGENT)
------------------------------------------------- */
export const create = action({
  args: {
    prompt: v.string(),
    threadId: v.string(),
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    // ✅ Validate contact session
    const contactSession = await ctx.runQuery(
      internal.system.contactSessions.getOne,
      { contactSessionId: args.contactSessionId },
    );

    if (!contactSession || contactSession.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid session",
      });
    }

    // ✅ Fetch conversation by thread
    const conversation = await ctx.runQuery(
      internal.system.conversations.getByThreadId,
      { threadId: args.threadId },
    );

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.status === "resolved") {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Conversation resolved",
      });
    }

    // 🔄 Refresh session (reference behavior)
    await ctx.runMutation(internal.system.contactSessions.refresh, {
      contactSessionId: args.contactSessionId,
    });

    // Fetch chatbot settings or fallback to widget settings for custom prompt
    let customPrompt: string | null = null;

    if (conversation.chatbotId) {
      const chatbot = await ctx.runQuery(internal.system.chatbots.getById, {
        id: conversation.chatbotId,
      });
      customPrompt = chatbot?.customSystemPrompt ?? null;
    } else {
      // Fallback to widget settings for backward compatibility
      const widgetSettings = await ctx.runQuery(
        internal.system.widgetSettings.getByOrganizationId,
        { organizationId: conversation.organizationId }
      );
      customPrompt = widgetSettings?.customSystemPrompt ?? null;
    }

    const shouldTriggerAgent = conversation.status === "unresolved";

    if (shouldTriggerAgent) {
      try {
        if (customPrompt) {
          // Create a temporary agent with custom instructions merged with core template
          const { Agent } = await import("@convex-dev/agent");
          const { openai } = await import("@ai-sdk/openai");

          const customAgent = new Agent(components.agent, {
            name: "customSupportAgent",
            languageModel: openai.chat('gpt-4o-mini'),
            instructions: createCustomAgentPrompt(customPrompt),
            tools: {
              search,
              resolveConversation,
              escalateConversation,
            }
          });

          await customAgent.generateText(
            ctx,
            { threadId: args.threadId },
            { prompt: args.prompt }
          );
        } else {
          // Use default agent
          await supportAgent.generateText(
            ctx,
            { threadId: args.threadId },
            { prompt: args.prompt }
          );
        }
      } catch (error: any) {
        // Handle corrupted thread state (tool_calls without responses)
        if (error?.message?.includes("tool_calls") || error?.message?.includes("tool_call_id")) {
          console.error("Thread has corrupted tool state:", error.message);
          // Save user message and a fallback assistant response
          await saveMessage(ctx, components.agent, {
            threadId: args.threadId,
            prompt: args.prompt,
          });
          // Don't throw - just log. User message is saved, AI won't respond for this corrupted thread
          return;
        }
        throw error;
      }
    } else {
      // 💬 Fallback: just save message
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        prompt: args.prompt,
      });
    }
  },
});

/* -------------------------------------------------
   GET MANY MESSAGES
------------------------------------------------- */
export const getMany = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const contactSession = await ctx.db.get(args.contactSessionId);

    if (!contactSession || contactSession.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid or expired session",
      });
    }

    return await supportAgent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
  },
});
