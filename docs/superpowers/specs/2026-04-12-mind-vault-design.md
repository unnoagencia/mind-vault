# Mind Vault — Design Spec

**Data:** 2026-04-12
**Status:** approved design, ready for planning
**Autor:** Robson + Claude (brainstorm colaborativo)

---

## 1. Visão

**Mind Vault** é um cofre pessoal de conhecimento que vive inteiramente em uma conta Cloudflare do próprio usuário e é operado via MCP pelo Claude. Não é mais um "notes app com IA". É um **grafo de conceitos atômicos** interligados por arestas com justificativa explícita, desenhado para forçar pensamento **cross-domain** — a habilidade de reconhecer que um problema em um domínio tem a mesma estrutura que um problema em outro.

O usuário nunca toca uma UI de notas. Ele conversa com o Claude (Code, Desktop ou Web), e quando uma ideia digna de persistir aparece, o Claude decide salvar, atomiza o conceito, procura analogias em outros domínios do cofre, e grava com arestas que explicitam *por que* cada conexão existe.

**Não-objetivos:**
- Não é multi-tenant. É single-user por design.
- Não substitui Obsidian/Notion para captura diária indiscriminada.
- Não tem UI web de notas no MVP (só setup wizard + landing).
- Não faz deleção/edição no MVP (append-only).

## 2. Linhagem intelectual

O projeto sintetiza método de várias tradições. Cada decisão de design tem raiz numa delas:

- **Charlie Munger** — latticework of mental models, valor do cross-domain thinking. Norte, não dogma.
- **Scott E. Page** (*The Model Thinker*) — diversity prediction theorem: diversidade de modelos bate profundidade de um só. Fundamenta o **domain-balanced recall**.
- **Douglas Hofstadter + Emmanuel Sander** (*Surfaces and Analogies*) — analogia é o núcleo da cognição. Fundamenta o peso das arestas `analogous_to` e `same_mechanism_as`.
- **Dedre Gentner** (structure-mapping theory) — distinção entre similaridade superficial e estrutural. Fundamenta o rigor de `same_mechanism_as` contra edges preguiçosos.
- **Niklas Luhmann + Sönke Ahrens** (Zettelkasten, *How to Take Smart Notes*) — notas atômicas, links com substância, estrutura emergente. Fundamenta atomicidade, "nunca link sem why", e a regra "nem toda conversa vira nota".
- **Richard Feynman** — se não consegue explicar simples, não entende. Fundamenta o campo `tldr` obrigatório.
- **Karl Popper** — falibilismo. Fundamenta as arestas `contradicts` e `refines` como first-class.

Framing público do projeto: **"latticework thinking / many-model knowledge graph"**, não "Munger mental models".

## 3. Arquitetura

Um único Cloudflare Worker que serve três responsabilidades na mesma URL:

| Path | Função |
|------|--------|
| `/` | Landing + setup wizard (primeira visita) |
| `/authorize`, `/oauth/token`, `/oauth/register` | OAuth 2.1 via `@cloudflare/workers-oauth-provider` |
| `/mcp` | Endpoint MCP protegido via `agents/mcp` `createMcpHandler` |

**Bindings (`wrangler.toml`):**
```toml
[[d1_databases]]
binding = "DB"
database_name = "mind-vault"

[[vectorize]]
binding = "VECTORIZE"
index_name = "mind-vault-embeddings"

[ai]
binding = "AI"
```

- `DB` — D1 (SQLite) para notes, edges, tags, FTS5
- `VECTORIZE` — índice 768-dim cosine, um vetor por nota
- `AI` — Workers AI, modelo `@cf/baai/bge-base-en-v1.5` para embeddings

**Secrets (definidos no setup wizard, não no deploy):**
- `OWNER_EMAIL` — email do dono
- `OWNER_PASSWORD_HASH` — argon2id da passphrase
- `SESSION_SECRET` — segredo HMAC para sessions do OAuth consent

## 4. Fluxo de deploy

