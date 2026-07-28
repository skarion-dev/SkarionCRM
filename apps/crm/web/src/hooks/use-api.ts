import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  crmFetch,
  redirectToLogin,
  type Company,
  type Contact,
  type Lead,
  type Opportunity,
  type Task,
  type Activity,
  type LeadAttachment,
  type ImportBatch,
  type WorkflowRule,
  getLeadChannels,
  logOutreachAction,
  getAttachments,
  uploadAttachment,
  deleteAttachment,
  listImportBatches,
  listIdentityUsers,
  listExtensionApiKeys,
  createExtensionApiKey,
  revokeExtensionApiKey,
  listWorkflowRules,
  createWorkflowRule,
  updateWorkflowRule,
  deleteWorkflowRule,
} from '../api.js';

function useCrmQuery<T>(key: string[], fetcher: () => Promise<T>, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return await fetcher();
      } catch (err) {
        if (err instanceof Error && 'status' in err && err.status === 401) {
          redirectToLogin();
        }
        throw err;
      }
    },
    enabled,
  });
}

export function useActivities(filters: {
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  type?: string;
}) {
  const qs = new URLSearchParams();
  if (filters.contactId) qs.append('contactId', filters.contactId);
  if (filters.companyId) qs.append('companyId', filters.companyId);
  if (filters.opportunityId) qs.append('opportunityId', filters.opportunityId);
  if (filters.type) qs.append('type', filters.type);
  return useCrmQuery(['activities', qs.toString()], () =>
    crmFetch<{ activities: Activity[] }>(`/api/activities?${qs.toString()}`)
  );
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return crmFetch<{ activity: Activity }>('/api/activities', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useCompanies() {
  return useCrmQuery(['companies'], () => crmFetch<{ companies: Company[] }>('/api/companies'));
}

export function useContacts() {
  return useCrmQuery(['contacts'], () => crmFetch<{ contacts: Contact[] }>('/api/contacts'));
}

export function useLeads(
  page: number = 1,
  pageSize: number = 50,
  status?: string,
  search?: string,
  outreachStatus?: string,
  sortBy?: string,
  sortOrder?: string,
  batchId?: string,
  channel?: string,
  stage?: string
) {
  const qs = new URLSearchParams();
  qs.append('page', String(page));
  qs.append('pageSize', String(pageSize));
  if (status) qs.append('status', status);
  if (search) qs.append('search', search);
  if (outreachStatus) qs.append('outreachStatus', outreachStatus);
  if (sortBy) qs.append('sortBy', sortBy);
  if (sortOrder) qs.append('sortOrder', sortOrder);
  if (batchId) qs.append('batchId', batchId);
  if (channel) qs.append('channel', channel);
  if (stage) qs.append('stage', stage);
  return useCrmQuery(
    [
      'leads',
      String(page),
      String(pageSize),
      status ?? '',
      search ?? '',
      outreachStatus ?? '',
      sortBy ?? '',
      sortOrder ?? '',
      batchId ?? '',
      channel ?? '',
      stage ?? '',
    ],
    () =>
      crmFetch<{
        leads: Lead[];
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        statusCounts: Record<string, number>;
        outreachStatusCounts: Record<string, number>;
      }>(`/api/leads?${qs.toString()}`)
  );
}

export function useOpportunities() {
  return useCrmQuery(['opportunities'], () =>
    crmFetch<{ opportunities: Opportunity[] }>('/api/opportunities')
  );
}

export function useTasks() {
  return useCrmQuery(['tasks'], () => crmFetch<{ tasks: Task[] }>('/api/tasks'));
}

export function useLead(id: string, enabled = true) {
  return useCrmQuery(['leads', id], () => crmFetch<{ lead: Lead }>(`/api/leads/${id}`), enabled);
}

export function useCompany(id: string, enabled = true) {
  return useCrmQuery(
    ['companies', id],
    () => crmFetch<{ company: Company }>(`/api/companies/${id}`),
    enabled
  );
}

export function useContact(id: string, enabled = true) {
  return useCrmQuery(
    ['contacts', id],
    () => crmFetch<{ contact: Contact }>(`/api/contacts/${id}`),
    enabled
  );
}

export function useOpportunity(id: string, enabled = true) {
  return useCrmQuery(
    ['opportunities', id],
    () => crmFetch<{ opportunity: Opportunity }>(`/api/opportunities/${id}`),
    enabled
  );
}

export function useDeleteEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ type, id }: { type: string; id: string }) => {
      await crmFetch(`/api/${type}/${id}`, { method: 'DELETE' });
      return { type, id };
    },
    onSuccess: ({ type }) => {
      qc.invalidateQueries({ queryKey: [type] });
    },
  });
}

