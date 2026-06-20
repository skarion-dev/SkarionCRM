// apps/identity/src/lib/tokens.ts
// JWT (access tokens) via Hono's built-in Workers-native jwt utility (Web
// Crypto under the hood - no Node-only crypto APIs). Opaque tokens (refresh,
// invitation, password reset) are random strings sent to the user; only
// their SHA-256 hash is ever stored, so a DB leak doesn't hand out usable
// tokens directly.

import { sign } from 'hono/jwt';
import type { AccessTokenPayload, AppMembershipsMap } from '@skarion/auth-client';

const JWT_ALG = 'HS256';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

// Verification (verifyAccessToken) lives in @skarion/auth-client - every
// other Worker (crm, hr, books) needs the exact same logic to trust
// identity-issued tokens, so there's one implementation, not N copies that
// could drift. Signing stays here: only identity ever signs a token.
export async function signAccessToken(
  params: { userId: string; email: string; apps: AppMembershipsMap; tokenVersion: number },
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenPayload = {
    sub: params.userId,
    email: params.email,
    apps: params.apps,
    ver: params.tokenVersion,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  };
  return sign(payload, secret, JWT_ALG);
}

/** Random URL-safe opaque token (refresh token, invitation token, password reset token). */
export function generateOpaqueToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

// Set once per request (see the middleware in index.ts) rather than threaded
// through every function that hashes a token - Workers process one request
// at a time per isolate invocation, so this can't leak across requests.
let configuredPepper = '';

/** Call once at the top of each request, before any token hashing happens. */
export function configureTokenPepper(pepper: string): void {
  configuredPepper = pepper;
}

/**
 * SHA-256 hash of an opaque token, hex-encoded - this is what gets stored
 * in the DB. The configured pepper (INVITATION_TOKEN_PEPPER - despite the
 * name it's used for every opaque token: refresh/reset/invitation/recovery
 * codes; one secret is simpler to manage than four) is mixed in so a DB
 * leak alone isn't enough to brute-force or rainbow-table the original
 * tokens; you'd also need the pepper, which lives only in Worker secrets,
 * never the database.
 */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(configuredPepper + value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
