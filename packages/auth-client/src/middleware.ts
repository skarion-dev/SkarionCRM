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
}

export interface JwtEnv {
  JWT_SECRET: string;
}

/** Requires a valid `Authorization: Bearer <jwt>` header. Attaches userId/email/apps to context. */
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
    c.set('userId', payload.sub);
    c.set('userEmail', payload.email);
    c.set('apps', payload.apps);
  } catch {
    return c.json({ error: 'Invalid or expired token.' }, 401);
  }
  await next();
}

/** Requires the caller to hold one of `allowedRoles` on `app` (call after requireAuth). */
export function requireAppRole(app: AppName, allowedRoles: string[]) {
  return async (c: Context<{ Bindings: JwtEnv; Variables: AuthedVariables }>, next: Next) => {
    const apps = c.get('apps');
    const role = apps[app];
    if (!role || !allowedRoles.includes(role)) {
      return c.json({ error: 'Forbidden.' }, 403);
    }
    await next();
  };
}
