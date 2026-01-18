/**
 * Entity CRUD operations
 * Mirroring entity_controller.py from Entity-API
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { generateId, getDefaultProductAllocations, getCurrentMonth } from "./helpers";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ENTITY CRUD OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Create a new entity with admin employee and token status
 * Equivalent to: create_entity() in entity_controller.py
 */
export const create = mutation({
  args: {
    // Entity fields
    name: v.string(),
    email: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    businessRegistrationNumber: v.optional(v.string()),
    address: v.optional(v.object({
      line1: v.optional(v.string()),
      line2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      zip: v.optional(v.string()),
      country: v.optional(v.string()),
    })),
    autoRechargeEnabled: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    
    // Admin employee fields
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    userId: v.optional(v.string()), // Optional predefined user ID
  },
  handler: async (ctx, args) => {
    const { firstName = '', lastName = '', email, websiteUrl, userId, ...entityData } = args;

    // Validate required fields
    if (!args.name) {
      throw new Error('entity name is required');
    }

    // Check if entity already exists by email or website
    if (email || websiteUrl) {
      const existingByEmail = email
        ? await ctx.db.query("entities")
            .withIndex("by_email", (q) => q.eq("email", email))
            .first()
        : null;

      const existingByWebsite = websiteUrl
        ? await ctx.db.query("entities")
            .filter((q) => q.eq(q.field("websiteUrl"), websiteUrl))
            .first()
        : null;

      if (existingByEmail || existingByWebsite) {
        throw new Error('Entity already exists');
      }
    }

    // Generate IDs
    const entityId = generateId();
    const employeeId = userId || generateId();
    const now = Date.now();

    // Create entity
    await ctx.db.insert("entities", {
      entityId,
      name: args.name,
      email: email || undefined,
      websiteUrl: websiteUrl || undefined,
      phoneNumber: args.phoneNumber,
      businessRegistrationNumber: args.businessRegistrationNumber,
      address: args.address,
      autoRechargeEnabled: args.autoRechargeEnabled ?? false,
      isActive: true,
      tags: args.tags || [],
      billing: {
        stripeCustomerId: undefined,
        defaultPaymentMethod: undefined,
        currency: undefined,
        taxIds: [],
      },
      activePlans: {
        slm: undefined,
        voice_agent: undefined,
        workflows: undefined,
        chatbot_builder: undefined,
      },
      entitlements: {},
      createdBy: employeeId,
      createdDate: now,
      updatedDate: now,
      meta: {
        version: 1,
        softDeleted: false,
      },
    });

    // Create admin employee
    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim() || email || 'Admin';
    
    await ctx.db.insert("employees", {
      entityId,
      employeeId,
      email: email || '',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      displayName,
      profileImageUrl: undefined,
      roles: ['ADMIN'],
      status: 'ACTIVE',
      products: getDefaultProductAllocations(),
      createdDate: now,
      updatedDate: now,
    });

    // Create token status
    await ctx.db.insert("tokenStatus", {
      entityId,
      month: getCurrentMonth(),
      product: {
        slm: { allocated: 0, consumed: 0 },
        voice_agent: { allocated: 0, consumed: 0 },
        workflows: { allocated: 0, consumed: 0 },
        chatbot_builder: { allocated: 0, consumed: 0 },
      },
      allocatedTotal: 0,
      consumedTotal: 0,
      lastUpdated: now,
    });

    // Create subscription status
    await ctx.db.insert("subscriptionStatus", {
      entityId,
      subscriptions: {},
      updatedDate: now,
    });

    return { entityId, employeeId };
  },
});

/**
 * Get entity by entityId
 * Equivalent to: get_entity() in entity_controller.py
 */
export const get = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .first();

    if (!entity) {
      throw new Error('Entity not found');
    }

    return entity;
  },
});

/**
 * Update entity
 * Equivalent to: update_entity() in entity_controller.py
 */
export const update = mutation({
  args: {
    entityId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    businessRegistrationNumber: v.optional(v.string()),
    address: v.optional(v.object({
      line1: v.optional(v.string()),
      line2: v.optional(v.string()),
      city: v.optional(v.string()),
      state: v.optional(v.string()),
      zip: v.optional(v.string()),
      country: v.optional(v.string()),
    })),
    autoRechargeEnabled: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    activePlans: v.optional(v.any()),
    entitlements: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { entityId, ...updates } = args;

    // Check if there are any updates
    const hasUpdates = Object.keys(updates).length > 0;
    if (!hasUpdates) {
      throw new Error('No updates provided');
    }

    // Find entity
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_entity_id", (q) => q.eq("entityId", entityId))
      .first();

    if (!entity) {
      throw new Error('Entity not found');
    }

    // Update entity
    await ctx.db.patch(entity._id, {
      ...updates,
      updatedDate: Date.now(),
    });

    return { status: 'ok' };
  },
});

/**
 * Delete entity
 * Equivalent to: delete_entity() in entity_controller.py
 */
export const remove = mutation({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .first();

    if (entity) {
      await ctx.db.delete(entity._id);
    }

    return { status: 'deleted' };
  },
});

/**
 * List all entities
 * Equivalent to: list_entities() in entity_controller.py
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_name")
      .collect();

    return {
      items: entities,
      count: entities.length,
    };
  },
});

/**
 * Get entity with all related data (employees, settings, products)
 * Equivalent to: get_entity_details() in entity_controller.py
 */
export const getDetails = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    // Get entity
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .first();

    if (!entity) {
      throw new Error('Entity not found');
    }

    // Get employees
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .collect();

    // Get settings
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .collect();

    // Get products with plans
    const products = await ctx.db
      .query("products")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .collect();

    const productsWithPlans = await Promise.all(
      products.map(async (product) => {
        const plans = await ctx.db
          .query("plans")
          .withIndex("by_entity_and_product", (q) =>
            q.eq("entityId", args.entityId).eq("productId", product.productId)
          )
          .collect();

        return {
          ...product,
          plans,
        };
      })
    );

    return {
      entity,
      employees,
      settings,
      products: productsWithPlans,
    };
  },
});
