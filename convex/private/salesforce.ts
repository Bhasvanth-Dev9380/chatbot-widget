import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

type SalesforceSecret = {
  accessToken?: string;
  instanceUrl?: string;
  apiVersion?: string;
  ownerId?: string;
  queueOwnerId?: string;
  openQueueName?: string;
  webhookUrl?: string;
  webhookUrlCreated?: string;
  webhookUrlEscalated?: string;
  webhookUrlResolved?: string;
  contactId?: string;
  accountId?: string;
  closeStatus?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  oauthBaseUrl?: string;
  oauthTokenUrl?: string;
  salesforceOrgId?: string;
  salesforceUserId?: string;
  identityUrl?: string;
  issuedAt?: number;
  scopes?: string;
  connectionStatus?: "CONNECTED" | "DISCONNECTED";

  // New per-user connection storage.
  // Tokens are stored per Convex user (within the organization secret), and never handled in frontend.
  defaultUserId?: string;
  connections?: Record<
    string,
    {
      accessToken?: string;
      refreshToken?: string;
      instanceUrl?: string;
      identityUrl?: string;
      salesforceOrgId?: string;
      salesforceUserId?: string;
      issuedAt?: number;
      scopes?: string;
      connectionStatus?: "CONNECTED" | "DISCONNECTED";
    }
  >;
};

type SalesforceUserConnection = NonNullable<SalesforceSecret["connections"]>[string];

function getConnectionForUser(
  secret: SalesforceSecret,
  userId: string | null,
): { userId: string | null; connection: SalesforceUserConnection | null } {
  const connections = secret.connections;
  if (connections && userId && connections[userId]) {
    return { userId, connection: connections[userId] ?? null };
  }

  const fallbackUserId = String(secret.defaultUserId ?? "").trim();
  if (connections && fallbackUserId && connections[fallbackUserId]) {
    return { userId: fallbackUserId, connection: connections[fallbackUserId] ?? null };
  }

  if (connections) {
    const first = Object.entries(connections).find(([, v]) => Boolean(v));
    if (first) {
      return { userId: first[0] ?? null, connection: first[1] ?? null };
    }
  }

  // Legacy org-scoped fields fallback.
  const legacyHasAny = Boolean(
    String(secret.refreshToken ?? "").trim() ||
      String(secret.accessToken ?? "").trim() ||
      String(secret.instanceUrl ?? "").trim(),
  );
  if (legacyHasAny) {
    return {
      userId: null,
      connection: {
        accessToken: secret.accessToken,
        refreshToken: secret.refreshToken,
        instanceUrl: secret.instanceUrl,
        identityUrl: secret.identityUrl,
        salesforceOrgId: secret.salesforceOrgId,
        salesforceUserId: secret.salesforceUserId,
        connectionStatus: String(secret.refreshToken ?? "").trim() ? "CONNECTED" : "DISCONNECTED",
      },
    };
  }

  return { userId: null, connection: null };
}

function getOrgOAuthConnection(secret: SalesforceSecret): {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  connectionStatus?: SalesforceSecret["connectionStatus"];
} | null {
  const rootAccessToken = String(secret.accessToken ?? "").trim();
  const rootRefreshToken = String(secret.refreshToken ?? "").trim();
  const rootInstanceUrl = String(secret.instanceUrl ?? "").trim();
  const rootHasAny = Boolean(rootAccessToken || rootRefreshToken || rootInstanceUrl);
  if (rootHasAny) {
    return {
      accessToken: rootAccessToken,
      refreshToken: rootRefreshToken,
      instanceUrl: rootInstanceUrl,
      connectionStatus: secret.connectionStatus,
    };
  }

  const { connection } = getConnectionForUser(secret, null);
  if (!connection) return null;
  const accessToken = String(connection.accessToken ?? "").trim();
  const refreshToken = String(connection.refreshToken ?? "").trim();
  const instanceUrl = String(connection.instanceUrl ?? "").trim();
  const hasAny = Boolean(accessToken || refreshToken || instanceUrl);
  if (!hasAny) return null;

  return {
    accessToken,
    refreshToken,
    instanceUrl,
    connectionStatus: connection.connectionStatus,
  };
}

function normalizeOAuthBaseUrl(value: string | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "https://login.salesforce.com";
  return raw.replace(/\/$/, "");
}

function getGlobalOAuthAppConfig(): {
  clientId: string;
  clientSecret: string;
  oauthBaseUrl: string;
} | null {
  const clientId = String(process.env.SALESFORCE_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.SALESFORCE_CLIENT_SECRET ?? "").trim();
  const oauthBaseUrl = normalizeOAuthBaseUrl(process.env.SALESFORCE_OAUTH_BASE_URL);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, oauthBaseUrl };
}

function inferOAuthBaseUrlFromTokenUrl(tokenUrl: string | undefined) {
  const raw = String(tokenUrl ?? "").trim();
  if (!raw) return null;
  const suffix = "/services/oauth2/token";
  if (raw.endsWith(suffix)) return raw.slice(0, -suffix.length);
  return null;
}

async function getSalesforceSecretForOrg(
  ctx: any,
  entityId: string,
): Promise<{ plugin: any | null; secret: SalesforceSecret | null }> {
  const plugin: any = await ctx.runQuery(
    internal.system.plugin.getByEntityIdAndService,
    {
      entityId,
      service: "salesforce" as any,
    },
  );

  if (!plugin) return { plugin: null, secret: null };

  const secretValue = await getSecretValue(plugin.secretName);
  const secretData = parseSecretString<SalesforceSecret>(secretValue);
  return { plugin, secret: secretData };
}

