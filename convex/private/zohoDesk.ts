import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

type ZohoDeskSecret = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;

  accountsBaseUrl?: string;
  apiBaseUrl?: string;

  // Optional metadata.
  departmentId?: string;
  orgId?: string;

  connectionStatus?: "CONNECTED" | "DISCONNECTED";
};

function normalizeRegion(raw: string | undefined) {
  return String(raw ?? "").trim().toLowerCase() || "com";
}

function accountsBaseUrlFromRegion(regionRaw: string | undefined) {
  const region = normalizeRegion(regionRaw);
  switch (region) {
    case "com":
      return "https://accounts.zoho.com";
    case "eu":
      return "https://accounts.zoho.eu";
    case "in":
      return "https://accounts.zoho.in";
    case "com.au":
    case "au":
      return "https://accounts.zoho.com.au";
    case "jp":
      return "https://accounts.zoho.jp";
    case "com.cn":
    case "cn":
      return "https://accounts.zoho.com.cn";
    default:
      return "https://accounts.zoho.com";
  }
}

function deskApiBaseUrlFromRegion(regionRaw: string | undefined) {
  const region = normalizeRegion(regionRaw);
  switch (region) {
    case "com":
      return "https://desk.zoho.com";
    case "eu":
      return "https://desk.zoho.eu";
    case "in":
      return "https://desk.zoho.in";
    case "com.au":
    case "au":
      return "https://desk.zoho.com.au";
    case "jp":
      return "https://desk.zoho.jp";
    case "com.cn":
    case "cn":
      return "https://desk.zoho.com.cn";
    default:
      return "https://desk.zoho.com";
  }
}

function getGlobalOAuthAppConfig(): {
  clientId: string;
  clientSecret: string;
  accountsBaseUrl: string;
  apiBaseUrl: string;
} | null {
  const clientId = String(process.env.ZOHO_DESK_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.ZOHO_DESK_CLIENT_SECRET ?? "").trim();
  const accountsBaseUrl = accountsBaseUrlFromRegion(process.env.ZOHO_REGION);
  const apiBaseUrl = deskApiBaseUrlFromRegion(process.env.ZOHO_REGION);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, accountsBaseUrl, apiBaseUrl };
}

async function getZohoDeskSecretForOrg(
  ctx: any,
  entityId: string,
): Promise<{ plugin: any | null; secret: ZohoDeskSecret | null }> {
  const plugin: any = await ctx.runQuery(internal.system.plugin.getByEntityIdAndService, {
    entityId,
    service: "zoho_desk" as any,
  });

  if (!plugin) return { plugin: null, secret: null };

  const secretValue = await getSecretValue(plugin.secretName);
  const secretData = parseSecretString<ZohoDeskSecret>(secretValue);
  return { plugin, secret: secretData };
}

async function readJsonOrText(response: Response): Promise<{ json: unknown | null; text: string }> {
  const text = await response.text();
  if (!text) return { json: null, text: "" };
  try {
    return { json: JSON.parse(text) as unknown, text };
  } catch {
    return { json: null, text };
  }
}

function getErrorMessageFromBody(body: { json: unknown | null; text: string }) {
  if (body.json && typeof body.json === "object" && !Array.isArray(body.json)) {
    const record = body.json as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message;

    const error = record.error;
    if (typeof error === "string" && error.trim()) return error;

    const errorMessage = (record as any).errorMessage;
    if (typeof errorMessage === "string" && errorMessage.trim()) return errorMessage;

    const reason = (record as any).reason;
    if (typeof reason === "string" && reason.trim()) return reason;
  }

  if (body.text.trim()) return body.text;
  return null;
}

function isTokenExpired(expiresAt: number | undefined) {
  if (!expiresAt) return true;
  return Date.now() >= expiresAt - 30_000;
}

