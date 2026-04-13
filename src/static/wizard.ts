import { BASE_CSS } from './styles.js';

const PREFS_BLOCK = `Mind Vault is connected as an MCP server. When I am discussing
concepts, ideas, insights, decisions, or learnings — across any
domain — proactively think in terms of the latticework method:
- Check the vault via MindVault:recall before relying only on your
  own knowledge, especially for cross-domain analogies.
- When I share something worth remembering, offer to save it and,
  if I agree, atomize it into one concept per note, tag it with
  specific domain(s), sweep other domains for analogies, and
  create edges with substantive why justifications.
- When I ask about a topic that might be in the vault, prefer
  recall + expand over generic answers. The value of the vault
  comes from being read, not just written.
Follow the using-mind-vault skill for the full method.`;

const FOOTER_HTML = `
<div class="card footer">
  Made by Robson Lins &nbsp;·&nbsp;
  <a href="https://www.instagram.com/orobsonn" target="_blank">Instagram</a> &nbsp;·&nbsp;
  <a href="https://x.com/orobsonnn" target="_blank">X / Twitter</a> &nbsp;·&nbsp;
  <a href="https://youtube.com/@orobsonnn" target="_blank">YouTube</a>
</div>`;

export function renderNotConfigured(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mind Vault — Not configured</title>
  <style>${BASE_CSS}</style>
</head>
<body>
<main>
  <h1>Mind Vault</h1>
  <p style="color:#a7adb5">Worker is deployed, but the vault is not configured yet.</p>

  <div class="card">
    <h2>Finish setup from your agentic IDE</h2>
    <p>Mind Vault is configured by the agent, not by a web wizard. Open the repo in Claude Code (or any MCP-capable IDE) and ask it to set up Mind Vault — it will follow the checklist in <code>CLAUDE.md</code> at the repo root.</p>
    <p>The agent will:</p>
    <ul>
      <li>Provision D1, Vectorize and the two KV namespaces</li>
      <li>Update <code>wrangler.toml</code> with the new IDs</li>
      <li>Prompt you for an email + passphrase</li>
      <li>Hash the passphrase and generate a <code>SESSION_SECRET</code></li>
      <li>Push the three secrets with <code>wrangler secret put</code></li>
      <li>Run <code>wrangler deploy</code> and apply the D1 schema</li>
    </ul>
    <p>The only thing you type is the email and the passphrase.</p>
  </div>

  ${FOOTER_HTML}
</main>
</body>
</html>`;
}

export interface LandingStats {
  notes: number;
  edges: number;
  lastWrite: number | null;
  clients: number;
  tokens: number;
  connected: boolean;
}

export function renderLanding(stats: LandingStats): string {
  const lastWriteStr = stats.lastWrite
    ? new Date(stats.lastWrite).toLocaleString('en-US')
    : 'Never';

  const badge = stats.connected
    ? `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#14351f;color:#6fe39a;font-size:12px;font-weight:600;border:1px solid #1f5a33">● Claude connected</span>`
    : `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#2a2017;color:#ffb870;font-size:12px;font-weight:600;border:1px solid #5a3a1f">○ Waiting for Claude connection</span>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mind Vault</title>
  <style>${BASE_CSS}
    .url-box { word-break: break-all; font-family: ui-monospace, Menlo, monospace; background:#0b0d10; border:1px solid #1e242b; border-radius:8px; padding:12px; font-size:13px; color:#e6e8eb; }
    .row { display:flex; gap:8px; align-items:flex-start; flex-wrap:wrap; }
    .row > :first-child { flex:1; min-width:260px; }
  </style>
</head>
<body>
<main>
  <h1>Mind Vault ${badge}</h1>
  <p style="color:#a7adb5">Personal latticework knowledge graph operated via Claude MCP.</p>

  <div class="card">
    <h2>Vault Status</h2>
    <p><strong>Notes:</strong> ${stats.notes} &nbsp;·&nbsp; <strong>Edges:</strong> ${stats.edges} &nbsp;·&nbsp; <strong>Last write:</strong> ${lastWriteStr}</p>
    <p style="color:#a7adb5;font-size:13px"><strong>Registered OAuth clients:</strong> ${stats.clients} &nbsp;·&nbsp; <strong>Active tokens:</strong> ${stats.tokens}</p>
    <p style="color:#6b7278;font-size:12px">Auto-refreshes every 15s · <a href="#" onclick="location.reload();return false">reload now</a></p>
  </div>

  <div class="card">
    <h2>1. MCP server URL</h2>
    <p style="color:#a7adb5">Paste this URL into Claude Desktop / Web → Settings → Connectors → Add custom connector.</p>
    <div class="row">
      <div id="mcp-url" class="url-box">/mcp</div>
      <button type="button" data-copy="mcp-url">Copy URL</button>
    </div>
    <details style="margin-top:12px">
      <summary style="cursor:pointer;color:#a7adb5">Using Claude Code (CLI)?</summary>
      <div class="row" style="margin-top:8px">
        <div id="code-add" class="url-box">claude mcp add --transport http mind-vault &lt;URL&gt;</div>
        <button type="button" data-copy="code-add">Copy command</button>
      </div>
    </details>
  </div>

  <div class="card">
    <h2>2. Skill: <code>using-mind-vault</code></h2>
    <p style="color:#a7adb5">Download the ZIP and install it in your Claude client. The skill teaches the latticework method — atomize the concept, cross-domain sweep, edge discipline with a concrete <em>why</em>.</p>
    <p><a href="/skill/using-mind-vault.zip" download><button type="button">⬇ Download using-mind-vault.zip</button></a></p>
    <p style="color:#6b7278;font-size:12px"><strong>Claude Code:</strong> extract to <code>~/.claude/skills/</code> · <strong>Desktop / Web:</strong> Settings → Skills → Import</p>
  </div>

  <div class="card">
    <h2>3. Personalization prompt</h2>
    <p style="color:#a7adb5">Paste into <em>Claude → Settings → Personalization → Custom instructions</em> to activate the latticework behavior proactively in every conversation, not just when the topic is obvious.</p>
    <pre id="prefs-block">${PREFS_BLOCK}</pre>
    <button type="button" data-copy="prefs-block">Copy prompt</button>
  </div>

  ${FOOTER_HTML}
</main>

<script>
  (function () {
    const url = location.origin + '/mcp';
    const urlEl = document.getElementById('mcp-url');
    if (urlEl) urlEl.textContent = url;
    const codeEl = document.getElementById('code-add');
    if (codeEl) codeEl.textContent = 'claude mcp add --transport http mind-vault ' + url;
  })();

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
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
      btn.textContent = ok ? 'Copied ✓' : 'Select + Ctrl+C';
      btn.style.background = ok ? '#4caf50' : '#ff9800';
      setTimeout(() => {
        btn.textContent = original;
        btn.style.background = '';
      }, 1800);
    });
  });

  async function refreshStatus() {
    try {
      const r = await fetch('/status', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j.configured) return;
      const wasConnected = ${stats.connected ? 'true' : 'false'};
      if (j.connected !== wasConnected) {
        location.reload();
      }
    } catch (_) {}
  }
  setInterval(refreshStatus, 15000);
<\/script>
</body>
</html>`;
}
