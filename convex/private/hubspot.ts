import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

type HubSpotSecret = {
  accessToken?: string;
  accessTokenExpiration?: number;
  refreshToken?: string;
  scopes?: string;
  hubId?: number;
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

function getGlobalOAuthAppConfig(): {
  clientId: string;
  clientSecret: string;
  oauthBaseUrl: string;
  apiBaseUrl: string;
  scopes: string;
  ticketPipelineId?: string;
  ticketNewStageId?: string;
  ticketEscalatedStageId?: string;
  ticketClosedStageId?: string;
  disablePipelinesLookup?: boolean;
} | null {
  const clientId = String(process.env.HUBSPOT_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.HUBSPOT_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;

  const oauthBaseUrl = String(process.env.HUBSPOT_OAUTH_BASE_URL ?? "https://api.hubapi.com").replace(/\/$/, "");
  const apiBaseUrl = String(process.env.HUBSPOT_API_BASE_URL ?? "https://api.hubapi.com").replace(/\/$/, "");
  const scopes = String(
    process.env.HUBSPOT_SCOPES ??
      "oauth tickets timeline crm.objects.contacts.read crm.objects.contacts.write",
  ).trim();

  const ticketPipelineId = String(process.env.HUBSPOT_TICKET_PIPELINE_ID ?? "").trim() || undefined;
  const ticketNewStageId = String(process.env.HUBSPOT_TICKET_NEW_STAGE_ID ?? "").trim() || undefined;
  const ticketEscalatedStageId =
    String(process.env.HUBSPOT_TICKET_ESCALATED_STAGE_ID ?? "").trim() || undefined;
  const ticketClosedStageId = String(process.env.HUBSPOT_TICKET_CLOSED_STAGE_ID ?? "").trim() || undefined;

  const disablePipelinesLookupRaw = String(process.env.HUBSPOT_DISABLE_PIPELINES_LOOKUP ?? "").trim().toLowerCase();
  const disablePipelinesLookup =
    disablePipelinesLookupRaw === "1" ||
    disablePipelinesLookupRaw === "true" ||
    disablePipelinesLookupRaw === "yes";

  return {
    clientId,
    clientSecret,
    oauthBaseUrl,
    apiBaseUrl,
    scopes,
    ticketPipelineId,
    ticketNewStageId,
    ticketEscalatedStageId,
    ticketClosedStageId,
    disablePipelinesLookup,
  };
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
    const status = record.status;
    if (typeof status === "string" && status.trim()) return status;
  }

  if (body.text.trim()) return body.text;
  return null;
}

async function getHubSpotSecretForOrg(
  ctx: any,
  entityId: string,
): Promise<{ plugin: any | null; secret: HubSpotSecret | null }> {
  const plugin: any = await ctx.runQuery(internal.system.plugin.getByEntityIdAndService, {
    entityId,
    service: "hubspot" as any,
  });

  if (!plugin) {
    const fallbackSecretName = `tenant/${entityId}/hubspot`;
    try {
      const secretValue = await getSecretValue(fallbackSecretName);
      const secretData = parseSecretString<HubSpotSecret>(secretValue);
      if (secretData) {
        await ctx.runMutation(internal.system.plugin.upsert, {
          service: "hubspot" as any,
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
  const secretData = parseSecretString<HubSpotSecret>(secretValue);
  return { plugin, secret: secretData };
}

async function clearHubSpotTokens(ctx: any, params: { entityId: string; secret: HubSpotSecret }) {
  await ctx.runAction(internal.system.secrets.upsert, {
    service: "hubspot" as any,
    entityId: params.entityId,
    value: {
      ...params.secret,
      accessToken: undefined,
      accessTokenExpiration: undefined,
      refreshToken: undefined,
      scopes: undefined,
      hubId: undefined,
      connectionStatus: "DISCONNECTED",
    },
  });
}

async function refreshTokens(params: {
  oauthBaseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  debugId?: string;
}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number | null }> {
  const debugId = params.debugId ? String(params.debugId) : "";
  const logPrefix = debugId ? `[${debugId}]` : "[hubspot]";

  const response = await fetch(`${params.oauthBaseUrl}/oauth/v1/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }).toString(),
  });

  const body = await readJsonOrText(response);
  if (!response.ok) {
    console.warn(
      `${logPrefix} HubSpot refresh failed status=${response.status} oauthBaseUrl=${params.oauthBaseUrl} body=${truncate(body.text)}`,
    );
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? "Failed to refresh HubSpot tokens",
    });
  }

  const json =
    body.json && typeof body.json === "object" && !Array.isArray(body.json)
      ? (body.json as Record<string, unknown>)
      : null;

  const accessToken = typeof json?.access_token === "string" ? json.access_token : null;
  const refreshToken = typeof json?.refresh_token === "string" ? json.refresh_token : null;
  const expiresIn = typeof json?.expires_in === "number" ? json.expires_in : null;

  if (!accessToken || !refreshToken) {
    console.warn(`${logPrefix} HubSpot refresh response missing access_token/refresh_token`);
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "HubSpot refresh response missing access_token/refresh_token",
    });
  }

  return { accessToken, refreshToken, expiresIn };
}

async function ensureValidAccessToken(
  ctx: any,
  args: { entityId: string; debugId?: string; forceRefresh?: boolean },
) {
  const debugId = args.debugId ? String(args.debugId) : "";
  const logPrefix = debugId ? `[${debugId}]` : "[hubspot]";

  const global = getGlobalOAuthAppConfig();
  if (!global) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Missing HubSpot OAuth app config. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.",
    });
  }

  const { plugin, secret } = await getHubSpotSecretForOrg(ctx, args.entityId);
  if (!plugin || !secret) {
    console.warn(`${logPrefix} HubSpot not connected entityId=${args.entityId}`);
    throw new ConvexError({ code: "NOT_FOUND", message: "HubSpot is not connected" });
  }

  const accessToken = String(secret.accessToken ?? "").trim();
  const refreshToken = String(secret.refreshToken ?? "").trim();
  if (!refreshToken) {
    throw new ConvexError({ code: "NOT_FOUND", message: "HubSpot is not connected" });
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof secret.accessTokenExpiration === "number" ? secret.accessTokenExpiration : null;
  const shouldRefresh = Boolean(args.forceRefresh) || !accessToken || (exp !== null && exp - now < 120);

  if (!shouldRefresh) {
    return {
      accessToken,
      apiBaseUrl: global.apiBaseUrl,
    };
  }

  console.info(`${logPrefix} HubSpot refreshing token entityId=${args.entityId} exp=${exp ?? "(none)"} now=${now}`);

  let refreshed: { accessToken: string; refreshToken: string; expiresIn: number | null };
  try {
    refreshed = await refreshTokens({
      oauthBaseUrl: global.oauthBaseUrl,
      clientId: global.clientId,
      clientSecret: global.clientSecret,
      refreshToken,
      debugId,
    });
  } catch (error) {
    const rawMessage =
      error && typeof error === "object" && "message" in error ? String((error as any).message) : "";
    const normalized = rawMessage.toLowerCase();
    const looksUnauthorized = normalized.includes("401") || normalized.includes("unauthorized");

    console.warn(`${logPrefix} HubSpot token refresh failed`, error);

    if (looksUnauthorized) {
      await clearHubSpotTokens(ctx, { entityId: args.entityId, secret });
      throw new ConvexError({ code: "NOT_FOUND", message: "HubSpot is not connected" });
    }

    throw error;
  }

  const nextExp = refreshed.expiresIn ? now + refreshed.expiresIn : null;

  await ctx.runAction(internal.system.secrets.upsert, {
    service: "hubspot" as any,
    entityId: args.entityId,
    value: {
      ...secret,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accessTokenExpiration: nextExp ?? undefined,
      connectionStatus: "CONNECTED",
    },
  });

  return {
    accessToken: refreshed.accessToken,
    apiBaseUrl: global.apiBaseUrl,
  };
}

type HubSpotPipelineStage = {
  id: string;
  label?: string;
  metadata?: { ticketState?: string };
};

type HubSpotPipeline = {
  id: string;
  label?: string;
  stages?: HubSpotPipelineStage[];
};

function normalizeTicketState(value: unknown) {
  const s = typeof value === "string" ? value.trim().toUpperCase() : "";
  return s || null;
}

function pickStageByState(stages: HubSpotPipelineStage[], ticketState: "OPEN" | "CLOSED") {
  return stages.find((s) => normalizeTicketState(s?.metadata?.ticketState) === ticketState) ?? null;
}

function pickStageByLabelIncludes(stages: HubSpotPipelineStage[], needles: string[]) {
  const lowered = needles.map((n) => n.toLowerCase());
  return (
    stages.find((s) => {
      const label = typeof s.label === "string" ? s.label.toLowerCase() : "";
      if (!label) return false;
      return lowered.some((n) => label.includes(n));
    }) ?? null
  );
}

async function getTicketPipelineAndStages(
  ctx: any,
  args: { entityId: string; debugId?: string },
): Promise<{
  pipelineId: string;
  stageNew: string;
  stageEscalated: string;
  stageClosed: string;
}> {
  const debugId = args.debugId ? String(args.debugId) : "";

  const global = getGlobalOAuthAppConfig();
  if (!global) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Missing HubSpot OAuth app config. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.",
    });
  }

  if (global.ticketPipelineId && global.ticketNewStageId && global.ticketClosedStageId) {
    return {
      pipelineId: global.ticketPipelineId,
      stageNew: global.ticketNewStageId,
      stageEscalated: global.ticketEscalatedStageId ?? global.ticketNewStageId,
      stageClosed: global.ticketClosedStageId,
    };
  }

  if (global.disablePipelinesLookup) {
    // With legacy scopes, the pipelines endpoint may not be accessible.
    // Fall back to HubSpot default pipeline/stage ids used by many portals.
    // For accurate stage mapping, set HUBSPOT_TICKET_*_STAGE_ID env vars.
    return {
      pipelineId: global.ticketPipelineId ?? "0",
      stageNew: global.ticketNewStageId ?? "1",
      stageEscalated: global.ticketEscalatedStageId ?? (global.ticketNewStageId ?? "1"),
      stageClosed: global.ticketClosedStageId ?? (global.ticketNewStageId ?? "1"),
    };
  }

  const runRequest = async (forceRefresh: boolean) => {
    const { accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
      entityId: args.entityId,
      debugId,
      forceRefresh,
    });

    const response = await fetch(`${apiBaseUrl}/crm/v3/pipelines/tickets`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
    const body = await readJsonOrText(response);
    return { response, body };
  };

  const first = await runRequest(false);
  let body = first.body;
  if (first.response.status === 401) {
    const retry = await runRequest(true);
    if (!retry.response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(retry.body) ?? "Failed to fetch HubSpot ticket pipelines",
      });
    }
    body = retry.body;
  } else if (!first.response.ok) {
    if (first.response.status === 403 || first.response.status === 404) {
      // Some portals/apps don't grant access to pipelines even when tickets are granted.
      // In that case, stage mapping must be provided via env vars.
      return {
        pipelineId: global.ticketPipelineId ?? "0",
        stageNew: global.ticketNewStageId ?? "1",
        stageEscalated: global.ticketEscalatedStageId ?? (global.ticketNewStageId ?? "1"),
        stageClosed: global.ticketClosedStageId ?? (global.ticketNewStageId ?? "1"),
      };
    }
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.body) ?? "Failed to fetch HubSpot ticket pipelines",
    });
  }

  const json =
    body.json && typeof body.json === "object" && !Array.isArray(body.json)
      ? (body.json as Record<string, unknown>)
      : null;

  const results = Array.isArray(json?.results) ? (json?.results as unknown[]) : [];
  const pipelines: HubSpotPipeline[] = results
    .map((p) => {
      if (!p || typeof p !== "object" || Array.isArray(p)) return null;
      const rec = p as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : null;
      if (!id) return null;
      const stagesRaw = Array.isArray(rec.stages) ? (rec.stages as unknown[]) : [];
      const stages: HubSpotPipelineStage[] = stagesRaw
        .map((s) => {
          if (!s || typeof s !== "object" || Array.isArray(s)) return null;
          const sr = s as Record<string, unknown>;
          const sid = typeof sr.id === "string" ? sr.id : null;
          if (!sid) return null;
          const label = typeof sr.label === "string" ? sr.label : undefined;
          const meta = sr.metadata;
          const metadata =
            meta && typeof meta === "object" && !Array.isArray(meta)
              ? { ticketState: typeof (meta as any).ticketState === "string" ? (meta as any).ticketState : undefined }
              : undefined;
          return { id: sid, label, metadata };
        })
        .filter(Boolean) as HubSpotPipelineStage[];
      const label = typeof rec.label === "string" ? rec.label : undefined;
      return { id, label, stages };
    })
    .filter(Boolean) as HubSpotPipeline[];

  if (pipelines.length === 0) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "No HubSpot ticket pipelines found",
    });
  }

  const pipelineId = global.ticketPipelineId ?? pipelines[0]!.id;
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0]!;
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];

  const stageNew =
    global.ticketNewStageId ??
    pickStageByLabelIncludes(stages, ["new"])?.id ??
    pickStageByState(stages, "OPEN")?.id ??
    stages[0]?.id;

  const stageClosed =
    global.ticketClosedStageId ??
    pickStageByLabelIncludes(stages, ["closed"])?.id ??
    pickStageByState(stages, "CLOSED")?.id ??
    stages[stages.length - 1]?.id;

  const stageEscalated =
    global.ticketEscalatedStageId ??
    pickStageByLabelIncludes(stages, ["waiting on us", "waiting on agent", "waiting on support", "in progress"])?.id ??
    pickStageByLabelIncludes(stages, ["escal"])?.id ??
    stages.find((s) => normalizeTicketState(s?.metadata?.ticketState) === "OPEN" && s.id !== stageNew)?.id ??
    stageNew;

  if (!pipeline.id || !stageNew || !stageClosed) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "Unable to determine HubSpot ticket pipeline/stages",
    });
  }

  return {
    pipelineId: pipeline.id,
    stageNew,
    stageEscalated,
    stageClosed,
  };
}

async function getOrCreateContactId(
  ctx: any,
  args: {
    entityId: string;
    email?: string | null;
    name?: string | null;
    debugId?: string;
  },
): Promise<string | null> {
  const debugId = args.debugId ? String(args.debugId) : "";
  const email = String(args.email ?? "").trim();
  if (!email) return null;

  const runRequest = async (forceRefresh: boolean) => {
    const { accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
      entityId: args.entityId,
      debugId,
      forceRefresh,
    });

    const getUrl = `${apiBaseUrl}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`;
    const getRes = await fetch(getUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
    });
    const getBody = await readJsonOrText(getRes);
    return { accessToken, apiBaseUrl, getRes, getBody };
  };

  const first = await runRequest(false);
  if (first.getRes.ok) {
    const json =
      first.getBody.json && typeof first.getBody.json === "object" && !Array.isArray(first.getBody.json)
        ? (first.getBody.json as Record<string, unknown>)
        : null;
    const id = typeof json?.id === "string" ? json.id : null;
    return id && id.trim() ? id : null;
  }

  if (first.getRes.status === 401) {
    const retry = await runRequest(true);
    if (retry.getRes.ok) {
      const json =
        retry.getBody.json && typeof retry.getBody.json === "object" && !Array.isArray(retry.getBody.json)
          ? (retry.getBody.json as Record<string, unknown>)
          : null;
      const id = typeof json?.id === "string" ? json.id : null;
      return id && id.trim() ? id : null;
    }
  }

  if (first.getRes.status !== 404) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.getBody) ?? "Failed to fetch HubSpot contact",
    });
  }

  const { accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
    entityId: args.entityId,
    debugId,
  });

  const name = String(args.name ?? "").trim();
  const properties: Record<string, unknown> = { email };
  if (name) {
    const parts = name.split(" ").filter(Boolean);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ");
    if (firstName) properties.firstname = firstName;
    if (lastName) properties.lastname = lastName;
  }

  const createRes = await fetch(`${apiBaseUrl}/crm/v3/objects/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ properties }),
  });

  const createBody = await readJsonOrText(createRes);
  if (createRes.ok) {
    const json =
      createBody.json && typeof createBody.json === "object" && !Array.isArray(createBody.json)
        ? (createBody.json as Record<string, unknown>)
        : null;
    const id = typeof json?.id === "string" ? json.id : null;
    return id && id.trim() ? id : null;
  }

  if (createRes.status === 409) {
    const { accessToken: at2, apiBaseUrl: ab2 } = await ensureValidAccessToken(ctx, {
      entityId: args.entityId,
      debugId,
      forceRefresh: true,
    });
    const getUrl = `${ab2}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`;
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${at2}`, accept: "application/json" },
    });
    const getBody = await readJsonOrText(getRes);
    if (getRes.ok) {
      const json =
        getBody.json && typeof getBody.json === "object" && !Array.isArray(getBody.json)
          ? (getBody.json as Record<string, unknown>)
          : null;
      const id = typeof json?.id === "string" ? json.id : null;
      return id && id.trim() ? id : null;
    }
  }

  throw new ConvexError({
    code: "BAD_REQUEST",
    message: getErrorMessageFromBody(createBody) ?? "Failed to create HubSpot contact",
  });
}

async function createEngagementNoteAndAssociateToTicket(
  ctx: any,
  args: { entityId: string; ticketId: string; body: string },
) {
  const ticketIdNumber = Number(String(args.ticketId ?? "").trim());
  if (!Number.isFinite(ticketIdNumber)) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: "HubSpot ticket id must be numeric to log a timeline engagement",
    });
  }

  const runRequest = async (forceRefresh: boolean) => {
    const { accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
      entityId: args.entityId,
      forceRefresh,
    });

    const response = await fetch(`${apiBaseUrl}/engagements/v1/engagements`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        engagement: {
          type: "NOTE",
          active: true,
          timestamp: Date.now(),
        },
        associations: {
          ticketIds: [ticketIdNumber],
        },
        metadata: {
          body: String(args.body ?? "").trim(),
        },
      }),
    });

    const body = await readJsonOrText(response);
    return { response, body };
  };

  const first = await runRequest(false);
  if (first.response.ok) return;

  if (first.response.status === 401) {
    const retry = await runRequest(true);
    if (retry.response.ok) return;
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(retry.body) ?? "Failed to create HubSpot engagement note",
    });
  }

  throw new ConvexError({
    code: "BAD_REQUEST",
    message: getErrorMessageFromBody(first.body) ?? "Failed to create HubSpot engagement note",
  });
}

async function createNoteAndAssociateToTicket(ctx: any, args: { entityId: string; ticketId: string; body: string }) {
  const runRequest = async (forceRefresh: boolean) => {
    const { accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
      entityId: args.entityId,
      forceRefresh,
    });

    const noteResponse = await fetch(`${apiBaseUrl}/crm/v3/objects/notes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_note_body: String(args.body ?? "").trim(),
        },
      }),
    });
    const noteBody = await readJsonOrText(noteResponse);
    return { accessToken, apiBaseUrl, noteResponse, noteBody };
  };

  const first = await runRequest(false);
  if (first.noteResponse.status === 401) {
    const retry = await runRequest(true);
    if (!retry.noteResponse.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(retry.noteBody) ?? "Failed to create HubSpot note",
      });
    }
    const json =
      retry.noteBody.json && typeof retry.noteBody.json === "object" && !Array.isArray(retry.noteBody.json)
        ? (retry.noteBody.json as Record<string, unknown>)
        : null;
    const noteId = typeof json?.id === "string" ? json.id : null;
    if (!noteId) return;

    const assocResponse = await fetch(
      `${retry.apiBaseUrl}/crm/v4/objects/notes/${encodeURIComponent(noteId)}/associations/tickets/${encodeURIComponent(args.ticketId)}/214`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${retry.accessToken}`,
          accept: "application/json",
        },
      },
    );
    if (!assocResponse.ok && assocResponse.status !== 409) {
      if (assocResponse.status === 403 || assocResponse.status === 404) {
        await createEngagementNoteAndAssociateToTicket(ctx, args);
        return;
      }
      const assocBody = await readJsonOrText(assocResponse);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(assocBody) ?? "Failed to associate HubSpot note to ticket",
      });
    }

    return;
  }

  if (!first.noteResponse.ok) {
    if (first.noteResponse.status === 403 || first.noteResponse.status === 404) {
      await createEngagementNoteAndAssociateToTicket(ctx, args);
      return;
    }
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.noteBody) ?? "Failed to create HubSpot note",
    });
  }

  const json =
    first.noteBody.json && typeof first.noteBody.json === "object" && !Array.isArray(first.noteBody.json)
      ? (first.noteBody.json as Record<string, unknown>)
      : null;
  const noteId = typeof json?.id === "string" ? json.id : null;
  if (!noteId) return;

  const assocResponse = await fetch(
    `${first.apiBaseUrl}/crm/v4/objects/notes/${encodeURIComponent(noteId)}/associations/tickets/${encodeURIComponent(args.ticketId)}/214`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${first.accessToken}`,
        accept: "application/json",
      },
    },
  );

  if (!assocResponse.ok && assocResponse.status !== 409) {
    if (assocResponse.status === 403 || assocResponse.status === 404) {
      await createEngagementNoteAndAssociateToTicket(ctx, args);
      return;
    }
    const assocBody = await readJsonOrText(assocResponse);
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(assocBody) ?? "Failed to associate HubSpot note to ticket",
    });
  }
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

    const { plugin, secret } = await getHubSpotSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { configured: true, connected: false };
    }

    const refreshToken = String(secret.refreshToken ?? "").trim();
    const status = String(secret.connectionStatus ?? "").toUpperCase();
    const connected = Boolean(refreshToken) && (status ? status === "CONNECTED" : true);

    return {
      configured: true,
      connected,
      hubId: typeof secret.hubId === "number" ? secret.hubId : undefined,
    };
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
    const subject = String(args.subject ?? "").trim() || "Chatbot conversation";
    const description = String(args.description ?? "").trim();

    const contactId = await getOrCreateContactId(ctx, {
      entityId: args.entityId,
      email: args.contactEmail,
      name: args.contactName,
    });

    const pipelineCfg = await getTicketPipelineAndStages(ctx, { entityId: args.entityId });

    const runRequest = async (forceRefresh: boolean) => {
      const { accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
        entityId: args.entityId,
        forceRefresh,
      });

      const ticketResponse = await fetch(`${apiBaseUrl}/crm/v3/objects/tickets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          properties: {
            subject,
            hs_pipeline: pipelineCfg.pipelineId,
            hs_pipeline_stage: pipelineCfg.stageNew,
          },
        }),
      });
      const ticketBody = await readJsonOrText(ticketResponse);
      return { accessToken, apiBaseUrl, ticketResponse, ticketBody };
    };

    const first = await runRequest(false);
    let created = first;
    if (first.ticketResponse.status === 401) {
      const retry = await runRequest(true);
      if (!retry.ticketResponse.ok) {
        throw new ConvexError({
          code: "BAD_REQUEST",
          message: getErrorMessageFromBody(retry.ticketBody) ?? "Failed to create HubSpot ticket",
        });
      }
      created = retry;
    } else if (!first.ticketResponse.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(first.ticketBody) ?? "Failed to create HubSpot ticket",
      });
    }

    const json =
      created.ticketBody.json &&
      typeof created.ticketBody.json === "object" &&
      !Array.isArray(created.ticketBody.json)
        ? (created.ticketBody.json as Record<string, unknown>)
        : null;
    const ticketId = typeof json?.id === "string" ? json.id : null;
    if (!ticketId || !ticketId.trim()) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "HubSpot ticket creation returned no ticket id",
      });
    }

    if (contactId) {
      try {
        await fetch(
          `${created.apiBaseUrl}/crm/v4/objects/tickets/${encodeURIComponent(ticketId)}/associations/contacts/${encodeURIComponent(contactId)}/16`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${created.accessToken}`,
              accept: "application/json",
            },
          },
        );
      } catch (error) {
        console.error("[hubspot] Failed to associate contact to ticket", error);
      }
    }

    if (description) {
      try {
        await createNoteAndAssociateToTicket(ctx, {
          entityId: args.entityId,
          ticketId,
          body: description,
        });
      } catch (error) {
        console.error("[hubspot] Failed to create initial ticket note", error);
      }
    }

    return { id: ticketId };
  },
});