async function refreshZohoDeskAccessToken(ctx: any, entityId: string) {
  const global = getGlobalOAuthAppConfig();
  if (!global) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Missing Zoho Desk OAuth app config. Set ZOHO_DESK_CLIENT_ID, ZOHO_DESK_CLIENT_SECRET, and ZOHO_REGION.",
    });
  }

  const { plugin, secret } = await getZohoDeskSecretForOrg(ctx, entityId);
  if (!plugin || !secret) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Zoho Desk is not connected" });
  }

  const status = String(secret.connectionStatus ?? "").toUpperCase();
  if (status && status !== "CONNECTED") {
    throw new ConvexError({ code: "NOT_FOUND", message: "Zoho Desk is not connected" });
  }

  const refreshToken = String(secret.refreshToken ?? "").trim();
  if (!refreshToken) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Zoho Desk disconnected. Please reconnect.",
    });
  }

  const tokenUrl = `${global.accountsBaseUrl.replace(/\/$/, "")}/oauth/v2/token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: global.clientId,
      client_secret: global.clientSecret,
    }).toString(),
  });

  const body = await readJsonOrText(response);
  if (!response.ok) {
    await ctx.runAction(internal.system.secrets.upsert, {
      service: "zoho_desk" as any,
      entityId,
      value: {
        ...secret,
        accessToken: undefined,
        refreshToken: undefined,
        expiresAt: undefined,
        connectionStatus: "DISCONNECTED",
      },
    });

    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Zoho Desk disconnected. Please reconnect.",
    });
  }

  const json =
    body.json && typeof body.json === "object" && !Array.isArray(body.json)
      ? (body.json as Record<string, unknown>)
      : null;
  const accessToken = typeof json?.access_token === "string" ? json.access_token : "";
  const expiresIn = typeof json?.expires_in === "number" ? json.expires_in : Number(json?.expires_in);
  const scope = typeof json?.scope === "string" ? json.scope : undefined;

  if (!accessToken.trim()) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Zoho refresh response missing access_token",
    });
  }

  const expiresAt = Number.isFinite(expiresIn) ? Date.now() + Number(expiresIn) * 1000 : Date.now() + 3600 * 1000;

  await ctx.runAction(internal.system.secrets.upsert, {
    service: "zoho_desk" as any,
    entityId,
    value: {
      ...secret,
      accountsBaseUrl: global.accountsBaseUrl,
      apiBaseUrl: global.apiBaseUrl,
      accessToken,
      expiresAt,
      scope,
      connectionStatus: "CONNECTED",
    },
  });

  return { accessToken, expiresAt };
}

async function ensureOrgId(
  ctx: any,
  cfg: { entityId: string; apiBaseUrl: string; accessToken: string },
  secret: ZohoDeskSecret,
) {
  const existing = String(secret.orgId ?? "").trim();
  if (existing) return existing;

  const url = `${cfg.apiBaseUrl.replace(/\/$/, "")}/api/v1/organizations`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${cfg.accessToken}`,
    },
  });

  const body = await readJsonOrText(resp);
  if (!resp.ok) {
    // orgId is optional in some regions/accounts, so don't hard-fail here.
    return undefined;
  }

  const data =
    body.json && typeof body.json === "object" && !Array.isArray(body.json)
      ? ((body.json as any).data as any[] | undefined)
      : undefined;

  const orgs = Array.isArray(data) ? data : [];
  const first = orgs[0];
  const id = first && typeof first === "object" ? (first as any).id : null;
  const orgId = typeof id === "string" ? id : typeof id === "number" ? String(id) : "";
  if (!orgId.trim()) return undefined;

  await ctx.runAction(internal.system.secrets.upsert, {
    service: "zoho_desk" as any,
    entityId: cfg.entityId,
    value: {
      ...secret,
      orgId,
    },
  });

  return orgId;
}

