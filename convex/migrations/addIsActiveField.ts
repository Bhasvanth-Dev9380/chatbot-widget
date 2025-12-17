import { internalMutation } from "../_generated/server";

/**
 * One-time migration to add isActive field to existing chatbots
 * Run this once to migrate existing chatbots to the new schema
 */
export const addIsActiveToExistingChatbots = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all chatbots
    const chatbots = await ctx.db.query("chatbots").collect();

    let updatedCount = 0;

    for (const chatbot of chatbots) {
      // Check if chatbot already has isActive field
      if ((chatbot as any).isActive === undefined) {
        await ctx.db.patch(chatbot._id, {
          isActive: false,
        });
        updatedCount++;
      }
    }

    return {
      success: true,
      message: `Updated ${updatedCount} chatbots with isActive field`,
      totalChatbots: chatbots.length,
    };
  },
});
