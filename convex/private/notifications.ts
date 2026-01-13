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
    entityId: v.string(),
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
      `[notifications.create] org=${args.entityId}, type=${args.type}`,
    );

    await ctx.db.insert("notifications", {
      entityId: args.entityId,
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
    entityId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId),
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
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_entity_id_and_read", (q) =>
        q.eq("entityId", args.entityId).eq("read", false),
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
    entityId: v.string(),
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

    if (notification.entityId !== args.entityId) {
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
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_entity_id_and_read", (q) =>
        q.eq("entityId", args.entityId).eq("read", false),
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
    entityId: v.string(),
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

    if (notification.entityId !== args.entityId) {
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
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId),
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
    entityId: v.string(),
    fileId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("notifications")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId),
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
    entityId: v.string(),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("notifications")
      .withIndex("by_entity_id", (q) =>
        q.eq("entityId", args.entityId),
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