export const getConnectionStatus: any = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const { plugin, secret } = await getSalesforceSecretForOrg(ctx, args.entityId);
    const global = getGlobalOAuthAppConfig();

    if (!global) {
      return {
        configured: false,
        connected: false,
      };
    }

    if (!plugin || !secret) {
      const hasGlobalCredentials = Boolean(global?.clientId && global?.clientSecret);
      return {
        configured: hasGlobalCredentials,
        connected: false,
      };
    }

    const hasCredentials = Boolean(global?.clientId && global?.clientSecret);
    const orgConn = getOrgOAuthConnection(secret);
    const hasRefreshToken = Boolean(String(orgConn?.refreshToken ?? "").trim());
    const status = String(secret.connectionStatus ?? orgConn?.connectionStatus ?? "").toUpperCase();
    const isConnected = (status ? status === "CONNECTED" : true) && hasRefreshToken;
    return {
      configured: hasCredentials,
      connected: hasCredentials && isConnected,
    };
  },
});

export const setOAuthAppCredentials: any = action({
  args: {
    entityId: v.string(),
    clientId: v.string(),
    clientSecret: v.string(),
    oauthBaseUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    void ctx;
    void args;
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Per-organization Connected App credentials are not supported. Configure SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET.",
    });
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
          "Missing Salesforce Connected App config. Set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and SALESFORCE_OAUTH_BASE_URL.",
      });
    }

    const { plugin, secret } = await getSalesforceSecretForOrg(ctx, args.entityId);

    if (!plugin || !secret) {
      const prev = secret ?? ({} as SalesforceSecret);
      await ctx.runAction(internal.system.secrets.upsert, {
        service: "salesforce" as any,
        entityId: args.entityId,
        value: {
          ...prev,
          oauthBaseUrl: global.oauthBaseUrl,
          oauthTokenUrl: `${global.oauthBaseUrl}/services/oauth2/token`,
          apiVersion: String(prev.apiVersion ?? "57.0").replace(/^v/i, ""),
        },
      });

      return { clientId: global.clientId, oauthBaseUrl: global.oauthBaseUrl.replace(/\/$/, "") };
    }

    return { clientId: global.clientId, oauthBaseUrl: global.oauthBaseUrl.replace(/\/$/, "") };
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
          "Missing Salesforce Connected App config. Set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and SALESFORCE_OAUTH_BASE_URL.",
      });
    }

    const { secret } = await getSalesforceSecretForOrg(ctx, args.entityId);
    const prior = (secret ?? ({} as SalesforceSecret)) as SalesforceSecret;
    const oauthBaseUrl = global.oauthBaseUrl;
    const clientId = global.clientId;
    const clientSecret = global.clientSecret;

    const tokenResponse = await fetch(`${oauthBaseUrl}/services/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: args.redirectUri,
        code: args.code,
      }).toString(),
    });

    const body = await readJsonOrText(tokenResponse);
    if (!tokenResponse.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to exchange code for tokens",
      });
    }

    const json = body.json as Record<string, unknown> | null;
    const accessToken = typeof json?.access_token === "string" ? json.access_token : null;
    const refreshToken = typeof json?.refresh_token === "string" ? json.refresh_token : null;
    const instanceUrl = typeof json?.instance_url === "string" ? json.instance_url : null;
    const identityUrl = typeof json?.id === "string" ? json.id : null;
    const issuedAtRaw = typeof json?.issued_at === "string" ? json.issued_at : null;
    const scopeRaw = typeof json?.scope === "string" ? json.scope : null;
    const issuedAt = issuedAtRaw && /^\d+$/.test(issuedAtRaw) ? Number(issuedAtRaw) : null;

    if (!accessToken || !instanceUrl) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "OAuth token response missing access_token/instance_url",
      });
    }

    if (!refreshToken) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          "Salesforce did not return a refresh token. Ensure the Connected App has refresh_token scope and re-connect with consent.",
      });
    }

    let salesforceOrgId: string | null = null;
    let salesforceUserId: string | null = null;
    if (identityUrl) {
      try {
        const identityResponse = await fetch(identityUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const identityBody = await readJsonOrText(identityResponse);
        const identityJson =
          identityBody.json && typeof identityBody.json === "object" && !Array.isArray(identityBody.json)
            ? (identityBody.json as Record<string, unknown>)
            : null;

        const orgId = identityJson?.entity_id;
        const userId = identityJson?.user_id;
        salesforceOrgId = typeof orgId === "string" ? orgId : null;
        salesforceUserId = typeof userId === "string" ? userId : null;
      } catch (e) {
        void e;
      }
    }

    const { clientId: _cid, clientSecret: _csec, ...priorRest } = prior;

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "salesforce" as any,
      entityId: args.entityId,
      value: {
        ...priorRest,
        oauthBaseUrl: oauthBaseUrl.replace(/\/$/, ""),
        oauthTokenUrl: `${oauthBaseUrl.replace(/\/$/, "")}/services/oauth2/token`,
        apiVersion: String(prior.apiVersion ?? "57.0").replace(/^v/i, ""),

        accessToken,
        refreshToken,
        instanceUrl,
        identityUrl: identityUrl ?? undefined,
        salesforceOrgId: salesforceOrgId ?? undefined,
        salesforceUserId: salesforceUserId ?? undefined,
        issuedAt: issuedAt ?? undefined,
        scopes: scopeRaw ?? undefined,
        connectionStatus: "CONNECTED",

        // New storage
        defaultUserId: undefined,
        connections: undefined,
      },
    });

    return { ok: true, instanceUrl };
  },
});

export const disconnect: any = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const { plugin, secret } = await getSalesforceSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { ok: true };
    }

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "salesforce" as any,
      entityId: args.entityId,
      value: {
        ...secret,
        accessToken: undefined,
        refreshToken: undefined,
        instanceUrl: undefined,
        identityUrl: undefined,
        salesforceOrgId: undefined,
        salesforceUserId: undefined,
        issuedAt: undefined,
        scopes: undefined,
        connectionStatus: "DISCONNECTED",

        defaultUserId: undefined,
        connections: undefined,
      },
    });

    return { ok: true };
  },
});

async function readJsonOrText(response: Response): Promise<{
  json: unknown | null;
  text: string;
}> {
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

    const errors = record.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        const errMsg = (first as any).message;
        if (typeof errMsg === "string" && errMsg.trim()) return errMsg;
      }
    }
  }

  if (body.text.trim()) return body.text;
  return null;
}

function getInvalidFieldNamesFromSalesforceError(body: { json: unknown | null; text: string }): string[] {
  const names = new Set<string>();
  const pushFromMessage = (msg: string) => {
    const m1 = msg.match(/No such column '([^']+)'/i);
    if (m1?.[1]) names.add(m1[1]);
    const m2 = msg.match(/Invalid field[:\s]+([A-Za-z0-9_\.]+)/i);
    if (m2?.[1]) names.add(m2[1]);
  };

  if (Array.isArray(body.json)) {
    for (const e of body.json) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      const msg = (e as any).message;
      if (typeof msg === "string") pushFromMessage(msg);
    }
  } else if (body.json && typeof body.json === "object" && !Array.isArray(body.json)) {
    const msg = (body.json as any).message;
    if (typeof msg === "string") pushFromMessage(msg);
  }

  if (typeof body.text === "string" && body.text.trim()) pushFromMessage(body.text);

  return Array.from(names);
}

function indexOfKeywordAtTopLevel(source: string, keywordWithSpaces: string): number {
  const upper = source.toUpperCase();
  const needle = keywordWithSpaces.toUpperCase();
  let depth = 0;
  for (let i = 0; i <= upper.length - needle.length; i++) {
    const ch = upper[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth !== 0) continue;
    if (upper.slice(i, i + needle.length) === needle) return i;
  }
  return -1;
}

function splitByTopLevelCommas(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function pruneInvalidFieldsFromSoql(soql: string, invalidFields: string[]): string {
  if (!invalidFields.length) return soql;
  const upper = soql.toUpperCase();
  const selectIdx = upper.indexOf("SELECT ");
  if (selectIdx < 0) return soql;
  const fromIdx = indexOfKeywordAtTopLevel(soql, " FROM ");
  if (fromIdx < 0) return soql;

  const selectClause = soql.slice(selectIdx + "SELECT ".length, fromIdx);
  const parts = splitByTopLevelCommas(selectClause);
  const invalidSet = new Set(invalidFields);

  const kept = parts.filter((p) => {
    const trimmed = p.trim();
    if (!trimmed) return false;
    for (const bad of invalidSet) {
      if (trimmed === bad) return false;
      if (trimmed.startsWith(`${bad} `)) return false;
    }
    return true;
  });

  const nextClause = kept.map((p) => p.trim()).join(", ");
  return `${soql.slice(0, selectIdx)}SELECT ${nextClause}${soql.slice(fromIdx)}`;
}

function pruneInvalidFieldsFromSoqlDeep(soql: string, invalidFields: string[]): string {
  const upper = soql.toUpperCase();
  const selectIdx = upper.indexOf("SELECT ");
  if (selectIdx < 0) return soql;
  const fromIdx = indexOfKeywordAtTopLevel(soql, " FROM ");
  if (fromIdx < 0) return soql;

  const prefix = soql.slice(0, selectIdx);
  const suffix = soql.slice(fromIdx);
  const selectClause = soql.slice(selectIdx + "SELECT ".length, fromIdx);

  const parts = splitByTopLevelCommas(selectClause);
  const invalidSet = new Set(invalidFields);

  const kept = parts
    .map((p) => p.trim())
    .filter((p) => {
      if (!p) return false;
      for (const bad of invalidSet) {
        if (p === bad) return false;
        if (p.startsWith(`${bad} `)) return false;
      }
      return true;
    })
    .map((p) => {
      const trimmed = p.trim();
      if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return trimmed;
      const inner = trimmed.slice(1, -1).trim();
      if (!inner.toUpperCase().startsWith("SELECT ")) return trimmed;
      const prunedInner = pruneInvalidFieldsFromSoqlDeep(inner, invalidFields);
      return `(${prunedInner})`;
    });

  const nextClause = kept.join(", ");
  return `${prefix}SELECT ${nextClause}${suffix}`;
}

async function sfCreateSObjectWithAutoPrune(
  ctx: any,
  cfg: { entityId: string; accessToken: string; instanceUrl: string; baseApi: string },
  sobject: string,
  payload: Record<string, unknown>,
): Promise<{ json: Record<string, unknown> | null }> {
  let attempt = 0;
  let currentPayload: Record<string, unknown> = payload;
  while (true) {
    const response = await sfFetchWithAutoRefresh(
      ctx,
      { entityId: cfg.entityId, accessToken: cfg.accessToken, instanceUrl: cfg.instanceUrl },
      `${cfg.baseApi}/sobjects/${sobject}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(currentPayload),
      },
    );

    const body = await readJsonOrText(response);
    if (response.status === 201) {
      return {
        json:
          body.json && typeof body.json === "object" && !Array.isArray(body.json)
            ? (body.json as Record<string, unknown>)
            : null,
      };
    }

    const invalidFields = getInvalidFieldNamesFromSalesforceError(body);
    const canRetry = attempt === 0 && invalidFields.length > 0;
    if (canRetry) {
      const nextPayload = { ...currentPayload } as Record<string, unknown>;
      let removed = 0;
      for (const field of invalidFields) {
        if (field in nextPayload) {
          delete nextPayload[field];
          removed++;
        }
      }
      if (removed > 0) {
        attempt++;
        currentPayload = nextPayload;
        continue;
      }
    }

    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? `Failed to create ${sobject}`,
    });
  }
}

