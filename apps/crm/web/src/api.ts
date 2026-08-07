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

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: string;
  isSuperadmin: boolean;
}

type AuthChannelMessage =
  | { type: 'session-request'; requestId: string }
  | { type: 'session-response'; requestId: string; accessToken: string }
  | { type: 'session-updated'; accessToken: string };

const authChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('skarion-crm-auth');

function publishAccessToken(token: string): void {
  authChannel?.postMessage({
    type: 'session-updated',
    accessToken: token,
  } satisfies AuthChannelMessage);
}

function requestPeerAccessToken(timeoutMs = 650): Promise<string | null> {
  if (!authChannel) return Promise.resolve(null);

  const requestId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const finish = (token: string | null) => {
      window.clearTimeout(timeout);
      authChannel.removeEventListener('message', handleMessage);
      resolve(token);
    };
    const handleMessage = (event: MessageEvent<AuthChannelMessage>) => {
      const message = event.data;
      if (message.type === 'session-response' && message.requestId === requestId) {
        finish(message.accessToken);
      }
    };
    const timeout = window.setTimeout(() => finish(null), timeoutMs);

    authChannel.addEventListener('message', handleMessage);
    authChannel.postMessage({ type: 'session-request', requestId } satisfies AuthChannelMessage);
  });
}

authChannel?.addEventListener('message', (event: MessageEvent<AuthChannelMessage>) => {
  const message = event.data;
  if (message.type === 'session-request' && accessToken) {
    authChannel.postMessage({
      type: 'session-response',
      requestId: message.requestId,
      accessToken,
    } satisfies AuthChannelMessage);
  } else if (message.type === 'session-updated') {
    // Access JWTs stay in memory. This keeps already-open tabs synchronized
    // after one tab refreshes without exposing the token to persistent storage.
    accessToken = message.accessToken;
  }
});

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
  console.log(
    '[Auth] extractHashTokens: checking hash',
    window.location.hash ? '(present)' : '(empty)'
  );
  try {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token=')) {
      console.log('[Auth] extractHashTokens: no access_token in hash');
      return null;
    }
    const params = new URLSearchParams(hash.slice(1));
    const access = params.get('access_token');
    const refresh = params.get('refresh_token');
    console.log(
      '[Auth] extractHashTokens: extracted access_token:',
      !!access,
      'refresh_token:',
      !!refresh
    );
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

interface RefreshedSession {
  access_token: string;
  refresh_token?: string;
  user: {
    id: string;
    email: string;
    displayName?: string;
    isSuperadmin: boolean;
    apps: Record<string, string>;
  };
}

async function validateAccessToken(token: string): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${IDENTITY_API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;

    const data = await response.json();
    return {
      id: data.id,
      email: data.email,
      name: data.displayName,
      role: data.apps?.crm ?? '',
      isSuperadmin: data.isSuperadmin,
    };
  } catch (err) {
    console.error('[Auth] Failed to validate access token:', err);
    return null;
  }
}

