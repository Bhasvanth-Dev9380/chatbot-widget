import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

// Generate a unique chatbot ID
function generateChatbotId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

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

export const getByBeyondPresenceAgentId = internalQuery({
  args: { beyondPresenceAgentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatbots")
      .withIndex("by_beyond_presence_agent_id", (q) =>
        q.eq("beyondPresenceAgentId", args.beyondPresenceAgentId)
      )
      .unique();
  },
});

export const getManyByBeyondPresenceAgentId = internalQuery({
  args: { beyondPresenceAgentId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("chatbots")
      .withIndex("by_beyond_presence_agent_id", (q) =>
        q.eq("beyondPresenceAgentId", args.beyondPresenceAgentId),
      )
      .collect();
  },
});

// Migration: Add chatbotId to existing chatbots that don't have one
export const migrateAddChatbotIds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const chatbots = await ctx.db.query("chatbots").collect();
    let updated = 0;
    
    for (const chatbot of chatbots) {
      if (!chatbot.chatbotId) {
        await ctx.db.patch(chatbot._id, {
          chatbotId: generateChatbotId(),
        });
        updated++;
      }
    }
    
    return { total: chatbots.length, updated };
  },
});
