import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  crmFetch,
  redirectToLogin,
  type Company,
  type Contact,
  type Lead,
  type LeadAiAssessment,
  type Opportunity,
  type Task,
  type DashboardData,
  type Activity,
  type LeadAttachment,
  type ImportBatch,
  type LeadJourneyStage,
  type TagDefinition,
  type Prospect,
  type ProspectImportJob,
  type DashboardSummary,
  type WorkflowRule,
  getLeadChannels,
  logOutreachAction,
  getAttachments,
  uploadAttachment,
  deleteAttachment,
  listImportBatches,
  listIdentityUsers,
  listIdentityInvitations,
  createIdentityInvitation,
  updateIdentityCrmMembership,
  setIdentityUserEnabled,
  resendIdentityInvitation,
  revokeIdentityInvitation,
  listExtensionApiKeys,
  createExtensionApiKey,
  revokeExtensionApiKey,
  listWorkflowRules,
  createWorkflowRule,
  updateWorkflowRule,
  deleteWorkflowRule,
} from '../api.js';
import { buildLeadsQueryString, type LeadFilters } from '../lib/leadFilters.js';

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

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      try {
        return await crmFetch<DashboardData>('/api/dashboard');
      } catch (err) {
        if (err instanceof Error && 'status' in err && err.status === 401) {
          redirectToLogin();
        }
        throw err;
      }
    },
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
}

export function useActivities(filters: {
  leadId?: string;
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  type?: string;
}) {
  const qs = new URLSearchParams();
  if (filters.leadId) qs.append('leadId', filters.leadId);
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

export function useTags() {
  return useCrmQuery(['tag-definitions'], () => crmFetch<{ tags: TagDefinition[] }>('/api/tags'));
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; color?: string; description?: string }) =>
      crmFetch<{ tag: TagDefinition }>('/api/tags', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tag-definitions'] });
    },
  });
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
      }>(`/api/leads?${qs.toString()}`)
  );
}

