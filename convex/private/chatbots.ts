import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";

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

    const chatbotId = await ctx.db.insert("chatbots", {
      organizationId: args.organizationId,
      name: args.name,
      description: args.description,
      knowledgeBaseId: args.knowledgeBaseId,
      greetMessage: args.greetMessage,
      defaultSuggestions: args.defaultSuggestions,
      isActive: true,
      isDefault: args.isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    });

    return chatbotId;
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
          v.union(v.literal("small"), v.literal("medium"), v.literal("large"))
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
      updates.appearance = { ...existingAppearance, ...args.appearance };
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
    paginationOpts: v.optional(paginationOptsValidator),
  },
  handler: async (ctx, args) => {
    const pagination =
      args.paginationOpts ?? {
        numItems: 100,
        cursor: null,
      };

    return ctx.db
      .query("chatbots")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId)
      )
      .order("desc")
      .paginate(pagination);
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
