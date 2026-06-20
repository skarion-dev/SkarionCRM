// apps/identity/src/index.ts
// Identity Worker - Hono app. Routes are REST (not tRPC) per spec, kept
// small and language-agnostic since every other app/service needs to call
// into this one.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { getDb } from '@skarion/db-kit';
import {
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderMfaEnrolledEmail,
  renderWelcomeAfterInviteEmail,
} from '@skarion/ui/emails';
import { sendEmail } from '@skarion/auth-client';
import * as schema from './db/schema.js';
import * as authService from './services/auth.js';
import * as invitationService from './services/invitations.js';
import * as adminService from './services/admin.js';
import { requireAuth, type AuthedVariables } from './middleware/auth.js';
import type { AppName, Env } from './lib/types.js';

const APP_LABELS: Record<AppName, string> = { crm: 'CRM', hr: 'Employee Portal', books: 'Books' };
const APP_SUBDOMAINS: Record<AppName, string> = { crm: 'crm', hr: 'team', books: 'books' };

/** Derives e.g. https://crm.skarion.com from the identity app's own https://auth.skarion.com. */
function appUrlFor(identityAppUrl: string, app: AppName): string {
  try {
    const url = new URL(identityAppUrl);
    const rootDomain = url.hostname.split('.').slice(-2).join('.'); // auth.skarion.com -> skarion.com
    return `${url.protocol}//${APP_SUBDOMAINS[app]}.${rootDomain}`;
  } catch {
    return identityAppUrl; // local dev fallback - APP_URL may just be http://localhost:xxxx
  }
}

const REFRESH_COOKIE = 'skarion_refresh_token';
const APP_NAMES: AppName[] = ['crm', 'hr', 'books'];

type AppContext = Context<{ Bindings: Env; Variables: AuthedVariables }>;

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

function isAllowedOrigin(origin: string, appUrl: string): boolean {
  try {
    const allowed = new URL(appUrl).origin;
    if (origin === allowed) return true;
  } catch {
    /* APP_URL not set yet in local dev - fall through */
  }
  if (/^https:\/\/([a-z0-9-]+\.)*skarion\.com$/.test(origin)) return true;
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      // Allow the auth app's own APP_URL and any *.skarion.com subdomain in prod;
      // ticket 1.8 tightens this further once real domains exist.
      if (!origin) return origin;
      return isAllowedOrigin(origin, c.env.APP_URL) ? origin : null;
    },
    credentials: true,
  })
);

// CSRF: CORS alone stops the browser from *reading* a cross-origin response,
// but doesn't stop the request from executing server-side - which matters
// for /auth/refresh and /auth/logout specifically, since they authenticate
// off the httpOnly cookie alone (every other mutation requires a Bearer
// token, which a CSRF attacker can't forge). Reject state-changing requests
// outright if the Origin header doesn't match, as a second layer alongside
// the SameSite=Lax cookie attribute already set on the refresh-token cookie.
app.use('*', async (c, next) => {
  const unsafeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method);
  if (unsafeMethod) {
    const origin = c.req.header('Origin');
    if (origin && !isAllowedOrigin(origin, c.env.APP_URL)) {
      return c.json({ error: 'Origin not allowed.' }, 403);
    }
  }
  await next();
});

function setRefreshCookie(c: AppContext, token: string, expiresAt: Date) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
}

function errorResponse(c: AppContext, err: unknown) {
  if (err instanceof authService.AuthError) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'Internal server error.' }, 500);
}

/** True if the caller holds 'admin' or 'superadmin' in at least one app. */
function isPlatformAdmin(apps: Record<string, string>): boolean {
  return Object.values(apps).some((role) => role === 'admin' || role === 'superadmin');
}

/** Hono can't statically prove a `:param` is present; routes below always register it, so a missing value is a 400, not a type error to suppress. */
function requireParam(c: AppContext, name: string): string {
  const value = c.req.param(name);
  if (!value) throw new authService.AuthError(`Missing path parameter: ${name}`, 400);
  return value;
}

// ─────────────────────────────────────────────────────────
// /auth/*
// ─────────────────────────────────────────────────────────

