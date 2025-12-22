import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* ───────────────────────────────────────────────
   SHARED SCHEMAS
─────────────────────────────────────────────── */

export const logoSchema = v.object({
  type: v.union(v.literal("default"), v.literal("upload"), v.literal("url")),
  storageId: v.optional(v.id("_storage")),
  externalUrl: v.optional(v.string()),
  fileName: v.optional(v.string()),
  mimeType: v.optional(v.string()),
  size: v.optional(v.number()),
  updatedAt: v.number(),
});

export const appearanceSchema = v.object({
  primaryColor: v.optional(v.string()),
  size: v.optional(
    v.union(v.number(), v.literal("small"), v.literal("medium"), v.literal("large"))
  ),
  logo: v.optional(logoSchema),
});

/* ───────────────────────────────────────────────
   SCHEMA
─────────────────────────────────────────────── */

export default defineSchema({
  /* ───────── USERS ───────── */
  users: defineTable({
    name: v.string(),
    email: v.string(),
    authId: v.string(),
    organizationId: v.string(),
  }).index("by_organization_id", ["organizationId"]),

  /* ───────── CHATBOTS ───────── */
  chatbots: defineTable({
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    knowledgeBaseId: v.optional(v.id("knowledgeBases")),
    greetMessage: v.string(),
    defaultSuggestions: v.object({
      suggestion1: v.optional(v.string()),
      suggestion2: v.optional(v.string()),
      suggestion3: v.optional(v.string()),
    }),
    isActive: v.boolean(),
    isDefault: v.optional(v.boolean()),

    chatbotId: v.optional(v.string()),
    appearance: v.optional(appearanceSchema),
    customSystemPrompt: v.optional(v.string()),
    aiAvatarEnabled: v.optional(v.boolean()),
    beyondPresenceAgentId: v.optional(v.string()),
    vapiSettings: v.optional(
      v.object({
        assistantId: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
      })
    ),

    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_organization_and_active", ["organizationId", "isActive"])
    .index("by_knowledge_base_id", ["knowledgeBaseId"])
    .index("by_chatbot_id", ["chatbotId"]),

  /* ───────── KNOWLEDGE BASES ───────── */
  knowledgeBases: defineTable({
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),

    // ✅ single source of truth (post-migration)
    ragNamespace: v.optional(v.string()),
    

    fileCount: v.number(),
    knowledgeBaseId: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_rag_namespace", ["ragNamespace"])
    .index("by_knowledge_base_id", ["knowledgeBaseId"]),

  /* ───────── WIDGET SETTINGS ───────── */
  widgetSettings: defineTable({
    organizationId: v.string(),
    greetMessage: v.string(),
    defaultSuggestions: v.object({
      suggestion1: v.optional(v.string()),
      suggestion2: v.optional(v.string()),
      suggestion3: v.optional(v.string()),
    }),
    selectedChatbotId: v.optional(v.id("chatbots")),
    vapiSettings: v.object({
      assistantId: v.optional(v.string()),
      phoneNumber: v.optional(v.string()),
    }),
    chatbotName: v.optional(v.string()),
    customSystemPrompt: v.optional(v.string()),
    appearance: v.optional(appearanceSchema),
  }).index("by_organization_id", ["organizationId"]),

  /* ───────── PLUGINS ───────── */
  plugins: defineTable({
    organizationId: v.string(),
    service: v.union(v.literal("vapi"), v.literal("beyond_presence")),
    secretName: v.string(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_organization_id_and_service", ["organizationId", "service"]),

  /* ───────── CONVERSATIONS ───────── */
  conversations: defineTable({
    threadId: v.string(),
    organizationId: v.string(),
    contactSessionId: v.id("contactSessions"),
    chatbotId: v.optional(v.id("chatbots")),
    caseId: v.optional(v.string()),
    status: v.union(
      v.literal("unresolved"),
      v.literal("escalated"),
      v.literal("resolved")
    ),
    json: v.optional(v.string()),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_contact_session_id", ["contactSessionId"])
    .index("by_thread_id", ["threadId"])
    .index("by_status_and_organization_id", ["status", "organizationId"])
    .index("by_case_id", ["caseId"])
    .index("by_chatbot_id", ["chatbotId"]),

  /* ───────── CONTACT SESSIONS ───────── */
  contactSessions: defineTable({
    name: v.string(),
    email: v.string(),
    organizationId: v.string(),
    expiresAt: v.number(),
    metadata: v.optional(
      v.object({
        userAgent: v.optional(v.string()),
        language: v.optional(v.string()),
        languages: v.optional(v.string()),
        platform: v.optional(v.string()),
        vendor: v.optional(v.string()),
        screenResolution: v.optional(v.string()),
        viewportSize: v.optional(v.string()),
        timezone: v.optional(v.string()),
        timezoneOffset: v.optional(v.number()),
        cookieEnabled: v.optional(v.boolean()),
        referrer: v.optional(v.string()),
        currentUrl: v.optional(v.string()),
      })
    ),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_expires_at", ["expiresAt"]),

  /* ───────── NOTIFICATIONS ───────── */
  notifications: defineTable({
    organizationId: v.string(),
    type: v.union(
      v.literal("file_ready"),
      v.literal("file_failed"),
      v.literal("file_processing")
    ),
    title: v.string(),
    message: v.string(),
    fileId: v.optional(v.string()),
    fileName: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_organization_id_and_read", ["organizationId", "read"])
    .index("by_created_at", ["createdAt"]),

  /* ───────── FILE CHANGE TRACKER ───────── */
  fileChangeTracker: defineTable({
    organizationId: v.string(),
    knowledgeBaseId: v.optional(v.string()),
    lastChange: v.number(),
    changeType: v.string(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_org_and_kb", ["organizationId", "knowledgeBaseId"]),

  /* ───────── DELETED FILES (TOMBSTONES) ───────── */
  deletedFiles: defineTable({
    organizationId: v.string(),
    knowledgeBaseId: v.optional(v.string()),
    storageId: v.id("_storage"),
    deletedAt: v.number(),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_org_and_kb", ["organizationId", "knowledgeBaseId"])
    .index("by_org_and_storage", ["organizationId", "storageId"]),

  /* ───────── VOICE TRANSCRIPTS ───────── */
  voiceTranscripts: defineTable({
    organizationId: v.string(),
    conversationId: v.optional(v.id("conversations")),
    contactSessionId: v.id("contactSessions"),
    chatbotId: v.optional(v.id("chatbots")),
    callId: v.optional(v.string()),
    transcript: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        text: v.string(),
        timestamp: v.optional(v.number()),
      })
    ),
    duration: v.optional(v.number()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_organization_id", ["organizationId"])
    .index("by_conversation_id", ["conversationId"])
    .index("by_contact_session_id", ["contactSessionId"])
    .index("by_chatbot_id", ["chatbotId"]),
});
