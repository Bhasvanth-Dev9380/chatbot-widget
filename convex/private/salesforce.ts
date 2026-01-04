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
  oauthTokenUrl?: string;
  username?: string;
  password?: string;
  securityToken?: string;
};

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

async function getSalesforceConfig(ctx: any, organizationId: string) {
  const plugin = await ctx.runQuery(
    internal.system.plugin.getByOrganizationIdAndService,
    {
      organizationId,
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

  let accessToken = secretData.accessToken ?? "";
  let instanceUrl = secretData.instanceUrl ?? "";

  const env = (typeof process !== "undefined" ? process.env : undefined) as
    | Record<string, string | undefined>
    | undefined;

  const oauthTokenUrl = String(
    secretData.oauthTokenUrl ??
      env?.SALESFORCE_OAUTH_TOKEN_URL ??
      "https://login.salesforce.com/services/oauth2/token",
  ).trim();

  const clientId = secretData.clientId ?? env?.SALESFORCE_CLIENT_ID;
  const clientSecret = secretData.clientSecret ?? env?.SALESFORCE_CLIENT_SECRET;
  const refreshToken = secretData.refreshToken ?? env?.SALESFORCE_REFRESH_TOKEN;
  const username = secretData.username ?? env?.SALESFORCE_USERNAME;
  const password = secretData.password ?? env?.SALESFORCE_PASSWORD;
  const securityToken =
    secretData.securityToken ?? env?.SALESFORCE_SECURITY_TOKEN;

  const canRefresh = Boolean(
    refreshToken &&
      clientId &&
      clientSecret &&
      oauthTokenUrl,
  );

  const canPasswordGrant = Boolean(
    username &&
      password &&
      clientId &&
      clientSecret &&
      oauthTokenUrl,
  );

  if (canRefresh) {
    console.log("[salesforce] Using refresh_token grant", {
      organizationId,
      oauthTokenUrl,
    });
    const response = await fetch(oauthTokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken!,
        client_id: clientId!,
        client_secret: clientSecret!,
      }).toString(),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      console.error("[salesforce] refresh_token grant failed", {
        organizationId,
        status: response.status,
        message: getErrorMessageFromBody(body),
      });
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          getErrorMessageFromBody(body) ?? "Failed to refresh Salesforce token",
      });
    }

    if (body.json && typeof body.json === "object" && !Array.isArray(body.json)) {
      const json = body.json as Record<string, unknown>;
      const nextToken = json.access_token;
      const nextInstanceUrl = json.instance_url;

      if (typeof nextToken === "string" && nextToken.trim()) {
        accessToken = nextToken;
      }
      if (typeof nextInstanceUrl === "string" && nextInstanceUrl.trim()) {
        instanceUrl = nextInstanceUrl;
      }

      await ctx.runAction(internal.system.secrets.upsert, {
        service: "salesforce" as any,
        organizationId,
        value: {
          ...secretData,
          accessToken,
          instanceUrl,
        },
      });
    }
  } else if (canPasswordGrant) {
    console.log("[salesforce] Using password grant", {
      organizationId,
      oauthTokenUrl,
      hasSecurityToken: Boolean(securityToken),
    });
    const passwordForGrant =
      password && securityToken && !password.endsWith(securityToken)
        ? `${password}${securityToken}`
        : password;

    const response = await fetch(oauthTokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: username!,
        password: passwordForGrant!,
        client_id: clientId!,
        client_secret: clientSecret!,
      }).toString(),
    });

    const body = await readJsonOrText(response);
    if (!response.ok) {
      console.error("[salesforce] password grant failed", {
        organizationId,
        status: response.status,
        message: getErrorMessageFromBody(body),
      });
      throw new ConvexError({
        code: "BAD_REQUEST",
        message:
          getErrorMessageFromBody(body) ??
          "Failed to fetch Salesforce access token (password grant)",
      });
    }

    if (body.json && typeof body.json === "object" && !Array.isArray(body.json)) {
      const json = body.json as Record<string, unknown>;
      const nextToken = json.access_token;
      const nextInstanceUrl = json.instance_url;

      if (typeof nextToken === "string" && nextToken.trim()) {
        accessToken = nextToken;
      }
      if (typeof nextInstanceUrl === "string" && nextInstanceUrl.trim()) {
        instanceUrl = nextInstanceUrl;
      }

      if (accessToken && instanceUrl) {
        await ctx.runAction(internal.system.secrets.upsert, {
          service: "salesforce" as any,
          organizationId,
          value: {
            ...secretData,
            accessToken,
            instanceUrl,
          },
        });
      }
    }
  }

  if (!accessToken || !instanceUrl) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Salesforce credentials are missing or incomplete",
    });
  }

  const apiVersion = String(secretData.apiVersion ?? "57.0").replace(/^v/i, "");

  return {
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

export const getWebhookUrls = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.runQuery(
      internal.system.plugin.getByOrganizationIdAndService,
      {
        organizationId: args.organizationId,
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
    organizationId: v.string(),
    webhookUrlCreated: v.optional(v.string()),
    webhookUrlEscalated: v.optional(v.string()),
    webhookUrlResolved: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.runQuery(
      internal.system.plugin.getByOrganizationIdAndService,
      {
        organizationId: args.organizationId,
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
      organizationId: args.organizationId,
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
    organizationId: v.string(),
    event: v.string(),
    conversationId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    caseId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const plugin = await ctx.runQuery(
      internal.system.plugin.getByOrganizationIdAndService,
      {
        organizationId: args.organizationId,
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
      organizationId: args.organizationId,
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
          organizationId: args.organizationId,
          event: args.event,
          status: response.status,
          message: getErrorMessageFromBody(body),
        });
      }
    } catch (error) {
      console.error("[salesforce] webhook failed", {
        organizationId: args.organizationId,
        event: args.event,
        error,
      });
    }

    return { ok: true };
  },
});

