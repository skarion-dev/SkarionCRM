import type { BooksRole } from './stores/auth.js';

// apps/accounting/web/src/api.ts
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
const _BOOKS_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8790';
// Guard against misconfigured Pages dashboard env vars where VITE_API_URL
// may accidentally be set to the identity/login URL instead of the Books API.
export const BOOKS_API_URL = _BOOKS_API_URL.includes('identity-login') || _BOOKS_API_URL.includes('skarion-identity-login')
  ? 'https://skarion-books-platform.skarion-talentos.workers.dev'
  : _BOOKS_API_URL;
export const IDENTITY_API_URL =
  import.meta.env.VITE_IDENTITY_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://skarion-identity.skarion-talentos.workers.dev');
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

/** Shared refresh: hits identity's /auth/refresh and stores the token in
 *  api.ts's module-level variable. All apps should call this (not raw fetch)
 *  so there's a single source of truth for the access token. */
let refreshPromise: Promise<string | null> | null = null;
let bootstrapPromise: Promise<User | null> | null = null;

/** Shared refresh: hits identity's /auth/refresh and stores the token in
 *  api.ts's module-level variable. All apps should call this (not raw fetch)
 *  so there's a single source of truth for the access token. */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${IDENTITY_API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { access_token: string };
      accessToken = data.access_token;
      return accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/** Bootstraps the auth store by refreshing the token once. Returns the
 *  user payload if the refresh succeeds, null otherwise. Safe to call
 *  from any app's mount effect. */
export async function bootstrapAuth(): Promise<User | null> {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const response = await fetch(`${IDENTITY_API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return null;
      const data = (await response.json()) as AuthResponse;
      accessToken = data.access_token;
      return {
        id: data.user.id,
        email: data.user.email,
        name: data.user.displayName,
        role: (data.user.apps?.books ?? '') as BooksRole,
        isSuperadmin: data.user.isSuperadmin,
      };
    } catch {
      return null;
    } finally {
      bootstrapPromise = null;
    }
  })();

  return bootstrapPromise;
}

/** Redirects to the public login app, returning here after a successful login. */
export function redirectToLogin(): void {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${IDENTITY_LOGIN_URL}/?return_to=${returnTo}`;
}

export async function booksFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) {
    if (bootstrapPromise) {
      const user = await bootstrapPromise;
      if (!user) {
        redirectToLogin();
        throw new ApiError('No session.', 401);
      }
    } else {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        redirectToLogin();
        throw new ApiError('No session.', 401);
      }
    }
  }

  const url = `${BOOKS_API_URL}${path}`;
  const headers = {
    ...(init.body instanceof FormData
      ? {}
      : { 'Content-Type': 'application/json' }),
    Authorization: `Bearer ${accessToken}`,
    ...init.headers,
  };

  let response = await fetch(url, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError('Session expired.', 401);
    }
    response = await fetch(`${BOOKS_API_URL}${path}`, {
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

export interface User {
  id: string;
  email: string;
  name?: string;
  role: BooksRole;
  isSuperadmin: boolean;
}

export interface AppMembership {
  crm?: string;
  books?: string;
  hr?: string;
}

export interface AuthResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    displayName?: string;
    isSuperadmin: boolean;
    apps: AppMembership;
  };
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  balance: string;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  description: string;
  amount: string;
  date: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  number: string;
  customerName: string;
  amount: string;
  status: string;
  dueDate: string;
  createdAt: string;
  updatedAt: string;
}