export interface LeadsResponse {
  leads: Lead[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  statusCounts: Record<string, number>;
}

function mergeLeadIntoPagedResults(
  current: LeadsResponse | undefined,
  lead: Partial<Lead> & { id: string }
): LeadsResponse | undefined {
  if (!current) return current;
  const existingIndex = current.leads.findIndex((row) => row.id === lead.id);
  if (existingIndex < 0) return current;

  const leads = [...current.leads];
  leads[existingIndex] = { ...leads[existingIndex], ...lead } as Lead;
  return { ...current, leads };
}

/** Bounded server-side pagination for the leads table. Keeping the page in
 * the query key prevents rows from different pages or filter sets from being
 * accumulated, while placeholderData keeps the current page visible during
 * a short page transition. */
export function usePagedLeads(filters: LeadFilters, page: number, pageSize: number) {
  const qs = buildLeadsQueryString(filters);
  return useQuery({
    queryKey: ['leads', 'paged', qs, page, pageSize],
    queryFn: async () => {
      try {
        return await crmFetch<LeadsResponse>(`/api/leads?${qs}&page=${page}&pageSize=${pageSize}`);
      } catch (err) {
        if (err instanceof Error && 'status' in err && err.status === 401) {
          redirectToLogin();
        }
        throw err;
      }
    },
    placeholderData: (previous) => previous,
  });
}

export type ProspectFilters = {
  search?: string;
  leadFrom?: string;
  leadTo?: string;
  batchId?: string;
  captureStatus?: string;
  claimed?: 'all' | 'mine' | 'unclaimed';
  reviewState?: 'pending' | 'rejected';
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

export interface ProspectsResponse {
  prospects: Prospect[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  matchingTotal: number;
  availableTotal: number;
  awaitingReviewTotal: number;
}

export interface ProfileCleanupStatus {
  summary: {
    total: number;
    active: number;
    waiting: number;
    processing: number;
    retrying: number;
    completed: number;
    completedToday: number;
    capturedProfiles12h: number;
    captureEvents12h: number;
    progressPercent: number;
    oldestQueuedAt: string | null;
    latestCompletedAt: string | null;
    estimatedMinutes: number;
    otherCrmActive: number;
  };
  queue: Array<{
    id: string;
    leadId: string;
    leadNumber: string;
    firstName: string;
    lastName: string;
    status: 'processing' | 'pending' | 'failed';
    attempts: number;
    nextAttemptAt: string;
    lockedAt: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  cadence: {
    batchSize: number;
    concurrency: number;
    cadenceMinutes: number;
    model: string;
    nextScheduledRunAt: string;
  };
  observedAt: string;
}

export interface LeadScoringStatus {
  summary: {
    candidates: number;
    capturedReady: number;
    waitingForCapture: number;
    scored: number;
    unscoredCaptured: number;
    active: number;
    waiting: number;
    processing: number;
    retrying: number;
    completed24h: number;
    latestCompletedAt: string | null;
    progressPercent: number;
    estimatedMinutes: number;
  };
  queue: Array<{
    id: string;
    leadId: string;
    leadNumber: string | null;
    firstName: string;
    lastName: string;
    status: 'processing' | 'pending' | 'failed';
    attempts: number;
    nextAttemptAt: string;
    lastError: string | null;
  }>;
  connectionsToday: {
    mine: number;
    team: number;
    limit: number;
    dayStart: string;
  };
  cadence: {
    batchSize: number;
    concurrency: number;
    cadenceMinutes: number;
    model: string;
    nextScheduledRunAt: string;
  };
  observedAt: string;
}

function prospectQueryString(filters: ProspectFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && value !== 'all') query.set(key, String(value));
  }
  return query.toString();
}

export function useProspects(filters: ProspectFilters) {
  const query = prospectQueryString(filters);
  return useCrmQuery(['prospects', query], () =>
    crmFetch<ProspectsResponse>(`/api/prospects?${query}`)
  );
}

export function useProfileCleanupStatus() {
  return useQuery({
    queryKey: ['profile-cleanup-status'],
    queryFn: async () => {
      try {
        return await crmFetch<ProfileCleanupStatus>('/api/prospects/profile-cleanup-status');
      } catch (err) {
        if (err instanceof Error && 'status' in err && err.status === 401) redirectToLogin();
        throw err;
      }
    },
    refetchInterval: 5_000,
  });
}

export function useLeadScoringStatus() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  return useQuery({
    queryKey: ['lead-scoring-status', dayStart.toISOString()],
    queryFn: async () => {
      try {
        return await crmFetch<LeadScoringStatus>(
          `/api/leads/scoring-status?dayStart=${encodeURIComponent(dayStart.toISOString())}`
        );
      } catch (err) {
        if (err instanceof Error && 'status' in err && err.status === 401) redirectToLogin();
        throw err;
      }
    },
    refetchInterval: 5_000,
  });
}

export function useImportProspects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { csv: string; name: string }) =>
      crmFetch<{
        job: ProspectImportJob;
        batchId: string;
        validRows: number;
        invalidRows: Array<{ row: number; error: string }>;
      }>('/api/prospects/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['import-batches'] });
    },
  });
}

export function useProspectImportJob(id: string | null) {
  return useQuery({
    queryKey: ['prospect-import-job', id],
    queryFn: () =>
      crmFetch<{ job: ProspectImportJob }>(
        `/api/prospects/imports/${encodeURIComponent(id ?? '')}`
      ),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.job.status;
      return status === 'pending' || status === 'processing' ? 1500 : false;
    },
  });
}

export function useClaimNextProspects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      limit?: number;
      leadFrom?: string;
      leadTo?: string;
      search?: string;
      batchId?: string;
      captureStatus?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    }) =>
      crmFetch<{ prospects: Prospect[]; leaseMinutes: number }>('/api/prospects/claim-next', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prospects'] }),
  });
}

export type ProspectDisposition =
  | 'excellent_fit'
  | 'maybe'
  | 'worth_trying'
  | 'future'
  | 'foreign_national'
  | 'disqualified';