async function getSalesforceConfig(ctx: any, entityId: string) {
  const global = getGlobalOAuthAppConfig();
  if (!global) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Missing Salesforce Connected App config. Set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and SALESFORCE_OAUTH_BASE_URL.",
    });
  }

  const plugin = await ctx.runQuery(
    internal.system.plugin.getByEntityIdAndService,
    {
      entityId,
      service: "salesforce" as any,
    },
  );

  if (!plugin) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce is not connected",
    });
  }

  const secretValue = await getSecretValue(plugin.secretName);
  const secretData = parseSecretString<SalesforceSecret>(secretValue);

  if (!secretData) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce credentials are missing or incomplete",
    });
  }

  const orgConn = getOrgOAuthConnection(secretData);
  if (!orgConn) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce is not connected",
    });
  }

  const status = String(secretData.connectionStatus ?? orgConn.connectionStatus ?? "").toUpperCase();
  if (status && status !== "CONNECTED") {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce is not connected",
    });
  }

  let accessToken = String(orgConn.accessToken ?? "");
  let instanceUrl = String(orgConn.instanceUrl ?? "");
  const refreshToken = String(orgConn.refreshToken ?? "").trim();

  // We do not proactively refresh on every request.
  // If we have no accessToken yet but do have a refresh token, get an initial access token once.
  if (!accessToken.trim() && refreshToken) {
    const refreshed = await refreshSalesforceAccessToken(ctx, entityId);
    accessToken = refreshed.accessToken;
    instanceUrl = refreshed.instanceUrl;
  }

  if (!accessToken || !instanceUrl) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce credentials are missing or incomplete",
    });
  }

  const apiVersion = String(secretData.apiVersion ?? "57.0").replace(/^v/i, "");

  return {
    entityId,
    accessToken,
    instanceUrl: instanceUrl.replace(/\/$/, ""),
    apiVersion,
    ownerId: secretData.ownerId,
    queueOwnerId: secretData.queueOwnerId,
    openQueueName: secretData.openQueueName,
    webhookUrl: secretData.webhookUrl,
    webhookUrlCreated: secretData.webhookUrlCreated,
    webhookUrlEscalated: secretData.webhookUrlEscalated,
    webhookUrlResolved: secretData.webhookUrlResolved,
    contactId: secretData.contactId,
    accountId: secretData.accountId,
    closeStatus: secretData.closeStatus,
    baseApi: `${instanceUrl.replace(/\/$/, "")}/services/data/v${apiVersion}`,
  };
}

