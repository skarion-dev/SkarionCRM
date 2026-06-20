// apps/identity/login/src/redirect.ts
// Post-login redirect: honor ?return_to if it's a *.skarion.com host
// (open-redirect guard - never forward to an arbitrary attacker domain),
// otherwise send the user to their first app membership's subdomain.

import type { AppMembershipsMap } from './api.js';

const APP_SUBDOMAINS: Record<string, string> = { crm: 'crm', hr: 'team', books: 'books' };
const ALLOWED_HOST = /^([a-z0-9-]+\.)*skarion\.com$/i;

export function getReturnToParam(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('return_to');
}

export function isAllowedReturnTo(returnTo: string): boolean {
  try {
    const url = new URL(returnTo, window.location.origin);
    return ALLOWED_HOST.test(url.hostname) || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

export function primaryAppUrl(apps: AppMembershipsMap): string {
  const firstApp = (['crm', 'hr', 'books'] as const).find((app) => apps[app]);
  if (!firstApp) return window.location.origin; // no memberships yet - stay put

  const rootDomain = window.location.hostname.split('.').slice(-2).join('.');
  if (rootDomain === 'localhost' || window.location.hostname === 'localhost') {
    return window.location.origin; // local dev has no real subdomains to route to
  }
  return `${window.location.protocol}//${APP_SUBDOMAINS[firstApp]}.${rootDomain}`;
}

export function redirectAfterLogin(apps: AppMembershipsMap): void {
  const returnTo = getReturnToParam();
  if (returnTo && isAllowedReturnTo(returnTo)) {
    window.location.href = returnTo;
    return;
  }
  window.location.href = primaryAppUrl(apps);
}
