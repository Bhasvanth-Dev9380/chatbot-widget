"use client";
import { useState,useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {  LoaderIcon } from "lucide-react";
import { contactSessionIdAtomFamily, errorMessageAtom, 
  loadingMessageAtom, organizationIdAtom, screenAtom ,vapiSecretsAtom, widgetSettingsAtom } from "@/modules/widget/atoms/widget-atoms";
import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { api } from "../../../../convex/_generated/api";
import { useAction,useMutation, useQuery } from "convex/react";




type InitStep = "org" | "session" | "settings" | "vapi" | "done";


export const WidgetLoadingScreen = ({ organizationId }: { organizationId: string | null }
) => {
  const [step, setStep] = useState<InitStep>("org");
  const [sessionValid, setSessionValid] = useState(false);

  const loadingMessage = useAtomValue(loadingMessageAtom);
  const setWidgetSettings = useSetAtom(widgetSettingsAtom);
  const setErrorMessage = useSetAtom(errorMessageAtom);
  const setScreen = useSetAtom(screenAtom);
  const setLoadingMessage = useSetAtom(loadingMessageAtom);
  const setOrganizationId = useSetAtom(organizationIdAtom);

 const validateOrganizationResult = useQuery(
  api.public.organizations.validate,
  organizationId ? { organizationId } : "skip"
);

const setVapiSecrets = useSetAtom(vapiSecretsAtom);
  const contactSessionId = useAtomValue(contactSessionIdAtomFamily(organizationId || ""));




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
    const widgetSettings = useQuery(api.public.widgetSettings.getByOrganizationId, 
        organizationId ? {
          organizationId,
        } : "skip",
      );

      useEffect(() => {
        if (step !== "settings") {
          return;
        }

        setLoadingMessage("Loading widget settings...");

        if (widgetSettings !== undefined) {
          setWidgetSettings(widgetSettings);
         setStep("vapi");
        }
      }, [
        step,
        widgetSettings,
        setStep,
        setWidgetSettings,
        setLoadingMessage,

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
