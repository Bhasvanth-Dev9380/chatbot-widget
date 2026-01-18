/**
 * Product and Plan CRUD operations + Token management
 * Mirroring product_controller.py from Entity-API
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertProductId, generateId, getCurrentMonth, getCurrentMonthCompact } from "./helpers";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PRODUCT CRUD OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * List products for an entity with plan count
 * Equivalent to: list_products() in product_controller.py
 */
export const listProducts = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const products = await ctx.db
      .query("products")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .collect();

    // Get plan count for each product
    const productsWithCounts = await Promise.all(
      products.map(async (product) => {
        const plans = await ctx.db
          .query("plans")
          .withIndex("by_entity_and_product", (q) =>
            q.eq("entityId", args.entityId).eq("productId", product.productId)
          )
          .collect();

        return {
          ...product,
          _planCount: plans.length,
        };
      })
    );

    return productsWithCounts;
  },
});

/**
 * Upsert (create or update) product
 * Equivalent to: upsert_product() in product_controller.py
 */
export const upsertProduct = mutation({
  args: {
    entityId: v.string(),
    productId: v.string(),
    status: v.optional(v.union(v.literal("active"), v.literal("paused"))),
    defaultPlanId: v.optional(v.string()),
    overrides: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { entityId, productId, ...data } = args;
    
    assertProductId(productId);

    // Check if defaultPlanId exists
    if (data.defaultPlanId) {
      const defaultPlanId = data.defaultPlanId; // capture for type narrowing
      const planExists = await ctx.db
        .query("plans")
        .withIndex("by_entity_product_plan", (q) =>
          q.eq("entityId", entityId).eq("productId", productId).eq("planId", defaultPlanId)
        )
        .first();

      if (!planExists) {
        throw new Error(`defaultPlanId '${defaultPlanId}' does not exist for ${productId}`);
      }
    }

    // Check if product exists
    const existing = await ctx.db
      .query("products")
      .withIndex("by_entity_and_product", (q) =>
        q.eq("entityId", entityId).eq("productId", productId)
      )
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing product
      await ctx.db.patch(existing._id, {
        ...data,
        updatedDate: now,
      });
    } else {
      // Create new product
      await ctx.db.insert("products", {
        entityId,
        productId,
        status: data.status || "active",
        defaultPlanId: data.defaultPlanId,
        overrides: data.overrides || {},
        updatedDate: now,
      });
    }

    return { productId, status: 'ok' };
  },
});

/**
 * Get product with plans
 * Equivalent to: get_product() in product_controller.py
 */
