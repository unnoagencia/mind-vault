import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../auth/password.js';

describe('/app/login', () => {
  it('GET renders the login form', async () => {
    const res = await SELF.fetch('https://x.test/app/login');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<input type="email"');
    expect(html).toContain('<input type="password"');
  });

  it('POST with correct credentials sets mv_session cookie', async () => {
    (env as any).OWNER_EMAIL = 'robson@example.com';
    (env as any).OWNER_PASSWORD_HASH = await hashPassword('correct-horse-battery-staple');
    (env as any).SESSION_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

    const form = new URLSearchParams({ email: 'robson@example.com', password: 'correct-horse-battery-staple' });
    const res = await SELF.fetch('https://x.test/app/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://x.test' },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app/notes');
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^mv_session=/);
    expect(setCookie).toContain('HttpOnly');
  });

  it('POST with wrong password returns 401', async () => {
    (env as any).OWNER_EMAIL = 'robson@example.com';
    (env as any).OWNER_PASSWORD_HASH = await hashPassword('right-password');
    (env as any).SESSION_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    const form = new URLSearchParams({ email: 'robson@example.com', password: 'wrong' });
    const res = await SELF.fetch('https://x.test/app/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://x.test' },
      body: form.toString(),
    });
    expect(res.status).toBe(401);
  });

  it('POST with mismatched Origin returns 403', async () => {
    (env as any).OWNER_EMAIL = 'robson@example.com';
    (env as any).OWNER_PASSWORD_HASH = await hashPassword('correct-horse-battery-staple');
    (env as any).SESSION_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    const form = new URLSearchParams({ email: 'robson@example.com', password: 'correct-horse-battery-staple' });
    const res = await SELF.fetch('https://x.test/app/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.test' },
      body: form.toString(),
    });
    expect(res.status).toBe(403);
  });

  it('POST /app/logout clears the cookie', async () => {
    const res = await SELF.fetch('https://x.test/app/logout', {
      method: 'POST',
      headers: { origin: 'https://x.test' },
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie') ?? '').toContain('Max-Age=0');
  });
});
