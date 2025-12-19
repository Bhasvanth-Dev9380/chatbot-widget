"use client";

import { WidgetView } from "@/modules/widget/ui/views/widget-view";
import { use, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

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

  // Apply cached color immediately on mount (before query returns)
  useEffect(() => {
    try {
      const cachedColor = localStorage.getItem(`widget-color-${organizationId}`);
      if (cachedColor) {
        document.documentElement.style.setProperty('--primary', cachedColor);
        setAppliedColor(cachedColor);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [organizationId]);

  // Apply primary color as soon as it's available AND cache it
  useEffect(() => {
    if (appearanceSettings?.appearance?.primaryColor) {
      const color = appearanceSettings.appearance.primaryColor;
      document.documentElement.style.setProperty('--primary', color);
      setAppliedColor(color);
      // Cache in localStorage for instant load next time
      try {
        localStorage.setItem(`widget-color-${organizationId}`, color);
      } catch (e) {
        // Ignore localStorage errors
      }
    }
  }, [appearanceSettings?.appearance?.primaryColor, organizationId]);

  // Only render widget view when color is applied or we confirmed no custom color
  useEffect(() => {
    if (appliedColor || (appearanceSettings !== undefined && !appearanceSettings?.appearance?.primaryColor)) {
      setIsReady(true);
    }
  }, [appliedColor, appearanceSettings]);

  // Show nothing briefly while we check for cached color
  if (!isReady && !appliedColor) {
    return <div className="flex h-full w-full items-center justify-center bg-muted" />;
  }

  return (
    <WidgetView organizationId={organizationId} chatbotId={chatbotId} />
  );
};

export default Page;