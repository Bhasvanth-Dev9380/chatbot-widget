// Migration script to add caseId to existing conversations
// Run with: npx convex run migrations/addCaseIdToExistingConversations

import { internalMutation } from "../_generated/server";

export default internalMutation({
  handler: async (ctx) => {
    // Get all conversations without a caseId
    const conversations = await ctx.db.query("conversations").collect();

    let updated = 0;

    for (const conversation of conversations) {
      // Check if caseId already exists (for safety)
      if (!conversation.caseId) {
        // Generate unique case ID
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        const caseId = `CASE-${timestamp}-${random}`;

        await ctx.db.patch(conversation._id, { caseId });
        updated++;
      }
    }

    return {
      message: `Migration complete! Updated ${updated} conversations.`,
      totalConversations: conversations.length,
      updated
    };
  },
});
