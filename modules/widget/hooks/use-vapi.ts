import Vapi from "@vapi-ai/web";
import { useEffect, useState } from "react";
import { vapiSecretsAtom, widgetSettingsAtom } from "../atoms/widget-atoms";
import { useAtomValue } from "jotai";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
}

export const useVapi = (
  threadId: string | null,
  contactSessionId: Id<"contactSessions"> | null
) => {
  const vapiSecrets = useAtomValue(vapiSecretsAtom);
  const widgetSettings = useAtomValue(widgetSettingsAtom);

  const createFromTranscript = useAction(api.public.messages.createFromTranscript);

  const [vapi, setVapi] = useState<Vapi | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);

  useEffect(() => {
    if (!vapiSecrets) {
      return;
    }

    const vapiInstance = new Vapi(vapiSecrets.publicApiKey);
    setVapi(vapiInstance);

    vapiInstance.on("call-start", () => {
      setIsConnected(true);
      setIsConnecting(false);
      setTranscript([]);
    });

    vapiInstance.on("call-end", () => {
      setIsConnected(false);
      setIsConnecting(false);
      setIsSpeaking(false);
    });

    vapiInstance.on("speech-start", () => {
      setIsSpeaking(true);
    });

    vapiInstance.on("speech-end", () => {
      setIsSpeaking(false);
    });

    vapiInstance.on("error", (error) => {
      console.log(error, "VAPI_ERROR");
      setIsConnecting(false);
    });

    vapiInstance.on("message", (message) => {
      if (message.type === "transcript" && message.transcriptType === "final") {
        // Update local state for immediate UI feedback
        const newTranscript: TranscriptMessage = {
          role: message.role === "user" ? "user" : "assistant",
          text: message.transcript,
        };
        setTranscript((prev) => [...prev, newTranscript]);

        // Persist to Convex
        if (threadId && contactSessionId) {
          createFromTranscript({
            threadId,
            contactSessionId,
            role: newTranscript.role,
            text: `[Voice] ${newTranscript.text}`,
          });
        }
      }
    });

    return () => {
      vapiInstance?.stop();
    };
  }, [vapiSecrets, threadId, contactSessionId, createFromTranscript]);

  const startCall = () => {
    if (!vapiSecrets || !widgetSettings?.vapiSettings?.assistantId) {
      return;
    }
    setIsConnecting(true);

    if (vapi) {
      vapi.start(widgetSettings.vapiSettings.assistantId);
    }
  };

  const endCall = () => {
    if (vapi) {
      vapi.stop();
    }
  };

  return {
    isSpeaking,
    isConnected,
    isConnecting,
    startCall,
    endCall,
    transcript,
  };
};
