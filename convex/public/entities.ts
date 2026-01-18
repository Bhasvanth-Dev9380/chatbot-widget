/**
 * Public API wrappers for entity component functions
 * These expose the component functions to client and server code
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { components } from "../_generated/api";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ENTITY OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Create a new entity with admin employee
 */
export const createEntity = mutation({
  args: {
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
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.entity.create, args);
  },
});

/**
 * Get entity by ID
 */
export const getEntity = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.entity.get, args);
  },
});

/**
 * Update entity
 */
export const updateEntity = mutation({
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
    return await ctx.runMutation(components.entities.entity.update, args);
  },
});

/**
 * Delete entity
 */
export const removeEntity = mutation({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.entity.remove, args);
  },
});

/**
 * List all entities
 */
export const listEntities = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(components.entities.entity.list, {});
  },
});

/**
 * Get entity with all related data
 */
export const getEntityDetails = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.entity.getDetails, args);
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   EMPLOYEE OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Add employee to entity
 */
export const addEmployee = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.optional(v.string()),
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    displayName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    roles: v.optional(v.array(v.string())),
    status: v.optional(v.union(
      v.literal("ACTIVE"),
      v.literal("INVITED"),
      v.literal("SUSPENDED")
    )),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.employee.add, args);
  },
});

/**
 * List employees for an entity
 */
export const listEmployees = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.employee.list, args);
  },
});

/**
 * Get employee by ID
 */
export const getEmployee = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.employee.get, args);
  },
});

/**
 * Update employee
 */
export const updateEmployee = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    displayName: v.optional(v.string()),
    profileImageUrl: v.optional(v.string()),
    roles: v.optional(v.array(v.string())),
    status: v.optional(v.union(
      v.literal("ACTIVE"),
      v.literal("INVITED"),
      v.literal("SUSPENDED")
    )),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.employee.update, args);
  },
});

/**
 * Remove employee from entity
 */
export const removeEmployee = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.employee.remove, args);
  },
});

/**
 * Get entity ID by employee email
 */
export const getEntityIdByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.employee.getEntityIdByEmail, args);
  },
});

/**
 * Get user ID by employee email
 */
export const getUserIdByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.employee.getUserIdByEmail, args);
  },
});

/**
 * Find all entities that have an employee with the given email
 */
export const findEntitiesWithEmployeeEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.employee.findEntitiesByEmail, args);
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SETTINGS OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Create settings for an entity
 */
export const createSettings = mutation({
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
    return await ctx.runMutation(components.entities.settings.create, args);
  },
});

/**
 * List settings for an entity
 */
export const listSettings = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.settings.list, args);
  },
});

/**
 * Get settings by ID
 */
export const getSettings = query({
  args: {
    entityId: v.string(),
    settingsId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.settings.get, args);
  },
});

/**
 * Update settings
 */
export const updateSettings = mutation({
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
    return await ctx.runMutation(components.entities.settings.update, args);
  },
});

/**
 * Remove settings
 */
export const removeSettings = mutation({
  args: {
    entityId: v.string(),
    settingsId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.settings.remove, args);
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PRODUCT OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * List products for an entity
 */
export const listProducts = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.listProducts, args);
  },
});

/**
 * Upsert product
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
    return await ctx.runMutation(components.entities.product.upsertProduct, args);
  },
});

/**
 * Get product
 */
export const getProduct = query({
  args: {
    entityId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.getProduct, args);
  },
});

/**
 * Upsert plan
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
    return await ctx.runMutation(components.entities.product.upsertPlan, args);
  },
});

/**
 * List plans for a product
 */
export const listPlans = query({
  args: {
    entityId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.listPlans, args);
  },
});

/**
 * Get plan
 */
export const getPlan = query({
  args: {
    entityId: v.string(),
    productId: v.string(),
    planId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.getPlan, args);
  },
});

/**
 * Read token status for entity
 */
export const readTokenStatus = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.readTokenStatus, args);
  },
});

