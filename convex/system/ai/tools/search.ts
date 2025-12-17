import { openai } from '@ai-sdk/openai';
import { createTool } from "@convex-dev/agent";
import { generateText } from "ai";
import z from "zod";
import { internal } from "../../../_generated/api";
import rag from "../rag";
import { SEARCH_INTERPRETER_PROMPT } from "../constants";

export const search = createTool({
  description: "Search the knowledge base for relevant information to help answer user questions",
  args: z.object({
    query: z
      .string()
      .describe("The search query to find relevant information")
  }),
  handler: async (ctx, args) => {
    if (!ctx.threadId) {
      return "Missing thread ID";
    }

    const conversation = await ctx.runQuery(
      internal.system.conversations.getByThreadId,
      { threadId: ctx.threadId },
    );

    if (!conversation) {
      return "Conversation not found";
    }

    const orgId = conversation.organizationId;

    // Determine which namespace to use based on chatbot's knowledge base
    let namespace: string = orgId; // Default fallback

    if (conversation.chatbotId) {
      const chatbot = await ctx.runQuery(internal.system.chatbots.getById, {
        id: conversation.chatbotId,
      });

      if (chatbot?.knowledgeBaseId) {
        const knowledgeBase = await ctx.runQuery(internal.system.knowledgeBases.getById, {
          id: chatbot.knowledgeBaseId,
        });

        if (knowledgeBase?.ragNamespace) {
          namespace = knowledgeBase.ragNamespace;
        }
      }
    }

    const searchResult = await rag.search(ctx, {
      namespace: namespace,
      query: args.query,
      limit: 50,
    });

    const contextText = `Search results for "${args.query}":

${searchResult.text}

CRITICAL INSTRUCTION: You MUST respond in 2-3 sentences maximum.

Do NOT:
- Ask which document they want
- List document names
- Say "I found information in multiple documents"
- Copy chunks verbatim

DO:
- Give the most relevant answer directly
- Combine info from multiple sources if needed
- Keep it under 3 sentences
- Sound human and helpful

If the answer genuinely isn't in the search results, say: "I don't have info on that. Want me to connect you with our team?"`;

    const response = await generateText({
      messages: [
        {
          role: "system",
          content: SEARCH_INTERPRETER_PROMPT,
        },
        {
          role: "user",
          content: `User asked: "${args.query}"\n\n${contextText}`,
        }
      ],
      model: openai("gpt-4o-mini") as any,
    });

    // DO NOT call saveMessage here - agent handles saving in v0.3.2
    // Just return the result
    return response.text;
  },
});
