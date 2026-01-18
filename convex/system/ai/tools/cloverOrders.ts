import { createTool } from "@convex-dev/agent";
import z from "zod";
import { api, internal } from "../../../_generated/api";

 function makeDebugId(prefix: string) {
   return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
 }

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function formatCents(amount: unknown) {
  const n = toNumber(amount);
  if (n === null) return null;
  return `$${(n / 100).toFixed(2)}`;
}

function safeString(value: unknown) {
  const s = typeof value === "string" ? value.trim() : "";
  return s || null;
}

function formatOrderSummary(order: any) {
  const id = safeString(order?.id) ?? safeString(order?._id) ?? "(unknown id)";
  const createdTime = toNumber(order?.createdTime);
  const created = createdTime ? new Date(createdTime).toISOString() : null;
  const state = safeString(order?.state);
  const total = formatCents(order?.total);
  const title = safeString(order?.title);

  const parts: string[] = [];
  parts.push(`Order ${id}`);
  if (title) parts.push(title);
  if (state) parts.push(`state=${state}`);
  if (total) parts.push(`total=${total}`);
  if (created) parts.push(`created=${created}`);

  return parts.join(" | ");
}

function formatOrderDetails(order: any) {
  const id = safeString(order?.id) ?? safeString(order?._id) ?? "(unknown id)";
  const state = safeString(order?.state);
  const total = formatCents(order?.total);

  const lines: string[] = [];
  lines.push(`Order ${id}${state ? ` (${state})` : ""}${total ? ` - ${total}` : ""}`);

  const lineItems: any[] =
    Array.isArray(order?.lineItems?.elements) ? order.lineItems.elements : Array.isArray(order?.lineItems) ? order.lineItems : [];

  if (lineItems.length > 0) {
    lines.push("Items:");
    for (const item of lineItems.slice(0, 20)) {
      const name = safeString(item?.name) ?? safeString(item?.item?.name) ?? "Item";
      const quantity = toNumber(item?.quantity);
      const price = formatCents(item?.price ?? item?.item?.price);
      lines.push(`${name}${quantity !== null ? ` x${quantity}` : ""}${price ? ` (${price})` : ""}`);
    }
    if (lineItems.length > 20) {
      lines.push(`(+${lineItems.length - 20} more items)`);
    }
  }

  const note = safeString(order?.note);
  if (note) {
    lines.push(`Note: ${note}`);
  }

  return lines.join("\n");
}

async function getEntityIdFromThread(ctx: any) {
  if (!ctx.threadId) return null;
  const conversation = await ctx.runQuery(internal.system.conversations.getByThreadId, {
    threadId: ctx.threadId,
  });
  return conversation?.entityId ?? null;
}

export const cloverListOrders = createTool({
  description:
    "List recent orders for the connected restaurant.",
  args: z.object({
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Max number of recent orders to fetch. Default 10."),
  }),
  handler: async (ctx, args): Promise<string> => {
    const debugId = makeDebugId("cloverListOrders");
    const entityId = await getEntityIdFromThread(ctx);
    if (!entityId) {
      console.warn(`[${debugId}] Missing entityId for threadId=${String(ctx.threadId ?? "")}`);
      return "Missing thread context.";
    }

    const limit = typeof args?.limit === "number" ? args.limit : 10;
    console.info(
      `[${debugId}] cloverListOrders start entityId=${entityId} threadId=${String(ctx.threadId ?? "")} limit=${limit}`,
    );

    try {
      const raw = await ctx.runAction((api as any).private.clover.listOrders, {
        entityId,
        limit,
        debugId,
      });

      console.info(`[${debugId}] cloverListOrders action ok`);

      const elements: any[] =
        raw && typeof raw === "object" && Array.isArray((raw as any).elements)
          ? (raw as any).elements
          : raw && typeof raw === "object" && (raw as any).elements && Array.isArray((raw as any).elements.elements)
            ? (raw as any).elements.elements
            : []

      if (!Array.isArray(elements) || elements.length === 0) {
        return "No recent orders found.";
      }

      const summaries = elements.slice(0, Math.min(elements.length, 10)).map(formatOrderSummary);
      return `Recent orders:\n${summaries.map((s) => `- ${s}`).join("\n")}`;
    } catch (e) {
      console.error(`[${debugId}] cloverListOrders failed`, e);
      const message = e && typeof e === "object" && "message" in e ? String((e as any).message) : "";
      if (message.toLowerCase().includes("not connected")) {
        return "Live ordering is unavailable right now. I can still help with the restaurant's menu details, hours, delivery, and reservations.";
      }
      return "I couldn't fetch recent orders right now.";
    }
  },
});