1. Usuário clica **"Deploy to Cloudflare"** no README (botão usa o workflow padrão `deploy.workers.cloudflare.com/?url=<repo>`).
2. Cloudflare forka o repo para a conta GitHub do usuário e provisiona D1 + Vectorize + binding AI automaticamente a partir do `wrangler.toml`.
3. Primeira visita à URL do Worker detecta que `OWNER_EMAIL` não está definido e abre um **setup wizard de uma tela**:
   - Define email + passphrase
   - Roda migrations no D1
   - Verifica que o índice Vectorize existe (cria via API se não)
   - Salva secrets via API do Workers (ou pede para o usuário rodar um comando — a ser verificado na implementação)
4. Wizard mostra a URL `/mcp` e um guia de 3 abas (**Claude Code / Desktop / Web**) com instruções de como plugar.
5. Final do wizard: card **"Feito por Robson"** com CTA para redes sociais (ver seção 4.2).
6. Também no final: seção **"Install the skill"** com download do ZIP e guia visual passo-a-passo por cliente (ver seção 4.3).
7. Usuário cola a URL no Claude → OAuth flow → login com email+passphrase → MCP conectado.
8. Wizard sugere também (ver seção 4.4) adicionar um bloco de preferências pessoais na configuração do Claude do usuário — para que o Claude ative o comportamento latticework proativamente em toda conversa, mesmo fora de tópicos óbvios.

### 4.1. Setup wizard — fluxo visual

O wizard é uma única página HTML servida pelo próprio Worker. Sequência:
1. **Welcome** — explica o que é o Mind Vault em 2 parágrafos, botão "Start setup".
2. **Credentials** — email + passphrase + confirmar. Grava hash via argon2id.
3. **Provisioning** — roda migrations no D1, verifica índice Vectorize (progress bar real).
4. **Connect to Claude** — URL do MCP + 3 abas (Code/Desktop/Web) com instruções copy-pastáveis.
5. **Install the skill** — ver 4.3.
6. **Personalize Claude** — ver 4.4.
7. **Follow the maker** — ver 4.2.

Depois de finalizado, a página `/` vira uma landing read-only que mostra status do cofre (conectado, N notas, N edges, último write) e links para as mesmas instruções.

### 4.2. Card "Feito por Robson"

Localização: última tela do wizard + footer da landing read-only.

Texto e links:
- **"Feito por Robson Lins. Se esse projeto te ajudou, me segue nas redes:"**
- Instagram — https://www.instagram.com/orobsonn
- X / Twitter — https://x.com/orobsonnn
- YouTube — https://youtube.com/@orobsonnn

Estilo: discreto mas visível, sem dark patterns (sem obrigatoriedade, sem popup, sem bloqueio de fluxo).

### 4.3. Instalação da skill

A skill é distribuída como **ZIP baixável**, não via comando CLI. Razões:
- Claude Desktop e Web suportam instalação de skills via upload, não só Code.
- Uniforme entre os 3 clientes — um fluxo só na documentação.
- Usuário não precisa ter `git` ou conhecer filesystem do Claude.

Implementação:
- Build step do repo gera `skills/using-mind-vault.zip` (todo o diretório da skill empacotado).
- Worker serve o ZIP em `/skill/using-mind-vault.zip` diretamente de `[assets]` do wrangler (static assets).
- Wizard tem botão grande **"Download skill (.zip)"** + 3 abas com instruções passo-a-passo por cliente:
  - **Claude Code** — comando para descompactar em `~/.claude/skills/`
  - **Claude Desktop** — caminho da pasta de skills + "arraste o ZIP extraído"
  - **Claude Web** — upload direto na UI de skills

Cada aba acompanha **screenshots anotados** que o usuário (Robson) vai fornecer durante a implementação. Placeholder nos screenshots até lá.

### 4.4. Bloco de personalização do Claude (user preferences)

Em *Claude → Settings → Personal preferences*, sugerir que o usuário adicione este bloco (copy-pastável no wizard):

```
Mind Vault is connected as an MCP server. When I am discussing
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
Follow the using-mind-vault skill for the full method.
```

