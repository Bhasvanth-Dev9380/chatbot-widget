import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

type CloverSecret = {
  merchantId?: string;
  accessToken?: string;
  accessTokenExpiration?: number;
  refreshToken?: string;
  refreshTokenExpiration?: number;
  apiBaseUrl?: string;
  oauthBaseUrl?: string;
  connectionStatus?: "CONNECTED" | "DISCONNECTED";
};

function maskId(value: string) {
  const s = String(value ?? "");
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

function truncate(value: string, max = 800) {
  const s = String(value ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, max)}...`;
}

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.replace(/\/$/, "");
}

function getGlobalOAuthAppConfig(): {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  oauthBaseUrl: string;
} | null {
  const clientId = String(process.env.CLOVER_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.CLOVER_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;

  const isSandbox = String(process.env.CLOVER_ENV ?? "").trim().toLowerCase() === "sandbox";
  const defaultBase = isSandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";

  const apiBaseUrl = normalizeBaseUrl(process.env.CLOVER_API_BASE_URL, defaultBase);
  const oauthBaseUrl = normalizeBaseUrl(process.env.CLOVER_OAUTH_BASE_URL, apiBaseUrl);

  return { clientId, clientSecret, apiBaseUrl, oauthBaseUrl };
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
  }

  if (body.text.trim()) return body.text;
  return null;
}

async function clearCloverTokens(ctx: any, params: { entityId: string; secret: CloverSecret }) {
  await ctx.runAction(internal.system.secrets.upsert, {
    service: "clover" as any,
    entityId: params.entityId,
    value: {
      ...params.secret,
      merchantId: undefined,
      accessToken: undefined,
      refreshToken: undefined,
      accessTokenExpiration: undefined,
      refreshTokenExpiration: undefined,
      connectionStatus: "DISCONNECTED",
    },
  });
}

async function getCloverSecretForOrg(
  ctx: any,
  entityId: string,
): Promise<{ plugin: any | null; secret: CloverSecret | null }> {
  const plugin: any = await ctx.runQuery(internal.system.plugin.getByEntityIdAndService, {
    entityId,
    service: "clover" as any,
  });

  if (!plugin) {
    const fallbackSecretName = `tenant/${entityId}/clover`;
    try {
      const secretValue = await getSecretValue(fallbackSecretName);
      const secretData = parseSecretString<CloverSecret>(secretValue);
      if (secretData) {
        await ctx.runMutation(internal.system.plugin.upsert, {
          service: "clover" as any,
          secretName: fallbackSecretName,
          entityId,
        });
        return { plugin: { secretName: fallbackSecretName }, secret: secretData };
      }
    } catch (error) {
      void error;
    }

    return { plugin: null, secret: null };
  }

  const secretValue = await getSecretValue(plugin.secretName);
  const secretData = parseSecretString<CloverSecret>(secretValue);
  return { plugin, secret: secretData };
}

async function refreshTokens(params: {
  oauthBaseUrl: string;
  clientId: string;
  refreshToken: string;
  debugId?: string;
}): Promise<{
  accessToken: string;
  accessTokenExpiration: number | null;
  refreshToken: string;
  refreshTokenExpiration: number | null;
}> {
  const debugId = params.debugId ? String(params.debugId) : "";
  const logPrefix = debugId ? `[${debugId}]` : "[clover]";

  const response = await fetch(`${params.oauthBaseUrl}/oauth/v2/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      client_id: params.clientId,
      refresh_token: params.refreshToken,
    }),
  });

  const body = await readJsonOrText(response);
  if (!response.ok) {
    console.warn(
      `${logPrefix} Clover refresh failed status=${response.status} oauthBaseUrl=${params.oauthBaseUrl} body=${truncate(body.text)}`,
    );
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? "Failed to refresh Clover tokens",
    });
  }

  const json =
    body.json && typeof body.json === "object" && !Array.isArray(body.json)
      ? (body.json as Record<string, unknown>)
      : null;

  const accessToken = typeof json?.access_token === "string" ? json.access_token : null;
  const refreshToken = typeof json?.refresh_token === "string" ? json.refresh_token : null;
  const accessTokenExpiration =
    typeof json?.access_token_expiration === "number" ? json.access_token_expiration : null;
  const refreshTokenExpiration =
    typeof json?.refresh_token_expiration === "number" ? json.refresh_token_expiration : null;

  if (!accessToken || !refreshToken) {
    console.warn(`${logPrefix} Clover refresh response missing access_token/refresh_token`);
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Clover refresh response missing access_token/refresh_token",
    });
  }

  return {
    accessToken,
    refreshToken,
    accessTokenExpiration,
    refreshTokenExpiration,
  };
}

