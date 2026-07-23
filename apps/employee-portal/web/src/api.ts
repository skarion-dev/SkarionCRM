const _HR_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8789';
export const HR_API_URL =
  _HR_API_URL.includes('identity-login') || _HR_API_URL.includes('skarion-identity-login')
    ? 'https://skarion-hr-platform.skarion-talentos.workers.dev'
    : _HR_API_URL;
export const IDENTITY_API_URL =
  import.meta.env.VITE_IDENTITY_API_URL ||
  (import.meta.env.DEV ? 'http://localhost:8787' : 'https://skarion-identity.skarion-talentos.workers.dev');
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
              role: data.apps?.hr ?? '',
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
        role: data.user.apps?.hr ?? '',
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

async function hrFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  console.log(`[API] hrFetch: request to ${path}`);
  if (!accessToken) {
    console.log('[API] hrFetch: no access token in memory');
    if (!bootstrapPromise) {
      console.log('[API] hrFetch: bootstrapPromise is null, triggering bootstrapAuth...');
      bootstrapAuth();
    }
    console.log('[API] hrFetch: awaiting bootstrapPromise...');
    const user = await bootstrapPromise;
    if (!user) {
      console.warn('[API] hrFetch: bootstrap resolved to null, redirecting...');
      redirectToLogin();
      throw new ApiError('No session.', 401);
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...(!(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string>),
  };

  console.log(`[API] hrFetch: fetching ${HR_API_URL}${path}...`);
  let response = await fetch(`${HR_API_URL}${path}`, { ...init, headers });
  console.log(`[API] hrFetch: ${path} response status:`, response.status);

  if (response.status === 401) {
    console.log('[API] hrFetch: token unauthorized (401), refreshing...');
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      console.warn('[API] hrFetch: refresh failed on 401, redirecting...');
      redirectToLogin();
      throw new ApiError('Session expired.', 401);
    }
    headers.Authorization = `Bearer ${accessToken}`;
    console.log(`[API] hrFetch: retrying ${path} with new token...`);
    response = await fetch(`${HR_API_URL}${path}`, { ...init, headers });
    console.log(`[API] hrFetch: retried ${path} response status:`, response.status);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    console.error(`[API] hrFetch: request to ${path} failed:`, body.error);
    throw new ApiError(body.error ?? 'Request failed', response.status);
  }
  return response.json() as Promise<T>;
}

export interface Department {
  id: string;
  name: string;
  description: string | null;
  managerUserId: string | null;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Employee {
  id: string;
  userId: string;
  employeeNumber: string | null;
  departmentId: string | null;
  position: string | null;
  hireDate: string | null;
  salary: number | null;
  salaryCurrency: string;
  employmentType: string;
  emergencyContact: unknown;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TimeOffRequest {
  id: string;
  employeeId: string;
  type: 'vacation' | 'sick' | 'personal' | 'bereavement' | 'other';
  startDate: string;
  endDate: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function listDepartments(search?: string) {
  const params = search ? `?search=${encodeURIComponent(search)}` : '';
  return hrFetch<{ departments: Department[] }>(`/api/departments${params}`);
}
export function getDepartment(id: string) {
  return hrFetch<{ department: Department }>(`/api/departments/${id}`);
}
export function createDepartment(data: Partial<Department>) {
  return hrFetch<{ department: Department }>('/api/departments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
export function updateDepartment(id: string, data: Partial<Department>) {
  return hrFetch<{ department: Department }>(`/api/departments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
export function deleteDepartment(id: string) {
  return hrFetch<{ success: boolean }>(`/api/departments/${id}`, { method: 'DELETE' });
}

export function listEmployees(search?: string, departmentId?: string) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (departmentId) params.set('departmentId', departmentId);
  return hrFetch<{ employees: Employee[] }>(`/api/employees?${params.toString()}`);
}
export function getEmployee(id: string) {
  return hrFetch<{ employee: Employee }>(`/api/employees/${id}`);
}
export function createEmployee(data: Partial<Employee>) {
  return hrFetch<{ employee: Employee }>('/api/employees', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
export function updateEmployee(id: string, data: Partial<Employee>) {
  return hrFetch<{ employee: Employee }>(`/api/employees/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
export function deleteEmployee(id: string) {
  return hrFetch<{ success: boolean }>(`/api/employees/${id}`, { method: 'DELETE' });
}

export function listTimeOff(status?: string, employeeId?: string) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (employeeId) params.set('employeeId', employeeId);
  return hrFetch<{ timeOffRequests: TimeOffRequest[] }>(`/api/time-off?${params.toString()}`);
}
export function createTimeOff(data: {
  type: string;
  startDate: string;
  endDate: string;
  reason?: string;
}) {
  return hrFetch<{ timeOffRequest: TimeOffRequest }>('/api/time-off', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
export function reviewTimeOff(id: string, status: 'approved' | 'rejected') {
  return hrFetch<{ timeOffRequest: TimeOffRequest }>(`/api/time-off/${id}/review`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}
export function deleteTimeOff(id: string) {
  return hrFetch<{ success: boolean }>(`/api/time-off/${id}`, { method: 'DELETE' });
}