O wizard tem um botão "Copy" ao lado do bloco e um link direto para `claude.ai/settings/profile` (Web) e instruções equivalentes para Desktop/Code. Este passo é **opcional mas fortemente recomendado** — sem ele, a skill só ativa quando o Claude percebe que o método é relevante; com ele, o comportamento vira default cross-domain em toda conversa.

**Callout de segurança obrigatório no README:** este é um cofre **single-user por design**. Não compartilhe a URL. Se quiser multi-user, fork e adapte — não é trivial.

## 5. Schema (D1)

Quatro tabelas + FTS virtual. Minimalismo intencional — estrutura cognitiva mora nas tool descriptions, não no schema.

```sql
-- Nota atômica: uma ideia, um conceito
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,           -- nanoid 12
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,              -- markdown
  tldr        TEXT NOT NULL,              -- 1 frase, teste de Feynman
  domains     TEXT NOT NULL,              -- JSON array, ex: ["evolutionary-biology","economics"]
  kind        TEXT,                       -- livre, opcional: "idea"|"fact"|"question"|"decision"|...
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Full-text search sobre title + tldr + body
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, tldr, body,
  content='notes', content_rowid='rowid',
  tokenize='unicode61'
);
-- + triggers de sincronização em INSERT/UPDATE/DELETE

-- Tags (escape hatch — o poder real mora nas edges)
CREATE TABLE tags (
  note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);

-- Arestas: o coração do latticework
CREATE TABLE edges (
  id             TEXT PRIMARY KEY,
  from_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  to_id          TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL CHECK (relation_type IN (
    'analogous_to','same_mechanism_as','instance_of','generalizes',
    'causes','depends_on','contradicts','evidence_for','refines'
  )),
  why            TEXT NOT NULL,           -- obrigatório, mínimo 20 chars
  created_at     INTEGER NOT NULL,
  UNIQUE(from_id, to_id, relation_type)
);

CREATE INDEX idx_edges_from ON edges(from_id);
CREATE INDEX idx_edges_to   ON edges(to_id);
CREATE INDEX idx_edges_rel  ON edges(relation_type);
```

**No Vectorize (paralelo):** um vetor por nota, `id = note.id`, `metadata = { domains, kind, created_at }`. Metadata permite filtrar queries (`{ filter: { domains: "biology" } }`) — usado pelo `recall` para forçar diversidade.

### 5.1. As 9 arestas (enum)

Enum fechado. Cobertura separada por função — sem `related_to` escape hatch.

| Categoria | Tipo | Quando usar |
|---|---|---|
| Estrutural | `analogous_to` | Mesma estrutura, domínios diferentes |
| Estrutural | `same_mechanism_as` | Mecanismo subjacente idêntico (Gentner structure mapping) |
| Estrutural | `instance_of` | Exemplo concreto de um conceito abstrato |
| Estrutural | `generalizes` | Conceito abstrato de um exemplo concreto |
| Causal | `causes` | A produz B |
| Causal | `depends_on` | A requer B (causal OU cognitivo — pré-requisito) |
| Epistêmico | `contradicts` | Tensão: ambos não podem ser verdade |
| Epistêmico | `evidence_for` | Suporte empírico |
| Epistêmico | `refines` | Versão mais precisa (correção, não contradição) |

## 6. MCP tools

**5 tools**, deliberadamente poucas:

### `save_note`
Grava nota + tldr + domínios + edges opcionais em uma chamada atômica. Body da description força o Claude a chamar `recall` antes (cross-domain sweep) e incluir edges na mesma call se encontrar analogias.

**Input:**
```ts
{
  title: string,
  body: string,
  tldr: string,           // 1 frase; descrição obriga a passar Feynman test
  domains: string[],      // 1-3 domínios específicos
  kind?: string,          // opcional
  tags?: string[],        // opcional
  edges?: Array<{         // recomendado quando possível
    to_id: string,
    relation_type: EdgeType,
    why: string           // min 20 chars
  }>
}
```

