import { query } from "../_generated/server";
import { v } from "convex/values";
import { supportAgent } from "../system/ai/agents/supportAgent";

const toEpochMs = (value: unknown): number | null => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value instanceof Date) return value.getTime();
  return null;
};

const normalizeRole = (value: unknown): "user" | "assistant" | null => {
  if (typeof value !== "string") return null;
  const role = value.toLowerCase();

  if (role === "user" || role === "human" || role === "customer" || role === "visitor") {
    return "user";
  }

  if (
    role === "assistant" ||
    role === "ai" ||
    role === "bot" ||
    role === "agent" ||
    role === "echo"
  ) {
    return "assistant";
  }

  return null;
};

const getMessageRole = (m: any): "user" | "assistant" | null => {
  return (
    normalizeRole(m?.role) ??
    normalizeRole(m?.message?.role) ??
    normalizeRole(m?.metadata?.role) ??
    null
  );
};

const getMessageTime = (m: any): number | null => {
  // Convex docs use _creationTime; Agent MessageDoc may use createdAt as string/Date.
  return (
    toEpochMs(m?._creationTime) ??
    toEpochMs(m?.createdAt) ??
    toEpochMs(m?.message?.createdAt) ??
    toEpochMs(m?.timestamp) ??
    toEpochMs(m?.message?.timestamp) ??
    toEpochMs(m?.metadata?.createdAt) ??
    null
  );
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dayBucketStartUtc = (epochMs: number) =>
  Math.floor(epochMs / DAY_MS) * DAY_MS;

const dayKeyUtc = (dayStartMs: number) => {
  // YYYY-MM-DD
  return new Date(dayStartMs).toISOString().slice(0, 10);
};

export const getKpis = query({
  args: {
    organizationId: v.string(),
    chatbotId: v.optional(v.id("chatbots")),
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, args) => {
    const from = Math.min(args.from, args.to);
    const to = Math.max(args.from, args.to);

    const conversations = args.chatbotId
      ? await ctx.db
          .query("conversations")
          .withIndex("by_chatbot_id", (q) => q.eq("chatbotId", args.chatbotId))
          .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
          .filter((q) => q.gte(q.field("_creationTime"), from))
          .filter((q) => q.lt(q.field("_creationTime"), to))
          .collect()
      : await (async () => {
          // When viewing "All chatbots", only include conversations for chatbots that still exist.
          // This avoids counting historical conversations from deleted chatbots.
          const chatbots = await ctx.db
            .query("chatbots")
            .withIndex("by_organization_id", (q) =>
              q.eq("organizationId", args.organizationId)
            )
            .collect();

          if (chatbots.length === 0) return [];

          const allowedChatbotIds = new Set(chatbots.map((b) => String(b._id)));

          const allOrgConversations = await ctx.db
            .query("conversations")
            .withIndex("by_organization_id", (q) =>
              q.eq("organizationId", args.organizationId)
            )
            .filter((q) => q.gte(q.field("_creationTime"), from))
            .filter((q) => q.lt(q.field("_creationTime"), to))
            .collect();

          return allOrgConversations.filter((c: any) =>
            c.chatbotId && allowedChatbotIds.has(String(c.chatbotId))
          );
        })();

    const sessions = conversations.length;

    const activeUsersSet = new Set<string>();

    let resolved = 0;
    let escalated = 0;
    let unresolved = 0;

    let totalUserMessages = 0;
    let totalAssistantMessages = 0;
    let totalMessages = 0;
    let bounced = 0;

    let frtSum = 0;
    let frtCount = 0;

    let responseSum = 0;
    let responseCount = 0;

    let turnsSum = 0;
    let turnsCount = 0;

    let durationSum = 0;
    let durationCount = 0;

    for (const convo of conversations) {
      activeUsersSet.add(String(convo.contactSessionId));

      if (convo.status === "resolved") resolved += 1;
      if (convo.status === "escalated") escalated += 1;
      if (convo.status === "unresolved") unresolved += 1;

      const messages = await supportAgent.listMessages(ctx, {
        threadId: convo.threadId,
        paginationOpts: { numItems: 200, cursor: null },
      });

      const sorted = [...messages.page]
        .map((m: any) => ({ m, t: getMessageTime(m), r: getMessageRole(m) }))
        .filter((x) => typeof x.t === "number")
        .sort((a, b) => (a.t as number) - (b.t as number));

      const userMsgs = sorted.filter((x) => x.r === "user");
      const assistantMsgs = sorted.filter((x) => x.r === "assistant");

      totalUserMessages += userMsgs.length;
      totalAssistantMessages += assistantMsgs.length;
      totalMessages += sorted.length;
      if (userMsgs.length <= 1) bounced += 1;

      const firstUser = userMsgs[0];
      if (firstUser) {
        const firstAssistantAfterUser = assistantMsgs.find(
          (x) => (x.t as number) >= (firstUser.t as number)
        );
        if (firstAssistantAfterUser) {
          frtSum += (firstAssistantAfterUser.t as number) - (firstUser.t as number);
          frtCount += 1;
        }
      }

      // Avg response time: pair the latest pending user message with the next assistant message.
      // If user sends multiple messages before assistant responds, we count from the latest one.
      let pendingUserTime: number | null = null;
      let convoResponsePairs = 0;
      for (const item of sorted) {
        if (item.r === "user") {
          pendingUserTime = item.t as number;
          continue;
        }

        if (item.r === "assistant" && pendingUserTime !== null) {
          const diff = (item.t as number) - pendingUserTime;
          if (diff >= 0) {
            responseSum += diff;
            responseCount += 1;
            convoResponsePairs += 1;
          }
          pendingUserTime = null;
        }
      }

      // Turns: count user->assistant response pairs (same pairing logic as avgResponseTime)
      // Used for avg turns/session.
      turnsSum += convoResponsePairs;
      turnsCount += 1;

      const firstMsg = sorted[0];
      const lastMsg = sorted[sorted.length - 1];
      if (firstMsg && lastMsg) {
        const duration = (lastMsg.t as number) - (firstMsg.t as number);
        if (duration >= 0) {
          durationSum += duration;
          durationCount += 1;
        }
      }
    }

    const activeUsers = activeUsersSet.size;

    const resolutionRate = sessions > 0 ? resolved / sessions : 0;
    const handoffRate = sessions > 0 ? escalated / sessions : 0;
    const containmentRate = sessions > 0 ? (sessions - escalated) / sessions : 0;
    const unresolvedRate = sessions > 0 ? unresolved / sessions : 0;

    const avgUserMessagesPerSession = sessions > 0 ? totalUserMessages / sessions : 0;
    const avgAssistantMessagesPerSession =
      sessions > 0 ? totalAssistantMessages / sessions : 0;
    const avgTotalMessagesPerSession = sessions > 0 ? totalMessages / sessions : 0;
    const bounceRate = sessions > 0 ? bounced / sessions : 0;

    const avgFirstResponseTimeMs = frtCount > 0 ? frtSum / frtCount : null;
    const avgResponseTimeMs = responseCount > 0 ? responseSum / responseCount : null;
    const avgTurnsPerSession = turnsCount > 0 ? turnsSum / turnsCount : 0;
    const avgSessionDurationMs = durationCount > 0 ? durationSum / durationCount : null;

    return {
      sessions,
      activeUsers,
      resolved,
      escalated,
      resolutionRate,
      handoffRate,
      containmentRate,
      unresolvedRate,
      avgUserMessagesPerSession,
      avgAssistantMessagesPerSession,
      avgTotalMessagesPerSession,
      avgTurnsPerSession,
      bounceRate,
      avgFirstResponseTimeMs,
      avgResponseTimeMs,
      avgSessionDurationMs,
    };
  },
});

export const getKpiTrends = query({
  args: {
    organizationId: v.string(),
    chatbotId: v.optional(v.id("chatbots")),
    from: v.number(),
    to: v.number(),
  },
  handler: async (ctx, args) => {
    const from = Math.min(args.from, args.to);
    const to = Math.max(args.from, args.to);

    const startDay = dayBucketStartUtc(from);
    const endDayExclusive = dayBucketStartUtc(to) + DAY_MS;

    type Bucket = {
      sessions: number;
      resolved: number;
      escalated: number;
      frtSum: number;
      frtCount: number;
      respSum: number;
      respCount: number;
    };

    const buckets = new Map<number, Bucket>();
    for (let day = startDay; day < endDayExclusive; day += DAY_MS) {
      buckets.set(day, {
        sessions: 0,
        resolved: 0,
        escalated: 0,
        frtSum: 0,
        frtCount: 0,
        respSum: 0,
        respCount: 0,
      });
    }

    const conversations = args.chatbotId
      ? await ctx.db
          .query("conversations")
          .withIndex("by_chatbot_id", (q) => q.eq("chatbotId", args.chatbotId))
          .filter((q) => q.eq(q.field("organizationId"), args.organizationId))
          .filter((q) => q.gte(q.field("_creationTime"), from))
          .filter((q) => q.lt(q.field("_creationTime"), to))
          .collect()
      : await (async () => {
          const chatbots = await ctx.db
            .query("chatbots")
            .withIndex("by_organization_id", (q) =>
              q.eq("organizationId", args.organizationId)
            )
            .collect();

          if (chatbots.length === 0) return [];

          const allowedChatbotIds = new Set(chatbots.map((b) => String(b._id)));

          const allOrgConversations = await ctx.db
            .query("conversations")
            .withIndex("by_organization_id", (q) =>
              q.eq("organizationId", args.organizationId)
            )
            .filter((q) => q.gte(q.field("_creationTime"), from))
            .filter((q) => q.lt(q.field("_creationTime"), to))
            .collect();

          return allOrgConversations.filter((c: any) =>
            c.chatbotId && allowedChatbotIds.has(String(c.chatbotId))
          );
        })();

    for (const convo of conversations) {
      const day = dayBucketStartUtc(convo._creationTime);
      const bucket = buckets.get(day);
      if (!bucket) continue;

      bucket.sessions += 1;
      if (convo.status === "resolved") bucket.resolved += 1;
      if (convo.status === "escalated") bucket.escalated += 1;

      const messages = await supportAgent.listMessages(ctx, {
        threadId: convo.threadId,
        paginationOpts: { numItems: 200, cursor: null },
      });

      const sorted = [...messages.page]
        .map((m: any) => ({ t: getMessageTime(m), r: getMessageRole(m) }))
        .filter((x) => typeof x.t === "number" && (x.r === "user" || x.r === "assistant"))
        .sort((a, b) => (a.t as number) - (b.t as number));

      const userMsgs = sorted.filter((x) => x.r === "user");
      const assistantMsgs = sorted.filter((x) => x.r === "assistant");

      const firstUser = userMsgs[0];
      if (firstUser) {
        const firstAssistantAfterUser = assistantMsgs.find(
          (x) => (x.t as number) >= (firstUser.t as number)
        );
        if (firstAssistantAfterUser) {
          bucket.frtSum += (firstAssistantAfterUser.t as number) - (firstUser.t as number);
          bucket.frtCount += 1;
        }
      }

      let pendingUserTime: number | null = null;
      for (const item of sorted) {
        if (item.r === "user") {
          pendingUserTime = item.t as number;
          continue;
        }

        if (item.r === "assistant" && pendingUserTime !== null) {
          const diff = (item.t as number) - pendingUserTime;
          if (diff >= 0) {
            bucket.respSum += diff;
            bucket.respCount += 1;
          }
          pendingUserTime = null;
        }
      }
    }

    const points = Array.from(buckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([dayStartMs, b]) => {
        const resolutionRate = b.sessions > 0 ? b.resolved / b.sessions : null;
        const containmentRate = b.sessions > 0 ? (b.sessions - b.escalated) / b.sessions : null;
        const avgFirstResponseTimeMs = b.frtCount > 0 ? b.frtSum / b.frtCount : null;
        const avgResponseTimeMs = b.respCount > 0 ? b.respSum / b.respCount : null;

        return {
          day: dayKeyUtc(dayStartMs),
          dayStartMs,
          sessions: b.sessions,
          resolutionRate,
          containmentRate,
          avgFirstResponseTimeMs,
          avgResponseTimeMs,
        };
      });

    return { points };
  },
});