async function ensureDepartmentId(ctx: any, cfg: { entityId: string; apiBaseUrl: string; accessToken: string; orgId?: string }, secret: ZohoDeskSecret) {
  const existing = String(secret.departmentId ?? "").trim();
  if (existing) return existing;

  const url = new URL(`${cfg.apiBaseUrl.replace(/\/$/, "")}/api/v1/departments`);
  url.searchParams.set("isEnabled", "true");
  url.searchParams.set("limit", "200");

  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${cfg.accessToken}`,
  };
  const orgId = String(cfg.orgId ?? "").trim();
  if (orgId) headers.orgId = orgId;

  const resp = await fetch(url.toString(), { headers });
  const body = await readJsonOrText(resp);
  if (!resp.ok) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? "Failed to list Zoho Desk departments",
    });
  }

  const data =
    body.json && typeof body.json === "object" && !Array.isArray(body.json)
      ? ((body.json as any).data as any[] | undefined)
      : undefined;

  const departments = Array.isArray(data) ? data : [];
  const preferred = departments.find((d) => d && typeof d === "object" && (d as any).isDefault === true);
  const chosen = preferred ?? departments[0];
  const id = chosen && typeof chosen === "object" ? (chosen as any).id : null;
  const departmentId = typeof id === "string" ? id : typeof id === "number" ? String(id) : "";

  if (!departmentId.trim()) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Could not determine Zoho Desk departmentId. Create at least one department in Zoho Desk.",
    });
  }

  await ctx.runAction(internal.system.secrets.upsert, {
    service: "zoho_desk" as any,
    entityId: cfg.entityId,
    value: {
      ...secret,
      departmentId,
    },
  });

  return departmentId;
}

async function getZohoDeskConfig(ctx: any, entityId: string) {
  const global = getGlobalOAuthAppConfig();
  if (!global) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Missing Zoho Desk OAuth app config. Set ZOHO_DESK_CLIENT_ID, ZOHO_DESK_CLIENT_SECRET, and ZOHO_REGION.",
    });
  }

  const { plugin, secret } = await getZohoDeskSecretForOrg(ctx, entityId);
  if (!plugin || !secret) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Zoho Desk is not connected",
    });
  }

  const status = String(secret.connectionStatus ?? "").toUpperCase();
  if (status && status !== "CONNECTED") {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Zoho Desk is not connected",
    });
  }

  const refreshToken = String(secret.refreshToken ?? "").trim();
  if (!refreshToken) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Zoho Desk is not connected",
    });
  }

  const apiBaseUrl = String(secret.apiBaseUrl ?? global.apiBaseUrl).replace(/\/$/, "");
  let accessToken = String(secret.accessToken ?? "").trim();
  let expiresAt = secret.expiresAt;

  if (!accessToken || isTokenExpired(expiresAt)) {
    const refreshed = await refreshZohoDeskAccessToken(ctx, entityId);
    accessToken = refreshed.accessToken;
    expiresAt = refreshed.expiresAt;
  }

  const orgId =
    (String(secret.orgId ?? "").trim() ||
      (await ensureOrgId(ctx, { entityId, apiBaseUrl, accessToken }, secret)) ||
      "")
      .trim() || undefined;

  const departmentId = await ensureDepartmentId(ctx, { entityId, apiBaseUrl, accessToken, orgId }, secret);

  return {
    entityId,
    apiBaseUrl,
    accessToken,
    expiresAt,
    departmentId,
    orgId,
  };
}

function deriveContactParts(name: string | null, email: string | null) {
  const n = String(name ?? "").trim();
  const e = String(email ?? "").trim();

  const fallbackLastName = (() => {
    if (e && e.includes("@")) return e.split("@")[0] || "Customer";
    return "Customer";
  })();

  if (!n) {
    return { firstName: undefined as string | undefined, lastName: fallbackLastName };
  }

  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { firstName: undefined, lastName: parts[0] ?? fallbackLastName };
  }

  const firstName = parts.slice(0, -1).join(" ");
  const lastName = parts[parts.length - 1] ?? fallbackLastName;
  return { firstName, lastName };
}

export const getConnectionStatus: any = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const global = getGlobalOAuthAppConfig();
    if (!global) {
      return { configured: false, connected: false };
    }

    const { plugin, secret } = await getZohoDeskSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { configured: true, connected: false };
    }

    const refreshToken = String(secret.refreshToken ?? "").trim();
    const status = String(secret.connectionStatus ?? "").toUpperCase();
    const connected = Boolean(refreshToken) && (status ? status === "CONNECTED" : true);
    return { configured: true, connected };
  },
});

export const getOAuthAppConfig: any = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const global = getGlobalOAuthAppConfig();
    if (!global) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Missing Zoho Desk OAuth app config. Set ZOHO_DESK_CLIENT_ID, ZOHO_DESK_CLIENT_SECRET, and ZOHO_REGION.",
      });
    }

    const { plugin, secret } = await getZohoDeskSecretForOrg(ctx, args.entityId);
    const prev = secret ?? ({} as ZohoDeskSecret);

    if (!plugin || !secret) {
      await ctx.runAction(internal.system.secrets.upsert, {
        service: "zoho_desk" as any,
        entityId: args.entityId,
        value: {
          ...prev,
          accountsBaseUrl: global.accountsBaseUrl,
          apiBaseUrl: global.apiBaseUrl,
        },
      });
    } else {
      await ctx.runAction(internal.system.secrets.upsert, {
        service: "zoho_desk" as any,
        entityId: args.entityId,
        value: {
          ...prev,
          accountsBaseUrl: global.accountsBaseUrl,
          apiBaseUrl: global.apiBaseUrl,
        },
      });
    }

    return {
      clientId: global.clientId,
      accountsBaseUrl: global.accountsBaseUrl.replace(/\/$/, ""),
    };
  },
});

export const completeOAuthConnection: any = action({
  args: {
    entityId: v.string(),
    code: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const global = getGlobalOAuthAppConfig();
    if (!global) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Missing Zoho Desk OAuth app config. Set ZOHO_DESK_CLIENT_ID, ZOHO_DESK_CLIENT_SECRET, and ZOHO_REGION.",
      });
    }

    const { secret } = await getZohoDeskSecretForOrg(ctx, args.entityId);
    const prior = (secret ?? ({} as ZohoDeskSecret)) as ZohoDeskSecret;

    const tokenUrl = `${global.accountsBaseUrl.replace(/\/$/, "")}/oauth/v2/token`;
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: global.clientId,
        client_secret: global.clientSecret,
        redirect_uri: args.redirectUri,
        code: args.code,
      }).toString(),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to exchange code for tokens",
      });
    }

    const json =
      body.json && typeof body.json === "object" && !Array.isArray(body.json)
        ? (body.json as Record<string, unknown>)
        : null;

    const accessToken = typeof json?.access_token === "string" ? json.access_token : null;
    const refreshToken = typeof json?.refresh_token === "string" ? json.refresh_token : null;
    const expiresIn = typeof json?.expires_in === "number" ? json.expires_in : Number(json?.expires_in);
    const scope = typeof json?.scope === "string" ? json.scope : undefined;

    if (!accessToken) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "OAuth token response missing access_token",
      });
    }

    if (!refreshToken) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Zoho did not return a refresh token. Ensure you requested offline access (access_type=offline) and prompt=consent, then reconnect.",
      });
    }

    const expiresAt = Number.isFinite(expiresIn) ? Date.now() + Number(expiresIn) * 1000 : Date.now() + 3600 * 1000;

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "zoho_desk" as any,
      entityId: args.entityId,
      value: {
        ...prior,
        accountsBaseUrl: global.accountsBaseUrl,
        apiBaseUrl: global.apiBaseUrl,

        accessToken,
        refreshToken,
        expiresAt,
        scope,
        connectionStatus: "CONNECTED",
      },
    });

    return { ok: true };
  },
});

export const updateTicketStatus: any = action({
  args: {
    entityId: v.string(),
    ticketId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getZohoDeskConfig(ctx, args.entityId);
    const ticketId = String(args.ticketId ?? "").trim();
    if (!ticketId) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing Zoho Desk ticket id" });
    }

    const nextStatus = String(args.status ?? "").trim();
    if (!nextStatus) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing Zoho Desk status" });
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${cfg.accessToken}`,
      "Content-Type": "application/json",
    };
    if (cfg.orgId) headers.orgId = cfg.orgId;

    const url = `${cfg.apiBaseUrl.replace(/\/$/, "")}/api/v1/tickets/${encodeURIComponent(ticketId)}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: nextStatus }),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to update Zoho Desk ticket status",
      });
    }

    return { ok: true };
  },
});

export const disconnect: any = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const { plugin, secret } = await getZohoDeskSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { ok: true };
    }

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "zoho_desk" as any,
      entityId: args.entityId,
      value: {
        ...secret,
        accessToken: undefined,
        refreshToken: undefined,
        expiresAt: undefined,
        scope: undefined,
        departmentId: undefined,
        orgId: undefined,
        connectionStatus: "DISCONNECTED",
      },
    });

    return { ok: true };
  },
});

export const createTicket: any = action({
  args: {
    entityId: v.string(),
    subject: v.string(),
    description: v.string(),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cfg = await getZohoDeskConfig(ctx, args.entityId);

    const { firstName, lastName } = deriveContactParts(args.contactName ?? null, args.contactEmail ?? null);

    const payload: Record<string, unknown> = {
      subject: String(args.subject ?? "").trim() || "Chatbot conversation",
      description: String(args.description ?? "").trim(),
      departmentId: cfg.departmentId,
      channel: "Web",
      status: "Open",
    };

    const email = String(args.contactEmail ?? "").trim();
    if (email) {
      payload.email = email;
      payload.contact = {
        lastName,
        ...(firstName ? { firstName } : null),
        email,
      };
    } else {
      payload.contact = {
        lastName,
        ...(firstName ? { firstName } : null),
      };
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${cfg.accessToken}`,
      "Content-Type": "application/json",
    };
    if (cfg.orgId) headers.orgId = cfg.orgId;

    const url = `${cfg.apiBaseUrl.replace(/\/$/, "")}/api/v1/tickets`;
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to create Zoho Desk ticket",
      });
    }

    const json =
      body.json && typeof body.json === "object" && !Array.isArray(body.json)
        ? (body.json as Record<string, unknown>)
        : null;

    const id = (json as any)?.id;
    const ticketId = typeof id === "string" ? id : typeof id === "number" ? String(id) : "";
    if (!ticketId.trim()) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Zoho Desk ticket creation returned no ticket id",
      });
    }

    return { id: ticketId };
  },
});

export const addTicketComment: any = action({
  args: {
    entityId: v.string(),
    ticketId: v.string(),
    commentBody: v.string(),
    isPublic: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const cfg = await getZohoDeskConfig(ctx, args.entityId);
    const ticketId = String(args.ticketId ?? "").trim();
    if (!ticketId) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing Zoho Desk ticket id" });
    }

    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${cfg.accessToken}`,
      "Content-Type": "application/json",
    };
    if (cfg.orgId) headers.orgId = cfg.orgId;

    const url = `${cfg.apiBaseUrl.replace(/\/$/, "")}/api/v1/tickets/${encodeURIComponent(ticketId)}/comments`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        isPublic: Boolean(args.isPublic ?? false),
        contentType: "plainText",
        content: String(args.commentBody ?? "").trim(),
      }),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to create Zoho Desk ticket comment",
      });
    }

    return { ok: true };
  },
});
