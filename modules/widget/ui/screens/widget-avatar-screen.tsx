"use client";

import { ArrowLeftIcon } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { Button } from "@/components/ui/button";
import { widgetSettingsAtom, screenAtom } from "@/modules/widget/atoms/widget-atoms";
import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { useEffect } from "react";

export const WidgetAvatarScreen = () => {
  const setScreen = useSetAtom(screenAtom);
  const widgetSettings = useAtomValue(widgetSettingsAtom);

  const agentId = widgetSettings?.beyondPresenceAgentId;
  const isSecureContext = typeof window !== "undefined" ? window.isSecureContext : true;

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
        </div>
      </WidgetHeader>

      {!agentId ? (
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
                href={`https://bey.chat/${agentId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            </Button>
          </div>

          <iframe
            title="AI Avatar"
            src={`https://bey.chat/${agentId}`}
            className="h-full w-full flex-1 border-0"
            allow="camera; microphone; fullscreen"
            allowFullScreen
          />
        </div>
      )}
    </>
  );
};