async function ensureValidAccessToken(
  ctx: any,
  args: { entityId: string; debugId?: string; forceRefresh?: boolean },
) {
  const debugId = args.debugId ? String(args.debugId) : "";
  const logPrefix = debugId ? `[${debugId}]` : "[clover]";

  const global = getGlobalOAuthAppConfig();
  if (!global) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Missing Clover OAuth app config. Set CLOVER_CLIENT_ID and CLOVER_CLIENT_SECRET.",
    });
  }

  const { plugin, secret } = await getCloverSecretForOrg(ctx, args.entityId);
  if (!plugin || !secret) {
    console.warn(`${logPrefix} Clover not connected entityId=${args.entityId}`);
    throw new ConvexError({ code: "NOT_FOUND", message: "Clover is not connected" });
  }

  const merchantId = String(secret.merchantId ?? "").trim();
  const accessToken = String(secret.accessToken ?? "").trim();
  const refreshToken = String(secret.refreshToken ?? "").trim();
  const apiBaseUrl = normalizeBaseUrl(secret.apiBaseUrl, global.apiBaseUrl);
  const oauthBaseUrl = normalizeBaseUrl(secret.oauthBaseUrl, global.oauthBaseUrl);

  if (!merchantId || !refreshToken) {
    console.warn(
      `${logPrefix} Clover secret missing merchantId/refreshToken entityId=${args.entityId} merchantId=${merchantId ? maskId(merchantId) : "(missing)"}`,
    );
    throw new ConvexError({ code: "NOT_FOUND", message: "Clover is not connected" });
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof secret.accessTokenExpiration === "number" ? secret.accessTokenExpiration : null;
  const shouldRefresh = Boolean(args.forceRefresh) || !accessToken || (exp !== null && exp - now < 120);

  if (!shouldRefresh) {
    console.info(
      `${logPrefix} Clover access token ok entityId=${args.entityId} merchantId=${maskId(merchantId)} apiBaseUrl=${apiBaseUrl}`,
    );
    return { merchantId, accessToken, apiBaseUrl, oauthBaseUrl };
  }

  console.info(
    `${logPrefix} Clover refreshing token entityId=${args.entityId} merchantId=${maskId(merchantId)} exp=${exp ?? "(none)"} now=${now}`,
  );

  let refreshed: {
    accessToken: string;
    accessTokenExpiration: number | null;
    refreshToken: string;
    refreshTokenExpiration: number | null;
  };
  try {
    refreshed = await refreshTokens({
      oauthBaseUrl,
      clientId: global.clientId,
      refreshToken,
      debugId,
    });
  } catch (error) {
    const rawMessage =
      error && typeof error === "object" && "message" in error
        ? String((error as any).message)
        : "";
    const normalized = rawMessage.toLowerCase();
    const looksUnauthorized = normalized.includes("401") || normalized.includes("unauthorized");

    console.warn(`${logPrefix} Clover token refresh failed`, error);

    if (looksUnauthorized) {
      console.warn(
        `${logPrefix} Clover refresh token unauthorized; clearing stored tokens entityId=${args.entityId} merchantId=${maskId(merchantId)}`,
      );
      await ctx.runAction(internal.system.secrets.upsert, {
        service: "clover" as any,
        entityId: args.entityId,
        value: {
          ...secret,
          merchantId: undefined,
          accessToken: undefined,
          refreshToken: undefined,
          accessTokenExpiration: undefined,
          refreshTokenExpiration: undefined,
          connectionStatus: "DISCONNECTED",
        },
      });

      throw new ConvexError({ code: "NOT_FOUND", message: "Clover is not connected" });
    }

    throw error;
  }

  await ctx.runAction(internal.system.secrets.upsert, {
    service: "clover" as any,
    entityId: args.entityId,
    value: {
      ...secret,
      accessToken: refreshed.accessToken,
      accessTokenExpiration: refreshed.accessTokenExpiration ?? undefined,
      refreshToken: refreshed.refreshToken,
      refreshTokenExpiration: refreshed.refreshTokenExpiration ?? undefined,
      apiBaseUrl,
      oauthBaseUrl,
      connectionStatus: "CONNECTED",
    },
  });

  return {
    merchantId,
    accessToken: refreshed.accessToken,
    apiBaseUrl,
    oauthBaseUrl,
  };
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

    const { plugin, secret } = await getCloverSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { configured: true, connected: false };
    }

    const merchantId = String(secret.merchantId ?? "").trim();
    const refreshToken = String(secret.refreshToken ?? "").trim();
    const status = String(secret.connectionStatus ?? "").toUpperCase();
    const connected = Boolean(merchantId && refreshToken) && (status ? status === "CONNECTED" : true);

    return {
      configured: true,
      connected,
      merchantId: merchantId || undefined,
    };
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
        message: "Missing Clover OAuth app config. Set CLOVER_CLIENT_ID and CLOVER_CLIENT_SECRET.",
      });
    }

    const { plugin, secret } = await getCloverSecretForOrg(ctx, args.entityId);
    const prev = secret ?? ({} as CloverSecret);

    if (!plugin || !secret) {
      await ctx.runAction(internal.system.secrets.upsert, {
        service: "clover" as any,
        entityId: args.entityId,
        value: {
          ...prev,
          apiBaseUrl: global.apiBaseUrl,
          oauthBaseUrl: global.oauthBaseUrl,
        },
      });
    }

    return {
      clientId: global.clientId,
      oauthBaseUrl: global.oauthBaseUrl,
      authorizeUrl: `${global.oauthBaseUrl}/oauth/v2/authorize`,
    };
  },
});

