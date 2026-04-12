import type { Env } from '../env.js';
import { handleRoot, handleProvision, isSetup } from './setup.js';
import { verifyPassword } from './password.js';
import { BASE_CSS } from '../static/styles.js';
import { esc } from '../util/html.js';

export const authHandler = {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/') return handleRoot(req, env);
    if (url.pathname === '/setup/provision' && req.method === 'POST') return handleProvision(env);

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
