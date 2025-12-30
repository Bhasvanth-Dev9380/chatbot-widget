"use client";

import { WidgetView } from "@/modules/widget/ui/views/widget-view";
import { use, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

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
  searchParams: Promise<{
    organizationId: string;
    chatbotId?: string;
  }>
};

const Page = ({ searchParams }: Props) => {
  const { organizationId, chatbotId } = use(searchParams);
  const [isReady, setIsReady] = useState(false);
  const [appliedColor, setAppliedColor] = useState<string | null>(null);
  const [appliedLauncherIconUrl, setAppliedLauncherIconUrl] = useState<string | null>(null);

  const cacheSuffix = `${organizationId}-${chatbotId ?? "default"}`;
  const colorCacheKey = `widget-color-${cacheSuffix}`;
  const launcherIconCacheKey = `widget-launcher-icon-${cacheSuffix}`;

  // Pre-fetch appearance settings to apply color immediately
  const appearanceSettings = useQuery(
    api.public.widgetSettings.getChatbotSettings,
    organizationId
      ? {
          organizationId,
          ...(chatbotId ? { chatbotId } : {}),
        }
      : "skip"
  );

  useEffect(() => {
    setIsReady(false);
    setAppliedColor(null);
    setAppliedLauncherIconUrl(null);
  }, [organizationId, chatbotId]);

  // Apply cached color immediately on mount (before query returns)
  useEffect(() => {
    try {
      const cachedColor = localStorage.getItem(colorCacheKey);
      const cachedLauncherIconUrl = localStorage.getItem(launcherIconCacheKey);

      if (cachedColor) {
        const solid = deriveSolidPrimary(cachedColor);
        document.documentElement.style.setProperty("--primary", solid);
        document.documentElement.style.setProperty("--primary-bg", cachedColor);
        setAppliedColor(cachedColor);
      }

      if (cachedLauncherIconUrl) {
        setAppliedLauncherIconUrl(cachedLauncherIconUrl);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [colorCacheKey, launcherIconCacheKey]);

  // Apply primary color as soon as it's available AND cache it
  useEffect(() => {
    if (appearanceSettings?.appearance?.primaryColor) {
      const color = appearanceSettings.appearance.primaryColor;
      const solid = deriveSolidPrimary(color);
      document.documentElement.style.setProperty("--primary", solid);
      document.documentElement.style.setProperty("--primary-bg", color);
      setAppliedColor(color);

      // Cache in localStorage for instant load next time
      try {
        localStorage.setItem(colorCacheKey, color);
      } catch (e) {
        // Ignore localStorage errors
      }
    }
  }, [appearanceSettings?.appearance?.primaryColor, colorCacheKey]);

  useEffect(() => {
    const launcherIconUrl = appearanceSettings?.appearance?.logo?.url;
    if (launcherIconUrl === undefined) return;

    if (typeof launcherIconUrl === "string" && launcherIconUrl.trim().length > 0) {
      setAppliedLauncherIconUrl(launcherIconUrl);
      try {
        localStorage.setItem(launcherIconCacheKey, launcherIconUrl);
      } catch (e) {
        // Ignore localStorage errors
      }
    } else {
      setAppliedLauncherIconUrl(null);
      try {
        localStorage.removeItem(launcherIconCacheKey);
      } catch (e) {
        // Ignore localStorage errors
      }
    }
  }, [appearanceSettings?.appearance?.logo?.url, launcherIconCacheKey]);

  // Only render widget view when color is applied or we confirmed no custom color
  useEffect(() => {
    if (appliedColor || (appearanceSettings !== undefined && !appearanceSettings?.appearance?.primaryColor)) {
      setIsReady(true);
    }
  }, [appliedColor, appearanceSettings]);

  useEffect(() => {
    if (!organizationId) return;
    if (!appliedColor && !appliedLauncherIconUrl) return;

    window.parent.postMessage(
      {
        type: "updateAppearance",
        payload: {
          ...(appliedColor ? { primaryColor: appliedColor } : {}),
          ...(appliedLauncherIconUrl ? { launcherIconUrl: appliedLauncherIconUrl } : {}),
        },
      },
      "*"
    );
  }, [organizationId, chatbotId, appliedColor, appliedLauncherIconUrl]);

  // Show nothing briefly while we check for cached color
  if (!isReady && !appliedColor) {
    return <div className="flex h-full w-full items-center justify-center bg-muted" />;
  }

  return (
    <WidgetView organizationId={organizationId} chatbotId={chatbotId} />
  );
};

export default Page;