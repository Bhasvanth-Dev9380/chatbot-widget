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
/* -------------------------------------------------
   CREATE FROM TRANSCRIPT (VAPI -> AGENT)
------------------------------------------------- */
export const createFromTranscript = action({
  args: {
    threadId: v.string(),
    contactSessionId: v.id("contactSessions"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    // 🔒 Validate session
    const contactSession = await ctx.runQuery(
      internal.system.contactSessions.getOne,
      { contactSessionId: args.contactSessionId }
    );

    if (!contactSession || contactSession.expiresAt < Date.now()) {
      throw new ConvexError("Invalid session");
    }

    const conversation = await ctx.runQuery(
      internal.system.conversations.getByThreadId,
      { threadId: args.threadId }
    );

    if (!conversation) {
      throw new ConvexError("Conversation not found");
    }

    if (conversation.contactSessionId !== args.contactSessionId) {
      throw new ConvexError("Incorrect session");
    }

    // 🔄 Refresh session
    await ctx.runMutation(internal.system.contactSessions.refresh, {
      contactSessionId: args.contactSessionId,
    });

    // 💬 Save transcript message
    await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      message: {
        role: args.role,
        content: args.text,
      },
    });

    // ✅ If this is a transcript conversation, make it visible once transcript starts.
    const text = String(args.text ?? "");
    if (text.startsWith("[Voice]") || text.startsWith("[Video]")) {
      if (conversation.isTranscriptPending === true) {
        await ctx.runMutation(internal.system.conversations.markTranscriptReady, {
          conversationId: conversation._id,
        });
      }
    }
  },
});

