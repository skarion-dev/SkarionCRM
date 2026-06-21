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
export const CRM_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8788';
export const IDENTITY_API_URL = import.meta.env.VITE_IDENTITY_API_URL || 'https://skarion-identity.alsaki1999.workers.dev';
// The login page is a separate Pages site (not the Worker API). Separate env var so
// the redirect goes to the right place while API calls still hit the worker.
export const IDENTITY_LOGIN_URL = import.meta.env.VITE_IDENTITY_LOGIN_URL || IDENTITY_API_URL;


let accessToken: string | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** Shared refresh: hits identity's /auth/refresh and stores the token in
 *  api.ts's module-level variable. All apps should call this (not raw fetch)
 *  so there's a single source of truth for the access token. */
export async function refreshAccessToken(): Promise<string | null> {
  const response = await fetch(`${IDENTITY_API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { access_token: string };
  accessToken = data.access_token;
  return accessToken;
}

/** Bootstraps the auth store by refreshing the token once. Returns the
 *  user payload if the refresh succeeds, null otherwise. Safe to call
 *  from any app's mount effect. */
export async function bootstrapAuth(): Promise<{ id: string; email: string; name?: string; role: string; isSuperadmin: boolean } | null> {
  const response = await fetch(`${IDENTITY_API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    access_token: string;
    user: {
      id: string;
      email: string;
      displayName?: string;
      isSuperadmin: boolean;
      apps: Record<string, string>;
    };
  };
  accessToken = data.access_token;
  return {
    id: data.user.id,
    email: data.user.email,
    name: data.user.displayName,
    role: data.user.apps?.crm ?? '',
    isSuperadmin: data.user.isSuperadmin,
  };
}

/** Redirects to the public login app, returning here after a successful login. */
export function redirectToLogin(): void {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${IDENTITY_LOGIN_URL}/?return_to=${returnTo}`;
}

export async function crmFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError('No session.', 401);
    }
  }

  let response = await fetch(`${CRM_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError('Session expired.', 401);
    }
    response = await fetch(`${CRM_API_URL}${path}`, {
      ...init,
      headers: {
        ...(init.body instanceof FormData
          ? {}
          : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
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
export type LeadSource = 'website' | 'referral' | 'social_media' | 'cold_call' | 'email_campaign' | 'event' | 'pdf_upload' | 'other';

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  companyDomain: string | null;
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
}

export type OpportunityStage = 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function listCompanies() {
  return crmFetch<{ companies: Company[] }>('/api/companies');
}
