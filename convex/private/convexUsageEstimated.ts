import { v } from "convex/values";
import { query } from "../_generated/server";

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
      .query("convexUsageEstimatedDaily")
      .withIndex("by_org_and_day", (q) =>
        q.eq("organizationId", args.organizationId).gte("dayStart", from).lt("dayStart", to),
      )
      .collect();

    let databaseBytes = 0;
    let vectorBytes = 0;
    let fileBytes = 0;

    for (const r of rows) {
      databaseBytes += r.databaseBytes;
      vectorBytes += r.vectorBytes;
      fileBytes += r.fileBytes;
    }

    const todayStart = dayStartUtc(now);
    const todayRows = rows.filter((r) => r.dayStart === todayStart);
    const today = {
      databaseBytes: todayRows.reduce((s, r) => s + r.databaseBytes, 0),
      vectorBytes: todayRows.reduce((s, r) => s + r.vectorBytes, 0),
      fileBytes: todayRows.reduce((s, r) => s + r.fileBytes, 0),
    };

    return {
      monthStart: from,
      total: { databaseBytes, vectorBytes, fileBytes },
      today,
    };
  },
});