async function refreshSalesforceAccessToken(
  ctx: any,
  entityId: string,
): Promise<{ accessToken: string; instanceUrl: string }> {
  const global = getGlobalOAuthAppConfig();
  if (!global) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message:
        "Missing Salesforce Connected App config. Set SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, and SALESFORCE_OAUTH_BASE_URL.",
    });
  }

  const { plugin, secret } = await getSalesforceSecretForOrg(ctx, entityId);
  if (!plugin || !secret) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce is not connected",
    });
  }

  const orgConn = getOrgOAuthConnection(secret);
  if (!orgConn) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce is not connected",
    });
  }

  const status = String(secret.connectionStatus ?? orgConn.connectionStatus ?? "").toUpperCase();
  if (status && status !== "CONNECTED") {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce is not connected",
    });
  }

  const oauthBaseUrl = global.oauthBaseUrl;
  const oauthTokenUrl = `${oauthBaseUrl.replace(/\/$/, "")}/services/oauth2/token`;
  const refreshToken = String(orgConn.refreshToken ?? "").trim();
  if (!refreshToken) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce disconnected. Please reconnect.",
    });
  }

  const response = await fetch(oauthTokenUrl, {
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
    console.error("[salesforce] refresh_token grant failed", {
      entityId,
      status: response.status,
      message: getErrorMessageFromBody(body),
    });

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "salesforce" as any,
      entityId,
      value: {
        ...secret,
        accessToken: undefined,
        instanceUrl: undefined,
        refreshToken: undefined,
        connectionStatus: "DISCONNECTED",

        defaultUserId: undefined,
        connections: undefined,
      },
    });

    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Salesforce disconnected. Please reconnect.",
    });
  }

  const json = body.json && typeof body.json === "object" && !Array.isArray(body.json)
    ? (body.json as Record<string, unknown>)
    : null;
  const nextToken = typeof json?.access_token === "string" ? json.access_token : "";
  const nextInstanceUrl = typeof json?.instance_url === "string" ? json.instance_url : "";
  if (!nextToken.trim() || !nextInstanceUrl.trim()) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Salesforce refresh response missing access_token/instance_url",
    });
  }

  await ctx.runAction(internal.system.secrets.upsert, {
    service: "salesforce" as any,
    entityId,
    value: {
      ...secret,
      oauthBaseUrl: oauthBaseUrl.replace(/\/$/, ""),
      oauthTokenUrl,
      refreshToken: String(secret.refreshToken ?? "").trim() ? secret.refreshToken : orgConn.refreshToken,
      accessToken: nextToken,
      instanceUrl: nextInstanceUrl,
      connectionStatus: "CONNECTED",

      defaultUserId: undefined,
      connections: undefined,
    },
  });

  return { accessToken: nextToken, instanceUrl: nextInstanceUrl };
}

