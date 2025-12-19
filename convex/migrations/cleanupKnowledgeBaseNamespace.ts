import { internalMutation } from "../_generated/server";

export const cleanupKnowledgeBases = internalMutation({
  handler: async (ctx) => {
    const kbs = await ctx.db.query("knowledgeBases").collect();

    for (const kb of kbs) {
      if ("namespace" in kb) {
        console.log(
          `[migration] removing legacy namespace from KB ${kb._id}`
        );

        await ctx.db.patch(kb._id, {
          // Convex removes fields when set to undefined
          namespace: undefined,
        } as any);
      }
    }
  },
});
