import { internalMutation } from "../_generated/server";

export const cleanupUsersLegacyOrganizationId = internalMutation({
  args: {},
  handler: async (ctx) => {
    const users: any[] = await ctx.db.query("users").collect();

    let updated = 0;
    for (const u of users) {
      const hasLegacy = u && typeof u === "object" && "organizationId" in u;
      const entityId = (u as any).entityId;
      const organizationId = (u as any).organizationId;

      if (hasLegacy || (!entityId && organizationId)) {
        await ctx.db.patch(u._id, {
          entityId: entityId ?? organizationId,
          organizationId: undefined,
        } as any);
        updated++;
      }
    }

    return { scanned: users.length, updated };
  },
});
