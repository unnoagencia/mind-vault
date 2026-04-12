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
  document.getElementById('mcp-url').textContent = location.origin + '/mcp';
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
    <p>Cria as tabelas no banco D1 e inicializa os índices Vectorize.</p>
    <button id="btn-provision" onclick="provision(this)">Provisionar banco</button>
    <p id="provision-status" style="display:none;color:#4caf50">Banco provisionado com sucesso!</p>
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
    <p>URL do servidor MCP: <code id="mcp-url">/mcp</code></p>
    <div class="tabs">
      <div class="tab active" onclick="showTab(this,'code')">Claude Code</div>
      <div class="tab" onclick="showTab(this,'desktop')">Claude Desktop</div>
      <div class="tab" onclick="showTab(this,'web')">Claude Web</div>
    </div>
    <div id="tab-code">
      <p>Execute no terminal:</p>
      <pre id="code-add">claude mcp add --transport http mind-vault https://&lt;seu-dominio&gt;/mcp</pre>
    </div>
    <div id="tab-desktop" style="display:none">
      <p>Adicione ao <code>claude_desktop_config.json</code>:</p>
      <pre>{
  "mcpServers": {
    "mind-vault": {
      "url": "https://&lt;seu-dominio&gt;/mcp",
      "transport": "http"
    }
  }
}</pre>
    </div>
    <div id="tab-web" style="display:none">
      <p>Em <a href="https://claude.ai" target="_blank">claude.ai</a>, vá em Settings → Integrations e adicione a URL do MCP.</p>
    </div>
    <script>
      function showTab(el, id) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        el.classList.add('active');
        ['code','desktop','web'].forEach(t => {
          document.getElementById('tab-' + t).style.display = t === id ? '' : 'none';
        });
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