export const addInternalTicketComment: any = action({
  args: {
    entityId: v.string(),
    ticketId: v.string(),
    commentBody: v.string(),
  },
  handler: async (ctx, args) => {
    const ticketId = String(args.ticketId ?? "").trim();
    if (!ticketId) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing HubSpot ticket id" });
    }

    const body = String(args.commentBody ?? "").trim();
    if (!body) return { ok: true };

    await createNoteAndAssociateToTicket(ctx, {
      entityId: args.entityId,
      ticketId,
      body,
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
    const ticketId = String(args.ticketId ?? "").trim();
    if (!ticketId) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing HubSpot ticket id" });
    }

    const status = String(args.status ?? "").trim().toLowerCase();
    if (!status) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing HubSpot status" });
    }

    const pipelineCfg = await getTicketPipelineAndStages(ctx, { entityId: args.entityId });
    const stageId =
      status === "closed" || status === "resolved"
        ? pipelineCfg.stageClosed
        : status === "escalated" || status === "escalate"
          ? pipelineCfg.stageEscalated
          : pipelineCfg.stageNew;

    const runRequest = async (forceRefresh: boolean) => {
      const { accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
        entityId: args.entityId,
        forceRefresh,
      });

      const response = await fetch(`${apiBaseUrl}/crm/v3/objects/tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          properties: {
            hs_pipeline: pipelineCfg.pipelineId,
            hs_pipeline_stage: stageId,
          },
        }),
      });
      const body = await readJsonOrText(response);
      return { response, body };
    };

    const first = await runRequest(false);
    if (first.response.ok) return { ok: true };

    if (first.response.status === 401) {
      const retry = await runRequest(true);
      if (retry.response.ok) return { ok: true };
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(retry.body) ?? "Failed to update HubSpot ticket",
      });
    }

    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.body) ?? "Failed to update HubSpot ticket",
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
        message: "Missing HubSpot OAuth app config. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.",
      });
    }

    const { plugin, secret } = await getHubSpotSecretForOrg(ctx, args.entityId);
    const prev = secret ?? ({} as HubSpotSecret);

    if (!plugin || !secret) {
      await ctx.runAction(internal.system.secrets.upsert, {
        service: "hubspot" as any,
        entityId: args.entityId,
        value: {
          ...prev,
        },
      });
    }

    return {
      clientId: global.clientId,
      oauthBaseUrl: global.oauthBaseUrl,
      authorizeUrl: "https://app.hubspot.com/oauth/authorize",
      scopes: global.scopes,
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
        message: "Missing HubSpot OAuth app config. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.",
      });
    }

    const { secret } = await getHubSpotSecretForOrg(ctx, args.entityId);
    const prior = (secret ?? ({} as HubSpotSecret)) as HubSpotSecret;

    const response = await fetch(`${global.oauthBaseUrl}/oauth/v1/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        accept: "application/json",
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
        message: getErrorMessageFromBody(body) ?? "Failed to exchange code for HubSpot tokens",
      });
    }

    const json =
      body.json && typeof body.json === "object" && !Array.isArray(body.json)
        ? (body.json as Record<string, unknown>)
        : null;

    const accessToken = typeof json?.access_token === "string" ? json.access_token : null;
    const refreshToken = typeof json?.refresh_token === "string" ? json.refresh_token : null;
    const expiresIn = typeof json?.expires_in === "number" ? json.expires_in : null;

    if (!accessToken || !refreshToken) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "HubSpot OAuth response missing access_token/refresh_token",
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const accessTokenExpiration = expiresIn ? now + expiresIn : null;

    const meta = await fetch(`${global.oauthBaseUrl}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`, {
      headers: { accept: "application/json" },
    });

    let hubId: number | undefined;
    let scopes: string | undefined;
    if (meta.ok) {
      const metaBody = await readJsonOrText(meta);
      const metaJson =
        metaBody.json && typeof metaBody.json === "object" && !Array.isArray(metaBody.json)
          ? (metaBody.json as Record<string, unknown>)
          : null;
      const hubIdRaw = metaJson?.hub_id;
      if (typeof hubIdRaw === "number") hubId = hubIdRaw;
      const scopesRaw = metaJson?.scopes;
      if (Array.isArray(scopesRaw)) {
        scopes = scopesRaw.filter((s) => typeof s === "string").join(" ");
      }
    }

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "hubspot" as any,
      entityId: args.entityId,
      value: {
        ...prior,
        accessToken,
        refreshToken,
        accessTokenExpiration: accessTokenExpiration ?? undefined,
        scopes: scopes ?? prior.scopes,
        hubId: hubId ?? prior.hubId,
        connectionStatus: "CONNECTED",
      },
    });

    console.info(
      `[hubspot] HubSpot OAuth connected entityId=${args.entityId} hubId=${hubId ?? "(unknown)"} refreshToken=${maskId(refreshToken)}`,
    );

    return { ok: true, hubId };
  },
});

