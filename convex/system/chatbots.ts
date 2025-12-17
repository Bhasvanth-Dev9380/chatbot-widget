import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getByChatbotId = internalQuery({
  args: { chatbotId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatbots")
      .withIndex("by_chatbot_id", (q) => q.eq("chatbotId", args.chatbotId))
      .unique();
  },
});

export const getById = internalQuery({
  args: { id: v.id("chatbots") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getByOrganizationId = internalQuery({
  args: { organizationId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatbots")
      .withIndex("by_organization_id", (q) => q.eq("organizationId", args.organizationId))
      .collect();
  },
});