export function useBulkLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      ids: string[];
      action:
        | 'delete'
        | 'update_status'
        | 'update_outreach_status'
        | 'update_tags'
        | 'assign_owner';
      status?: string;
      outreachStatus?: string;
      tags?: string[];
      tagMode?: 'merge' | 'replace';
      assigneeId?: string;
    }) => {
      return crmFetch<{ success: boolean; action: string; processed: number; total: number }>(
        '/api/leads/bulk',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useCreateEntity<T extends Record<string, unknown>>(type: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: T) => {
      return crmFetch<{ [key: string]: unknown }>(`/api/${type}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [type] });
    },
  });
}

export function useUpdateEntity<T extends Record<string, unknown>>(type: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: T }) => {
      return crmFetch<{ [key: string]: unknown }>(`/api/${type}/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [type] });
      qc.invalidateQueries({ queryKey: [type, vars.id] });
    },
  });
}

// ─── CHAT ───

export interface ChatMessage {
  id: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export function useSummarizeLead(id: string) {
  return useMutation({
    mutationFn: async () => {
      return crmFetch<{ summary: string }>(`/api/leads/${id}/summarize`, { method: 'POST' });
    },
  });
}

export function useDraftOutreach(id: string) {
  return useMutation({
    mutationFn: async (opts: { tone: string; channel: string }) => {
      return crmFetch<{ draft: string }>(`/api/leads/${id}/outreach`, {
        method: 'POST',
        body: JSON.stringify(opts),
      });
    },
  });
}

export function useScoreLead(id: string) {
  return useMutation({
    mutationFn: async () => {
      return crmFetch<{ score: number; reasoning: string }>(`/api/leads/${id}/score`, {
        method: 'POST',
      });
    },
  });
}

export function useSuggestNextAction(id: string) {
  return useMutation({
    mutationFn: async () => {
      return crmFetch<{ suggestion: string }>(`/api/leads/${id}/suggest-next-action`, {
        method: 'POST',
      });
    },
  });
}

export function useSummarizeCompany(id: string) {
  return useMutation({
    mutationFn: async () => {
      return crmFetch<{ summary: string }>(`/api/companies/${id}/summarize`, { method: 'POST' });
    },
  });
}

export function useSummarizeContact(id: string) {
  return useMutation({
    mutationFn: async () => {
      return crmFetch<{ summary: string }>(`/api/contacts/${id}/summarize`, { method: 'POST' });
    },
  });
}

// ─── PDF IMPORT ───

export interface DocumentImportResult {
  draftLead: {
    leadType: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    phone: string;
    linkedinUrl: string;
    companyName: string;
    title: string;
    location: string;
    website: string;
    source: string;
    status: string;
    tags: string[];
    notes: string;
    summary: string;
    confidence: number;
    missingFields: string[];
  };
  duplicates: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  }[];
  rawTextPreview: string;
  markdownPreview?: string;
  conversionWarnings?: string[];
  estimatedTokens?: number;
  charCount?: number;
  usedFallback?: boolean;
  fallbackReason?: string | null;
}

/** @deprecated Use DocumentImportResult instead */
export type PdfImportResult = DocumentImportResult;

export function useImportDocument() {
  return useMutation({
    mutationFn: async (formData: FormData) => {
      return crmFetch<DocumentImportResult>('/api/leads/import/document', {
        method: 'POST',
        body: formData,
      });
    },
  });
}

export function useConfirmDocumentImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      lead: Record<string, unknown>;
      force?: boolean;
      createCompany?: boolean;
      createContact?: boolean;
    }) => {
      return crmFetch<{ lead: Lead; contactId: string | null; companyId: string | null }>(
        '/api/leads/import/document/confirm',
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
    },
  });
}

// Keep old exports for backward compatibility (they redirect to the new endpoints)
/** @deprecated Use useImportDocument instead */
export function useImportPdf() {
  return useImportDocument();
}

/** @deprecated Use useConfirmDocumentImport instead */
export function useConfirmPdfImport() {
  return useConfirmDocumentImport();
}

export function useChatHistory() {
  return useCrmQuery(['chat', 'history'], () =>
    crmFetch<{ messages: ChatMessage[] }>('/api/chat/history')
  );
}

export function useSendChatMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (message: string) => {
      return crmFetch<{ answer: string; message: ChatMessage }>('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chat', 'history'] });
    },
  });
}

// ─── SEARCH ───

export interface SearchResult {
  id: string;
  type: 'lead' | 'company' | 'contact' | 'opportunity';
  title: string;
  subtitle?: string;
}