/**
 * Read subscription status for entity
 */
export const readSubscriptionStatus = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.readSubscriptionStatus, args);
  },
});

/**
 * Get current usage counter for entity
 */
export const getCurrentCounter = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.getCurrentCounter, args);
  },
});

/**
 * Increment counter for a product
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
    return await ctx.runMutation(components.entities.product.incrementCounter, args);
  },
});

/**
 * Assign product to employee by email
 */
export const assignProductByEmail = mutation({
  args: {
    email: v.string(),
    productId: v.string(),
    allocated: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.product.assignProductByEmail, args);
  },
});

/**
 * Assign product to employee
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
    return await ctx.runMutation(components.entities.product.assignProduct, args);
  },
});

/**
 * Get product assignment by email
 */
export const getProductByEmail = query({
  args: {
    email: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.getProductByEmail, args);
  },
});

/**
 * List all product assignments for a user by email
 */
export const listProductsByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.listProductsByEmail, args);
  },
});

/**
 * Delete product assignment by email
 */
export const deleteProductByEmail = mutation({
  args: {
    email: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.product.deleteProductByEmail, args);
  },
});

/**
 * Assign product to employee with flexible fields
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
    return await ctx.runMutation(components.entities.product.assignProductToEmployee, args);
  },
});

/**
 * Assign multiple products to employee at once
 */
export const assignProductsToEmployee = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    products: v.any(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.product.assignProductsToEmployee, args);
  },
});

/**
 * Get employee product assignment
 */
export const getEmployeeProduct = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.getEmployeeProduct, args);
  },
});

/**
 * List all products assigned to employee with filtering
 */
export const listEmployeeProducts = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    assignedOnly: v.optional(v.boolean()),
    productType: v.optional(v.union(v.literal("token"), v.literal("feature"), v.literal("all"))),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.listEmployeeProducts, args);
  },
});

/**
 * Remove product from employee
 */
export const removeProductFromEmployee = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.product.removeProductFromEmployee, args);
  },
});

/**
 * Check if product is active for employee
 */
export const isProductActive = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.product.isProductActive, args);
  },
});

/**
 * Set product enabled/disabled for employee
 */
export const setProductEnabled = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
    isEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.product.setProductEnabled, args);
  },
});

/**
 * Assign standalone product
 */
export const assignStandaloneProduct = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
    isEnabled: v.optional(v.boolean()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.product.assignStandaloneProduct, args);
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
    return await ctx.runMutation(components.entities.product.assignStandaloneProductByEmail, args);
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TOKEN OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Set employee tokens
 */
export const setUserTokens = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.optional(v.string()),
    allocated: v.optional(v.number()),
    products: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.tokens.setUserTokens, args);
  },
});

/**
 * Get employee tokens
 */
export const getUserTokens = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.tokens.getUserTokens, args);
  },
});

/**
 * Increment employee tokens
 */
export const incrementUserTokens = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.string(),
    units: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.tokens.incrementUserTokens, args);
  },
});

/**
 * Reset employee tokens
 */
export const resetUserTokens = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
    productId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.tokens.resetUserTokens, args);
  },
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SLM WAITLIST OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Join the SLM waitlist
 */
export const joinWaitlist = mutation({
  args: {
    entityId: v.string(),
    entityName: v.optional(v.string()),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.slmWaitlist.joinWaitlist, args);
  },
});

/**
 * Check if an entity is on the waitlist
 */
export const checkWaitlistStatus = query({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.entities.slmWaitlist.checkWaitlistStatus, args);
  },
});

/**
 * Get all waitlist entries (admin only)
 */
export const getAllWaitlistEntries = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.runQuery(components.entities.slmWaitlist.getAllWaitlistEntries, {});
  },
});

/**
 * Update waitlist entry status (admin only)
 */
export const updateWaitlistStatus = mutation({
  args: {
    waitlistId: v.id("slmWaitlist"),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.entities.slmWaitlist.updateWaitlistStatus, args);
  },
});
