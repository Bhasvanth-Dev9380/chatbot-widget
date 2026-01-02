import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

async function readJsonOrText(response: Response): Promise<{
  json: unknown | null;
  text: string;
}> {
  const text = await response.text();
  if (!text) {
    return { json: null, text: "" };
  }

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
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    const error = record.error;
    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }

  if (body.text.trim()) return body.text;
  return null;
}

async function getBeyondPresenceCredentials(
  ctx: any,
  organizationId: string,
) {
  const plugin = await ctx.runQuery(
    internal.system.plugin.getByOrganizationIdAndService,
    {
      organizationId,
      service: "beyond_presence",
    },
  );

  if (!plugin) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Plugin not found",
    });
  }

  const secretValue = await getSecretValue(plugin.secretName);
  const secretData = parseSecretString<{ apiKey: string; baseUrl?: string }>(
    secretValue,
  );

  if (!secretData?.apiKey) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message:
        "Credentials incomplete. Please reconnect your Beyond Presence account.",
    });
  }

  return {
    apiKey: secretData.apiKey,
    baseUrl: secretData.baseUrl ?? "https://api.bey.dev",
  };
}

export const getAgents = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.organizationId,
    );

    const response = await fetch(`${baseUrl}/v1/agents?limit=50`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!response.ok) {
      const body = await readJsonOrText(response);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to fetch agents",
      });
    }

    const body = await readJsonOrText(response);
    const json = (body.json ?? null) as { data?: unknown[] } | null;

    return Array.isArray(json?.data) ? json.data : [];
  },
});

export const listAvatars = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.organizationId,
    );

    const response = await fetch(`${baseUrl}/v1/avatars?limit=50`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!response.ok) {
      const body = await readJsonOrText(response);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to fetch avatars",
      });
    }

    const body = await readJsonOrText(response);
    const json = (body.json ?? null) as { data?: unknown[] } | null;
    return Array.isArray(json?.data) ? json.data : [];
  },
});

export const createAgent = action({
  args: {
    organizationId: v.string(),
    name: v.string(),
    avatarId: v.string(),
    systemPrompt: v.string(),
    language: v.optional(v.string()),
    greeting: v.optional(v.string()),
    maxSessionLengthMinutes: v.optional(v.number()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.organizationId,
    );

    const body: Record<string, unknown> = {
      name: args.name,
      avatar_id: args.avatarId,
      system_prompt: args.systemPrompt,
      language: args.language ?? "en",
      greeting: args.greeting ?? "Hello!",
      max_session_length_minutes: args.maxSessionLengthMinutes ?? 30,
    };

    if (
      args.payload &&
      typeof args.payload === "object" &&
      !Array.isArray(args.payload)
    ) {
      Object.assign(body, args.payload as Record<string, unknown>);
    }

    const response = await fetch(`${baseUrl}/v1/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await readJsonOrText(response);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(errorBody) ?? "Failed to create agent",
      });
    }

    const okBody = await readJsonOrText(response);
    return okBody.json;
  },
});

export const updateAgent = action({
  args: {
    organizationId: v.string(),
    agentId: v.string(),
    name: v.optional(v.string()),
    avatarId: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    language: v.optional(v.string()),
    greeting: v.optional(v.string()),
    maxSessionLengthMinutes: v.optional(v.number()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.organizationId,
    );

    const body: Record<string, unknown> = {};
    if (args.name !== undefined) body.name = args.name;
    if (args.avatarId !== undefined) body.avatar_id = args.avatarId;
    if (args.systemPrompt !== undefined) body.system_prompt = args.systemPrompt;
    if (args.language !== undefined) body.language = args.language;
    if (args.greeting !== undefined) body.greeting = args.greeting;
    if (args.maxSessionLengthMinutes !== undefined) {
      body.max_session_length_minutes = args.maxSessionLengthMinutes;
    }

    if (
      args.payload &&
      typeof args.payload === "object" &&
      !Array.isArray(args.payload)
    ) {
      Object.assign(body, args.payload as Record<string, unknown>);
    }

    const response = await fetch(`${baseUrl}/v1/agents/${args.agentId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await readJsonOrText(response);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(errorBody) ?? "Failed to update agent",
      });
    }

    const okBody = await readJsonOrText(response);
    return okBody.json;
  },
});

export const deleteAgent = action({
  args: {
    organizationId: v.string(),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.organizationId,
    );

    const response = await fetch(`${baseUrl}/v1/agents/${args.agentId}`, {
      method: "DELETE",
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await readJsonOrText(response);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(errorBody) ?? "Failed to delete agent",
      });
    }

    return null;
  },
});

export const getOrCreateLanguageAgent = action({
  args: {
    organizationId: v.string(),
    baseAgentId: v.string(),
    language: v.string(),
  },
  handler: async (ctx, args): Promise<{ agentId: string }> => {
    const existing: { agentId?: string } | null = await ctx.runQuery(
      (internal as any).system.beyondPresenceLanguageAgents.getByOrgBaseLanguage,
      {
        organizationId: args.organizationId,
        baseAgentId: args.baseAgentId,
        language: args.language,
      },
    );

    if (existing?.agentId) {
      return { agentId: existing.agentId };
    }

    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.organizationId,
    );

    const getResp = await fetch(`${baseUrl}/v1/agents/${args.baseAgentId}`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
      },
    });

    if (!getResp.ok) {
      const body = await readJsonOrText(getResp);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to retrieve base agent",
      });
    }

    const getBody = await readJsonOrText(getResp);
    const baseAgent = (getBody.json ?? null) as any;

    const createBody: Record<string, unknown> = {
      name: `${String(baseAgent?.name ?? "Agent")} (${args.language})`,
      avatar_id: String(baseAgent?.avatar_id ?? ""),
      system_prompt: String(baseAgent?.system_prompt ?? ""),
      language: args.language,
      greeting: typeof baseAgent?.greeting === "string" ? baseAgent.greeting : undefined,
      max_session_length_minutes:
        typeof baseAgent?.max_session_length_minutes === "number"
          ? baseAgent.max_session_length_minutes
          : 30,
    };

    if (Array.isArray(baseAgent?.capabilities)) {
      createBody.capabilities = baseAgent.capabilities;
    }
    if (baseAgent?.llm && typeof baseAgent.llm === "object" && !Array.isArray(baseAgent.llm)) {
      createBody.llm = baseAgent.llm;
    }

    if (!createBody.avatar_id || !createBody.system_prompt) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Base agent is missing required fields (avatar_id/system_prompt)",
      });
    }

    const createResp = await fetch(`${baseUrl}/v1/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(createBody),
    });

    if (!createResp.ok) {
      const body = await readJsonOrText(createResp);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to create language agent",
      });
    }

    const okBody = await readJsonOrText(createResp);
    const created = (okBody.json ?? null) as any;
    const newAgentId = String(created?.id ?? "");

    if (!newAgentId) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Beyond Presence create agent returned no id",
      });
    }

    await ctx.runMutation(
      (internal as any).system.beyondPresenceLanguageAgents.create,
      {
        organizationId: args.organizationId,
        baseAgentId: args.baseAgentId,
        language: args.language,
        agentId: newAgentId,
      },
    );

    return { agentId: newAgentId };
  },
});
