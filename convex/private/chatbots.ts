import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";

// Generate a unique chatbot ID (similar to Convex IDs but for string field)
function generateChatbotId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/* -------------------------------------------------
   CREATE
------------------------------------------------- */
export const create = mutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    knowledgeBaseId: v.optional(v.id("knowledgeBases")),
    greetMessage: v.string(),
    defaultSuggestions: v.object({
      suggestion1: v.optional(v.string()),
      suggestion2: v.optional(v.string()),
      suggestion3: v.optional(v.string()),
    }),
    isDefault: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // unset existing default if needed
    if (args.isDefault) {
      const existingDefaults = await ctx.db
        .query("chatbots")
        .withIndex("by_organization_id", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .filter((q) => q.eq(q.field("isDefault"), true))
        .collect();

      for (const bot of existingDefaults) {
        await ctx.db.patch(bot._id, { isDefault: false });
      }
    }

    const now = Date.now();
    const chatbotId = generateChatbotId();

    const docId = await ctx.db.insert("chatbots", {
      organizationId: args.organizationId,
      name: args.name,
      description: args.description,
      knowledgeBaseId: args.knowledgeBaseId,
      greetMessage: args.greetMessage,
      defaultSuggestions: args.defaultSuggestions,
      isActive: true,
      isDefault: args.isDefault ?? false,
      chatbotId, // Set the string chatbotId for embed snippets
      createdAt: now,
      updatedAt: now,
    });

    return docId;
  },
});

/* -------------------------------------------------
   UPDATE
------------------------------------------------- */
export const update = mutation({
  args: {
    chatbotId: v.id("chatbots"),
    organizationId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    knowledgeBaseId: v.optional(v.id("knowledgeBases")),
    greetMessage: v.optional(v.string()),
    defaultSuggestions: v.optional(
      v.object({
        suggestion1: v.optional(v.string()),
        suggestion2: v.optional(v.string()),
        suggestion3: v.optional(v.string()),
      })
    ),
    isActive: v.optional(v.boolean()),
    isDefault: v.optional(v.boolean()),
    appearance: v.optional(
      v.object({
        primaryColor: v.optional(v.string()),
        size: v.optional(
          v.union(v.number(), v.literal("small"), v.literal("medium"), v.literal("large"))
        ),
        logo: v.optional(
          v.object({
            type: v.union(v.literal("default"), v.literal("upload"), v.literal("url")),
            storageId: v.optional(v.id("_storage")),
            externalUrl: v.optional(v.string()),
            fileName: v.optional(v.string()),
            mimeType: v.optional(v.string()),
            size: v.optional(v.number()),
            updatedAt: v.number(),
          })
        ),
      })
    ),
    customSystemPrompt: v.optional(v.string()),
    vapiSettings: v.optional(
      v.object({
        assistantId: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const chatbot = await ctx.db.get(args.chatbotId);

    if (!chatbot) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Chatbot not found",
      });
    }

    if (chatbot.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    // handle default switching
    if (args.isDefault && !chatbot.isDefault) {
      const existingDefaults = await ctx.db
        .query("chatbots")
        .withIndex("by_organization_id", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .filter((q) => q.eq(q.field("isDefault"), true))
        .collect();

      for (const bot of existingDefaults) {
        await ctx.db.patch(bot._id, { isDefault: false });
      }
    }

    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.knowledgeBaseId !== undefined)
      updates.knowledgeBaseId = args.knowledgeBaseId;
    if (args.greetMessage !== undefined)
      updates.greetMessage = args.greetMessage;
    if (args.defaultSuggestions !== undefined)
      updates.defaultSuggestions = args.defaultSuggestions;
    if (args.isActive !== undefined) updates.isActive = args.isActive;
    if (args.isDefault !== undefined) updates.isDefault = args.isDefault;
    if (args.appearance !== undefined) {
      // Merge with existing appearance to preserve logo if not provided
      const existingAppearance = chatbot.appearance || {};
      const appearanceUpdates: Record<string, unknown> = { ...args.appearance };
      if (typeof appearanceUpdates.size === "string") {
        const legacySizes: Record<string, number> = {
          small: 368,
          medium: 418,
          large: 468,
        };
        appearanceUpdates.size = legacySizes[appearanceUpdates.size] ?? existingAppearance.size;
      }
      updates.appearance = { ...existingAppearance, ...appearanceUpdates };
    }
    if (args.customSystemPrompt !== undefined)
      updates.customSystemPrompt = args.customSystemPrompt;
    if (args.vapiSettings !== undefined)
      updates.vapiSettings = args.vapiSettings;

    await ctx.db.patch(args.chatbotId, updates);
  },
});

/* -------------------------------------------------
   DELETE
------------------------------------------------- */
export const remove = mutation({
  args: {
    chatbotId: v.id("chatbots"),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const chatbot = await ctx.db.get(args.chatbotId);

    if (!chatbot) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Chatbot not found",
      });
    }

    if (chatbot.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    // prevent deleting last default
    if (chatbot.isDefault) {
      const all = await ctx.db
        .query("chatbots")
        .withIndex("by_organization_id", (q) =>
          q.eq("organizationId", args.organizationId)
        )
        .collect();

      if (all.length === 1) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: "Cannot delete the last chatbot",
        });
      }
    }

    await ctx.db.delete(args.chatbotId);
  },
});

