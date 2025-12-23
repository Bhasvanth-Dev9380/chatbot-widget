"use client";

import { ConversationStatusIcon } from "@/components/conversation-status-icon";
import { useAtomValue, useSetAtom} from "jotai";
import {formatDistanceToNow} from "date-fns";
import { ArrowLeftIcon} from "lucide-react";
import { chatbotIdAtom, contactSessionIdAtomFamily, conversationIdAtom, organizationIdAtom, screenAtom, isVoiceConversationAtom } from "@/modules/widget/atoms/widget-atoms";
import { WidgetHeader } from "@/modules/widget/ui/components/widget-header";
import { WidgetFooter } from "../components/widget-footer";
import { Button } from "@/components/ui/button";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

import { useInfiniteScroll } from "../../hooks/use-infinite-scroll";
import { InfiniteScrollTrigger } from "@/components/infinite-scroll-trigger";

export const WidgetInboxScreen = () => {
  const setScreen = useSetAtom(screenAtom);
  const setConversationId = useSetAtom(conversationIdAtom);
  const setIsVoiceConversation = useSetAtom(isVoiceConversationAtom);
  const organizationId = useAtomValue(organizationIdAtom);
  const chatbotId = useAtomValue(chatbotIdAtom);
  const contactSessionId = useAtomValue(contactSessionIdAtomFamily(organizationId || ""));

  const conversations = usePaginatedQuery(
    api.public.conversations.getMany,
    contactSessionId
      ? {
          contactSessionId,
          chatbotId: chatbotId || undefined,
        }
      : "skip",
    {
      initialNumItems: 10,
    },
  );

  const getConversationPreview = (lastMessage: any | null) => {
    if (!lastMessage) return { text: "No messages yet", type: "Chat" };

    const messageContent = lastMessage.text;

    if (typeof messageContent === 'string' && messageContent.startsWith("[Voice]")) {
      return { text: messageContent.replace("[Voice] ", ""), type: "Voice" };
    }

    if (typeof messageContent === 'string' && messageContent.startsWith("[Video]")) {
      return { text: messageContent.replace("[Video] ", ""), type: "Video" };
    }

    return { text: messageContent || "", type: "Chat" };
  };

  const { topElementRef, handleLoadMore, canLoadMore, isLoadingMore } = useInfiniteScroll({
    status: conversations.status,
    loadMore: conversations.loadMore,
    loadSize: 10
  });

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
          <p>Inbox</p>
        </div>
      </WidgetHeader>
      <div className="flex flex-1 flex-col  gap-y-2 p-4 overflow-y-auto">

        {conversations?.results.length > 0 &&
          conversations?.results.map((conversation) => (
            <Button
              className="h-20 w-full justify-between"
              key={conversation._id}
              onClick={() => {
                const preview = getConversationPreview(conversation.lastMessage);
                setIsVoiceConversation(preview.type === "Voice" || preview.type === "Video");
                setConversationId(conversation._id);
                setScreen("chat");
              }}
              variant="outline"
            >
              <div className="flex w-full flex-col gap-4 overflow-hidden text-start">
                <div className="flex w-full items-center justify-between gap-x-2">
                  <p className="text-muted-foreground text-xs">
                    {getConversationPreview(conversation.lastMessage).type}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(conversation._creationTime))}
                  </p>
                </div>
                <div className="flex w-full items-center justify-between gap-x-2">
                  <p className="truncate text-sm">
                    {getConversationPreview(conversation.lastMessage).text}
                  </p>
                  <ConversationStatusIcon status = {conversation.status} />

                </div>

              </div>

            </Button>
          ))
        }

        <InfiniteScrollTrigger
          canLoadMore={canLoadMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={handleLoadMore}
          ref={topElementRef}
        />



      </div>
      <WidgetFooter/>


    </>
  )
}