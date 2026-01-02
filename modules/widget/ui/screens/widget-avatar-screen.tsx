"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useAtomValue, useSetAtom, useAtom } from "jotai";
import { Button } from "@/components/ui/button";
import {
  widgetSettingsAtom,
  screenAtom,
  organizationIdAtom,
  contactSessionIdAtomFamily,
  videoCallLanguageAtomFamily,
} from "@/modules/widget/atoms/widget-atoms";
import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import { useAction } from "convex/react";

export const WidgetAvatarScreen = () => {
  const setScreen = useSetAtom(screenAtom);
  const widgetSettings = useAtomValue(widgetSettingsAtom);

  const organizationId = useAtomValue(organizationIdAtom);
  const contactSessionId = useAtomValue(
    contactSessionIdAtomFamily(organizationId || ""),
  );

  const contactSessionKey = contactSessionId ? String(contactSessionId) : "";
  const [videoCallLanguage] = useAtom(
    videoCallLanguageAtomFamily(contactSessionKey || "no_session"),
  );

  const selectedLanguage = useMemo(() => videoCallLanguage ?? "en", [videoCallLanguage]);
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(null);
  const resolveLanguageAgent = useAction(
    (api as any).public.beyondPresence.getOrCreateLanguageAgent,
  );

  const baseAgentId = widgetSettings?.beyondPresenceAgentId;
  const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!organizationId || !baseAgentId) {
        setResolvedAgentId(null);
        return;
      }

      try {
        const result = await resolveLanguageAgent({
          organizationId,
          baseAgentId,
          language: selectedLanguage,
        });

        if (!cancelled) {
          setResolvedAgentId(result?.agentId ?? baseAgentId);
        }
      } catch {
        if (!cancelled) {
          setResolvedAgentId(baseAgentId);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [organizationId, baseAgentId, selectedLanguage, resolveLanguageAgent]);

  const agentIdToUse = resolvedAgentId ?? baseAgentId ?? null;

  useEffect(() => {
    const size = widgetSettings?.appearance?.size ?? "medium";

    const configured =
      size === "small"
        ? { width: 368, height: 460 }
        : size === "large"
          ? { width: 468, height: 560 }
          : { width: 418, height: 510 };

    const videoTarget = {
      width: Math.max(configured.width, 512),
      height: Math.max(configured.height,700),
    };

    window.parent.postMessage(
      {
        type: "resize",
        payload: videoTarget,
      },
      "*",
    );

    return () => {
      window.parent.postMessage(
        {
          type: "resize",
          payload: configured,
        },
        "*",
      );
    };
  }, [widgetSettings?.appearance?.size]);

  return (
    <>
      <WidgetHeader>
        <div className="flex items-center gap-x-2">
          <Button
            variant="transparent"
            size="icon"
            onClick={() => setScreen("selection")}
          >
            <ArrowLeftIcon />
          </Button>
          <p>AI Avatar</p>
          <span className="text-xs opacity-80">({selectedLanguage})</span>
        </div>
      </WidgetHeader>

      {!agentIdToUse ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          AI Avatar is not configured.
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          {!isSecureContext && (
            <div className="border-b bg-background p-3 text-xs text-muted-foreground">
              AI Avatar requires HTTPS to access camera/microphone. Open the widget on a secure origin.
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-b bg-background p-3">
            <p className="text-xs text-muted-foreground">
              If you don’t get a camera/mic prompt inside the widget, open the avatar in a new tab.
            </p>
            <Button asChild size="sm" variant="outline">
              <a
                href={`https://bey.chat/${agentIdToUse}`}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            </Button>
          </div>

          <iframe
            title="AI Avatar"
            src={`https://bey.chat/${agentIdToUse}`}
            className="h-full w-full flex-1 border-0"
            allow="camera; microphone; fullscreen"
            allowFullScreen
          />
        </div>
      )}
    </>
  );
};