async function sfFetchWithAutoRefresh(
  ctx: any,
  cfg: { entityId: string; accessToken: string; instanceUrl: string },
  url: string,
  init: RequestInit,
) {
  const doFetch = async (token: string) => {
    const headers = {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    } as Record<string, string>;
    return await fetch(url, {
      ...init,
      headers,
    });
  };

  let response = await doFetch(cfg.accessToken);
  if (response.status !== 401) return response;

  const prevInstanceUrl = cfg.instanceUrl;
  const refreshed = await refreshSalesforceAccessToken(ctx, cfg.entityId);
  cfg.accessToken = refreshed.accessToken;
  cfg.instanceUrl = refreshed.instanceUrl;
  const safeOldBase = String(prevInstanceUrl ?? "").replace(/\/$/, "");
  const safeNewBase = String(refreshed.instanceUrl ?? "").replace(/\/$/, "");
  const retryUrl = safeOldBase && safeNewBase && url.startsWith(safeOldBase)
    ? `${safeNewBase}${url.slice(safeOldBase.length)}`
    : url;
  if (retryUrl === url) {
    response = await doFetch(refreshed.accessToken);
  } else {
    response = await fetch(retryUrl, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${refreshed.accessToken}`,
      } as Record<string, string>,
    });
  }
  return response;
}

export const getWebhookUrls = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.runQuery(
      internal.system.plugin.getByEntityIdAndService,
      {
        entityId: args.entityId,
        service: "salesforce" as any,
      },
    );

    if (!plugin) {
      return null;
    }

    const secretValue = await getSecretValue(plugin.secretName);
    const secretData = parseSecretString<SalesforceSecret>(secretValue);
    const legacy = String(secretData?.webhookUrl ?? "").trim();
    const webhookUrlCreated = String(secretData?.webhookUrlCreated ?? "").trim();
    const webhookUrlEscalated = String(secretData?.webhookUrlEscalated ?? "").trim();
    const webhookUrlResolved = String(secretData?.webhookUrlResolved ?? "").trim();

    return {
      webhookUrlCreated: webhookUrlCreated || legacy || null,
      webhookUrlEscalated: webhookUrlEscalated || legacy || null,
      webhookUrlResolved: webhookUrlResolved || legacy || null,
    };
  },
});

export const setWebhookUrls = action({
  args: {
    entityId: v.string(),
    webhookUrlCreated: v.optional(v.string()),
    webhookUrlEscalated: v.optional(v.string()),
    webhookUrlResolved: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.runQuery(
      internal.system.plugin.getByEntityIdAndService,
      {
        entityId: args.entityId,
        service: "salesforce" as any,
      },
    );

    if (!plugin) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Salesforce is not connected",
      });
    }

    const secretValue = await getSecretValue(plugin.secretName);
    const secretData =
      parseSecretString<SalesforceSecret>(secretValue) ?? ({} as SalesforceSecret);

    const webhookUrlCreated = String(args.webhookUrlCreated ?? "").trim();
    const webhookUrlEscalated = String(args.webhookUrlEscalated ?? "").trim();
    const webhookUrlResolved = String(args.webhookUrlResolved ?? "").trim();
    await ctx.runAction(internal.system.secrets.upsert, {
      service: "salesforce" as any,
      entityId: args.entityId,
      value: {
        ...secretData,
        webhookUrlCreated: webhookUrlCreated || undefined,
        webhookUrlEscalated: webhookUrlEscalated || undefined,
        webhookUrlResolved: webhookUrlResolved || undefined,
      },
    });
  },
});

export const sendWebhookEvent = action({
  args: {
    entityId: v.string(),
    event: v.string(),
    conversationId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    caseId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.runQuery(
      internal.system.plugin.getByEntityIdAndService,
      {
        entityId: args.entityId,
        service: "salesforce" as any,
      },
    );

    if (!plugin) {
      return { skipped: true };
    }

    const secretValue = await getSecretValue(plugin.secretName);
    const secretData = parseSecretString<SalesforceSecret>(secretValue);
    const legacyUrl = String(secretData?.webhookUrl ?? "").trim();
    const urlCreated = String(secretData?.webhookUrlCreated ?? "").trim() || legacyUrl;
    const urlEscalated =
      String(secretData?.webhookUrlEscalated ?? "").trim() || legacyUrl;
    const urlResolved = String(secretData?.webhookUrlResolved ?? "").trim() || legacyUrl;

    const url =
      args.event === "case.created"
        ? urlCreated
        : args.event === "case.escalated"
          ? urlEscalated
          : args.event === "case.resolved"
            ? urlResolved
            : legacyUrl;
    if (!url) {
      return { skipped: true };
    }

    const payload = {
      event: args.event,
      entityId: args.entityId,
      conversationId: args.conversationId ?? null,
      threadId: args.threadId ?? null,
      caseId: args.caseId ?? null,
      createdAt: Date.now(),
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await readJsonOrText(response);
        console.error("[salesforce] webhook failed", {
          entityId: args.entityId,
          event: args.event,
          status: response.status,
          message: getErrorMessageFromBody(body),
        });
      }
    } catch (error) {
      console.error("[salesforce] webhook failed", {
        entityId: args.entityId,
        event: args.event,
        error,
      });
    }

    return { ok: true };
  },
});

export const verifyConnection = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[salesforce] verifyConnection called", {
      entityId: args.entityId,
    });
    const cfg = await getSalesforceConfig(ctx, args.entityId);

    console.log("[salesforce] verifyConnection resolved config", {
      entityId: args.entityId,
      instanceUrl: cfg.instanceUrl,
      apiVersion: cfg.apiVersion,
    });

    await sfQuery(ctx, cfg, "SELECT Id FROM Organization LIMIT 1");

    return {
      ok: true,
      instanceUrl: cfg.instanceUrl,
      apiVersion: cfg.apiVersion,
    };
  },
});

async function sfGetCaseNumberById(
  ctx: any,
  cfg: { entityId: string; accessToken: string; instanceUrl: string; baseApi: string },
  caseId: string,
): Promise<string | null> {
  const soql = `SELECT Id, CaseNumber FROM Case WHERE Id='${caseId.replace(/'/g, "\\'")}'`;
  const data = (await sfQuery(ctx, cfg, soql)) as any;
  const rec = Array.isArray(data?.records) ? data.records[0] : null;
  const caseNumber = rec?.CaseNumber;
  return typeof caseNumber === "string" && caseNumber.trim() ? caseNumber : null;
}