function removeProspectRow(
  current: ProspectsResponse | undefined,
  prospectId: string
): ProspectsResponse | undefined {
  if (!current) return current;
  const removed = current.prospects.find((prospect) => prospect.id === prospectId);
  if (!removed) return current;
  const total = Math.max(0, current.total - 1);
  const hasActiveClaim =
    Boolean(removed.claimedBy) &&
    Boolean(removed.claimExpiresAt) &&
    new Date(removed.claimExpiresAt as string).getTime() > Date.now();
  return {
    ...current,
    prospects: current.prospects.filter((prospect) => prospect.id !== prospectId),
    total,
    totalPages: Math.ceil(total / current.pageSize),
    matchingTotal: Math.max(0, current.matchingTotal - 1),
    availableTotal: Math.max(
      0,
      current.availableTotal - (removed.linkedinUrl && !hasActiveClaim ? 1 : 0)
    ),
    awaitingReviewTotal: Math.max(0, current.awaitingReviewTotal - 1),
  };
}

export function useReviewProspect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { id: string; disposition: ProspectDisposition; rowVersion: number }) =>
      crmFetch<{ lead: Lead }>(`/api/prospects/${payload.id}/review`, {
        method: 'PUT',
        body: JSON.stringify({
          disposition: payload.disposition,
          rowVersion: payload.rowVersion,
        }),
      }),
    onSuccess: (_data, payload) => {
      qc.setQueriesData<ProspectsResponse>({ queryKey: ['prospects'] }, (current) =>
        removeProspectRow(current, payload.id)
      );
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useProspectEvents(enabled = true) {
  const qc = useQueryClient();
  const cursor = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const data = await crmFetch<{
          events: Array<{
            sequence: number;
            eventType: string;
            payload: { lead?: Prospect };
          }>;
          cursor: number;
        }>(`/api/prospect-events?after=${cursor.current}`);
        if (stopped) return;
        cursor.current = data.cursor;
        for (const event of data.events) {
          if (event.eventType === 'prospect.import.completed') {
            await qc.invalidateQueries({ queryKey: ['prospects'] });
            continue;
          }
          if (event.eventType === 'prospect.reviewed') {
            await qc.invalidateQueries({ queryKey: ['leads'] });
          }
          if (event.eventType === 'lead.profile_normalized') {
            await qc.invalidateQueries({ queryKey: ['profile-cleanup-status'] });
            await qc.invalidateQueries({ queryKey: ['lead-scoring-status'] });
          }
          if (event.eventType === 'lead.scored') {
            await qc.invalidateQueries({ queryKey: ['lead-scoring-status'] });
          }
          const lead = event.payload?.lead;
          if (!lead) continue;
          if (event.eventType === 'lead.profile_normalized' || event.eventType === 'lead.scored') {
            qc.setQueriesData<LeadsResponse>({ queryKey: ['leads', 'paged'] }, (current) =>
              mergeLeadIntoPagedResults(current, lead)
            );
          }
          qc.setQueriesData<ProspectsResponse>({ queryKey: ['prospects'] }, (current) => {
            if (!current) return current;
            const existingIndex = current.prospects.findIndex((row) => row.id === lead.id);
            if (lead.reviewState !== 'pending') {
              return removeProspectRow(current, lead.id);
            }
            if (existingIndex < 0) return current;
            const prospects = [...current.prospects];
            prospects[existingIndex] = { ...prospects[existingIndex], ...lead };
            return { ...current, prospects };
          });
        }
      } catch {
        // Reconnect automatically. The cursor keeps delivery idempotent.
      } finally {
        if (!stopped) timeout = setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [enabled, qc]);
}

export interface LeadSavedSearch {
  id: string;
  ownerId: string;
  name: string;
  filters: LeadFilters;
  sortBy: string | null;
  sortOrder: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useSavedSearches() {
  return useCrmQuery(['lead-saved-searches'], () =>
    crmFetch<{ savedSearches: LeadSavedSearch[] }>('/api/leads/saved-searches')
  );
}

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      filters: LeadFilters;
      sortBy?: string;
      sortOrder?: string;
    }) => {
      return crmFetch<{ savedSearch: LeadSavedSearch }>('/api/leads/saved-searches', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-saved-searches'] });
    },
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await crmFetch(`/api/leads/saved-searches/${id}`, { method: 'DELETE' });
      return { id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead-saved-searches'] });
    },
  });
}