export const verifyConnection = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    console.log("[salesforce] verifyConnection called", {
      organizationId: args.organizationId,
    });
    const cfg = await getSalesforceConfig(ctx, args.organizationId);

    console.log("[salesforce] verifyConnection resolved config", {
      organizationId: args.organizationId,
      instanceUrl: cfg.instanceUrl,
      apiVersion: cfg.apiVersion,
    });

    await sfQuery(cfg, "SELECT Id FROM Organization LIMIT 1");

    return {
      ok: true,
      instanceUrl: cfg.instanceUrl,
      apiVersion: cfg.apiVersion,
    };
  },
});

async function sfGetCaseNumberById(
  cfg: { accessToken: string; baseApi: string },
  caseId: string,
): Promise<string | null> {
  const soql = `SELECT Id, CaseNumber FROM Case WHERE Id='${caseId.replace(/'/g, "\\'")}'`;
  const data = (await sfQuery(cfg, soql)) as any;
  const rec = Array.isArray(data?.records) ? data.records[0] : null;
  const caseNumber = rec?.CaseNumber;
  return typeof caseNumber === "string" && caseNumber.trim() ? caseNumber : null;
}

async function sfQuery(
  cfg: { accessToken: string; baseApi: string },
  soql: string,
) {
  const url = `${cfg.baseApi}/query/?q=${encodeURIComponent(soql)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const body = await readJsonOrText(response);
  if (!response.ok) {
    throw new ConvexError({
      code: "BAD_REQUEST",
      message: getErrorMessageFromBody(body) ?? "Salesforce request failed",
    });
  }

  return body.json;
}

async function sfGetQueueIdByName(
  cfg: { accessToken: string; baseApi: string },
  queueName: string,
): Promise<string | null> {
  const safe = queueName.replace(/'/g, "\\'");
  const soql = `SELECT Id FROM Group WHERE Type='Queue' AND Name='${safe}' LIMIT 1`;
  const data = (await sfQuery(cfg, soql)) as any;
  const rec = Array.isArray(data?.records) ? data.records[0] : null;
  const id = rec?.Id;
  return typeof id === "string" && id.trim() ? id : null;
}

async function sfFindContactIdByEmail(
  cfg: { accessToken: string; baseApi: string },
  email: string,
): Promise<string | null> {
  const safe = email.replace(/'/g, "\\'");
  const soql =
    `SELECT Id FROM Contact WHERE Email='${safe}' ORDER BY LastModifiedDate DESC LIMIT 1`;
  const data = (await sfQuery(cfg, soql)) as any;
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
  cfg: { accessToken: string; baseApi: string },
  args: { name?: string; email?: string },
): Promise<string> {
  const { firstName, lastName } = splitName(args.name);
  const payload: Record<string, unknown> = {
    LastName: lastName,
  };
  if (firstName) payload.FirstName = firstName;
  if (args.email) payload.Email = args.email;

  const response = await fetch(`${cfg.baseApi}/sobjects/Contact`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

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
  cfg: { accessToken: string; baseApi: string },
  args: { name?: string; email?: string },
): Promise<string | null> {
  const email = String(args.email ?? "").trim();
  if (!email) return null;

  const existing = await sfFindContactIdByEmail(cfg, email);
  if (existing) return existing;

  return await sfCreateContact(cfg, { name: args.name, email });
}

export const createCase = action({
  args: {
    organizationId: v.string(),
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
      organizationId: args.organizationId,
      subject: args.subject,
      status: args.status ?? "New",
      origin: args.origin ?? "Web",
      hasOwnerId: Boolean(args.ownerId),
      hasContactId: Boolean(args.contactId),
    });
    const cfg = await getSalesforceConfig(ctx, args.organizationId);

    console.log("[salesforce] createCase using instance", {
      organizationId: args.organizationId,
      instanceUrl: cfg.instanceUrl,
      apiVersion: cfg.apiVersion,
      baseApi: cfg.baseApi,
    });

    const payload: Record<string, unknown> = {
      Subject: args.subject,
      Status: args.status ?? "New",
      Origin: args.origin ?? "Web",
      Comment__c: args.comment ?? "Case Created via chatbot",
    };

    if (args.description) payload.Description = args.description;

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
          const resolved = await sfGetQueueIdByName(cfg, queueName);
          if (resolved) ownerId = resolved;
        } catch (error) {
          console.error("[salesforce] Failed to resolve queue OwnerId by name", {
            organizationId: args.organizationId,
            queueName,
            error,
          });
        }
      }
    }

    let contactId: string | undefined = args.contactId ?? cfg.contactId;
    if (!contactId && (suppliedEmail || suppliedName)) {
      try {
        const resolvedContactId = await sfGetOrCreateContactId(cfg, {
          name: suppliedName || undefined,
          email: suppliedEmail || undefined,
        });
        if (resolvedContactId) contactId = resolvedContactId;
      } catch (error) {
        console.error("[salesforce] Failed to resolve/create Contact", {
          organizationId: args.organizationId,
          suppliedEmail: suppliedEmail || null,
          error,
        });
      }
    }

    if (ownerId) payload.OwnerId = ownerId;
    if (contactId) payload.ContactId = contactId;

    const response = await fetch(`${cfg.baseApi}/sobjects/Case`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await readJsonOrText(response);
    if (response.status !== 201) {
      console.error("[salesforce] createCase failed", {
        organizationId: args.organizationId,
        status: response.status,
        message: getErrorMessageFromBody(body),
      });
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: getErrorMessageFromBody(body) ?? "Failed to create case",
      });
    }

    const json = body.json as Record<string, unknown> | null;

    const id = typeof json?.id === "string" ? json.id : null;
    const caseNumber = id ? await sfGetCaseNumberById(cfg, id) : null;

    if (id && args.caseCommentBody) {
      try {
        const commentResponse = await fetch(`${cfg.baseApi}/sobjects/CaseComment`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cfg.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ParentId: id,
            CommentBody: args.caseCommentBody,
            IsPublished: false,
          }),
        });

        if (commentResponse.status !== 201) {
          const commentBody = await readJsonOrText(commentResponse);
          console.error("[salesforce] createCase failed to create CaseComment", {
            organizationId: args.organizationId,
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
    organizationId: v.string(),
    caseNumberOrId: v.string(),
    commentBody: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.organizationId);

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
      const data = (await sfQuery(cfg, soql)) as any;
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

    const response = await fetch(`${cfg.baseApi}/sobjects/CaseComment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ParentId: caseId,
        CommentBody: args.commentBody,
        IsPublished: false,
      }),
    });

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
    organizationId: v.string(),
    caseNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.organizationId);

    const soql =
      `SELECT Id, CaseNumber, Subject, Status, Priority ` +
      `FROM Case WHERE CaseNumber='${args.caseNumber.replace(/'/g, "\\'")}'`;

    const data = (await sfQuery(cfg, soql)) as any;
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
    organizationId: v.string(),
    caseNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.organizationId);

    const soql =
      `SELECT Id, CaseNumber, Comment__c, ` +
      `(SELECT Id, CommentBody, CreatedDate, CreatedBy.Name FROM CaseComments) ` +
      `FROM Case WHERE CaseNumber='${args.caseNumber.replace(/'/g, "\\'")}'`;

    const data = (await sfQuery(cfg, soql)) as any;
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
    organizationId: v.string(),
    accountId: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.organizationId);

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

    const data = (await sfQuery(cfg, soql)) as any;
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
    organizationId: v.string(),
    caseNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.organizationId);

    const soql =
      `SELECT Id FROM Case WHERE CaseNumber='${args.caseNumber.replace(/'/g, "\\'")}'`;
    const data = (await sfQuery(cfg, soql)) as any;
    const rec = Array.isArray(data?.records) ? data.records[0] : null;

    const caseId = rec?.Id;
    if (!caseId || typeof caseId !== "string") {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Case not found",
      });
    }

    const response = await fetch(`${cfg.baseApi}/sobjects/Case/${caseId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ IsEscalated: true }),
    });

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
    organizationId: v.string(),
    caseNumber: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const cfg = await getSalesforceConfig(ctx, args.organizationId);

    const soql =
      `SELECT Id FROM Case WHERE CaseNumber='${args.caseNumber.replace(/'/g, "\\'")}'`;
    const data = (await sfQuery(cfg, soql)) as any;
    const rec = Array.isArray(data?.records) ? data.records[0] : null;

    const caseId = rec?.Id;
    if (!caseId || typeof caseId !== "string") {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Case not found",
      });
    }

    const nextStatus = String(args.status ?? cfg.closeStatus ?? "Closed").trim();
    const response = await fetch(`${cfg.baseApi}/sobjects/Case/${caseId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ Status: nextStatus }),
    });

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
