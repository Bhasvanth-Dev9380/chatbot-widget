"use client";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { WidgetAuthScreen } from "@/modules/widget/ui/screens/widget-auth-screen";
import { screenAtom, widgetSettingsAtom } from "@/modules/widget/atoms/widget-atoms";
import { WidgetErrorScreen } from "../screens/widget-error-screen";
import { WidgetLoadingScreen } from "../screens/widget-loading-screen";
import { WidgetSelectionScreen } from "../screens/widget-selection-screen";
import { WidgetChatScreen } from "../screens/widget-chat-screen";
import { WidgetInboxScreen } from "../screens/widget-inbox-screen";
import { WidgetVoiceScreen } from "../screens/widget-voice-screen";
import { WidgetContactScreen } from "../screens/widget-contact-screen";
import { WidgetAvatarScreen } from "../screens/widget-avatar-screen";
import { PoweredByFooter } from "../components/powered-by-footer";
import { WIDGET_SCREENS } from "@/modules/widget/constants";

const normalizeHex = (hex: string) => {
  const h = hex.trim();
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return null;
  if (h.length === 4) return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
};

const deriveSolidPrimary = (primary: string) => {
  const hexes = primary.match(/#(?:[0-9a-fA-F]{3}){1,2}/g);
  const last = hexes && hexes.length > 0 ? hexes[hexes.length - 1] : null;
  return normalizeHex(last ?? "") ?? "#E08A3A";
};

interface Props {
  organizationId: string;
  chatbotId?: string;
};

export const WidgetView = ({ organizationId, chatbotId }: Props) => {

  const screen = useAtomValue(screenAtom);
  const setScreen = useSetAtom(screenAtom);
  const widgetSettings = useAtomValue(widgetSettingsAtom);

  const [previewPrimaryColor, setPreviewPrimaryColor] = useState<string | null>(null);

  const appearanceCacheKey = `echo_widget_appearance_cache:${organizationId}:${chatbotId ?? ""}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(appearanceCacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;

      window.parent.postMessage(
        {
          type: "updateAppearance",
          payload: {
            primaryColor: typeof parsed.primaryColor === "string" ? parsed.primaryColor : undefined,
            size: typeof parsed.size === "string" ? parsed.size : undefined,
            launcherIconUrl:
              parsed.launcherIconUrl === null || typeof parsed.launcherIconUrl === "string"
                ? parsed.launcherIconUrl
                : undefined,
          },
        },
        "*",
      );
    } catch {
      // ignore
    }
  }, [appearanceCacheKey]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = (event as any)?.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "previewAppearance") {
        const next = data?.payload?.primaryColor;
        setPreviewPrimaryColor(typeof next === "string" ? next : null);
      }

      if (data.type === "setScreen") {
        const next = data?.payload?.screen;
        if (typeof next !== "string") return;
        if (!(WIDGET_SCREENS as readonly string[]).includes(next)) return;
        setScreen(next as any);
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Apply custom primary color if set
  useEffect(() => {
    const existingPrimaryBg =
      typeof document !== "undefined"
        ? document.documentElement.style.getPropertyValue("--primary-bg").trim() || null
        : null;

    const existingPrimarySolid =
      typeof document !== "undefined"
        ? document.documentElement.style.getPropertyValue("--primary").trim() || null
        : null;

    const previewColor =
      typeof previewPrimaryColor === "string" && previewPrimaryColor.trim().length > 0
        ? previewPrimaryColor.trim()
        : null;

    const savedColor =
      typeof widgetSettings?.appearance?.primaryColor === "string" &&
      widgetSettings.appearance.primaryColor.trim().length > 0
        ? widgetSettings.appearance.primaryColor.trim()
        : null;

    const color =
      previewColor ??
      savedColor ??
      existingPrimaryBg ??
      existingPrimarySolid;

    const launcherIconUrl =
      widgetSettings?.appearance?.logo?.url !== undefined
        ? widgetSettings.appearance.logo.url
        : undefined;

    const size = widgetSettings?.appearance?.size;

    if (color) {
      const solid = deriveSolidPrimary(color);
      document.documentElement.style.setProperty("--primary", solid);
      document.body.style.setProperty("--primary", solid);
      document.documentElement.style.setProperty("--primary-bg", color);
      document.body.style.setProperty("--primary-bg", color);
    } else if (!existingPrimaryBg && !existingPrimarySolid) {
      document.documentElement.style.removeProperty("--primary");
      document.body.style.removeProperty("--primary");
      document.documentElement.style.removeProperty("--primary-bg");
      document.body.style.removeProperty("--primary-bg");
    }

    // Keep the launcher button in sync even when collapsing/re-opening.
    // The embed script restores the button color from its internal state on close.
    if (!color) return;

    window.parent.postMessage(
      {
        type: "updateAppearance",
        payload: {
          primaryColor: color,
          ...(size !== undefined ? { size } : {}),
          ...(launcherIconUrl !== undefined ? { launcherIconUrl } : {}),
        },
      },
      "*",
    );

    try {
      localStorage.setItem(
        appearanceCacheKey,
        JSON.stringify({
          primaryColor: color,
          size,
          launcherIconUrl: launcherIconUrl ?? null,
        }),
      );
    } catch {
      // ignore
    }
  }, [previewPrimaryColor, widgetSettings?.appearance?.primaryColor, widgetSettings?.appearance?.size]);

  const screenComponents = {
    error: <WidgetErrorScreen />,
    loading: <WidgetLoadingScreen organizationId={organizationId} chatbotId={chatbotId} />,
    auth: <WidgetAuthScreen />,
      voice: <WidgetVoiceScreen />,
      avatar: <WidgetAvatarScreen />,
     inbox: <WidgetInboxScreen />,
    selection: <WidgetSelectionScreen />,
    chat: <WidgetChatScreen />,
      contact: <WidgetContactScreen />,
}



  return (
    <main className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-muted"> 
      {screenComponents[screen]}
      <PoweredByFooter />
    </main>
  );
};
