// apps/identity/login/src/redirect.ts
// Post-login redirect: honor ?return_to if it's an allowed origin
// (open-redirect guard - never forward to an arbitrary attacker domain),
// otherwise send the user to their first app membership's known URL.

import type { AppMembershipsMap } from './api.js';

// Known app URLs for Cloudflare default-domain deployments.
// When running on *.pages.dev or *.workers.dev, these are the exact URLs.
const APP_PAGES_URLS: Record<string, string> = {
  crm: 'https://skarion-crm.pages.dev',
  hr: 'https://skarion-hr.pages.dev',
  books: 'https://skarion-books.pages.dev',
};

// Allowed return_to hosts - exact list of known project origins.
// This is a strict allowlist; do not widen with wildcards.
const ALLOWED_ORIGINS = new Set([
  'https://skarion-crm.pages.dev',
  'https://skarion-hr.pages.dev',
  'https://skarion-books.pages.dev',
  'https://skarion-identity-login.pages.dev',
  'https://skarion-identity-admin.pages.dev',
  'https://skarion-identity.alsaki1999.workers.dev',
  'https://skarion-crm-platform.alsaki1999.workers.dev',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5181',
  'http://localhost:8787',
  'http://localhost:8788',
]);

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
    return false;
  } catch {
    return false;
  }
}

export function primaryAppUrl(apps: AppMembershipsMap): string {
  const firstApp = (['crm', 'hr', 'books'] as const).find((app) => apps[app]);
  if (!firstApp) return window.location.origin; // no memberships yet - stay put

  // If running on localhost, stay on localhost (dev has no real subdomains).
  if (window.location.hostname === 'localhost') {
    return window.location.origin;
  }

  // For pages.dev / workers.dev deployments, use the known app URLs.
  // For custom domains (*.skarion.com), derive from the current login page domain.
  if (window.location.hostname.endsWith('.pages.dev') || window.location.hostname.endsWith('.workers.dev')) {
    return APP_PAGES_URLS[firstApp] || window.location.origin;
  }

  // Custom domain: derive from root domain (e.g. auth.skarion.com -> crm.skarion.com)
  const rootDomain = window.location.hostname.split('.').slice(-2).join('.');
  return `${window.location.protocol}//${firstApp}.${rootDomain}`;
}

export function redirectAfterLogin(apps: AppMembershipsMap): void {
  const returnTo = getReturnToParam();
  if (returnTo && isAllowedReturnTo(returnTo)) {
    window.location.href = returnTo;
    return;
  }
  window.location.href = primaryAppUrl(apps);
}
