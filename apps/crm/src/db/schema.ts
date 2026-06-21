import { sql, relations } from "drizzle-orm";
import {
  pgSchema, text, timestamp, uuid, index, uniqueIndex, jsonb, inet,
  integer, decimal, date, boolean,
} from "drizzle-orm/pg-core";

function timestamps() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  };
}

function softDelete() {
  return {
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
  };
}

export const crmSchema = pgSchema("crm");

export const leadStatusEnum = crmSchema.enum("lead_status", [
  "new", "contacted", "qualified", "disqualified", "converted",
]);

export const opportunityStageEnum = crmSchema.enum("opportunity_stage", [
  "prospecting", "qualification", "proposal", "negotiation", "closed_won", "closed_lost",
]);

export const activityTypeEnum = crmSchema.enum("activity_type", [
  "call", "email", "meeting", "note",
]);

export const leadSourceEnum = crmSchema.enum("lead_source", [
  "website", "referral", "social_media", "cold_call", "email_campaign", "event", "pdf_upload", "other",
]);

export const currencyEnum = crmSchema.enum("currency", [
  "USD", "EUR", "GBP", "CAD", "AUD", "JPY", "AED", "SAR",
]);

export const companies = crmSchema.table(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    size: text("size"),
    address: jsonb("address"),
    ownerId: uuid("owner_id").notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index("idx_companies_name").on(table.name),
    index("idx_companies_owner").on(table.ownerId),
    index("idx_companies_industry").on(table.industry),
    uniqueIndex("idx_companies_domain_lower").on(sql`lower(${table.domain})`),
  ]
);

export const contacts = crmSchema.table(
  "contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    title: text("title"),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index("idx_contacts_company").on(table.companyId),
    index("idx_contacts_owner").on(table.ownerId),
    uniqueIndex("idx_contacts_email_lower").on(sql`lower(${table.email})`),
    index("idx_contacts_name").on(table.lastName, table.firstName),
  ]
);

export const leads = crmSchema.table(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    companyName: text("company_name"),
    companyDomain: text("company_domain"),
    source: leadSourceEnum("source").default("other").notNull(),
    status: leadStatusEnum("status").default("new").notNull(),
    notes: text("notes"),
    ownerId: uuid("owner_id").notNull(),
    convertedToContactId: uuid("converted_to_contact_id"),
    convertedToCompanyId: uuid("converted_to_company_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index("idx_leads_status").on(table.status),
    index("idx_leads_source").on(table.source),
    index("idx_leads_owner").on(table.ownerId),
    index("idx_leads_email_lower").on(sql`lower(${table.email})`),
    index("idx_leads_created").on(table.createdAt),
  ]
);

export const opportunities = crmSchema.table(
  "opportunities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    stage: opportunityStageEnum("stage").default("prospecting").notNull(),
    amount: decimal("amount", { precision: 14, scale: 2 }),
    currency: currencyEnum("currency").default("USD").notNull(),
    expectedCloseDate: date("expected_close_date"),
    probability: integer("probability"),
    ownerId: uuid("owner_id").notNull(),
    notes: text("notes"),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index("idx_opportunities_stage").on(table.stage),
    index("idx_opportunities_owner").on(table.ownerId),
    index("idx_opportunities_company").on(table.companyId),
    index("idx_opportunities_close_date").on(table.expectedCloseDate),
    index("idx_opportunities_created").on(table.createdAt),
  ]
);

export const activities = crmSchema.table(
  "activities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: activityTypeEnum("type").notNull(),
    subject: text("subject").notNull(),
    content: text("content"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").notNull(),
    happenedAt: timestamp("happened_at", { withTimezone: true }).defaultNow().notNull(),
    ...timestamps(),
  },
  (table) => [
    index("idx_activities_contact").on(table.contactId),
    index("idx_activities_company").on(table.companyId),
    index("idx_activities_opportunity").on(table.opportunityId),
    index("idx_activities_actor").on(table.actorId),
    index("idx_activities_type").on(table.type),
    index("idx_activities_happened").on(table.happenedAt),
  ]
);

export const tasks = crmSchema.table(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    assigneeId: uuid("assignee_id").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    priority: text("priority").default("medium").notNull(),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    index("idx_tasks_assignee").on(table.assigneeId),
    index("idx_tasks_contact").on(table.contactId),
    index("idx_tasks_company").on(table.companyId),
    index("idx_tasks_opportunity").on(table.opportunityId),
    index("idx_tasks_due").on(table.dueDate),
    index("idx_tasks_completed").on(table.completedAt),
    index("idx_tasks_priority").on(table.priority),
  ]
);

