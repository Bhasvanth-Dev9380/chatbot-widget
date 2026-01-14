import { action, internalMutation, mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { api, components, internal } from "../_generated/api";
import { MessageDoc, saveMessage } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";

import { generateCaseId } from "../lib/generateCaseId";

export const insertConversationInternal = internalMutation({
  args: {
    contactSessionId: v.id("contactSessions"),
    entityId: v.string(),
    threadId: v.string(),
    caseId: v.string(),
    zohoDeskTicketId: v.optional(v.string()),
    chatbotId: v.optional(v.id("chatbots")),
    kind: v.optional(
      v.union(v.literal("chat"), v.literal("voice"), v.literal("video")),
    ),
    isTranscriptPending: v.optional(v.boolean()),
  },
  handler: async (ctx: any, args: any) => {
    return await ctx.db.insert("conversations", {
      contactSessionId: args.contactSessionId,
      status: "unresolved",
      entityId: args.entityId,
      threadId: args.threadId,
      caseId: args.caseId,
      zohoDeskTicketId: args.zohoDeskTicketId,
      chatbotId: args.chatbotId,
      kind: args.kind,
      isTranscriptPending: args.isTranscriptPending,
    });
  },
});

/* -------------------------------------------------
   GET MANY (with lastMessage)
------------------------------------------------- */
export const getMany = query({
  args: {
    contactSessionId: v.id("contactSessions"),
    chatbotId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.contactSessionId);

    if (!session || session.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid session",
      });
    }

    let chatbotDocId:
      | import("../_generated/dataModel").Id<"chatbots">
      | null = null;

    if (args.chatbotId) {
      const chatbot = await ctx.db
        .query("chatbots")
        .withIndex("by_chatbot_id", (q) => q.eq("chatbotId", args.chatbotId))
        .unique();

      // If chatbotId is provided but invalid/wrong org, do not leak other bot conversations.
      if (!chatbot || chatbot.entityId !== session.entityId) {
        return { page: [], isDone: true, continueCursor: "" };
      }

      chatbotDocId = chatbot._id;
    }

    const baseQuery = ctx.db
      .query("conversations")
      .withIndex("by_contact_session_id", (q) =>
        q.eq("contactSessionId", args.contactSessionId),
      );

    const conversations = await (chatbotDocId
      ? baseQuery
          .filter((q) => q.eq(q.field("chatbotId"), chatbotDocId))
          .order("desc")
          .paginate(args.paginationOpts)
      : baseQuery
          .order("desc")
          .paginate(args.paginationOpts));

    const page = await Promise.all(
      conversations.page.map(async (conversation) => {
        let lastMessage: MessageDoc | null = null;

        const messages = await supportAgent.listMessages(ctx, {
          threadId: conversation.threadId,
          paginationOpts: { numItems: 1, cursor: null },
        });

        if (messages.page.length > 0) {
          lastMessage = messages.page[0] ?? null;
        }

        return {
          _id: conversation._id,
          _creationTime: conversation._creationTime,
          status: conversation.status,
          entityId: conversation.entityId,
          threadId: conversation.threadId,
          caseId: conversation.caseId,
          lastMessage,
        };
      }),
    );

    return {
      ...conversations,
      page,
    };
  },
});

/* -------------------------------------------------
   GET ONE
------------------------------------------------- */
export const getOne = query({
  args: {
    conversationId: v.id("conversations"),
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.contactSessionId);

    if (!session || session.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid session",
      });
    }

    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.contactSessionId !== session._id) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Incorrect session",
      });
    }

    return {
      _id: conversation._id,
      status: conversation.status,
      threadId: conversation.threadId,
      caseId: conversation.caseId,
    };
  },
});

