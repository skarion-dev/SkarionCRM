import { sql, relations } from 'drizzle-orm';
import {
  pgSchema,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  jsonb,
  inet,
  integer,
  decimal,
  date,
  boolean,
} from 'drizzle-orm/pg-core';

function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  };
}

function softDelete() {
  return {
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by'),
  };
}

export const crmSchema = pgSchema('crm');

export const leadStatusEnum = crmSchema.enum('lead_status', [
  'new',
  'contacted',
  'qualified',
  'disqualified',
  'converted',
]);

export const leadJourneyStageEnum = crmSchema.enum('lead_journey_stage', [
  'new',
  'ready_to_reach_out',
  'connection_sent',
  'connected',
  'engaged',
  'qualified',
  'meeting_booked',
  'opportunity',
  'converted',
  'nurture',
  'no_response',
  'disqualified',
  'lost',
]);

export const opportunityStageEnum = crmSchema.enum('opportunity_stage', [
  'prospecting',
  'qualification',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
]);

export const activityTypeEnum = crmSchema.enum('activity_type', [
  'call',
  'email',
  'meeting',
  'note',
  'linkedin_outreach',
  'instagram_outreach',
  'facebook_outreach',
  'whatsapp_outreach',
  'phone_outreach',
]);

export const leadSourceEnum = crmSchema.enum('lead_source', [
  'linkedin',
  'facebook',
  'instagram',
  'whatsapp',
  'website',
  'referral',
  'social_media',
  'cold_call',
  'email_campaign',
  'event',
  'pdf_upload',
  'other',
]);

export const outreachChannelEnum = crmSchema.enum('outreach_channel', [
  'linkedin',
  'instagram',
  'facebook',
  'whatsapp',
  'email',
  'phone',
]);

export const leadChannelStageEnum = crmSchema.enum('lead_channel_stage', [
  'not_started',
  'connection_request_sent',
  'connection_accepted',
  'message_sent',
  'awaiting_reply',
  'in_conversation',
  'warm_up_needed',
  'replied',
  'booked_call',
  'no_response',
]);

export const currencyEnum = crmSchema.enum('currency', [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'JPY',
  'AED',
  'SAR',
]);

export const companies = crmSchema.table(
  'companies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    domain: text('domain'),
    industry: text('industry'),
    size: text('size'),
    address: jsonb('address'),
    ownerId: uuid('owner_id').notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index('idx_companies_name').on(table.name),
    index('idx_companies_owner').on(table.ownerId),
    index('idx_companies_industry').on(table.industry),
    uniqueIndex('idx_companies_domain_lower').on(sql`lower(${table.domain})`),
  ]
);

export const importBatches = crmSchema.table(
  'import_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    importedByUserId: uuid('imported_by_user_id').notNull(),
    source: leadSourceEnum('source').default('other').notNull(),
    totalRows: integer('total_rows').default(0).notNull(),
    importedCount: integer('imported_count').default(0).notNull(),
    duplicatesSkipped: integer('duplicates_skipped').default(0).notNull(),
    defaultTags: jsonb('default_tags'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_import_batches_name').on(table.name),
    index('idx_import_batches_imported_by').on(table.importedByUserId),
    index('idx_import_batches_created').on(table.createdAt),
  ]
);

export const tagDefinitions = crmSchema.table(
  'tag_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').default('slate').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').default(false).notNull(),
    // System/backfilled tags do not have a human creator. User-created tags
    // always populate this field in the API.
    createdBy: uuid('created_by'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('idx_tag_definitions_slug').on(table.slug),
    index('idx_tag_definitions_name').on(table.name),
  ]
);

