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
// rather than introducing a new, unconfigured one. Identity's URL is
// hardcoded rather than env-configured since it's the same constant
// auth.skarion.com referenced by every app in this monorepo.
const CRM_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8788';
const IDENTITY_API_URL = 'https://auth.skarion.com';

let accessToken: string | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const response = await fetch(`${IDENTITY_API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { access_token: string };
  accessToken = data.access_token;
  return accessToken;
}

/** Redirects to the public login app, returning here after a successful login. */
export function redirectToLogin(): void {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${IDENTITY_API_URL}/?return_to=${returnTo}`;
}

async function crmFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
      'Content-Type': 'application/json',
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
        'Content-Type': 'application/json',
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
  ownerId: string;
}

export function listCompanies() {
  return crmFetch<{ companies: Company[] }>('/api/companies');
}
