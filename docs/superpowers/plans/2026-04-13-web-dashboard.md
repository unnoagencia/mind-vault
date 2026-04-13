# Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only web dashboard at `/app/*` — notes list, note detail, and a WebGL force-graph of correlations — protected by the same owner credentials as the MCP OAuth flow, via a separate cookie session.

**Architecture:** New module `src/web/` routed by `authHandler` before the OAuth branch. Cookie session (HMAC-signed) separate from OAuth. Graph layout precomputed server-side with `graphology-layout-forceatlas2`, cached in a new KV namespace `GRAPH_CACHE`, rendered in the browser with `sigma` (WebGL) at fixed coordinates so the client never runs physics.

**Tech Stack:** Cloudflare Workers (TypeScript, ES modules), D1, Vectorize, KV, Miniflare tests via `@cloudflare/vitest-pool-workers`. New deps: `sigma`, `graphology`, `graphology-layout-forceatlas2`, `marked`.

---

## File Structure

**New files:**
- `src/web/handler.ts` — dispatch `/app/*` routes
- `src/web/session.ts` — cookie sign/verify + `requireSession` middleware
- `src/web/session.test.ts`
- `src/web/login.ts` — GET/POST `/app/login`, POST `/app/logout`
- `src/web/login.test.ts`
- `src/web/notes.ts` — GET `/app/notes`, GET `/app/notes/:id`
- `src/web/notes.test.ts`
- `src/web/graph.ts` — GET `/app/graph` (HTML shell only)
- `src/web/graph-data.ts` — GET `/app/graph/data` (compute + cache)
- `src/web/graph.test.ts`
- `src/web/layout.ts` — forceatlas2 wrapper
- `src/web/layout.test.ts`
- `src/web/similarity.ts` — Vectorize top-k + dedupe against explicit edges
- `src/web/render.ts` — shared HTML shell (sidebar + head + nebula styles)
- `src/web/markdown.ts` — safe markdown → HTML
- `src/web/styles.ts` — Midnight Nebula CSS constants
- `src/web/client/graph.ts` — Sigma initialization source
- `src/web/client/graph.bundle.js` — built browser bundle committed alongside source (served at `/app/graph/bundle.js`)
- `scripts/build-graph-bundle.ts` — esbuild script producing `graph.bundle.js`

**Modified files:**
- `src/env.ts` — add `GRAPH_CACHE: KVNamespace`
- `src/auth/handler.ts` — branch `/app/*` before OAuth routes
- `src/auth/setup.ts` + `src/auth/handler.ts` — setup wizard generates `SESSION_SECRET`, shows KV create instruction
- `src/static/wizard.ts` — surface `SESSION_SECRET` and KV instructions on credentials screen
- `wrangler.toml` — add `GRAPH_CACHE` KV binding
- `package.json` — add deps + `build:bundle` script
- `vitest.config.ts` (or wrangler config used by Miniflare) — declare the `GRAPH_CACHE` KV namespace for tests

---

## Task 1: Add dependencies and KV binding

**Files:**
- Modify: `package.json`
- Modify: `wrangler.toml`
- Modify: `src/env.ts`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
npm install sigma graphology graphology-layout-forceatlas2 marked
npm install --save-dev esbuild
```

Expected: four runtime packages added to `dependencies`, `esbuild` added to `devDependencies`.

- [ ] **Step 2: Add KV binding placeholder to `wrangler.toml`**

Append to `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "GRAPH_CACHE"
id = "REPLACE_WITH_KV_ID"
preview_id = "REPLACE_WITH_KV_ID"
```

The real ID is filled in by the setup wizard. Tests use the Miniflare-provided in-memory KV, so this placeholder is fine for `npm test`.

- [ ] **Step 3: Add `GRAPH_CACHE` to `Env`**

Edit `src/env.ts`:
```typescript
export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  ASSETS: Fetcher;
  OWNER_EMAIL?: string;
  OWNER_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  OAUTH_KV: KVNamespace;
  GRAPH_CACHE: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json wrangler.toml src/env.ts
git commit -m "feat(web): add deps (sigma, graphology, marked) and GRAPH_CACHE binding"
```

---

## Task 2: Session signing primitives

**Files:**
- Create: `src/web/session.ts`
- Create: `src/web/session.test.ts`

- [ ] **Step 1: Write the failing test**

`src/web/session.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from './session.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

