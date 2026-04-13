import type { Env } from '../env.js';
import { handleRoot, handleProvision, handleStatus, isSetup } from './setup.js';
import { hashPassword, verifyPassword } from './password.js';
import { BASE_CSS } from '../static/styles.js';
import { esc } from '../util/html.js';
import { handleApp } from '../web/handler.js';

export const authHandler = {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/app')) {
      const res = await handleApp(req, env);
      if (res) return res;
    }

    if (url.pathname === '/') return handleRoot(req, env);
    if (url.pathname === '/status') return handleStatus(env);
    if (url.pathname === '/setup/provision' && req.method === 'POST') return handleProvision(env);
    if (url.pathname === '/setup/credentials' && req.method === 'POST') return handleCredentials(req);

    if (url.pathname === '/skill/using-mind-vault.zip') {
      return env.ASSETS.fetch(new Request(new URL('/using-mind-vault.zip', url.origin)));
    }

    if (url.pathname === '/authorize') {
      if (!isSetup(env)) return new Response('Vault not configured', { status: 503 });
      const provider = (env as any).OAUTH_PROVIDER;
      if (req.method === 'POST') {
        const form = await req.formData();
        const email = String(form.get('email') ?? '');
        const password = String(form.get('password') ?? '');
        if (email !== env.OWNER_EMAIL) return renderLogin('Invalid credentials.', url.search);
        const ok = await verifyPassword(password, env.OWNER_PASSWORD_HASH!);
        if (!ok) return renderLogin('Invalid credentials.', url.search);
        // parseAuthRequest expects the original GET request; reconstruct it from the query string
        const authReq = await provider.parseAuthRequest(new Request(url.toString(), { method: 'GET' }));
        const result = await provider.completeAuthorization({
          request: authReq,
          userId: email,
          metadata: { email },
          scope: authReq.scope?.length ? authReq.scope : ['mcp'],
          props: { email, loggedInAt: Date.now() },
        });
        return Response.redirect(result.redirectTo, 302);
      }
      return renderLogin(null, url.search);
    }

    return new Response('Not found', { status: 404 });
  },
};

async function handleCredentials(req: Request): Promise<Response> {
  const form = await req.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const password2 = String(form.get('password_confirm') ?? form.get('password2') ?? '');

  if (!email || !password) return renderCredentialsError('Email and passphrase are required.');
  if (password.length < 12) return renderCredentialsError('Passphrase must be at least 12 characters.');
  if (password !== password2) return renderCredentialsError('Confirmation does not match the passphrase.');

  const hash = await hashPassword(password);

  // Generate a 32-byte session secret (hex) for the web dashboard cookie signing.
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const sessionSecret = Array.from(secretBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const emailCmd = `wrangler secret put OWNER_EMAIL`;
  const hashCmd = `wrangler secret put OWNER_PASSWORD_HASH`;
  const secretCmd = `wrangler secret put SESSION_SECRET`;
  const kvCmd = `wrangler kv namespace create GRAPH_CACHE`;

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mind Vault — Credentials</title><style>${BASE_CSS}</style></head>
<body><main>
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

  <p><a href="/">← Back to wizard</a></p>

  <script>
    async function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      return ok;
    }
    document.querySelectorAll('button[data-copy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-copy');
        const el = document.getElementById(id);
        if (!el) return;
        const text = (el.textContent || '').trim();
        const ok = await copyText(text);
        const original = btn.textContent;
        btn.textContent = ok ? 'Copied ✓' : 'Select the text and Ctrl+C';
        btn.style.background = ok ? '#4caf50' : '#ff9800';
        setTimeout(() => {
          btn.textContent = original;
          btn.style.background = '';
        }, 1800);
      });
    });
  <\/script>
</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

function renderCredentialsError(msg: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Error</title><style>${BASE_CSS}</style></head>
<body><main><h1>Error</h1><p style="color:#ff6b6b">${esc(msg)}</p><p><a href="/">← Back</a></p></main></body></html>`,
    { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

function renderLogin(error: string | null, qs: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Login</title><style>${BASE_CSS}</style></head>
<body><main><h1>Mind Vault</h1><p>Log in to authorize MCP access.</p>
${error ? `<p style="color:#ff6b6b">${esc(error)}</p>` : ''}
<form method="post" action="/authorize${esc(qs)}">
<p><label>Email<br><input type="email" name="email" required></label></p>
<p><label>Passphrase<br><input type="password" name="password" required></label></p>
<button type="submit">Authorize</button></form></main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
