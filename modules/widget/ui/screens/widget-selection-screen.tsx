"use client";

import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon, MessageSquareTextIcon,MicIcon, PhoneIcon } from "lucide-react";
import { useSetAtom, useAtomValue } from "jotai";
import {chatbotIdAtom,contactSessionIdAtomFamily,organizationIdAtom,screenAtom,errorMessageAtom,conversationIdAtom, widgetSettingsAtom, hasVapiSecretsAtom, isVoiceConversationAtom} from"../../atoms/widget-atoms";
import {useMutation} from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState } from "react";
import { WidgetFooter } from "../components/widget-footer";

export const WidgetSelectionScreen = () => {

  const setScreen = useSetAtom(screenAtom);
  const setErrorMessage = useSetAtom(errorMessageAtom);
  const setIsVoiceConversation = useSetAtom(isVoiceConversationAtom);

  const widgetSettings =useAtomValue(widgetSettingsAtom);
  const hasVapiSecrets =useAtomValue(hasVapiSecretsAtom);

  const setConversationId = useSetAtom(conversationIdAtom);
  const organizationId = useAtomValue(organizationIdAtom);
  const chatbotId = useAtomValue(chatbotIdAtom);
  const contactSessionId = useAtomValue(
    contactSessionIdAtomFamily(organizationId || "")
  );

  const createConversation = useMutation(api.public.conversations.create);
  const [isPending, setIsPending] = useState(false);


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

    setIsPending(true);

    try {
      const conversationId = await createConversation({
        contactSessionId,
        organizationId,
        chatbotId: chatbotId || undefined,
      });
      setConversationId(conversationId);
      setScreen("voice");
    } catch {
      setScreen("auth");
    } finally {
      setIsPending(false);
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
        <div className="flex flex-col justify-between gap-y-2 px-2 py-6 font-semibold">
            <p className="text-3xl">
                Hi there! 👋
            </p>
            <p className="text-lg ">
                Let&apos;s get you started
            </p>

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
