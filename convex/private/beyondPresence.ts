import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

async function readJsonOrText(response: any): Promise<{
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

function pickWebhookishFields(agent: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return out;

  for (const [key, value] of Object.entries(agent as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (
      k.includes("webhook") ||
      k.includes("callback") ||
      k.includes("event") ||
      k.includes("notify")
    ) {
      out[key] = value;
    }
  }

  return out;
}

async function getBeyondPresenceCredentials(
  ctx: any,
  entityId: string,
) {
  const plugin = await ctx.runQuery(
    internal.system.plugin.getByEntityIdAndService,
    {
      entityId,
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
    entityId: v.string(),
  },
  returns: v.array(v.any()),
  handler: async (ctx, args): Promise<any[]> => {
    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.entityId,
    );

    const languageAgentRows: any[] = await ctx.runQuery(
      (internal as any).system.beyondPresenceLanguageAgents.listByEntityId,
      {
        entityId: args.entityId,
      },
    );
    const languageAgentIds: Set<string> = new Set(
      (Array.isArray(languageAgentRows) ? languageAgentRows : [])
        .map((r: any) => (r?.agentId ? String(r.agentId) : ""))
        .filter(Boolean),
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

    const list: any[] = Array.isArray(json?.data) ? (json.data as any[]) : [];
    // Hide language-cloned agents from user-facing lists.
    const filtered = list.filter((agent: any) => {
      const id = agent?.id ? String(agent.id) : "";
      if (id && languageAgentIds.has(id)) return false;

      // Extra safety: hide orphan clones (when mapping row is missing).
      // We only treat it as a clone if BOTH conditions match:
      // - name ends with "(<lang>)"
      // - agent.language matches that <lang>
      const name = typeof agent?.name === "string" ? agent.name : "";
      const lang = typeof agent?.language === "string" ? agent.language : "";
      const m = name.match(/\(([^()]+)\)\s*$/);
      const suffix = m?.[1] ? String(m[1]).trim() : "";
      if (suffix && lang && suffix === lang) return false;

      return true;
    });

    // If clones were created from another deployment (or name suffix was removed),
    // we may not have mapping rows to filter by. De-dupe common clone patterns.
    const seen = new Map<string, { index: number; agent: any }>();
    const deduped: any[] = [];
    for (const agent of filtered) {
      const name = typeof agent?.name === "string" ? agent.name : "";
      const avatarId = typeof agent?.avatar_id === "string" ? agent.avatar_id : "";
      const systemPrompt =
        typeof agent?.system_prompt === "string" ? agent.system_prompt : "";
      const key = `${name}||${avatarId}||${systemPrompt}`;

      if (!name || !avatarId || !systemPrompt) {
        deduped.push(agent);
        continue;
      }

      const prev = seen.get(key);
      if (!prev) {
        const index = deduped.length;
        deduped.push(agent);
        seen.set(key, { index, agent });
        continue;
      }

      const lang = typeof agent?.language === "string" ? agent.language : "";
      const prevLang =
        typeof prev.agent?.language === "string" ? prev.agent.language : "";
      if (prevLang !== "en" && lang === "en") {
        deduped[prev.index] = agent;
        seen.set(key, { index: prev.index, agent });
      }
    }

    return deduped;
  },
});

export const listAvatars = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.entityId,
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
    entityId: v.string(),
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
      args.entityId,
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
    entityId: v.string(),
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
      args.entityId,
    );

    const mapping = await ctx.runQuery(
      (internal as any).system.beyondPresenceLanguageAgents.getByAgentId,
      {
        agentId: args.agentId,
      },
    );

    const targetBaseAgentId = mapping?.baseAgentId
      ? String(mapping.baseAgentId)
      : args.agentId;
    const targetAgentId = targetBaseAgentId;

    // Fetch existing agent so we can preserve fields Beyond Presence might clear on PATCH.
    let existingAgent: any = null;
    try {
      const existingResp = await fetch(`${baseUrl}/v1/agents/${targetAgentId}`,
        {
          method: "GET",
          headers: {
            "x-api-key": apiKey,
          },
        },
      );
      if (existingResp.ok) {
        const existingBody = await readJsonOrText(existingResp);
        existingAgent = (existingBody.json ?? null) as any;
      }
    } catch {
      // best-effort
    }

    const body: Record<string, unknown> = {
      ...(existingAgent && typeof existingAgent === "object" && !Array.isArray(existingAgent)
        ? {
            name: (existingAgent as any).name,
            avatar_id: (existingAgent as any).avatar_id,
            system_prompt: (existingAgent as any).system_prompt,
            language: (existingAgent as any).language,
            greeting: (existingAgent as any).greeting,
            max_session_length_minutes: (existingAgent as any).max_session_length_minutes,
          }
        : {}),
      ...(Array.isArray(existingAgent?.capabilities)
        ? { capabilities: existingAgent.capabilities }
        : {}),
      ...(existingAgent?.llm && typeof existingAgent.llm === "object" && !Array.isArray(existingAgent.llm)
        ? { llm: existingAgent.llm }
        : {}),
      ...pickWebhookishFields(existingAgent),
    };

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

    const response = await fetch(`${baseUrl}/v1/agents/${targetAgentId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errorBody = await readJsonOrText(response);
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(errorBody) ?? "Failed to update agent",
      });
    }

    const okBody = await readJsonOrText(response);

    // Keep language clones in sync with the base agent.
    try {
      const clones = await ctx.runQuery(
        (internal as any).system.beyondPresenceLanguageAgents.listByOrgBaseAgentId,
        {
          entityId: args.entityId,
          baseAgentId: targetBaseAgentId,
        },
      );

      const rows = Array.isArray(clones) ? clones : [];
      if (rows.length > 0) {
        // Always re-fetch to get a complete, current base agent shape for clone sync.
        let baseAgent: any = null;
        const baseResp = await fetch(`${baseUrl}/v1/agents/${targetBaseAgentId}`,
          {
            method: "GET",
            headers: {
              "x-api-key": apiKey,
            },
          },
        );

        if (baseResp.ok) {
          const baseBody = await readJsonOrText(baseResp);
          baseAgent = (baseBody.json ?? null) as any;
        } else {
          baseAgent = (okBody.json ?? null) as any;
        }

        const syncPromises: Promise<unknown>[] = [];

        for (const row of rows) {
            const cloneId = row?.agentId ? String(row.agentId) : "";
            const lang = row?.language ? String(row.language) : "";
            if (!cloneId || !lang) continue;

            const clonePatch: Record<string, any> = {
              language: lang,
              name: String(baseAgent?.name ?? "Agent"),
              avatar_id: String(baseAgent?.avatar_id ?? ""),
              system_prompt: String(baseAgent?.system_prompt ?? ""),
              greeting:
                typeof baseAgent?.greeting === "string" ? baseAgent.greeting : undefined,
              max_session_length_minutes:
                typeof baseAgent?.max_session_length_minutes === "number"
                  ? baseAgent.max_session_length_minutes
                  : undefined,
              ...pickWebhookishFields(baseAgent),
            };

            if (Array.isArray(baseAgent?.capabilities)) {
              clonePatch.capabilities = baseAgent.capabilities;
            }
            if (
              baseAgent?.llm &&
              typeof baseAgent.llm === "object" &&
              !Array.isArray(baseAgent.llm)
            ) {
              clonePatch.llm = baseAgent.llm;
            }

            syncPromises.push(
              fetch(`${baseUrl}/v1/agents/${cloneId}`,
                {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                  },
                  body: JSON.stringify(clonePatch),
                },
              ),
            );
        }

        if (syncPromises.length > 0) {
          await Promise.allSettled(syncPromises);
        }
      }
    } catch {
      // best-effort
    }

    return okBody.json;
  },
});

export const deleteAgent = action({
  args: {
    entityId: v.string(),
    agentId: v.string(),
  },
  handler: async (ctx, args) => {
    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.entityId,
    );

    const mapping = await ctx.runQuery(
      (internal as any).system.beyondPresenceLanguageAgents.getByAgentId,
      {
        agentId: args.agentId,
      },
    );

    const targetBaseAgentId = mapping?.baseAgentId
      ? String(mapping.baseAgentId)
      : args.agentId;

    // If deleting a base agent, delete all clones first.
    if (!mapping) {
      const clones = await ctx.runQuery(
        (internal as any).system.beyondPresenceLanguageAgents.listByOrgBaseAgentId,
        {
          entityId: args.entityId,
          baseAgentId: targetBaseAgentId,
        },
      );

      for (const row of Array.isArray(clones) ? clones : []) {
        const cloneId = row?.agentId ? String(row.agentId) : "";
        if (!cloneId) continue;

        try {
          await fetch(`${baseUrl}/v1/agents/${cloneId}`,
            {
              method: "DELETE",
              headers: {
                "x-api-key": apiKey,
              },
            },
          );
          await ctx.runMutation(
            (internal as any).system.beyondPresenceLanguageAgents.deleteByAgentId,
            {
              agentId: cloneId,
            },
          );
        } catch {
          // best-effort
        }
      }

      await ctx.runMutation(
        (internal as any).system.beyondPresenceLanguageAgents.deleteByOrgBaseAgentId,
        {
          entityId: args.entityId,
          baseAgentId: targetBaseAgentId,
        },
      );
    } else {
      await ctx.runMutation(
        (internal as any).system.beyondPresenceLanguageAgents.deleteByAgentId,
        {
          agentId: args.agentId,
        },
      );
    }

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
    entityId: v.string(),
    baseAgentId: v.string(),
    language: v.string(),
  },
  handler: async (ctx, args): Promise<{ agentId: string }> => {
    const existing: { agentId?: string } | null = await ctx.runQuery(
      (internal as any).system.beyondPresenceLanguageAgents.getByOrgBaseLanguage,
      {
        entityId: args.entityId,
        baseAgentId: args.baseAgentId,
        language: args.language,
      },
    );

    const { apiKey, baseUrl } = await getBeyondPresenceCredentials(
      ctx,
      args.entityId,
    );

    if (existing?.agentId) {
      // Best-effort: keep the clone synced with the latest base agent settings.
      try {
        const [baseResp, cloneResp] = await Promise.all([
          fetch(`${baseUrl}/v1/agents/${args.baseAgentId}`,
            {
              method: "GET",
              headers: {
                "x-api-key": apiKey,
              },
            },
          ),
          fetch(`${baseUrl}/v1/agents/${existing.agentId}`,
            {
              method: "GET",
              headers: {
                "x-api-key": apiKey,
              },
            },
          ),
        ]);

        if (baseResp.ok && cloneResp.ok) {
          const baseBody = await readJsonOrText(baseResp);
          const cloneBody = await readJsonOrText(cloneResp);
          const baseAgent = (baseBody.json ?? null) as any;
          const cloneAgent = (cloneBody.json ?? null) as any;

          const patch: Record<string, any> = {
            language: args.language,
            name: String(baseAgent?.name ?? cloneAgent?.name ?? "Agent"),
            avatar_id: String(baseAgent?.avatar_id ?? cloneAgent?.avatar_id ?? ""),
            system_prompt: String(
              baseAgent?.system_prompt ?? cloneAgent?.system_prompt ?? "",
            ),
            greeting:
              typeof baseAgent?.greeting === "string"
                ? baseAgent.greeting
                : cloneAgent?.greeting,
            max_session_length_minutes:
              typeof baseAgent?.max_session_length_minutes === "number"
                ? baseAgent.max_session_length_minutes
                : cloneAgent?.max_session_length_minutes,
            ...pickWebhookishFields(baseAgent),
          };

          if (Array.isArray(baseAgent?.capabilities)) {
            patch.capabilities = baseAgent.capabilities;
          }
          if (
            baseAgent?.llm &&
            typeof baseAgent.llm === "object" &&
            !Array.isArray(baseAgent.llm)
          ) {
            patch.llm = baseAgent.llm;
          }

          await fetch(`${baseUrl}/v1/agents/${existing.agentId}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
              },
              body: JSON.stringify(patch),
            },
          );
        }
      } catch {
        // best-effort
      }

      return { agentId: existing.agentId };
    }

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

    const createBody: Record<string, any> = {
      name: String(baseAgent?.name ?? "Agent"),
      avatar_id: String(baseAgent?.avatar_id ?? ""),
      system_prompt: String(baseAgent?.system_prompt ?? ""),
      language: args.language,
      greeting: typeof baseAgent?.greeting === "string" ? baseAgent.greeting : undefined,
      max_session_length_minutes:
        typeof baseAgent?.max_session_length_minutes === "number"
          ? baseAgent.max_session_length_minutes
          : 30,
      ...pickWebhookishFields(baseAgent),
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
        entityId: args.entityId,
        baseAgentId: args.baseAgentId,
        language: args.language,
        agentId: newAgentId,
      },
    );

    return { agentId: newAgentId };
  },
});
