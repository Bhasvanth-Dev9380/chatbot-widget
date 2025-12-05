import { openai } from "@ai-sdk/openai";
import { Agent } from "@convex-dev/agent";
import { components } from "../../../_generated/api";
import { resolve } from "path";
import { escalateConversation } from "../tools/escalateConversation";
import { resolveConversation } from "../tools/resolveConversation";
import { SUPPORT_AGENT_PROMPT } from "../constants";

export const supportAgent = new Agent(components.agent , {
name: "support-agent",
languageModel: openai.chat('gpt-4o-mini'),
instructions: SUPPORT_AGENT_PROMPT,
tools:{
    resolveConversation,
    escalateConversation,
}
});