// Shared Hono middleware for any Worker that trusts identity-issued JWTs
// (crm, hr, books, and identity itself). One implementation instead of a
// copy per Worker that could silently drift.
import type { Context, Next } from 'hono';
import { verifyAccessToken } from './jwt.js';
import type { AppMembershipsMap, AppName } from './types.js';

export interface AuthedVariables {
  userId: string;
  userEmail: string;
  apps: AppMembershipsMap;
  isSuperadmin: boolean;
}

export interface JwtEnv {
  JWT_SECRET: string;
}

/** Requires a valid `Authorization: Bearer <jwt>` header. Attaches userId/email/apps/isSuperadmin to context. */
export async function requireAuth(
  c: Context<{ Bindings: JwtEnv; Variables: AuthedVariables }>,
  next: Next
) {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Authentication required.' }, 401);
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = await verifyAccessToken(token, c.env.JWT_SECRET);
    if (payload.mustChangePassword) {
      return c.json(
        {
          error: 'Password change required before accessing the application.',
          code: 'PASSWORD_CHANGE_REQUIRED',
        },
        403
      );
    }
    c.set('userId', payload.sub);
    c.set('userEmail', payload.email);
    c.set('apps', payload.apps);
    c.set('isSuperadmin', payload.isSuperadmin ?? false);
  } catch {
    return c.json({ error: 'Invalid or expired token.' }, 401);
  }
  await next();
}

/** Requires the caller to be a global superadmin. */
export function requireSuperadmin() {
  return async (c: Context<{ Bindings: JwtEnv; Variables: AuthedVariables }>, next: Next) => {
    if (!c.get('isSuperadmin')) {
      return c.json({ error: 'Forbidden: requires superadmin.' }, 403);
    }
    await next();
  };
}

/** Requires the caller to hold one of `allowedRoles` on `app`, or be a global superadmin (call after requireAuth). */
export function requireAppRole(app: AppName, allowedRoles: string[]) {
  return async (c: Context<{ Bindings: JwtEnv; Variables: AuthedVariables }>, next: Next) => {
    if (c.get('isSuperadmin')) {
      return await next();
    }
    const apps = c.get('apps');
    const role = apps[app];
    if (!role || !allowedRoles.includes(role)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }
    await next();
  };
}
