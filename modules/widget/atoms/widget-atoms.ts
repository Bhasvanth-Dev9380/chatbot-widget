import { atom } from "jotai";
import { WidgetScreen } from "@/modules/widget/types";
import { atomFamily, atomWithStorage } from "jotai/utils";
import { CONTACT_SESSION_KEY } from "../constants";
import { Id } from "../../../convex/_generated/dataModel";

export type WidgetLogo = {
  type: "default" | "upload" | "url";
  storageId?: Id<"_storage">;
  externalUrl?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  url?: string | null;
  updatedAt: number;
};

export type WidgetAppearance = {
  primaryColor?: string;
  size?: "small" | "medium" | "large";
  logo?: WidgetLogo;
};

export type WidgetSettings = {
  chatbotId?: string;
  chatbotName: string;
  greetMessage: string;
  customSystemPrompt?: string;
  aiAvatarEnabled?: boolean;
  beyondPresenceAgentId?: string;
  appearance?: WidgetAppearance;
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

// Basic widget state atoms
export const screenAtom = atom<WidgetScreen>("loading");
export const isVoiceConversationAtom = atom(false);
export const errorMessageAtom = atom<string | null>(null);
export const loadingMessageAtom = atom<string | null>(null);
export const organizationIdAtom = atom<string | null>(null);
export const chatbotIdAtom = atom<string | null>(null);
export const contactSessionIdAtomFamily = atomFamily((organizationId: string) => {
     return atomWithStorage<Id<"contactSessions"> | null>(`${CONTACT_SESSION_KEY}_${organizationId}`,
        null)
});


export const conversationIdAtom = atom<Id<"conversations"> | null>(null);
export const widgetSettingsAtom = atom<WidgetSettings | null>(null);
export const vapiSecretsAtom = atom<{
  publicApiKey: string;
} | null>(null);
export const hasVapiSecretsAtom = atom((get) => get(vapiSecretsAtom) !== null);

export const beyondPresenceConfigAtom = atom<{
  avatarId: string;
  baseUrl: string;
} | null>(null);