export const contacts = crmSchema.table(
  'contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    title: text('title'),
    linkedinUrl: text('linkedin_url'),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index('idx_contacts_company').on(table.companyId),
    index('idx_contacts_owner').on(table.ownerId),
    uniqueIndex('idx_contacts_email_lower').on(sql`lower(${table.email})`),
    index('idx_contacts_name').on(table.lastName, table.firstName),
    uniqueIndex('idx_contacts_linkedin_unique')
      .on(sql`lower(${table.linkedinUrl})`)
      .where(sql`${table.linkedinUrl} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  ]
);

export const leads = crmSchema.table(
  'leads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadNumber: text('lead_number'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    // Nullable: LinkedIn never exposes email on a profile page, and manufacturing
    // a fake placeholder address for every capture poisoned dedup and reporting.
    email: text('email'),
    phone: text('phone'),
    companyName: text('company_name'),
    companyDomain: text('company_domain'),
    linkedinUrl: text('linkedin_url'),
    outreachStatus: text('outreach_status').default('not_approached'),
    approachedAt: timestamp('approached_at', { withTimezone: true }),
    connectionStatus: text('connection_status'),
    sourceSheet: text('source_sheet'),
    originalRowNumber: integer('original_row_number'),
    tags: jsonb('tags'),
    batchId: uuid('batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
    source: leadSourceEnum('source').default('other').notNull(),
    status: leadStatusEnum('status').default('new').notNull(),
    journeyStage: leadJourneyStageEnum('journey_stage').default('new').notNull(),
    notes: text('notes'),
    ownerId: uuid('owner_id').notNull(),
    convertedToContactId: uuid('converted_to_contact_id'),
    convertedToCompanyId: uuid('converted_to_company_id'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    // Client-generated key (e.g. the extension's per-capture UUID) so a retried
    // POST after a network timeout replays the original result instead of
    // creating a second lead.
    idempotencyKey: text('idempotency_key'),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index('idx_leads_status').on(table.status),
    index('idx_leads_journey_stage').on(table.journeyStage),
    index('idx_leads_source').on(table.source),
    index('idx_leads_owner').on(table.ownerId),
    index('idx_leads_email_lower').on(sql`lower(${table.email})`),
    index('idx_leads_outreach').on(table.outreachStatus),
    index('idx_leads_created').on(table.createdAt),
    index('idx_leads_lead_number').on(table.leadNumber),
    index('idx_leads_batch').on(table.batchId),
    // Replaces the old plain idx_leads_linkedin index — this one is unique so
    // the database itself rejects a second lead for the same canonical URL
    // even under concurrent requests, closing the SELECT-then-INSERT race.
    uniqueIndex('idx_leads_linkedin_unique')
      .on(sql`lower(${table.linkedinUrl})`)
      .where(sql`${table.linkedinUrl} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    uniqueIndex('idx_leads_idempotency_key')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  ]
);

export const leadAiAssessments = crmSchema.table(
  'lead_ai_assessments',
  {
    leadId: uuid('lead_id')
      .primaryKey()
      .references(() => leads.id, { onDelete: 'cascade' }),
    overallScore: integer('overall_score').notNull(),
    rawScore: integer('raw_score').notNull(),
    classification: text('classification').notNull(),
    confidenceLevel: text('confidence_level').notNull(),
    scoreBreakdown: jsonb('score_breakdown').notNull(),
    verifiedPositiveSignals: jsonb('verified_positive_signals').notNull(),
    risksOrMissingInformation: jsonb('risks_or_missing_information').notNull(),
    hardDisqualifier: boolean('hard_disqualifier').default(false).notNull(),
    hardDisqualifierReason: text('hard_disqualifier_reason'),
    campaignMatches: jsonb('campaign_matches').notNull(),
    recommendedAction: text('recommended_action').notNull(),
    bestOutreachAngle: text('best_outreach_angle').notNull(),
    qualificationQuestions: jsonb('qualification_questions').notNull(),
    reasoningSummary: text('reasoning_summary').notNull(),
    connectionNote: text('connection_note').notNull(),
    connectionNoteCharacterCount: integer('connection_note_character_count').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('idx_lead_ai_assessments_score').on(table.overallScore),
    index('idx_lead_ai_assessments_classification').on(table.classification),
  ]
);

export const leadChannels = crmSchema.table(
  'lead_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' })
      .notNull(),
    channel: outreachChannelEnum('channel').notNull(),
    stage: leadChannelStageEnum('stage').default('not_started').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextFollowupAt: timestamp('next_followup_at', { withTimezone: true }),
    sequence: integer('sequence').default(1).notNull(),
    // Which step of a multi-step outreach_stale sequence (see
    // evaluateOutreachSequence) has already fired for this channel — 0
    // means none yet. Keeps step 2 from re-firing step 1 and keeps a
    // completed step from permanently blocking the next one.
    followupStage: integer('followup_stage').default(0).notNull(),
    ownerId: uuid('owner_id').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('idx_lead_channels_lead').on(table.leadId),
    index('idx_lead_channels_channel').on(table.channel),
    index('idx_lead_channels_stage').on(table.stage),
    index('idx_lead_channels_next_followup').on(table.nextFollowupAt),
    index('idx_lead_channels_sequence').on(table.sequence),
    index('idx_lead_channels_owner').on(table.ownerId),
  ]
);