export const disconnect: any = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const global = getGlobalOAuthAppConfig();
    const { plugin, secret } = await getHubSpotSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { ok: true };
    }

    const refreshToken = String(secret.refreshToken ?? "").trim();
    const accessToken = String(secret.accessToken ?? "").trim();

    if (global && refreshToken) {
      try {
        await fetch(`${global.oauthBaseUrl}/oauth/v1/refresh-tokens/${encodeURIComponent(refreshToken)}`, {
          method: "DELETE",
          headers: {
            accept: "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });
      } catch {
        // best-effort
      }
    }

    await clearHubSpotTokens(ctx, { entityId: args.entityId, secret });
    return { ok: true };
  },
});

export const listContacts: any = action({
  args: {
    entityId: v.string(),
    limit: v.optional(v.number()),
    debugId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const debugId = args.debugId ? String(args.debugId) : "";
    const logPrefix = debugId ? `[${debugId}]` : "[hubspot]";

    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.min(args.limit, 100) : 20;

    const runRequest = async (forceRefresh: boolean) => {
      const { accessToken, apiBaseUrl } = await ensureValidAccessToken(ctx, {
        entityId: args.entityId,
        debugId,
        forceRefresh,
      });

      const url = `${apiBaseUrl}/crm/v3/objects/contacts?limit=${encodeURIComponent(String(limit))}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          accept: "application/json",
        },
      });
      const body = await readJsonOrText(response);
      return { response, body };
    };

    const first = await runRequest(false);
    if (first.response.ok) return first.body.json;

    if (first.response.status === 401) {
      console.warn(`${logPrefix} HubSpot listContacts 401; retrying after refresh`);
      const retry = await runRequest(true);
      if (retry.response.ok) return retry.body.json;

      if (retry.response.status === 401) {
        const { secret } = await getHubSpotSecretForOrg(ctx, args.entityId);
        if (secret) {
          await clearHubSpotTokens(ctx, { entityId: args.entityId, secret });
        }
        throw new ConvexError({ code: "NOT_FOUND", message: "HubSpot is not connected" });
      }

      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(retry.body) ?? "Failed to fetch HubSpot contacts",
      });
    }

    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(first.body) ?? `Failed to fetch HubSpot contacts (status ${first.response.status})`,
    });
  },
});
