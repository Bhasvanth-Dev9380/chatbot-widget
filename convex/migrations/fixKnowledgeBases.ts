import { internalMutation } from "../_generated/server";

export const fixKnowledgeBases = internalMutation({
  handler: async (ctx) => {
    const kbs = await ctx.db.query("knowledgeBases").collect();

    for (const kb of kbs) {
      if (kb.ragNamespace) continue;

      const ragNamespace =
        (kb as any).namespace ??
        `${kb.organizationId}_${kb.knowledgeBaseId}`;

      console.log(
        `[migration] fixing KB ${kb._id} → ragNamespace=${ragNamespace}`
      );

      await ctx.db.patch(kb._id, {
        ragNamespace,
      });
    }
  },
});