export const completeOAuthConnection: any = action({
  args: {
    entityId: v.string(),
    code: v.string(),
    merchantId: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const global = getGlobalOAuthAppConfig();
    if (!global) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Missing Clover OAuth app config. Set CLOVER_CLIENT_ID and CLOVER_CLIENT_SECRET.",
      });
    }

    const { secret } = await getCloverSecretForOrg(ctx, args.entityId);
    const prior = (secret ?? ({} as CloverSecret)) as CloverSecret;

    const response = await fetch(`${global.oauthBaseUrl}/oauth/v2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        client_id: global.clientId,
        client_secret: global.clientSecret,
        code: args.code,
        redirect_uri: args.redirectUri,
      }),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to exchange code for Clover tokens",
      });
    }

    const json =
      body.json && typeof body.json === "object" && !Array.isArray(body.json)
        ? (body.json as Record<string, unknown>)
        : null;

    const accessToken = typeof json?.access_token === "string" ? json.access_token : null;
    const refreshToken = typeof json?.refresh_token === "string" ? json.refresh_token : null;
    const merchantIdFromToken = typeof json?.merchant_id === "string" ? json.merchant_id : null;
    const accessTokenExpiration =
      typeof json?.access_token_expiration === "number" ? json.access_token_expiration : null;
    const refreshTokenExpiration =
      typeof json?.refresh_token_expiration === "number" ? json.refresh_token_expiration : null;

    if (!accessToken || !refreshToken) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Clover OAuth response missing access_token/refresh_token",
      });
    }

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "clover" as any,
      entityId: args.entityId,
      value: {
        ...prior,
        merchantId: String(merchantIdFromToken ?? args.merchantId ?? "").trim(),
        accessToken,
        refreshToken,
        accessTokenExpiration: accessTokenExpiration ?? undefined,
        refreshTokenExpiration: refreshTokenExpiration ?? undefined,
        apiBaseUrl: global.apiBaseUrl,
        oauthBaseUrl: global.oauthBaseUrl,
        connectionStatus: "CONNECTED",
      },
    });

    return { ok: true, merchantId: args.merchantId };
  },
});

export const disconnect: any = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const { plugin, secret } = await getCloverSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { ok: true };
    }

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "clover" as any,
      entityId: args.entityId,
      value: {
        ...secret,
        merchantId: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        accessTokenExpiration: undefined,
        refreshTokenExpiration: undefined,
        connectionStatus: "DISCONNECTED",
      },
    });

    return { ok: true };
  },
});

export const listOrders: any = action({
  args: {
    entityId: v.string(),
    limit: v.optional(v.number()),
    debugId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const debugId = args.debugId ? String(args.debugId) : "";
    const logPrefix = debugId ? `[${debugId}]` : "[clover]";

    const { secret } = await getCloverSecretForOrg(ctx, args.entityId);
    const snapshot = secret ?? ({} as CloverSecret);

    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 100) : 20;

    const runRequest = async (forceRefresh: boolean) => {
      const { merchantId, accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
        entityId: args.entityId,
        debugId,
        forceRefresh,
      });

      const url = new URL(`${apiBaseUrl}/v3/merchants/${merchantId}/orders`);
      url.searchParams.set("limit", String(limit));

      console.info(
        `${logPrefix} Clover listOrders request entityId=${args.entityId} merchantId=${maskId(merchantId)} url=${url.toString()}`,
      );

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });

      const body = await readJsonOrText(response);
      return { response, body, merchantId };
    };

    const first = await runRequest(false);
    if (first.response.ok) {
      return first.body.json;
    }

    if (first.response.status === 401) {
      console.warn(
        `${logPrefix} Clover listOrders got 401, will force refresh and retry entityId=${args.entityId} merchantId=${maskId(first.merchantId)} body=${truncate(first.body.text)}`,
      );
      const retry = await runRequest(true);
      if (retry.response.ok) {
        return retry.body.json;
      }
      if (retry.response.status === 401) {
        console.warn(
          `${logPrefix} Clover listOrders retry also 401; clearing tokens entityId=${args.entityId} merchantId=${maskId(retry.merchantId)}`,
        );
        await clearCloverTokens(ctx, { entityId: args.entityId, secret: snapshot });
        throw new ConvexError({ code: "NOT_FOUND", message: "Clover is not connected" });
      }
      console.warn(
        `${logPrefix} Clover listOrders retry failed status=${retry.response.status} entityId=${args.entityId} merchantId=${maskId(retry.merchantId)} body=${truncate(retry.body.text)}`,
      );
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(retry.body) ?? "Failed to fetch Clover orders",
      });
    }

    console.warn(
      `${logPrefix} Clover listOrders failed status=${first.response.status} entityId=${args.entityId} merchantId=${maskId(first.merchantId)} body=${truncate(first.body.text)}`,
    );
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.body) ?? "Failed to fetch Clover orders",
    });
  },
});

export const getOrder: any = action({
  args: {
    entityId: v.string(),
    orderId: v.string(),
    debugId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const debugId = args.debugId ? String(args.debugId) : "";
    const logPrefix = debugId ? `[${debugId}]` : "[clover]";

    const { secret } = await getCloverSecretForOrg(ctx, args.entityId);
    const snapshot = secret ?? ({} as CloverSecret);

    const orderId = String(args.orderId ?? "").trim();
    if (!orderId) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing orderId" });
    }

    const runRequest = async (forceRefresh: boolean) => {
      const { merchantId, accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
        entityId: args.entityId,
        debugId,
        forceRefresh,
      });

      const url = new URL(`${apiBaseUrl}/v3/merchants/${merchantId}/orders/${orderId}`);
      url.searchParams.set("expand", "lineItems");
      console.info(
        `${logPrefix} Clover getOrder request entityId=${args.entityId} merchantId=${maskId(merchantId)} orderId=${orderId} url=${url.toString()}`,
      );

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });

      const body = await readJsonOrText(response);
      return { response, body, merchantId };
    };

    const first = await runRequest(false);
    if (first.response.ok) {
      return first.body.json;
    }

    if (first.response.status === 401) {
      console.warn(
        `${logPrefix} Clover getOrder got 401, will force refresh and retry entityId=${args.entityId} merchantId=${maskId(first.merchantId)} orderId=${orderId} body=${truncate(first.body.text)}`,
      );
      const retry = await runRequest(true);
      if (retry.response.ok) {
        return retry.body.json;
      }
      if (retry.response.status === 401) {
        console.warn(
          `${logPrefix} Clover getOrder retry also 401; clearing tokens entityId=${args.entityId} merchantId=${maskId(retry.merchantId)} orderId=${orderId}`,
        );
        await clearCloverTokens(ctx, { entityId: args.entityId, secret: snapshot });
        throw new ConvexError({ code: "NOT_FOUND", message: "Clover is not connected" });
      }
      console.warn(
        `${logPrefix} Clover getOrder retry failed status=${retry.response.status} entityId=${args.entityId} merchantId=${maskId(retry.merchantId)} orderId=${orderId} body=${truncate(retry.body.text)}`,
      );
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(retry.body) ?? "Failed to fetch Clover order",
      });
    }

    console.warn(
      `${logPrefix} Clover getOrder failed status=${first.response.status} entityId=${args.entityId} merchantId=${maskId(first.merchantId)} orderId=${orderId} body=${truncate(first.body.text)}`,
    );
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.body) ?? "Failed to fetch Clover order",
    });
  },
});

export const listItems: any = action({
  args: {
    entityId: v.string(),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
    debugId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const debugId = args.debugId ? String(args.debugId) : "";
    const logPrefix = debugId ? `[${debugId}]` : "[clover]";

    const { secret } = await getCloverSecretForOrg(ctx, args.entityId);
    const snapshot = secret ?? ({} as CloverSecret);

    const query = String(args.query ?? "").trim().toLowerCase();
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 200) : 50;

    const runRequest = async (forceRefresh: boolean) => {
      const { merchantId, accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
        entityId: args.entityId,
        debugId,
        forceRefresh,
      });

      const url = new URL(`${apiBaseUrl}/v3/merchants/${merchantId}/items`);
      url.searchParams.set("limit", String(Math.max(limit, 100)));

      console.info(
        `${logPrefix} Clover listItems request entityId=${args.entityId} merchantId=${maskId(merchantId)} url=${url.toString()}`,
      );

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });

      const body = await readJsonOrText(response);
      return { response, body, merchantId };
    };

    const first = await runRequest(false);
    let result = first;

    if (!first.response.ok && first.response.status === 401) {
      console.warn(
        `${logPrefix} Clover listItems got 401, will force refresh and retry entityId=${args.entityId} merchantId=${maskId(first.merchantId)} body=${truncate(first.body.text)}`,
      );
      const retry = await runRequest(true);
      if (retry.response.ok) {
        result = retry;
      } else if (retry.response.status === 401) {
        console.warn(
          `${logPrefix} Clover listItems retry also 401; clearing tokens entityId=${args.entityId} merchantId=${maskId(retry.merchantId)}`,
        );
        await clearCloverTokens(ctx, { entityId: args.entityId, secret: snapshot });
        throw new ConvexError({ code: "NOT_FOUND", message: "Clover is not connected" });
      } else {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: getErrorMessageFromBody(retry.body) ?? "Failed to fetch Clover items",
        });
      }
    } else if (!first.response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(first.body) ?? "Failed to fetch Clover items",
      });
    }

    const json = result.body.json;
    const elements: any[] =
      json && typeof json === "object" && !Array.isArray(json) && Array.isArray((json as any).elements)
        ? (json as any).elements
        : [];

    const filtered = query
      ? elements.filter((item) => {
          const name = String(item?.name ?? "").toLowerCase();
          const alt = String(item?.alternateName ?? "").toLowerCase();
          const code = String(item?.code ?? "").toLowerCase();
          return name.includes(query) || alt.includes(query) || code.includes(query);
        })
      : elements;

    return {
      elements: filtered.slice(0, limit),
    };
  },
});

export const listOrderTypes: any = action({
  args: {
    entityId: v.string(),
    debugId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const debugId = args.debugId ? String(args.debugId) : "";
    const logPrefix = debugId ? `[${debugId}]` : "[clover]";

    const { secret } = await getCloverSecretForOrg(ctx, args.entityId);
    const snapshot = secret ?? ({} as CloverSecret);

    const runRequest = async (forceRefresh: boolean) => {
      const { merchantId, accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
        entityId: args.entityId,
        debugId,
        forceRefresh,
      });

      const url = new URL(`${apiBaseUrl}/v3/merchants/${merchantId}/order_types`);

      console.info(
        `${logPrefix} Clover listOrderTypes request entityId=${args.entityId} merchantId=${maskId(merchantId)} url=${url.toString()}`,
      );

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });

      const body = await readJsonOrText(response);
      return { response, body, merchantId };
    };

    const first = await runRequest(false);
    if (first.response.ok) return first.body.json;

    if (first.response.status === 401) {
      console.warn(
        `${logPrefix} Clover listOrderTypes got 401, will force refresh and retry entityId=${args.entityId} merchantId=${maskId(first.merchantId)} body=${truncate(first.body.text)}`,
      );
      const retry = await runRequest(true);
      if (retry.response.ok) return retry.body.json;
      if (retry.response.status === 401) {
        console.warn(
          `${logPrefix} Clover listOrderTypes retry also 401; clearing tokens entityId=${args.entityId} merchantId=${maskId(retry.merchantId)}`,
        );
        await clearCloverTokens(ctx, { entityId: args.entityId, secret: snapshot });
        throw new ConvexError({ code: "NOT_FOUND", message: "Clover is not connected" });
      }
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(retry.body) ?? "Failed to fetch Clover order types",
      });
    }

    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.body) ?? "Failed to fetch Clover order types",
    });
  },
});

export const createAtomicOrder: any = action({
  args: {
    entityId: v.string(),
    orderTypeId: v.optional(v.string()),
    lineItems: v.array(
      v.object({
        itemId: v.string(),
        quantity: v.optional(v.number()),
      }),
    ),
    debugId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const debugId = args.debugId ? String(args.debugId) : "";
    const logPrefix = debugId ? `[${debugId}]` : "[clover]";

    const { secret } = await getCloverSecretForOrg(ctx, args.entityId);
    const snapshot = secret ?? ({} as CloverSecret);

    const orderTypeId = String(args.orderTypeId ?? "").trim();
    const items = Array.isArray(args.lineItems) ? args.lineItems : [];
    if (items.length === 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing lineItems" });
    }

    const normalizedLineItems: { itemId: string; quantity: number }[] = items
      .map((li: any) => ({
        itemId: String(li?.itemId ?? "").trim(),
        quantity: typeof li?.quantity === "number" && li.quantity > 0 ? Math.min(li.quantity, 50) : 1,
      }))
      .filter((li) => Boolean(li.itemId));
    if (normalizedLineItems.length === 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing itemId(s)" });
    }

    const runRequest = async (forceRefresh: boolean) => {
      const { merchantId, accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
        entityId: args.entityId,
        debugId,
        forceRefresh,
      });

      let resolvedOrderTypeId = orderTypeId;
      if (!resolvedOrderTypeId) {
        const otUrl = new URL(`${apiBaseUrl}/v3/merchants/${merchantId}/order_types`);
        const otResponse = await fetch(otUrl.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
        });
        const otBody = await readJsonOrText(otResponse);
        if (otResponse.ok) {
          const otJson = otBody.json;
          const elements: any[] =
            otJson && typeof otJson === "object" && !Array.isArray(otJson) && Array.isArray((otJson as any).elements)
              ? (otJson as any).elements
              : [];
          const first = elements.find((e) => typeof e?.id === "string" && String(e.id).trim());
          if (first) resolvedOrderTypeId = String(first.id).trim();
        }
      }

      const url = new URL(`${apiBaseUrl}/v3/merchants/${merchantId}/atomic_order/orders`);
      console.info(
        `${logPrefix} Clover createAtomicOrder request entityId=${args.entityId} merchantId=${maskId(merchantId)} url=${url.toString()}`,
      );

      const expandedLineItems: any[] = [];
      for (const li of normalizedLineItems) {
        for (let i = 0; i < li.quantity; i++) {
          expandedLineItems.push({ item: { id: li.itemId } });
        }
      }

      const orderCart: Record<string, unknown> = {
        lineItems: expandedLineItems,
      };
      if (resolvedOrderTypeId) {
        orderCart.orderType = { id: resolvedOrderTypeId };
      }

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderCart,
        }),
      });

      const body = await readJsonOrText(response);
      return { response, body, merchantId };
    };

    const first = await runRequest(false);
    if (first.response.ok) return first.body.json;

    if (first.response.status === 401) {
      console.warn(
        `${logPrefix} Clover createAtomicOrder got 401, will force refresh and retry entityId=${args.entityId} merchantId=${maskId(first.merchantId)} body=${truncate(first.body.text)}`,
      );
      const retry = await runRequest(true);
      if (retry.response.ok) return retry.body.json;
      if (retry.response.status === 401) {
        console.warn(
          `${logPrefix} Clover createAtomicOrder retry also 401; clearing tokens entityId=${args.entityId} merchantId=${maskId(retry.merchantId)}`,
        );
        await clearCloverTokens(ctx, { entityId: args.entityId, secret: snapshot });
        throw new ConvexError({ code: "NOT_FOUND", message: "Clover is not connected" });
      }
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(retry.body) ?? "Failed to create Clover order",
      });
    }

    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.body) ?? "Failed to create Clover order",
    });
  },
});
