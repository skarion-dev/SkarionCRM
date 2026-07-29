import type { MiddlewareHandler } from 'hono';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Baseline API hardening shared by every public Skarion Worker.
 * Preserves a well-formed upstream request ID or creates one, then attaches
 * conservative browser security headers to every response.
 */
export function platformSecurity(): MiddlewareHandler {
  return async (c, next) => {
    const supplied = c.req.header('X-Request-ID');
    const requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
    c.header('X-Request-ID', requestId);

    await next();

    c.header('X-Request-ID', requestId);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    );
    if (new URL(c.req.url).protocol === 'https:') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  };
}
