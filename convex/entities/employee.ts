/**
 * Employee CRUD operations
 * Mirroring employee operations in entity_controller.py
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { generateId, getDefaultProductAllocations } from "./helpers";

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   EMPLOYEE CRUD OPERATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

/**
 * Add employee to entity
 * Equivalent to: add_employee() in entity_controller.py
 */
export const add = mutation({
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
    const employeeId = args.employeeId || generateId();

    // Check if employee already exists
    const existing = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", args.entityId).eq("employeeId", employeeId)
      )
      .first();

    if (existing) {
      throw new Error('Employee already exists');
    }

    // Calculate display name
    const displayName = args.displayName || 
      `${args.firstName.trim()} ${args.lastName.trim()}`.trim() ||
      args.email;

    const now = Date.now();

    // Create employee
    await ctx.db.insert("employees", {
      entityId: args.entityId,
      employeeId,
      email: args.email,
      firstName: args.firstName,
      lastName: args.lastName,
      displayName,
      profileImageUrl: args.profileImageUrl,
      roles: args.roles || ['AGENT'],
      status: args.status || 'ACTIVE',
      products: getDefaultProductAllocations(),
      createdDate: now,
      updatedDate: now,
    });

    return { employeeId };
  },
});

/**
 * List employees for an entity
 * Equivalent to: list_employees() in entity_controller.py
 */
export const list = query({
  args: { entityId: v.string() },
  handler: async (ctx, args) => {
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_entity_id", (q) => q.eq("entityId", args.entityId))
      .collect();

    return employees;
  },
});

/**
 * Get employee by ID
 * Equivalent to: get_employee() in entity_controller.py
 */
export const get = query({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", args.entityId).eq("employeeId", args.employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Not found');
    }

    return employee;
  },
});

/**
 * Update employee
 * Equivalent to: update_employee() in entity_controller.py
 */
export const update = mutation({
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
    const { entityId, employeeId, ...updates } = args;

    // Find employee
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", entityId).eq("employeeId", employeeId)
      )
      .first();

    if (!employee) {
      throw new Error('Not found');
    }

    // Auto-generate displayName if firstName or lastName changed
    let displayName = updates.displayName;
    if (!displayName && (updates.firstName || updates.lastName)) {
      const firstName = updates.firstName || employee.firstName;
      const lastName = updates.lastName || employee.lastName;
      displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
    }

    // Update employee
    await ctx.db.patch(employee._id, {
      ...updates,
      displayName: displayName || employee.displayName,
      updatedDate: Date.now(),
    });

    return { status: 'ok' };
  },
});

/**
 * Delete employee
 * Equivalent to: delete_employee() in entity_controller.py
 */
export const remove = mutation({
  args: {
    entityId: v.string(),
    employeeId: v.string(),
  },
  handler: async (ctx, args) => {
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_entity_and_employee", (q) =>
        q.eq("entityId", args.entityId).eq("employeeId", args.employeeId)
      )
      .first();

    if (employee) {
      await ctx.db.delete(employee._id);
    }

    return { status: 'deleted' };
  },
});

/**
 * Get entity ID by employee email
 * Equivalent to: get_entity_id_by_employee_email() in entity_controller.py
 */
export const getEntityIdByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    if (!args.email) {
      throw new Error('email query parameter is required');
    }

    // Search for employee by email across all entities
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!employee) {
      throw new Error('Employee not found');
    }

    return {
      entityId: employee.entityId,
      employeeId: employee.employeeId,
      email: args.email,
    };
  },
});

/**
 * Get user ID by email
 * Equivalent to: get_user_id_by_email() in entity_controller.py
 */
export const getUserIdByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    if (!args.email) {
      throw new Error('email query parameter is required');
    }

    // Search for employee by email
    const employee = await ctx.db
      .query("employees")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (!employee) {
      throw new Error('User not found');
    }

    return {
      userId: employee.employeeId,
      email: args.email,
    };
  },
});

/**
 * Find all entities that have employees with a specific email
 */
export const findEntitiesByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    // Query all employees with this email across all entities
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_email", (q) => q.eq("email", args.email.toLowerCase()))
      .collect();
    
    // Group by entity ID
    const entitiesMap = new Map<string, typeof employees>();
    employees.forEach((emp) => {
      if (!entitiesMap.has(emp.entityId)) {
        entitiesMap.set(emp.entityId, []);
      }
      entitiesMap.get(emp.entityId)!.push(emp);
    });
    
    // Return array of {entityId, employees}
    return Array.from(entitiesMap.entries()).map(([entityId, emps]) => ({
      entityId,
      employees: emps
    }));
  },
});