/* -------------------------------------------------
   CREATE CONVERSATION
------------------------------------------------- */
export const create: any = action({
  args: {
    entityId: v.string(),
    contactSessionId: v.id("contactSessions"),
    chatbotId: v.optional(v.string()), // String chatbotId from embed snippet, NOT doc ID
    kind: v.optional(
      v.union(v.literal("chat"), v.literal("voice"), v.literal("video")),
    ),
    isTranscriptPending: v.optional(v.boolean()),
  },
  handler: async (ctx: any, args: any): Promise<any> => {
    const session: any = await ctx.runQuery((internal as any).system.contactSessions.getOne, {
      contactSessionId: args.contactSessionId,
    });

    if (!session || session.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid session",
      });
    }

    if (session.entityId !== args.entityId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Entity ID",
      });
    }

    // 🔄 Refresh session like reference
    await ctx.runMutation((internal as any).system.contactSessions.refresh, {
      contactSessionId: args.contactSessionId,
    });

    // Fetch widget settings (fallback behavior)
    const widgetSettings: any = await ctx.runQuery(
      (internal as any).system.widgetSettings.getByEntityId,
      { entityId: args.entityId },
    );

    let chatbot: any = null;
    let greetMessage = "Hello, how can I help you?";

    // 1️⃣ Explicit chatbotId (string) - look up by chatbotId field
    if (args.chatbotId) {
      chatbot = await ctx.runQuery((internal as any).system.chatbots.getByChatbotId, {
        chatbotId: args.chatbotId,
      });
      if (chatbot && chatbot.entityId === args.entityId) {
        greetMessage = chatbot.greetMessage;
      } else {
        chatbot = null; // Reset if not found or wrong org
      }
    }
    // 2️⃣ Widget-selected chatbot
    if (!chatbot && widgetSettings?.selectedChatbotId) {
      chatbot = await ctx.runQuery((internal as any).system.chatbots.getById, {
        id: widgetSettings.selectedChatbotId,
      });
      if (chatbot) {
        greetMessage = chatbot.greetMessage;
      }
    }
    // 3️⃣ Default chatbot
    if (!chatbot) {
      const orgChatbots: any = await ctx.runQuery((internal as any).system.chatbots.getByEntityId, {
        entityId: args.entityId,
      });

      chatbot = Array.isArray(orgChatbots)
        ? orgChatbots.find((c) => (c as any).isDefault === true) ?? null
        : null;

      if (chatbot) {
        greetMessage = chatbot.greetMessage;
      } else if (widgetSettings) {
        greetMessage = widgetSettings.greetMessage;
      }
    }

    // 🧵 Create support thread
    const { threadId } = await supportAgent.createThread(ctx, {
      userId: `${args.entityId}_${String(args.contactSessionId)}_${Date.now()}`,
    });

    // 💬 Initial greet message
    await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: "assistant",
        content: greetMessage,
      },
    });

    const contactLabel = session.name
      ? `${session.name}${session.email ? ` (${session.email})` : ""}`
      : session.email
        ? session.email
        : "Website visitor";

    const subject = chatbot?.name
      ? `Chatbot conversation (${chatbot.name}) - ${contactLabel}`
      : `Chatbot conversation - ${contactLabel}`;

    const caseDescription = [
      "Created via Spinabot chatbot.",
      chatbot?.name ? `Chatbot name: ${chatbot.name}` : null,
      args.chatbotId ? `Chatbot public id: ${args.chatbotId}` : null,
      chatbot?._id ? `Chatbot doc id: ${String(chatbot._id)}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const caseCommentBody = [
      "Conversation created.",
      chatbot?.name ? `Chatbot name: ${chatbot.name}` : null,
      args.chatbotId ? `Chatbot public id: ${args.chatbotId}` : null,
      chatbot?._id ? `Chatbot doc id: ${String(chatbot._id)}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    let zohoDeskTicketId: string | null = null;
    try {
      const zohoStatus = await ctx.runAction((api as any).private.zohoDesk.getConnectionStatus, {
        entityId: args.entityId,
      });
      const zohoConnected = Boolean(zohoStatus?.connected);
      if (zohoConnected) {
        const z = await ctx.runAction((api as any).private.zohoDesk.createTicket, {
          entityId: args.entityId,
          subject,
          description: caseDescription,
          contactName: session.name,
          contactEmail: session.email,
        });
        const id = typeof z?.id === "string" ? z.id : null;
        zohoDeskTicketId = id && id.trim() ? id : null;
      }
    } catch (error) {
      console.error("[conversations.create] Zoho Desk ticket creation failed", error);
      zohoDeskTicketId = null;
    }

    console.log("[conversations.create] Creating Salesforce case", {
      entityId: args.entityId,
      subject,
    });

    let caseId: string = generateCaseId();
    try {
      const sf = await ctx.runAction(api.private.salesforce.createCase, {
        entityId: args.entityId,
        subject,
        status: "New",
        origin: "Web",
        contactName: session.name,
        contactEmail: session.email,
        description: caseDescription,
        caseCommentBody,
      });

      console.log("[conversations.create] Salesforce createCase result", {
        id: sf?.id ?? null,
        caseNumber: sf?.caseNumber ?? null,
        success: sf?.success ?? null,
      });

      caseId = (sf?.caseNumber || sf?.id) as string;
      if (!caseId) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Salesforce case creation returned no case id",
        });
      }
    } catch (error) {
      console.error("[conversations.create] Salesforce case creation failed", error);

      const messageFromError = (() => {
        if (error instanceof ConvexError) {
          const data: unknown = (error as any).data;
          if (typeof data === "string" && data.trim()) return data;
          if (data && typeof data === "object" && !Array.isArray(data)) {
            const m = (data as any).message;
            if (typeof m === "string" && m.trim()) return m;
          }
        }
        if (error && typeof error === "object") {
          const m = (error as any).message;
          if (typeof m === "string" && m.trim()) return m;
        }
        return null;
      })();

      console.error("[conversations.create] Falling back to generated caseId", {
        entityId: args.entityId,
        message: messageFromError ?? null,
      });

      caseId = generateCaseId();
    }

    try {
      await ctx.runAction(api.private.salesforce.addInternalCaseComment, {
        entityId: args.entityId,
        caseNumberOrId: caseId,
        commentBody: `Assistant: ${String(greetMessage ?? "")}`.trim(),
      });
    } catch (error) {
      console.error(
        "[conversations.create] Failed to post Salesforce internal case comment (greet)",
        error,
      );
    }

    if (zohoDeskTicketId) {
      try {
        await ctx.runAction((api as any).private.zohoDesk.addTicketComment, {
          entityId: args.entityId,
          ticketId: zohoDeskTicketId,
          commentBody: `Assistant: ${String(greetMessage ?? "")}`.trim(),
          isPublic: false,
        });
      } catch (error) {
        console.error(
          "[conversations.create] Failed to post Zoho Desk ticket comment (greet)",
          error,
        );
      }
    }

    const conversationId: any = await ctx.runMutation(
      (internal as any).public.conversations.insertConversationInternal,
      {
        contactSessionId: session._id,
        entityId: args.entityId,
        threadId,
        caseId,
        zohoDeskTicketId: zohoDeskTicketId ?? undefined,
        chatbotId: chatbot?._id ?? undefined,
        kind: args.kind,
        isTranscriptPending: args.isTranscriptPending,
      },
    );

    try {
      await ctx.runAction(api.private.salesforce.sendWebhookEvent, {
        entityId: args.entityId,
        event: "case.created",
        conversationId: String(conversationId),
        threadId,
        caseId,
      });
    } catch (error) {
      console.error("[conversations.create] Failed to send webhook", error);
    }

    return conversationId;
  },
});

/* -------------------------------------------------
   DELETE CONVERSATION (for corrupted threads)
------------------------------------------------- */
export const deleteConversation = mutation({
  args: {
    conversationId: v.id("conversations"),
    contactSessionId: v.id("contactSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.contactSessionId);

    if (!session || session.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid session",
      });
    }

    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.contactSessionId !== session._id) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Incorrect session",
      });
    }

    // Delete the conversation
    await ctx.db.delete(args.conversationId);

    return { success: true };
  },
});
