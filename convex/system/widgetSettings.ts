import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getByEntityId = internalQuery({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const widgetSettings = await ctx.db
      .query("widgetSettings")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId)
      )
      .unique();

    return widgetSettings;
  },
});
