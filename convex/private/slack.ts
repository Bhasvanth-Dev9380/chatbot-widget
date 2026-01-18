import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

type SlackSecret = {
  botToken?: string;
  botUserId?: string;
  teamId?: string;
  teamName?: string;
  scope?: string;
  connectionStatus?: "CONNECTED" | "DISCONNECTED";
};

function getGlobalOAuthAppConfig(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = String(process.env.SLACK_CLIENT_ID ?? process.env.NEXT_PUBLIC_SLACK_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.SLACK_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

async function getSlackSecretForOrg(
  ctx: any,
  entityId: string,
): Promise<{ plugin: any | null; secret: SlackSecret | null }> {
  const plugin: any = await ctx.runQuery(internal.system.plugin.getByEntityIdAndService, {
    entityId,
    service: "slack" as any,
  });

  if (!plugin) return { plugin: null, secret: null };

  const secretValue = await getSecretValue(plugin.secretName);
  const secretData = parseSecretString<SlackSecret>(secretValue);
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
    const error = record.error;
    if (typeof error === "string" && error.trim()) return error;

    const message = record.message;
    if (typeof message === "string" && message.trim()) return message;
  }

  if (body.text.trim()) return body.text;
  return null;
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

    const { plugin, secret } = await getSlackSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { configured: true, connected: false };
    }

    const token = String(secret.botToken ?? "").trim();
    const status = String(secret.connectionStatus ?? "").toUpperCase();
    const connected = Boolean(token) && (status ? status === "CONNECTED" : true);

    return {
      configured: true,
      connected,
      teamName: typeof secret.teamName === "string" ? secret.teamName : undefined,
      teamId: typeof secret.teamId === "string" ? secret.teamId : undefined,
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
        message: "Missing Slack OAuth app config. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.",
      });
    }

    const { plugin, secret } = await getSlackSecretForOrg(ctx, args.entityId);
    const prev = secret ?? ({} as SlackSecret);

    if (!plugin || !secret) {
      await ctx.runAction(internal.system.secrets.upsert, {
        service: "slack" as any,
        entityId: args.entityId,
        value: {
          ...prev,
        },
      });
    }

    return {
      clientId: global.clientId,
      authorizeUrl: "https://slack.com/oauth/v2/authorize",
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
        message: "Missing Slack OAuth app config. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.",
      });
    }

    const { secret } = await getSlackSecretForOrg(ctx, args.entityId);
    const prior = (secret ?? ({} as SlackSecret)) as SlackSecret;

    const response = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: global.clientId,
        client_secret: global.clientSecret,
        code: args.code,
        redirect_uri: args.redirectUri,
      }).toString(),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to exchange code for Slack tokens",
      });
    }

    const json =
      body.json && typeof body.json === "object" && !Array.isArray(body.json)
        ? (body.json as any)
        : null;

    const ok = Boolean(json?.ok);
    if (!ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: String(json?.error ?? "Slack OAuth failed"),
      });
    }

    const accessToken = typeof json?.access_token === "string" ? json.access_token : "";
    const botUserId = typeof json?.bot_user_id === "string" ? json.bot_user_id : undefined;
    const scope = typeof json?.scope === "string" ? json.scope : undefined;
    const teamId = typeof json?.team?.id === "string" ? json.team.id : undefined;
    const teamName = typeof json?.team?.name === "string" ? json.team.name : undefined;

    if (!accessToken.trim()) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Slack OAuth response missing access_token",
      });
    }

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "slack" as any,
      entityId: args.entityId,
      value: {
        ...prior,
        botToken: accessToken,
        botUserId,
        scope,
        teamId,
        teamName,
        connectionStatus: "CONNECTED",
      },
    });

    return { ok: true, teamId, teamName };
  },
});

export const disconnect: any = action({
  args: {
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    const { plugin, secret } = await getSlackSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      return { ok: true };
    }

    const token = String(secret.botToken ?? "").trim();
    if (token) {
      try {
        await fetch("https://slack.com/api/auth.revoke", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token }).toString(),
        });
      } catch {
        // best-effort
      }
    }

    await ctx.runAction(internal.system.secrets.upsert, {
      service: "slack" as any,
      entityId: args.entityId,
      value: {
        ...secret,
        botToken: undefined,
        botUserId: undefined,
        scope: undefined,
        teamId: undefined,
        teamName: undefined,
        connectionStatus: "DISCONNECTED",
      },
    });

    return { ok: true };
  },
});

export const sendMessage: any = action({
  args: {
    entityId: v.string(),
    channel: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const { plugin, secret } = await getSlackSecretForOrg(ctx, args.entityId);
    if (!plugin || !secret) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Slack is not connected" });
    }

    const token = String(secret.botToken ?? "").trim();
    if (!token) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Slack is not connected" });
    }

    const channel = String(args.channel ?? "").trim();
    if (!channel) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "Missing Slack channel" });
    }

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text: String(args.text ?? "") }),
    });

    const body = await readJsonOrText(response);
    const json =
      body.json && typeof body.json === "object" && !Array.isArray(body.json)
        ? (body.json as any)
        : null;

    if (!response.ok || !json?.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? String(json?.error ?? "Failed to send Slack message"),
      });
    }

    return { ok: true };
  },
});