export const getProduct = query({
  args: {
    entityId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    const product = await ctx.db
      .query("products")
      .withIndex("by_entity_and_product", (q) =>
        q.eq("entityId", args.entityId).eq("productId", args.productId)
      )
      .first();

    if (!product) {
      throw new Error('Not found');
    }

    // Get plans for this product
    const plans = await ctx.db
      .query("plans")
      .withIndex("by_entity_and_product", (q) =>
        q.eq("entityId", args.entityId).eq("productId", args.productId)
      )
      .collect();

    return {
      ...product,
      plans,
    };
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PLAN CRUD OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Upsert plan and optionally create product if it doesn't exist
 * Equivalent to: upsert_plan() in product_controller.py
 */
export const upsertPlan = mutation({
  args: {
    entityId: v.string(),
    productId: v.string(),
    planId: v.string(),
    name: v.string(),
    price: v.number(),
    currency: v.optional(v.string()),
    billingCycle: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
    trialDays: v.optional(v.number()),
    features: v.optional(v.array(v.string())),
    limits: v.optional(v.any()),
    overage: v.optional(v.any()),
    entitlements: v.optional(v.any()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { entityId, productId, planId, ...planData } = args;

    assertProductId(productId);

    const now = Date.now();

    // Check if plan exists
    const existingPlan = await ctx.db
      .query("plans")
      .withIndex("by_entity_product_plan", (q) =>
        q.eq("entityId", entityId).eq("productId", productId).eq("planId", planId)
      )
      .first();

    if (existingPlan) {
      // Update existing plan
      await ctx.db.patch(existingPlan._id, {
        ...planData,
        updatedDate: now,
      });
    } else {
      // Create new plan
      await ctx.db.insert("plans", {
        entityId,
        productId,
        planId,
        name: planData.name,
        price: planData.price,
        currency: planData.currency,
        billingCycle: planData.billingCycle || "monthly",
        trialDays: planData.trialDays || 0,
        features: planData.features || [],
        limits: planData.limits || {},
        overage: planData.overage || {},
        entitlements: planData.entitlements || {},
        isActive: planData.isActive ?? true,
        updatedDate: now,
      });
    }

    // Check if product exists, create if not
    const product = await ctx.db
      .query("products")
      .withIndex("by_entity_and_product", (q) =>
        q.eq("entityId", entityId).eq("productId", productId)
      )
      .first();

    if (!product) {
      await ctx.db.insert("products", {
        entityId,
        productId,
        status: "active",
        defaultPlanId: planId,
        overrides: {},
        updatedDate: now,
      });
    }

    // Update entity's activePlans
    const entity = await ctx.db
      .query("entities")
      .withIndex("by_entity_id", (q) => q.eq("entityId", entityId))
      .first();

    if (entity) {
      const activePlans: any = entity.activePlans || {};
      activePlans[productId] = planId;

      await ctx.db.patch(entity._id, {
        activePlans,
        updatedDate: now,
      });
    }

    return { planId, status: 'ok' };
  },
});

/**
 * List plans for a product
 * Equivalent to: list_plans() in product_controller.py
 */
export const listPlans = query({
  args: {
    entityId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    const plans = await ctx.db
      .query("plans")
      .withIndex("by_entity_and_product", (q) =>
        q.eq("entityId", args.entityId).eq("productId", args.productId)
      )
      .collect();

    return plans;
  },
});

/**
 * Get specific plan
 * Equivalent to: get_plan() in product_controller.py
 */
export const getPlan = query({
  args: {
    entityId: v.string(),
    productId: v.string(),
    planId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    const plan = await ctx.db
      .query("plans")
      .withIndex("by_entity_product_plan", (q) =>
        q.eq("entityId", args.entityId)
          .eq("productId", args.productId)
          .eq("planId", args.planId)
      )
      .first();

    if (!plan) {
      throw new Error('Not found');
    }

    return plan;
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TOKEN STATUS & USAGE TRACKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Read token status for entity
 * Equivalent to: read_token_status() in product_controller.py
 */
export const readTokenStatus = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const tokenStatus = await ctx.db
      .query("tokenStatus")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .first();

    if (!tokenStatus) {
      throw new Error('Not found');
    }

    return tokenStatus;
  },
});

/**
 * Read subscription status for entity
 * Equivalent to: read_subscription_status() in product_controller.py
 */
export const readSubscriptionStatus = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const subStatus = await ctx.db
      .query("subscriptionStatus")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .first();

    if (!subStatus) {
      throw new Error('Not found');
    }

    return subStatus;
  },
});

/**
 * Get current usage counter for entity
 * Equivalent to: get_current_counter() in product_controller.py
 */
export const getCurrentCounter = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const monthKey = getCurrentMonthCompact();

    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_entity_and_month", (q) =>
        q.eq("entityId", args.entityId).eq("month", monthKey)
      )
      .first();

    if (!counter) {
      return {
        month: monthKey,
        consumedTotal: 0,
        product: {},
      };
    }

    return counter;
  },
});

/**
 * Increment usage counter with idempotency
 * Equivalent to: increment_counter() in product_controller.py
 */
