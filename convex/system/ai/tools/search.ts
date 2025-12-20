import { openai } from '@ai-sdk/openai';
import { createTool } from "@convex-dev/agent";
import { generateText } from "ai";
import z from "zod";
import { internal } from "../../../_generated/api";
import rag from "../rag";
import { SEARCH_INTERPRETER_PROMPT } from "../constants";

export const search: any = createTool({
  description: "Search the knowledge base for relevant information to help answer user questions",
  args: z.object({
    query: z
      .string()
      .describe("The search query to find relevant information")
  }),
  handler: async (ctx: any, args: { query: string }): Promise<string> => {
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

    const deletedStorageIds: unknown[] = await ctx.runQuery(
      (internal as any).system.deletedFiles.listByOrganizationId,
      { organizationId: orgId },
    );
    const deletedStorageIdSet: Set<string> = new Set(
      deletedStorageIds.map((id) => String(id)),
    );

    const rawQuery = typeof args.query === "string" ? args.query : "";
    const query = rawQuery.trim();
    if (!query) {
      return "I don't have info on that. Want me to connect you with our team?";
    }

    const STOPWORDS = new Set([
      "a",
      "an",
      "and",
      "are",
      "as",
      "at",
      "be",
      "but",
      "by",
      "for",
      "from",
      "how",
      "i",
      "in",
      "is",
      "it",
      "of",
      "on",
      "or",
      "that",
      "the",
      "this",
      "to",
      "what",
      "when",
      "where",
      "who",
      "why",
      "with",
      "you",
      "your",
    ]);

    const toKeywords = (q: string) =>
      q
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

    const keywordOverlapOk = (q: string, text: string) => {
      const keywords = toKeywords(q);
      if (keywords.length === 0) return true;
      const haystack = text.toLowerCase();
      let hits = 0;
      for (const k of keywords) {
        if (haystack.includes(k)) hits++;
      }
      const requiredHits = keywords.length <= 2 ? 1 : 2;
      return hits >= requiredHits;
    };

    const runSearch = async (vectorScoreThreshold: number) => {
      const res: any = await rag.search(ctx, {
        namespace: namespace,
        query,
        limit: 20,
        vectorScoreThreshold,
      });

      const entries: any[] | undefined = (res as any).entries;
      const filteredEntries: any[] | undefined =
        entries && deletedStorageIdSet.size > 0
          ? entries.filter((e) => {
              const storageId = (e?.metadata as any)?.storageId;
              if (!storageId) return true;
              return !deletedStorageIdSet.has(String(storageId));
            })
          : entries;

      const contextText: string =
        filteredEntries && Array.isArray(filteredEntries)
          ? filteredEntries
              .map((e) => {
                const text = typeof e?.text === "string" ? e.text : "";
                if (!text.trim()) return null;
                return e?.title ? `## ${e.title}:\n${text}` : text;
              })
              .filter(Boolean)
              .join("\n\n---\n\n")
          : deletedStorageIdSet.size > 0
            ? ""
            : res.text;

      return { res, contextText };
    };

    // Pass 1: strict threshold (avoid irrelevant matches)
    let { contextText: filteredContextText } = await runSearch(0.5);

    // Pass 2: more lenient for paraphrases / short queries
    if (!filteredContextText || !filteredContextText.trim()) {
      ({ contextText: filteredContextText } = await runSearch(0.35));
    }

    // Final gating: require at least some keyword overlap to reduce random matches
    if (!filteredContextText || !filteredContextText.trim()) {
      return "I don't have info on that. Want me to connect you with our team?";
    }
    if (!keywordOverlapOk(query, filteredContextText)) {
      return "I don't have info on that. Want me to connect you with our team?";
    }

    const contextText: string = `Search results for "${query}":

${filteredContextText}

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

    const response: any = await generateText({
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
