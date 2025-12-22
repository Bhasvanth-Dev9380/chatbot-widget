import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { action } from "../_generated/server";
import { getSecretValue, parseSecretString } from "../lib/secrets";

export const getAgents = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.runQuery(
      internal.system.plugin.getByOrganizationIdAndService,
      {
        organizationId: args.organizationId,
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
        message: "Credentials incomplete. Please reconnect your Beyond Presence account.",
      });
    }

    const baseUrl = secretData.baseUrl ?? "https://api.bey.dev";

    const response = await fetch(`${baseUrl}/v1/agents?limit=50`, {
      method: "GET",
      headers: {
        "x-api-key": secretData.apiKey,
      },
    });

    if (!response.ok) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "Failed to fetch agents",
      });
    }

    const json = (await response.json()) as {
      data?: unknown[];
    };

    return Array.isArray(json?.data) ? json.data : [];
  },
});
