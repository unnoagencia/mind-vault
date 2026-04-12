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
}

export function renderLanding(stats: LandingStats): string {
  const lastWriteStr = stats.lastWrite
    ? new Date(stats.lastWrite).toLocaleString('pt-BR')
    : 'Nunca';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mind Vault</title>
  <style>${BASE_CSS}</style>
</head>
<body>
<main>
  <h1>Mind Vault</h1>
  <p>Servidor MCP ativo em <code id="mcp-url">/mcp</code></p>

  <div class="card">
    <h2>Status do Vault</h2>
    <p><strong>Notas:</strong> ${stats.notes}</p>
    <p><strong>Edges:</strong> ${stats.edges}</p>
    <p><strong>Último write:</strong> ${lastWriteStr}</p>
  </div>

  ${FOOTER_HTML}
</main>
${MCP_URL_SCRIPT}
</body>
</html>`;
}