**Side effects:** INSERT em `notes`, `edges`, `tags`. `env.AI.run('@cf/baai/bge-base-en-v1.5', { text: tldr })` para gerar embedding. `env.VECTORIZE.upsert([...])` com metadata.

### `recall`
Busca híbrida cross-domain.

**Input:** `{ query: string, limit?: number = 15, domains_filter?: string[] }`

**Comportamento:**
1. Embed `query` via Workers AI
2. Query Vectorize (topK=30) + FTS5 (top 30) em paralelo
3. Merge + dedup por note_id
4. **Domain-balance:** top 3 por domínio único, até 5 domínios distintos
5. Retorna apenas `{id, title, domain, kind, tldr}` — nunca `body`

A descrição da tool diz explicitamente: *"Read ALL returned domains before answering. The valuable match often comes from the unexpected domain."*

### `expand`
Vizinhos imediatos de uma nota (1 hop).

**Input:** `{ note_id: string, relation_types?: EdgeType[], direction?: 'in' | 'out' | 'both' = 'both' }`

**Output:** `Array<{ note: { id, title, domain, tldr }, edge: { relation_type, why } }>`

Um hop apenas. Claude pilota profundidade chamando recursivamente.

### `get_note`
Body completo por id. Usado quando o Claude precisa citar ou revisar conteúdo.

**Input:** `{ id: string }`
**Output:** nota completa incluindo `body`, `tags`, `edges[]`

### `link`
Cria uma aresta entre duas notas existentes (para quando o Claude descobre conexão entre notas antigas durante uma conversa, sem criar nota nova).

**Input:** `{ from_id, to_id, relation_type, why }` — `why` com mínimo 20 chars enforçado server-side.

### 6.1. Tools deliberadamente fora do MVP

- ❌ `delete_note` / `update_note` — append-only. Protege de acidentes irreversíveis, simplifica Vectorize (sem updates de embedding). Se um conceito evoluiu, cria nota nova + aresta `refines`.
- ❌ `list_all` — sem paginação genérica. Força rigor via `recall`, protege contexto de dump.
- ❌ `search_by_tag` — tags são escape hatch. Se virar necessário, entra em v1.1.

## 7. MCP implementation best practices

Esta seção consolida práticas confirmadas na documentação oficial do Model Context Protocol (modelcontextprotocol.io) e validadas no servidor MCP de referência do projeto Oráculo (`~/Desktop/dev/oraculo-wt-1/mcp/`). São regras de implementação, não sugestões — o servidor do Mind Vault deve seguir todas.

### 7.1. Stack obrigatória

Três pacotes canônicos, todos oficiais, todos coexistindo limpo:

- **`@modelcontextprotocol/sdk`** — SDK oficial do MCP. Usar `McpServer` de `@modelcontextprotocol/sdk/server/mcp.js` como a classe base do servidor, não reimplementar o protocolo.
- **`agents/mcp`** — Cloudflare, fornece `McpAgent` (runtime stateful no Worker) e `createMcpHandler` / `McpAgent.serve(path)` para plugar no roteamento. Esta é a camada que faz o MCP sobreviver ao lifecycle do Worker.
- **`@cloudflare/workers-oauth-provider`** — wrapper OAuth 2.1 com dynamic client registration, que permite que Claude Desktop/Web conectem fornecendo apenas a URL.

Padrão de composição (validado no Oráculo):

```ts
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';

export class MindVaultMCP extends McpAgent<Env, Record<string, never>, AuthContext> {
  server = new McpServer(
    { name: 'mind-vault', version: '1.0.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );

  async init() {
    const auth = this.props;
    if (!auth) throw new Error('MindVaultMCP: missing auth props');
    registerAllTools(this.server, this.env, auth);
  }
}

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: MindVaultMCP.serve('/mcp'),
  defaultHandler: authHandler,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  accessTokenTTL: 86400,        // 1 day
  refreshTokenTTL: 2592000,     // 30 days
});
```

### 7.2. SERVER_INSTRUCTIONS