export const linkedinConversations = crmSchema.table(
  'linkedin_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    externalConversationId: text('external_conversation_id').notNull(),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    otherPartyName: text('other_party_name').notNull(),
    otherPartyProfileUrl: text('other_party_profile_url'),
    ownerProfileUrl: text('owner_profile_url').notNull(),
    messageCount: integer('message_count').default(0).notNull(),
    outboundCount: integer('outbound_count').default(0).notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),
    lastMessageFromUs: boolean('last_message_from_us').default(false).notNull(),
    messages: jsonb('messages').notNull(),
    importedBy: uuid('imported_by').notNull(),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('idx_linkedin_conversations_importer_external').on(
      table.importedBy,
      table.externalConversationId
    ),
    index('idx_linkedin_conversations_lead').on(table.leadId),
    index('idx_linkedin_conversations_last_message').on(table.lastMessageAt),
    index('idx_linkedin_conversations_profile_url').on(table.otherPartyProfileUrl),
  ]
);

export const leadAttachments = crmSchema.table(
  'lead_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    leadId: uuid('lead_id')
      .references(() => leads.id, { onDelete: 'cascade' })
      .notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    r2Key: text('r2_key').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_lead_attachments_lead').on(table.leadId),
    index('idx_lead_attachments_uploaded_by').on(table.uploadedBy),
  ]
);

export const opportunities = crmSchema.table(
  'opportunities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    stage: opportunityStageEnum('stage').default('prospecting').notNull(),
    amount: decimal('amount', { precision: 14, scale: 2 }),
    currency: currencyEnum('currency').default('USD').notNull(),
    expectedCloseDate: date('expected_close_date'),
    probability: integer('probability'),
    ownerId: uuid('owner_id').notNull(),
    notes: text('notes'),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index('idx_opportunities_stage').on(table.stage),
    index('idx_opportunities_owner').on(table.ownerId),
    index('idx_opportunities_company').on(table.companyId),
    index('idx_opportunities_close_date').on(table.expectedCloseDate),
    index('idx_opportunities_created').on(table.createdAt),
  ]
);

export const activities = crmSchema.table(
  'activities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: activityTypeEnum('type').notNull(),
    subject: text('subject').notNull(),
    content: text('content'),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, {
      onDelete: 'cascade',
    }),
    actorId: uuid('actor_id').notNull(),
    happenedAt: timestamp('happened_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('idx_activities_contact').on(table.contactId),
    index('idx_activities_company').on(table.companyId),
    index('idx_activities_opportunity').on(table.opportunityId),
    index('idx_activities_actor').on(table.actorId),
    index('idx_activities_type').on(table.type),
    index('idx_activities_happened').on(table.happenedAt),
  ]
);

export const tasks = crmSchema.table(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    description: text('description'),
    type: text('type'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    // Nullable: an unassigned task sits in the open-claim pool on the task
    // board until a teammate picks it up.
    assigneeId: uuid('assignee_id'),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, {
      onDelete: 'set null',
    }),
    leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by'),
    priority: text('priority').default('medium').notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index('idx_tasks_assignee').on(table.assigneeId),
    index('idx_tasks_contact').on(table.contactId),
    index('idx_tasks_company').on(table.companyId),
    index('idx_tasks_opportunity').on(table.opportunityId),
    index('idx_tasks_lead').on(table.leadId),
    index('idx_tasks_due').on(table.dueDate),
    index('idx_tasks_completed').on(table.completedAt),
    index('idx_tasks_priority').on(table.priority),
    index('idx_tasks_type').on(table.type),
  ]
);

export const auditLog = crmSchema.table(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id'),
    app: text('app').default('crm').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_actor').on(table.actorUserId),
    index('idx_audit_resource').on(table.resourceType, table.resourceId),
    index('idx_audit_created').on(table.createdAt),
  ]
);

// ─────────────────────────────────────────────────────────
// workflow_rules
// ─────────────────────────────────────────────────────────
export const workflowTriggerEnum = crmSchema.enum('workflow_trigger', [
  'lead_created',
  'opportunity_stale',
  'task_due_soon',
  'outreach_stale',
]);

export const workflowRules = crmSchema.table(
  'workflow_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    trigger: workflowTriggerEnum('trigger').notNull(),
    conditions: jsonb('conditions').notNull(), // e.g. { source: "website", stage: "prospecting" }
    actions: jsonb('actions').notNull(), // e.g. { assignTo: "uuid", createTask: { title: "..." } }
    enabled: boolean('enabled').default(true).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('idx_workflow_rules_trigger').on(table.trigger),
    index('idx_workflow_rules_enabled').on(table.enabled),
  ]
);

