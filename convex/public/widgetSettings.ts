import { v } from "convex/values";
import { query } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

/* -------------------------------------------------
   BASIC WIDGET SETTINGS (ADMIN / INTERNAL USE)
------------------------------------------------- */
export const getByOrganizationId = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("widgetSettings")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();
  },
});

/* -------------------------------------------------
   TYPES
------------------------------------------------- */
type WidgetAppearance = Doc<"widgetSettings">["appearance"];

type ResolvedWidgetAppearance =
  | undefined
  | (Omit<NonNullable<WidgetAppearance>, "logo"> & {
      logo?: ResolvedWidgetLogo;
    });

type WidgetLogo = NonNullable<NonNullable<WidgetAppearance>["logo"]>;
type ResolvedWidgetLogo = WidgetLogo & { url?: string | null };

type WidgetSettingsDoc = Doc<"widgetSettings">;

type WidgetSettingsWithResolvedAppearance =
  Omit<WidgetSettingsDoc, "appearance"> & {
    appearance?: ResolvedWidgetAppearance;
  };

type ChatbotSettings = {
  chatbotId?: string;
  chatbotName: string;
  greetMessage: string;
  customSystemPrompt?: string;
  aiAvatarEnabled?: boolean;
  beyondPresenceAgentId?: string;
  appearance?: ResolvedWidgetAppearance;
  defaultSuggestions: {
    suggestion1?: string;
    suggestion2?: string;
    suggestion3?: string;
  };
  vapiSettings: {
    assistantId?: string;
    phoneNumber?: string;
  };
};

