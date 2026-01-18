/**
 * Settings CRUD operations
 * Mirroring settings operations in entity_controller.py
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { generateId } from "./helpers";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SETTINGS CRUD OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Create settings for an entity
 * Equivalent to: create_settings() in entity_controller.py
 */
export const create = mutation({
  args: {
    entityId: v.string(),
    promptUrl: v.optional(v.string()),
    entityBackground: v.optional(v.string()),
    productsAndServices: v.optional(v.string()),
    pricing: v.optional(v.string()),
    laborAndWarranty: v.optional(v.string()),
    serviceArea: v.optional(v.string()),
    extraInformation: v.optional(v.string()),
    businessType: v.optional(v.string()),
    customerServicePhoneNumber: v.optional(v.string()),
    customerServiceEmail: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    logo: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { entityId, ...settingsData } = args;
    const settingsId = generateId();
    const now = Date.now();

    await ctx.db.insert("settings", {
      entityId,
      settingsId,
      ...settingsData,
      isActive: settingsData.isActive ?? true,
      createdBy: undefined,
      createdDate: now,
      updatedDate: now,
    });

    return { settingsId };
  },
});

/**
 * List settings for an entity
 * Equivalent to: list_settings() in entity_controller.py
 */
export const list = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .collect();

    return settings;
  },
});

/**
 * Get settings by ID
 * Equivalent to: get_settings() in entity_controller.py
 */
export const get = query({
  args: {
    entityId: v.string(),
    settingsId: v.string(),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_entity_and_settings", (q) =>
        q.eq("entityId", args.entityId).eq("settingsId", args.settingsId)
      )
      .first();

    if (!settings) {
      throw new Error('Not found');
    }

    return settings;
  },
});

/**
 * Update settings
 * Equivalent to: update_settings() in entity_controller.py
 */
export const update = mutation({
  args: {
    entityId: v.string(),
    settingsId: v.string(),
    promptUrl: v.optional(v.string()),
    entityBackground: v.optional(v.string()),
    productsAndServices: v.optional(v.string()),
    pricing: v.optional(v.string()),
    laborAndWarranty: v.optional(v.string()),
    serviceArea: v.optional(v.string()),
    extraInformation: v.optional(v.string()),
    businessType: v.optional(v.string()),
    customerServicePhoneNumber: v.optional(v.string()),
    customerServiceEmail: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    logo: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { entityId, settingsId, ...updates } = args;

    // Find settings
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_entity_and_settings", (q) =>
        q.eq("entityId", entityId).eq("settingsId", settingsId)
      )
      .first();

    if (!settings) {
      throw new Error('Not found');
    }

    // Update settings
    await ctx.db.patch(settings._id, {
      ...updates,
      updatedDate: Date.now(),
    });

    return { status: 'ok' };
  },
});

/**
 * Delete settings
 * Equivalent to: delete_settings() in entity_controller.py
 */
export const remove = mutation({
  args: {
    entityId: v.string(),
    settingsId: v.string(),
  },
  handler: async (ctx, args) => {
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_entity_and_settings", (q) =>
        q.eq("entityId", args.entityId).eq("settingsId", args.settingsId)
      )
      .first();

    if (settings) {
      await ctx.db.delete(settings._id);
    }

    return { status: 'deleted' };
  },
});
