import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

function dayStartUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const record = internalMutation({
  args: {
    organizationId: v.string(),
    databaseBytes: v.optional(v.number()),
    vectorBytes: v.optional(v.number()),
    fileBytes: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const createdAt = args.createdAt ?? Date.now();
    const dayStart = dayStartUtc(createdAt);

    const deltaDb = args.databaseBytes ?? 0;
    const deltaVector = args.vectorBytes ?? 0;
    const deltaFile = args.fileBytes ?? 0;

    if (deltaDb <= 0 && deltaVector <= 0 && deltaFile <= 0) return;

    const existing = await ctx.db
      .query("convexUsageEstimatedDaily")
      .withIndex("by_org_and_day", (q) =>
        q.eq("organizationId", args.organizationId).eq("dayStart", dayStart),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("convexUsageEstimatedDaily", {
        organizationId: args.organizationId,
        dayStart,
        databaseBytes: deltaDb,
        vectorBytes: deltaVector,
        fileBytes: deltaFile,
        updatedAt: createdAt,
      });
      return;
    }

    await ctx.db.patch(existing._id, {
      databaseBytes: existing.databaseBytes + deltaDb,
      vectorBytes: existing.vectorBytes + deltaVector,
      fileBytes: existing.fileBytes + deltaFile,
      updatedAt: createdAt,
    });
  },
});
