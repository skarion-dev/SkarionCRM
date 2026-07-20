// apps/identity/login/src/redirect.ts
// Post-login redirect: honor ?return_to if it's an allowed origin
// (open-redirect guard - never forward to an arbitrary attacker domain),
// otherwise send the user to their first app membership's known URL.

import type { AppMembershipsMap } from './api.js';

// Known app URLs for Cloudflare default-domain deployments.
// When running on *.pages.dev or *.workers.dev, these are the exact URLs.
const APP_PAGES_URLS: Record<string, string> = {
  crm: import.meta.env.VITE_CRM_URL || 'https://skarion-crm-cv9.pages.dev',
  hr: import.meta.env.VITE_HR_URL || 'https://skarion-hr-4in.pages.dev',
  books: import.meta.env.VITE_BOOKS_URL || 'https://skarion-books-2r7.pages.dev',
};

// Allowed return_to hosts - exact list of known project origins.
// This is a strict allowlist; do not widen with wildcards.
const ALLOWED_ORIGINS = new Set([
  APP_PAGES_URLS.crm,
  APP_PAGES_URLS.hr,
  APP_PAGES_URLS.books,
  import.meta.env.VITE_IDENTITY_LOGIN_URL || 'https://skarion-identity-login-4hu.pages.dev',
  import.meta.env.VITE_IDENTITY_ADMIN_URL || 'https://skarion-identity-admin-dx5.pages.dev',
  import.meta.env.VITE_IDENTITY_API_URL || 'https://skarion-identity.skarion-talentos.workers.dev',
  import.meta.env.VITE_CRM_API_URL || 'https://skarion-crm-platform.skarion-talentos.workers.dev',
  import.meta.env.VITE_BOOKS_API_URL || 'https://skarion-books-platform.skarion-talentos.workers.dev',
  import.meta.env.VITE_HR_API_URL || 'https://skarion-hr-platform.skarion-talentos.workers.dev',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5181',
  'http://localhost:8787',
  'http://localhost:8788',
]);

// Initialize extra allowed origins if configured.
const extraOrigins = import.meta.env.VITE_ALLOWED_ORIGINS;
if (extraOrigins) {
  extraOrigins.split(',').forEach((org: string) => {
    const trimmed = org.trim();
    if (trimmed) ALLOWED_ORIGINS.add(trimmed);
  });
}

// For custom domains, allow any *.skarion.com subdomain.
const SKARION_DOMAIN = /^https:\/\/([a-z0-9-]+\.)*skarion\.com$/i;

export function getReturnToParam(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('return_to');
}

export function isAllowedReturnTo(returnTo: string): boolean {
  try {
    const url = new URL(returnTo, window.location.origin);
    if (ALLOWED_ORIGINS.has(url.origin)) return true;
    if (SKARION_DOMAIN.test(url.origin)) return true;
    if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') return true;
    return false;
  } catch {
    return false;
  }
}

// Known app URLs for local development.
const APP_LOCAL_URLS: Record<string, string> = {
  crm: 'http://localhost:5173',
  hr: 'http://localhost:5175',
  books: 'http://localhost:5174',
};

export function primaryAppUrl(apps: AppMembershipsMap): string {
  const firstApp = (['crm', 'hr', 'books'] as const).find((app) => apps[app]);
  if (!firstApp) return window.location.origin; // no memberships yet - stay put

  // If running on localhost, redirect to the correct local port for the app.
  if (window.location.hostname === 'localhost') {
    return APP_LOCAL_URLS[firstApp] || 'http://localhost:5173';
  }

  // For pages.dev / workers.dev deployments, use the known app URLs.
  // For custom domains (*.skarion.com), derive from the current login page domain.
  if (
    window.location.hostname.endsWith('.pages.dev') ||
    window.location.hostname.endsWith('.workers.dev')
  ) {
    return APP_PAGES_URLS[firstApp] || window.location.origin;
  }

  // Custom domain: derive from root domain (e.g. auth.skarion.com -> crm.skarion.com)
  const rootDomain = window.location.hostname.split('.').slice(-2).join('.');
  return `${window.location.protocol}//${firstApp}.${rootDomain}`;
}

export function redirectAfterLogin(
  apps: AppMembershipsMap,
  accessToken?: string,
  refreshToken?: string
): void {
  const returnTo = getReturnToParam();
  if (returnTo && isAllowedReturnTo(returnTo)) {
    try {
      const url = new URL(returnTo);
      const hashParams = new URLSearchParams();
      if (accessToken) hashParams.set('access_token', accessToken);
      if (refreshToken) hashParams.set('refresh_token', refreshToken);
      const hashStr = hashParams.toString();
      if (hashStr) {
        url.hash = hashStr;
      }
      window.location.href = url.toString();
      return;
    } catch {
      // fallback
    }
    window.location.href = returnTo;
    return;
  }
  
  try {
    const primaryUrl = primaryAppUrl(apps);
    const url = new URL(primaryUrl);
    const hashParams = new URLSearchParams();
    if (accessToken) hashParams.set('access_token', accessToken);
    if (refreshToken) hashParams.set('refresh_token', refreshToken);
    const hashStr = hashParams.toString();
    if (hashStr) {
      url.hash = hashStr;
    }
    window.location.href = url.toString();
    return;
  } catch {
    // fallback
  }
  window.location.href = primaryAppUrl(apps);
}
