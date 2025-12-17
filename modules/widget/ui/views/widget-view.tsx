"use client";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { WidgetAuthScreen } from "@/modules/widget/ui/screens/widget-auth-screen";
import { screenAtom, widgetSettingsAtom } from "@/modules/widget/atoms/widget-atoms";
import { WidgetErrorScreen } from "../screens/widget-error-screen";
import { WidgetLoadingScreen } from "../screens/widget-loading-screen";
import { WidgetSelectionScreen } from "../screens/widget-selection-screen";
import { WidgetChatScreen } from "../screens/widget-chat-screen";
import { WidgetInboxScreen } from "../screens/widget-inbox-screen";
import { WidgetVoiceScreen } from "../screens/widget-voice-screen";
import { WidgetContactScreen } from "../screens/widget-contact-screen";


interface Props {
  organizationId: string;
  chatbotId?: string;
};

export const WidgetView = ({ organizationId, chatbotId }: Props) => {


  const screen = useAtomValue(screenAtom);
  const widgetSettings = useAtomValue(widgetSettingsAtom);

  // Apply custom primary color if set
  useEffect(() => {
    if (widgetSettings?.appearance?.primaryColor) {
      document.documentElement.style.setProperty('--primary', widgetSettings.appearance.primaryColor);
      // Also update the body background to prevent flash
      document.body.style.setProperty('--primary', widgetSettings.appearance.primaryColor);
    }
  }, [widgetSettings?.appearance?.primaryColor]);

  const screenComponents = {
    error: <WidgetErrorScreen />,
    loading: <WidgetLoadingScreen organizationId={organizationId} chatbotId={chatbotId} />,
    auth: <WidgetAuthScreen />,
      voice: <WidgetVoiceScreen />,
     inbox: <WidgetInboxScreen />,
    selection: <WidgetSelectionScreen />,
    chat: <WidgetChatScreen />,
      contact: <WidgetContactScreen />,
}



  return (
    <main className="flex h-full w-full flex-col overflow-hidden rounded-xl border bg-muted"> 
      {screenComponents[screen]}
      {/* <WidgetFooter /> */}
    </main>
  );
};