export function useSearch(query: string) {
  return useCrmQuery(
    ['search', query],
    () => crmFetch<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`),
    query.length >= 2
  );
}

// ─── NOTIFICATIONS ───

export interface NotificationItem {
  id: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export function useNotifications() {
  return useCrmQuery(['notifications'], () =>
    crmFetch<{ notifications: NotificationItem[] }>('/api/notifications')
  );
}

export function useNotificationCount() {
  return useCrmQuery(['notifications', 'count'], () =>
    crmFetch<{ count: number }>('/api/notifications/count')
  );
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return crmFetch<{ success: boolean }>(`/api/notifications/${id}/read`, { method: 'POST' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// ─── INTEGRATIONS ───

export interface IntegrationStatus {
  googleApiKey: boolean;
  resendConfigured: boolean;
  documentConverter: boolean;
  aiGateway?: boolean;
  googleAiFallback?: boolean;
}

export function useIntegrationStatus() {
  return useCrmQuery(['integrations', 'status'], () =>
    crmFetch<IntegrationStatus>('/api/integrations/status')
  );
}

export interface AiCredential {
  id: 'vertex_proxy' | 'google_ai';
  name: string;
  configured: boolean;
  isDefault: boolean;
  source: string;
  maskedKey: string | null;
  baseUrl: string | null;
}

export interface AiModelOption {
  id: string;
  backingModel: string;
  label: string;
  costClass: 'low' | 'medium' | 'high';
}

export interface AiAgentConfig {
  id: string;
  name: string;
  description: string;
  tier: 'reasoning' | 'fast' | 'cheap' | 'embedding';
}

export interface AiRuntimeSettings {
  defaultProvider: 'vertex_proxy' | 'google_ai';
  tierModels: {
    reasoning: string;
    fast: string;
    cheap: string;
    embedding: string;
  };
  agentModels: Record<string, string>;
}

export interface AiConfig {
  credentials: AiCredential[];
  models: AiModelOption[];
  agents: AiAgentConfig[];
  settings: AiRuntimeSettings;
  selectedModels: Record<string, string>;
}

export function useAiConfig() {
  return useCrmQuery(['ai', 'config'], () => crmFetch<AiConfig>('/api/ai/config'));
}

export function useUpdateAiConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: AiRuntimeSettings) =>
      crmFetch<{ settings: AiRuntimeSettings }>('/api/ai/config', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai', 'config'] });
      qc.invalidateQueries({ queryKey: ['integrations', 'status'] });
    },
  });
}

// ─── OUTREACH CHANNELS / ATTACHMENTS / IMPORT BATCHES ───

export function useLeadChannels(leadId: string, enabled = true) {
  return useCrmQuery(['lead-channels', leadId], () => getLeadChannels(leadId), enabled);
}

export function useLogOutreachAction(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      channel: string;
      stage?: string;
      action?: 'log_attempt' | 'set_stage';
    }) => {
      return logOutreachAction(leadId, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-channels', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['leads', leadId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useAttachments(leadId: string, enabled = true) {
  return useCrmQuery<LeadAttachment[]>(
    ['attachments', leadId],
    async () => {
      const res = await getAttachments(leadId);
      return res.attachments;
    },
    enabled
  );
}

export function useUploadAttachment(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      return uploadAttachment(leadId, file);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attachments', leadId] });
    },
  });
}

export function useDeleteAttachment(leadId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return deleteAttachment(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attachments', leadId] });
    },
  });
}

export function useImportBatches() {
  return useCrmQuery<ImportBatch[]>(['import-batches'], async () => {
    const res = await listImportBatches();
    return res.batches;
  });
}

export function useIdentityUsers(enabled = true) {
  return useQuery({
    queryKey: ['identity-users'],
    queryFn: async () => {
      try {
        const res = await listIdentityUsers();
        return res.users;
      } catch (err) {
        if (err instanceof Error && 'status' in err && err.status === 403) {
          return [];
        }
        throw err;
      }
    },
    enabled,
  });
}

export function useExtensionApiKeys(enabled = true) {
  return useCrmQuery(
    ['extension-api-keys'],
    async () => {
      const result = await listExtensionApiKeys();
      return result.keys;
    },
    enabled
  );
}

export function useCreateExtensionApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, label }: { email: string; label: string }) =>
      createExtensionApiKey(email, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['extension-api-keys'] }),
  });
}

export function useRevokeExtensionApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeExtensionApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['extension-api-keys'] }),
  });
}

export function useWorkflowRules() {
  return useCrmQuery<WorkflowRule[]>(['workflow-rules'], async () => {
    const res = await listWorkflowRules();
    return res.workflowRules;
  });
}

export function useCreateWorkflowRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<WorkflowRule>) => createWorkflowRule(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-rules'] }),
  });
}

export function useUpdateWorkflowRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WorkflowRule> }) =>
      updateWorkflowRule(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-rules'] }),
  });
}

export function useDeleteWorkflowRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteWorkflowRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow-rules'] }),
  });
}
