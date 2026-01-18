import { v, ConvexError } from "convex/values";
import { action, query } from "../_generated/server";
import { api, components, internal } from "../_generated/api";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { paginationOptsValidator } from "convex/server";
import { saveMessage } from "@convex-dev/agent";
import { search } from "../system/ai/tools/search";
import { resolveConversation } from "../system/ai/tools/resolveConversation";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import {
  cloverCreateOrder,
  cloverGetOrder,
  cloverListOrders,
  cloverSearchItems,
} from "../system/ai/tools/cloverOrders";
import { SEARCH_INTERPRETER_PROMPT, createCustomAgentPrompt } from "../system/ai/constants";
import rag from "../system/ai/rag";

function normalizeAssistantText(text: string) {
  const s = String(text ?? "").replace(/\r\n/g, "\n");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isEscalationRequest(prompt: string) {
  const p = String(prompt ?? "").toLowerCase();
  return (
    p.includes("human") ||
    p.includes("agent") ||
    p.includes("real person") ||
    p.includes("operator") ||
    p.includes("support executive") ||
    p.includes("representative") ||
    p.includes("escalate")
  );
}

function isYes(prompt: string) {
  const p = String(prompt ?? "").trim().toLowerCase();
  return p === "yes" || p === "y" || p === "yeah" || p === "yep" || p === "sure";
}

function isNo(prompt: string) {
  const p = String(prompt ?? "").trim().toLowerCase();
  return p === "no" || p === "n" || p === "nope";
}

function toSalesforceCommentBody(prefix: string, text: string) {
  const maxLen = 3900;
  const body = `${prefix}${prefix ? " " : ""}${String(text ?? "")}`.trim();
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen - 1)}…`;
}

function toZohoDeskCommentBody(prefix: string, text: string) {
  const maxLen = 3900;
  const body = `${prefix}${prefix ? " " : ""}${String(text ?? "")}`.trim();
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen - 1)}…`;
}