export function useOpportunities() {
  return useCrmQuery(['opportunities'], () =>
    crmFetch<{ opportunities: Opportunity[] }>('/api/opportunities')
  );
}

export function useTasks() {
  return useCrmQuery(['tasks'], () => crmFetch<{ tasks: Task[] }>('/api/tasks'));
}

/** Self-claim an unassigned task off the open-claim board. 409s if someone
 * else claimed it first — the mutation surfaces that as a normal error for
 * the caller to show a toast and refresh the board. */
export function useClaimTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return crmFetch<{ task: Task }>(`/api/tasks/${id}/claim`, { method: 'PUT' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useLead(id: string, enabled = true) {
  return useCrmQuery(['leads', id], () => crmFetch<{ lead: Lead }>(`/api/leads/${id}`), enabled);
}

export function useLeadAiAssessment(id: string, enabled = true) {
  return useCrmQuery(
    ['leads', id, 'ai-assessment'],
    () => crmFetch<{ assessment: LeadAiAssessment | null }>(`/api/leads/${id}/ai-assessment`),
    enabled
  );
}

export function useGenerateLeadAiAssessment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      crmFetch<{ assessment: LeadAiAssessment }>(`/api/leads/${id}/ai-assessment`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      qc.setQueryData(['leads', id, 'ai-assessment'], data);
    },
  });
}

export function useUpdateLeadConnectionNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connectionNote: string) =>
      crmFetch<{ assessment: LeadAiAssessment }>(`/api/leads/${id}/ai-assessment/connection-note`, {
        method: 'PATCH',
        body: JSON.stringify({ connectionNote }),
      }),
    onSuccess: (data) => {
      qc.setQueryData(['leads', id, 'ai-assessment'], data);
    },
  });
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
    onSuccess: async ({ type }) => {
      await qc.invalidateQueries({ queryKey: [type] });
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
        | 'update_journey_stage'
        | 'update_outreach_status'
        | 'update_tags'
        | 'assign_owner';
      status?: string;
      journeyStage?: string;
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
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['leads'] })]);
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
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [type] });
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
    onSuccess: async (_, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [type] }),
        qc.invalidateQueries({ queryKey: [type, vars.id] }),
      ]);
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

export interface CeoChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface CandidateChatContext {
  lead: {
    id: string;
    leadNumber: string | null;
    name: string;
    headline: string | null;
    location: string | null;
    journeyStage: string;
    mostRecentDegree: string | null;
    mostRecentSchool: string | null;
    mostRecentGraduationDate: string | null;
    aiScore: number | null;
    aiClassification: string | null;
  };
  context: {
    linkedinMessages: number;
    activities: number;
    channels: number;
    latestMessage: {
      sentAt: string;
      direction: 'inbound' | 'outbound';
      senderName: string;
      content: string;
    } | null;
  };
}

export interface CandidateLeadAction {
  journeyStage: LeadJourneyStage | null;
  updates: Partial<
    Record<
      | 'firstName'
      | 'lastName'
      | 'email'
      | 'phone'
      | 'headline'
      | 'location'
      | 'about'
      | 'experience'
      | 'education'
      | 'skills'
      | 'currentRole'
      | 'currentRoleDates'
      | 'openToWork'
      | 'yearsExperience'
      | 'connectionDegree'
      | 'companyName'
      | 'companyDomain',
      string | number | boolean | null
    >
  >;
  noteToAppend: string | null;
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

export function useCeoChatHistory() {
  return useCrmQuery(['ceo-chat', 'history'], () =>
    crmFetch<{ messages: CeoChatMessage[] }>('/api/ceo-chat/history')
  );
}

export function useClearCeoChatHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      crmFetch<{ success: true }>('/api/ceo-chat/history', { method: 'DELETE' }),
    onSuccess: () => {
      qc.setQueryData(['ceo-chat', 'history'], { messages: [] });
    },
  });
}