O `McpServer` recebe um campo `instructions` que é injetado na conversa do Claude **toda vez que a conexão MCP é estabelecida**. É complementar à skill: a skill vive no cliente e é descoberta por conteúdo; as instructions viajam com o servidor e são garantidas.

Conteúdo obrigatório das instructions do Mind Vault:
- **Quem é o servidor** em uma linha.
- **Quando usar (gatilho):** "Use when the user discusses concepts, ideas, insights, or references prior thinking."
- **Fluxo recomendado:** "Before answering questions about a topic, call `recall`. Before saving a new note, call `recall` to sweep cross-domain analogies and include edges in the same `save_note` call."
- **Referência à skill:** "For the full latticework method, load the `using-mind-vault` skill."

As instructions devem caber em ≤ 30 linhas. Não duplicar a skill — apenas apontar para ela.

### 7.3. Tool description — padrão rigoroso

Toda tool do Mind Vault segue o mesmo formato de description, inspirado no Oráculo. A description é **o único lugar** onde o Claude aprende a chamar a tool corretamente, então vale a pena ser explícito:

```ts
server.registerTool(
  'save_note',
  {
    description: `Grava uma nota atômica no cofre, opcionalmente com edges a notas existentes.

FLUXO OBRIGATÓRIO antes de chamar:
1. Atomize: uma nota = um conceito. Se o title contém "and/e", quebre em duas chamadas separadas.
2. Chame recall() primeiro para varredura cross-domain. Mesmo que você ache que a ideia é inédita.
3. Para cada analogia encontrada em OUTRO domínio, inclua uma edge no array edges desta mesma chamada.

O campo tldr é um teste de Feynman: se você não consegue resumir em uma frase concreta, a nota não está pronta.

O campo domains deve ser ESPECÍFICO (evolutionary-biology, não science; behavioral-economics, não economics).

IMPORTANTE: o campo why de cada edge é rejeitado se tiver menos de 20 caracteres. Uma frase que explique o MECANISMO compartilhado, não apenas "relacionado".`,
    inputSchema: {
      title: z.string().min(1).max(200).describe('Title atômico. Sem "and/e".'),
      body: z.string().min(1).describe('Corpo em markdown'),
      tldr: z.string().min(10).max(280).describe('Uma frase. Teste de Feynman.'),
      domains: z.array(z.string()).min(1).max(3).describe('Domínios específicos'),
      kind: z.string().optional().describe('Tipo livre: idea, fact, question, decision'),
      tags: z.array(z.string()).optional(),
      edges: z.array(z.object({
        to_id: z.string(),
        relation_type: z.enum([
          'analogous_to','same_mechanism_as','instance_of','generalizes',
          'causes','depends_on','contradicts','evidence_for','refines'
        ]),
        why: z.string().min(20).describe('Mínimo 20 chars. Explique o mecanismo compartilhado.'),
      })).optional(),
    },
    annotations: {
      title: 'Save atomic note',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  safeToolHandler(async (input) => { /* ... */ })
);
```

**Regras:**
1. **Description começa com uma frase única** que resume o que a tool faz.
2. **"FLUXO OBRIGATÓRIO antes de chamar"** explicita pré-condições. O Claude respeita mais do que "recomendação".
3. **"IMPORTANTE:"** para regras que vão ser enforçadas server-side (assim o Claude não perde tempo tentando contornar).
4. **Todo campo zod tem `.describe()`** — é o que o cliente MCP mostra para o Claude.
5. **Annotations sempre presentes:** `title` (human-readable), `readOnlyHint`, `destructiveHint`, `openWorldHint`. Ajudam o cliente a decidir se pede confirmação.

### 7.4. Response shapes

Dois helpers fixos, idênticos aos do Oráculo:

```ts
export function toolError(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function toolSuccess(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
```

- **Success** retorna JSON stringificado (Claude parseia confortavelmente). Para respostas com UX relevante (ex: `save_note` que devolve id + resumo do que foi gravado), pode retornar texto formatado em markdown em vez de JSON — mas seja consistente por tool.
- **Error** retorna `isError: true` — o cliente MCP distingue do sucesso e pode sinalizar na UI.

