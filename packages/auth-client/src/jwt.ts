// Verifies access tokens issued by the identity Worker. Every other
// Worker (crm, hr, books) trusts the same JWT_SECRET and this same
// verification logic rather than calling back into identity per-request -
// the JWT itself is the source of truth for who the caller is and which
// apps/roles they hold, refreshed every 15 minutes by the client.
import { verify } from 'hono/jwt';
import type { AccessTokenPayload } from './types.js';

const JWT_ALG = 'HS256';

export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<AccessTokenPayload> {
  const payload = await verify(token, secret, JWT_ALG);
  return payload as unknown as AccessTokenPayload;
}
