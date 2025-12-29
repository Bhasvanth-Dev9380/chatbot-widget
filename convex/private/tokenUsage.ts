import { query } from "../_generated/server";
import { v } from "convex/values";

function monthStartUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function nextMonthStartUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function dayStartUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const getMonthToDate = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const from = monthStartUtc(now);
    const to = nextMonthStartUtc(now);

    const rows = await ctx.db
      .query("tokenUsageDaily")
      .withIndex("by_org_and_day", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .gte("dayStart", from)
          .lt("dayStart", to),
      )
      .collect();

    const byProvider: Record<string, number> = {};
    let totalTokens = 0;

    for (const r of rows) {
      totalTokens += r.totalTokens;
      byProvider[r.provider] = (byProvider[r.provider] ?? 0) + r.totalTokens;
    }

    const todayStart = dayStartUtc(now);
    const todayRows = rows.filter((r) => r.dayStart === todayStart);
    const todayTokens = todayRows.reduce((sum, r) => sum + r.totalTokens, 0);

    return {
      monthStart: from,
      totalTokens,
      todayTokens,
      byProvider,
    };
  },
});
