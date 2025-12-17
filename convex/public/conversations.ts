import { mutation, query } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { components, internal } from "../_generated/api";
import { MessageDoc, saveMessage } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { generateCaseId } from "../lib/generateCaseId";

/* -------------------------------------------------
   GET MANY (with lastMessage)
------------------------------------------------- */
export const getMany = query({
  args: {
    contactSessionId: v.id("contactSessions"),
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

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_contact_session_id", (q) =>
        q.eq("contactSessionId", args.contactSessionId),
      )
      .order("desc")
      .paginate(args.paginationOpts);

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
          organizationId: conversation.organizationId,
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
export const create = mutation({
  args: {
    organizationId: v.string(),
    contactSessionId: v.id("contactSessions"),
    chatbotId: v.optional(v.id("chatbots")),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.contactSessionId);

    if (!session || session.expiresAt < Date.now()) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid session",
      });
    }

    // 🔄 Refresh session like reference
    await ctx.runMutation(internal.system.contactSessions.refresh, {
      contactSessionId: args.contactSessionId,
    });

    // Fetch widget settings (fallback behavior)
    const widgetSettings = await ctx.db
      .query("widgetSettings")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();

    let chatbot = null;
    let greetMessage = "Hello, how can I help you?";

    // 1️⃣ Explicit chatbot
    if (args.chatbotId) {
      chatbot = await ctx.db.get(args.chatbotId);
      if (chatbot && chatbot.organizationId === args.organizationId) {
        greetMessage = chatbot.greetMessage;
      }
    }
    // 2️⃣ Widget-selected chatbot
    else if (widgetSettings?.selectedChatbotId) {
      chatbot = await ctx.db.get(widgetSettings.selectedChatbotId);
      if (chatbot) {
        greetMessage = chatbot.greetMessage;
      }
    }
    // 3️⃣ Default chatbot
    else {
      chatbot = await ctx.db
        .query("chatbots")
        .withIndex("by_organization_id", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .filter((q) => q.eq(q.field("isDefault"), true))
        .first();

      if (chatbot) {
        greetMessage = chatbot.greetMessage;
      } else if (widgetSettings) {
        greetMessage = widgetSettings.greetMessage;
      }
    }

    // 🧵 Create support thread
    const { threadId } = await supportAgent.createThread(ctx, {
      userId: args.organizationId,
    });

    // 💬 Initial greet message
    await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: "assistant",
        content: greetMessage,
      },
    });

    // 🆔 Case ID (shared util — same as reference)
    const caseId = generateCaseId();

    const conversationId = await ctx.db.insert("conversations", {
      contactSessionId: session._id,
      status: "unresolved",
      organizationId: args.organizationId,
      threadId,
      caseId,
      chatbotId: chatbot?._id ?? undefined,
    });

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
