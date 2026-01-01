"use client";

import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon, MessageSquareTextIcon,MicIcon, PhoneIcon, VideoIcon } from "lucide-react";
import { useSetAtom, useAtomValue } from "jotai";
import {chatbotIdAtom,contactSessionIdAtomFamily,organizationIdAtom,screenAtom,errorMessageAtom,conversationIdAtom, widgetSettingsAtom, hasVapiSecretsAtom, isVoiceConversationAtom} from"../../atoms/widget-atoms";
import {useMutation} from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useEffect, useState } from "react";
import { WidgetFooter } from "../components/widget-footer";

const PENDING_CONVERSATION_TYPE_KEY_PREFIX = "echo_widget_pending_conversation_type:";

function setPendingConversationType(conversationId: string, type: "video" | "voice") {
  try {
    localStorage.setItem(`${PENDING_CONVERSATION_TYPE_KEY_PREFIX}${conversationId}`, type);
  } catch {
    // ignore
  }
}

export const WidgetSelectionScreen = () => {

  const setScreen = useSetAtom(screenAtom);
  const setErrorMessage = useSetAtom(errorMessageAtom);
  const setIsVoiceConversation = useSetAtom(isVoiceConversationAtom);

  const widgetSettings =useAtomValue(widgetSettingsAtom);
  const hasVapiSecrets =useAtomValue(hasVapiSecretsAtom);

  const hasAvatar = Boolean(
    widgetSettings?.aiAvatarEnabled && widgetSettings?.beyondPresenceAgentId,
  );

  const setConversationId = useSetAtom(conversationIdAtom);
  const organizationId = useAtomValue(organizationIdAtom);
  const chatbotId = useAtomValue(chatbotIdAtom);
  const contactSessionId = useAtomValue(
    contactSessionIdAtomFamily(organizationId || "")
  );

  const createConversation = useMutation(api.public.conversations.create);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    const size = widgetSettings?.appearance?.size ?? "medium";
    window.parent.postMessage(
      {
        type: "updateAppearance",
        payload: { size },
      },
      "*",
    );
  }, [widgetSettings?.appearance?.size]);

  const handleNewVideoConversation = async () => {
    if (!organizationId) {
      setScreen("error");
      setErrorMessage("Organization ID is missing");
      return;
    }

    if (!contactSessionId) {
      setScreen("auth");
      return;
    }

    setIsPending(true);

    try {
      const conversationId = await (createConversation as any)({
        contactSessionId,
        organizationId,
        chatbotId: chatbotId || undefined,
        kind: "video",
        isTranscriptPending: true,
      });
      setConversationId(conversationId);
      setPendingConversationType(String(conversationId), "video");
      setScreen("avatar");
    } catch {
      setScreen("auth");
    } finally {
      setIsPending(false);
    }
  };


  const handleNewVoiceConversation = async () => {
    if (!organizationId) {
      setScreen("error");
      setErrorMessage("Organization ID is missing");
      return;
    }

    if (!contactSessionId) {
      setScreen("auth");
      return;
    }

    try {
      setConversationId(null);
      setScreen("voice");
    } catch {
      setScreen("auth");
    }
  };

  const handleNewConversation = async () => {

     if (!organizationId) {
      setScreen("error");
      setErrorMessage("Organization ID is missing");
      return;
    }



    if (!contactSessionId) {
      setScreen("auth");
      return;
    }

    setIsPending(true);

    try {
      const conversationId = await createConversation({
        contactSessionId,
        organizationId,
        chatbotId: chatbotId || undefined,
      });
      setConversationId(conversationId);
      setIsVoiceConversation(false);
      setScreen("chat");
    } catch {
      setScreen("auth");
    } finally {
      setIsPending(false);
    }
   
};




  return (
    <>
      <WidgetHeader>
        <div className="flex flex-col gap-y-0.5">
          <p className="text-lg font-semibold leading-tight">Hi there! 👋</p>
          <p className="text-sm opacity-80 leading-tight">Let&apos;s get you started</p>
        </div>
      </WidgetHeader>
      <div className="flex flex-1 flex-col  gap-y-4 p-4 overflow-y-auto">
        <Button
          className="h-16 w-full justify-between"
          variant="outline"
          onClick={handleNewConversation}
          disabled={isPending}

          
        
        >
          <div className="flex items-center gap-x-2">
            <MessageSquareTextIcon className="size-4" />
            <span>Start chat</span>
          </div>
          <ChevronRightIcon />
        </Button>

        {hasAvatar && (
          <Button
            className="h-16 w-full justify-between"
            variant="outline"
            onClick={handleNewVideoConversation}
            disabled={isPending}
          >
            <div className="flex items-center gap-x-2">
              <VideoIcon className="size-4" />
              <span>Start Video Call</span>
            </div>
            <ChevronRightIcon />
          </Button>
        )}
  {hasVapiSecrets && widgetSettings?.vapiSettings?.assistantId && (
        <Button
          className="h-16 w-full justify-between"
          variant="outline"
          onClick={handleNewVoiceConversation}
          disabled={isPending}



        >
          <div className="flex items-center gap-x-2">
            <MicIcon className="size-4" />
            <span>Start Voice Call</span>
          </div>
          <ChevronRightIcon />
        </Button>
        )}
        {hasVapiSecrets && widgetSettings?.vapiSettings?.phoneNumber && (
        <Button
          className="h-16 w-full justify-between"
          variant="outline"
          onClick={() => setScreen("contact")}
          disabled={isPending}



        >
          <div className="flex items-center gap-x-2">
            <PhoneIcon className="size-4" />
            <span>Call us</span>
          </div>
          <ChevronRightIcon />
        </Button>
        )}
        
      </div>
      <WidgetFooter/>

      
    </>
  )
}
