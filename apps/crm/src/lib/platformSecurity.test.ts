import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { platformSecurity } from '@skarion/auth-client';

function testApp() {
  const app = new Hono();
  app.use('*', platformSecurity());
  app.get('/health', (c) => c.json({ ok: true }));
  return app;
}

describe('platformSecurity', () => {
  it('adds baseline security and request correlation headers', async () => {
    const response = await testApp().request('https://api.skarion.com/health');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('strict-transport-security')).toContain('max-age=31536000');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('preserves a safe upstream request ID', async () => {
    const response = await testApp().request('https://api.skarion.com/health', {
      headers: { 'X-Request-ID': 'edge:request-123' },
    });
    expect(response.headers.get('x-request-id')).toBe('edge:request-123');
  });

  it('replaces malformed request IDs', async () => {
    const response = await testApp().request('https://api.skarion.com/health', {
      headers: { 'X-Request-ID': 'invalid request id with spaces' },
    });
    expect(response.headers.get('x-request-id')).not.toBe('invalid request id with spaces');
  });
});
