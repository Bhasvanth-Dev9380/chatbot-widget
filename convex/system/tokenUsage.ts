import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

function dayStartUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const record = internalMutation({
  args: {
    organizationId: v.string(),
    provider: v.string(),
    totalTokens: v.number(),
    createdAt: v.optional(v.number()),
    model: v.optional(v.string()),
    kind: v.optional(v.string()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const createdAt = args.createdAt ?? Date.now();
    const dayStart = dayStartUtc(createdAt);

    await ctx.db.insert("tokenUsageEvents", {
      organizationId: args.organizationId,
      provider: args.provider,
      model: args.model,
      kind: args.kind,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      createdAt,
    });

    const existing = await ctx.db
      .query("tokenUsageDaily")
      .withIndex("by_org_day_provider", (q) =>
        q
          .eq("organizationId", args.organizationId)
          .eq("dayStart", dayStart)
          .eq("provider", args.provider),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("tokenUsageDaily", {
        organizationId: args.organizationId,
        dayStart,
        provider: args.provider,
        totalTokens: args.totalTokens,
        updatedAt: createdAt,
      });
      return;
    }

    await ctx.db.patch(existing._id, {
      totalTokens: existing.totalTokens + args.totalTokens,
      updatedAt: createdAt,
    });
  },
});
