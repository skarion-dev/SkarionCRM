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

export function useLeads() {
  return useCrmQuery(['leads'], () => crmFetch<{ leads: Lead[] }>('/api/leads'));
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