async function requestRefreshedSession(): Promise<RefreshedSession | null> {
  const refresh = async (): Promise<RefreshedSession | null> => {
    let refreshTokenUsed = safeStorageGet('refresh_token');

    const request = (token: string | null) =>
      fetch(`${IDENTITY_API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: token }),
        credentials: 'include',
      });

    let response = await request(refreshTokenUsed);
    if (!response.ok) {
      // Another CRM tab may have rotated the shared refresh token while this
      // request was in flight. Retry with the newer value instead of clearing
      // the valid session and forcing every tab back through password login.
      const newerToken = safeStorageGet('refresh_token');
      if (newerToken && newerToken !== refreshTokenUsed) {
        refreshTokenUsed = newerToken;
        response = await request(refreshTokenUsed);
      }
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        if (safeStorageGet('refresh_token') === refreshTokenUsed) {
          safeStorageRemove('refresh_token');
        }
        accessToken = null;
        return null;
      }
      throw new ApiError('Session service is temporarily unavailable.', response.status);
    }

    const data = (await response.json()) as RefreshedSession;
    accessToken = data.access_token;
    if (data.refresh_token) safeStorageSet('refresh_token', data.refresh_token);
    publishAccessToken(data.access_token);
    return data;
  };

  // Refresh tokens rotate after every use. Serialize refreshes across tabs so
  // opening several CRM records cannot invalidate the token another tab just
  // read. Chrome and other modern browsers provide this origin-scoped lock.
  if (navigator.locks) {
    return navigator.locks.request('skarion-crm-session-refresh', refresh);
  }
  return refresh();
}

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) {
    console.log('[Auth] refreshAccessToken: reusing active refreshPromise');
    return refreshPromise;
  }

  console.log('[Auth] refreshAccessToken: starting token refresh...');
  refreshPromise = (async () => {
    try {
      const session = await requestRefreshedSession();
      return session?.access_token ?? null;
    } catch (err) {
      console.error('[Auth] refreshAccessToken: refresh failed with error:', err);
      // A transient Identity/network failure is not a logout. Preserve the
      // browser session and let the caller retry instead of deleting tokens
      // or forcing the user through the password form.
      throw err;
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
        const hashUser = await validateAccessToken(hashTokens.accessToken);
        if (hashUser) {
          console.log('[Auth] bootstrapAuth: hash token validation successful:', hashUser.email);
          publishAccessToken(hashTokens.accessToken);
          return hashUser;
        }
      }

      // A newly opened CRM tab has no in-memory JWT. Ask an authenticated tab
      // on the same origin for its short-lived token before rotating the shared
      // refresh token or sending the user back through the login form.
      console.log('[Auth] bootstrapAuth: requesting session from an open CRM tab...');
      const peerToken = await requestPeerAccessToken();
      if (peerToken) {
        const peerUser = await validateAccessToken(peerToken);
        if (peerUser) {
          accessToken = peerToken;
          console.log('[Auth] bootstrapAuth: peer session accepted:', peerUser.email);
          return peerUser;
        }
      }

      console.log('[Auth] bootstrapAuth: no valid hash session, trying refresh token fallback...');
      const data = await requestRefreshedSession();
      if (!data) {
        console.warn('[Auth] bootstrapAuth: fallback refresh failed, clearing token');
        return null;
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

async function crmRequest(path: string, init: RequestInit = {}): Promise<Response> {
  console.log(`[API] crmFetch: request to ${path}`);
  if (!accessToken) {
    console.log('[API] crmFetch: no access token in memory');
    if (!bootstrapPromise) {
      console.log('[API] crmFetch: bootstrapPromise is null, triggering bootstrapAuth...');
      bootstrapAuth();
    }
    console.log('[API] crmFetch: awaiting bootstrapPromise...');
    const user = await bootstrapPromise;
    if (!user) {
      console.warn('[API] crmFetch: bootstrap resolved to null, redirecting...');
      redirectToLogin();
      throw new ApiError('No session.', 401);
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
    let refreshed: string | null;
    try {
      refreshed = await refreshAccessToken();
    } catch {
      throw new ApiError('Your session could not be refreshed. Please retry.', 503);
    }
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
  return response;
}

export async function crmFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await crmRequest(path, init);
  return response.json() as Promise<T>;
}

export async function crmStream(path: string, init: RequestInit = {}): Promise<Response> {
  return crmRequest(path, init);
}

export async function identityFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) {
    if (!bootstrapPromise) bootstrapAuth();
    const user = await bootstrapPromise;
    if (!user) {
      redirectToLogin();
      throw new ApiError('No session.', 401);
    }
  }

  const request = () =>
    fetch(`${IDENTITY_API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${accessToken}`,
        ...init.headers,
      },
    });

  let response = await request();
  if (response.status === 401) {
    let refreshed: string | null;
    try {
      refreshed = await refreshAccessToken();
    } catch {
      throw new ApiError('Your session could not be refreshed. Please retry.', 503);
    }
    if (!refreshed) {
      redirectToLogin();
      throw new ApiError('Session expired.', 401);
    }
    response = await request();
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
  website?: string | null;
  linkedinUrl?: string | null;
  researchStatus?: string | null;
  researchedAt?: string | null;
  researchSummary?: string | null;
  researchSources?: unknown;
}

export type CompanyPersonCategory = 'recruiter' | 'hiring_manager' | 'company_leadership';

export interface CompanyPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  display_name: string;
  headline: string | null;
  about?: string | null;
  location: string | null;
  email: string | null;
  phone?: string | null;
  linkedin_url: string | null;
  linkedin_profile_key?: string | null;
  current_title: string | null;
  current_company_id: string | null;
  current_company_name: string | null;
  experience?: unknown;
  education?: unknown;
  skills?: unknown;
  current_role_dates?: unknown;
  open_to_work?: boolean | null;
  years_experience?: number | null;
  connection_degree?: string | null;
  notes?: string | null;
  tags?: unknown;
  source?: string;
  status?: string;
  outreach_status?: string;
  journey_stage?: string;
  profile_capture_status?: string;
  profile_normalization_status?: string;
  data_completeness?: number;
  captured_by_api_key_label?: string | null;
  owner_id: string;
  last_captured_at: string | null;
  created_at: string;
  updated_at: string;
  categories: string[];
}

export interface CompanyPersonCapture { id: string; captured_by?: string; captured_by_api_key_label?: string | null; payload_hash?: string | null; created_at: string; }
export interface CompanyPersonActivity { id: string; type: string; subject?: string | null; notes?: string | null; occurred_at: string; created_by: string; created_at: string; }

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

export type LeadJourneyStage =
  | 'future'
  | 'foreign_national'
  | 'stem'
  | 'new'
  | 'ready_to_reach_out'
  | 'ready_for_email'
  | 'connection_sent'
  | 'connected'
  | 'engaged'
  | 'qualified'
  | 'meeting_booked'
  | 'opportunity'
  | 'follow_up'
  | 'converted'
  | 'nurture'
  | 'no_response'
  | 'disqualified'
  | 'lost';
/** Compatibility alias while older components and integrations migrate. */
export type LeadStatus = LeadJourneyStage;
export type LeadSource =
  | 'linkedin'
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

export interface LeadEducationEntry {
  institution: string;
  degree: string | null;
  fieldOfStudy: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export interface LeadExperienceEntry {
  title: string;
  organization: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
}

export interface Lead {
  id: string;
  workspaceId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  headline: string | null;
  location: string | null;
  about: string | null;
  experience: string | null;
  education: string | null;
  skills: string | null;
  currentRole: string | null;
  currentRoleDates: string | null;
  openToWork: boolean | null;
  yearsExperience: string | null;
  connectionDegree: string | null;
  prospectSourceContext: Record<string, string | null> | null;
  profileSummary: string | null;
  educationEntries: LeadEducationEntry[] | null;
  mostRecentSchool: string | null;
  mostRecentDegree: string | null;
  mostRecentFieldOfStudy: string | null;
  mostRecentEducationStartDate: string | null;
  mostRecentGraduationDate: string | null;
  mostRecentGraduationYear: number | null;
  experienceEntries: LeadExperienceEntry[] | null;
  skillNames: string[] | null;
  profileNormalizationStatus: 'not_queued' | 'pending' | 'processing' | 'completed' | 'failed';
  profileNormalizationVersion: number;
  profileNormalizationWarnings: string[] | null;
  profileNormalizedAt: string | null;
  companyName: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  linkedinProfileKey: string | null;
  leadSequence: number | null;
  reviewState: 'pending' | 'accepted' | 'rejected';
  reviewDisposition:
    | 'excellent_fit'
    | 'maybe'
    | 'worth_trying'
    | 'future'
    | 'foreign_national'
    | 'disqualified'
    | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  profileCaptureStatus: 'not_captured' | 'processing' | 'captured' | 'partial' | 'failed';
  lastCapturedAt: string | null;
  dataCompleteness: number;
  rowVersion: number;
  outreachStatus: string | null;
  approachedAt: string | null;
  connectionStatus: string | null;
  sourceSheet: string | null;
  originalRowNumber: number | null;
  tags: string[] | null;
  source: LeadSource;
  status: string;
  journeyStage: LeadJourneyStage;
  notes: string | null;
  ownerId: string;
  capturedByApiKeyId: string | null;
  capturedByApiKeyLabel: string | null;
  convertedToContactId: string | null;
  convertedToCompanyId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  leadNumber?: string;
  batchId?: string | null;
  aiScore?: number | null;
  aiClassification?: string | null;
  aiReasoningSummary?: string | null;
  aiRecommendedAction?: string | null;
  scoreJobStatus?: string | null;
  scoreJobError?: string | null;
  isPhd?: boolean;
}

export interface Prospect extends Lead {
  claimedBy: string | null;
  claimExpiresAt: string | null;
}

export interface ReportingSeriesItem {
  label: string;
  value: number;
  secondaryValue?: number;
  currency?: string;
}

export interface DashboardSummaryMineTask {
  id: string;
  title: string;
  dueDate: string | null;
  priority: string;
  type: string | null;
}

export interface DashboardSummaryOutreachDue {
  leadId: string;
  channel: string;
  channelStage: string;
  nextFollowupAt: string | null;
  leadName: string;
  journeyStage: string | null;
}

export interface DashboardSummaryRecentLead {
  id: string;
  name: string;
  email: string | null;
  journeyStage: string | null;
  status: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  scope: 'team' | 'mine';
  generatedAt: string;
  reportingWindowDays: number;
  totals: {
    leads: number;
    contacts: number;
    companies: number;
    opportunities: number;
    openTasks: number;
    overdueTasks: number;
    activitiesInWindow: number;
    leadsCreatedInWindow: number;
    averageLeadScore: number | null;
    linkedinConversations: number;
    linkedinMessages: number;
    leadsWithLinkedinConversations: number;
    lastLinkedinMessageAt: string | null;
  };
  leadsByStatus: ReportingSeriesItem[];
  leadsBySource: ReportingSeriesItem[];
  leadClassifications: ReportingSeriesItem[];
  opportunitiesByStage: ReportingSeriesItem[];
  tasksByPriority: ReportingSeriesItem[];
  recentLeads: Array<{
    name: string;
    company: string | null;
    status: string;
    source: string;
    createdAt: string;
  }>;
  recentLinkedinConversations: Array<{
    leadName: string;
    messageCount: number;
    outboundCount: number;
    lastMessageAt: string;
    lastMessageFromUs: boolean;
    lastMessagePreview: string;
  }>;
  upcomingOpportunities: Array<{
    name: string;
    stage: string;
    amount: number | null;
    currency: string;
    probability: number | null;
    expectedCloseDate: string | null;
  }>;
  prospectsPendingReview: number;
  mine: {
    openTasks: number;
    overdueTasks: number;
    dueTodayTasks: number;
    tasks: DashboardSummaryMineTask[];
    outreachDue: DashboardSummaryOutreachDue[];
    recentAcceptedLeads: DashboardSummaryRecentLead[];
  };
}

export interface DashboardProspectOperations {
  generatedAt: string;
  scope: 'team' | 'mine';
  windows: Array<{
    label: '24h' | '12h' | '3d' | '7d';
    ingested: number;
    reviewed: number;
    accepted: number;
    disqualified: number;
    pending: number;
  }>;
  scoreBands: Array<{ band: string; count: number }>;
  ingestion: Array<{
    hour: string;
    actor: string;
    count: number;
    firstAt: string;
    lastAt: string;
  }>;
  imports: Array<{
    id: string;
    name: string;
    status: string;
    actor: string;
    totalRows: number;
    processedRows: number;
    createdCount: number;
    duplicateCount: number;
    invalidCount: number;
    createdAt: string;
    completedAt: string | null;
  }>;
  queue: {
    pendingReview: number;
    cleanupActive: number;
    cleanupCompleted: number;
    accepted: number;
    acceptedUnscored: number;
  };
  captureWindows: Array<{
    label: '24h' | '7d' | '30d';
    captures: number;
    fresh: number;
    recaptures: number;
    uniqueLeads: number;
    avgLatencyMinutes: number;
  }>;
  captureTrend: Array<{ day: string; captures: number; fresh: number; recaptures: number }>;
  recentCaptures: Array<{
    id: string;
    leadId: string;
    name: string;
    company: string | null;
    actor: string;
    source: string;
    capturedAt: string;
    leadCreatedAt: string;
    isFresh: boolean;
    profileCaptureStatus: string;
    dataCompleteness: number;
  }>;
  captureActivity: Array<{
    hour: string;
    actor: string;
    captures: number;
    fresh: number;
    firstAt: string;
    lastAt: string;
  }>;
  captureTokens: Array<{
    id: string;
    label: string;
    email: string | null;
    issuedAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    captures: number;
    freshCaptures: number;
    uniqueLeads: number;
    leadsCreated: number;
    captures24h: number;
    captures7d: number;
    firstCaptureAt: string | null;
    lastCaptureAt: string | null;
  }>;
  captureTokenTrend: Array<{
    tokenId: string;
    day: string;
    captures: number;
    fresh: number;
  }>;
}

export interface ProspectImportJob {
  id: string;
  batchId: string | null;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalRows: number;
  processedRows: number;
  createdCount: number;
  duplicateCount: number;
  invalidCount: number;
  errorRows: Array<{ row: number; error: string }> | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TagDefinition {
  id: string;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadAiAssessment {
  leadId: string;
  overallScore: number;
  rawScore: number;
  classification: string;
  confidenceLevel: string;
  profileEvidenceQuality: 'strong' | 'usable' | 'thin' | 'insufficient';
  marketEntryTiming: 'now' | 'within_6_months' | 'six_to_18_months' | 'future' | 'unknown';
  candidateNeedEvidence: 'explicit' | 'probable' | 'none';
  scoreBreakdown: Record<string, number>;
  verifiedPositiveSignals: string[];
  risksOrMissingInformation: string[];
  hardDisqualifier: boolean;
  hardDisqualifierReason: string | null;
  campaignMatches: string[];
  recommendedAction: string;
  bestOutreachAngle: string;
  qualificationQuestions: string[];
  reasoningSummary: string;
  connectionNote: string | null;
  connectionNoteCharacterCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateOutreachDraft {
  channel: 'inmail' | 'email';
  subject: string;
  body: string;
  wordCount: number;
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
  leadId: string | null;
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
  // null = unassigned, sitting in the open-claim pool on the task board.
  assigneeId: string | null;
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

export interface DashboardData {
  observedAt: string;
  kpis: {
    pendingProspects: number;
    availableProspects: number;
    activeLeads: number;
    readyToReachOut: number;
    connectionSent: number;
    engaged: number;
    openTasks: number;
    overdueTasks: number;
  };
  prospectReview: {
    pending: number;
    available: number;
    captured: number;
    needsCapture: number;
    unscored: number;
    averageScore: number;
  };
  journey: Array<{ stage: LeadJourneyStage; count: number }>;
  queues: {
    profile: DashboardQueueSummary;
    scoring: DashboardQueueSummary;
  };
  linkedinSync: {
    lastMessageDump: {
      id: string;
      status: string;
      totalRows: number;
      newItems: number;
      matchedItems: number;
      ignoredItems: number;
      flaggedItems: number;
      originalFilename: string;
      details: { conversations?: number; recoveredLegacyImport?: boolean };
      createdAt: string;
      completedAt: string | null;
    } | null;
    lastInvitationDump: {
      id: string;
      status: string;
      totalRows: number;
      newItems: number;
      matchedItems: number;
      ignoredItems: number;
      flaggedItems: number;
      createdAt: string;
      completedAt: string | null;
    } | null;
    openFlags: number;
    messageReconciliation: {
      conversations: number;
      linkedConversations: number;
      unlinkedConversations: number;
      conversationMessages: number;
      storedMessages: number;
      leadsWithStoredMessages: number;
      visibleActivities: number;
      leadsWithVisibleActivities: number;
      latestImport: {
        id: string;
        status: string;
        conversations: number;
        newMessages: number;
        loggedMessages: number;
        ignoredMessages: number;
        flaggedConversations: number;
        createdAt: string;
        completedAt: string | null;
      } | null;
    };
    queues: {
      messages: DashboardQueueSummary;
      invitations: DashboardQueueSummary;
    };
  };
  priorityLeads: DashboardLead[];
  recentLeads: Array<
    Pick<
      DashboardLead,
      'id' | 'leadNumber' | 'firstName' | 'lastName' | 'linkedinUrl' | 'journeyStage'
    > & {
      createdAt: string;
      aiScore: number | null;
    }
  >;
  tasks: Array<Pick<Task, 'id' | 'title' | 'priority' | 'dueDate' | 'assigneeId'>>;
  aiUsage: {
    period: string;
    requests: number;
    failedRequests: number;
    tokens: number;
    costUsd: number;
    defaultModel: string;
  } | null;
}

export interface DashboardQueueSummary {
  active: number;
  waiting: number;
  processing: number;
  retrying: number;
  completed24h: number;
  latestCompletedAt: string | null;
}

export interface DashboardLead {
  id: string;
  leadNumber: string | null;
  firstName: string;
  lastName: string;
  headline: string | null;
  linkedinUrl: string | null;
  journeyStage: LeadJourneyStage;
  score: number;
  reasoningSummary: string;
  recommendedAction: string;
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

export interface ActivityLogEntry {
  id: string;
  actorUserId: string | null;
  app: string;
  action: string;
  resourceType: string;
  resourceId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ActivityLogResponse {
  logs: ActivityLogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filters: {
    actions: string[];
    resourceTypes: string[];
  };
}

export function listActivityLogs(filters: {
  page?: number;
  pageSize?: number;
  action?: string;
  resourceType?: string;
  actorUserId?: string;
  search?: string;
  from?: string;
  to?: string;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return crmFetch<ActivityLogResponse>(`/api/admin/activity-logs?${query.toString()}`);
}

// ─── Identity users (for superadmin/manager assignment) ───

export interface IdentityUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  appMemberships: { app: string; role: string; grantedAt: string }[];
}

export interface IdentityInvitation {
  id: string;
  email: string;
  app: string;
  role: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  createdAt: string;
  expiresAt: string;
}

/** Fetch the Identity user directory. Superadmins and app managers can use it. */
export async function listIdentityUsers(): Promise<{ users: IdentityUser[] }> {
  return identityFetch<{ users: IdentityUser[] }>('/admin/users');
}

export function listIdentityInvitations(status = 'pending') {
  return identityFetch<{ invitations: IdentityInvitation[] }>(
    `/invitations?status=${encodeURIComponent(status)}`
  );
}

export function createIdentityInvitation(email: string, role: 'manager' | 'member') {
  return identityFetch<{ ok: true; invitation_id: string }>('/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, app: 'crm', role }),
  });
}

export function updateIdentityCrmMembership(userId: string, role: 'manager' | 'member' | null) {
  return identityFetch<{ ok: true }>(`/admin/users/${userId}/memberships`, {
    method: 'PATCH',
    body: JSON.stringify({ memberships: [{ app: 'crm', role }] }),
  });
}

export function setIdentityUserEnabled(userId: string, enabled: boolean) {
  return identityFetch<{ ok: true }>(`/admin/users/${userId}/${enabled ? 'enable' : 'disable'}`, {
    method: 'POST',
  });
}

export function resendIdentityInvitation(id: string) {
  return identityFetch<{ ok: true }>(`/invitations/${id}/resend`, { method: 'POST' });
}

export function revokeIdentityInvitation(id: string) {
  return identityFetch<{ ok: true }>(`/invitations/${id}/revoke`, { method: 'POST' });
}

// ─── Extension API keys (identity superadmin only) ───

export interface ExtensionApiKey {
  id: string;
  email: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export function listExtensionApiKeys() {
  return identityFetch<{ keys: ExtensionApiKey[] }>('/admin/api-keys');
}

/** The plaintext key is returned once and cannot be fetched again. */
export function createExtensionApiKey(email: string, label: string) {
  return identityFetch<{ key: string; id: string }>('/admin/api-keys', {
    method: 'POST',
    body: JSON.stringify({ email, label }),
  });
}

export function revokeExtensionApiKey(id: string) {
  return identityFetch<{ ok: true }>(`/admin/api-keys/${id}/revoke`, {
    method: 'POST',
  });
}

// ─── Workflow rules (outreach_stale cadence) ───

export interface WorkflowRule {
  id: string;
  name: string;
  trigger: 'lead_created' | 'opportunity_stale' | 'task_due_soon' | 'outreach_stale';
  conditions: {
    channel?: string | null;
    afterAttempts?: number;
    waitDays?: number;
    nextChannel?: string;
    // Multi-step sequence rules (actions.kind === 'sequence_followup') use
    // this instead of afterAttempts/waitDays/nextChannel.
    steps?: { afterDays: number; title: string; priority?: string }[];
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
