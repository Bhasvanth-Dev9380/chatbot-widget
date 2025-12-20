"use client";

import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MenuIcon } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  conversationIdAtom,
  organizationIdAtom,
  contactSessionIdAtomFamily,
  screenAtom,
  isVoiceConversationAtom,
  widgetSettingsAtom,
} from "../../atoms/widget-atoms";
import { api } from "../../../../convex/_generated/api";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  AIConversation,
  AIConversationContent,
} from "@/components/ai/conversation";
import { useAction, useQuery } from "convex/react";
import { Form, FormField } from "@/components/ui/form";
import {
  AIInput,
  AIInputSubmit,
  AIInputTextarea,
  AIInputToolbar,
  AIInputTools,
} from "@/components/ai/input";
import { AIMessage, AIMessageContent } from "@/components/ai/message";
import { AIResponse } from "@/components/ai/response";
import { AISuggestions, AISuggestion } from "@/components/ai/suggestion";

import { useForm } from "react-hook-form";
import { toUIMessages, useThreadMessages } from "@convex-dev/agent/react";
import { InfiniteScrollTrigger } from "@/components/infinite-scroll-trigger";
import { useInfiniteScroll } from "../../hooks/use-infinite-scroll";
import { DicebearAvatar } from "@/components/dicebear-avatar";
import { TypingIndicator } from "@/components/ai/typing-indicator";

import { useEffect, useMemo, useRef, useState } from "react";

// Optimistic message with client-side ID
type OptimisticMessage = {
  id: string;
  content: string;
};

// Typing states
type TypingState = "idle" | "waiting_for_assistant";

const schema = z.object({
  message: z.string().min(1, "Please enter a message"),
});