### 7.5. Error handling — mensagens como instruções

Mensagens de erro no Mind Vault devem seguir a filosofia do Oráculo: **o erro ensina o Claude o que fazer a seguir**. Três regras:

1. **Diga o que aconteceu** em termos concretos (não "erro interno genérico").
2. **Diga o que o Claude deve fazer** — qual tool chamar, qual input verificar.
3. **Diga o que o Claude NÃO deve fazer** — explicitamente "não retente com o mesmo input" quando aplicável.

Exemplos para o Mind Vault:

```ts
// note_id inválido em expand/link
return toolError(
  `Note '${note_id}' não encontrada no cofre. Chame recall() primeiro com um termo relacionado ` +
  `para descobrir o id correto. Não retente com este id.`
);

// why muito curto em link/save_note.edges
return toolError(
  `A justificativa (why) da edge tem apenas ${why.length} caracteres — mínimo 20. ` +
  `Reescreva explicitando o MECANISMO compartilhado entre as notas, não apenas que elas se relacionam. ` +
  `Exemplos de why válido: "Ambos são sistemas com feedback negativo retardado, por isso oscilam" ` +
  `ou "Inverso exato: onde A maximiza X, B minimiza X por construção".`
);

// edge criando ciclo impossível (from == to)
return toolError(
  `Não é possível criar uma edge de uma nota para ela mesma. ` +
  `Se o objetivo é marcar tensão interna, crie uma nova nota refinando o conceito ` +
  `e ligue as duas com 'refines' ou 'contradicts'.`
);
```

### 7.6. `safeToolHandler` — wrapper obrigatório

Todos os handlers são envolvidos em `safeToolHandler`, que captura exceções não previstas (especialmente D1 errors que vazariam SQL para o cliente) e retorna uma mensagem sanitizada:

```ts
export function safeToolHandler<T extends (...args: any[]) => Promise<any>>(fn: T): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('D1_ERROR') || msg.includes('SQLITE_ERROR')) {
        console.error('MindVault D1 error:', msg);
        return toolError(
          `Erro interno no banco (D1) do cofre. Provavelmente temporário — aguarde alguns segundos e tente novamente. ` +
          `Se persistir, reporte o horário ${new Date().toISOString()} e a ação tentada ao mantenedor.`
        );
      }
      throw err;
    }
  }) as T;
}
```

### 7.7. Input validation com Zod

Todos os inputs usam zod com `.describe()` explícito em cada campo. O SDK do MCP gera o JSON Schema automaticamente a partir do zod, então enums, min/max, required, tudo vem de graça.

**Regra prática:** se um campo precisa de explicação além do nome, use `.describe()`. Se não precisa, o nome está ruim — renomeie.

### 7.8. MCP-level anti-patterns a evitar

Derivados das docs e do código do Oráculo:

- ❌ **Tools com nomes genéricos** (`search`, `get`, `save`). Sempre prefixe o domínio: `save_note`, `recall`, `expand`.
- ❌ **Múltiplas tools para a mesma operação com flags diferentes.** Um `save_note` com `edges?` opcional é melhor que `save_note` + `save_note_with_edges`.
- ❌ **Retornar stacktraces ou erros de SQL crus** para o cliente. Sempre passar por `safeToolHandler`.
- ❌ **Expor Resources quando uma Tool basta.** O Mind Vault não vai usar Resources no MVP — tudo é Tool, porque o modelo de leitura é "Claude pede quando quer", não "aplicação injeta contexto".
- ❌ **Tool descriptions vagas.** Se a description é uma linha curta, o Claude vai improvisar — e errar.
- ❌ **Depender de state entre chamadas.** Cada tool call é atômica. Se precisa de contexto entre chamadas, devolva no output da tool anterior (ex: recall devolve ids que o Claude passa para expand).

## 8. Skill: `using-mind-vault`

Distribuída junto com o repo em `skills/using-mind-vault/`. Setup wizard oferece auto-install.

### 8.1. Estrutura

