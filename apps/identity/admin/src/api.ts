// apps/identity/admin/src/api.ts
// Thin fetch wrapper for the identity API. Access token kept in memory only
// (never localStorage - it's a 15-minute JWT, refreshed via the httpOnly
// refresh-token cookie the identity Worker sets, which this app never reads
// directly). On a 401, attempts one silent refresh+retry before giving up.

const API_URL = import.meta.env.VITE_IDENTITY_API_URL || 'http://localhost:8787';

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await rawFetch(path, init);

  if (response.status === 401 && accessToken) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      response = await rawFetch(path, init);
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(body.error ?? 'Request failed', response.status);
  }

  return response.json() as Promise<T>;
}

async function tryRefresh(): Promise<boolean> {
  const response = await rawFetch('/auth/refresh', { method: 'POST' });
  if (!response.ok) return false;
  const data = (await response.json()) as { access_token: string };
  setAccessToken(data.access_token);
  return true;
}

export { ApiError, tryRefresh };

// ── auth ──
export interface AppMembershipsMap {
  crm?: string;
  hr?: string;
  books?: string;
}

export interface MeResponse {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  apps: AppMembershipsMap;
  isSuperadmin: boolean;
  mfaEnrolled: boolean;
}

export async function login(email: string, password: string, mfaCode?: string) {
  const result = await apiFetch<{
    access_token: string;
    user: { id: string; email: string; displayName: string };
  }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, mfa_code: mfaCode }),
  });
  setAccessToken(result.access_token);
  return result;
}

export async function logout() {
  await rawFetch('/auth/logout', { method: 'POST' });
  setAccessToken(null);
}

export function me() {
  return apiFetch<MeResponse>('/me');
}

// ── admin: users ──
export interface AdminUserRow {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  appMemberships: { app: string; role: string; grantedAt: string }[];
}

export function listUsers() {
  return apiFetch<{ users: AdminUserRow[] }>('/admin/users');
}

export function updateMemberships(
  userId: string,
  memberships: { app: 'crm' | 'hr' | 'books'; role: string | null }[]
) {
  return apiFetch<{ ok: true }>(`/admin/users/${userId}/memberships`, {
    method: 'PATCH',
    body: JSON.stringify({ memberships }),
  });
}

export function disableUser(userId: string) {
  return apiFetch<{ ok: true }>(`/admin/users/${userId}/disable`, { method: 'POST' });
}

export function enableUser(userId: string) {
  return apiFetch<{ ok: true }>(`/admin/users/${userId}/enable`, { method: 'POST' });
}

export function forcePasswordReset(userId: string) {
  return apiFetch<{ ok: true }>(`/admin/users/${userId}/force-password-reset`, { method: 'POST' });
}

// ── admin: audit log ──
export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  app: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

export function listAuditLog(limit = 50, offset = 0) {
  return apiFetch<{ entries: AuditLogEntry[] }>(`/admin/audit-log?limit=${limit}&offset=${offset}`);
}

// ── invitations ──
export interface InvitationRow {
  id: string;
  email: string;
  app: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export function listInvitations(status?: string) {
  return apiFetch<{ invitations: InvitationRow[] }>(
    `/invitations${status ? `?status=${status}` : ''}`
  );
}

export function createInvitation(email: string, app: 'crm' | 'hr' | 'books', role: string) {
  return apiFetch<{ ok: true; invitation_id: string }>('/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, app, role }),
  });
}

export function revokeInvitation(id: string) {
  return apiFetch<{ ok: true }>(`/invitations/${id}/revoke`, { method: 'POST' });
}

export function resendInvitation(id: string) {
  return apiFetch<{ ok: true }>(`/invitations/${id}/resend`, { method: 'POST' });
}

/** Fetch the list of email domains allowed for invitations (no auth needed — public-safe). */
export async function fetchAllowedDomains(): Promise<string[]> {
  const res = await fetch(`${API_URL}/invitations/allowed-domains`);
  if (!res.ok) return [];
  const data = (await res.json()) as { domains: string[] };
  return data.domains ?? [];
}
