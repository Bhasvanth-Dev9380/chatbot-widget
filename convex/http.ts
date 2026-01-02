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

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: seconds vs milliseconds
    return value > 1e12 ? value : Math.floor(value * 1000);
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) {
    return asNum > 1e12 ? asNum : Math.floor(asNum * 1000);
  }

  const t = Date.parse(trimmed);
  return Number.isFinite(t) ? t : null;
}

function toRole(sender: unknown): "user" | "assistant" {
  const s = typeof sender === "string" ? sender.toLowerCase() : "";
  if (s === "agent" || s === "assistant" || s === "ai" || s === "bot") return "assistant";
  return "user";
}

function extractAgentId(payload: any): string | undefined {
  return (
    payload?.call_data?.agentId ??
    payload?.call_data?.agent_id ??
    payload?.call_data?.agent ??
    payload?.agentId ??
    payload?.agent_id ??
    payload?.call?.agentId ??
    payload?.call?.agent_id ??
    payload?.call?.agent?.id
  );
}

function extractUserName(payload: any): string | undefined {
  return (
    payload?.call_data?.userName ??
    payload?.call_data?.user_name ??
    payload?.user_name ??
    payload?.userName
  );
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

      const callId: string | undefined =
        payload?.call_id ?? payload?.callId ?? payload?.call?.id;
      if (!callId) {
        return jsonResponse(200, { ok: true });
      }

      let link = await ctx.runQuery(systemApi.beyondPresenceCallLinks.getByCallId, {
        callId,
      });

      if (!link) {
        let agentId: string | undefined = extractAgentId(payload);
        const userName: string | undefined = extractUserName(payload);

        if (!agentId) {
          console.warn("[beyond-presence/webhook] Missing agentId in payload", {
            callId,
            keys: Object.keys(payload ?? {}),
          });
          return jsonResponse(200, { ok: true });
        }

        const languageAgent = await ctx.runQuery(
          systemApi.beyondPresenceLanguageAgents.getByAgentId,
          {
            agentId,
          },
        );

        if (languageAgent?.baseAgentId) {
          agentId = languageAgent.baseAgentId;
        }

        const chatbots = await ctx.runQuery(
          systemApi.chatbots.getManyByBeyondPresenceAgentId,
          {
            beyondPresenceAgentId: agentId,
          },
        );

        if (!chatbots || chatbots.length === 0) {
          console.warn("[beyond-presence/webhook] No chatbots found for agentId", {
            callId,
            agentId,
          });
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
        const sentAtMsRaw = toMillis((body as any)?.message?.sent_at);
        const sentAtMs = sentAtMsRaw ?? Date.now();

        const lastProcessed = link.lastProcessedSentAt;
        const monotonicSentAt =
          lastProcessed !== undefined && sentAtMs <= lastProcessed
            ? lastProcessed + 1
            : sentAtMs;

        const role = toRole((body as any)?.message?.sender);
        const messageText = String(
          (body as any)?.message?.message ??
            (body as any)?.message?.text ??
            (body as any)?.message?.content ??
            "",
        );
        const content = `[Video] ${messageText}`;

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
          sentAt: monotonicSentAt,
        });

        return jsonResponse(200, { ok: true });
      }

      const body = payload as WebhookCallEndedEvent;
      const messages = Array.isArray(body.messages) ? body.messages : [];

      const sorted = messages
        .map((m) => ({ ...m, sentAtMs: toMillis((m as any).sent_at) }))
        .sort((a, b) => {
          const ax = a.sentAtMs ?? Number.POSITIVE_INFINITY;
          const bx = b.sentAtMs ?? Number.POSITIVE_INFINITY;
          return ax - bx;
        });

      for (const m of sorted) {
        const sentAtMs = (m.sentAtMs as number | null) ?? Date.now();
        if (
          link.lastProcessedSentAt !== undefined &&
          sentAtMs <= link.lastProcessedSentAt
        ) {
          // Same rationale as above: allow same-timestamp messages.
          // We'll still record by making timestamp monotonic.
        }

        const monotonicSentAt =
          link.lastProcessedSentAt !== undefined && sentAtMs <= link.lastProcessedSentAt
            ? link.lastProcessedSentAt + 1
            : sentAtMs;

        const role = toRole((m as any).sender);
        const content = `[Video] ${String((m as any).message ?? "")}`;

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
          sentAt: monotonicSentAt,
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