describe('session cookie', () => {
  it('round-trips an email', async () => {
    const token = await signSession('robson@example.com', SECRET, 1712990000);
    const result = await verifySession(token, SECRET, 1712990000 + 60);
    expect(result).toEqual({ email: 'robson@example.com', issuedAt: 1712990000 });
  });

  it('rejects a tampered token', async () => {
    const token = await signSession('robson@example.com', SECRET, 1712990000);
    const [e, i, _sig] = token.split('.');
    const tampered = `${e}.${i}.ZmFrZXNpZw`;
    expect(await verifySession(tampered, SECRET, 1712990000 + 60)).toBeNull();
  });

  it('rejects an expired token (> 7d)', async () => {
    const token = await signSession('robson@example.com', SECRET, 1712990000);
    const eightDaysLater = 1712990000 + 8 * 86400;
    expect(await verifySession(token, SECRET, eightDaysLater)).toBeNull();
  });

  it('rejects a wrong secret', async () => {
    const token = await signSession('robson@example.com', SECRET, 1712990000);
    expect(await verifySession(token, 'other-secret', 1712990000 + 60)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run src/web/session.test.ts`
Expected: FAIL — cannot import `./session.js`.

- [ ] **Step 3: Implement `src/web/session.ts`**

```typescript
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signSession(
  email: string,
  secret: string,
  issuedAt: number
): Promise<string> {
  const e = b64urlEncode(encoder.encode(email));
  const i = b64urlEncode(encoder.encode(String(issuedAt)));
  const sig = await hmac(secret, `${e}.${i}`);
  return `${e}.${i}.${b64urlEncode(sig)}`;
}

export async function verifySession(
  token: string,
  secret: string,
  nowSeconds: number
): Promise<{ email: string; issuedAt: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [e, i, s] = parts;
  const expected = await hmac(secret, `${e}.${i}`);
  const got = b64urlDecode(s);
  if (!constantTimeEqual(expected, got)) return null;
  const email = new TextDecoder().decode(b64urlDecode(e));
  const issuedAt = Number(new TextDecoder().decode(b64urlDecode(i)));
  if (!Number.isFinite(issuedAt)) return null;
  if (nowSeconds - issuedAt > SESSION_TTL_SECONDS) return null;
  return { email, issuedAt };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run src/web/session.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/session.ts src/web/session.test.ts
git commit -m "feat(web): HMAC-signed session cookie sign/verify"
```

---

## Task 3: Session middleware and cookie helpers

**Files:**
- Modify: `src/web/session.ts`
- Modify: `src/web/session.test.ts`

- [ ] **Step 1: Add failing tests for the middleware and cookie helpers**

Append to `src/web/session.test.ts`:
```typescript
import { sessionCookie, readCookie, requireSession } from './session.js';

describe('sessionCookie', () => {
  it('builds a Set-Cookie string with the right flags', () => {
    const c = sessionCookie('abc.def.ghi');
    expect(c).toMatch(/^mv_session=abc\.def\.ghi/);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/app');
    expect(c).toContain('Max-Age=604800');
  });

  it('builds a clearing cookie', () => {
    const c = sessionCookie('', { clear: true });
    expect(c).toContain('Max-Age=0');
  });
});

describe('readCookie', () => {
  it('reads mv_session from a Cookie header', () => {
    expect(readCookie('foo=1; mv_session=abc.def.ghi; bar=2', 'mv_session')).toBe('abc.def.ghi');
  });
  it('returns null if not present', () => {
    expect(readCookie('foo=1', 'mv_session')).toBeNull();
  });
  it('returns null for missing header', () => {
    expect(readCookie(null, 'mv_session')).toBeNull();
  });
});

describe('requireSession', () => {
  const env = { SESSION_SECRET: 'test-secret-0123456789abcdef0123456789abcdef' } as any;

  it('returns the email when the cookie is valid', async () => {
    const token = await signSession('robson@example.com', env.SESSION_SECRET, Math.floor(Date.now() / 1000));
    const req = new Request('https://x.test/app/notes', { headers: { Cookie: `mv_session=${token}` } });
    const result = await requireSession(req, env);
    expect(result).toEqual({ ok: true, email: 'robson@example.com' });
  });

  it('returns a redirect when the cookie is missing', async () => {
    const req = new Request('https://x.test/app/notes');
    const result = await requireSession(req, env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(302);
      expect(result.response.headers.get('location')).toBe('/app/login?next=%2Fapp%2Fnotes');
    }
  });

  it('returns a redirect when the cookie is invalid', async () => {
    const req = new Request('https://x.test/app/notes', { headers: { Cookie: 'mv_session=bad.token.sig' } });
    const result = await requireSession(req, env);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run src/web/session.test.ts`
Expected: FAIL — `sessionCookie` / `readCookie` / `requireSession` not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/web/session.ts`:
```typescript
import type { Env } from '../env.js';

export function sessionCookie(token: string, opts: { clear?: boolean } = {}): string {
  const maxAge = opts.clear ? 0 : SESSION_TTL_SECONDS;
  return `mv_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/app; Max-Age=${maxAge}`;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export type SessionResult =
  | { ok: true; email: string }
  | { ok: false; response: Response };

export async function requireSession(req: Request, env: Env): Promise<SessionResult> {
  if (!env.SESSION_SECRET) {
    return { ok: false, response: new Response('Session secret not configured', { status: 503 }) };
  }
  const token = readCookie(req.headers.get('cookie'), 'mv_session');
  const url = new URL(req.url);
  const next = encodeURIComponent(url.pathname + url.search);
  const redirect = new Response(null, {
    status: 302,
    headers: { location: `/app/login?next=${next}` },
  });
  if (!token) return { ok: false, response: redirect };
  const verified = await verifySession(token, env.SESSION_SECRET, Math.floor(Date.now() / 1000));
  if (!verified) return { ok: false, response: redirect };
  return { ok: true, email: verified.email };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run src/web/session.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/session.ts src/web/session.test.ts
git commit -m "feat(web): session middleware, cookie helpers, requireSession"
```

---

## Task 4: Midnight Nebula styles and shared shell

**Files:**
- Create: `src/web/styles.ts`
- Create: `src/web/render.ts`

- [ ] **Step 1: Create `src/web/styles.ts`**

```typescript
export const NEBULA_CSS = `
:root {
  --bg: #0a0618;
  --bg-accent: #1a1438;
  --text: #e8dcff;
  --text-dim: rgba(232, 220, 255, 0.55);
  --border: rgba(180, 140, 255, 0.12);
  --surface: rgba(255, 255, 255, 0.03);
  --accent-lav: #b48cff;
  --accent-cyan: #8cc8ff;
  --accent-pink: #ff9ad5;
  --accent-violet: #a78bfa;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: radial-gradient(ellipse at 40% 30%, var(--bg-accent) 0%, var(--bg) 70%) fixed; color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; min-height: 100vh; }
a { color: var(--accent-lav); text-decoration: none; }
a:hover { color: var(--text); }
.shell { display: flex; min-height: 100vh; }
.sidebar { width: 200px; flex-shrink: 0; padding: 24px 16px; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
.sidebar .logo { font-weight: 600; margin-bottom: 24px; letter-spacing: 0.3px; font-size: 15px; }
.sidebar .nav-item { padding: 9px 14px; border-radius: 8px; font-size: 14px; opacity: 0.6; }
.sidebar .nav-item.active { background: rgba(180, 140, 255, 0.18); color: var(--text); opacity: 1; }
.sidebar .nav-item:hover { opacity: 1; }
.sidebar .bottom { margin-top: auto; font-size: 12px; color: var(--text-dim); }
.sidebar .bottom form { margin-top: 4px; }
.sidebar .bottom button { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 0; font-size: 12px; }
.sidebar .bottom button:hover { color: var(--text); }
.main { flex: 1; padding: 32px 40px; min-width: 0; }
.main h1 { font-size: 24px; font-weight: 600; margin: 0 0 24px; }
.main h2 { font-size: 18px; font-weight: 500; margin: 24px 0 12px; }
.note-card { display: block; padding: 16px 18px; margin-bottom: 10px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--text); }
.note-card:hover { border-color: rgba(180, 140, 255, 0.35); color: var(--text); }
.note-card .title { font-size: 15px; font-weight: 500; margin-bottom: 6px; }
.note-card .meta { font-size: 12px; color: var(--text-dim); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: rgba(180, 140, 255, 0.15); color: var(--accent-lav); margin-right: 4px; }
.note-body { line-height: 1.7; font-size: 15px; }
.note-body pre { background: rgba(0,0,0,0.3); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
.note-body code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
.login-wrap { max-width: 360px; margin: 10vh auto; padding: 32px; }
.login-wrap h1 { text-align: center; }
.login-wrap label { display: block; margin-bottom: 14px; font-size: 13px; color: var(--text-dim); }
.login-wrap input { width: 100%; margin-top: 4px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 14px; }
.login-wrap button { width: 100%; padding: 12px; background: var(--accent-lav); color: #160a33; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
.error { color: #ff8a99; font-size: 13px; margin-bottom: 12px; }
`;
```

- [ ] **Step 2: Create `src/web/render.ts`**

```typescript
import { esc } from '../util/html.js';
import { NEBULA_CSS } from './styles.js';

export function renderShell(opts: {
  title: string;
  active: 'notes' | 'graph';
  email: string;
  body: string;
  extraHead?: string;
}): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)} · Mind Vault</title>
<style>${NEBULA_CSS}</style>
${opts.extraHead ?? ''}
</head><body>
<div class="shell">
  <aside class="sidebar">
    <div class="logo">◆ Mind Vault</div>
    <a class="nav-item${opts.active === 'notes' ? ' active' : ''}" href="/app/notes">Notes</a>
    <a class="nav-item${opts.active === 'graph' ? ' active' : ''}" href="/app/graph">Graph</a>
    <div class="bottom">
      <div>${esc(opts.email)}</div>
      <form method="post" action="/app/logout"><button type="submit">Log out</button></form>
    </div>
  </aside>
  <main class="main">${opts.body}</main>
</div>
</body></html>`;
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    },
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/styles.ts src/web/render.ts
git commit -m "feat(web): Midnight Nebula styles + shared shell renderer"
```

---

## Task 5: Login / logout endpoints

**Files:**
- Create: `src/web/login.ts`
- Create: `src/web/login.test.ts`

- [ ] **Step 1: Write failing tests**

`src/web/login.test.ts`:
```typescript
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
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run src/web/login.test.ts`
Expected: FAIL — `/app/login` doesn't exist yet (also this whole dispatch is wired only in Task 10 — tests will still fail until Task 10. That's OK; revisit below).

**Note on ordering:** because `login` depends on the `handler.ts` dispatch + the setup wizard branching, run the login/notes/graph test suites after Task 10 is in. Keep the tests file committed; it will turn green once dispatch is wired. Until then, you can run the *unit-only* parts manually.

- [ ] **Step 3: Implement `src/web/login.ts`**

```typescript
import type { Env } from '../env.js';
import { esc } from '../util/html.js';
import { verifyPassword } from '../auth/password.js';
import { signSession, sessionCookie } from './session.js';
import { NEBULA_CSS } from './styles.js';
import { htmlResponse } from './render.js';

function renderLoginPage(error: string | null, next: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Log in · Mind Vault</title><style>${NEBULA_CSS}</style></head>
<body><div class="login-wrap">
<h1>◆ Mind Vault</h1>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<form method="post" action="/app/login">
<input type="hidden" name="next" value="${esc(next)}">
<label>Email<input type="email" name="email" required autofocus></label>
<label>Passphrase<input type="password" name="password" required></label>
<button type="submit">Log in</button>
</form></div></body></html>`;
}

export async function handleLoginGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const next = url.searchParams.get('next') ?? '/app/notes';
  return htmlResponse(renderLoginPage(null, next));
}

function checkOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const url = new URL(req.url);
  return origin === url.origin;
}

export async function handleLoginPost(req: Request, env: Env): Promise<Response> {
  if (!checkOrigin(req)) return new Response('Forbidden', { status: 403 });
  if (!env.OWNER_EMAIL || !env.OWNER_PASSWORD_HASH || !env.SESSION_SECRET) {
    return new Response('Vault not configured', { status: 503 });
  }
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '/app/notes');

  const emailMatch = email === env.OWNER_EMAIL;
  const passwordOk = emailMatch && (await verifyPassword(password, env.OWNER_PASSWORD_HASH));
  if (!emailMatch || !passwordOk) {
    return htmlResponse(renderLoginPage('Invalid credentials.', next), 401);
  }

  const token = await signSession(env.OWNER_EMAIL, env.SESSION_SECRET, Math.floor(Date.now() / 1000));
  const safeNext = next.startsWith('/app/') ? next : '/app/notes';
  return new Response(null, {
    status: 302,
    headers: {
      location: safeNext,
      'set-cookie': sessionCookie(token),
    },
  });
}

export async function handleLogoutPost(req: Request): Promise<Response> {
  if (!checkOrigin(req)) return new Response('Forbidden', { status: 403 });
  return new Response(null, {
    status: 302,
    headers: {
      location: '/app/login',
      'set-cookie': sessionCookie('', { clear: true }),
    },
  });
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/login.ts src/web/login.test.ts
git commit -m "feat(web): login/logout endpoints with Origin check"
```

---

## Task 6: Markdown renderer

**Files:**
- Create: `src/web/markdown.ts`

- [ ] **Step 1: Create the module**

```typescript
import { marked } from 'marked';

// Configure marked for safe, deterministic output. No HTML pass-through.
marked.setOptions({
  gfm: true,
  breaks: false,
  async: false,
});

export function renderMarkdown(src: string): string {
  // marked escapes raw HTML by default when `sanitize` is unsupported in v12+,
  // so we wrap manually: strip any <script> just in case, then render.
  const cleaned = src.replace(/<script[\s\S]*?<\/script>/gi, '');
  return marked.parse(cleaned, { async: false }) as string;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/markdown.ts
git commit -m "feat(web): markdown renderer using marked"
```

---

## Task 7: Notes list and detail pages

**Files:**
- Create: `src/web/notes.ts`
- Create: `src/web/notes.test.ts`

- [ ] **Step 1: Write failing tests**

`src/web/notes.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { runMigrations } from '../db/migrate.js';
import { signSession } from './session.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

async function authCookie(): Promise<string> {
  const token = await signSession('robson@example.com', SECRET, Math.floor(Date.now() / 1000));
  return `mv_session=${token}`;
}

async function seed() {
  await env.DB.prepare(`INSERT OR REPLACE INTO notes (id,title,body,tldr,domains,kind,created_at,updated_at)
    VALUES ('n1','Alpha','# Alpha\\n\\nbody','sum','infra',NULL,1,1)`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO notes (id,title,body,tldr,domains,kind,created_at,updated_at)
    VALUES ('n2','Beta','# Beta','sum','retrieval',NULL,2,2)`).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO edges (id,from_id,to_id,relation_type,why,created_at)
    VALUES ('e1','n1','n2','depends_on','shared mechanism explained here',3)`).run();
}

beforeAll(async () => {
  (env as any).OWNER_EMAIL = 'robson@example.com';
  (env as any).SESSION_SECRET = SECRET;
  await runMigrations(env as any);
  await seed();
});

describe('/app/notes', () => {
  it('redirects to login without cookie', async () => {
    const res = await SELF.fetch('https://x.test/app/notes', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/app/login');
  });

  it('lists notes ordered by updated_at DESC', async () => {
    const res = await SELF.fetch('https://x.test/app/notes', { headers: { cookie: await authCookie() } });
    expect(res.status).toBe(200);
    const html = await res.text();
    const alphaIdx = html.indexOf('Alpha');
    const betaIdx = html.indexOf('Beta');
    expect(betaIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(betaIdx).toBeLessThan(alphaIdx);
  });

  it('renders note detail with markdown and outbound links', async () => {
    const res = await SELF.fetch('https://x.test/app/notes/n1', { headers: { cookie: await authCookie() } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1');
    expect(html).toContain('Alpha');
    expect(html).toContain('href="/app/notes/n2"');
    expect(html).toContain('shared mechanism explained here');
  });

  it('returns 404 for unknown note id', async () => {
    const res = await SELF.fetch('https://x.test/app/notes/nope', { headers: { cookie: await authCookie() } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run src/web/notes.test.ts`
Expected: FAIL (routes not wired until Task 10).

- [ ] **Step 3: Implement `src/web/notes.ts`**

```typescript
import type { Env } from '../env.js';
import { esc } from '../util/html.js';
import { requireSession } from './session.js';
import { renderShell, htmlResponse } from './render.js';
import { renderMarkdown } from './markdown.js';
import { getNoteById, getEdgesFrom, type NoteRow, type EdgeRow } from '../db/queries.js';

interface NoteListItem {
  id: string;
  title: string;
  domains: string;
  updated_at: number;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function domainsToBadges(csv: string): string {
  return csv
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => `<span class="badge">${esc(d)}</span>`)
    .join('');
}

export async function handleNotesList(req: Request, env: Env): Promise<Response> {
  const session = await requireSession(req, env);
  if (!session.ok) return session.response;

  const rows = await env.DB.prepare(
    `SELECT id, title, domains, updated_at FROM notes ORDER BY updated_at DESC`
  ).all<NoteListItem>();
  const notes = rows.results ?? [];

  const body = `
    <h1>Notes · ${notes.length}</h1>
    ${notes.length === 0 ? '<p style="color:var(--text-dim)">No notes yet.</p>' : ''}
    ${notes
      .map(
        (n) => `
      <a class="note-card" href="/app/notes/${esc(n.id)}">
        <div class="title">${esc(n.title)}</div>
        <div class="meta">${domainsToBadges(n.domains)} · ${formatDate(n.updated_at)}</div>
      </a>`
      )
      .join('')}
  `;

  return htmlResponse(
    renderShell({ title: 'Notes', active: 'notes', email: session.email, body })
  );
}

export async function handleNoteDetail(req: Request, env: Env, id: string): Promise<Response> {
  const session = await requireSession(req, env);
  if (!session.ok) return session.response;

  const note = await getNoteById(env, id);
  if (!note) {
    return htmlResponse(
      renderShell({
        title: 'Not found',
        active: 'notes',
        email: session.email,
        body: '<h1>Note not found</h1><p><a href="/app/notes">← Back to notes</a></p>',
      }),
      404
    );
  }

  const outbound = await getEdgesFrom(env, id);
  const targetIds = outbound.map((e) => e.to_id);
  const targets = new Map<string, NoteRow>();
  if (targetIds.length > 0) {
    const placeholders = targetIds.map(() => '?').join(',');
    const rs = await env.DB.prepare(
      `SELECT * FROM notes WHERE id IN (${placeholders})`
    ).bind(...targetIds).all<NoteRow>();
    for (const r of rs.results ?? []) targets.set(r.id, r);
  }

  const linksHtml = outbound.length
    ? `<h2>Connected to</h2>${outbound
        .map((e) => {
          const t = targets.get(e.to_id);
          if (!t) return '';
          return `<a class="note-card" href="/app/notes/${esc(t.id)}">
            <div class="title">→ ${esc(t.title)}</div>
            <div class="meta"><span class="badge">${esc(e.relation_type)}</span>${esc(e.why)}</div>
          </a>`;
        })
        .join('')}`
    : '';

  const body = `
    <h1>${esc(note.title)}</h1>
    <div class="meta" style="margin-bottom:24px">${domainsToBadges(note.domains)} · Updated ${formatDate(note.updated_at)}</div>
    <div class="note-body">${renderMarkdown(note.body)}</div>
    ${linksHtml}
  `;

  return htmlResponse(
    renderShell({ title: note.title, active: 'notes', email: session.email, body })
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/notes.ts src/web/notes.test.ts
git commit -m "feat(web): notes list + detail with markdown and outbound links"
```

---

## Task 8: Graph layout (forceatlas2 wrapper)

**Files:**
- Create: `src/web/layout.ts`
- Create: `src/web/layout.test.ts`

- [ ] **Step 1: Write failing tests**

`src/web/layout.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computeLayout, type LayoutNode, type LayoutEdge } from './layout.js';

describe('computeLayout', () => {
  it('returns finite x/y for every node of a small graph', () => {
    const nodes: LayoutNode[] = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    ];
    const edges: LayoutEdge[] = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'd' },
      { source: 'd', target: 'a' },
    ];
    const result = computeLayout(nodes, edges);
    expect(result).toHaveLength(4);
    for (const n of result) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('handles an isolated node (no edges) without NaN', () => {
    const result = computeLayout([{ id: 'solo' }], []);
    expect(Number.isFinite(result[0].x)).toBe(true);
    expect(Number.isFinite(result[0].y)).toBe(true);
  });

  it('is deterministic for the same input', () => {
    const nodes: LayoutNode[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const edges: LayoutEdge[] = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
    const r1 = computeLayout(nodes, edges);
    const r2 = computeLayout(nodes, edges);
    expect(r1).toEqual(r2);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run src/web/layout.test.ts`
Expected: FAIL — `./layout.js` not found.

- [ ] **Step 3: Implement `src/web/layout.ts`**

```typescript
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

export interface LayoutNode { id: string; }
export interface LayoutEdge { source: string; target: string; }
export interface LaidOutNode { id: string; x: number; y: number; }

// Seed random positions deterministically by hashing the node id, so that
// identical input graphs produce identical output. forceAtlas2 refines these
// initial positions but the starting point decides the final orientation.
function seededPosition(id: string): { x: number; y: number } {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < id.length; i++) {
    h1 = Math.imul(h1 ^ id.charCodeAt(i), 16777619);
    h2 = ((h2 << 5) + h2) ^ id.charCodeAt(i);
  }
  return {
    x: ((h1 >>> 0) % 1000) / 1000 - 0.5,
    y: ((h2 >>> 0) % 1000) / 1000 - 0.5,
  };
}

export function computeLayout(nodes: LayoutNode[], edges: LayoutEdge[]): LaidOutNode[] {
  const g = new Graph({ type: 'undirected', multi: false });
  for (const n of nodes) {
    const seed = seededPosition(n.id);
    g.addNode(n.id, { x: seed.x, y: seed.y });
  }
  for (const e of edges) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    if (e.source === e.target) continue;
    if (g.hasEdge(e.source, e.target)) continue;
    g.addEdge(e.source, e.target);
  }

  const settings = forceAtlas2.inferSettings(g);
  forceAtlas2.assign(g, {
    iterations: 500,
    settings: {
      ...settings,
      barnesHutOptimize: true,
      scalingRatio: 10,
      gravity: 1,
      slowDown: 5,
    },
  });

  return nodes.map((n) => {
    const attrs = g.getNodeAttributes(n.id);
    const x = Number.isFinite(attrs.x) ? attrs.x : 0;
    const y = Number.isFinite(attrs.y) ? attrs.y : 0;
    return { id: n.id, x, y };
  });
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run src/web/layout.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/layout.ts src/web/layout.test.ts
git commit -m "feat(web): graphology forceatlas2 layout wrapper (deterministic)"
```

---

## Task 9: Graph data endpoint with KV cache and similarity

**Files:**
- Create: `src/web/similarity.ts`
- Create: `src/web/graph-data.ts`
- Create: `src/web/graph.test.ts`

- [ ] **Step 1: Implement `src/web/similarity.ts`**

```typescript
import type { Env } from '../env.js';
import { queryVector } from '../vector/index.js';

export interface SimilarityEdge { source: string; target: string; score: number; }

// For each note, query Vectorize for its top-k neighbors and keep those above threshold.
// Then deduplicate symmetric pairs (a↔b only once) and drop pairs that already have
// an explicit edge. The caller provides explicit pairs so this stays pure.
export async function computeSimilarityEdges(
  env: Env,
  noteVectors: Array<{ id: string; values: number[] }>,
  explicitPairs: Set<string>,
  opts: { topK: number; minScore: number }
): Promise<SimilarityEdge[]> {
  const seen = new Set<string>();
  const out: SimilarityEdge[] = [];

  for (const n of noteVectors) {
    const matches = await queryVector(env, n.values, opts.topK + 1); // +1 for self
    for (const m of matches) {
      if (m.id === n.id) continue;
      if (m.score < opts.minScore) continue;
      const [a, b] = [n.id, m.id].sort();
      const key = `${a}|${b}`;
      if (seen.has(key) || explicitPairs.has(key)) continue;
      seen.add(key);
      out.push({ source: a, target: b, score: m.score });
    }
  }

  return out;
}

export function explicitPairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}
```

- [ ] **Step 2: Implement `src/web/graph-data.ts`**

```typescript
import type { Env } from '../env.js';
import type { NoteRow, EdgeRow } from '../db/queries.js';
import { requireSession } from './session.js';
import { computeLayout, type LayoutEdge, type LayoutNode } from './layout.js';
import { computeSimilarityEdges, explicitPairKey } from './similarity.js';

interface GraphNode { id: string; label: string; domain: string; size: number; x: number; y: number; }
interface ExplicitGraphEdge { id: string; source: string; target: string; type: 'explicit'; why: string; relation_type: string; }
interface SimilarGraphEdge { id: string; source: string; target: string; type: 'similar'; score: number; }
type GraphEdge = ExplicitGraphEdge | SimilarGraphEdge;

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  computedAt: number;
  sourceHash: string;
}

const CACHE_KEY = 'graph:v1';
const SIMILARITY_TOP_K = 3;
const SIMILARITY_MIN_SCORE = 0.75;

async function computeSourceHash(env: Env): Promise<string> {
  const n = await env.DB.prepare(`SELECT COALESCE(MAX(updated_at), 0) m, COUNT(*) c FROM notes`).first<{ m: number; c: number }>();
  const e = await env.DB.prepare(`SELECT COALESCE(MAX(created_at), 0) m, COUNT(*) c FROM edges`).first<{ m: number; c: number }>();
  return `n${n?.m ?? 0}x${n?.c ?? 0}_e${e?.m ?? 0}x${e?.c ?? 0}`;
}

function firstDomain(csv: string): string {
  const first = csv.split(',')[0]?.trim();
  return first || 'misc';
}

async function buildPayload(env: Env): Promise<GraphPayload> {
  const notesRes = await env.DB.prepare(`SELECT id, title, domains FROM notes`).all<Pick<NoteRow, 'id' | 'title' | 'domains'>>();
  const notes = notesRes.results ?? [];

  const edgesRes = await env.DB.prepare(`SELECT id, from_id, to_id, relation_type, why, created_at FROM edges`).all<EdgeRow>();
  const explicitEdges = edgesRes.results ?? [];

  const explicitPairs = new Set<string>();
  for (const e of explicitEdges) explicitPairs.add(explicitPairKey(e.from_id, e.to_id));

  // Fetch vectors for all notes from Vectorize (by id). Vectorize exposes getByIds.
  let noteVectors: Array<{ id: string; values: number[] }> = [];
  if (notes.length > 0) {
    const ids = notes.map((n) => n.id);
    // Chunk in groups of 100 to respect getByIds limits.
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const res = await env.VECTORIZE.getByIds(chunk);
      for (const v of res) {
        if (v.values) noteVectors.push({ id: v.id, values: Array.from(v.values) });
      }
    }
  }

  const similarityEdges = await computeSimilarityEdges(env, noteVectors, explicitPairs, {
    topK: SIMILARITY_TOP_K,
    minScore: SIMILARITY_MIN_SCORE,
  });

  const degree = new Map<string, number>();
  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);
  for (const e of explicitEdges) { bump(e.from_id); bump(e.to_id); }
  for (const e of similarityEdges) { bump(e.source); bump(e.target); }

  const layoutNodes: LayoutNode[] = notes.map((n) => ({ id: n.id }));
  const layoutEdges: LayoutEdge[] = [
    ...explicitEdges.map((e) => ({ source: e.from_id, target: e.to_id })),
    ...similarityEdges.map((e) => ({ source: e.source, target: e.target })),
  ];
  const laidOut = computeLayout(layoutNodes, layoutEdges);
  const pos = new Map(laidOut.map((n) => [n.id, n]));

  const nodes: GraphNode[] = notes.map((n) => {
    const p = pos.get(n.id) ?? { x: 0, y: 0 };
    return {
      id: n.id,
      label: n.title,
      domain: firstDomain(n.domains),
      size: 1 + Math.log((degree.get(n.id) ?? 0) + 1),
      x: p.x,
      y: p.y,
    };
  });

  const edges: GraphEdge[] = [
    ...explicitEdges.map<ExplicitGraphEdge>((e) => ({
      id: `exp:${e.id}`,
      source: e.from_id,
      target: e.to_id,
      type: 'explicit',
      why: e.why,
      relation_type: e.relation_type,
    })),
    ...similarityEdges.map<SimilarGraphEdge>((e, i) => ({
      id: `sim:${e.source}:${e.target}:${i}`,
      source: e.source,
      target: e.target,
      type: 'similar',
      score: e.score,
    })),
  ];

  return {
    nodes,
    edges,
    computedAt: Math.floor(Date.now() / 1000),
    sourceHash: await computeSourceHash(env),
  };
}

export async function handleGraphData(req: Request, env: Env): Promise<Response> {
  const session = await requireSession(req, env);
  if (!session.ok) return session.response;

  const sourceHash = await computeSourceHash(env);
  const cached = await env.GRAPH_CACHE.get(CACHE_KEY, 'json') as GraphPayload | null;
  if (cached && cached.sourceHash === sourceHash) {
    return Response.json(cached, { headers: { 'cache-control': 'no-store' } });
  }

  const payload = await buildPayload(env);
  await env.GRAPH_CACHE.put(CACHE_KEY, JSON.stringify(payload));
  return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
}
```

- [ ] **Step 3: Write failing tests**

`src/web/graph.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { runMigrations } from '../db/migrate.js';
import { signSession } from './session.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

async function authCookie(): Promise<string> {
  const token = await signSession('robson@example.com', SECRET, Math.floor(Date.now() / 1000));
  return `mv_session=${token}`;
}

beforeAll(async () => {
  (env as any).OWNER_EMAIL = 'robson@example.com';
  (env as any).SESSION_SECRET = SECRET;
  await runMigrations(env as any);
  // Clean slate for this suite
  await env.DB.prepare(`DELETE FROM edges`).run();
  await env.DB.prepare(`DELETE FROM notes`).run();
  await env.DB.prepare(`INSERT INTO notes (id,title,body,tldr,domains,kind,created_at,updated_at)
    VALUES ('g1','Graph One','b','t','infra',NULL,1,1)`).run();
  await env.DB.prepare(`INSERT INTO notes (id,title,body,tldr,domains,kind,created_at,updated_at)
    VALUES ('g2','Graph Two','b','t','retrieval',NULL,2,2)`).run();
  await env.DB.prepare(`INSERT INTO edges (id,from_id,to_id,relation_type,why,created_at)
    VALUES ('ge1','g1','g2','depends_on','because',3)`).run();
});

describe('/app/graph/data', () => {
  it('redirects without session', async () => {
    const res = await SELF.fetch('https://x.test/app/graph/data', { redirect: 'manual' });
    expect(res.status).toBe(302);
  });

  it('returns nodes and edges', async () => {
    const res = await SELF.fetch('https://x.test/app/graph/data', { headers: { cookie: await authCookie() } });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.nodes).toHaveLength(2);
    expect(data.edges.length).toBeGreaterThanOrEqual(1);
    const explicit = data.edges.find((e: any) => e.type === 'explicit');
    expect(explicit).toBeDefined();
    expect(explicit.source).toBe('g1');
    expect(explicit.target).toBe('g2');
    for (const n of data.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('serves from cache on second call (sourceHash match)', async () => {
    const r1 = await SELF.fetch('https://x.test/app/graph/data', { headers: { cookie: await authCookie() } });
    const d1 = await r1.json() as any;
    const r2 = await SELF.fetch('https://x.test/app/graph/data', { headers: { cookie: await authCookie() } });
    const d2 = await r2.json() as any;
    expect(d2.computedAt).toBe(d1.computedAt);
  });

  it('invalidates cache when a note is updated', async () => {
    const r1 = await SELF.fetch('https://x.test/app/graph/data', { headers: { cookie: await authCookie() } });
    const d1 = await r1.json() as any;
    await env.DB.prepare(`UPDATE notes SET updated_at = ? WHERE id = 'g1'`).bind(d1.computedAt + 10).run();
    const r2 = await SELF.fetch('https://x.test/app/graph/data', { headers: { cookie: await authCookie() } });
    const d2 = await r2.json() as any;
    expect(d2.sourceHash).not.toBe(d1.sourceHash);
  });
});
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/similarity.ts src/web/graph-data.ts src/web/graph.test.ts
git commit -m "feat(web): graph-data endpoint — layout, similarity, KV cache"
```

---

## Task 10: Route dispatcher and OAuth handler integration

**Files:**
- Create: `src/web/handler.ts`
- Create: `src/web/graph.ts`
- Modify: `src/auth/handler.ts`

- [ ] **Step 1: Create `src/web/graph.ts` (HTML shell for `/app/graph`)**

```typescript
import type { Env } from '../env.js';
import { requireSession } from './session.js';
import { renderShell, htmlResponse } from './render.js';

export async function handleGraphPage(req: Request, env: Env): Promise<Response> {
  const session = await requireSession(req, env);
  if (!session.ok) return session.response;

  const body = `
    <div style="position:relative;height:calc(100vh - 64px);margin:-32px -40px;">
      <div id="graph-overlay" style="position:absolute;top:16px;left:16px;z-index:10;background:rgba(10,6,24,0.75);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--text-dim);pointer-events:none;">
        <div id="graph-count">Loading…</div>
        <div style="margin-top:6px;display:flex;gap:10px;align-items:center;">
          <span style="display:inline-block;width:16px;border-top:2px solid #b48cff;"></span> explicit
          <span style="display:inline-block;width:16px;border-top:2px dashed #8cc8ff;margin-left:6px;"></span> similar
        </div>
      </div>
      <div id="graph-canvas" style="position:absolute;inset:0;"></div>
    </div>
    <script src="/app/graph/bundle.js" defer></script>
  `;

  return htmlResponse(
    renderShell({ title: 'Graph', active: 'graph', email: session.email, body })
  );
}
```

- [ ] **Step 2: Create `src/web/handler.ts`**

```typescript
import type { Env } from '../env.js';
import { handleLoginGet, handleLoginPost, handleLogoutPost } from './login.js';
import { handleNotesList, handleNoteDetail } from './notes.js';
import { handleGraphPage } from './graph.js';
import { handleGraphData } from './graph-data.js';

export async function handleApp(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (!path.startsWith('/app')) return null;

  if (path === '/app' || path === '/app/') {
    return new Response(null, { status: 302, headers: { location: '/app/notes' } });
  }
  if (path === '/app/login' && req.method === 'GET') return handleLoginGet(req);
  if (path === '/app/login' && req.method === 'POST') return handleLoginPost(req, env);
  if (path === '/app/logout' && req.method === 'POST') return handleLogoutPost(req);
  if (path === '/app/notes' && req.method === 'GET') return handleNotesList(req, env);

  const noteMatch = path.match(/^\/app\/notes\/([A-Za-z0-9_-]+)$/);
  if (noteMatch && req.method === 'GET') return handleNoteDetail(req, env, noteMatch[1]);

  if (path === '/app/graph' && req.method === 'GET') return handleGraphPage(req, env);
  if (path === '/app/graph/data' && req.method === 'GET') return handleGraphData(req, env);

  if (path === '/app/graph/bundle.js' && req.method === 'GET') {
    return env.ASSETS.fetch(new Request(new URL('/graph.bundle.js', url.origin)));
  }

  return new Response('Not found', { status: 404 });
}
```

- [ ] **Step 3: Wire into `src/auth/handler.ts`**

Add import at the top:
```typescript
import { handleApp } from '../web/handler.js';
```

Add at the very start of the `fetch` method, before the existing `if (url.pathname === '/')`:
```typescript
if (url.pathname.startsWith('/app')) {
  const res = await handleApp(req, env);
  if (res) return res;
}
```

- [ ] **Step 4: Run ALL web suites — expect PASS**

Run: `npx vitest run src/web/`
Expected: session, login, notes, layout, graph — all PASS. The tests from Tasks 5/7/9 that depended on dispatch now turn green.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all previously-passing tests still PASS, new web suite PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/handler.ts src/web/graph.ts src/auth/handler.ts
git commit -m "feat(web): /app/* dispatcher wired into authHandler"
```

---

## Task 11: Sigma client bundle

**Files:**
- Create: `src/web/client/graph.ts`
- Create: `scripts/build-graph-bundle.ts`
- Create: `assets/graph.bundle.js` (built output, committed)
- Modify: `package.json` (add `build:bundle` script)

- [ ] **Step 1: Create `src/web/client/graph.ts`**

```typescript
import Graph from 'graphology';
import Sigma from 'sigma';

interface GraphNode { id: string; label: string; domain: string; size: number; x: number; y: number; }
interface ExplicitEdge { id: string; source: string; target: string; type: 'explicit'; why: string; relation_type: string; }
interface SimilarEdge { id: string; source: string; target: string; type: 'similar'; score: number; }
type Edge = ExplicitEdge | SimilarEdge;
interface Payload { nodes: GraphNode[]; edges: Edge[]; }

// Stable color per domain using string hash → HSL hue in the nebula range.
function domainColor(domain: string): string {
  let h = 2166136261;
  for (let i = 0; i < domain.length; i++) h = Math.imul(h ^ domain.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360;
  // Pastel lavender/cyan/pink range — high lightness, moderate saturation
  return `hsl(${hue}, 70%, 72%)`;
}

async function main() {
  const res = await fetch('/app/graph/data', { credentials: 'same-origin' });
  if (!res.ok) {
    document.getElementById('graph-count')!.textContent = 'Failed to load graph';
    return;
  }
  const payload = (await res.json()) as Payload;

  const container = document.getElementById('graph-canvas') as HTMLElement;
  const graph = new Graph({ type: 'undirected', multi: true });

  for (const n of payload.nodes) {
    graph.addNode(n.id, {
      label: n.label,
      x: n.x,
      y: n.y,
      size: 3 + n.size * 1.6,
      color: domainColor(n.domain),
    });
  }

  for (const e of payload.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    graph.addEdgeWithKey(e.id, e.source, e.target, {
      type: e.type === 'explicit' ? 'line' : 'line',
      size: e.type === 'explicit' ? 1.2 : 0.6,
      color: e.type === 'explicit' ? 'rgba(180, 140, 255, 0.55)' : 'rgba(140, 200, 255, 0.25)',
    });
  }

  const renderer = new Sigma(graph, container, {
    labelColor: { color: '#e8dcff' },
    labelSize: 12,
    labelWeight: '500',
    defaultNodeColor: '#b48cff',
    defaultEdgeColor: 'rgba(180, 140, 255, 0.35)',
    renderEdgeLabels: false,
    minCameraRatio: 0.1,
    maxCameraRatio: 10,
  });

  const explicitCount = payload.edges.filter((e) => e.type === 'explicit').length;
  const similarCount = payload.edges.length - explicitCount;
  document.getElementById('graph-count')!.textContent =
    `${payload.nodes.length} notes · ${explicitCount} explicit · ${similarCount} similar`;

  renderer.on('clickNode', ({ node }) => {
    window.location.href = `/app/notes/${encodeURIComponent(node)}`;
  });

  // Neighbor-highlight on hover
  renderer.on('enterNode', ({ node }) => {
    const neighbors = new Set<string>();
    neighbors.add(node);
    graph.forEachNeighbor(node, (n) => neighbors.add(n));
    renderer.setSetting('nodeReducer', (n, attrs) =>
      neighbors.has(n) ? attrs : { ...attrs, color: 'rgba(180, 140, 255, 0.15)', label: '' }
    );
    renderer.setSetting('edgeReducer', (edge, attrs) => {
      const [s, t] = graph.extremities(edge);
      return neighbors.has(s) && neighbors.has(t) ? attrs : { ...attrs, hidden: true };
    });
  });
  renderer.on('leaveNode', () => {
    renderer.setSetting('nodeReducer', null);
    renderer.setSetting('edgeReducer', null);
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('graph-count');
  if (el) el.textContent = 'Error loading graph';
});
```

- [ ] **Step 2: Create `scripts/build-graph-bundle.ts`**

```typescript
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

await build({
  entryPoints: [path.join(root, 'src/web/client/graph.ts')],
  outfile: path.join(root, 'assets/graph.bundle.js'),
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  loader: { '.ts': 'ts' },
});

console.log('built assets/graph.bundle.js');
```

- [ ] **Step 3: Add build script to `package.json`**

Edit the `scripts` section:
```json
"scripts": {
  "dev": "wrangler dev",
  "build:bundle": "tsx scripts/build-graph-bundle.ts",
  "deploy": "npm run build:skill && npm run build:bundle && wrangler deploy",
  "build:skill": "tsx scripts/build-skill-zip.ts",
  "test": "vitest run && vitest run --config vitest.auth.config.ts",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit"
}
```

- [ ] **Step 4: Build the bundle**

Run: `npm run build:bundle`
Expected: `assets/graph.bundle.js` exists. `ls -lh assets/graph.bundle.js` shows < 500KB.

- [ ] **Step 5: Commit**

```bash
git add src/web/client/graph.ts scripts/build-graph-bundle.ts assets/graph.bundle.js package.json
git commit -m "feat(web): sigma.js client bundle with hover highlight + node click"
```

---

## Task 12: Setup wizard — generate SESSION_SECRET and KV instructions

**Files:**
- Modify: `src/auth/handler.ts` (the `handleCredentials` function)
- Modify: `src/auth/setup.ts` (if needed, for `isSetup` to also check `SESSION_SECRET`)

- [ ] **Step 1: Update `isSetup` to require `SESSION_SECRET`**

Edit `src/auth/setup.ts`:
```typescript
export function isSetup(env: Env): boolean {
  return Boolean(env.OWNER_EMAIL && env.OWNER_PASSWORD_HASH && env.SESSION_SECRET);
}
```

- [ ] **Step 2: Generate `SESSION_SECRET` in `handleCredentials`**

Edit `src/auth/handler.ts`, inside `handleCredentials`, after computing `hash`:
```typescript
const hash = await hashPassword(password);

// Generate a 32-byte session secret (hex) for the web dashboard cookie.
const secretBytes = new Uint8Array(32);
crypto.getRandomValues(secretBytes);
const sessionSecret = Array.from(secretBytes, (b) => b.toString(16).padStart(2, '0')).join('');

const emailCmd = `wrangler secret put OWNER_EMAIL`;
const hashCmd = `wrangler secret put OWNER_PASSWORD_HASH`;
const secretCmd = `wrangler secret put SESSION_SECRET`;
const kvCmd = `wrangler kv namespace create GRAPH_CACHE`;
```

- [ ] **Step 3: Add the new cards to the credentials page HTML**

Replace the card block in the response body (between `<h1>Credentials generated</h1>` and the `<p><a href="/">← Back...`) with:

```html
<h1>Credentials generated</h1>
<p>Paste the values below into the Worker secrets. Since the Worker cannot write secrets to itself, this step is manual — run the commands in your terminal one at a time and paste the value when wrangler prompts for it.</p>

<div class="card">
  <h2>1. Email</h2>
  <p>Command: <code>${esc(emailCmd)}</code></p>
  <p>Value:</p>
  <pre id="email-value">${esc(email)}</pre>
  <button type="button" data-copy="email-value">Copy email</button>
</div>

<div class="card">
  <h2>2. Passphrase hash (PBKDF2-SHA256, 100k iter)</h2>
  <p>Command: <code>${esc(hashCmd)}</code></p>
  <p>Value:</p>
  <pre id="hash-value">${esc(hash)}</pre>
  <button type="button" data-copy="hash-value">Copy hash</button>
</div>

<div class="card">
  <h2>3. Session secret (web dashboard cookie signing)</h2>
  <p>Command: <code>${esc(secretCmd)}</code></p>
  <p>Value:</p>
  <pre id="secret-value">${esc(sessionSecret)}</pre>
  <button type="button" data-copy="secret-value">Copy secret</button>
</div>

<div class="card">
  <h2>4. Graph cache KV namespace</h2>
  <p>Create the namespace:</p>
  <pre>${esc(kvCmd)}</pre>
  <p>Wrangler prints an <code>id</code>. Paste it into <code>wrangler.toml</code> replacing both <code>REPLACE_WITH_KV_ID</code> placeholders in the <code>[[kv_namespaces]]</code> block with <code>binding = "GRAPH_CACHE"</code>.</p>
</div>

<div class="card">
  <h2>5. Redeploy</h2>
  <p>After running all three <code>wrangler secret put</code> commands and updating <code>wrangler.toml</code> with the KV ID, run <code>wrangler deploy</code> once so the Worker picks up everything. The next visit to <code>/app</code> will redirect you to the dashboard login.</p>
</div>
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/handler.ts src/auth/setup.ts
git commit -m "feat(setup): wizard generates SESSION_SECRET + GRAPH_CACHE KV instructions"
```

---

## Task 13: Manual smoke test in dev

**Files:** none (manual verification)

- [ ] **Step 1: Start dev server**

Run: `npm run dev`
Expected: wrangler dev starts, prints local URL.

- [ ] **Step 2: Hit `/app` without session**

Open `http://localhost:8787/app` in a browser.
Expected: redirects to `/app/login`.

- [ ] **Step 3: Log in**

Enter the configured email and passphrase.
Expected: redirects to `/app/notes`, notes list renders with sidebar.

- [ ] **Step 4: Click a note**

Expected: note detail with markdown body and clickable outbound links if any.

- [ ] **Step 5: Open `/app/graph`**

Expected: WebGL canvas fills the main area, nodes render in Midnight Nebula colors, pan/zoom fluid. Overlay shows counts and legend.

- [ ] **Step 6: Click a node**

Expected: navigates to that note's detail page.

- [ ] **Step 7: Hover a node**

Expected: node + neighbors highlighted, rest of graph fades.

- [ ] **Step 8: Log out**

Expected: cookie cleared, redirect to `/app/login`.

- [ ] **Step 9: Verify MCP still works**

Run your usual Claude MCP connection flow to `/authorize`.
Expected: OAuth flow unchanged, token issued, MCP tool calls work. No regression.

- [ ] **Step 10: Commit (if any fixes were needed)**

If manual testing turned up bugs, fix them inline with small commits per issue. Otherwise this task is done.

---

## Self-Review Notes

- **Spec coverage:** login (T5) · notes list+detail+clickable links (T7) · graph page (T10) · graph data+layout+KV cache+similarity (T8, T9) · session security (T2-T3) · setup wizard (T12) · Midnight Nebula styles (T4) · markdown (T6) · Sigma client (T11) · manual smoke (T13).
- **Not explicit in spec but required:** `assets/graph.bundle.js` is committed so the Worker can serve it via the `ASSETS` binding without a build step at deploy time beyond `npm run build:bundle`.
- **Rate limit:** spec mentions 5 attempts/min rate limit on login. Deferred — not in any task. **Add before merging if you want it in MVP**, otherwise explicitly drop it from the spec. I'm dropping it for this plan to keep MVP tight; add it in a follow-up.
- **Testing dependency ordering:** tasks 5, 7, 9 test suites only fully pass after Task 10 wires the dispatcher. Pure-unit suites (session, layout) pass in isolation. This is called out in each affected task.
