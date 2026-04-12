import type { Env } from '../env.js';
import { handleRoot, handleProvision, handleStatus, isSetup } from './setup.js';
import { hashPassword, verifyPassword } from './password.js';
import { BASE_CSS } from '../static/styles.js';
import { esc } from '../util/html.js';

export const authHandler = {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

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
        if (email !== env.OWNER_EMAIL) return renderLogin('Credenciais inválidas.', url.search);
        const ok = await verifyPassword(password, env.OWNER_PASSWORD_HASH!);
        if (!ok) return renderLogin('Credenciais inválidas.', url.search);
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

  if (!email || !password) return renderCredentialsError('Email e passphrase são obrigatórios.');
  if (password.length < 12) return renderCredentialsError('Passphrase precisa de pelo menos 12 caracteres.');
  if (password !== password2) return renderCredentialsError('Confirmação não confere com a passphrase.');

  const hash = await hashPassword(password);
  const emailCmd = `wrangler secret put OWNER_EMAIL`;
  const hashCmd = `wrangler secret put OWNER_PASSWORD_HASH`;

  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mind Vault — Credenciais</title><style>${BASE_CSS}</style></head>
<body><main>
  <h1>Credenciais geradas</h1>
  <p>Cole os valores abaixo nos secrets do Worker. Como o próprio Worker não consegue escrever secrets em si mesmo, esse passo é manual — rode os comandos no terminal, um de cada vez, e cole o valor quando o wrangler pedir.</p>

  <div class="card">
    <h2>1. Email</h2>
    <p>Comando: <code>${esc(emailCmd)}</code></p>
    <p>Valor:</p>
    <pre id="email-value">${esc(email)}</pre>
    <button type="button" data-copy="email-value">Copiar email</button>
  </div>

  <div class="card">
    <h2>2. Hash da passphrase (PBKDF2-SHA256, 100k iter)</h2>
    <p>Comando: <code>${esc(hashCmd)}</code></p>
    <p>Valor:</p>
    <pre id="hash-value">${esc(hash)}</pre>
    <button type="button" data-copy="hash-value">Copiar hash</button>
  </div>

  <div class="card">
    <h2>3. Redeploy</h2>
    <p>Depois dos dois <code>wrangler secret put</code>, rode <code>wrangler deploy</code> uma vez para o Worker enxergar os novos secrets. A próxima visita à home vai mostrar o status do cofre em vez deste wizard, e <code>/authorize</code> vai renderizar a tela de login em vez de "Vault not configured".</p>
  </div>

  <p><a href="/">← Voltar ao wizard</a></p>

  <script>
    async function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
      }
      // Fallback: textarea + execCommand (works even fora de secure context)
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
        btn.textContent = ok ? 'Copiado ✓' : 'Selecione o texto e Ctrl+C';
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
    `<!doctype html><html><head><meta charset="utf-8"><title>Erro</title><style>${BASE_CSS}</style></head>
<body><main><h1>Erro</h1><p style="color:#ff6b6b">${esc(msg)}</p><p><a href="/">← Voltar</a></p></main></body></html>`,
    { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

function renderLogin(error: string | null, qs: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>Login</title><style>${BASE_CSS}</style></head>
<body><main><h1>Mind Vault</h1><p>Login para autorizar acesso MCP.</p>
${error ? `<p style="color:#ff6b6b">${esc(error)}</p>` : ''}
<form method="post" action="/authorize${esc(qs)}">
<p><label>Email<br><input type="email" name="email" required></label></p>
<p><label>Passphrase<br><input type="password" name="password" required></label></p>
<button type="submit">Autorizar</button></form></main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