function toHubSpotCommentBody(prefix: string, text: string) {
  const maxLen = 3900;
  const body = `${prefix}${prefix ? " " : ""}${String(text ?? "")}`.trim();
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen - 1)}…`;
}

function customerPrefixFromSession(session: any) {
  const name = String(session?.name ?? "").trim();
  const email = String(session?.email ?? "").trim();
  const parts: string[] = [];
  if (name) parts.push(name);
  if (email) parts.push(email);
  return parts.length > 0 ? `Customer (${parts.join(" - ")}):` : "Customer:";
}

async function tryPostInternalCaseComment(
  ctx: any,
  conversation: any,
  commentBody: string,
) {
  try {
    const caseNumberOrId = conversation?.caseId;
    if (!caseNumberOrId) return;

    await ctx.runAction(api.private.salesforce.addInternalCaseComment, {
      entityId: conversation.entityId,
      caseNumberOrId,
      commentBody,
    });
  } catch (error) {
    console.error("[messages] Failed to post Salesforce internal case comment", error);
  }
}

async function tryPostHubSpotTicketComment(
  ctx: any,
  conversation: any,
  commentBody: string,
) {
  try {
    const ticketId = conversation?.hubspotTicketId;
    if (!ticketId) return;

    await ctx.runAction((api as any).private.hubspot.addInternalTicketComment, {
      entityId: conversation.entityId,
      ticketId,
      commentBody,
    });
  } catch (error) {
    console.error("[messages] Failed to post HubSpot ticket comment", error);
  }
}

async function tryPostZohoDeskTicketComment(
  ctx: any,
  conversation: any,
  commentBody: string,
) {
  try {
    const ticketId = conversation?.zohoDeskTicketId;
    if (!ticketId) return;

    await ctx.runAction((api as any).private.zohoDesk.addTicketComment, {
      entityId: conversation.entityId,
      ticketId,
      commentBody,
      isPublic: false,
    });
  } catch (error) {
    console.error("[messages] Failed to post Zoho Desk ticket comment", error);
  }
}

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

    await tryPostInternalCaseComment(
      ctx,
      conversation,
      toSalesforceCommentBody(
        args.role === "user"
          ? customerPrefixFromSession(contactSession)
          : "Assistant:",
        args.text,
      ),
    );

    await tryPostZohoDeskTicketComment(
      ctx,
      conversation,
      toZohoDeskCommentBody(
        args.role === "user"
          ? customerPrefixFromSession(contactSession)
          : "Assistant:",
        args.text,
      ),
    );

    await tryPostHubSpotTicketComment(
      ctx,
      conversation,
      toHubSpotCommentBody(
        args.role === "user"
          ? customerPrefixFromSession(contactSession)
          : "Assistant:",
        args.text,
      ),
    );

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

    const promptTrimmed = String(args.prompt ?? "").trim();

    const getMsgRole = (m: any) => {
      const role = m?.message?.role ?? m?.role;
      return typeof role === "string" ? role : undefined;
    };

    const getMsgContent = (m: any) => {
      const content = m?.message?.content ?? m?.content ?? m?.text;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
          .join("")
          .trim();
      }
      return "";
    };

    const ensureUserMessageSaved = async (content: string) => {
      const text = String(content ?? "");
      if (!text.trim()) return;
      try {
        const recent = await supportAgent.listMessages(ctx, {
          threadId: args.threadId,
          paginationOpts: { numItems: 1, cursor: null },
        });
        const last = (recent as any)?.page?.[0];
        const lastRole = getMsgRole(last);
        const lastContent = getMsgContent(last);
        if (lastRole === "user" && lastContent === text) {
          return;
        }
      } catch (e) {
        console.error("[messages] ensureUserMessageSaved listMessages failed", e);
      }

      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "user",
          content: text,
        },
      });
    };

    const saveAssistantDirect = async (text: string) => {
      const content = normalizeAssistantText(text);
      if (!content) return;

      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "assistant",
          content,
        },
      });

      await tryPostInternalCaseComment(
        ctx,
        conversation,
        toSalesforceCommentBody("Assistant:", content),
      );

      await tryPostZohoDeskTicketComment(
        ctx,
        conversation,
        toZohoDeskCommentBody("Assistant:", content),
      );

      await tryPostHubSpotTicketComment(
        ctx,
        conversation,
        toHubSpotCommentBody("Assistant:", content),
      );
    };

    const getLastAssistantText = async () => {
      try {
        const recent = await supportAgent.listMessages(ctx, {
          threadId: args.threadId,
          paginationOpts: { numItems: 10, cursor: null },
        });
        const msgs = Array.isArray((recent as any)?.page) ? (recent as any).page : [];
        const lastAssistant = msgs.find(
          (m: any) => getMsgRole(m) === "assistant" && Boolean(getMsgContent(m).trim()),
        );
        return getMsgContent(lastAssistant);
      } catch (e) {
        console.error("[messages] getLastAssistantText failed", e);
        return "";
      }
    };

    const getLastUserText = async () => {
      try {
        const recent = await supportAgent.listMessages(ctx, {
          threadId: args.threadId,
          paginationOpts: { numItems: 30, cursor: null },
        });
        const msgs = Array.isArray((recent as any)?.page) ? (recent as any).page : [];
        for (const m of msgs) {
          if (getMsgRole(m) !== "user") continue;
          const text = getMsgContent(m);
          if (text && text.trim()) return text;
        }
        return "";
      } catch (e) {
        console.error("[messages] getLastUserText failed", e);
        return "";
      }
    };

    if (conversation.status !== "unresolved") {
      await ensureUserMessageSaved(args.prompt);

      await tryPostInternalCaseComment(
        ctx,
        conversation,
        toSalesforceCommentBody(customerPrefixFromSession(contactSession), args.prompt),
      );

      await tryPostZohoDeskTicketComment(
        ctx,
        conversation,
        toZohoDeskCommentBody(customerPrefixFromSession(contactSession), args.prompt),
      );

      await tryPostHubSpotTicketComment(
        ctx,
        conversation,
        toHubSpotCommentBody(customerPrefixFromSession(contactSession), args.prompt),
      );

      return;
    }

    const lastAssistantText = await getLastAssistantText();
    const awaitingEscalationConfirm = lastAssistantText.includes("Reply YES to connect you to a human");

    if (awaitingEscalationConfirm && isYes(promptTrimmed)) {
      await ensureUserMessageSaved(args.prompt);
      await ctx.runAction(internal.system.conversations.escalate, {
        threadId: args.threadId,
      });
      await saveAssistantDirect("Okay. I’m connecting you to a human now.");
      return;
    }

    if (awaitingEscalationConfirm && isNo(promptTrimmed)) {
      await ensureUserMessageSaved(args.prompt);
      await saveAssistantDirect("Okay. I’ll keep helping here. What would you like to know?");
      return;
    }

    if (isEscalationRequest(promptTrimmed)) {
      await ensureUserMessageSaved(args.prompt);
      await saveAssistantDirect(
        "I can connect you to a human operator. Reply YES to confirm, or NO to continue chatting here.",
      );
      return;
    }

    const GENERIC_CAPABILITY_FALLBACK =
      "I can help with the restaurant's menu, hours, delivery, reservations, and ordering. What would you like to know?";

    const looksLikeCloverMenuOrOrder = (prompt: string) => {
      const t = String(prompt ?? "").trim().toLowerCase();
      if (!t) return false;
      if (t.includes("hour") || t.includes("open") || t.includes("close")) return false;
      if (t.includes("reserv") || t.includes("book a table")) return false;
      if (t.includes("delivery") || t.includes("pickup") || t.includes("takeout")) return false;
      return (
        t.includes("order") ||
        t.includes("menu") ||
        t.includes("items") ||
        t.includes("item") ||
        t.includes("food") ||
        t.includes("beverage") ||
        t.includes("beverages") ||
        t.includes("drink") ||
        t.includes("drinks") ||
        t.includes("starter") ||
        t.includes("starters") ||
        t.includes("dessert") ||
        t.includes("desserts")
      );
    };

    const normalizeCloverCategory = (prompt: string): "beverages" | "desserts" | "starters" | null => {
      const t = String(prompt ?? "").trim().toLowerCase();
      if (!t) return null;
      if (t === "beverages" || t === "drinks" || t === "drink" || t === "i want beverages") return "beverages";
      if (t === "desserts" || t === "dessert") return "desserts";
      if (t === "starters" || t === "starter" || t === "appetizers" || t === "appetisers") return "starters";
      return null;
    };

    let cloverConnected = false;
    if (looksLikeCloverMenuOrOrder(promptTrimmed)) {
      try {
        const st: any = await ctx.runAction((api as any).private.clover.getConnectionStatus, {
          entityId: conversation.entityId,
        });
        cloverConnected = Boolean(st?.configured) && Boolean(st?.connected);
      } catch (e) {
        void e;
      }
    }

    const lastAssistantNormalized = normalizeAssistantText(lastAssistantText);
    if (
      lastAssistantNormalized === GENERIC_CAPABILITY_FALLBACK ||
      lastAssistantNormalized.includes("I can help with the restaurant's menu")
    ) {
      const normalizeForRepeat = (s: string) =>
        String(s ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const current = normalizeForRepeat(promptTrimmed);
      const previousUserText = normalizeForRepeat(await getLastUserText());
      const isRepeat = Boolean(previousUserText && previousUserText === current);
      if (isRepeat) {
        let next = "What would you like to do next: see the menu, place an order, check hours, delivery, or reservations?";
        if (current.includes("delivery")) {
          next = "Are you asking whether delivery is available, or how to place a delivery order?";
        } else if (current.includes("hour") || current.includes("open") || current.includes("close")) {
          next = "Which day are you asking about for hours (today, tomorrow, weekend)?";
        } else if (current.includes("reserv") || current.includes("book")) {
          next = "How many people and what time are you looking to reserve for?";
        }

        await ensureUserMessageSaved(args.prompt);
        await saveAssistantDirect(next);
        return;
      }
    }

    const wantsToPlaceOrder = /\b(order|place an order|place order|checkout|buy|get me)\b/i.test(promptTrimmed);
    const category = normalizeCloverCategory(promptTrimmed);
    const wantsMenuList =
      !wantsToPlaceOrder &&
      (category !== null || /\b(show|see)\b.*\bmenu\b/i.test(promptTrimmed) || /\bwhat\b.*\b(items|item)\b/i.test(promptTrimmed));

    if (cloverConnected && wantsMenuList) {
      try {
        const formatCents = (amount: unknown) => {
          if (typeof amount === "number" && Number.isFinite(amount)) return `$${(amount / 100).toFixed(2)}`;
          return null;
        };

        const raw = await ctx.runAction((api as any).private.clover.listItems, {
          entityId: conversation.entityId,
          limit: 200,
        });

        const elements: any[] =
          raw && typeof raw === "object" && Array.isArray((raw as any).elements) ? (raw as any).elements : [];

        const filterByCategory = (items: any[], c: "beverages" | "desserts" | "starters") => {
          const keywords: Record<string, string[]> = {
            beverages: [
              "lassi",
              "tea",
              "coffee",
              "juice",
              "soda",
              "coke",
              "pepsi",
              "sprite",
              "water",
              "kombucha",
              "jaljeera",
              "pani",
              "drink",
            ],
            desserts: ["dessert", "sweet", "cake", "lava", "rasmalai", "gulab", "jamun", "brownie", "ice"],
            starters: [
              "starter",
              "appet",
              "soup",
              "salad",
              "fries",
              "tikka",
              "pakora",
              "kebab",
              "roll",
              "chilli",
              "manchur",
            ],
          };
          const k = keywords[c] ?? [];
          return items.filter((it) => {
            const name = String(it?.name ?? "").toLowerCase();
            return k.some((kw) => name.includes(kw));
          });
        };

        const candidates = category ? filterByCategory(elements, category) : elements;
        const top = candidates.slice(0, 12);
        if (top.length > 0) {
          const lines: string[] = [];
          if (category === "beverages") lines.push("Here are some beverages you can order:");
          else if (category === "desserts") lines.push("Here are some desserts you can order:");
          else if (category === "starters") lines.push("Here are some starters you can order:");
          else lines.push("Here are a few items you can order:");

          for (const it of top) {
            const name = String(it?.name ?? "").trim() || "Item";
            const price = formatCents(it?.price);
            lines.push(`${name}${price ? ` - ${price}` : ""}`);
          }
          lines.push("Tell me what you want (and quantity), and I’ll place the order.");

          await ensureUserMessageSaved(args.prompt);
          await saveAssistantDirect(lines.join("\n"));
          return;
        }
      } catch (e) {
        void e;
      }
    }

    const shouldSkipKbFirst =
      cloverConnected &&
      (looksLikeCloverMenuOrOrder(promptTrimmed) || wantsToPlaceOrder || wantsMenuList);

    if (!shouldSkipKbFirst) {
      const genericFallback = GENERIC_CAPABILITY_FALLBACK;
      let kbAnswer = "";
      let kbContextText = "";

      const looksMetaOrSpeculative = (s: string) => {
        const t = String(s ?? "").toLowerCase();
        if (!t.trim()) return true;
        const banned = [
          "it looks like",
          "seems like",
          "it seems",
          "i found",
          "i searched",
          "i can help with specific chapters",
          "specific chapters",
          "not much detail",
          "there isn't much detail",
          "there are no",
          "i don't see",
        ];
        return banned.some((p) => t.includes(p));
      };

      const extractiveFallback = (text: string) => {
        const s = String(text ?? "").replace(/\s+/g, " ").trim();
        if (!s) return "";
        const parts = s.split(/(?<=[.!?])\s+/).filter(Boolean);
        const out = parts.slice(0, 2).join(" ").trim();
        const clipped = out.length > 380 ? `${out.slice(0, 379)}…` : out;
        return clipped || (s.length > 380 ? `${s.slice(0, 379)}…` : s);
      };

      try {
        const isSummarizeRequest = /^\s*(summarize|summary)\b/i.test(promptTrimmed);
        const previousUserText = isSummarizeRequest ? await getLastUserText() : "";
        const retrievalPrompt =
          isSummarizeRequest && previousUserText.trim() ? previousUserText : String(args.prompt ?? "");

        let namespace = String(conversation.entityId ?? "").trim();

        if (conversation.chatbotId) {
          const chatbot = await ctx.runQuery(internal.system.chatbots.getById, {
            id: conversation.chatbotId,
          });
          if (chatbot?.knowledgeBaseId) {
            const knowledgeBase = await ctx.runQuery(internal.system.knowledgeBases.getById, {
              id: chatbot.knowledgeBaseId,
            });
            if (knowledgeBase?.ragNamespace) {
              namespace = String(knowledgeBase.ragNamespace).trim();
            }
          }
        } else {
          const widgetSettings = await ctx.runQuery(internal.system.widgetSettings.getByEntityId, {
            entityId: conversation.entityId,
          });
          const selectedChatbotId =
            typeof widgetSettings?.selectedChatbotId === "string"
              ? widgetSettings.selectedChatbotId
              : null;
          if (selectedChatbotId) {
            const chatbot = await ctx.runQuery(internal.system.chatbots.getById, {
              id: selectedChatbotId,
            });
            if (chatbot?.knowledgeBaseId) {
              const knowledgeBase = await ctx.runQuery(internal.system.knowledgeBases.getById, {
                id: chatbot.knowledgeBaseId,
              });
              if (knowledgeBase?.ragNamespace) {
                namespace = String(knowledgeBase.ragNamespace).trim();
              }
            }
          }
        }

        const res: any = await rag.search(ctx, {
          namespace,
          query: String(retrievalPrompt ?? "").trim(),
          limit: 12,
          vectorScoreThreshold: 0.35,
        });

        const entries: any[] | undefined = Array.isArray(res?.entries) ? res.entries : undefined;
        const extractEntryText = (e: any) => {
          if (typeof e?.text === "string") return e.text;
          if (typeof e?.content === "string") return e.content;
          if (typeof e?.pageContent === "string") return e.pageContent;
          if (typeof e?.chunkText === "string") return e.chunkText;
          return "";
        };

        const contextFromEntries =
          entries && entries.length
            ? entries
                .map((e) => {
                  const text = extractEntryText(e);
                  if (!String(text ?? "").trim()) return null;
                  return e?.title ? `## ${e.title}:\n${text}` : String(text);
                })
                .filter(Boolean)
                .join("\n\n---\n\n")
            : "";

        const contextText =
          String(contextFromEntries ?? "").trim() ||
          (typeof res?.text === "string" ? String(res.text).trim() : "");

        kbContextText = contextText;

        console.info("[messages] kb-first rag.search", {
          namespace,
          entriesCount: entries?.length ?? 0,
          contextLen: contextText.length,
        });

        if (contextText) {
          const groundedAnswerPrompt =
            "Answer using ONLY the provided context. If the question is broad (for example: 'tell me about ...'), give a short summary of what the context says. Keep it to 2-3 sentences. Do not mention searching, tools, documents, chapters, or what is missing. Do not speculate.";

          const runOnce = async () => {
            const response = await generateText({
              messages: [
                {
                  role: "system",
                  content: isSummarizeRequest
                    ? "You summarize the provided text. Only use facts present in the text. No outside knowledge. Keep it to 2-3 sentences. Do not mention tools, search, files, or documents."
                    : groundedAnswerPrompt,
                },
                {
                  role: "user",
                  content: isSummarizeRequest
                    ? `Summarize this text:\n\n${contextText}`
                    : `Question: ${String(args.prompt ?? "").trim()}\n\nContext:\n${contextText}`,
                },
              ],
              model: openai("gpt-4o-mini") as any,
            });
            return String((response as any)?.text ?? "");
          };

          let candidate = await runOnce();
          if (!isSummarizeRequest && looksMetaOrSpeculative(candidate)) {
            candidate = await runOnce();
          }
          if (!isSummarizeRequest && looksMetaOrSpeculative(candidate)) {
            candidate = extractiveFallback(contextText);
          }
          kbAnswer = candidate;
        } else {
          kbAnswer = "";
        }
      } catch (e) {
        console.error("[messages] kb-first search failed", e);
      }

      let rawAnswer = String(kbAnswer ?? "").trim();
      if (kbContextText.trim() && (!rawAnswer || rawAnswer === genericFallback)) {
        rawAnswer = extractiveFallback(kbContextText);
      }

      if (rawAnswer && (kbContextText.trim() || rawAnswer !== genericFallback)) {
        await tryPostInternalCaseComment(
          ctx,
          conversation,
          toSalesforceCommentBody(customerPrefixFromSession(contactSession), args.prompt),
        );

        await tryPostZohoDeskTicketComment(
          ctx,
          conversation,
          toZohoDeskCommentBody(customerPrefixFromSession(contactSession), args.prompt),
        );

        await tryPostHubSpotTicketComment(
          ctx,
          conversation,
          toHubSpotCommentBody(customerPrefixFromSession(contactSession), args.prompt),
        );

        await ensureUserMessageSaved(args.prompt);
        await saveAssistantDirect(rawAnswer);
        return;
      }
    }

    let promptForAgent = args.prompt;
    if (promptTrimmed === "1" || promptTrimmed === "2") {
      try {
        const recent = await supportAgent.listMessages(ctx, {
          threadId: args.threadId,
          paginationOpts: { numItems: 10, cursor: null },
        });
        const msgs = Array.isArray((recent as any)?.page) ? (recent as any).page : [];
        const lastAssistant = msgs.find((m: any) => getMsgRole(m) === "assistant" && Boolean(getMsgContent(m).trim()));
        const lastText = getMsgContent(lastAssistant);
        if (lastText.includes("Reply with 1 or 2")) {
          promptForAgent =
            promptTrimmed === "1"
              ? "Show me items I can order right now."
              : "Show me menu details and descriptions.";
        }
      } catch (e) {
        console.error("[messages] failed to interpret 1/2 clarification", e);
      }
    }


    

    // 🔄 Refresh session
    await ctx.runMutation(internal.system.contactSessions.refresh, {
      contactSessionId: args.contactSessionId,
    });

    // 🧠 Resolve custom prompt
    let customPrompt: string | null = null;
    let chatbotName: string | null = null;

    if (conversation.chatbotId) {
      const chatbot = await ctx.runQuery(
        internal.system.chatbots.getById,
        { id: conversation.chatbotId }
      );
      customPrompt = chatbot?.customSystemPrompt ?? null;
      chatbotName = typeof chatbot?.name === "string" ? chatbot.name : null;
    } else {
      const widgetSettings = await ctx.runQuery(
        internal.system.widgetSettings.getByEntityId,
        { entityId: conversation.entityId }
      );
      customPrompt = widgetSettings?.customSystemPrompt ?? null;

      const selectedChatbotId = typeof widgetSettings?.selectedChatbotId === "string" ? widgetSettings.selectedChatbotId : null;
      if (selectedChatbotId) {
        const selected = await ctx.runQuery(internal.system.chatbots.getById, {
          id: selectedChatbotId,
        });
        chatbotName = typeof (selected as any)?.name === "string" ? (selected as any).name : null;
      }
    }

    try {
      console.log("🚀 Starting agent generateText for threadId:", args.threadId);
      console.log("📝 User prompt:", args.prompt);

      const saveAssistantText = async (text: string) => {
        const content = normalizeAssistantText(text);
        if (!content) return;

        await saveMessage(ctx, components.agent, {
          threadId: args.threadId,
          message: {
            role: "assistant",
            content,
          },
        });

        await tryPostInternalCaseComment(
          ctx,
          conversation,
          toSalesforceCommentBody("Assistant:", content),
        );

        await tryPostZohoDeskTicketComment(
          ctx,
          conversation,
          toZohoDeskCommentBody("Assistant:", content),
        );

        await tryPostHubSpotTicketComment(
          ctx,
          conversation,
          toHubSpotCommentBody("Assistant:", content),
        );
      };

      const finalizeAssistantFromToolOutput = async (toolOutput: string) => {
        const cleaned = String(toolOutput ?? "").trim();
        if (!cleaned) return "";
        try {
          const finalized = await generateText({
            model: openai("gpt-4o-mini") as any,
            messages: [
              {
                role: "system",
                content:
                  "Rewrite the tool output into a smooth, natural assistant reply. Keep it concise. Do not use bullet points, numbered lists, or dashes. You may use short sentences and line breaks.",
              },
              {
                role: "user",
                content: `User message: ${String(args.prompt ?? "").trim()}\n\nTool output:\n${cleaned}`,
              },
            ],
          });
          return normalizeAssistantText(String((finalized as any)?.text ?? ""));
        } catch (e) {
          console.error("[messages] finalizeAssistantFromToolOutput failed", e);
          return cleaned;
        }
      };

      const extractToolOutputOrError = (result: any): { output?: string; error?: boolean } => {
        const steps = Array.isArray(result?.steps) ? result.steps : [];
        for (let i = steps.length - 1; i >= 0; i--) {
          const content = Array.isArray(steps[i]?.content) ? steps[i].content : [];
          const preferredSearch = content.find(
            (c: any) => c?.type === "tool-result" && c?.toolName === "search" && c?.output !== undefined,
          );
          if (preferredSearch) {
            return { output: String(preferredSearch.output) };
          }

          for (let j = content.length - 1; j >= 0; j--) {
            const c = content[j];
            if (c?.type === "tool-result" && c?.output !== undefined) {
              return { output: String(c.output) };
            }
          }
          const toolError = content.find((c: any) => c?.type === "tool-error");
          if (toolError) {
            return { error: true };
          }
        }
        return {};
      };

      await tryPostInternalCaseComment(
        ctx,
        conversation,
        toSalesforceCommentBody(customerPrefixFromSession(contactSession), args.prompt),
      );

      await tryPostZohoDeskTicketComment(
        ctx,
        conversation,
        toZohoDeskCommentBody(customerPrefixFromSession(contactSession), args.prompt),
      );

      await tryPostHubSpotTicketComment(
        ctx,
        conversation,
        toHubSpotCommentBody(customerPrefixFromSession(contactSession), args.prompt),
      );

      if (customPrompt) {
        const { Agent } = await import("@convex-dev/agent");
        const { openai: openaiSdk } = await import("@ai-sdk/openai");

        const agent = new Agent(components.agent, {
          name: "customSupportAgent",
          languageModel: openaiSdk.chat("gpt-4o-mini"),
          instructions: createCustomAgentPrompt(customPrompt),
          tools: {
            search,
            cloverListOrders,
            cloverGetOrder,
            cloverSearchItems,
            cloverCreateOrder,
            resolveConversation,
          },
        });

        console.log("🤖 Using custom agent");
        const result = await agent.generateText(
          ctx,
          { threadId: args.threadId },
          { prompt: promptForAgent }
        );

        {
          const usage = (result as any)?.usage;
          const totalTokens =
            typeof usage?.totalTokens === "number"
              ? usage.totalTokens
              : Math.ceil(String(args.prompt ?? "").length / 4);

          if (totalTokens > 0) {
            await ctx.runMutation((internal as any).system.tokenUsage.record, {
              entityId: conversation.entityId,
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

        const assistantText = (result as any)?.text;
        if (typeof assistantText === "string" && assistantText.trim()) {
          await tryPostInternalCaseComment(
            ctx,
            conversation,
            toSalesforceCommentBody("Assistant:", assistantText),
          );

          await tryPostZohoDeskTicketComment(
            ctx,
            conversation,
            toZohoDeskCommentBody("Assistant:", assistantText),
          );

          await tryPostHubSpotTicketComment(
            ctx,
            conversation,
            toHubSpotCommentBody("Assistant:", assistantText),
          );
        }

        // Check if agent ended with tool calls instead of text
        const lastStep = result.steps[result.steps.length - 1];
        if (lastStep.finishReason === "tool-calls") {
          console.warn("⚠️ Custom agent stopped at tool-calls without generating text response!");

          const tool = extractToolOutputOrError(result);
          if (tool.output && tool.output.trim()) {
            const finalized = await finalizeAssistantFromToolOutput(tool.output);
            console.log("💡 Saving finalized assistant message:", finalized);
            await saveAssistantText(finalized);
          } else if (tool.error) {
            console.warn("⚠️ Tool failed; saving fallback assistant message");
            await saveAssistantText(
              "I’m having trouble pulling that up right now. Please try again in a moment.",
            );
          } else {
            console.error("❌ No tool result found to save for custom agent");
            await saveAssistantText(
              "I’m having trouble completing that request right now. Please try again in a moment.",
            );
          }
        }
      } else {
        console.log("🤖 Using support agent");
        const result = await supportAgent.generateText(
          ctx,
          { threadId: args.threadId },
          { prompt: promptForAgent }
        );

        {
          const usage = (result as any)?.usage;
          const totalTokens =
            typeof usage?.totalTokens === "number"
              ? usage.totalTokens
              : Math.ceil(String(args.prompt ?? "").length / 4);

          if (totalTokens > 0) {
            await ctx.runMutation((internal as any).system.tokenUsage.record, {
              entityId: conversation.entityId,
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

        const assistantText = (result as any)?.text;
        if (typeof assistantText === "string" && assistantText.trim()) {
          await tryPostInternalCaseComment(
            ctx,
            conversation,
            toSalesforceCommentBody("Assistant:", assistantText),
          );

          await tryPostZohoDeskTicketComment(
            ctx,
            conversation,
            toZohoDeskCommentBody("Assistant:", assistantText),
          );

          await tryPostHubSpotTicketComment(
            ctx,
            conversation,
            toHubSpotCommentBody("Assistant:", assistantText),
          );
        }

        // Check if agent ended with tool calls instead of text
        const lastStep = result.steps[result.steps.length - 1];
        if (lastStep.finishReason === "tool-calls") {
          console.warn("⚠️ Agent stopped at tool-calls without generating text response!");

          const tool = extractToolOutputOrError(result);
          if (tool.output && tool.output.trim()) {
            const finalized = await finalizeAssistantFromToolOutput(tool.output);
            console.log("💡 Saving finalized assistant message:", finalized);
            await saveAssistantText(finalized);
          } else if (tool.error) {
            console.warn("⚠️ Tool failed; saving fallback assistant message");
            await saveAssistantText(
              "I’m having trouble pulling that up right now. Please try again in a moment.",
            );
          } else {
            console.error("❌ No tool result found to save");
            await saveAssistantText(
              "I’m having trouble completing that request right now. Please try again in a moment.",
            );
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
        console.log(`  [${idx}] Role: ${getMsgRole(msg)}, Content:`, getMsgContent(msg));
      });
    } catch (error: any) {
      // 🚨 HARD TOOL CORRUPTION HANDLING (FINAL FIX)
      console.error("❌ Tool corruption detected!", error?.message);

      // Save user message so chat history stays correct
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "user",
          content: args.prompt,
        },
      });

      await tryPostInternalCaseComment(
        ctx,
        conversation,
        toSalesforceCommentBody(customerPrefixFromSession(contactSession), args.prompt),
      );

      await tryPostZohoDeskTicketComment(
        ctx,
        conversation,
        toZohoDeskCommentBody(customerPrefixFromSession(contactSession), args.prompt),
      );

      // Save fallback assistant response (CRITICAL)
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "assistant",
          content:
            "Sorry. Something went wrong on my side. Please try again.",
        },
      });

      await tryPostInternalCaseComment(
        ctx,
        conversation,
        toSalesforceCommentBody(
          "Assistant:",
          "Sorry. Something went wrong on my side. Please try again.",
        ),
      );

      await tryPostZohoDeskTicketComment(
        ctx,
        conversation,
        toZohoDeskCommentBody(
          "Assistant:",
          "Sorry. Something went wrong on my side. Please try again.",
        ),
      );

      await tryPostHubSpotTicketComment(
        ctx,
        conversation,
        toHubSpotCommentBody(
          "Assistant:",
          "Sorry. Something went wrong on my side. Please try again.",
        ),
      );

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
