import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getMany = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users;
  },
});

export const add = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    authId: v.string(),
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("users", {
      name: args.name,
      email: args.email,
      authId: args.authId,
      organizationId: args.organizationId,
    });
  },
});
