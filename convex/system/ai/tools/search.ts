import { openai } from '@ai-sdk/openai';
import { createTool } from "@convex-dev/agent";
import { generateText } from "ai";
import z from "zod";
import { internal } from "../../../_generated/api";
import { api } from "../../../_generated/api";
import rag from "../rag";
import { SEARCH_INTERPRETER_PROMPT } from "../constants";

export const search: any = createTool({
  description: "Search the business's uploaded information to help answer user questions",
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

    // Determine which namespace to use based on the selected chatbot's knowledge base
    // (conversation.chatbotId is often empty for widget flows; selectedChatbotId lives in widget settings)
    let namespace: string = orgId; // Default fallback
    let chatbotName: string | null = null;

    const resolveNamespaceFromChatbotId = async (chatbotDocId: string | null) => {
      if (!chatbotDocId) return;
      const chatbot = await safeRunQuery<any>(internal.system.chatbots.getById, {
        id: chatbotDocId,
      });
      if (typeof chatbot?.name === "string" && chatbot.name.trim()) {
        chatbotName = chatbot.name.trim();
      }
      if (chatbot?.knowledgeBaseId) {
        const knowledgeBase = await safeRunQuery<any>(internal.system.knowledgeBases.getById, {
          id: chatbot.knowledgeBaseId,
        });
        if (knowledgeBase?.ragNamespace) {
          namespace = knowledgeBase.ragNamespace;
        }
      }
    };

    if (conversation.chatbotId) {
      await resolveNamespaceFromChatbotId(conversation.chatbotId);
    } else {
      const widgetSettings = await safeRunQuery<any>((internal as any).system.widgetSettings.getByEntityId, {
        entityId: orgId,
      });
      const selectedChatbotId = typeof widgetSettings?.selectedChatbotId === "string" ? widgetSettings.selectedChatbotId : null;
      await resolveNamespaceFromChatbotId(selectedChatbotId);
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
      return "What would you like to know?";
    }

    const stripLeadingPrefix = (input: string, prefix: string) => {
      const s = input.trim();
      const lower = s.toLowerCase();
      const p = prefix.trim().toLowerCase();
      if (lower === p) return "";
      if (lower.startsWith(p + " ")) return s.slice(prefix.trim().length).trim();
      return s;
    };

    // Users often type the bot name (e.g. "order bot policies").
    // Strip that so retrieval focuses on the actual question.
    let userQuery = query;
    userQuery = stripLeadingPrefix(userQuery, "order bot");
    userQuery = stripLeadingPrefix(userQuery, "orderbot");
    if (chatbotName) {
      userQuery = stripLeadingPrefix(userQuery, chatbotName);
    }
    if (!userQuery) {
      return "What would you like to know?";
    }

    const isGenericFollowup = (s: string) => {
      const q = s.trim().toLowerCase();
      if (!q) return false;
      if (q.includes("timings") || q.includes("hours") || q.includes("open") || q.includes("closing")) return true;
      if (q.includes("polic")) return true;
      if (q === "menu" || q.includes("items available") || q.includes("what items") || q.includes("what do you have")) return true;
      return false;
    };

    const looksScopedAlready = (s: string, name: string) => {
      const q = s.toLowerCase();
      const n = name.toLowerCase();
      return q.includes(n);
    };

    // Keep the user's message as-is, but scope retrieval internally for ambiguous follow-ups.
    const retrievalQuery =
      chatbotName && isGenericFollowup(userQuery) && !looksScopedAlready(userQuery, chatbotName)
        ? `${chatbotName} ${userQuery}`
        : userQuery;

    const normalizedQuery = retrievalQuery
      .replace(/\btimings?\b/gi, "hours")
      .replace(/\bopening\s*hours\b/gi, "hours")
      .replace(/\bopen\s*time\b/gi, "hours")
      .replace(/\bclosing\s*time\b/gi, "hours")
      .replace(/\bclose\b/gi, "hours")
      .replace(/\bclosing\b/gi, "hours")
      .replace(/\bclosed\b/gi, "hours")
      .replace(/\bveg\s+starters\b/gi, "vegetarian starters")
      .replace(/\bveg\b/gi, "vegetarian")
      .replace(/\bstarters\b/gi, "starters appetizers");

    const isMenuAvailabilityQuery = (q: string) => {
      const s = q.trim().toLowerCase();
      return (
        s === "menu" ||
        s.includes("what all items") ||
        s.includes("items available") ||
        s.includes("items do you have") ||
        s.includes("what items") ||
        s.includes("what do you have") ||
        s.includes("show me the menu") ||
        s.includes("menu items") ||
        s.includes("available items")
      );
    };

    let liveMenuLines: string[] = [];
    if (isMenuAvailabilityQuery(userQuery)) {
      try {
        const raw = await ctx.runAction((api as any).private.clover.listItems, {
          entityId: orgId,
          limit: 12,
          debugId: `search-${Date.now()}`,
        });
        const elements: any[] =
          raw && typeof raw === "object" && Array.isArray((raw as any).elements) ? (raw as any).elements : [];
        if (elements.length) {
          liveMenuLines = elements.slice(0, 10).map((item) => {
            const name = typeof item?.name === "string" ? item.name.trim() : "Item";
            const cents = typeof item?.price === "number" ? item.price : Number(item?.price);
            const price = Number.isFinite(cents) && cents > 0 ? `$${(cents / 100).toFixed(2)}` : "";
            return `${name}${price ? ` (${price})` : ""}`;
          });
        }
      } catch (error) {
        console.error("[search tool] live menu lookup failed", error);
      }
    }

    const estimatedEmbeddingTokens = Math.ceil(userQuery.length / 4);
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
      const qLower = q.toLowerCase();
      const isHoursIntent =
        qLower.includes("hours") ||
        qLower.includes("open") ||
        qLower.includes("closing") ||
        qLower.includes("close") ||
        qLower.includes("sunday") ||
        qLower.includes("monday") ||
        qLower.includes("tuesday") ||
        qLower.includes("wednesday") ||
        qLower.includes("thursday") ||
        qLower.includes("friday") ||
        qLower.includes("saturday");
      const isMenuIntent = isMenuAvailabilityQuery(qLower) || qLower.includes("starters") || qLower.includes("beverages");

      const requiredHits = isHoursIntent || isMenuIntent ? 1 : keywords.length <= 2 ? 1 : 2;
      return hits >= requiredHits;
    };

    const normalizedLower = normalizedQuery.toLowerCase();
    const isHoursLike =
      normalizedLower.includes("hours") ||
      normalizedLower.includes("open") ||
      normalizedLower.includes("closing") ||
      normalizedLower.includes("close");
    const isMenuLike =
      isMenuAvailabilityQuery(normalizedLower) ||
      normalizedLower.includes("starters") ||
      normalizedLower.includes("appetizers") ||
      normalizedLower.includes("beverages") ||
      normalizedLower.includes("desserts");
    const isShortQuery = toKeywords(normalizedQuery).length <= 2;

    const namespacesToTry = () => {
      const list: string[] = [];
      const primary = String(namespace ?? "").trim();
      const fallback = String(orgId ?? "").trim();
      if (primary) list.push(primary);
      if (fallback && fallback !== primary) list.push(fallback);
      return list;
    };

    const runSearchOnce = async (ns: string, vectorScoreThreshold: number) => {
      let res: any;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          res = await rag.search(ctx, {
            namespace: ns,
            query: normalizedQuery,
            limit: 20,
            vectorScoreThreshold,
          });
          break;
        } catch (error) {
          if (attempt === 1) {
            console.error("[search tool] rag.search failed", error);
            return { res: null, contextText: "" };
          }
        }
      }

      const rawTextFromRes = typeof (res as any)?.text === "string" ? String((res as any).text) : "";

      // Estimated vector read usage: rough approximation.
      // We assume up to `limit` embedding vectors are accessed.
      await safeRunMutation((internal as any).system?.convexUsageEstimated?.record, {
        entityId: orgId,
        vectorBytes: 20 * 1536 * 4,
      });

      const entries: any[] | undefined = (res as any)?.entries;

      const filteredEntries: any[] | undefined =
        Array.isArray(entries) && deletedStorageIdSet.size > 0
          ? entries.filter((e) => {
              const storageId = (e?.metadata as any)?.storageId;
              if (!storageId) return true;
              return !deletedStorageIdSet.has(String(storageId));
            })
          : Array.isArray(entries)
            ? entries
            : undefined;

      const extractEntryText = (e: any) => {
        if (typeof e?.text === "string") return e.text;
        if (typeof e?.content === "string") return e.content;
        if (typeof e?.pageContent === "string") return e.pageContent;
        if (typeof e?.chunk === "string") return e.chunk;
        if (typeof e?.chunkText === "string") return e.chunkText;
        if (typeof e?.documentText === "string") return e.documentText;
        return "";
      };

      const contextFromEntries: string =
        filteredEntries && Array.isArray(filteredEntries)
          ? filteredEntries
              .map((e) => {
                const text = extractEntryText(e);
                if (!String(text ?? "").trim()) return null;
                return e?.title ? `## ${e.title}:\n${text}` : String(text);
              })
              .filter(Boolean)
              .join("\n\n---\n\n")
          : "";

      const contextText: string = contextFromEntries.trim() ? contextFromEntries : rawTextFromRes;

      console.info("[search tool] rag.search", {
        namespace: ns,
        vectorScoreThreshold,
        entriesCount: Array.isArray(entries) ? entries.length : null,
        contextLen: contextText.length,
      });

      return { res, contextText };
    };

    const runSearch = async (vectorScoreThreshold: number) => {
      for (const ns of namespacesToTry()) {
        const { contextText } = await runSearchOnce(ns, vectorScoreThreshold);
        if (contextText && contextText.trim()) {
          if (ns !== namespace) {
            console.info(`[search tool] namespace fallback hit: primary=${namespace} fallback=${ns}`);
          }
          return { contextText };
        }
      }
      return { contextText: "" };
    };

    // Pass 1: strict threshold (avoid irrelevant matches)
    let { contextText: filteredContextText } = await runSearch(0.5);

    // Pass 2: more lenient for paraphrases / short queries
    if (!filteredContextText || !filteredContextText.trim()) {
      ({ contextText: filteredContextText } = await runSearch(0.35));
    }

    // Pass 3: last chance for short/menu/hours queries
    if ((!filteredContextText || !filteredContextText.trim()) && (isShortQuery || isMenuLike || isHoursLike)) {
      ({ contextText: filteredContextText } = await runSearch(0.25));
    }

    // Final gating: require overlap, but relax for menu/hours/short queries when we have substantial retrieved context.
    const hasRetrievedText = Boolean(filteredContextText && filteredContextText.trim());
    const overlapOk = hasRetrievedText ? keywordOverlapOk(normalizedQuery, filteredContextText) : false;
    const hasDocInfo = Boolean(
      hasRetrievedText &&
        (overlapOk || ((isMenuLike || isHoursLike || isShortQuery) && filteredContextText.trim().length >= 120))
    );

    if (liveMenuLines.length > 0 && hasDocInfo) {
      const lines: string[] = [];
      lines.push("I can help in two ways. Which one do you want?");
      lines.push("1) Items you can order right now");
      lines.push("2) Details from the menu info (descriptions, categories, etc.)");
      lines.push("Reply with 1 or 2.");
      lines.push("");
      lines.push("A few items you can order right now:");
      lines.push(...liveMenuLines.slice(0, 6));
      return lines.join("\n");
    }

    if (liveMenuLines.length > 0 && !hasDocInfo) {
      const lines: string[] = [];
      lines.push("Here are a few items you can order:");
      lines.push(...liveMenuLines);
      lines.push('Tell me what you want (for example: "Order 1 pizza").');
      return lines.join("\n");
    }

    if (!hasDocInfo) {
      return "I can help with the restaurant's menu, hours, delivery, reservations, and ordering. What would you like to know?";
    }

    const contextText: string = `Search results for "${userQuery}":

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

If the answer genuinely isn't in the search results, say: "I can help with the restaurant's menu, hours, delivery, reservations, and ordering. What would you like to know?"`;

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
            content: `User asked: "${userQuery}"\n\n${contextText}`,
          },
        ],
        model: openai("gpt-4o-mini") as any,
      });
    } catch (error) {
      console.error("[search tool] LLM call failed", error);
      return "I’m having trouble pulling that up right now. Please try again in a moment.";
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
      return "I’m having trouble pulling that up right now. Please try again in a moment.";
    }
  },
});
