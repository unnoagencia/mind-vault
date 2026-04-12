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
  Feito por Robson Lins &nbsp;·&nbsp;
  <a href="https://www.instagram.com/orobsonn" target="_blank">Instagram</a> &nbsp;·&nbsp;
  <a href="https://x.com/orobsonnn" target="_blank">X / Twitter</a> &nbsp;·&nbsp;
  <a href="https://youtube.com/@orobsonnn" target="_blank">YouTube</a>
</div>`;

const MCP_URL_SCRIPT = `<script>
  (function () {
    const url = location.origin + '/mcp';
    const urlEl = document.getElementById('mcp-url');
    if (urlEl) urlEl.textContent = url;
    const codeEl = document.getElementById('code-add');
    if (codeEl) codeEl.textContent = 'claude mcp add --transport http mind-vault ' + url;
  })();
<\/script>`;

export function renderWizard(): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mind Vault — Setup</title>
  <style>${BASE_CSS}</style>
</head>
<body>
<main>
  <h1>Mind Vault</h1>
  <p>Configure seu grafo pessoal de conhecimento em 5 passos.</p>

  <div class="card">
    <h2>1. Credenciais</h2>
    <p>Defina o email e a passphrase que você usará para autorizar o Claude a acessar o vault.</p>
    <form method="post" action="/setup/credentials">
      <p><label>Email<br><input type="email" name="email" required placeholder="voce@exemplo.com"></label></p>
      <p><label>Passphrase<br><input type="password" name="password" required placeholder="frase longa e memorável"></label></p>
      <p><label>Confirmar passphrase<br><input type="password" name="password_confirm" required placeholder="repita a passphrase"></label></p>
      <button type="submit">Salvar credenciais</button>
    </form>
  </div>

  <div class="card">
    <h2>2. Provisioning</h2>
    <p>Aplica o schema do Mind Vault no seu banco D1 (tabelas <code>notes</code>, <code>edges</code>, <code>tags</code>, FTS5 e triggers). Idempotente — pode clicar mais de uma vez sem problema.</p>
    <p style="color:#a7adb5;font-size:13px">O índice Vectorize <code>mind-vault-embeddings</code> e o namespace KV <code>OAUTH_KV</code> são provisionados separadamente, antes do primeiro <code>wrangler deploy</code>, via CLI: <code>wrangler vectorize create mind-vault-embeddings --dimensions=768 --metric=cosine</code> e <code>wrangler kv namespace create OAUTH_KV</code>. Se você deployou pelo botão "Deploy to Cloudflare" do README, o Cloudflare já criou tudo a partir dos bindings do <code>wrangler.toml</code>.</p>
    <button id="btn-provision" onclick="provision(this)">Provisionar banco</button>
    <p id="provision-status" style="display:none;color:#4caf50">Schema aplicado com sucesso!</p>
    <script>
      async function provision(btn) {
        btn.disabled = true;
        const r = await fetch('/setup/provision', { method: 'POST' });
        const j = await r.json();
        if (j.ok) {
          document.getElementById('provision-status').style.display = '';
          btn.textContent = 'Provisionado ✓';
        } else {
          btn.disabled = false;
          alert('Erro ao provisionar: ' + JSON.stringify(j));
        }
      }
    <\/script>
  </div>

  <div class="card">
    <h2>3. Conectar ao Claude</h2>
    <p>URL do servidor MCP:</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <code id="mcp-url" style="flex:1;min-width:280px">/mcp</code>
      <button type="button" onclick="copyMcpUrl(this)">Copiar URL</button>
    </div>
    <div class="tabs" style="margin-top:16px">
      <div class="tab active" onclick="showTab(this,'code')">Claude Code</div>
      <div class="tab" onclick="showTab(this,'ui')">Claude Desktop / Web</div>
    </div>
    <div id="tab-code">
      <p>Execute no terminal (o comando já vem com a URL deste Worker):</p>
      <pre id="code-add">claude mcp add --transport http mind-vault &lt;URL&gt;</pre>
      <button type="button" onclick="copyCodeCmd(this)">Copiar comando</button>
    </div>
    <div id="tab-ui" style="display:none">
      <p>Claude Desktop e Claude Web usam o mesmo fluxo — ambos plugam um MCP remoto pela UI de Connectors:</p>
      <ol>
        <li>Abra <strong>Claude Desktop</strong> ou <a href="https://claude.ai" target="_blank">claude.ai</a>.</li>
        <li>Vá em <strong>Settings → Connectors</strong> (em versões antigas: <em>Integrations</em>).</li>
        <li>Clique em <strong>Add custom connector</strong> (ou <em>Add MCP server</em>).</li>
        <li>Cole a URL acima no campo <em>URL</em> e dê um nome (ex: <code>mind-vault</code>).</li>
        <li>O Claude vai abrir uma janela de OAuth — faça login com o email + passphrase que você definiu no passo 1.</li>
      </ol>
      <p style="color:#a7adb5;font-size:13px">Observação: o Claude detecta automaticamente que este é um servidor MCP com OAuth 2.1 + dynamic client registration, então o único dado que você precisa colar é a URL.</p>
    </div>
    <script>
      function showTab(el, id) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        el.classList.add('active');
        ['code','ui'].forEach(t => {
          document.getElementById('tab-' + t).style.display = t === id ? '' : 'none';
        });
      }
      function copyMcpUrl(btn) {
        navigator.clipboard.writeText(document.getElementById('mcp-url').textContent.trim());
        flash(btn);
      }
      function copyCodeCmd(btn) {
        const url = document.getElementById('mcp-url').textContent.trim();
        navigator.clipboard.writeText('claude mcp add --transport http mind-vault ' + url);
        flash(btn);
      }
      function flash(btn) {
        const original = btn.textContent;
        btn.textContent = 'Copiado ✓';
        setTimeout(() => { btn.textContent = original; }, 1500);
      }
    <\/script>
  </div>

  <div class="card">
    <h2>4. Instalar a Skill</h2>
    <p>Baixe o arquivo ZIP da skill e instale no Claude:</p>
    <p><a href="/skill/using-mind-vault.zip" download>⬇ using-mind-vault.zip</a></p>
    <p><strong>Claude Code:</strong> <code>claude mcp install-skill using-mind-vault.zip</code></p>
    <p><strong>Claude Desktop / Web:</strong> Vá em Settings → Skills → Import e selecione o arquivo ZIP.</p>
  </div>

  <div class="card">
    <h2>5. Personalizar o Claude</h2>
    <p>Cole o bloco abaixo em Settings → Personalization → Custom instructions:</p>
    <pre id="prefs">${PREFS_BLOCK}</pre>
    <button onclick="copyPrefs()">Copiar</button>
    <script>
      function copyPrefs() {
        navigator.clipboard.writeText(document.getElementById('prefs').textContent.trim());
      }
    <\/script>
  </div>

  ${FOOTER_HTML}
</main>
${MCP_URL_SCRIPT}
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
    ? new Date(stats.lastWrite).toLocaleString('pt-BR')
    : 'Nunca';

  const badge = stats.connected
    ? `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#14351f;color:#6fe39a;font-size:12px;font-weight:600;border:1px solid #1f5a33">● Claude conectado</span>`
    : `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#2a2017;color:#ffb870;font-size:12px;font-weight:600;border:1px solid #5a3a1f">○ Aguardando conexão Claude</span>`;

  return `<!doctype html>
<html lang="pt-BR">
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
  <p style="color:#a7adb5">Cofre pessoal de conhecimento latticework operado via Claude MCP.</p>

  <div class="card">
    <h2>Status do Vault</h2>
    <p><strong>Notas:</strong> ${stats.notes} &nbsp;·&nbsp; <strong>Edges:</strong> ${stats.edges} &nbsp;·&nbsp; <strong>Último write:</strong> ${lastWriteStr}</p>
    <p style="color:#a7adb5;font-size:13px"><strong>Clientes OAuth registrados:</strong> ${stats.clients} &nbsp;·&nbsp; <strong>Tokens ativos:</strong> ${stats.tokens}</p>
    <p style="color:#6b7278;font-size:12px">Auto-atualiza a cada 15s · <a href="#" onclick="location.reload();return false">recarregar agora</a></p>
  </div>

  <div class="card">
    <h2>1. URL do servidor MCP</h2>
    <p style="color:#a7adb5">Cole essa URL em Claude Desktop / Web → Settings → Connectors → Add custom connector.</p>
    <div class="row">
      <div id="mcp-url" class="url-box">/mcp</div>
      <button type="button" data-copy="mcp-url">Copiar URL</button>
    </div>
    <details style="margin-top:12px">
      <summary style="cursor:pointer;color:#a7adb5">Usando Claude Code (CLI)?</summary>
      <div class="row" style="margin-top:8px">
        <div id="code-add" class="url-box">claude mcp add --transport http mind-vault &lt;URL&gt;</div>
        <button type="button" data-copy="code-add">Copiar comando</button>
      </div>
    </details>
  </div>

  <div class="card">
    <h2>2. Skill: <code>using-mind-vault</code></h2>
    <p style="color:#a7adb5">Baixe o ZIP e instale no cliente Claude da sua escolha. A skill ensina o método latticework — atomizar conceito, varredura cross-domain, disciplina de edges com <em>why</em> concreto.</p>
    <p><a href="/skill/using-mind-vault.zip" download><button type="button">⬇ Download using-mind-vault.zip</button></a></p>
    <p style="color:#6b7278;font-size:12px"><strong>Claude Code:</strong> extraia para <code>~/.claude/skills/</code> · <strong>Desktop / Web:</strong> Settings → Skills → Import</p>
  </div>

  <div class="card">
    <h2>3. Prompt de personalização</h2>
    <p style="color:#a7adb5">Cole em <em>Claude → Settings → Personalization → Custom instructions</em> para ativar o comportamento latticework proativamente em qualquer conversa, não só quando o tópico é óbvio.</p>
    <pre id="prefs-block">${PREFS_BLOCK}</pre>
    <button type="button" data-copy="prefs-block">Copiar prompt</button>
  </div>

  ${FOOTER_HTML}
</main>

<script>
  // Replace placeholders with real URL
  (function () {
    const url = location.origin + '/mcp';
    const urlEl = document.getElementById('mcp-url');
    if (urlEl) urlEl.textContent = url;
    const codeEl = document.getElementById('code-add');
    if (codeEl) codeEl.textContent = 'claude mcp add --transport http mind-vault ' + url;
  })();

  // Copy buttons with fallback + visual feedback
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
      btn.textContent = ok ? 'Copiado ✓' : 'Selecione + Ctrl+C';
      btn.style.background = ok ? '#4caf50' : '#ff9800';
      setTimeout(() => {
        btn.textContent = original;
        btn.style.background = '';
      }, 1800);
    });
  });

  // Auto-refresh status every 15s (soft: fetches /status and updates counters without full reload)
  async function refreshStatus() {
    try {
      const r = await fetch('/status', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (!j.configured) return;
      // Trigger full reload if transition connected/disconnected
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
