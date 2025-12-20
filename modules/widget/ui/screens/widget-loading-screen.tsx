"use client";
import { useState,useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {  LoaderIcon } from "lucide-react";
import { chatbotIdAtom, contactSessionIdAtomFamily, errorMessageAtom, 
  loadingMessageAtom, organizationIdAtom, screenAtom ,vapiSecretsAtom, widgetSettingsAtom, type WidgetSettings } from "@/modules/widget/atoms/widget-atoms";
import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { api } from "../../../../convex/_generated/api";
import { useAction,useMutation, useQuery } from "convex/react";




type InitStep = "org" | "session" | "settings" | "vapi" | "done";


export const WidgetLoadingScreen = ({ organizationId, chatbotId }: { organizationId: string | null, chatbotId?: string | null }
) => {
  const [step, setStep] = useState<InitStep>("org");
  const [sessionValid, setSessionValid] = useState(false);

  console.log('[WidgetLoadingScreen] Received props:', { organizationId, chatbotId });

  const loadingMessage = useAtomValue(loadingMessageAtom);
  const setWidgetSettings = useSetAtom(widgetSettingsAtom);
  const setErrorMessage = useSetAtom(errorMessageAtom);
  const setScreen = useSetAtom(screenAtom);
  const setLoadingMessage = useSetAtom(loadingMessageAtom);
  const setOrganizationId = useSetAtom(organizationIdAtom);
  const setChatbotId = useSetAtom(chatbotIdAtom);

 const validateOrganizationResult = useQuery(
  api.public.organizations.validate,
  organizationId ? { organizationId } : "skip"
);

const setVapiSecrets = useSetAtom(vapiSecretsAtom);
  const contactSessionId = useAtomValue(contactSessionIdAtomFamily(organizationId || ""));

  // Fetch widget settings immediately for appearance
  const widgetSettings = useQuery(
    api.public.widgetSettings.getChatbotSettings,
    organizationId
      ? {
          organizationId,
          ...(chatbotId ? { chatbotId } : {}),
        }
      : "skip"
  );

  // Apply custom color as soon as settings are available
  useEffect(() => {
    if (widgetSettings?.appearance?.primaryColor) {
      document.documentElement.style.setProperty('--primary', widgetSettings.appearance.primaryColor);
    }
    // Also set the widget settings atom early for the header to use
    if (widgetSettings && step === "org") {
      setWidgetSettings(toWidgetSettings(widgetSettings));
    }
  }, [widgetSettings?.appearance?.primaryColor, widgetSettings, step, setWidgetSettings]);


  useEffect(() => {
  if (step !== "org") return;

  setLoadingMessage("Finding organization...");

  if (!organizationId) {
    setErrorMessage("Organization ID is required");
    setScreen("error");
    return;
  }

  // query is running
  if (validateOrganizationResult === undefined) {
    setLoadingMessage("Verifying organization...");
    return;
  }

  // query finished
  if (validateOrganizationResult.valid) {
    setOrganizationId(organizationId);
    if (chatbotId) {
      console.log('[WidgetLoadingScreen] Setting chatbotId from URL:', chatbotId);
      setChatbotId(chatbotId);
    } else {
      console.log('[WidgetLoadingScreen] No chatbotId from URL');
    }
    setStep("session");
  } else {
    setErrorMessage(
      validateOrganizationResult.reason || "Invalid configuration"
    );
    setScreen("error");
  }
}, [
  step,
  organizationId,
  validateOrganizationResult,
  setErrorMessage,
  setScreen,
  setOrganizationId,
  setLoadingMessage,
  chatbotId,
  setChatbotId,
]);


  const validateContactSession = useMutation(api.public.contactSessions.validate);

    useEffect(() => {
      if (step !== "session") {
        return;
      }
    setLoadingMessage("Finding contact session ID...");


      if (!contactSessionId) {
        setSessionValid(false);
        setStep("settings");
        return;
      }
      setLoadingMessage("Validating session...");

      validateContactSession({contactSessionId})
        .then((result) => {
          setSessionValid(result.valid);
          setStep("settings");
        })
        .catch(() => {
          setSessionValid(false);
          setStep("settings");
        })





    }, [step, contactSessionId, validateContactSession, setLoadingMessage]);

    //step 3

      useEffect(() => {
        if (step !== "settings") {
          return;
        }

        setLoadingMessage("Loading chatbot settings...");

        if (widgetSettings !== undefined) {
          if (widgetSettings === null) {
            setErrorMessage("Chatbot not found or no longer available");
            setScreen("error");
            return;
          }
          const settings = toWidgetSettings(widgetSettings);
          setWidgetSettings(settings);

          console.log('[WidgetLoadingScreen] Got widgetSettings, chatbotId in settings:', (widgetSettings as any)?.chatbotId);
          console.log('[WidgetLoadingScreen] Current chatbotId from URL prop:', chatbotId);

          // Store chatbotId if it exists in the settings (and wasn't already set from URL)
          if ((widgetSettings as any)?.chatbotId && !chatbotId) {
            console.log('[WidgetLoadingScreen] Overriding with settings chatbotId:', (widgetSettings as any).chatbotId);
            setChatbotId((widgetSettings as any).chatbotId);
          }

          // Send appearance settings to parent window (embed script)
          const appearance = widgetSettings?.appearance;
          if (appearance) {
            window.parent.postMessage(
              {
                type: 'updateAppearance',
                payload: {
                  primaryColor: appearance?.primaryColor,
                  size: appearance?.size || 'medium',
                  launcherIconUrl: appearance?.logo?.url ?? null,
                },
              },
              '*'
            );
          }

          setStep("vapi");
        }
      }, [
        step,
        widgetSettings,
        setStep,
        setWidgetSettings,
        setLoadingMessage,
        setChatbotId,
        chatbotId,
      ]);


      //step4
      const getVapiSecrets = useAction(api.public.secrets.getVapiSecrets);

      useEffect(() => {
        if (step !== "vapi") {
          return;
        }

        if (!organizationId) {
          setErrorMessage("Organization ID is required");
          setScreen("error");
          return;
        }

        setLoadingMessage("Loading voice features...");
        getVapiSecrets({ organizationId })
            .then((secrets) =>{
              setVapiSecrets(secrets);
              setStep("done");
            })
            .catch(() => {
              setVapiSecrets(null);
              setStep("done");

            })
      }, [
        step,
        organizationId,
        getVapiSecrets,
        setVapiSecrets,
        setLoadingMessage,
        setStep,

      ]);


      

    useEffect(() => {
      if (step !== "done") {
        return;
      }

      const hasValidSession = contactSessionId && sessionValid;
      setScreen(hasValidSession ? "selection" : "auth");
    }, [step, contactSessionId, sessionValid, setScreen]);





   



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
      <div className="flex flex-1 flex-col items-center justify-center gap-y-4 p-4 text-muted-foreground">
        <LoaderIcon className="animate-spin"/>
        <p className="text-sm">
            {loadingMessage || "Loading..."}
        </p>
      </div>

      
    </>
  );
};

function toWidgetSettings(settings: any): WidgetSettings {
  if (!settings) {
    return {
      chatbotName: "Support Assistant",
      greetMessage: "Hi! How can I help you?",
      defaultSuggestions: {},
      vapiSettings: {},
    };
  }

  return {
    chatbotId: settings.chatbotId ?? undefined,
    chatbotName: settings.chatbotName ?? "Support Assistant",
    greetMessage: settings.greetMessage ?? "Hi! How can I help you?",
    customSystemPrompt: settings.customSystemPrompt ?? undefined,
    appearance: settings.appearance ?? undefined,
    defaultSuggestions: {
      suggestion1: settings.defaultSuggestions?.suggestion1 ?? undefined,
      suggestion2: settings.defaultSuggestions?.suggestion2 ?? undefined,
      suggestion3: settings.defaultSuggestions?.suggestion3 ?? undefined,
    },
    vapiSettings: {
      assistantId: settings.vapiSettings?.assistantId ?? undefined,
      phoneNumber: settings.vapiSettings?.phoneNumber ?? undefined,
    },
  };
}
