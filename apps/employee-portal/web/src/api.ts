const _HR_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8789';
export const HR_API_URL =
  _HR_API_URL.includes('identity-login') || _HR_API_URL.includes('skarion-identity-login')
    ? 'https://skarion-hr-platform.alsaki1999.workers.dev'
    : _HR_API_URL;
export const IDENTITY_API_URL =
  import.meta.env.VITE_IDENTITY_API_URL || 'https://skarion-identity.alsaki1999.workers.dev';
export const IDENTITY_LOGIN_URL =
  import.meta.env.VITE_IDENTITY_LOGIN_URL || 'https://skarion-identity-login.pages.dev';

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

export async function bootstrapAuth(): Promise<{
  id: string;
  email: string;
  name?: string;
  role: string;
  isSuperadmin: boolean;
} | null> {
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
    role: data.user.apps?.hr ?? '',
    isSuperadmin: data.user.isSuperadmin,
  };
}

export function redirectToLogin(): void {
  const returnTo = encodeURIComponent(window.location.href);
  window.location.href = `${IDENTITY_LOGIN_URL}/?return_to=${returnTo}`;
}

async function hrFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError('No session.', 401);
    }
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    ...(!(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string>),
  };

  let response = await fetch(`${HR_API_URL}${path}`, { ...init, headers });
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError('Session expired.', 401);
    }
    headers.Authorization = `Bearer ${accessToken}`;
    response = await fetch(`${HR_API_URL}${path}`, { ...init, headers });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
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