/* -------------------------------------------------
   GET MANY (FIXED)
------------------------------------------------- */
export const getMany = query({
  args: {
    organizationId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("chatbots")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

/* -------------------------------------------------
   GET ONE
------------------------------------------------- */
export const getOne = query({
  args: {
    chatbotId: v.id("chatbots"),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const chatbot = await ctx.db.get(args.chatbotId);

    if (!chatbot) return null;

    if (chatbot.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    return chatbot;
  },
});

/* -------------------------------------------------
   GET ACTIVE
------------------------------------------------- */
export const getActive = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("chatbots")
      .withIndex("by_organization_and_active", (q) =>
        q.eq("organizationId", args.organizationId).eq("isActive", true)
      )
      .collect();
  },
});

/* -------------------------------------------------
   DEBUG: GET BY KNOWLEDGE BASE ID (internal Convex _id)
------------------------------------------------- */
export const debugGetByKnowledgeBaseId = query({
  args: {
    knowledgeBaseId: v.id("knowledgeBases"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("chatbots")
      .withIndex("by_knowledge_base_id", (q) =>
        q.eq("knowledgeBaseId", args.knowledgeBaseId)
      )
      .collect();
  },
});

/* -------------------------------------------------
   GENERATE UPLOAD URL FOR LOGO
------------------------------------------------- */
export const generateLogoUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

/* -------------------------------------------------
   UPLOAD LOGO
------------------------------------------------- */
export const uploadLogo = mutation({
  args: {
    chatbotId: v.id("chatbots"),
    organizationId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const chatbot = await ctx.db.get(args.chatbotId);

    if (!chatbot) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Chatbot not found",
      });
    }

    if (chatbot.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    // Delete old logo storage if exists
    if (chatbot.appearance?.logo?.type === "upload" && chatbot.appearance?.logo?.storageId) {
      try {
        await ctx.storage.delete(chatbot.appearance.logo.storageId);
      } catch (error) {
        console.error("Failed to delete old logo:", error);
      }
    }

    const existingAppearance = chatbot.appearance || {};

    await ctx.db.patch(args.chatbotId, {
      appearance: {
        ...existingAppearance,
        logo: {
          type: "upload",
          storageId: args.storageId,
          fileName: args.fileName,
          mimeType: args.mimeType,
          size: args.size,
          updatedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/* -------------------------------------------------
   SET LOGO URL
------------------------------------------------- */
export const setLogoUrl = mutation({
  args: {
    chatbotId: v.id("chatbots"),
    organizationId: v.string(),
    externalUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const chatbot = await ctx.db.get(args.chatbotId);

    if (!chatbot) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Chatbot not found",
      });
    }

    if (chatbot.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    // Delete old logo storage if exists
    if (chatbot.appearance?.logo?.type === "upload" && chatbot.appearance?.logo?.storageId) {
      try {
        await ctx.storage.delete(chatbot.appearance.logo.storageId);
      } catch (error) {
        console.error("Failed to delete old logo:", error);
      }
    }

    const existingAppearance = chatbot.appearance || {};

    await ctx.db.patch(args.chatbotId, {
      appearance: {
        ...existingAppearance,
        logo: {
          type: "url",
          externalUrl: args.externalUrl,
          updatedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/* -------------------------------------------------
   RESET LOGO TO DEFAULT
------------------------------------------------- */
export const resetLogo = mutation({
  args: {
    chatbotId: v.id("chatbots"),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const chatbot = await ctx.db.get(args.chatbotId);

    if (!chatbot) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Chatbot not found",
      });
    }

    if (chatbot.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Invalid Organization ID",
      });
    }

    // Delete old logo storage if exists
    if (chatbot.appearance?.logo?.type === "upload" && chatbot.appearance?.logo?.storageId) {
      try {
        await ctx.storage.delete(chatbot.appearance.logo.storageId);
      } catch (error) {
        console.error("Failed to delete old logo:", error);
      }
    }

    const existingAppearance = chatbot.appearance || {};

    await ctx.db.patch(args.chatbotId, {
      appearance: {
        ...existingAppearance,
        logo: {
          type: "default",
          updatedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/* -------------------------------------------------
   GET LOGO URL
------------------------------------------------- */
export const getLogoUrl = query({
  args: {
    chatbotId: v.id("chatbots"),
  },
  handler: async (ctx, args) => {
    const chatbot = await ctx.db.get(args.chatbotId);

    if (!chatbot || !chatbot.appearance?.logo) {
      return null;
    }

    const logo = chatbot.appearance.logo;

    if (logo.type === "url" && logo.externalUrl) {
      return logo.externalUrl;
    }

    if (logo.type === "upload" && logo.storageId) {
      return await ctx.storage.getUrl(logo.storageId);
    }

    return null;
  },
});
