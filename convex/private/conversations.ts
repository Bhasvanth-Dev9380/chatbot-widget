import { mutation, query, action } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { supportAgent } from "../system/ai/agents/supportAgent";
import { MessageDoc } from "@convex-dev/agent";
import {
  paginationOptsValidator,
  PaginationResult,
} from "convex/server";
import { Doc } from "../_generated/dataModel";

/* -------------------------------------------------
   UPDATE STATUS
------------------------------------------------- */
export const updateStatus = mutation({
  args: {
    conversationId: v.id("conversations"),
    status: v.union(
      v.literal("unresolved"),
      v.literal("escalated"),
      v.literal("resolved"),
    ),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    await ctx.db.patch(args.conversationId, {
      status: args.status,
    });
  },
});

/* -------------------------------------------------
   GET ONE
------------------------------------------------- */
export const getOne = query({
  args: {
    conversationId: v.id("conversations"),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    const contactSession = await ctx.db.get(conversation.contactSessionId);

    if (!contactSession) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contact Session not found",
      });
    }

    return {
      ...conversation,
      contactSession,
    };
  },
});

/* -------------------------------------------------
   GET MANY (FULLY ALIGNED)
------------------------------------------------- */
export const getMany = query({
  args: {
    paginationOpts: v.optional(paginationOptsValidator),
    status: v.optional(
      v.union(
        v.literal("unresolved"),
        v.literal("escalated"),
        v.literal("resolved"),
      ),
    ),
    chatbotId: v.optional(v.id("chatbots")),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const pagination =
      args.paginationOpts ?? { numItems: 50, cursor: null };

    let conversations: PaginationResult<Doc<"conversations">>;

    if (args.chatbotId) {
      conversations = await ctx.db
        .query("conversations")
        .withIndex("by_chatbot_id", (q) =>
          q.eq("chatbotId", args.chatbotId),
        )
        .filter((q) =>
          q.eq(q.field("organizationId"), args.organizationId),
        )
        .order("desc")
        .paginate(pagination);

      if (args.status) {
        conversations = {
          ...conversations,
          page: conversations.page.filter(
            (c) => c.status === args.status,
          ),
        };
      }
    } else if (args.status) {
      conversations = await ctx.db
        .query("conversations")
        .withIndex("by_status_and_organization_id", (q) =>
          q
            .eq(
              "status",
              args.status as Doc<"conversations">["status"],
            )
            .eq("organizationId", args.organizationId),
        )
        .order("desc")
        .paginate(pagination);
    } else {
      conversations = await ctx.db
        .query("conversations")
        .withIndex("by_organization_id", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .order("desc")
        .paginate(pagination);
    }

    const enriched = await Promise.all(
      conversations.page.map(async (conversation) => {
        const contactSession = await ctx.db.get(
          conversation.contactSessionId,
        );
        if (!contactSession) return null;

        let chatbotName: string | null = null;
        if (conversation.chatbotId) {
          const chatbot = await ctx.db.get(conversation.chatbotId);
          if (chatbot) chatbotName = chatbot.name;
        }

        const messages = await supportAgent.listMessages(ctx, {
          threadId: conversation.threadId,
          paginationOpts: { numItems: 1, cursor: null },
        });

        const lastMessage =
          messages.page.length > 0 ? messages.page[0] : null;

        return {
          ...conversation,
          contactSession,
          chatbotName,
          lastMessage,
        };
      }),
    );

    return {
      ...conversations,
      page: enriched.filter(Boolean),
    };
  },
});

/* -------------------------------------------------
   EXPORT TO JSON
------------------------------------------------- */
export const exportToJson = mutation({
  args: {
    conversationId: v.id("conversations"),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);

    if (!conversation) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Conversation not found",
      });
    }

    if (conversation.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    const contactSession = await ctx.db.get(
      conversation.contactSessionId,
    );
    if (!contactSession) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Contact Session not found",
      });
    }

    const messages = await supportAgent.listMessages(ctx, {
      threadId: conversation.threadId,
      paginationOpts: { numItems: 100, cursor: null },
    });

    const json = JSON.stringify(
      {
        conversationDetails: {
          caseId: conversation.caseId,
          status: conversation.status,
          customerName: contactSession.name,
          customerEmail: contactSession.email,
          createdAt: new Date(
            conversation._creationTime,
          ).toISOString(),
        },
        messages: messages.page.reverse().map((m) => ({
          from:
            m.message?.role === "user"
              ? "Customer"
              : "Assistant",
          message: m.text || "",
        })),
        exportInfo: {
          totalMessages: messages.page.length,
          exportedAt: new Date().toISOString(),
        },
      },
      null,
      2,
    );

    await ctx.db.patch(args.conversationId, { json });
    return json;
  },
});
