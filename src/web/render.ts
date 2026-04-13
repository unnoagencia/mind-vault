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
