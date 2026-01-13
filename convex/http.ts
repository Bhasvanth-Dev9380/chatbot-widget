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

function normalizeId(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = typeof value === "string" ? value : String(value);
  const trimmed = s.trim();
  return trimmed ? trimmed : undefined;
}

function extractAgentId(payload: any): string | undefined {
  return normalizeId(
    payload?.call_data?.agentId ??
      payload?.call_data?.agent_id ??
      payload?.call_data?.agent?.id ??
      payload?.call_data?.agent?.agentId ??
      payload?.call_data?.agent?.agent_id ??
      payload?.call_data?.agent ??
      payload?.agentId ??
      payload?.agent_id ??
      payload?.agent?.id ??
      payload?.call?.agentId ??
      payload?.call?.agent_id ??
      payload?.call?.agent?.id ??
      payload?.call?.agent?.agent_id,
  );
}

function extractCallId(payload: any): string | undefined {
  return normalizeId(
    payload?.call_id ??
      payload?.callId ??
      payload?.call?.id ??
      payload?.call?.call_id ??
      payload?.call_data?.call_id ??
      payload?.call_data?.callId,
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
      const normalizedEventType =
        typeof eventType === "string" ? eventType.trim().toLowerCase() : "";

      const isTestEvent = normalizedEventType === "test";
      const isMessageEvent =
        normalizedEventType === "message" ||
        normalizedEventType.startsWith("message") ||
        normalizedEventType.endsWith("message");
      const isCallEndedEvent =
        normalizedEventType === "call_ended" ||
        normalizedEventType === "call.ended" ||
        normalizedEventType === "call-ended" ||
        normalizedEventType.endsWith("call_ended") ||
        normalizedEventType.endsWith("call.ended");

      if (isTestEvent) {
        return jsonResponse(200, { ok: true });
      }

      // Beyond Presence may send additional events (e.g. call_started) that include
      // call identifiers. We still want to create the call link early so later
      // events (including call_ended) can be processed even if agentId is omitted.

      const callId: string | undefined = extractCallId(payload);
      if (!callId) {
        console.warn("[beyond-presence/webhook] Missing callId in payload", {
          eventType,
          keys: Object.keys(payload ?? {}),
          callKeys: Object.keys(payload?.call ?? {}),
          callDataKeys: Object.keys(payload?.call_data ?? {}),
        });
        return jsonResponse(200, { ok: true });
      }

      console.log("[beyond-presence/webhook] Incoming", {
        eventType,
        normalizedEventType,
        callId,
        hasCall: Boolean(payload?.call),
        hasCallData: Boolean(payload?.call_data),
      });

      let link = await ctx.runQuery(systemApi.beyondPresenceCallLinks.getByCallId, {
        callId,
      });

      if (link) {
        console.log("[beyond-presence/webhook] Found existing link", {
          callId,
          conversationId: link.conversationId,
        });
      }

      if (!link) {
        let agentId: string | undefined = extractAgentId(payload);
        const originalAgentId = agentId;
        const userName: string | undefined = extractUserName(payload);

        if (!agentId) {
          console.warn("[beyond-presence/webhook] Missing agentId in payload", {
            callId,
            eventType,
            keys: Object.keys(payload ?? {}),
            callKeys: Object.keys(payload?.call ?? {}),
            callDataKeys: Object.keys(payload?.call_data ?? {}),
          });
          // Can't create a link without an agentId, but we still ACK the webhook.
          return jsonResponse(200, { ok: true });
        }

        console.log("[beyond-presence/webhook] Creating link", {
          callId,
          agentId,
        });

        const languageAgent = await ctx.runQuery(
          systemApi.beyondPresenceLanguageAgents.getByAgentId,
          {
            agentId,
          },
        );

        if (languageAgent?.baseAgentId) {
          agentId = languageAgent.baseAgentId;
        }

        let chatbots = await ctx.runQuery(
          systemApi.chatbots.getManyByBeyondPresenceAgentId,
          {
            beyondPresenceAgentId: agentId,
          },
        );

        if ((!chatbots || chatbots.length === 0) && originalAgentId && originalAgentId !== agentId) {
          chatbots = await ctx.runQuery(
            systemApi.chatbots.getManyByBeyondPresenceAgentId,
            {
              beyondPresenceAgentId: originalAgentId,
            },
          );
        }

        if (!chatbots || chatbots.length === 0) {
          console.warn("[beyond-presence/webhook] No chatbots found for agentId", {
            callId,
            agentId,
            originalAgentId,
          });
          return jsonResponse(200, { ok: true });
        }

        const primaryOrgId = chatbots[0]?.entityId;
        const allSameOrg = chatbots.every(
          (c: any) => c.entityId === primaryOrgId,
        );
        if (!primaryOrgId || !allSameOrg) {
          console.warn("[beyond-presence/webhook] Chatbots org mismatch for agentId", {
            callId,
            agentId,
            organizations: chatbots.map((c: any) => c.entityId),
          });
        }

        if (!link) {
          const chatbot = chatbots[0];
          if (!chatbot?.entityId) {
            console.warn("[beyond-presence/webhook] Chatbot missing entityId", {
              callId,
              agentId,
              chatbotId: chatbot?._id,
            });
            return jsonResponse(200, { ok: true });
          }

          // If the web widget already created a pending video conversation, attach the call to it.
          // This ensures transcripts appear in the widget inbox (same contactSessionId).
          try {
            const candidate = await ctx.runQuery(
              systemApi.beyondPresenceCallLinks.findLatestUnlinkedConversationForChatbots,
              {
                entityId: chatbot.entityId,
                chatbotIds: chatbots.map((c: any) => c._id),
                createdAfter: Date.now() - 10 * 60 * 1000,
              },
            );

            if (candidate?.conversationId && candidate?.threadId) {
              await ctx.runMutation(systemApi.beyondPresenceCallLinks.createLink, {
                callId,
                conversationId: candidate.conversationId,
                threadId: candidate.threadId,
              });
            } else {
              const { threadId } = await supportAgent.createThread(ctx, {
                // Use a per-call userId to avoid reusing a previous thread's message history.
                userId: `${chatbot.entityId}_${callId}`,
              });

              await ctx.runMutation(systemApi.beyondPresenceCallLinks.createConversationAndLink, {
                callId,
                threadId,
                entityId: chatbot.entityId,
                chatbotId: chatbot._id,
                userName,
              });
            }
          } catch (error) {
            console.error("[beyond-presence/webhook] Failed to link/create conversation", {
              callId,
              agentId,
              entityId: chatbot.entityId,
              chatbotId: chatbot._id,
              error,
            });
            return jsonResponse(200, { ok: true });
          }

          link = await ctx.runQuery(systemApi.beyondPresenceCallLinks.getByCallId, {
            callId,
          });

          if (!link) {
            console.error("[beyond-presence/webhook] Link still missing after creation", {
              callId,
              agentId,
            });
            return jsonResponse(200, { ok: true });
          }

          console.log("[beyond-presence/webhook] Link created", {
            callId,
            conversationId: link.conversationId,
          });
        }
      }

      // If this is an event we don't process into transcript messages, stop here.
      if (!isMessageEvent && !isCallEndedEvent) {
        return jsonResponse(200, { ok: true });
      }

      if (isMessageEvent) {
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
      const messages =
        (Array.isArray((body as any).messages) ? (body as any).messages : null) ??
        (Array.isArray((payload as any)?.call?.messages)
          ? (payload as any).call.messages
          : null) ??
        (Array.isArray((payload as any)?.call_data?.messages)
          ? (payload as any).call_data.messages
          : null) ??
        (Array.isArray((payload as any)?.transcript) ? (payload as any).transcript : []);

      const sorted: Array<any & { sentAtMs: number | null }> = (messages as any[])
        .map((m: any) => ({ ...m, sentAtMs: toMillis((m as any).sent_at) }))
        .sort(
          (
            a: any & { sentAtMs?: number | null },
            b: any & { sentAtMs?: number | null },
          ) => {
            const ax = a.sentAtMs ?? Number.POSITIVE_INFINITY;
            const bx = b.sentAtMs ?? Number.POSITIVE_INFINITY;
            return ax - bx;
          },
        );

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

      // Even if Beyond Presence doesn't provide messages in the call_ended event,
      // we should still un-hide the conversation in the dashboard.
      await ctx.runMutation(systemApi.conversations.markTranscriptReady, {
        conversationId: link.conversationId,
      });

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
