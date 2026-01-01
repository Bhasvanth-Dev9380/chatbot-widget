import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { supportAgent } from "./system/ai/agents/supportAgent";
import { saveMessage } from "@convex-dev/agent";
import { components } from "./_generated/api";

type WebhookMessageEvent = {
  event_type: "message";
  call_id: string;
  message: {
    sender: "user" | "agent";
    message: string;
    sent_at: string;
  };
  call_data?: {
    userName?: string;
    agentId?: string;
  };
};

type WebhookCallEndedEvent = {
  event_type: "call_ended";
  call_id: string;
  user_name?: string;
  messages?: Array<{
    sender: "user" | "agent";
    message: string;
    sent_at: string;
  }>;
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function toMillis(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

const router = httpRouter();

const systemApi = (internal as any).system;

router.route({
  path: "/beyond-presence/webhook",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return jsonResponse(200, { ok: true });
  }),
});

router.route({
  path: "/beyond-presence/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      let payload: any;
      try {
        payload = await request.json();
      } catch {
        return jsonResponse(200, { ok: true });
      }

      const eventType = payload?.event_type;
      if (eventType === "test") {
        return jsonResponse(200, { ok: true });
      }

      if (eventType !== "message" && eventType !== "call_ended") {
        return jsonResponse(200, { ok: true });
      }

      const callId: string | undefined = payload?.call_id;
      if (!callId) {
        return jsonResponse(200, { ok: true });
      }

      let link = await ctx.runQuery(systemApi.beyondPresenceCallLinks.getByCallId, {
        callId,
      });

      if (!link) {
        const agentId: string | undefined = payload?.call_data?.agentId;
        const userName: string | undefined =
          payload?.call_data?.userName ?? payload?.user_name;

        if (!agentId) {
          return jsonResponse(200, { ok: true });
        }

        const chatbots = await ctx.runQuery(
          systemApi.chatbots.getManyByBeyondPresenceAgentId,
          {
            beyondPresenceAgentId: agentId,
          },
        );

        if (!chatbots || chatbots.length === 0) {
          return jsonResponse(200, { ok: true });
        }

        const primaryOrgId = chatbots[0]?.organizationId;
        const allSameOrg = chatbots.every(
          (c: any) => c.organizationId === primaryOrgId,
        );
        if (!primaryOrgId || !allSameOrg) {
          return jsonResponse(200, { ok: true });
        }

        const existingConversation = await ctx.runQuery(
          systemApi.beyondPresenceCallLinks.findLatestUnlinkedConversationForChatbots,
          {
            organizationId: primaryOrgId,
            chatbotIds: chatbots.map((c: any) => c._id),
            createdAfter: Date.now() - 15 * 60 * 1000,
          },
        );

        if (existingConversation) {
          await ctx.runMutation(systemApi.beyondPresenceCallLinks.createLink, {
            callId,
            conversationId: existingConversation.conversationId,
            threadId: existingConversation.threadId,
          });

          link = await ctx.runQuery(systemApi.beyondPresenceCallLinks.getByCallId, {
            callId,
          });
        }

        if (!link) {
          const chatbot = chatbots[0];
          const { threadId } = await supportAgent.createThread(ctx, {
            userId: chatbot.organizationId,
          });

          await ctx.runMutation(systemApi.beyondPresenceCallLinks.createConversationAndLink, {
            callId,
            threadId,
            organizationId: chatbot.organizationId,
            chatbotId: chatbot._id,
            userName,
          });

          link = await ctx.runQuery(systemApi.beyondPresenceCallLinks.getByCallId, {
            callId,
          });

          if (!link) {
            return jsonResponse(200, { ok: true });
          }
        }
      }

      if (eventType === "message") {
        const body = payload as WebhookMessageEvent;
        const sentAtMs = toMillis(body.message?.sent_at);
        if (sentAtMs === null) return jsonResponse(200, { ok: true });

        if (
          link.lastProcessedSentAt !== undefined &&
          sentAtMs <= link.lastProcessedSentAt
        ) {
          return jsonResponse(200, { ok: true });
        }

        const role = body.message.sender === "user" ? "user" : "assistant";
        const content = `[Video] ${body.message.message}`;

        await saveMessage(ctx, components.agent, {
          threadId: link.threadId,
          message: {
            role,
            content,
          },
        });

        await ctx.runMutation(systemApi.conversations.markTranscriptReady, {
          conversationId: link.conversationId,
        });

        await ctx.runMutation(systemApi.beyondPresenceCallLinks.updateLastProcessedSentAt, {
          callId,
          sentAt: sentAtMs,
        });

        return jsonResponse(200, { ok: true });
      }

      const body = payload as WebhookCallEndedEvent;
      const messages = Array.isArray(body.messages) ? body.messages : [];

      const sorted = messages
        .map((m) => ({ ...m, sentAtMs: toMillis(m.sent_at) }))
        .filter((m) => m.sentAtMs !== null)
        .sort((a, b) => (a.sentAtMs as number) - (b.sentAtMs as number));

      for (const m of sorted) {
        const sentAtMs = m.sentAtMs as number;
        if (
          link.lastProcessedSentAt !== undefined &&
          sentAtMs <= link.lastProcessedSentAt
        ) {
          continue;
        }

        const role = m.sender === "user" ? "user" : "assistant";
        const content = `[Video] ${m.message}`;

        await saveMessage(ctx, components.agent, {
          threadId: link.threadId,
          message: {
            role,
            content,
          },
        });

        await ctx.runMutation(systemApi.conversations.markTranscriptReady, {
          conversationId: link.conversationId,
        });

        await ctx.runMutation(systemApi.beyondPresenceCallLinks.updateLastProcessedSentAt, {
          callId,
          sentAt: sentAtMs,
        });

        link = await ctx.runQuery(systemApi.beyondPresenceCallLinks.getByCallId, {
          callId,
        });
        if (!link) break;
      }

      const endedAt = Date.now();
      await ctx.runMutation(systemApi.beyondPresenceCallLinks.markEnded, {
        callId,
        endedAt,
      });

      return jsonResponse(200, { ok: true });
    } catch (error) {
      console.error("Beyond Presence webhook error", error);
      return jsonResponse(200, { ok: true });
    }
  }),
});

export default router;
