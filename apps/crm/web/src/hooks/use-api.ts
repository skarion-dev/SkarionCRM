import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmFetch, redirectToLogin, type Company, type Contact, type Lead, type Opportunity, type Task, type Activity } from '../api.js';

function useCrmQuery<T>(key: string[], fetcher: () => Promise<T>) {
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
  });
}

export function useActivities(filters: { contactId?: string; companyId?: string; opportunityId?: string; type?: string }) {
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
      return crmFetch<{ activity: Activity }>('/api/activities', { method: 'POST', body: JSON.stringify(data) });
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

export function useLeads(page: number = 1, pageSize: number = 50, status?: string, search?: string, outreachStatus?: string) {
  const qs = new URLSearchParams();
  qs.append('page', String(page));
  qs.append('pageSize', String(pageSize));
  if (status) qs.append('status', status);
  if (search) qs.append('search', search);
  if (outreachStatus) qs.append('outreachStatus', outreachStatus);
  return useCrmQuery(['leads', String(page), String(pageSize), status ?? '', search ?? '', outreachStatus ?? ''], () =>
    crmFetch<{ leads: Lead[]; page: number; pageSize: number; total: number; totalPages: number; statusCounts: Record<string, number>; outreachStatusCounts: Record<string, number> }>(`/api/leads?${qs.toString()}`)
  );
}

export function useOpportunities() {
  return useCrmQuery(['opportunities'], () => crmFetch<{ opportunities: Opportunity[] }>('/api/opportunities'));
}

export function useTasks() {
  return useCrmQuery(['tasks'], () => crmFetch<{ tasks: Task[] }>('/api/tasks'));
}

export function useLead(id: string) {
  return useCrmQuery(['leads', id], () => crmFetch<{ lead: Lead }>(`/api/leads/${id}`));
}

export function useCompany(id: string) {
  return useCrmQuery(['companies', id], () => crmFetch<{ company: Company }>(`/api/companies/${id}`));
}

export function useContact(id: string) {
  return useCrmQuery(['contacts', id], () => crmFetch<{ contact: Contact }>(`/api/contacts/${id}`));
}

export function useOpportunity(id: string) {
  return useCrmQuery(['opportunities', id], () => crmFetch<{ opportunity: Opportunity }>(`/api/opportunities/${id}`));
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

export function useCreateEntity<T extends Record<string, unknown>>(type: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: T) => {
      return crmFetch<{ [key: string]: unknown }>(`/api/${type}`, { method: 'POST', body: JSON.stringify(data) });
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
      return crmFetch<{ [key: string]: unknown }>(`/api/${type}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
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
      return crmFetch<{ score: number; reasoning: string }>(`/api/leads/${id}/score`, { method: 'POST' });
    },
  });
}

export function useSuggestNextAction(id: string) {
  return useMutation({
    mutationFn: async () => {
      return crmFetch<{ suggestion: string }>(`/api/leads/${id}/suggest-next-action`, { method: 'POST' });
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
  duplicates: { id: string; firstName: string; lastName: string; email: string; phone: string | null }[];
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
    mutationFn: async (data: { lead: Record<string, unknown>; force?: boolean; createCompany?: boolean; createContact?: boolean }) => {
      return crmFetch<{ lead: Lead; contactId: string | null; companyId: string | null }>('/api/leads/import/document/confirm', {
        method: 'POST',
        body: JSON.stringify(data),
      });
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

