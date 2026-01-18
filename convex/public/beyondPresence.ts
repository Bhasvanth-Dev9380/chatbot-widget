import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";

export const getOrCreateLanguageAgent = action({
  args: {
    entityId: v.string(),
    baseAgentId: v.string(),
    language: v.string(),
  },
  handler: async (ctx, args): Promise<{ agentId: string }> => {
    const result = await ctx.runAction(
      (internal as any).private.beyondPresence.getOrCreateLanguageAgent,
      {
        entityId: args.entityId,
        baseAgentId: args.baseAgentId,
        language: args.language,
      },
    );

    return result as { agentId: string };
  },
});