export function useCandidateChatContext(leadId: string | null) {
  return useCrmQuery(
    ['candidate-chat', 'context', leadId ?? ''],
    () => crmFetch<CandidateChatContext>(`/api/candidate-chat/context/${leadId}`),
    Boolean(leadId)
  );
}

export function useApplyCandidateLeadAction(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (action: CandidateLeadAction) => {
      if (!leadId) throw new Error('Match a lead before changing CRM data.');
      return crmFetch<{
        success: true;
        lead: { id: string; name: string; journeyStage: LeadJourneyStage };
        summary: string;
      }>('/api/candidate-chat/lead-action', {
        method: 'POST',
        body: JSON.stringify({ leadId, action }),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['candidate-chat', 'context', leadId ?? ''] }),
        qc.invalidateQueries({ queryKey: ['leads'] }),
        leadId ? qc.invalidateQueries({ queryKey: ['leads', leadId] }) : Promise.resolve(),
      ]);
    },
  });
}

export function useCandidateChatHistory(leadId: string | null) {
  return useCrmQuery(
    ['candidate-chat', 'history', leadId ?? ''],
    () =>
      crmFetch<{ messages: CeoChatMessage[] }>(
        `/api/candidate-chat/history?leadId=${encodeURIComponent(leadId ?? '')}`
      ),
    Boolean(leadId)
  );
}

export function useClearCandidateChatHistory(leadId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!leadId) throw new Error('Choose a lead first.');
      return crmFetch<{ success: true }>(
        `/api/candidate-chat/history?leadId=${encodeURIComponent(leadId)}`,
        { method: 'DELETE' }
      );
    },
    onSuccess: () => {
      qc.setQueryData(['candidate-chat', 'history', leadId ?? ''], { messages: [] });
    },
  });
}

export interface CeoLinkedInImportResult {
  success: true;
  summary: string;
  historyMessage: CeoChatMessage | null;
  detectedFiles: Array<{ name: string; kind: 'messages' | 'invitations'; rows: number }>;
  storedConversations: number;
  totalMessages: number;
  matchedConversations: number;
  matchedInvitations: number;
  enrichedLeads: number;
  unmatched: number;
  skippedRows: number;
  ownerProfileUrl: string | null;
}

export function useImportCeoLinkedInExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, ownerProfileUrl }: { files: File[]; ownerProfileUrl?: string }) => {
      const formData = new FormData();
      files.forEach((file) => formData.append('files', file));
      if (ownerProfileUrl?.trim()) formData.append('ownerProfileUrl', ownerProfileUrl.trim());
      return crmFetch<CeoLinkedInImportResult>('/api/ceo-chat/import-linkedin', {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ceo-chat', 'history'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-channels'] });
    },
  });
}

export interface LinkedinSyncImportRun {
  id: string;
  kind: 'messages' | 'invitations';
  originalFilename: string;
  status: string;
  totalRows: number;
  newItems: number;
  matchedItems: number;
  ignoredItems: number;
  flaggedItems: number;
  details: { conversations?: number; recoveredLegacyImport?: boolean };
  createdAt: string;
  completedAt: string | null;
}

export interface LinkedinSyncQueueSummary {
  active: number;
  waiting: number;
  processing: number;
  retrying: number;
  completed24h: number;
  latestCompletedAt: string | null;
}

export interface LinkedinMessageReconciliation {
  conversations: number;
  linkedConversations: number;
  unlinkedConversations: number;
  conversationMessages: number;
  storedMessages: number;
  leadsWithStoredMessages: number;
  visibleActivities: number;
  leadsWithVisibleActivities: number;
  latestImport: {
    id: string;
    status: string;
    conversations: number;
    newMessages: number;
    loggedMessages: number;
    ignoredMessages: number;
    flaggedConversations: number;
    createdAt: string;
    completedAt: string | null;
  } | null;
}

export interface LinkedinSyncStatus {
  observedAt: string;
  lastMessageDump: LinkedinSyncImportRun | null;
  lastInvitationDump: LinkedinSyncImportRun | null;
  messageImports: LinkedinSyncImportRun[];
  invitationImports: LinkedinSyncImportRun[];
  queues: {
    messages: LinkedinSyncQueueSummary;
    invitations: LinkedinSyncQueueSummary;
  };
  messageReconciliation: LinkedinMessageReconciliation;
  openFlags: Array<{
    id: string;
    otherPartyName: string;
    otherPartyProfileUrl: string | null;
    messageCount: number;
    reason: string;
    createdAt: string;
  }>;
}