/* -------------------------------------------------
   WIDGET CHATBOT SETTINGS (PUBLIC / WIDGET USE)
------------------------------------------------- */
export const getChatbotSettings = query({
  args: {
    organizationId: v.string(),
    chatbotId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<ChatbotSettings | WidgetSettingsWithResolvedAppearance | null> => {
    /* -----------------------------
       1. Explicit chatbotId
    ----------------------------- */
    if (args.chatbotId) {
      const chatbot = await ctx.db
        .query("chatbots")
        .withIndex("by_chatbot_id", (q) =>
          q.eq("chatbotId", args.chatbotId),
        )
        .unique();

      if (
        chatbot &&
        chatbot.organizationId === args.organizationId &&
        (chatbot as any).isActive !== false
      ) {
        return {
          chatbotId: chatbot.chatbotId,
          chatbotName: chatbot.name,
          greetMessage: chatbot.greetMessage,
          customSystemPrompt: chatbot.customSystemPrompt,
          aiAvatarEnabled: (chatbot as any).aiAvatarEnabled ?? false,
          beyondPresenceAgentId: (chatbot as any).beyondPresenceAgentId ?? undefined,
          appearance: await resolveAppearance(
            ctx,
            chatbot.appearance as WidgetAppearance,
          ),
          defaultSuggestions: chatbot.defaultSuggestions,
          vapiSettings: chatbot.vapiSettings ?? {}, // ✅ FIX
        };
      }

      return null;
    }

    /* -----------------------------
       2. Widget-selected chatbot
    ----------------------------- */
    const widgetSettingsForSelection = await ctx.db
      .query("widgetSettings")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .unique();

    if (widgetSettingsForSelection?.selectedChatbotId) {
      const selectedChatbot = await ctx.db.get(
        widgetSettingsForSelection.selectedChatbotId,
      );

      if (selectedChatbot && (selectedChatbot as any).isActive !== false) {
        return {
          chatbotId: selectedChatbot.chatbotId,
          chatbotName: selectedChatbot.name,
          greetMessage: selectedChatbot.greetMessage,
          customSystemPrompt: selectedChatbot.customSystemPrompt,
          aiAvatarEnabled: (selectedChatbot as any).aiAvatarEnabled ?? false,
          beyondPresenceAgentId:
            (selectedChatbot as any).beyondPresenceAgentId ?? undefined,
          appearance: await resolveAppearance(
            ctx,
            selectedChatbot.appearance as WidgetAppearance,
          ),
          defaultSuggestions: selectedChatbot.defaultSuggestions,
          vapiSettings: selectedChatbot.vapiSettings ?? {},
        };
      }
    }

    /* -----------------------------
       3. Prefer any chatbot with avatar enabled
          (helps when user configured a non-default chatbot)
    ----------------------------- */
    const activeChatbots = await ctx.db
      .query("chatbots")
      .withIndex("by_organization_and_active", (q) =>
        q.eq("organizationId", args.organizationId).eq("isActive", true),
      )
      .collect();

    const avatarChatbot = activeChatbots.find(
      (c) =>
        (c as any).aiAvatarEnabled === true &&
        Boolean((c as any).beyondPresenceAgentId),
    );

    if (avatarChatbot) {
      return {
        chatbotId: avatarChatbot.chatbotId,
        chatbotName: avatarChatbot.name,
        greetMessage: avatarChatbot.greetMessage,
        customSystemPrompt: avatarChatbot.customSystemPrompt,
        aiAvatarEnabled: (avatarChatbot as any).aiAvatarEnabled ?? false,
        beyondPresenceAgentId:
          (avatarChatbot as any).beyondPresenceAgentId ?? undefined,
        appearance: await resolveAppearance(
          ctx,
          avatarChatbot.appearance as WidgetAppearance,
        ),
        defaultSuggestions: avatarChatbot.defaultSuggestions,
        vapiSettings: avatarChatbot.vapiSettings ?? {},
      };
    }

    /* -----------------------------
       4. Default chatbot
    ----------------------------- */
    const defaultChatbot = await ctx.db
      .query("chatbots")
      .withIndex("by_organization_id", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .filter((q) => q.eq(q.field("isDefault"), true))
      .first();

    if (defaultChatbot) {
      return {
        chatbotId: defaultChatbot.chatbotId,
        chatbotName: defaultChatbot.name,
        greetMessage: defaultChatbot.greetMessage,
        customSystemPrompt: defaultChatbot.customSystemPrompt,
        aiAvatarEnabled: (defaultChatbot as any).aiAvatarEnabled ?? false,
        beyondPresenceAgentId: (defaultChatbot as any).beyondPresenceAgentId ?? undefined,
        appearance: await resolveAppearance(
          ctx,
          defaultChatbot.appearance as WidgetAppearance,
        ),
        defaultSuggestions: defaultChatbot.defaultSuggestions,
        vapiSettings: defaultChatbot.vapiSettings ?? {}, // ✅ FIX
      };
    }

    /* -----------------------------
       5. Fallback → widgetSettings
    ----------------------------- */
    const widgetSettings = widgetSettingsForSelection;

    if (!widgetSettings) {
      return null;
    }

    return {
      ...widgetSettings,
      vapiSettings: widgetSettings.vapiSettings ?? {}, // ✅ FIX
      appearance: await resolveAppearance(
        ctx,
        widgetSettings.appearance,
      ),
    };
  },
});

/* -------------------------------------------------
   HELPERS
------------------------------------------------- */
async function resolveAppearance(
  ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } },
  appearance?: WidgetAppearance,
): Promise<ResolvedWidgetAppearance> {
  if (!appearance || !appearance.logo) return appearance;

  const logo = await resolveLogo(ctx, appearance.logo);
  if (!logo) {
    const clone = { ...appearance } as Record<string, unknown>;
    delete clone.logo;
    return clone as ResolvedWidgetAppearance;
  }

  return {
    ...appearance,
    logo,
  };
}

async function resolveLogo(
  ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } },
  logo?: WidgetLogo,
): Promise<ResolvedWidgetLogo | undefined> {
  if (!logo) return undefined;

  if (logo.type === "upload" && logo.storageId) {
    const url = await ctx.storage.getUrl(logo.storageId);
    return url ? { ...logo, url } : undefined;
  }

  if (logo.type === "url") {
    return { ...logo, url: logo.externalUrl };
  }

  return logo;
}
