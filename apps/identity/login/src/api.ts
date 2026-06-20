// apps/identity/login/src/api.ts
// Minimal API client for the public login app - only the auth endpoints
// this app actually needs.

const API_URL = import.meta.env.VITE_IDENTITY_API_URL || 'http://localhost:8787';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(body.error ?? 'Request failed', response.status);
  }
  return response.json() as Promise<T>;
}

export interface AppMembershipsMap {
  crm?: string;
  hr?: string;
  books?: string;
}

export function login(email: string, password: string, mfaCode?: string) {
  return apiFetch<{
    access_token: string;
    user: { id: string; email: string; displayName: string };
  }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, mfa_code: mfaCode }),
  });
}

export function me(accessToken: string) {
  return apiFetch<{ apps: AppMembershipsMap }>('/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function forgotPassword(email: string) {
  return apiFetch<{ ok: true; message: string }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, newPassword: string) {
  return apiFetch<{ ok: true }>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

export function acceptInvitation(token: string, password: string, displayName: string) {
  return apiFetch<{
    access_token: string;
    user: { id: string; email: string; displayName: string };
  }>('/invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ token, password, display_name: displayName }),
  });
}