export const WidgetChatScreen = () => {
  const setScreen = useSetAtom(screenAtom);
  const setConversationId = useSetAtom(conversationIdAtom);
  const setIsVoiceConversation = useSetAtom(isVoiceConversationAtom);

  const widgetSettings = useAtomValue(widgetSettingsAtom);
  const assistantLogoUrl = widgetSettings?.appearance?.logo?.url;

  const conversationId = useAtomValue(conversationIdAtom);
  const organizationId = useAtomValue(organizationIdAtom);
  const isVoiceConversation = useAtomValue(isVoiceConversationAtom);
  const contactSessionId = useAtomValue(
    contactSessionIdAtomFamily(organizationId || "")
  );

  const [optimisticMessage, setOptimisticMessage] = useState<OptimisticMessage | null>(null);
  const [typingState, setTypingState] = useState<TypingState>("idle");
  const lastAssistantMessageIdRef = useRef<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const conversation = useQuery(
    api.public.conversations.getOne,
    conversationId && contactSessionId
      ? { conversationId, contactSessionId }
      : "skip"
  );

  const messages = useThreadMessages(
    api.public.messages.getMany,
    conversation?.threadId && contactSessionId
      ? { threadId: conversation.threadId, contactSessionId }
      : "skip",
    { initialNumItems: 10 }
  );

  const { topElementRef, handleLoadMore, canLoadMore, isLoadingMore } =
    useInfiniteScroll({
      status: messages.status,
      loadMore: messages.loadMore,
      loadSize: 10,
    });

  const createMessage = useAction(api.public.messages.create);

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { message: "" },
  });

  const uiMessages = useMemo(() => {
    return toUIMessages(messages.results ?? []).filter((m) => {
      const text = typeof m === "string" ? m : (m.text ?? "");
      return text.trim().length > 0;
    });
  }, [messages.results]);

  // 🔒 DETERMINISTIC TYPING LIFECYCLE STATE MACHINE
  useEffect(() => {
    if (!uiMessages.length) return;

    const last = uiMessages[uiMessages.length - 1];
    const lastText = typeof last === "string" ? last : (last.text ?? "");

    // Remove optimistic message when server confirms user message
    if (
      optimisticMessage &&
      typeof last !== "string" &&
      last.role === "user" &&
      lastText.trim() === optimisticMessage.content.trim()
    ) {
      setOptimisticMessage(null);
    }

    // Stop typing ONLY when assistant responds with actual content
    if (typeof last !== "string" && last.role === "assistant" && lastText.trim().length > 0) {
      const lastId = (last.id || last.key) ?? "";

      // Only transition if this is a NEW assistant message
      if (lastId !== lastAssistantMessageIdRef.current) {
        lastAssistantMessageIdRef.current = lastId;
        setTypingState("idle");
        setOptimisticMessage(null);

        // Re-focus input after assistant response
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    }
  }, [uiMessages, optimisticMessage]);

  const onSubmit = async ({ message }: z.infer<typeof schema>) => {
    if (
  !conversation ||
  !contactSessionId ||
  typingState !== "idle" ||
  conversation.status === "resolved"
) return;

    const isEscalated = conversation.status === "escalated";


    // Generate client-side ID for optimistic message
    const optimisticId = crypto.randomUUID();

    // Set optimistic message and start typing
    setOptimisticMessage({ id: optimisticId, content: message });

if (!isEscalated) {
  setTypingState("waiting_for_assistant");
}

form.reset();


    try {
      await createMessage({
        threadId: conversation.threadId,
        prompt: message,
        contactSessionId,
      });
    } catch (error) {
      // Fail-safe: reset state on error
      console.error("Message creation failed:", error);
      setTypingState("idle");
      setOptimisticMessage(null);
    }
  };

  const suggestions = useMemo(() => {
    if (!widgetSettings) return [];
    return Object.values(widgetSettings.defaultSuggestions).filter(Boolean);
  }, [widgetSettings]);

  return (
    <>
      <WidgetHeader>
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="transparent"
              onClick={() => {
                setConversationId(null);
                setIsVoiceConversation(false);
                setScreen("selection");
              }}
            >
              <ArrowLeft />
            </Button>
            <DicebearAvatar
              imageUrl={assistantLogoUrl ?? undefined}
              seed={widgetSettings?.chatbotName || "assistant"}
              size={32}
            />
            <span>{widgetSettings?.chatbotName || "Assistant"}</span>
          </div>
          <Button size="icon" variant="transparent">
            <MenuIcon />
          </Button>
        </div>
      </WidgetHeader>

      <AIConversation>
        <AIConversationContent>
          <InfiniteScrollTrigger
            ref={topElementRef}
            canLoadMore={canLoadMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
          />

          {uiMessages.map((m) => {
            if (typeof m === "string") return null;

            const text = m.text ?? "";

            // Hide server user message if optimistic is showing
            if (
              optimisticMessage &&
              m.role === "user" &&
              text.trim() === optimisticMessage.content.trim()
            ) {
              return null;
            }

            return (
              <AIMessage
                key={(m.id || m.key) ?? crypto.randomUUID()}
                from={m.role === "user" ? "user" : "assistant"}
              >
                <AIMessageContent>
                  <AIResponse>{text}</AIResponse>
                </AIMessageContent>
                {m.role === "assistant" && (
                  <DicebearAvatar
                    imageUrl={assistantLogoUrl ?? undefined}
                    seed={widgetSettings?.chatbotName || "assistant"}
                    size={32}
                  />
                )}
              </AIMessage>
            );
          })}

          {optimisticMessage && (
            <AIMessage key={optimisticMessage.id} from="user">
              <AIMessageContent>
                <AIResponse>{optimisticMessage.content}</AIResponse>
              </AIMessageContent>
            </AIMessage>
          )}

          {typingState === "waiting_for_assistant" && (
            <AIMessage from="assistant">
              <AIMessageContent>
                <TypingIndicator />
              </AIMessageContent>
              <DicebearAvatar
                imageUrl={assistantLogoUrl ?? undefined}
                seed={widgetSettings?.chatbotName || "assistant"}
                size={32}
              />
            </AIMessage>
          )}
        </AIConversationContent>
      </AIConversation>

      {uiMessages.length === 1 && suggestions.length > 0 && (
        <div className="border-t px-4 py-3">
          <AISuggestions className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <AISuggestion
                key={s}
                suggestion={s}
                onClick={() => {
                  form.setValue("message", s);
                  form.handleSubmit(onSubmit)();
                }}
              />
            ))}
          </AISuggestions>
        </div>
      )}

      <Form {...form}>
        <AIInput onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <AIInputTextarea
                aria-label="Message input"
                disabled={isVoiceConversation ||
  typingState !== "idle" ||
  conversation?.status === "resolved"
}

                placeholder={
                  isVoiceConversation
                    ? "This is a voice transcript. You cannot reply."
                    :
  conversation?.status === "resolved"
    ? "This conversation is closed"
    : typingState === "waiting_for_assistant"
    ? "AI is typing…"
    : "Type a message…"
}

                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={(el) => {
                  field.ref(el);
                  textareaRef.current = el;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && typingState === "idle") {
                    e.preventDefault();
                    form.handleSubmit(onSubmit)();
                  }
                }}
              />
            )}
          />
          <AIInputToolbar>
            <AIInputTools />
            <AIInputSubmit disabled={isVoiceConversation || typingState !== "idle"} />
          </AIInputToolbar>
        </AIInput>
      </Form>
    </>
  );
};