app.post('/auth/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string; mfa_code?: string }>();
  if (!body.email || !body.password) {
    return c.json({ error: 'email and password are required.' }, 400);
  }
  const db = getDb(c.env, schema);
  try {
    const result = await authService.login(db, {
      email: body.email,
      password: body.password,
      mfaCode: body.mfa_code,
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
      jwtSecret: c.env.JWT_SECRET,
    });
    setRefreshCookie(c, result.refreshToken, result.refreshTokenExpiresAt);
    return c.json({ access_token: result.accessToken, user: result.user });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/auth/refresh', async (c) => {
  const token = getCookie(c, REFRESH_COOKIE);
  if (!token) return c.json({ error: 'No refresh token.' }, 401);
  const db = getDb(c.env, schema);
  try {
    const result = await authService.refresh(db, {
      refreshToken: token,
      jwtSecret: c.env.JWT_SECRET,
    });
    setRefreshCookie(c, result.refreshToken, result.refreshTokenExpiresAt);
    return c.json({ access_token: result.accessToken, user: result.user });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, REFRESH_COOKIE);
  if (token) {
    const db = getDb(c.env, schema);
    await authService.logout(db, token);
  }
  deleteCookie(c, REFRESH_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.post('/auth/forgot-password', async (c) => {
  const body = await c.req.json<{ email: string }>();
  const db = getDb(c.env, schema);
  const result = await authService.requestPasswordReset(db, body.email);
  // Always return the same generic response - don't leak whether the email exists.
  if (result) {
    const email = await renderPasswordResetEmail({
      resetUrl: `${c.env.APP_URL}/reset-password?token=${result.token}`,
    });
    try {
      await sendEmail(c.env.RESEND_API_KEY, { to: result.user.email, ...email });
    } catch (err) {
      console.error('Failed to send password reset email:', err);
    }
  }
  return c.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
});

app.post('/auth/reset-password', async (c) => {
  const body = await c.req.json<{ token: string; new_password: string }>();
  if (!body.token || !body.new_password) {
    return c.json({ error: 'token and new_password are required.' }, 400);
  }
  const db = getDb(c.env, schema);
  try {
    await authService.resetPassword(db, { token: body.token, newPassword: body.new_password });
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/auth/mfa/enroll', requireAuth, async (c) => {
  const db = getDb(c.env, schema);
  const result = await authService.enrollMfa(db, {
    userId: c.get('userId'),
    userEmail: c.get('userEmail'),
  });
  return c.json(result);
});

app.post('/auth/mfa/verify', requireAuth, async (c) => {
  const body = await c.req.json<{ code: string }>();
  const db = getDb(c.env, schema);
  try {
    const result = await authService.verifyMfaEnrollment(db, {
      userId: c.get('userId'),
      code: body.code,
    });
    const me = await authService.getMe(db, c.get('userId'));
    const email = await renderMfaEnrolledEmail({ displayName: me.displayName });
    try {
      await sendEmail(c.env.RESEND_API_KEY, { to: me.email, ...email });
    } catch (err) {
      console.error('Failed to send MFA-enrolled email:', err);
    }
    return c.json(result);
  } catch (err) {
    return errorResponse(c, err);
  }
});

// ─────────────────────────────────────────────────────────
// /me
// ─────────────────────────────────────────────────────────

app.get('/me', requireAuth, async (c) => {
  const db = getDb(c.env, schema);
  try {
    const me = await authService.getMe(db, c.get('userId'));
    return c.json(me);
  } catch (err) {
    return errorResponse(c, err);
  }
});

// ─────────────────────────────────────────────────────────
// /invitations
// ─────────────────────────────────────────────────────────

app.get('/invitations', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const db = getDb(c.env, schema);
  const status = c.req.query('status') as invitationService.InvitationStatus | undefined;
  const invitations = await invitationService.listInvitations(db, { status });
  return c.json({ invitations });
});

app.post('/invitations', requireAuth, async (c) => {
  const body = await c.req.json<{ email: string; app: AppName; role: string }>();
  if (!body.email || !APP_NAMES.includes(body.app) || !body.role) {
    return c.json({ error: 'email, app, and role are required.' }, 400);
  }
  const apps = c.get('apps');
  const role = apps[body.app];
  if (role !== 'admin' && role !== 'superadmin') {
    return c.json({ error: 'Forbidden: requires admin/superadmin on the target app.' }, 403);
  }

  const db = getDb(c.env, schema);
  try {
    const result = await invitationService.createInvitation(db, {
      email: body.email,
      app: body.app,
      role: body.role,
      invitedBy: c.get('userId'),
    });
    const inviter = await authService.getMe(db, c.get('userId'));
    const email = await renderInvitationEmail({
      inviterName: inviter.displayName,
      appLabel: APP_LABELS[body.app],
      acceptUrl: `${c.env.APP_URL}/accept-invite?token=${result.token}`,
    });
    try {
      await sendEmail(c.env.RESEND_API_KEY, { to: body.email, ...email });
    } catch (err) {
      console.error('Failed to send invitation email:', err);
    }
    return c.json({ ok: true, invitation_id: result.invitationId }, 201);
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/invitations/accept', async (c) => {
  const body = await c.req.json<{ token: string; password: string; display_name: string }>();
  if (!body.token || !body.password || !body.display_name) {
    return c.json({ error: 'token, password, and display_name are required.' }, 400);
  }
  const db = getDb(c.env, schema);
  try {
    const { userId, app: acceptedApp } = await invitationService.acceptInvitation(db, {
      token: body.token,
      password: body.password,
      displayName: body.display_name,
    });
    const me = await authService.getMe(db, userId);
    const loginResult = await authService.login(db, {
      email: me.email,
      password: body.password,
      jwtSecret: c.env.JWT_SECRET,
    });
    setRefreshCookie(c, loginResult.refreshToken, loginResult.refreshTokenExpiresAt);

    const welcomeEmail = await renderWelcomeAfterInviteEmail({
      displayName: me.displayName,
      appLabel: APP_LABELS[acceptedApp],
      appUrl: appUrlFor(c.env.APP_URL, acceptedApp),
    });
    try {
      await sendEmail(c.env.RESEND_API_KEY, { to: me.email, ...welcomeEmail });
    } catch (err) {
      console.error('Failed to send welcome email:', err);
    }

    return c.json({ access_token: loginResult.accessToken, user: loginResult.user }, 201);
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/invitations/:id/revoke', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const db = getDb(c.env, schema);
  try {
    await invitationService.revokeInvitation(db, {
      invitationId: requireParam(c, 'id'),
      actorUserId: c.get('userId'),
    });
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/invitations/:id/resend', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const db = getDb(c.env, schema);
  try {
    const result = await invitationService.resendInvitation(db, {
      invitationId: requireParam(c, 'id'),
      actorUserId: c.get('userId'),
    });
    const actor = await authService.getMe(db, c.get('userId'));
    const email = await renderInvitationEmail({
      inviterName: actor.displayName,
      appLabel: APP_LABELS[result.app],
      acceptUrl: `${c.env.APP_URL}/accept-invite?token=${result.token}`,
    });
    try {
      await sendEmail(c.env.RESEND_API_KEY, { to: result.email, ...email });
    } catch (err) {
      console.error('Failed to send resent invitation email:', err);
    }
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

// ─────────────────────────────────────────────────────────
// /admin/*
// ─────────────────────────────────────────────────────────

app.get('/admin/users', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const db = getDb(c.env, schema);
  const users = await adminService.listUsers(db);
  return c.json({ users });
});

app.patch('/admin/users/:id/memberships', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const body = await c.req.json<{ memberships: { app: AppName; role: string | null }[] }>();
  const db = getDb(c.env, schema);
  try {
    await adminService.updateMemberships(db, {
      targetUserId: requireParam(c, 'id'),
      actorUserId: c.get('userId'),
      memberships: body.memberships,
    });
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/admin/users/:id/disable', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const db = getDb(c.env, schema);
  try {
    await adminService.disableUser(db, {
      targetUserId: requireParam(c, 'id'),
      actorUserId: c.get('userId'),
    });
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/admin/users/:id/enable', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const db = getDb(c.env, schema);
  try {
    await adminService.enableUser(db, {
      targetUserId: requireParam(c, 'id'),
      actorUserId: c.get('userId'),
    });
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.post('/admin/users/:id/force-password-reset', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const db = getDb(c.env, schema);
  try {
    const result = await adminService.forcePasswordReset(db, {
      targetUserId: requireParam(c, 'id'),
      actorUserId: c.get('userId'),
    });
    const email = await renderPasswordResetEmail({
      resetUrl: `${c.env.APP_URL}/reset-password?token=${result.token}`,
    });
    try {
      await sendEmail(c.env.RESEND_API_KEY, { to: result.email, ...email });
    } catch (err) {
      console.error('Failed to send forced-password-reset email:', err);
    }
    return c.json({ ok: true });
  } catch (err) {
    return errorResponse(c, err);
  }
});

app.get('/admin/audit-log', requireAuth, async (c) => {
  if (!isPlatformAdmin(c.get('apps'))) return c.json({ error: 'Forbidden.' }, 403);
  const db = getDb(c.env, schema);
  const limit = Number(c.req.query('limit')) || undefined;
  const offset = Number(c.req.query('offset')) || undefined;
  const entries = await adminService.listAuditLog(db, { limit, offset });
  return c.json({ entries });
});

// No /register route - invite-only, per spec.
app.all('/register', (c) => c.json({ error: 'Not found.' }, 404));

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
