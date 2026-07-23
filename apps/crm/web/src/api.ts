// apps/crm/web/src/api.ts
// Access token kept in memory only (never localStorage - it's a 15-minute
// JWT and localStorage is readable by any script on the page, which turns
// one XSS bug into a stolen-session bug). Refreshed via identity's httpOnly
// refresh-token cookie, scoped to the identity domain - this app never
// reads that cookie directly, it just calls identity's /auth/refresh with
// credentials included and the browser attaches the cookie automatically.
// Mirrors apps/identity/admin/src/api.ts and apps/identity/login's pattern.

// VITE_API_URL is already configured as a Cloudflare Pages env var for this
// project (set when the Worker was first deployed) - reusing that name
// rather than introducing a new, unconfigured one. Identity's URL is also
// env-configurable via VITE_IDENTITY_API_URL so it can be changed in one
// place (dashboard env var or local .env) without a grep-and-replace.
const _CRM_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8788';
// Guard against misconfigured Pages dashboard env vars where VITE_API_URL
// may accidentally be set to the identity/login URL instead of the CRM API.
export const CRM_API_URL =
  _CRM_API_URL.includes('identity-login') || _CRM_API_URL.includes('skarion-identity-login')
    ? 'https://skarion-crm-platform.skarion-talentos.workers.dev'
    : _CRM_API_URL;
export const IDENTITY_API_URL =
  import.meta.env.VITE_IDENTITY_API_URL ||
  (import.meta.env.DEV
    ? 'http://localhost:8787'
    : 'https://skarion-identity.skarion-talentos.workers.dev');
// The login page is a separate Pages site (not the Worker API). Separate env var so
// the redirect goes to the right place while API calls still hit the worker.
export const IDENTITY_LOGIN_URL =
  import.meta.env.VITE_IDENTITY_LOGIN_URL ||
  (import.meta.env.DEV ? 'http://localhost:5181' : 'https://skarion-identity-login-4hu.pages.dev');

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn('localStorage is disabled or blocked:', e);
  }
}

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn('localStorage is disabled or blocked:', e);
    return null;
  }
}

function safeStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('localStorage is disabled or blocked:', e);
  }
}

function extractHashTokens(): { accessToken: string; refreshToken: string } | null {
  console.log('[Auth] extractHashTokens: checking hash', window.location.hash ? '(present)' : '(empty)');
  try {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token=')) {
      console.log('[Auth] extractHashTokens: no access_token in hash');
      return null;
    }
    const params = new URLSearchParams(hash.slice(1));
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    console.log('[Auth] extractHashTokens: extracted access_token:', !!access, 'refresh_token:', !!refresh);
    if (access && refresh) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      return { accessToken: access, refreshToken: refresh };
    }
  } catch (err) {
    console.error('[Auth] Failed to extract tokens from hash:', err);
  }
  return null;
}