async function sfQuery(
  ctx: any,
  cfg: { entityId: string; accessToken: string; instanceUrl: string; baseApi: string },
  soql: string,
) {
  let attempt = 0;
  let currentSoql = soql;
  while (true) {
    const url = `${cfg.baseApi}/query/?q=${encodeURIComponent(currentSoql)}`;
    const response = await sfFetchWithAutoRefresh(
      ctx,
      { entityId: cfg.entityId, accessToken: cfg.accessToken, instanceUrl: cfg.instanceUrl },
      url,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

    const body = await readJsonOrText(response);
    if (response.ok) return body.json;

    const invalidFields = getInvalidFieldNamesFromSalesforceError(body);
    const canRetry = attempt === 0 && invalidFields.length > 0;
    if (canRetry) {
      const pruned = pruneInvalidFieldsFromSoqlDeep(currentSoql, invalidFields);
      if (pruned !== currentSoql) {
        attempt++;
        currentSoql = pruned;
        continue;
      }
    }

    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? "Salesforce request failed",
    });
  }
}

async function sfGetQueueIdByName(
  ctx: any,
  cfg: { entityId: string; accessToken: string; instanceUrl: string; baseApi: string },
  queueName: string,
): Promise<string | null> {
  const safe = queueName.replace(/'/g, "\\'");
  const soql = `SELECT Id FROM Group WHERE Type='Queue' AND Name='${safe}' LIMIT 1`;
  const data = (await sfQuery(ctx, cfg, soql)) as any;
  const rec = Array.isArray(data?.records) ? data.records[0] : null;
  const id = rec?.Id;
  return typeof id === "string" && id.trim() ? id : null;
}

async function sfFindContactIdByEmail(
  ctx: any,
  cfg: { entityId: string; accessToken: string; instanceUrl: string; baseApi: string },
  email: string,
): Promise<string | null> {
  const safe = email.replace(/'/g, "\\'");
  const soql = `SELECT Id FROM Contact WHERE Email='${safe}' ORDER BY LastModifiedDate DESC LIMIT 1`;
  const data = (await sfQuery(ctx, cfg, soql)) as any;
  const rec = Array.isArray(data?.records) ? data.records[0] : null;
  const id = rec?.Id;
  return typeof id === "string" && id.trim() ? id : null;
}

function splitName(fullName: string | undefined): {
  firstName?: string;
  lastName: string;
} {
  const raw = String(fullName ?? "").trim();
  if (!raw) {
    return { lastName: "Website Visitor" };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { lastName: parts[0] ?? "Website Visitor" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1] ?? "Website Visitor",
  };
}

async function sfCreateContact(
  ctx: any,
  cfg: { entityId: string; accessToken: string; instanceUrl: string; baseApi: string },
  args: { name?: string; email?: string },
): Promise<string> {
  const { firstName, lastName } = splitName(args.name);
  const payload: Record<string, unknown> = {
    LastName: lastName,
  };
  if (firstName) payload.FirstName = firstName;
  if (args.email) payload.Email = args.email;

  const response = await sfFetchWithAutoRefresh(
    ctx,
    { entityId: cfg.entityId, accessToken: cfg.accessToken, instanceUrl: cfg.instanceUrl },
    `${cfg.baseApi}/sobjects/Contact`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const body = await readJsonOrText(response);
  if (response.status !== 201) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? "Failed to create contact",
    });
  }

  const json = body.json as Record<string, unknown> | null;
  const id = typeof json?.id === "string" ? json.id : null;
  if (!id) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Salesforce contact creation returned no id",
    });
  }
  return id;
}

async function sfGetOrCreateContactId(
  ctx: any,
  cfg: { entityId: string; accessToken: string; instanceUrl: string; baseApi: string },
  args: { name?: string; email?: string },
): Promise<string | null> {
  const email = String(args.email ?? "").trim();
  if (!email) return null;

  const existing = await sfFindContactIdByEmail(ctx, cfg, email);
  if (existing) return existing;

  return await sfCreateContact(ctx, cfg, { name: args.name, email });
}