export const cloverGetOrder = createTool({
  description:
    "Get details for a specific order (items, totals, and status).",
  args: z.object({
    orderId: z.string().min(1).describe("Order ID"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const debugId = makeDebugId("cloverGetOrder");
    const entityId = await getEntityIdFromThread(ctx);
    if (!entityId) {
      console.warn(`[${debugId}] Missing entityId for threadId=${String(ctx.threadId ?? "")}`);
      return "Missing thread context.";
    }

    console.info(
      `[${debugId}] cloverGetOrder start entityId=${entityId} threadId=${String(ctx.threadId ?? "")} orderId=${args.orderId}`,
    );

    try {
      const raw = await ctx.runAction((api as any).private.clover.getOrder, {
        entityId,
        orderId: args.orderId,
        debugId,
      });

      console.info(`[${debugId}] cloverGetOrder action ok`);

      return formatOrderDetails(raw);
    } catch (e) {
      console.error(`[${debugId}] cloverGetOrder failed`, e);
      const message = e && typeof e === "object" && "message" in e ? String((e as any).message) : "";
      if (message.toLowerCase().includes("not connected")) {
        return "Live ordering is unavailable right now. I can still help with the restaurant's menu details, hours, delivery, and reservations.";
      }
      return "I couldn't fetch that order right now.";
    }
  },
});

export const cloverSearchItems = createTool({
  description: "Search the menu by name (e.g. biryani) so you can place an order.",
  args: z.object({
    query: z.string().optional().describe("Search query (item name or keyword). Omit to list items."),
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Max number of items to return. Default 10."),
  }),
  handler: async (ctx, args): Promise<string> => {
    const debugId = makeDebugId("cloverSearchItems");
    const entityId = await getEntityIdFromThread(ctx);
    if (!entityId) {
      console.warn(`[${debugId}] Missing entityId for threadId=${String(ctx.threadId ?? "")}`);
      return "Missing thread context.";
    }

    const query = String((args as any)?.query ?? "").trim();
    const limit = typeof args?.limit === "number" ? args.limit : 10;

    const qLower = query.toLowerCase();
    const looksLikeMenuSection =
      qLower === "starters" ||
      qLower === "veg starters" ||
      qLower === "vegetarian starters" ||
      qLower === "appetizers" ||
      qLower === "appetisers" ||
      qLower === "desserts" ||
      qLower === "beverages" ||
      qLower === "drinks";

    const category: "beverages" | "desserts" | "starters" | null = looksLikeMenuSection
      ? qLower.includes("drink") || qLower.includes("beverage")
        ? "beverages"
        : qLower.includes("dessert")
          ? "desserts"
          : "starters"
      : null;

    console.info(
      `[${debugId}] cloverSearchItems start entityId=${entityId} threadId=${String(ctx.threadId ?? "")} query=${query} limit=${limit}`,
    );

    try {
      const raw = await ctx.runAction((api as any).private.clover.listItems, {
        entityId,
        query: category ? undefined : query || undefined,
        limit: category ? 200 : limit,
        debugId,
      });

      const elements: any[] =
        raw && typeof raw === "object" && Array.isArray((raw as any).elements) ? (raw as any).elements : [];

      const filterByCategory = (items: any[], c: "beverages" | "desserts" | "starters") => {
        const keywords: Record<string, string[]> = {
          beverages: [
            "lassi",
            "tea",
            "coffee",
            "juice",
            "soda",
            "coke",
            "pepsi",
            "sprite",
            "water",
            "kombucha",
            "jaljeera",
            "pani",
            "drink",
          ],
          desserts: ["dessert", "sweet", "cake", "lava", "rasmalai", "gulab", "jamun", "brownie", "ice"],
          starters: [
            "starter",
            "appet",
            "soup",
            "salad",
            "fries",
            "tikka",
            "pakora",
            "kebab",
            "roll",
            "chilli",
            "manchur",
          ],
        };
        const k = keywords[c] ?? [];
        return items.filter((it) => {
          const name = String(it?.name ?? "").toLowerCase();
          return k.some((kw) => name.includes(kw));
        });
      };

      const finalElements = category ? filterByCategory(elements, category) : elements;

      if (!Array.isArray(finalElements) || finalElements.length === 0) {
        let fallbackElements: any[] = [];
        try {
          const fallback = await ctx.runAction((api as any).private.clover.listItems, {
            entityId,
            limit: 10,
            debugId,
          });
          fallbackElements =
            fallback && typeof fallback === "object" && Array.isArray((fallback as any).elements)
              ? (fallback as any).elements
              : [];
        } catch (e) {
          console.error(`[${debugId}] cloverSearchItems fallback listItems failed`, e);
        }

        if (!fallbackElements.length) {
          if (!query) {
            return "I couldn't load the menu right now.";
          }
          return `I couldn't find "${query}" on the menu right now.`;
        }

        const lines: string[] = [];
        if (query) {
          lines.push(`I couldn't find "${query}". Here are a few things you can order:`);
        } else {
          lines.push("Here are a few items you can order:");
        }
        for (const item of fallbackElements.slice(0, 8)) {
          const name = safeString(item?.name) ?? "Item";
          const price = formatCents(item?.price);
          lines.push(`${name}${price ? ` (${price})` : ""}`);
        }
        lines.push('Tell me which one you want (for example: "Order 1 pizza").');
        return lines.join("\n");
      }

      const lines: string[] = [];
      if (category === "beverages") {
        lines.push("Here are some beverages you can order:");
      } else if (category === "desserts") {
        lines.push("Here are some desserts you can order:");
      } else if (category === "starters") {
        lines.push("Here are some starters you can order:");
      } else if (query) {
        lines.push(`Here are a few options for "${query}":`);
      } else {
        lines.push("Here are a few items you can order:");
      }

      const outLimit = category ? 12 : Math.min(finalElements.length, limit);
      for (const item of finalElements.slice(0, outLimit)) {
        const name = safeString(item?.name) ?? "Item";
        const price = formatCents(item?.price);
        lines.push(`${name}${price ? ` (${price})` : ""}`);
      }
      lines.push('If you tell me what you want (and quantity), I can place it.');
      return lines.join("\n");
    } catch (e) {
      console.error(`[${debugId}] cloverSearchItems failed`, e);
      const message = e && typeof e === "object" && "message" in e ? String((e as any).message) : "";
      if (message.toLowerCase().includes("not connected")) {
        return "Live ordering is unavailable right now. I can still help with menu details, hours, delivery, reservations, and ordering.";
      }
      return "I couldn't load the menu right now.";
    }
  },
});

export const cloverCreateOrder = createTool({
  description:
    "Place an order from the menu. Prefer using item names (not internal IDs).",
  args: z.object({
    orderTypeId: z
      .string()
      .optional()
      .describe("Optional order type id. If omitted, the system will pick the first available order type."),
    items: z
      .array(
        z
          .object({
            name: z.string().optional().describe("Menu item name"),
            itemId: z.string().optional().describe("Internal item id (avoid using this)"),
            quantity: z.number().min(1).max(50).optional().describe("Quantity (default 1)"),
          })
          .refine((v) => Boolean(String(v?.itemId ?? "").trim() || String(v?.name ?? "").trim()), {
            message: "Each item must include either a name or itemId",
          }),
      )
      .min(1)
      .describe("Line items to add to the order"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const debugId = makeDebugId("cloverCreateOrder");
    const entityId = await getEntityIdFromThread(ctx);
    if (!entityId) {
      console.warn(`[${debugId}] Missing entityId for threadId=${String(ctx.threadId ?? "")}`);
      return "Missing thread context.";
    }

    const orderTypeId = typeof args?.orderTypeId === "string" ? args.orderTypeId : undefined;
    const items = Array.isArray(args?.items) ? args.items : [];

    console.info(
      `[${debugId}] cloverCreateOrder start entityId=${entityId} threadId=${String(ctx.threadId ?? "")} orderTypeId=${String(orderTypeId ?? "")}`,
    );

    try {
      const normalized = items
        .map((i: any) => ({
          itemId: String(i?.itemId ?? "").trim(),
          name: String(i?.name ?? "").trim(),
          quantity: typeof i?.quantity === "number" && i.quantity > 0 ? i.quantity : 1,
        }))
        .filter((i) => Boolean(i.itemId || i.name));

      if (normalized.length === 0) {
        return "Tell me what you'd like to order (for example: \"Order 1 pizza\").";
      }

      const resolvedLineItems: Array<{ itemId: string; quantity: number; displayName?: string }> = [];
      for (const item of normalized) {
        if (item.itemId) {
          resolvedLineItems.push({ itemId: item.itemId, quantity: item.quantity });
          continue;
        }

        const search = await ctx.runAction((api as any).private.clover.listItems, {
          entityId,
          query: item.name,
          limit: 20,
          debugId,
        });

        const elements: any[] =
          search && typeof search === "object" && Array.isArray((search as any).elements) ? (search as any).elements : [];
        const target = item.name.toLowerCase();

        const pick = (candidates: any[]) => {
          const exact = candidates.find((x) => String(x?.name ?? "").trim().toLowerCase() === target);
          if (exact) return exact;
          const starts = candidates.find((x) => String(x?.name ?? "").trim().toLowerCase().startsWith(target));
          if (starts) return starts;
          const includes = candidates.find((x) => String(x?.name ?? "").trim().toLowerCase().includes(target));
          if (includes) return includes;
          return candidates[0] ?? null;
        };

        const chosen = pick(elements);
        const chosenId = safeString(chosen?.id);
        if (!chosenId) {
          return `I couldn't find \"${item.name}\" on the menu. Try another item name.`;
        }

        resolvedLineItems.push({
          itemId: chosenId,
          quantity: item.quantity,
          displayName: safeString(chosen?.name) ?? item.name,
        });
      }

      const raw = await ctx.runAction((api as any).private.clover.createAtomicOrder, {
        entityId,
        orderTypeId,
        lineItems: resolvedLineItems.map((i) => ({
          itemId: i.itemId,
          quantity: i.quantity,
        })),
        debugId,
      });

      const orderId = safeString((raw as any)?.id) ?? safeString((raw as any)?._id) ?? null;
      if (!orderId) {
        return "Your order was created, but I couldn't fetch the order number.";
      }

      return `All set. Your order is in. Order number: ${orderId}`;
    } catch (e) {
      console.error(`[${debugId}] cloverCreateOrder failed`, e);
      const message = e && typeof e === "object" && "message" in e ? String((e as any).message) : "";
      if (message.toLowerCase().includes("not connected")) {
        return "Live ordering is unavailable right now. I can still help you pick items from the menu info and share hours, delivery, or reservation details.";
      }

      const lower = message.toLowerCase();
      if (lower.includes("no order types found") || lower.includes("missing clover ordertypeid") || lower.includes("ordertype")) {
        return "I can’t place orders yet because this location doesn’t have a service type set up (like Pickup, Delivery, or Dine-in). Add at least one in your POS ordering settings, then try again.";
      }

      return "I couldn't place that order right now.";
    }
  },
});
