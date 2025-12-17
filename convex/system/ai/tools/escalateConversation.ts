import { createTool } from "@convex-dev/agent";
import z from "zod";
import { internal } from "../../../_generated/api";

export const escalateConversation = createTool({
  description: "Escalate a conversation to a human operator when you cannot help the user. Pass an empty string for reason if none.",
  args: z.object({
    reason: z.string().describe("Reason for escalation, can be empty string"),
  }),
  handler: async (ctx, args) => {
    if (!ctx.threadId) {
      return "Missing thread ID";
    }

    await ctx.runMutation(internal.system.conversations.escalate, {
      threadId: ctx.threadId,
    });

    return "Conversation escalated to a human operator.";
  },
});