export const incrementCounter = mutation({
  args: {
    entityId: v.string(),
    productId: v.string(),
    units: v.number(),
    idempotencyKey: v.optional(v.string()),
    employeeId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    if (args.units <= 0) {
      throw new Error('units must be greater than 0');
    }

    const monthDoc = getCurrentMonthCompact();
    const monthFormatted = getCurrentMonth();
    const idemKey = args.idempotencyKey || `anon:${generateId()}`;
    const now = Date.now();

    // Check idempotency - if event already exists, return early
    const existingEvent = await ctx.db
      .query("usageEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", idemKey))
      .first();

    if (existingEvent) {
      return {
        status: 'ok',
        applied: false,
        month: monthDoc,
        idempotencyKey: idemKey,
      };
    }

    // Update or create usage counter
    const counter = await ctx.db
      .query("usageCounters")
      .withIndex("by_entity_and_month", (q) =>
        q.eq("entityId", args.entityId).eq("month", monthDoc)
      )
      .first();

    if (counter) {
      const product: any = counter.product || {};
      product[args.productId] = (product[args.productId] || 0) + args.units;

      await ctx.db.patch(counter._id, {
        consumedTotal: counter.consumedTotal + args.units,
        product,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("usageCounters", {
        entityId: args.entityId,
        month: monthDoc,
        consumedTotal: args.units,
        product: { [args.productId]: args.units },
        updatedAt: now,
      });
    }

    // Update token status
    const tokenStatus = await ctx.db
      .query("tokenStatus")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .first();

    if (tokenStatus) {
      const product: any = tokenStatus.product || {};
      if (!product[args.productId]) {
        product[args.productId] = { allocated: 0, consumed: 0 };
      }
      product[args.productId].consumed = (product[args.productId].consumed || 0) + args.units;

      await ctx.db.patch(tokenStatus._id, {
        consumedTotal: tokenStatus.consumedTotal + args.units,
        product,
        lastUpdated: now,
      });
    } else {
      // Create token status if doesn't exist
      await ctx.db.insert("tokenStatus", {
        entityId: args.entityId,
        month: monthFormatted,
        product: {
          [args.productId]: { allocated: 0, consumed: args.units },
        },
        allocatedTotal: 0,
        consumedTotal: args.units,
        lastUpdated: now,
      });
    }

    // Record usage event for idempotency
    await ctx.db.insert("usageEvents", {
      entityId: args.entityId,
      month: monthDoc,
      eventId: idemKey,
      productId: args.productId,
      units: args.units,
      employeeId: args.employeeId,
      createdAt: now,
    });

    return {
      status: 'ok',
      applied: true,
      month: monthDoc,
      idempotencyKey: idemKey,
    };
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   HELPER FUNCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Helper to find employee by email across all entities
 */
async function findEmployeeByEmail(ctx: any, email: string) {
  if (!email) return null;

  const employee = await ctx.db
    .query("employees")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .first();

  if (!employee) return null;

  return {
    entityId: employee.entityId,
    employeeId: employee.employeeId,
    email: employee.email,
  };
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   EMAIL-BASED PRODUCT OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Assign product to employee by email
 * Equivalent to: create_product_by_email() in product_controller.py
 */
export const assignProductByEmail = mutation({
  args: {
    email: v.string(),
    productId: v.string(),
    allocated: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    const employeeData = await findEmployeeByEmail(ctx, args.email);
    if (!employeeData) {
      throw new Error('Employee not found');
    }

    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", employeeData.entityId).eq("employeeId", employeeData.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee not found');
    }

    const currentProducts: any = employee.products || {};
    currentProducts[args.productId] = {
      allocated: args.allocated || 0,
      consumed: currentProducts[args.productId]?.consumed || 0,
    };

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      email: args.email,
      productId: args.productId,
      allocated: args.allocated || 0,
      entityId: employeeData.entityId,
      employeeId: employeeData.employeeId,
    };
  },
});

/**
 * Assign product to employee by employeeId (more direct than email lookup)
 */
export const assignProduct = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
    allocated: v.optional(v.number()),
    isEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

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
    currentProducts[args.productId] = {
      allocated: args.allocated ?? currentProducts[args.productId]?.allocated ?? 0,
      consumed: currentProducts[args.productId]?.consumed || 0,
      isEnabled: args.isEnabled ?? currentProducts[args.productId]?.isEnabled,
    };

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      entityId: args.entityId,
      employeeId: args.employeeId,
      productId: args.productId,
      allocated: currentProducts[args.productId].allocated,
      consumed: currentProducts[args.productId].consumed,
      isEnabled: currentProducts[args.productId].isEnabled,
    };
  },
});

/**
 * Get product allocation by email
 * Equivalent to: get_product_by_email() in product_controller.py
 */
export const getProductByEmail = query({
  args: {
    email: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    const employeeData = await findEmployeeByEmail(ctx, args.email);
    if (!employeeData) {
      throw new Error('Employee not found');
    }

    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", employeeData.entityId).eq("employeeId", employeeData.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee document not found');
    }

    const products: any = employee.products || {};
    const productData = products[args.productId] || { allocated: 0, consumed: 0 };

    return {
      email: args.email,
      productId: args.productId,
      allocated: productData.allocated || 0,
      consumed: productData.consumed || 0,
      remaining: (productData.allocated || 0) - (productData.consumed || 0),
    };
  },
});

/**
 * List all products for employee by email
 * Equivalent to: list_products_by_email() in product_controller.py
 */
export const listProductsByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const employeeData = await findEmployeeByEmail(ctx, args.email);
    if (!employeeData) {
      throw new Error('Employee not found');
    }

    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", employeeData.entityId).eq("employeeId", employeeData.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee document not found');
    }

    return {
      email: args.email,
      products: employee.products || {},
      entityId: employeeData.entityId,
      employeeId: employeeData.employeeId,
    };
  },
});

