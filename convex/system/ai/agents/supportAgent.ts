import { openai } from "@ai-sdk/openai";
import { Agent } from "@convex-dev/agent";
import { components } from "../../../_generated/api";
import { cloverCreateOrder, cloverGetOrder, cloverListOrders, cloverSearchItems } from "../tools/cloverOrders";
import { resolveConversation } from "../tools/resolveConversation";
import { search } from "../tools/search";
import { SUPPORT_AGENT_PROMPT } from "../constants";

export const supportAgent = new Agent(components.agent, {
  name: "supportAgent",
  languageModel: openai.chat('gpt-4o-mini'),
  instructions: SUPPORT_AGENT_PROMPT,
  tools: {
    search,
    cloverListOrders,
    cloverGetOrder,
    cloverSearchItems,
    cloverCreateOrder,
    resolveConversation,
  },
});