let refreshPromise: Promise<string | null> | null = null;
let bootstrapPromise: Promise<{
  id: string;
  email: string;
  name?: string;
  role: string;
  isSuperadmin: boolean;
} | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    console.log('[Auth] refreshAccessToken: reusing active refreshPromise');
    return refreshPromise;
  }

  console.log('[Auth] refreshAccessToken: starting token refresh...');
  refreshPromise = (async () => {
    try {
      const localRefreshToken = safeStorageGet('refresh_token');
      console.log('[Auth] refreshAccessToken: local refresh_token exists:', !!localRefreshToken);
      const response = await fetch(`${IDENTITY_API_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: localRefreshToken }),
        credentials: 'include',
      });
      console.log('[Auth] refreshAccessToken: /auth/refresh response status:', response.status, 'ok:', response.ok);
      if (!response.ok) {
        accessToken = null;
        safeStorageRemove('refresh_token');
        return null;
      }
      const data = (await response.json()) as { access_token: string; refresh_token?: string };
      accessToken = data.access_token;
      if (data.refresh_token) {
        console.log('[Auth] refreshAccessToken: saving rotated refresh_token');
        safeStorageSet('refresh_token', data.refresh_token);
      }
      console.log('[Auth] refreshAccessToken: refresh successful');
      return accessToken;
    } catch (err) {
      console.error('[Auth] refreshAccessToken: refresh failed with error:', err);
      accessToken = null;
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function bootstrapAuth(): Promise<{
  id: string;
  email: string;
  name?: string;
  role: string;
  isSuperadmin: boolean;
} | null> {
  if (bootstrapPromise) {
    console.log('[Auth] bootstrapAuth: reusing active bootstrapPromise');
    return bootstrapPromise;
  }

  console.log('[Auth] bootstrapAuth: starting auth bootstrap...');
  bootstrapPromise = (async () => {
    try {
      const hashTokens = extractHashTokens();
      if (hashTokens) {
        console.log('[Auth] bootstrapAuth: hash tokens found, validating...');
        accessToken = hashTokens.accessToken;
        safeStorageSet('refresh_token', hashTokens.refreshToken);
        try {
          console.log('[Auth] bootstrapAuth: fetching /me to validate access token...');
          const response = await fetch(`${IDENTITY_API_URL}/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          console.log('[Auth] bootstrapAuth: /me response status:', response.status, 'ok:', response.ok);
          if (response.ok) {
            const data = await response.json();
            console.log('[Auth] bootstrapAuth: /me validation successful, user:', data.email);
            return {
              id: data.id,
              email: data.email,
              name: data.displayName,
              role: data.apps?.crm ?? '',
              isSuperadmin: data.isSuperadmin,
            };
          } else {
            console.warn('[Auth] bootstrapAuth: /me returned non-ok status:', response.status);
          }
        } catch (meErr) {
          console.error('[Auth] bootstrapAuth: /me fetch failed with error:', meErr);
        }
      }

      console.log('[Auth] bootstrapAuth: no valid hash session, trying refresh token fallback...');
      const localRefreshToken = safeStorageGet('refresh_token');
      console.log('[Auth] bootstrapAuth: local refresh token exists:', !!localRefreshToken);
      const response = await fetch(`${IDENTITY_API_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: localRefreshToken }),
        credentials: 'include',
      });
      console.log('[Auth] bootstrapAuth: fallback /auth/refresh response status:', response.status, 'ok:', response.ok);
      if (!response.ok) {
        console.warn('[Auth] bootstrapAuth: fallback refresh failed, clearing token');
        safeStorageRemove('refresh_token');
        return null;
      }
      const data = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        user: {
          id: string;
          email: string;
          displayName?: string;
          isSuperadmin: boolean;
          apps: Record<string, string>;
        };
      };
      accessToken = data.access_token;
      if (data.refresh_token) {
        console.log('[Auth] bootstrapAuth: saving fallback rotated refresh_token');
        safeStorageSet('refresh_token', data.refresh_token);
      }
      console.log('[Auth] bootstrapAuth: fallback refresh successful, user:', data.user.email);
      return {
        id: data.user.id,
        email: data.user.email,
        name: data.user.displayName,
        role: data.user.apps?.crm ?? '',
        isSuperadmin: data.user.isSuperadmin,
      };
    } catch (err) {
      console.error('[Auth] bootstrapAuth: bootstrap process failed with error:', err);
      return null;
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

export function redirectToLogin(): void {
  const returnTo = encodeURIComponent(window.location.href);
  console.log('[Auth] redirectToLogin: redirecting to login with returnTo:', window.location.href);
  window.location.href = `${IDENTITY_LOGIN_URL}/?return_to=${returnTo}`;
}

export async function crmFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  console.log(`[API] crmFetch: request to ${path}`);
  if (!accessToken) {
    console.log('[API] crmFetch: no access token in memory');
    if (bootstrapPromise) {
      console.log('[API] crmFetch: awaiting active bootstrapPromise...');
      const user = await bootstrapPromise;
      if (!user) {
        console.warn('[API] crmFetch: bootstrap resolved to null, redirecting...');
        redirectToLogin();
        throw new ApiError('No session.', 401);
      }
    } else {
      console.log('[API] crmFetch: no bootstrapPromise, triggering refresh...');
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        console.warn('[API] crmFetch: refresh returned null, redirecting...');
        redirectToLogin();
        throw new ApiError('No session.', 401);
      }
    }
  }

  const url = `${CRM_API_URL}${path}`;
  const headers = {
    ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    Authorization: `Bearer ${accessToken}`,
    ...init.headers,
  };

  console.log(`[API] crmFetch: fetching ${url}...`);
  let response = await fetch(url, {
    ...init,
    headers,
  });
  console.log(`[API] crmFetch: ${path} response status:`, response.status);

  if (response.status === 401) {
    console.log('[API] crmFetch: token unauthorized (401), refreshing...');
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      console.warn('[API] crmFetch: refresh failed on 401, redirecting...');
      redirectToLogin();
      throw new ApiError('Session expired.', 401);
    }
    console.log(`[API] crmFetch: retrying ${path} with new token...`);
    response = await fetch(`${CRM_API_URL}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });
    console.log(`[API] crmFetch: retried ${path} response status:`, response.status);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    console.error(`[API] crmFetch: request to ${path} failed:`, body.error);
    throw new ApiError(body.error ?? 'Request failed', response.status);
  }
  return response.json() as Promise<T>;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  address: unknown;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'disqualified' | 'converted';
export type LeadSource =
  | 'website'
  | 'referral'
  | 'social_media'
  | 'cold_call'
  | 'email_campaign'
  | 'event'
  | 'pdf_upload'
  | 'other';
export type OutreachStatus =
  | 'not_approached'
  | 'approached'
  | 'connection_request_sent'
  | 'in_conversation'
  | 'connected'
  | 'replied'
  | 'booked_call'
  | 'not_interested'
  | 'bad_fit';

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  outreachStatus: string | null;
  approachedAt: string | null;
  connectionStatus: string | null;
  sourceSheet: string | null;
  originalRowNumber: number | null;
  tags: string[] | null;
  source: LeadSource;
  status: LeadStatus;
  notes: string | null;
  ownerId: string;
  convertedToContactId: string | null;
  convertedToCompanyId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  leadNumber?: string;
  batchId?: string | null;
}