export interface LinkedinSyncImportResult {
  success: true;
  duplicate: boolean;
  import: LinkedinSyncImportRun;
  queuedJobs?: number;
  newMessages?: number;
  pendingJobs?: number;
  acceptedJobs?: number;
  unmatched?: number;
  summary: string;
  historyMessage: CeoChatMessage | null;
}

function useLinkedinSyncImport(kind: 'messages' | 'invitations') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, ownerProfileUrl }: { file: File; ownerProfileUrl?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sourceTimezone', Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (ownerProfileUrl?.trim()) formData.append('ownerProfileUrl', ownerProfileUrl.trim());
      return crmFetch<LinkedinSyncImportResult>(`/api/ceo-chat/import-linkedin-${kind}`, {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['linkedin-sync', 'status'] });
      qc.invalidateQueries({ queryKey: ['ceo-chat', 'history'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-channels'] });
    },
  });
}

export function useImportLinkedinMessages() {
  return useLinkedinSyncImport('messages');
}

export function useImportLinkedinInvitations() {
  return useLinkedinSyncImport('invitations');
}

export function useLinkedinSyncStatus(enabled = true) {
  return useQuery({
    queryKey: ['linkedin-sync', 'status'],
    queryFn: () => crmFetch<LinkedinSyncStatus>('/api/linkedin-sync/status'),
    enabled,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
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
  inputPricePerMillion: number;
  outputPricePerMillion: number;
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

export type AiUsagePeriod = 'day' | 'week' | 'month';

export interface AiUsageAggregate {
  id: string;
  label: string;
  requests: number;
  successfulRequests: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  estimatedCostUsd: number;
}

export interface AiUsageResponse {
  period: AiUsagePeriod;
  label: string;
  range: { start: string; end: string };
  pricingUpdatedAt: string;
  totals: AiUsageAggregate & {
    failedRequests: number;
    averageLatencyMs: number;
    providerMeasuredRequests: number;
    estimatedRequests: number;
  };
  series: Array<{
    timestamp: string;
    requests: number;
    tokens: number;
    estimatedCostUsd: number;
  }>;
  byModel: AiUsageAggregate[];
  byAgent: AiUsageAggregate[];
  byProvider: AiUsageAggregate[];
}

export function useAiUsage(period: AiUsagePeriod) {
  return useCrmQuery(['ai', 'usage', period], () =>
    crmFetch<AiUsageResponse>(`/api/ai/usage?period=${period}`)
  );
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

// One request powers the whole dashboard — no per-collection client fetches.
// Polls every 60s so claim/task state stays fresh without a manual refresh.
export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () => {
      try {
        return await crmFetch<DashboardSummary>('/api/dashboard/summary');
      } catch (err) {
        if (err instanceof Error && 'status' in err && err.status === 401) {
          redirectToLogin();
        }
        throw err;
      }
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
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

export function useIdentityInvitations(enabled = true) {
  return useQuery({
    queryKey: ['identity-invitations', 'pending'],
    queryFn: async () => {
      const result = await listIdentityInvitations('pending');
      return result.invitations;
    },
    enabled,
  });
}

export function useCreateIdentityInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: 'manager' | 'member' }) =>
      createIdentityInvitation(email, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['identity-invitations'] }),
  });
}

export function useUpdateIdentityCrmMembership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'manager' | 'member' | null }) =>
      updateIdentityCrmMembership(userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['identity-users'] }),
  });
}

export function useSetIdentityUserEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, enabled }: { userId: string; enabled: boolean }) =>
      setIdentityUserEnabled(userId, enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['identity-users'] }),
  });
}

export function useResendIdentityInvitation() {
  return useMutation({
    mutationFn: (id: string) => resendIdentityInvitation(id),
  });
}

export function useRevokeIdentityInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeIdentityInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['identity-invitations'] }),
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
