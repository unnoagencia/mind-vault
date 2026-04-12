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
5. Final do wizard: card **"Feito por Robson — @orobsonn no Instagram"** com call-to-follow.
6. Também no final: botão **"Install skill"** (copia `skills/using-mind-vault/` para `~/.claude/skills/` via comando) + link para instalação manual.
7. Usuário cola a URL no Claude → OAuth flow → login com email+passphrase → MCP conectado.

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

## 7. Skill: `using-mind-vault`

Distribuída junto com o repo em `skills/using-mind-vault/`. Setup wizard oferece auto-install.

### 7.1. Estrutura

```
skills/using-mind-vault/
├── SKILL.md                    # ≤ 500 linhas; método + workflow + tools
└── reference/
    ├── edge-types.md           # as 9 arestas, quando usar cada, pares confusos
    └── examples.md             # 3-4 sessões before/after anotadas
```

### 7.2. Frontmatter

```yaml
---
name: using-mind-vault
description: Captures atomic concepts and their structural connections into a personal knowledge graph on Cloudflare D1. Use when the user is discussing an idea, insight, or concept that could compound with prior thinking. Applies latticework method — atomize, tag by specific domain, search cross-domain analogies, link with substantive justifications. Requires MindVault MCP connected.
---
```

### 7.3. Seções do SKILL.md

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

### 7.4. `reference/edge-types.md`

Uma seção por aresta, tabela de contents no topo. Cada seção: definição, 2 exemplos curtos, par confuso mais comum e como distinguir. Ex: `analogous_to` vs `same_mechanism_as` — "analogous_to = same shape, same_mechanism_as = same underlying mechanism. Use the stronger one when you can justify the why."

### 7.5. `reference/examples.md`

3-4 sessões anotadas mostrando o fluxo completo: user message → Claude decide salvar → chama `recall` → lê tldrs → identifica analogia cross-domain → chama `save_note` com edges → explicação do why de cada edge.

## 8. Repo layout

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
├── docs/
│   └── superpowers/specs/    # este arquivo
├── wrangler.toml
├── package.json
├── tsconfig.json
└── README.md                 # hero + Deploy to CF button + intellectual lineage + security callout
```

## 9. Premissas verificadas (docs CF, abril 2026)

Durante o brainstorm essas premissas foram confirmadas via docs oficiais Cloudflare:

- `@cloudflare/workers-oauth-provider` + `agents/mcp` `createMcpHandler` é o caminho canônico para MCP remoto com OAuth 2.1 + dynamic client registration (permite Claude Desktop/Web plugar só com a URL).
- Vectorize + Workers AI são bindings simples no `wrangler.toml`; embedding via `env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [...] })` e upsert/query via `env.VECTORIZE`.
- D1 suporta FTS5 nativo (SQLite embarcado).

**A verificar no início da implementação** (potenciais ajustes menores, não bloqueantes):
- Detalhes exatos do "Deploy to Cloudflare" button e se ele provisiona Vectorize + D1 + AI bindings juntos na mesma transação ou se requer passo manual.
- Limites atuais de free tier de Vectorize e Workers AI (suficientes para uso pessoal, mas confirmar números no README).
- Se `wrangler secret put` via UI pós-deploy funciona para `OWNER_PASSWORD_HASH` ou se o setup wizard precisa de outra estratégia de persistência (ex: gravar na própria tabela D1 numa linha singleton).

## 10. Fora do escopo (MVP) e roadmap

**Fora do MVP:**
- UI web do grafo (só MCP). Fast-follow: página `/graph` read-only no próprio Worker, lendo D1 direto.
- Delete/update de notas. Fast-follow: `archive_note` (soft delete que some de `recall`).
- Export do cofre. Fast-follow: comando CLI/endpoint que gera ZIP de markdown a partir do D1.
- Multi-user. Não é fast-follow — é fork.
- Re-ranking neural dos resultados de `recall`. Por enquanto merge simples.
- Skill em PT-BR. Por enquanto só inglês para maximizar alcance.

## 11. Decisões arquiteturais (resumo das discussões)

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
| Framing "latticework" | "Munger mental models" | Base acadêmica mais sólida (Page, Hofstadter, Gentner, Luhmann) |

---

**Próximo passo:** revisão humana deste spec pelo Robson. Após aprovação, entrar em `writing-plans` para produzir plano de implementação incremental.