// ─────────────────────────────────────────────────────────
// lead_saved_searches
// ─────────────────────────────────────────────────────────
export const leadSavedSearches = crmSchema.table(
  'lead_saved_searches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Own-only — a saved search is a personal shortcut, same scoping as the
    // leads a non-superadmin can see in the first place.
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    filters: jsonb('filters').notNull(), // serialized LeadFilters shape
    sortBy: text('sort_by'),
    sortOrder: text('sort_order'),
    ...timestamps(),
  },
  (table) => [
    index('idx_lead_saved_searches_owner').on(table.ownerId),
    uniqueIndex('idx_lead_saved_searches_owner_name').on(table.ownerId, table.name),
  ]
);

// ─────────────────────────────────────────────────────────
// integration_configs
// ─────────────────────────────────────────────────────────
export const integrationStatusEnum = crmSchema.enum('integration_status', [
  'connected',
  'disconnected',
  'error',
]);

export const integrationConfigs = crmSchema.table(
  'integration_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    provider: text('provider').notNull(), // e.g. "slack", "gmail", "outlook"
    label: text('label').notNull(),
    status: integrationStatusEnum('status').default('disconnected').notNull(),
    settings: jsonb('settings'), // encrypted tokens / config per provider
    ...timestamps(),
  },
  (table) => [uniqueIndex('idx_integrations_provider').on(table.provider)]
);

export const companiesRelations = relations(companies, ({ many }) => ({
  contacts: many(contacts),
  opportunities: many(opportunities),
  activities: many(activities),
  tasks: many(tasks),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  convertedToContact: one(contacts, {
    fields: [leads.convertedToContactId],
    references: [contacts.id],
  }),
  convertedToCompany: one(companies, {
    fields: [leads.convertedToCompanyId],
    references: [companies.id],
  }),
  batch: one(importBatches, { fields: [leads.batchId], references: [importBatches.id] }),
  channels: many(leadChannels),
  linkedinConversations: many(linkedinConversations),
  attachments: many(leadAttachments),
  aiAssessment: one(leadAiAssessments, {
    fields: [leads.id],
    references: [leadAiAssessments.leadId],
  }),
}));

export const leadAiAssessmentsRelations = relations(leadAiAssessments, ({ one }) => ({
  lead: one(leads, {
    fields: [leadAiAssessments.leadId],
    references: [leads.id],
  }),
}));

export const importBatchesRelations = relations(importBatches, ({ many }) => ({
  leads: many(leads),
}));

export const leadChannelsRelations = relations(leadChannels, ({ one }) => ({
  lead: one(leads, { fields: [leadChannels.leadId], references: [leads.id] }),
}));

export const linkedinConversationsRelations = relations(linkedinConversations, ({ one }) => ({
  lead: one(leads, { fields: [linkedinConversations.leadId], references: [leads.id] }),
}));

export const leadAttachmentsRelations = relations(leadAttachments, ({ one }) => ({
  lead: one(leads, { fields: [leadAttachments.leadId], references: [leads.id] }),
}));