/**
 * Remove product from employee by email
 * Equivalent to: delete_product_by_email() in product_controller.py
 */
export const deleteProductByEmail = mutation({
  args: {
    email: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    const employeeData = await findEmployeeByEmail(ctx, args.email);
    if (!employeeData) {
      throw new Error('Employee not found');
    }

    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", employeeData.entityId).eq("employeeId", employeeData.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee not found');
    }

    const currentProducts: any = employee.products || {};
    currentProducts[args.productId] = { allocated: 0, consumed: 0 };

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'deleted',
      email: args.email,
      productId: args.productId,
    };
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ADVANCED PRODUCT ASSIGNMENT OPERATIONS
   These support flexible product structures with custom fields
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Assign a product to employee with flexible fields
 * Supports: token-based (allocated/consumed), feature flags (enabled), custom fields
 * Equivalent to: assign_product_to_employee() in product_controller.py
 */
export const assignProductToEmployee = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
    allocated: v.optional(v.number()),
    enabled: v.optional(v.boolean()),
    customFields: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    // Verify employee exists
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
    const productData: any = currentProducts[args.productId] || {};

    // Handle token-based allocation
    if (args.allocated !== undefined) {
      productData.allocated = args.allocated;
      // Initialize consumed if not exists
      if (productData.consumed === undefined) {
        productData.consumed = 0;
      }
    }

    // Handle feature flags
    // For backward compatibility: if 'enabled' is passed, also set 'isEnabled'
    if (args.enabled !== undefined) {
      productData.isEnabled = args.enabled;
    }

    // Handle custom fields (can override isEnabled if explicitly set)
    if (args.customFields) {
      Object.assign(productData, args.customFields);
    }

    // Validate we have at least some data
    if (Object.keys(productData).length === 0) {
      throw new Error('No valid product fields provided (allocated, enabled, or customFields)');
    }

    currentProducts[args.productId] = productData;

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      entityId: args.entityId,
      employeeId: args.employeeId,
      productId: args.productId,
      ...productData,
    };
  },
});

/**
 * Assign multiple products to employee at once
 * Equivalent to: assign_products_to_employee() in product_controller.py
 */
export const assignProductsToEmployee = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    products: v.any(), // Object with productId keys and data values
  },
  handler: async (ctx, args) => {
    // Verify employee exists
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
    const assignedProducts: any[] = [];

    // Process each product
    for (const [productId, productData] of Object.entries(args.products || {})) {
      if (typeof productData === 'object' && productData !== null) {
        assertProductId(productId);
        
        const data: any = productData;
        const allocated = data.allocated || 0;
        
        currentProducts[productId] = {
          allocated,
          consumed: currentProducts[productId]?.consumed || 0,
          ...data,
        };

        assignedProducts.push({
          productId,
          allocated,
        });
      }
    }

    if (assignedProducts.length === 0) {
      throw new Error('No valid products provided');
    }

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      entityId: args.entityId,
      employeeId: args.employeeId,
      products: assignedProducts,
    };
  },
});

/**
 * Get specific product assignment for employee with all fields
 * Equivalent to: get_employee_product() in product_controller.py
 */
export const getEmployeeProduct = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

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
    const productData = products[args.productId];

    if (!productData) {
      throw new Error('Product not assigned to employee');
    }

    return {
      entityId: args.entityId,
      employeeId: args.employeeId,
      productId: args.productId,
      ...productData, // Include all custom fields
    };
  },
});

/**
 * List all products assigned to employee with filtering
 * Equivalent to: list_employee_products() in product_controller.py
 */
export const listEmployeeProducts = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    assignedOnly: v.optional(v.boolean()),
    productType: v.optional(v.union(v.literal("token"), v.literal("feature"), v.literal("all"))),
  },
  handler: async (ctx, args) => {
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
    const productList: any[] = [];
    const typeFilter = args.productType || "all";

    for (const [productId, productData] of Object.entries(products)) {
      if (typeof productData !== 'object' || productData === null) {
        continue;
      }

      const data: any = productData;
      
      // Determine product type
      const hasTokens = 'allocated' in data || 'consumed' in data;
      const isFeature = 'enabled' in data;
      
      let productType = 'custom';
      if (hasTokens) {
        productType = 'token';
      } else if (isFeature) {
        productType = 'feature';
      }

      // Apply type filter
      if (typeFilter !== 'all' && productType !== typeFilter) {
        continue;
      }

      // Apply assigned filter
      if (args.assignedOnly) {
        const isAssigned = 
          (data.allocated && data.allocated > 0) ||
          data.enabled === true ||
          Object.keys(data).length > 0;
        
        if (!isAssigned) {
          continue;
        }
      }

      productList.push({
        productId,
        type: productType,
        ...data,
      });
    }

    return {
      entityId: args.entityId,
      employeeId: args.employeeId,
      products: productList,
      totalProducts: productList.length,
    };
  },
});

