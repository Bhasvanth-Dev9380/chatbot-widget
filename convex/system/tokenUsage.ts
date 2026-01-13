import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

function dayStartUtc(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const record = internalMutation({
  args: {
    entityId: v.string(),
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
      entityId: args.entityId,
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
      .withIndex("by_entity_day_provider", (q) =>
        q
          .eq("entityId", args.entityId)
          .eq("dayStart", dayStart)
          .eq("provider", args.provider),
      )
      .unique();

    if (!existing) {
      await ctx.db.insert("tokenUsageDaily", {
        entityId: args.entityId,
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
