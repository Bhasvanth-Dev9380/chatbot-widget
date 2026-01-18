/**
 * Token management operations
 * Mirroring token-related functions in entity_controller.py
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertProductId } from "./helpers";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   USER-LEVEL TOKEN MANAGEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Set product token allocation for a user
 * Equivalent to: set_user_product_tokens() in entity_controller.py
 * 
 * Supports legacy format: { productId: "slm", allocated: 1000 }
 * Or new format: { workflows: { allocated: 1000 }, chatbot_builder: { allocated: 500 } }
 */
export const setUserTokens = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    // Legacy format
    productId: v.optional(v.string()),
    allocated: v.optional(v.number()),
    // New format (key-value pairs)
    products: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Find employee
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", args.entityId).eq("employeeId", args.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee not found');
    }

    // Legacy format: single product
    if (args.productId && args.allocated !== undefined) {
      assertProductId(args.productId);

      const currentProducts: any = employee.products || {};
      const updatedProducts: any = {
        ...currentProducts,
        [args.productId]: {
          allocated: args.allocated,
          consumed: currentProducts[args.productId]?.consumed || 0,
        },
      };

      await ctx.db.patch(employee._id, {
        products: updatedProducts,
        updatedDate: Date.now(),
      });

      return {
        status: 'ok',
        productId: args.productId,
        allocated: args.allocated,
      };
    }

    // New format: multiple products
    if (args.products) {
      const currentProducts: any = employee.products || {};
      const updatedProducts: any = { ...currentProducts };
      const updatedProductsList = [];

      for (const [productId, productData] of Object.entries(args.products as Record<string, any>)) {
        if (productData && typeof productData === 'object' && 'allocated' in productData) {
          assertProductId(productId);
          updatedProducts[productId] = {
            allocated: productData.allocated,
            consumed: currentProducts[productId]?.consumed || 0,
          };
          updatedProductsList.push({
            productId,
            allocated: productData.allocated,
          });
        }
      }

      if (updatedProductsList.length === 0) {
        throw new Error('No valid product allocations provided');
      }

      await ctx.db.patch(employee._id, {
        products: updatedProducts,
        updatedDate: Date.now(),
      });

      return {
        status: 'ok',
        products: updatedProductsList,
      };
    }

    throw new Error('Either productId/allocated or products must be provided');
  },
});

/**
 * Get product token allocations for a user
 * Equivalent to: get_user_product_tokens() in entity_controller.py
 */
export const getUserTokens = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find employee
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", args.entityId).eq("employeeId", args.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee not found');
    }

    const products: any = employee.products || {};

    // Get specific product
    if (args.productId) {
      assertProductId(args.productId);
      const productData = products[args.productId] || { allocated: 0, consumed: 0 };
      
      return {
        productId: args.productId,
        allocated: productData.allocated || 0,
        consumed: productData.consumed || 0,
        remaining: (productData.allocated || 0) - (productData.consumed || 0),
      };
    }

    // Get all products
    return { products };
  },
});

/**
 * Increment product token consumption for a user
 * Equivalent to: increment_user_product_tokens() in entity_controller.py
 */
export const incrementUserTokens = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
    units: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const units = args.units || 1;

    if (!args.productId) {
      throw new Error('productId is required');
    }

    assertProductId(args.productId);

    // Find employee
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", args.entityId).eq("employeeId", args.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee not found');
    }

    // Update consumption
    const currentProducts: any = employee.products || {};
    const productData = currentProducts[args.productId] || { allocated: 0, consumed: 0 };

    const updatedProducts = {
      ...currentProducts,
      [args.productId]: {
        allocated: productData.allocated || 0,
        consumed: (productData.consumed || 0) + units,
      },
    };

    await ctx.db.patch(employee._id, {
      products: updatedProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      productId: args.productId,
      units,
    };
  },
});

/**
 * Reset product token consumption for a user
 * Equivalent to: reset_user_product_tokens() in entity_controller.py
 */
export const resetUserTokens = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find employee
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", args.entityId).eq("employeeId", args.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee not found');
    }

    const currentProducts: any = employee.products || {};

    // Reset specific product
    if (args.productId) {
      assertProductId(args.productId);
      
      const updatedProducts: any = {
        ...currentProducts,
        [args.productId]: {
          allocated: currentProducts[args.productId]?.allocated || 0,
          consumed: 0,
        },
      };

      await ctx.db.patch(employee._id, {
        products: updatedProducts,
        updatedDate: Date.now(),
      });

      return {
        status: 'ok',
        productId: args.productId,
      };
    }

    // Reset all products
    const updatedProducts: Record<string, any> = {};
    for (const [pid, pdata] of Object.entries(currentProducts)) {
      updatedProducts[pid] = {
        allocated: (pdata as any).allocated || 0,
        consumed: 0,
      };
    }

    await ctx.db.patch(employee._id, {
      products: updatedProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      reset: 'all',
    };
  },
});