export type OpportunityStage =
  | 'prospecting'
  | 'qualification'
  | 'proposal'
  | 'negotiation'
  | 'closed_won'
  | 'closed_lost';
export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY' | 'AED' | 'SAR';

export interface Opportunity {
  id: string;
  name: string;
  companyId: string | null;
  contactId: string | null;
  stage: OpportunityStage;
  amount: string | null;
  currency: Currency;
  expectedCloseDate: string | null;
  probability: number | null;
  notes: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ActivityType = 'call' | 'email' | 'meeting' | 'note';

export interface Activity {
  id: string;
  type: ActivityType;
  subject: string;
  content: string | null;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  actorId: string;
  happenedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  assigneeId: string;
  contactId: string | null;
  companyId: string | null;
  opportunityId: string | null;
  completedAt: string | null;
  completedBy: string | null;
  priority: string;
  type?: string;
  leadId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function listCompanies() {
  return crmFetch<{ companies: Company[] }>('/api/companies');
}

// ─── Outreach channels / attachments / import batches ───

export type OutreachChannel =
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'whatsapp'
  | 'email'
  | 'phone';
export type LeadChannelStage =
  | 'not_started'
  | 'connection_request_sent'
  | 'connection_accepted'
  | 'message_sent'
  | 'awaiting_reply'
  | 'in_conversation'
  | 'warm_up_needed'
  | 'replied'
  | 'booked_call'
  | 'no_response';

export interface LeadChannel {
  id: string;
  leadId: string;
  channel: OutreachChannel;
  stage: LeadChannelStage;
  attemptCount: number;
  lastAttemptAt: string | null;
  nextFollowupAt: string | null;
  sequence: number;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadAttachment {
  id: string;
  leadId: string;
  filename: string;
  mimeType: string;
  size: number;
  r2Key: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ImportBatch {
  id: string;
  name: string;
  importedByUserId: string;
  source: string;
  totalRows: number;
  importedCount: number;
  duplicatesSkipped: number;
  defaultTags: string[] | null;
  createdAt: string;
}

export function getLeadChannels(id: string) {
  return crmFetch<{ channels: LeadChannel[] }>(`/api/leads/${id}/channels`);
}

export function logOutreachAction(
  leadId: string,
  body: { channel: string; stage?: string; action?: 'log_attempt' | 'set_stage' }
) {
  return crmFetch(`/api/leads/${leadId}/outreach-actions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getAttachments(leadId: string) {
  return crmFetch<{ attachments: LeadAttachment[] }>(`/api/leads/${leadId}/attachments`);
}

export function uploadAttachment(leadId: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return crmFetch(`/api/leads/${leadId}/attachments`, { method: 'POST', body: formData });
}

export function deleteAttachment(id: string) {
  return crmFetch(`/api/leads/attachments/${id}`, { method: 'DELETE' });
}

export function listImportBatches() {
  return crmFetch<{ batches: ImportBatch[] }>('/api/import-batches');
}

// ─── Identity users (for superadmin/manager assignment) ───

export interface IdentityUser {
  id: string;
  email: string;
  displayName: string;
  appMemberships: { app: string; role: string; grantedAt: string }[];
}

/** Fetch the list of users from the identity /admin/users endpoint. Only
 *  callable by platform admins; non-admins should treat a 403 as "empty". */
export async function listIdentityUsers(): Promise<{ users: IdentityUser[] }> {
  if (!accessToken) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError('No session.', 401);
    }
  }
  const url = `${IDENTITY_API_URL}/admin/users`;
  let response = await fetch(url, {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError('Session expired.', 401);
    }
    response = await fetch(url, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(body.error ?? 'Request failed', response.status);
  }
  return response.json() as Promise<{ users: IdentityUser[] }>;
}

// ─── Workflow rules (outreach_stale cadence) ───

export interface WorkflowRule {
  id: string;
  name: string;
  trigger: 'lead_created' | 'opportunity_stale' | 'task_due_soon' | 'outreach_stale';
  conditions: {
    channel?: string;
    afterAttempts?: number;
    waitDays?: number;
    nextChannel?: string;
    [key: string]: unknown;
  };
  actions: { kind?: string; taskTitle?: string; taskPriority?: string; [key: string]: unknown };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export function listWorkflowRules() {
  return crmFetch<{ workflowRules: WorkflowRule[] }>('/api/workflow-rules');
}
export function createWorkflowRule(data: Partial<WorkflowRule>) {
  return crmFetch<{ workflowRule: WorkflowRule }>('/api/workflow-rules', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
export function updateWorkflowRule(id: string, data: Partial<WorkflowRule>) {
  return crmFetch<{ workflowRule: WorkflowRule }>(`/api/workflow-rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
export function deleteWorkflowRule(id: string) {
  return crmFetch<{ success: boolean }>(`/api/workflow-rules/${id}`, { method: 'DELETE' });
}
