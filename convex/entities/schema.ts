import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* ───────────────────────────────────────────────
   SHARED SCHEMAS - Mirroring Entity-API Models
─────────────────────────────────────────────── */

// Address schema (from entity_model.py)
const addressSchema = v.object({
  line1: v.optional(v.string()),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zip: v.optional(v.string()),
  country: v.optional(v.string()),
});

// Billing schema (from entity creation in entity_controller.py)
const billingSchema = v.object({
  stripeCustomerId: v.optional(v.string()),
  defaultPaymentMethod: v.optional(v.string()),
  currency: v.optional(v.string()),
  taxIds: v.array(v.string()),
});

// Active plans schema (from entity_controller.py - supports 4 product types)
// Changed to v.any() to support dynamic product IDs
// Structure: { [productId: string]: planId }
const activePlansSchema = v.any();

// Product allocation schema (from employee creation in entity_controller.py)
// Supports both token-based products and standalone agents
const productAllocationSchema = v.object({
  allocated: v.number(),
  consumed: v.number(),
  isEnabled: v.optional(v.boolean()),
  type: v.optional(v.string()), // 'token', 'standalone', 'feature', etc.
  // Additional fields stored in v.any() below are merged at runtime
});

// Products schema for employees (from entity_controller.py)
// Changed from fixed schema to v.any() to support dynamic product IDs
// This allows multiple agents, custom products, etc.
// Structure: { [productId: string]: { allocated, consumed, isEnabled, ...customFields } }
const productsSchema = v.any();

/* ───────────────────────────────────────────────
   SCHEMA DEFINITION
─────────────────────────────────────────────── */

export default defineSchema({
  /* ───────── ENTITIES ───────── */
  // Based on entity_model.py and entity_controller.py
  entities: defineTable({
    entityId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    businessRegistrationNumber: v.optional(v.string()),
    address: v.optional(addressSchema),
    autoRechargeEnabled: v.boolean(),
    isActive: v.boolean(),
    tags: v.array(v.string()),
    
    // Billing information (from entity_controller.py)
    billing: billingSchema,
    
    // Active plans for each product (from entity_controller.py)
    activePlans: activePlansSchema,
    
    // Entitlements - flexible dict for feature flags (from entity_controller.py)
    entitlements: v.optional(v.any()),
    
    // Metadata
    createdBy: v.optional(v.string()),
    createdDate: v.number(),
    updatedDate: v.number(),
    
    // Soft delete support (from entity_controller.py)
    meta: v.object({
      version: v.number(),
      softDeleted: v.boolean(),
    }),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_email", ["email"])
    .index("by_name", ["name"])
    .index("by_is_active", ["isActive"]),

  /* ───────── EMPLOYEES ───────── */
  // Based on employee_model.py and entity_controller.py
  employees: defineTable({
    entityId: v.string(),
    employeeId: v.string(),
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    displayName: v.string(),
    profileImageUrl: v.optional(v.string()),
    roles: v.array(v.string()), // Default: ['AGENT'] or ['ADMIN']
    status: v.union(
      v.literal("ACTIVE"),
      v.literal("INVITED"),
      v.literal("SUSPENDED")
    ),
    
    // Product allocations (from entity_controller.py)
    products: v.optional(productsSchema),
    
    createdDate: v.number(),
    updatedDate: v.number(),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_employee_id", ["employeeId"])
    .index("by_email", ["email"])
    .index("by_entity_and_employee", ["entityId", "employeeId"])
    .index("by_entity_and_email", ["entityId", "email"])
    .index("by_status", ["status"]),

  /* ───────── SETTINGS ───────── */
  // Based on settings_model.py
  settings: defineTable({
    entityId: v.string(),
    settingsId: v.string(),
    
    // Settings fields (from SettingsIn model)
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
    isActive: v.boolean(),
    
    createdBy: v.optional(v.string()),
    createdDate: v.number(),
    updatedDate: v.number(),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_settings_id", ["settingsId"])
    .index("by_entity_and_settings", ["entityId", "settingsId"]),

  /* ───────── PRODUCTS ───────── */
  // Based on product_model.py ProductConfigIn
  products: defineTable({
    entityId: v.string(),
    productId: v.string(), // Valid: slm, voice_agent, workflows, chatbot_builder, or any custom string
    status: v.union(v.literal("active"), v.literal("paused")),
    defaultPlanId: v.optional(v.string()),
    overrides: v.optional(v.any()), // Dict[str, Any]
    updatedDate: v.number(),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_entity_and_product", ["entityId", "productId"])
    .index("by_status", ["status"]),

  /* ───────── PLANS ───────── */
  // Based on product_model.py PlanIn
  plans: defineTable({
    entityId: v.string(),
    productId: v.string(),
    planId: v.string(),
    name: v.string(),
    price: v.number(), // >= 0
    currency: v.optional(v.string()),
    billingCycle: v.union(v.literal("monthly"), v.literal("annual")),
    trialDays: v.number(), // >= 0
    features: v.array(v.string()),
    limits: v.optional(v.any()), // Dict[str, int]
    overage: v.optional(v.any()), // Dict[str, int]
    entitlements: v.optional(v.any()), // Dict[str, Any]
    isActive: v.boolean(),
    updatedDate: v.number(),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_entity_and_product", ["entityId", "productId"])
    .index("by_plan_id", ["planId"])
    .index("by_entity_product_plan", ["entityId", "productId", "planId"]),

  /* ───────── TOKEN STATUS (Public) ───────── */
  // From entity_controller.py - pub_token structure
  tokenStatus: defineTable({
    entityId: v.string(),
    month: v.string(), // Format: yyyy_mm()
    product: v.optional(v.any()), // { slm: { allocated: 0, consumed: 0 }, ... }
    allocatedTotal: v.number(),
    consumedTotal: v.number(),
    lastUpdated: v.number(),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_month", ["month"])
    .index("by_entity_and_month", ["entityId", "month"]),

  /* ───────── SUBSCRIPTION STATUS (Public) ───────── */
  // From entity_controller.py - pub_subs structure
  subscriptionStatus: defineTable({
    entityId: v.string(),
    subscriptions: v.optional(v.any()),
    updatedDate: v.number(),
  }).index("by_entity_id", ["entityId"]),

  /* ───────── USAGE COUNTERS ───────── */
  // For monthly usage tracking
  usageCounters: defineTable({
    entityId: v.string(),
    month: v.string(), // Format: yyyymm()
    consumedTotal: v.number(),
    product: v.optional(v.any()), // { slm: 100, workflows: 50, ... }
    updatedAt: v.number(),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_entity_and_month", ["entityId", "month"]),

  /* ───────── USAGE EVENTS ───────── */
  // Based on product_model.py IncrementIn for idempotency
  usageEvents: defineTable({
    entityId: v.string(),
    month: v.string(),
    eventId: v.string(), // idempotencyKey (max 120 chars)
    productId: v.string(),
    units: v.number(), // > 0
    employeeId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_event_id", ["eventId"])
    .index("by_entity_and_month", ["entityId", "month"])
    .index("by_product", ["productId"]),

  /* ───────── SLM WAITLIST ───────── */
  slmWaitlist: defineTable({
    entityId: v.string(),
    entityName: v.optional(v.string()),
    email: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity_id", ["entityId"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),
});