export const createCase = action({
  args: {
    entityId: v.string(),
    subject: v.string(),
    status: v.optional(v.string()),
    origin: v.optional(v.string()),
    ownerId: v.optional(v.string()),
    contactId: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    comment: v.optional(v.string()),
    description: v.optional(v.string()),
    caseCommentBody: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("[salesforce] createCase called", {
      entityId: args.entityId,
      subject: args.subject,
      status: args.status ?? "New",
      origin: args.origin ?? "Web",
      hasOwnerId: Boolean(args.ownerId),
      hasContactId: Boolean(args.contactId),
    });
    const cfg = await getSalesforceConfig(ctx, args.entityId);

    console.log("[salesforce] createCase using instance", {
      entityId: args.entityId,
      instanceUrl: cfg.instanceUrl,
      apiVersion: cfg.apiVersion,
      baseApi: cfg.baseApi,
    });

    const commentText = String(args.comment ?? "Case Created via chatbot").trim();
    const suppliedDescription = String(args.description ?? "").trim();
    const combinedDescription = [suppliedDescription, commentText].filter(Boolean).join("\n\n");

    const payload: Record<string, unknown> = {
      Subject: args.subject,
      Status: args.status ?? "New",
      Origin: args.origin ?? "Web",
    };

    if (combinedDescription) payload.Description = combinedDescription;
    if (commentText) payload.Comment__c = commentText;

    const suppliedEmail = String(args.contactEmail ?? "").trim();
    const suppliedName = String(args.contactName ?? "").trim();
    if (suppliedEmail) payload.SuppliedEmail = suppliedEmail;
    if (suppliedName) payload.SuppliedName = suppliedName;

    const isQueueId = (id: string | undefined) =>
      Boolean(id && id.startsWith("00G") && (id.length === 15 || id.length === 18));

    let ownerId: string | undefined = undefined;
    if (isQueueId(args.ownerId)) ownerId = args.ownerId;
    else if (isQueueId(cfg.queueOwnerId)) ownerId = cfg.queueOwnerId;
    else if (isQueueId(cfg.ownerId)) ownerId = cfg.ownerId;
    else {
      const queueName = String(cfg.openQueueName ?? "Open Queue").trim();
      if (queueName) {
        try {
          const resolved = await sfGetQueueIdByName(ctx, cfg, queueName);
          if (resolved) ownerId = resolved;
        } catch (error) {
          console.error("[salesforce] Failed to resolve queue OwnerId by name", {
            entityId: args.entityId,
            queueName,
            error,
          });
        }
      }
    }

    let contactId: string | undefined = args.contactId ?? cfg.contactId;
    if (!contactId && (suppliedEmail || suppliedName)) {
      try {
        const resolvedContactId = await sfGetOrCreateContactId(ctx, cfg, {
          name: suppliedName || undefined,
          email: suppliedEmail || undefined,
        });
        if (resolvedContactId) contactId = resolvedContactId;
      } catch (error) {
        console.error("[salesforce] Failed to resolve/create Contact", {
          entityId: args.entityId,
          suppliedEmail: suppliedEmail || null,
          error,
        });
      }
    }

    if (ownerId) payload.OwnerId = ownerId;
    if (contactId) payload.ContactId = contactId;

    const { json } = await sfCreateSObjectWithAutoPrune(ctx, cfg, "Case", payload);

    const id = typeof json?.id === "string" ? json.id : null;
    const caseNumber = id ? await sfGetCaseNumberById(ctx, cfg, id) : null;

    if (id && args.caseCommentBody) {
      try {
        const commentResponse = await sfFetchWithAutoRefresh(
          ctx,
          { entityId: cfg.entityId, accessToken: cfg.accessToken, instanceUrl: cfg.instanceUrl },
          `${cfg.baseApi}/sobjects/CaseComment`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ParentId: id,
              CommentBody: args.caseCommentBody,
              IsPublished: false,
            }),
          },
        );

        if (commentResponse.status !== 201) {
          const commentBody = await readJsonOrText(commentResponse);
          console.error("[salesforce] createCase failed to create CaseComment", {
            entityId: args.entityId,
            status: commentResponse.status,
            message: getErrorMessageFromBody(commentBody),
          });
        }
      } catch (error) {
        console.error("[salesforce] createCase failed to create CaseComment", error);
      }
    }

    return {
      id,
      caseNumber,
      success: Boolean(json?.success),
      errors: Array.isArray(json?.errors) ? json?.errors : [],
    };
  },
});

export const addInternalCaseComment = action({
  args: {
    entityId: v.string(),
    caseNumberOrId: v.string(),
    commentBody: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.entityId);

    const raw = String(args.caseNumberOrId ?? "").trim();
    if (!raw) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Missing case id/number",
      });
    }

    let caseId: string | null = null;

    const looksLikeSalesforceId =
      raw.startsWith("500") && (raw.length === 15 || raw.length === 18);
    const looksNumeric = /^\d+$/.test(raw);

    if (looksLikeSalesforceId) {
      caseId = raw;
    } else {
      const soql =
        `SELECT Id FROM Case WHERE CaseNumber='${raw.replace(/'/g, "\\'")}'`;
      const data = (await sfQuery(ctx, cfg, soql)) as any;
      const rec = Array.isArray(data?.records) ? data.records[0] : null;
      caseId = typeof rec?.Id === "string" ? rec.Id : null;

      if (!caseId && !looksNumeric) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Case not found",
        });
      }
    }

    if (!caseId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Case not found",
      });
    }

    const response = await sfFetchWithAutoRefresh(
      ctx,
      { entityId: cfg.entityId, accessToken: cfg.accessToken, instanceUrl: cfg.instanceUrl },
      `${cfg.baseApi}/sobjects/CaseComment`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ParentId: caseId,
          CommentBody: args.commentBody,
          IsPublished: false,
        }),
      },
    );

    const body = await readJsonOrText(response);
    if (response.status !== 201) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to create CaseComment",
      });
    }

    const json = body.json as Record<string, unknown> | null;
    const id = typeof json?.id === "string" ? json.id : null;
    return { id };
  },
});