export const create = action({
  args: {
    prompt: v.string(),
    threadId: v.string(),
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    // 🔒 Validate session
    const contactSession = await ctx.runQuery(
      internal.system.contactSessions.getOne,
      { contactSessionId: args.contactSessionId }
    );

    if (!contactSession || contactSession.expiresAt < Date.now()) {
      throw new ConvexError("Invalid session");
    }

    const conversation = await ctx.runQuery(
      internal.system.conversations.getByThreadId,
      { threadId: args.threadId }
    );

    if (!conversation) {
      throw new ConvexError("Conversation not found");
    }

    if (conversation.contactSessionId !== args.contactSessionId) {
      throw new ConvexError("Incorrect session");
    }

    if (conversation.status !== "unresolved") {
  // Save user message but DO NOT run the agent
  await saveMessage(ctx, components.agent, {
    threadId: args.threadId,
    message: {
      role: "user",
      content: args.prompt,
    },
  });

  // Stop here. No agent, no tools, no fallback AI.
  return;
}


    

    // 🔄 Refresh session
    await ctx.runMutation(internal.system.contactSessions.refresh, {
      contactSessionId: args.contactSessionId,
    });

    // 🧠 Resolve custom prompt
    let customPrompt: string | null = null;

    if (conversation.chatbotId) {
      const chatbot = await ctx.runQuery(
        internal.system.chatbots.getById,
        { id: conversation.chatbotId }
      );
      customPrompt = chatbot?.customSystemPrompt ?? null;
    } else {
      const widgetSettings = await ctx.runQuery(
        internal.system.widgetSettings.getByOrganizationId,
        { organizationId: conversation.organizationId }
      );
      customPrompt = widgetSettings?.customSystemPrompt ?? null;
    }

    try {
      console.log("🚀 Starting agent generateText for threadId:", args.threadId);
      console.log("📝 User prompt:", args.prompt);

      if (customPrompt) {
        const { Agent } = await import("@convex-dev/agent");
        const { openai } = await import("@ai-sdk/openai");

        const agent = new Agent(components.agent, {
          name: "customSupportAgent",
          languageModel: openai.chat("gpt-4o-mini"),
          instructions: createCustomAgentPrompt(customPrompt),
          tools: {
            search,
            resolveConversation,
            escalateConversation,
          },
        });

        console.log("🤖 Using custom agent");
        const result = await agent.generateText(
          ctx,
          { threadId: args.threadId },
          { prompt: args.prompt }
        );

        {
          const usage = (result as any)?.usage;
          const totalTokens =
            typeof usage?.totalTokens === "number"
              ? usage.totalTokens
              : Math.ceil(String(args.prompt ?? "").length / 4);

          if (totalTokens > 0) {
            await ctx.runMutation((internal as any).system.tokenUsage.record, {
              organizationId: conversation.organizationId,
              provider: "openai",
              model: "gpt-4o-mini",
              kind: "agent_generate",
              promptTokens:
                typeof usage?.promptTokens === "number"
                  ? usage.promptTokens
                  : undefined,
              completionTokens:
                typeof usage?.completionTokens === "number"
                  ? usage.completionTokens
                  : undefined,
              totalTokens,
            });
          }
        }
        console.log("✅ Custom agent completed. Result:", JSON.stringify(result, null, 2));

        // Check if agent ended with tool calls instead of text
        const lastStep = result.steps[result.steps.length - 1];
        if (lastStep.finishReason === "tool-calls") {
          console.warn("⚠️ Custom agent stopped at tool-calls without generating text response!");

          // Extract tool result to send as the response
          const toolResult = lastStep.content.find((c: any) => c.type === "tool-result") as any;
          if (toolResult && toolResult.output) {
            console.log("💡 Saving tool result as assistant message:", toolResult.output);
            await saveMessage(ctx, components.agent, {
              threadId: args.threadId,
              message: {
                role: "assistant",
                content: String(toolResult.output),
              },
            });
          } else {
            console.error("❌ No tool result found to save for custom agent");
          }
        }
      } else {
        console.log("🤖 Using support agent");
        const result = await supportAgent.generateText(
          ctx,
          { threadId: args.threadId },
          { prompt: args.prompt }
        );

        {
          const usage = (result as any)?.usage;
          const totalTokens =
            typeof usage?.totalTokens === "number"
              ? usage.totalTokens
              : Math.ceil(String(args.prompt ?? "").length / 4);

          if (totalTokens > 0) {
            await ctx.runMutation((internal as any).system.tokenUsage.record, {
              organizationId: conversation.organizationId,
              provider: "openai",
              model: "gpt-4o-mini",
              kind: "agent_generate",
              promptTokens:
                typeof usage?.promptTokens === "number"
                  ? usage.promptTokens
                  : undefined,
              completionTokens:
                typeof usage?.completionTokens === "number"
                  ? usage.completionTokens
                  : undefined,
              totalTokens,
            });
          }
        }
        console.log("✅ Support agent completed. Result:", JSON.stringify(result, null, 2));

        // Check if agent ended with tool calls instead of text
        const lastStep = result.steps[result.steps.length - 1];
        if (lastStep.finishReason === "tool-calls") {
          console.warn("⚠️ Agent stopped at tool-calls without generating text response!");

          // Extract tool result to send as the response
          const toolResult = lastStep.content.find((c: any) => c.type === "tool-result") as any;
          if (toolResult && toolResult.output) {
            console.log("💡 Saving tool result as assistant message:", toolResult.output);
            await saveMessage(ctx, components.agent, {
              threadId: args.threadId,
              message: {
                role: "assistant",
                content: String(toolResult.output),
              },
            });
          } else {
            console.error("❌ No tool result found to save");
          }
        }
      }

      // Check what messages were actually saved
      const messagesAfter = await supportAgent.listMessages(ctx, {
        threadId: args.threadId,
        paginationOpts: { numItems: 5, cursor: null },
      });
      console.log("📨 Latest messages after agent run:");
      messagesAfter.page.slice(0, 3).forEach((msg: any, idx: number) => {
        console.log(`  [${idx}] Role: ${msg.role}, Content:`, msg.content);
      });
    } catch (error: any) {
      // 🚨 HARD TOOL CORRUPTION HANDLING (FINAL FIX)
      console.error("Agent failure:", error?.message);

      // Save user message so chat history stays correct
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "user",
          content: args.prompt,
        },
      });

      // Save fallback assistant response (CRITICAL)
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "assistant",
          content:
            "Sorry — something went wrong on my side. Please try again.",
        },
      });

      return;
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
    const session = await ctx.db.get(args.contactSessionId);

    if (!session || session.expiresAt < Date.now()) {
      throw new ConvexError("Invalid session");
    }

    const conversation = await ctx.runQuery(
      internal.system.conversations.getByThreadId,
      { threadId: args.threadId },
    );

    if (!conversation) {
      throw new ConvexError("Conversation not found");
    }

    if (conversation.contactSessionId !== args.contactSessionId) {
      throw new ConvexError("Incorrect session");
    }

    return await supportAgent.listMessages(ctx, {
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });
  },
});