export const auditLog = crmSchema.table(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id"),
    app: text("app").default("crm").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_audit_actor").on(table.actorUserId),
    index("idx_audit_resource").on(table.resourceType, table.resourceId),
    index("idx_audit_created").on(table.createdAt),
  ]
);

// ─────────────────────────────────────────────────────────
// workflow_rules
// ─────────────────────────────────────────────────────────
export const workflowTriggerEnum = crmSchema.enum("workflow_trigger", [
  "lead_created",
  "opportunity_stale",
  "task_due_soon",
]);

export const workflowRules = crmSchema.table(
  "workflow_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    trigger: workflowTriggerEnum("trigger").notNull(),
    conditions: jsonb("conditions").notNull(), // e.g. { source: "website", stage: "prospecting" }
    actions: jsonb("actions").notNull(), // e.g. { assignTo: "uuid", createTask: { title: "..." } }
    enabled: boolean("enabled").default(true).notNull(),
    ...timestamps(),
  },
  (table) => [
    index("idx_workflow_rules_trigger").on(table.trigger),
    index("idx_workflow_rules_enabled").on(table.enabled),
  ]
);

// ─────────────────────────────────────────────────────────
// integration_configs
// ─────────────────────────────────────────────────────────
export const integrationStatusEnum = crmSchema.enum("integration_status", [
  "connected",
  "disconnected",
  "error",
]);

export const integrationConfigs = crmSchema.table(
  "integration_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(), // e.g. "slack", "gmail", "outlook"
    label: text("label").notNull(),
    status: integrationStatusEnum("status").default("disconnected").notNull(),
    settings: jsonb("settings"), // encrypted tokens / config per provider
    ...timestamps(),
  },
  (table) => [
    uniqueIndex("idx_integrations_provider").on(table.provider),
  ]
);



export const companiesRelations = relations(companies, ({ many }) => ({
  contacts: many(contacts),
  opportunities: many(opportunities),
  activities: many(activities),
  tasks: many(tasks),
}));

export const leadsRelations = relations(leads, ({ one }) => ({
  convertedToContact: one(contacts, { fields: [leads.convertedToContactId], references: [contacts.id] }),
  convertedToCompany: one(companies, { fields: [leads.convertedToCompanyId], references: [companies.id] }),
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
  opportunity: one(opportunities, { fields: [activities.opportunityId], references: [opportunities.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  contact: one(contacts, { fields: [tasks.contactId], references: [contacts.id] }),
  company: one(companies, { fields: [tasks.companyId], references: [companies.id] }),
  opportunity: one(opportunities, { fields: [tasks.opportunityId], references: [opportunities.id] }),
}));

// ─────────────────────────────────────────────────────────
// embeddings (for RAG / chatbot)
// ─────────────────────────────────────────────────────────
export const embeddings = crmSchema.table(
  "embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    resourceType: text("resource_type").notNull(), // 'company', 'contact', 'lead', 'opportunity', 'task', 'activity'
    resourceId: uuid("resource_id").notNull(),
    content: text("content").notNull(), // the text that was embedded
    embedding: jsonb("embedding").notNull(), // array of floats stored as JSONB
    ownerId: uuid("owner_id").notNull(), // for permission filtering
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_embeddings_resource").on(table.resourceType, table.resourceId),
    index("idx_embeddings_owner").on(table.ownerId),
    uniqueIndex("idx_embeddings_unique").on(table.resourceType, table.resourceId),
  ]
);

// ─────────────────────────────────────────────────────────
// chat_messages (per-user conversation history)
// ─────────────────────────────────────────────────────────
export const chatMessages = crmSchema.table(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    role: text("role").notNull(), // 'user' or 'assistant'
    content: text("content").notNull(),
    contextIds: jsonb("context_ids"), // array of {resourceType, resourceId} used as RAG context
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_chat_messages_user").on(table.userId),
    index("idx_chat_messages_created").on(table.createdAt),
  ]
);

export const embeddingsRelations = relations(embeddings, () => ({}));
export const chatMessagesRelations = relations(chatMessages, () => ({}));
