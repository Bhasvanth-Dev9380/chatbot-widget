import Vapi from "@vapi-ai/web";
import { useEffect, useRef, useState } from "react";
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

  const threadIdRef = useRef<string | null>(threadId);
  const contactSessionIdRef = useRef<Id<"contactSessions"> | null>(contactSessionId);
  const vapiRef = useRef<Vapi | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    contactSessionIdRef.current = contactSessionId;
  }, [contactSessionId]);

  useEffect(() => {
    if (!vapiSecrets) return;

    const vapiInstance = new Vapi(vapiSecrets.publicApiKey);
    vapiRef.current = vapiInstance;

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

        // Persist to Convex in real-time.
        const currentThreadId = threadIdRef.current;
        const currentContactSessionId = contactSessionIdRef.current;
        if (currentThreadId && currentContactSessionId) {
          void createFromTranscript({
            threadId: currentThreadId,
            contactSessionId: currentContactSessionId,
            role: newTranscript.role,
            text: `[Voice] ${newTranscript.text}`,
          });
        }
      }
    });

    return () => {
      vapiInstance?.stop();
    };
  }, [vapiSecrets, createFromTranscript]);

  const startCall = () => {
    if (!vapiSecrets || !widgetSettings?.vapiSettings?.assistantId) {
      return;
    }
    setIsConnecting(true);

    if (vapiRef.current) {
      vapiRef.current.start(widgetSettings.vapiSettings.assistantId);
    }
  };

  const endCall = () => {
    if (vapiRef.current) {
      vapiRef.current.stop();
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
