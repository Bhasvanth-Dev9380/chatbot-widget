import { createTool } from "@convex-dev/agent";
import z from "zod";
import { internal } from "../../../_generated/api";

export const resolveConversation = createTool({
  description: "Resolve a conversation when the user's issue has been addressed. Pass an empty string for reason if none.",
  args: z.object({
    reason: z.string().describe("Reason for resolution, can be empty string"),
  }),
  handler: async (ctx, args) => {
    if (!ctx.threadId) {
      return "Missing thread ID";
    }

    await ctx.runMutation(internal.system.conversations.resolve, {
      threadId: ctx.threadId,
    });

    return "Conversation resolved";
  },
});