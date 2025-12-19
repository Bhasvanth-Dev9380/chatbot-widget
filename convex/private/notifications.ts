import { v, ConvexError } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "../_generated/server";

/* -------------------------------------------------
   INTERNAL: CREATE NOTIFICATION
------------------------------------------------- */
export const create = internalMutation({
  args: {
    organizationId: v.string(),
    type: v.union(
      v.literal("file_ready"),
      v.literal("file_failed"),
      v.literal("file_processing"),
    ),
    title: v.string(),
    message: v.string(),
    fileId: v.optional(v.string()),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(
      `[notifications.create] org=${args.organizationId}, type=${args.type}`,
    );

    await ctx.db.insert("notifications", {
      organizationId: args.organizationId,
      type: args.type,
      title: args.title,
      message: args.message,
      fileId: args.fileId,
      fileName: args.fileName,
      read: false,
      createdAt: Date.now(),
    });
  },
});

/* -------------------------------------------------
   LIST NOTIFICATIONS
------------------------------------------------- */
export const list = query({
  args: {
    organizationId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .take(args.limit ?? 50);

    return notifications;
  },
});

/* -------------------------------------------------
   UNREAD COUNT
------------------------------------------------- */
export const getUnreadCount = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_organization_id_and_read", (q) =>
        q.eq("organizationId", args.organizationId).eq("read", false),
      )
      .collect();

    return unread.length;
  },
});

/* -------------------------------------------------
   MARK ONE AS READ
------------------------------------------------- */
export const markAsRead = mutation({
  args: {
    organizationId: v.string(),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);

    if (!notification) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Notification not found",
      });
    }

    if (notification.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    await ctx.db.patch(args.notificationId, { read: true });
  },
});

/* -------------------------------------------------
   MARK ALL AS READ
------------------------------------------------- */
export const markAllAsRead = mutation({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_organization_id_and_read", (q) =>
        q.eq("organizationId", args.organizationId).eq("read", false),
      )
      .collect();

    await Promise.all(
      unread.map((n) => ctx.db.patch(n._id, { read: true })),
    );
  },
});

/* -------------------------------------------------
   DELETE ONE NOTIFICATION
------------------------------------------------- */
export const deleteNotification = mutation({
  args: {
    organizationId: v.string(),
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);

    if (!notification) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Notification not found",
      });
    }

    if (notification.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      });
    }

    await ctx.db.delete(args.notificationId);
  },
});

/* -------------------------------------------------
   DELETE ALL NOTIFICATIONS
------------------------------------------------- */
export const deleteAll = mutation({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .collect();

    await Promise.all(
      notifications.map((n) => ctx.db.delete(n._id)),
    );

    return { deleted: notifications.length };
  },
});

/* -------------------------------------------------
   INTERNAL: LIST BY FILE ID
------------------------------------------------- */
export const listByFileId = internalQuery({
  args: {
    organizationId: v.string(),
    fileId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("notifications")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .filter((q) => q.eq(q.field("fileId"), args.fileId))
      .collect();
  },
});

/* -------------------------------------------------
   INTERNAL: LIST BY FILE NAME
------------------------------------------------- */
export const listByFileName = internalQuery({
  args: {
    organizationId: v.string(),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("notifications")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .filter((q) => q.eq(q.field("fileName"), args.fileName))
      .collect();
  },
});

/* -------------------------------------------------
   INTERNAL: DELETE BY ID
------------------------------------------------- */
export const deleteById = internalMutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.notificationId);
  },
});
