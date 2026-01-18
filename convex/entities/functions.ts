/**
 * Re-exports for entities component functions
 * 
 * This file serves as a central export point for all entity-related operations.
 * Functions are organized into separate modules for better maintainability:
 * 
 * - entity.ts: Entity CRUD operations
 * - employee.ts: Employee management
 * - settings.ts: Settings management
 * - tokens.ts: Token allocation and management
 * - products.ts: Product and plan management (to be implemented)
 */

// Re-export entity operations
export * as entity from "./entity";

// Re-export employee operations
export * as employee from "./employee";

// Re-export settings operations
export * as settings from "./settings";

// Re-export token operations
export * as tokens from "./tokens";

// Re-export product operations
export * as product from "./product";

// Re-export SLM waitlist operations
export * as slmWaitlist from "./slmWaitlist";

// Usage examples:
// - entities.entity.create({ name: "Acme Corp", ... })
// - entities.employee.add({ entityId: "...", email: "..." })
// - entities.settings.create({ entityId: "...", ... })
// - entities.tokens.setUserTokens({ entityId: "...", employeeId: "...", ... })
// - entities.product.upsertProduct({ entityId: "...", productId: "...", ... })
// - entities.product.incrementCounter({ entityId: "...", productId: "...", units: 10 })
