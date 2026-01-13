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
    try {
      if (!ctx.threadId) {
        return "Missing thread ID";
      }

      const safeRunQuery = async <T>(fn: any, a: any): Promise<T | null> => {
        try {
          if (!fn) return null;
          return (await ctx.runQuery(fn, a)) as T;
        } catch (error) {
          console.error("[search tool] runQuery failed", error);
          return null;
        }
      };

      const safeRunMutation = async (fn: any, a: any): Promise<void> => {
        try {
          if (!fn) return;
          await ctx.runMutation(fn, a);
        } catch (error) {
          console.error("[search tool] runMutation failed", error);
        }
      };

      const conversation = await safeRunQuery<any>(
        internal.system.conversations.getByThreadId,
        { threadId: ctx.threadId },
      );

      if (!conversation) {
        return "Conversation not found";
      }

      const orgId = conversation.entityId;

    // Determine which namespace to use based on chatbot's knowledge base
    let namespace: string = orgId; // Default fallback

    if (conversation.chatbotId) {
      const chatbot = await safeRunQuery<any>(internal.system.chatbots.getById, {
        id: conversation.chatbotId,
      });

      if (chatbot?.knowledgeBaseId) {
        const knowledgeBase = await safeRunQuery<any>(internal.system.knowledgeBases.getById, {
          id: chatbot.knowledgeBaseId,
        });

        if (knowledgeBase?.ragNamespace) {
          namespace = knowledgeBase.ragNamespace;
        }
      }
    }

    const deletedStorageIds: unknown[] =
      (await safeRunQuery<unknown[]>(
        (internal as any).system?.deletedFiles?.listByEntityId,
        { entityId: orgId },
      )) ?? [];
    const deletedStorageIdSet: Set<string> = new Set(
      deletedStorageIds.map((id) => String(id)),
    );

    const rawQuery = typeof args.query === "string" ? args.query : "";
    const query = rawQuery.trim();
    if (!query) {
      return "I don't have info on that. Want me to connect you with our team?";
    }

    const estimatedEmbeddingTokens = Math.ceil(query.length / 4);
    if (estimatedEmbeddingTokens > 0) {
      await safeRunMutation((internal as any).system?.tokenUsage?.record, {
        entityId: orgId,
        provider: "openai",
        model: "text-embedding-3-small",
        kind: "rag_search_query_embedding",
        totalTokens: estimatedEmbeddingTokens,
      });
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
      let res: any;
      try {
        res = await rag.search(ctx, {
          namespace: namespace,
          query,
          limit: 20,
          vectorScoreThreshold,
        });
      } catch (error) {
        console.error("[search tool] rag.search failed", error);
        return { res: null, contextText: "" };
      }

      // Estimated vector read usage: rough approximation.
      // We assume up to `limit` embedding vectors are accessed.
      await safeRunMutation((internal as any).system?.convexUsageEstimated?.record, {
        entityId: orgId,
        vectorBytes: 20 * 1536 * 4,
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

    let response: any;
    try {
      response = await generateText({
        messages: [
          {
            role: "system",
            content: SEARCH_INTERPRETER_PROMPT,
          },
          {
            role: "user",
            content: `User asked: "${args.query}"\n\n${contextText}`,
          },
        ],
        model: openai("gpt-4o-mini") as any,
      });
    } catch (error) {
      console.error("[search tool] LLM call failed", error);
      return "I’m having trouble searching the knowledge base right now. Want me to connect you with our team?";
    }

    const usage = (response as any)?.usage;
    const totalTokens =
      typeof usage?.totalTokens === "number"
        ? usage.totalTokens
        : Math.ceil(String(response?.text ?? "").length / 4);

    if (totalTokens > 0) {
      await safeRunMutation((internal as any).system?.tokenUsage?.record, {
        entityId: orgId,
        provider: "openai",
        model: "gpt-4o-mini",
        kind: "kb_search_interpreter",
        promptTokens:
          typeof usage?.promptTokens === "number" ? usage.promptTokens : undefined,
        completionTokens:
          typeof usage?.completionTokens === "number"
            ? usage.completionTokens
            : undefined,
        totalTokens,
      });
    }

    // DO NOT call saveMessage here - agent handles saving in v0.3.2
    // Just return the result
    return response.text;
    } catch (error) {
      console.error("[search tool] Unexpected failure", error);
      return "I’m having trouble searching the knowledge base right now. Want me to connect you with our team?";
    }
  },
});
