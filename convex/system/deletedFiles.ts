import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const listByOrganizationId = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("deletedFiles")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    return rows.map((r) => r.storageId);
  },
});