export const getCaseByNumber = action({
  args: {
    entityId: v.string(),
    caseNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.entityId);

    const soql =
      `SELECT Id, CaseNumber, Subject, Status, Priority ` +
      `FROM Case WHERE CaseNumber='${args.caseNumber.replace(/'/g, "\\'")}'`;

    const data = (await sfQuery(ctx, cfg, soql)) as any;
    const rec = Array.isArray(data?.records) ? data.records[0] : null;

    if (!rec) {
      return null;
    }

    return {
      id: rec.Id ?? null,
      number: rec.CaseNumber ?? null,
      subject: rec.Subject ?? null,
      status: rec.Status ?? null,
      priority: rec.Priority ?? null,
    };
  },
});

export const getCaseCommentsByNumber = action({
  args: {
    entityId: v.string(),
    caseNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.entityId);

    const soql =
      `SELECT Id, CaseNumber, Comment__c, ` +
      `(SELECT Id, CommentBody, CreatedDate, CreatedBy.Name FROM CaseComments) ` +
      `FROM Case WHERE CaseNumber='${args.caseNumber.replace(/'/g, "\\'")}'`;

    const data = (await sfQuery(ctx, cfg, soql)) as any;
    const rec = Array.isArray(data?.records) ? data.records[0] : null;

    if (!rec) {
      return null;
    }

    const rawComments = rec.CaseComments?.records;
    const comments = Array.isArray(rawComments)
      ? rawComments.map((c: any) => ({
          id: c.Id ?? null,
          body: c.CommentBody ?? null,
          created: c.CreatedDate ?? null,
          author: c.CreatedBy?.Name ?? null,
        }))
      : [];

    return {
      case: {
        id: rec.Id ?? null,
        number: rec.CaseNumber ?? null,
        comment_field: rec.Comment__c ?? null,
      },
      comments,
    };
  },
});

export const listCasesByAccount = action({
  args: {
    entityId: v.string(),
    accountId: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.entityId);

    const accountId = args.accountId ?? cfg.accountId;
    if (!accountId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Account ID is required",
      });
    }

    const statusFilter = String(args.status ?? "").trim();
    const statusLower = statusFilter.toLowerCase();

    let casesWhere = "";
    if (statusFilter) {
      if (statusLower === "open") {
        casesWhere = " WHERE IsClosed = false";
      } else if (statusLower === "closed") {
        casesWhere = " WHERE IsClosed = true";
      } else {
        const safe = statusFilter.replace(/'/g, "\\'");
        casesWhere = ` WHERE Status = '${safe}'`;
      }
    }

    const soql =
      "SELECT Id, Name, Industry, Cluster_UUID__c, " +
      `(SELECT Id, CaseNumber, Subject, Status, Priority, ContactId FROM Cases${casesWhere}) ` +
      `FROM Account WHERE Id='${accountId.replace(/'/g, "\\'")}'`;

    const data = (await sfQuery(ctx, cfg, soql)) as any;
    const acc = Array.isArray(data?.records) ? data.records[0] : null;
    if (!acc) {
      return { account: null, cases: [], raw_count: 0 };
    }

    const cases = Array.isArray(acc?.Cases?.records) ? acc.Cases.records : [];
    const limit = Math.max(1, Math.min(500, args.limit ?? 50));

    return {
      account: {
        id: acc.Id ?? null,
        name: acc.Name ?? null,
        industry: acc.Industry ?? null,
        cluster_uuid: acc.Cluster_UUID__c ?? null,
      },
      cases: cases.slice(0, limit).map((c: any) => ({
        id: c.Id ?? null,
        number: c.CaseNumber ?? null,
        subject: c.Subject ?? null,
        status: c.Status ?? null,
        priority: c.Priority ?? null,
        contactId: c.ContactId ?? null,
      })),
      raw_count: cases.length,
    };
  },
});

export const escalateCaseByNumber = action({
  args: {
    entityId: v.string(),
    caseNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.entityId);

    const soql =
      `SELECT Id FROM Case WHERE CaseNumber='${args.caseNumber.replace(/'/g, "\\'")}'`;
    const data = (await sfQuery(ctx, cfg, soql)) as any;
    const rec = Array.isArray(data?.records) ? data.records[0] : null;

    const caseId = rec?.Id;
    if (!caseId || typeof caseId !== "string") {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Case not found",
      });
    }

    const response = await sfFetchWithAutoRefresh(
      ctx,
      { entityId: cfg.entityId, accessToken: cfg.accessToken, instanceUrl: cfg.instanceUrl },
      `${cfg.baseApi}/sobjects/Case/${caseId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ IsEscalated: true }),
      },
    );

    if (response.status === 204) {
      return { ok: true };
    }

    const body = await readJsonOrText(response);
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? "Failed to escalate case",
    });
  },
});

export const closeCaseByNumber = action({
  args: {
    entityId: v.string(),
    caseNumber: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.entityId);

    const soql =
      `SELECT Id FROM Case WHERE CaseNumber='${args.caseNumber.replace(/'/g, "\\'")}'`;
    const data = (await sfQuery(ctx, cfg, soql)) as any;
    const rec = Array.isArray(data?.records) ? data.records[0] : null;

    const caseId = rec?.Id;
    if (!caseId || typeof caseId !== "string") {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Case not found",
      });
    }

    const nextStatus = String(args.status ?? cfg.closeStatus ?? "Closed").trim();
    const response = await sfFetchWithAutoRefresh(
      ctx,
      { entityId: cfg.entityId, accessToken: cfg.accessToken, instanceUrl: cfg.instanceUrl },
      `${cfg.baseApi}/sobjects/Case/${caseId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ Status: nextStatus }),
      },
    );

    if (response.status === 204) {
      return { ok: true };
    }

    const body = await readJsonOrText(response);
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? "Failed to close case",
    });
  },
});