```
skills/using-mind-vault/
├── SKILL.md                    # ≤ 500 linhas; método + workflow + tools
└── reference/
    ├── edge-types.md           # as 9 arestas, quando usar cada, pares confusos
    └── examples.md             # 3-4 sessões before/after anotadas
```

### 8.2. Frontmatter

```yaml
---
name: using-mind-vault
description: Captures atomic concepts and their structural connections into a personal knowledge graph on Cloudflare D1. Use when the user is discussing an idea, insight, or concept that could compound with prior thinking. Applies latticework method — atomize, tag by specific domain, search cross-domain analogies, link with substantive justifications. Requires MindVault MCP connected.
---
```

### 8.3. Seções do SKILL.md

1. **Purpose** — uma linha sobre o método (não explicar o que é grafo).
2. **When to save / When NOT to save** — critérios de filtro. NOT save: chat efêmero, tarefas do dia, fatos triviais já no treinamento do Claude.
3. **The four disciplines:**
   - **Atomize** — uma nota = um conceito. Se tem "and/e" no title, divide.
   - **Domain specifically** — `evolutionary-biology`, não `science`. 1-3 domínios.
   - **Cross-domain sweep** — SEMPRE chame `recall` ANTES de `save_note`, mesmo achando que é original.
   - **Edge discipline** — toda aresta tem um `why` concreto de uma frase. Se não consegue escrever o why, não crie a aresta.
4. **Save workflow (checklist copyable):**
   ```
   - [ ] Atomized? (one concept, one note)
   - [ ] tldr in one sentence (Feynman test)
   - [ ] 1-3 specific domains chosen
   - [ ] recall() called to sweep cross-domain
   - [ ] analogies found → edges drafted with substantive why
   - [ ] save_note() called with edges in same call
   ```
5. **Recall workflow** — como ler os 15 resultados, por que o domínio inesperado importa, quando chamar `expand`.
6. **Anti-patterns** — salvar tudo, edges preguiçosos, ignorar cross-domain, criar `instance_of` quando o certo era `analogous_to`.
7. **Tool reference** — nomes totalmente qualificados: `MindVault:save_note`, `MindVault:recall`, etc.
8. **Pointers:** `reference/edge-types.md` para dúvida sobre qual aresta, `reference/examples.md` para padrão de sessões completas.

### 8.4. `reference/edge-types.md`

Uma seção por aresta, tabela de contents no topo. Cada seção: definição, 2 exemplos curtos, par confuso mais comum e como distinguir. Ex: `analogous_to` vs `same_mechanism_as` — "analogous_to = same shape, same_mechanism_as = same underlying mechanism. Use the stronger one when you can justify the why."

### 8.5. `reference/examples.md`

3-4 sessões anotadas mostrando o fluxo completo: user message → Claude decide salvar → chama `recall` → lê tldrs → identifica analogia cross-domain → chama `save_note` com edges → explicação do why de cada edge.

## 9. Repo layout

```
mind-vault/
├── src/
│   ├── index.ts              # Worker entry, OAuthProvider setup
│   ├── mcp/
│   │   ├── server.ts         # createMcpHandler + registry
│   │   └── tools/            # save-note.ts, recall.ts, expand.ts, get-note.ts, link.ts
│   ├── db/
│   │   ├── migrations/       # .sql files numerados
│   │   └── queries.ts        # prepared statements
│   ├── vector/
│   │   └── index.ts          # wrappers env.AI + env.VECTORIZE
│   ├── auth/
│   │   ├── handler.ts        # consent screen, login, password verify
│   │   └── setup.ts          # first-run wizard
│   └── static/               # landing, setup, guides (HTML inline)
├── skills/
│   └── using-mind-vault/
│       ├── SKILL.md
│       └── reference/
│           ├── edge-types.md
│           └── examples.md
├── assets/                   # servido como static via wrangler [assets]
│   ├── skill-screenshots/    # PNGs dos guias de install por cliente (fornecidos pelo Robson)
│   └── using-mind-vault.zip  # gerado pelo build step antes do deploy
├── scripts/
│   └── build-skill-zip.ts    # zipa skills/using-mind-vault/ para assets/
├── docs/
│   └── superpowers/specs/    # este arquivo
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md                 # hero + Deploy to CF button + intellectual lineage + security callout
```

