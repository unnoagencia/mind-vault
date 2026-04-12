import type { Env } from '../env.js';
import { handleRoot, handleProvision, isSetup } from './setup.js';
import { hashPassword, verifyPassword } from './password.js';
import { BASE_CSS } from '../static/styles.js';
import { esc } from '../util/html.js';

export const authHandler = {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/') return handleRoot(req, env);
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
    `<!doctype html><html><head><meta charset="utf-8"><title>Mind Vault — Credenciais</title><style>${BASE_CSS}</style></head>
<body><main>
  <h1>Credenciais geradas</h1>
  <p>Cole os valores abaixo nos secrets do Worker. Ainda não dá pra escrever secrets a partir do próprio Worker, então isso é um passo manual — rode os comandos no seu terminal, um de cada vez, e cole os valores quando o wrangler pedir.</p>

  <div class="card">
    <h2>1. Email</h2>
    <p>Comando: <code>${esc(emailCmd)}</code></p>
    <p>Valor: <code id="email">${esc(email)}</code></p>
    <button onclick="navigator.clipboard.writeText(document.getElementById('email').innerText)">Copiar email</button>
  </div>

  <div class="card">
    <h2>2. Hash da passphrase (argon2id)</h2>
    <p>Comando: <code>${esc(hashCmd)}</code></p>
    <p>Valor:</p>
    <pre id="hash">${esc(hash)}</pre>
    <button onclick="navigator.clipboard.writeText(document.getElementById('hash').innerText)">Copiar hash</button>
  </div>

  <div class="card">
    <h2>3. Redeploy</h2>
    <p>Depois dos dois <code>wrangler secret put</code>, rode <code>wrangler deploy</code> uma vez pra o Worker ler os secrets. A próxima visita à home vai mostrar o status do cofre em vez deste wizard.</p>
  </div>

  <p><a href="/">← Voltar</a></p>
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