export const opportunitiesRelations = relations(opportunities, ({ one, many }) => ({
  company: one(companies, { fields: [opportunities.companyId], references: [companies.id] }),
  contact: one(contacts, { fields: [opportunities.contactId], references: [contacts.id] }),
  activities: many(activities),
  tasks: many(tasks),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  contact: one(contacts, { fields: [activities.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [activities.companyId], references: [companies.id] }),
  opportunity: one(opportunities, {
    fields: [activities.opportunityId],
    references: [opportunities.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  contact: one(contacts, { fields: [tasks.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [tasks.companyId], references: [companies.id] }),
  opportunity: one(opportunities, {
    fields: [tasks.opportunityId],
    references: [opportunities.id],
  }),
  lead: one(leads, { fields: [tasks.leadId], references: [leads.id] }),
}));

// ─────────────────────────────────────────────────────────
// embeddings (for RAG / chatbot)
// ─────────────────────────────────────────────────────────
export const embeddings = crmSchema.table(
  'embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    resourceType: text('resource_type').notNull(), // 'company', 'contact', 'lead', 'opportunity', 'task', 'activity'
    resourceId: uuid('resource_id').notNull(),
    content: text('content').notNull(), // the text that was embedded
    embedding: jsonb('embedding').notNull(), // array of floats stored as JSONB
    ownerId: uuid('owner_id').notNull(), // for permission filtering
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_embeddings_resource').on(table.resourceType, table.resourceId),
    index('idx_embeddings_owner').on(table.ownerId),
    uniqueIndex('idx_embeddings_unique').on(table.resourceType, table.resourceId),
  ]
);

// ─────────────────────────────────────────────────────────
// chat_messages (per-user conversation history)
// ─────────────────────────────────────────────────────────
export const chatMessages = crmSchema.table(
  'chat_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(), // 'user' or 'assistant'
    content: text('content').notNull(),
    contextIds: jsonb('context_ids'), // array of {resourceType, resourceId} used as RAG context
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_chat_messages_user').on(table.userId),
    index('idx_chat_messages_created').on(table.createdAt),
  ]
);

// ─────────────────────────────────────────────────────────
// ai_usage_events (token, reliability, and cost telemetry)
// ─────────────────────────────────────────────────────────
export const aiUsageEvents = crmSchema.table(
  'ai_usage_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    backingModel: text('backing_model').notNull(),
    agentId: text('agent_id'),
    requestType: text('request_type').notNull(),
    status: text('status').notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    totalTokens: integer('total_tokens').default(0).notNull(),
    cachedInputTokens: integer('cached_input_tokens').default(0).notNull(),
    estimatedCostUsd: decimal('estimated_cost_usd', { precision: 16, scale: 8 })
      .default('0')
      .notNull(),
    latencyMs: integer('latency_ms').default(0).notNull(),
    usageSource: text('usage_source').default('unavailable').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_ai_usage_created').on(table.createdAt),
    index('idx_ai_usage_agent_created').on(table.agentId, table.createdAt),
    index('idx_ai_usage_model_created').on(table.backingModel, table.createdAt),
    index('idx_ai_usage_provider_created').on(table.provider, table.createdAt),
  ]
);

// ─────────────────────────────────────────────────────────
// notifications
// ─────────────────────────────────────────────────────────
export const notifications = crmSchema.table(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(), // 'lead_created', 'opportunity_stage_changed', 'task_assigned', etc.
    title: text('title').notNull(),
    message: text('message').notNull(),
    resourceType: text('resource_type'), // 'lead', 'company', 'opportunity', 'task'
    resourceId: uuid('resource_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_notifications_user').on(table.userId),
    index('idx_notifications_resource').on(table.resourceType, table.resourceId),
    index('idx_notifications_read').on(table.readAt),
    index('idx_notifications_created').on(table.createdAt),
  ]
);

export const notificationsRelations = relations(notifications, () => ({}));
export const chatMessagesRelations = relations(chatMessages, () => ({}));
export const aiUsageEventsRelations = relations(aiUsageEvents, () => ({}));

// ─────────────────────────────────────────────────────────
// document_imports (conversion tracking for PDF/DOCX/etc imports)
// ─────────────────────────────────────────────────────────
export const documentImportStatusEnum = crmSchema.enum('document_import_status', [
  'pending',
  'converted',
  'failed',
  'linked',
]);

export const documentImports = crmSchema.table(
  'document_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileHash: text('file_hash').notNull(), // sha256 of uploaded file
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    source: leadSourceEnum('source').default('other').notNull(), // pdf_upload, etc.
    markdownPreview: text('markdown_preview'), // first 2000 chars of converted markdown
    conversionStatus: documentImportStatusEnum('conversion_status').default('pending').notNull(),
    conversionWarnings: jsonb('conversion_warnings'), // array of warning strings
    estimatedTokens: integer('estimated_tokens'),
    charCount: integer('char_count'),
    usedFallback: boolean('used_fallback').default(false).notNull(), // true if local extractor was used
    fallbackReason: text('fallback_reason'), // why fallback was used
    leadId: uuid('lead_id'), // set when linked to a confirmed lead
    ownerId: uuid('owner_id').notNull(),
    ...timestamps(),
  },
  (table) => [
    index('idx_document_imports_hash').on(table.fileHash),
    index('idx_document_imports_lead').on(table.leadId),
    index('idx_document_imports_owner').on(table.ownerId),
    index('idx_document_imports_status').on(table.conversionStatus),
  ]
);

export const documentImportsRelations = relations(documentImports, ({ one }) => ({
  lead: one(leads, { fields: [documentImports.leadId], references: [leads.id] }),
}));

export const embeddingsRelations = relations(embeddings, () => ({}));