## 10. Premissas verificadas (docs CF, abril 2026)

Durante o brainstorm essas premissas foram confirmadas via docs oficiais Cloudflare:

- `@cloudflare/workers-oauth-provider` + `agents/mcp` `createMcpHandler` é o caminho canônico para MCP remoto com OAuth 2.1 + dynamic client registration (permite Claude Desktop/Web plugar só com a URL).
- Vectorize + Workers AI são bindings simples no `wrangler.toml`; embedding via `env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [...] })` e upsert/query via `env.VECTORIZE`.
- D1 suporta FTS5 nativo (SQLite embarcado).

**A verificar no início da implementação** (potenciais ajustes menores, não bloqueantes):
- Detalhes exatos do "Deploy to Cloudflare" button e se ele provisiona Vectorize + D1 + AI bindings juntos na mesma transação ou se requer passo manual.
- Limites atuais de free tier de Vectorize e Workers AI (suficientes para uso pessoal, mas confirmar números no README).
- Se `wrangler secret put` via UI pós-deploy funciona para `OWNER_PASSWORD_HASH` ou se o setup wizard precisa de outra estratégia de persistência (ex: gravar na própria tabela D1 numa linha singleton).

## 11. Fora do escopo (MVP) e roadmap

**Fora do MVP:**
- UI web do grafo (só MCP). Fast-follow: página `/graph` read-only no próprio Worker, lendo D1 direto.
- Delete/update de notas. Fast-follow: `archive_note` (soft delete que some de `recall`).
- Export do cofre. Fast-follow: comando CLI/endpoint que gera ZIP de markdown a partir do D1.
- Multi-user. Não é fast-follow — é fork.
- Re-ranking neural dos resultados de `recall`. Por enquanto merge simples.
- Skill em PT-BR. Por enquanto só inglês para maximizar alcance.

## 12. Decisões arquiteturais (resumo das discussões)

| Decisão | Alternativas descartadas | Razão |
|---|---|---|
| Single-user | Multi-tenant SaaS | Spirit do projeto é cofre pessoal soberano |
| Auth: email+passphrase | GitHub/Google OAuth | Evita dependência externa, deploy fica realmente 1 clique |
| Schema dumb (4 tabelas) | Notas tipadas, ontologia rica | Inteligência mora nas tool descriptions + skill |
| Edges enum de 9 | String livre, sem `related_to` | Força rigor estrutural; escape hatch mata disciplina |
| Vectorize + FTS5 híbrido desde v1 | Só FTS5 com adição futura | Dentro de CF é trivial; recall semântico é coração da ideia Munger |
| Domain-balanced recall | Top-K puro por relevância | Diversity prediction theorem (Page) e cross-domain é o valor |
| `tldr` obrigatório | Só title + body | Teste de Feynman: se não dá para resumir, não entendeu |
| Append-only no MVP | CRUD completo | Simplifica Vectorize, protege de acidentes, força refinamento via `refines` |
| Skill como componente de 1ª classe | README + tool descriptions só | Tool descs são curtas demais para ensinar método completo |
| Skill distribuída como ZIP | Comando CLI copiando arquivos | Cobre Code/Desktop/Web uniformemente; usuário não precisa conhecer filesystem do Claude |
| SERVER_INSTRUCTIONS no MCP + skill | Só skill | Instructions garantem método sem depender de discovery; skill aprofunda quando ativada |
| Bloco de personalização do Claude sugerido | Só MCP + skill | Ativa o comportamento latticework proativamente em toda conversa, não só quando tema é óbvio |
| Framing "latticework" | "Munger mental models" | Base acadêmica mais sólida (Page, Hofstadter, Gentner, Luhmann) |

---

**Próximo passo:** revisão humana deste spec pelo Robson. Após aprovação, entrar em `writing-plans` para produzir plano de implementação incremental.
