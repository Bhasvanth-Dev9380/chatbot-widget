import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const listByEntityId = internalQuery({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("deletedFiles")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId),
      )
      .collect();

    return rows.map((r) => r.storageId);
  },
});