/**
 * Remove product from employee (sets allocated to 0)
 * Equivalent to: remove_product_from_employee() in product_controller.py
 */
export const removeProductFromEmployee = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

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
    
    // Set allocated to 0 (soft delete)
    currentProducts[args.productId] = {
      ...currentProducts[args.productId],
      allocated: 0,
    };

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'removed',
      entityId: args.entityId,
      employeeId: args.employeeId,
      productId: args.productId,
    };
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PRODUCT STATUS CHECKS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Check if a product is active/enabled for an employee
 * Returns status based on isEnabled flag and/or token allocation
 */
export const isProductActive = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", args.entityId).eq("employeeId", args.employeeId)
      )
      .first();

    if (!employee) {
      return {
        isActive: false,
        reason: 'Employee not found',
      };
    }

    const products: any = employee.products || {};
    const productData = products[args.productId];

    if (!productData) {
      return {
        isActive: false,
        reason: 'Product not assigned',
      };
    }

    // Check if explicitly enabled via isEnabled flag
    if (productData.isEnabled === true) {
      return {
        isActive: true,
        reason: 'Explicitly enabled',
        allocated: productData.allocated || 0,
        consumed: productData.consumed || 0,
      };
    }

    // Check if active via token allocation
    const allocated = productData.allocated || 0;
    const consumed = productData.consumed || 0;
    const hasTokens = allocated > consumed;

    if (hasTokens) {
      return {
        isActive: true,
        reason: 'Has available tokens',
        allocated,
        consumed,
        remaining: allocated - consumed,
      };
    }

    return {
      isActive: false,
      reason: productData.isEnabled === false ? 'Explicitly disabled' : 'No tokens available',
      allocated,
      consumed,
    };
  },
});

/**
 * Set product enabled status for employee
 */
export const setProductEnabled = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
    isEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

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
    
    // Initialize product if doesn't exist
    if (!currentProducts[args.productId]) {
      currentProducts[args.productId] = {
        allocated: 0,
        consumed: 0,
      };
    }

    currentProducts[args.productId].isEnabled = args.isEnabled;

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      entityId: args.entityId,
      employeeId: args.employeeId,
      productId: args.productId,
      isEnabled: args.isEnabled,
    };
  },
});

/**
 * Assign standalone/feature-based product (no tokens needed)
 * Perfect for standalone agents, feature flags, or products that don't track usage
 */
export const assignStandaloneProduct = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
    isEnabled: v.optional(v.boolean()),
    metadata: v.optional(v.any()), // Custom fields like agentType, features, etc.
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

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
    
    // For standalone products, we don't track tokens
    currentProducts[args.productId] = {
      allocated: 0,
      consumed: 0,
      isEnabled: args.isEnabled ?? true, // Default to enabled
      type: 'standalone',
      ...(args.metadata || {}), // Spread any custom metadata
    };

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      entityId: args.entityId,
      employeeId: args.employeeId,
      productId: args.productId,
      isEnabled: currentProducts[args.productId].isEnabled,
      type: 'standalone',
    };
  },
});

/**
 * Assign standalone product by email (convenience wrapper)
 */
export const assignStandaloneProductByEmail = mutation({
  args: {
    email: v.string(),
    productId: v.string(),
    isEnabled: v.optional(v.boolean()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    assertProductId(args.productId);

    const employeeData = await findEmployeeByEmail(ctx, args.email);
    if (!employeeData) {
      throw new Error('Employee not found');
    }

    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", employeeData.entityId).eq("employeeId", employeeData.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Employee not found');
    }

    const currentProducts: any = employee.products || {};
    
    currentProducts[args.productId] = {
      allocated: 0,
      consumed: 0,
      isEnabled: args.isEnabled ?? true,
      type: 'standalone',
      ...(args.metadata || {}),
    };

    await ctx.db.patch(employee._id, {
      products: currentProducts,
      updatedDate: Date.now(),
    });

    return {
      status: 'ok',
      email: args.email,
      entityId: employeeData.entityId,
      employeeId: employeeData.employeeId,
      productId: args.productId,
      isEnabled: currentProducts[args.productId].isEnabled,
      type: 'standalone',
    };
  },
});
