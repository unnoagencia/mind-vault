# Mind Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o Mind Vault — um Cloudflare Worker single-user que expõe um servidor MCP OAuth-protegido sobre D1 + Vectorize + Workers AI, com 5 tools (`save_note`, `recall`, `expand`, `get_note`, `link`), setup wizard de primeira visita, landing read-only e skill `using-mind-vault` distribuída como ZIP.

**Architecture:** Um único Worker em TypeScript. `@cloudflare/workers-oauth-provider` envolve um `McpAgent` (`agents/mcp`) que hospeda um `McpServer` (`@modelcontextprotocol/sdk`). D1 armazena notas/edges/tags/FTS5; Vectorize armazena embeddings (768-dim) gerados por `@cf/baai/bge-base-en-v1.5` via binding AI. Auth é email + passphrase (argon2id) guardados como secrets. Setup wizard roda em `/` na primeira visita (detecta ausência de `OWNER_EMAIL`), executa migrations e instrui o usuário a definir secrets. Skill é empacotada num ZIP servido como static asset.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite + FTS5), Vectorize, Workers AI, `@modelcontextprotocol/sdk`, `agents/mcp`, `@cloudflare/workers-oauth-provider`, `zod`, `nanoid`, `@node-rs/argon2`, `vitest` + `@cloudflare/vitest-pool-workers`.

---

## File structure

```
mind-vault/
├── src/
│   ├── index.ts                      # OAuthProvider default export; exports MindVaultMCP
│   ├── env.ts                        # Env type (DB, VECTORIZE, AI, secrets)
│   ├── mcp/
│   │   ├── agent.ts                  # MindVaultMCP extends McpAgent; init() registers tools
│   │   ├── instructions.ts           # SERVER_INSTRUCTIONS constant
│   │   ├── registry.ts               # registerAllTools(server, env, auth)
│   │   ├── helpers.ts                # toolError, toolSuccess, safeToolHandler
│   │   └── tools/
│   │       ├── save-note.ts
│   │       ├── recall.ts
│   │       ├── expand.ts
│   │       ├── get-note.ts
│   │       └── link.ts
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 0001_init.sql
│   │   ├── migrate.ts                # runs migrations idempotently
│   │   └── queries.ts                # prepared-statement helpers
│   ├── vector/
│   │   └── index.ts                  # embed() + upsertNoteVector() + queryVector()
│   ├── auth/
│   │   ├── handler.ts                # authHandler: GET /, /authorize consent, POST /login
│   │   ├── password.ts               # argon2id hash/verify via @node-rs/argon2
│   │   └── setup.ts                  # first-run wizard HTML + POST endpoints
│   ├── static/
│   │   ├── landing.ts                # read-only landing HTML (after setup)
│   │   ├── wizard.ts                 # setup wizard HTML (before setup)
│   │   └── styles.ts                 # shared CSS string
│   └── util/
│       ├── id.ts                     # nanoid(12)
│       └── html.ts                   # tiny HTML escape helper
├── skills/
│   └── using-mind-vault/
│       ├── SKILL.md
│       └── reference/
│           ├── edge-types.md
│           └── examples.md
├── assets/
│   └── skill-screenshots/            # placeholder PNGs (Robson fornece depois)
├── scripts/
│   └── build-skill-zip.ts            # zips skills/using-mind-vault → assets/using-mind-vault.zip
├── test/
│   ├── setup.ts                      # vitest-pool-workers config
│   ├── db.test.ts
│   ├── tools/
│   │   ├── save-note.test.ts
│   │   ├── recall.test.ts
│   │   ├── expand.test.ts
│   │   ├── get-note.test.ts
│   │   └── link.test.ts
│   └── auth.test.ts
├── wrangler.toml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `.gitignore`
- Create: `src/env.ts`
- Create: `src/index.ts` (stub)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "mind-vault",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "npm run build:skill && wrangler deploy",
    "build:skill": "tsx scripts/build-skill-zip.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@cloudflare/workers-oauth-provider": "^0.0.5",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@node-rs/argon2": "^2.0.0",
    "agents": "^0.0.90",
    "nanoid": "^5.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20250101.0",
    "@types/node": "^22.0.0",
    "adm-zip": "^0.5.16",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.90.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*", "test/**/*", "scripts/**/*"]
}
```

- [ ] **Step 3: Write `wrangler.toml`**

```toml
name = "mind-vault"
main = "src/index.ts"
compatibility_date = "2025-02-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "mind-vault"
database_id = "PLACEHOLDER_SET_ON_DEPLOY"
migrations_dir = "src/db/migrations"

[[vectorize]]
binding = "VECTORIZE"
index_name = "mind-vault-embeddings"

[ai]
binding = "AI"

[durable_objects]
bindings = [
  { name = "MCP_OBJECT", class_name = "MindVaultMCP" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["MindVaultMCP"]

[assets]
directory = "./assets"
binding = "ASSETS"
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules
.wrangler
.dev.vars
dist
coverage
assets/using-mind-vault.zip
```

- [ ] **Step 5: Write `src/env.ts`**

```ts
export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  ASSETS: Fetcher;
  OWNER_EMAIL?: string;
  OWNER_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
}

export interface AuthContext {
  email: string;
  loggedInAt: number;
}
```

- [ ] **Step 6: Write `src/index.ts` stub (compiles but no behavior)**

```ts
import type { Env } from './env.js';

export default {
  async fetch(_req: Request, _env: Env): Promise<Response> {
    return new Response('Mind Vault booting', { status: 200 });
  },
};
```

- [ ] **Step 7: Install dependencies and verify typecheck**

Run: `npm install && npm run typecheck`
Expected: exits 0.

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json wrangler.toml .gitignore src/env.ts src/index.ts
git commit -m "chore: scaffold Worker project with wrangler + TS"
```

---

## Task 2: D1 schema + migration

**Files:**
- Create: `src/db/migrations/0001_init.sql`
- Create: `src/db/migrate.ts`

- [ ] **Step 1: Write migration SQL**

Create `src/db/migrations/0001_init.sql`:

```sql
CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  tldr        TEXT NOT NULL,
  domains     TEXT NOT NULL,
  kind        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, tldr, body,
  content='notes', content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, tldr, body)
  VALUES (new.rowid, new.title, new.tldr, new.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, tldr, body)
  VALUES('delete', old.rowid, old.title, old.tldr, old.body);
END;

CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, tldr, body)
  VALUES('delete', old.rowid, old.title, old.tldr, old.body);
  INSERT INTO notes_fts(rowid, title, tldr, body)
  VALUES (new.rowid, new.title, new.tldr, new.body);
END;

CREATE TABLE IF NOT EXISTS tags (
  note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag      TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);

CREATE TABLE IF NOT EXISTS edges (
  id             TEXT PRIMARY KEY,
  from_id        TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  to_id          TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  relation_type  TEXT NOT NULL CHECK (relation_type IN (
    'analogous_to','same_mechanism_as','instance_of','generalizes',
    'causes','depends_on','contradicts','evidence_for','refines'
  )),
  why            TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  UNIQUE(from_id, to_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to   ON edges(to_id);
CREATE INDEX IF NOT EXISTS idx_edges_rel  ON edges(relation_type);

CREATE TABLE IF NOT EXISTS meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
```

- [ ] **Step 2: Write `src/db/migrate.ts`**

```ts
import type { Env } from '../env.js';
import migration0001 from './migrations/0001_init.sql' with { type: 'text' };

const MIGRATIONS: Array<{ id: string; sql: string }> = [
  { id: '0001_init', sql: migration0001 },
];

export async function runMigrations(env: Env): Promise<void> {
  await env.DB.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`
  );
  const applied = await env.DB.prepare(`SELECT id FROM _migrations`).all<{ id: string }>();
  const appliedIds = new Set((applied.results ?? []).map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (appliedIds.has(m.id)) continue;
    const stmts = m.sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of stmts) {
      await env.DB.exec(stmt.replace(/\n/g, ' '));
    }
    await env.DB.prepare(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`)
      .bind(m.id, Date.now())
      .run();
  }
}
```

Note: `with { type: 'text' }` import works via wrangler's text-module handling. If it fails at build time, inline the SQL as a string literal in `migrate.ts` instead.

- [ ] **Step 3: Write test `test/db.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';

describe('migrations', () => {
  beforeAll(async () => {
    await runMigrations(env as any);
  });

  it('creates notes table', async () => {
    const r = await (env as any).DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='notes'`
    ).first();
    expect(r).not.toBeNull();
  });

  it('creates edges table with constraint', async () => {
    await expect(
      (env as any).DB.prepare(
        `INSERT INTO edges (id,from_id,to_id,relation_type,why,created_at) VALUES ('e1','n1','n2','bogus','x',0)`
      ).run()
    ).rejects.toThrow();
  });

  it('is idempotent', async () => {
    await runMigrations(env as any);
    await runMigrations(env as any);
  });
});
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2025-02-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
          kvNamespaces: ['OAUTH_KV'],
        },
      },
    },
  },
});
```

- [ ] **Step 5: Run tests — expect fail first, then pass**

Run: `npm test`
Expected: migrations test suite green. If SQL-import fails, fall back to inline string literal in `migrate.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/db test/db.test.ts vitest.config.ts
git commit -m "feat(db): initial schema + idempotent migration runner"
```

---

## Task 3: Query helpers

**Files:**
- Create: `src/db/queries.ts`
- Create: `src/util/id.ts`

- [ ] **Step 1: Write `src/util/id.ts`**

```ts
import { customAlphabet } from 'nanoid';
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
export const newId = customAlphabet(alphabet, 12);
```

- [ ] **Step 2: Write `src/db/queries.ts`**

```ts
import type { Env } from '../env.js';

export type EdgeType =
  | 'analogous_to' | 'same_mechanism_as' | 'instance_of' | 'generalizes'
  | 'causes' | 'depends_on' | 'contradicts' | 'evidence_for' | 'refines';

export const EDGE_TYPES: readonly EdgeType[] = [
  'analogous_to','same_mechanism_as','instance_of','generalizes',
  'causes','depends_on','contradicts','evidence_for','refines',
] as const;

export interface NoteRow {
  id: string; title: string; body: string; tldr: string;
  domains: string; kind: string | null;
  created_at: number; updated_at: number;
}

export interface EdgeRow {
  id: string; from_id: string; to_id: string;
  relation_type: EdgeType; why: string; created_at: number;
}

export async function insertNote(env: Env, n: NoteRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notes (id,title,body,tldr,domains,kind,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(n.id, n.title, n.body, n.tldr, n.domains, n.kind, n.created_at, n.updated_at).run();
}

export async function insertEdge(env: Env, e: EdgeRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO edges (id,from_id,to_id,relation_type,why,created_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(e.id, e.from_id, e.to_id, e.relation_type, e.why, e.created_at).run();
}

export async function insertTags(env: Env, noteId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const stmt = env.DB.prepare(`INSERT OR IGNORE INTO tags (note_id, tag) VALUES (?, ?)`);
  await env.DB.batch(tags.map((t) => stmt.bind(noteId, t)));
}

export async function getNoteById(env: Env, id: string): Promise<NoteRow | null> {
  return env.DB.prepare(`SELECT * FROM notes WHERE id = ?`).bind(id).first<NoteRow>();
}

export async function getTagsByNote(env: Env, id: string): Promise<string[]> {
  const r = await env.DB.prepare(`SELECT tag FROM tags WHERE note_id = ?`).bind(id).all<{ tag: string }>();
  return (r.results ?? []).map((x) => x.tag);
}

export async function getEdgesFrom(env: Env, id: string): Promise<EdgeRow[]> {
  const r = await env.DB.prepare(`SELECT * FROM edges WHERE from_id = ?`).bind(id).all<EdgeRow>();
  return r.results ?? [];
}

export async function getEdgesTo(env: Env, id: string): Promise<EdgeRow[]> {
  const r = await env.DB.prepare(`SELECT * FROM edges WHERE to_id = ?`).bind(id).all<EdgeRow>();
  return r.results ?? [];
}

export async function ftsSearch(
  env: Env, query: string, limit: number
): Promise<Array<Pick<NoteRow,'id'|'title'|'tldr'|'domains'|'kind'>>> {
  const r = await env.DB.prepare(
    `SELECT n.id, n.title, n.tldr, n.domains, n.kind
     FROM notes_fts f
     JOIN notes n ON n.rowid = f.rowid
     WHERE notes_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).bind(query, limit).all<Pick<NoteRow,'id'|'title'|'tldr'|'domains'|'kind'>>();
  return r.results ?? [];
}
```

- [ ] **Step 3: Test query helpers — write `test/queries.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import {
  insertNote, insertEdge, insertTags,
  getNoteById, getTagsByNote, getEdgesFrom, ftsSearch,
} from '../src/db/queries.js';

const E = env as any;

describe('queries', () => {
  beforeAll(async () => { await runMigrations(E); });

  it('insert + read note', async () => {
    await insertNote(E, {
      id: 'n1', title: 'Red Queen', body: 'bod', tldr: 'coevolution forces running',
      domains: JSON.stringify(['evolutionary-biology']), kind: 'idea',
      created_at: 1, updated_at: 1,
    });
    const n = await getNoteById(E, 'n1');
    expect(n?.title).toBe('Red Queen');
  });

  it('tags', async () => {
    await insertTags(E, 'n1', ['a','b']);
    expect((await getTagsByNote(E,'n1')).sort()).toEqual(['a','b']);
  });

  it('edge uniqueness', async () => {
    await insertNote(E, {
      id:'n2',title:'Arms race',body:'',tldr:'x',
      domains:JSON.stringify(['military-history']),kind:null,created_at:1,updated_at:1,
    });
    await insertEdge(E, { id:'e1',from_id:'n1',to_id:'n2',relation_type:'analogous_to',why:'same coevolutionary pressure dynamic',created_at:1 });
    await expect(
      insertEdge(E,{ id:'e2',from_id:'n1',to_id:'n2',relation_type:'analogous_to',why:'same coevolutionary pressure dynamic',created_at:1 })
    ).rejects.toThrow();
    expect((await getEdgesFrom(E,'n1')).length).toBe(1);
  });

  it('fts search', async () => {
    const r = await ftsSearch(E, 'coevolution', 10);
    expect(r.find((x) => x.id === 'n1')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries.ts src/util/id.ts test/queries.test.ts
git commit -m "feat(db): query helpers + FTS search"
```

---

## Task 4: Vector wrapper

**Files:**
- Create: `src/vector/index.ts`

- [ ] **Step 1: Write `src/vector/index.ts`**

```ts
import type { Env } from '../env.js';

export async function embed(env: Env, text: string): Promise<number[]> {
  const res = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [text] }) as {
    data: number[][];
  };
  const v = res.data?.[0];
  if (!v) throw new Error('embed: empty response from Workers AI');
  return v;
}

export interface NoteVectorMeta {
  domains: string[];
  kind: string | null;
  created_at: number;
}

export async function upsertNoteVector(
  env: Env, id: string, values: number[], meta: NoteVectorMeta
): Promise<void> {
  await env.VECTORIZE.upsert([{
    id,
    values,
    metadata: {
      domains: meta.domains.join(','),
      kind: meta.kind ?? '',
      created_at: meta.created_at,
    },
  }]);
}

export interface VectorMatch { id: string; score: number; }

export async function queryVector(
  env: Env, values: number[], topK: number
): Promise<VectorMatch[]> {
  const res = await env.VECTORIZE.query(values, { topK, returnMetadata: 'none' });
  return (res.matches ?? []).map((m) => ({ id: m.id, score: m.score }));
}
```

- [ ] **Step 2: Note on testing**

Vectorize binding is not emulated in miniflare. Do NOT write unit tests that call `env.VECTORIZE` directly. The tools that use it will be tested by injecting a fake binding (`env.VECTORIZE = { upsert, query }`) in each tool test (see Task 6).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/vector/index.ts
git commit -m "feat(vector): AI embedding + Vectorize upsert/query wrappers"
```

---

## Task 5: MCP helpers + server instructions

**Files:**
- Create: `src/mcp/helpers.ts`
- Create: `src/mcp/instructions.ts`

- [ ] **Step 1: Write `src/mcp/helpers.ts`**

```ts
export type ToolResult =
  | { content: Array<{ type: 'text'; text: string }> }
  | { content: Array<{ type: 'text'; text: string }>; isError: true };

export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function toolSuccess(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function safeToolHandler<A extends unknown[]>(
  fn: (...args: A) => Promise<ToolResult>
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('D1_ERROR') || msg.includes('SQLITE_ERROR')) {
        console.error('MindVault D1 error:', msg);
        return toolError(
          `Erro interno no banco (D1) do cofre. Provavelmente temporário — aguarde alguns segundos e tente novamente. ` +
          `Se persistir, reporte o horário ${new Date().toISOString()} e a ação tentada ao mantenedor.`
        );
      }
      console.error('MindVault tool error:', msg);
      return toolError(`Erro inesperado: ${msg}. Verifique o input e tente novamente.`);
    }
  };
}
```

- [ ] **Step 2: Write `src/mcp/instructions.ts`**

```ts
export const SERVER_INSTRUCTIONS = `Mind Vault — a personal latticework knowledge graph backed by Cloudflare D1 + Vectorize.

When to use:
- The user discusses concepts, ideas, insights, decisions, or prior learnings.
- The user references something they "already thought about" or asks "what do we have on X".

Recommended flow:
1. Before answering topical questions, call \`recall\` with a short query. Read ALL returned domains; the valuable match often comes from the unexpected domain.
2. Before calling \`save_note\`, call \`recall\` first to sweep for cross-domain analogies.
3. Atomize: one note = one concept. If the title contains "and/e", split into separate calls.
4. Each edge needs a substantive \`why\` explaining the shared MECHANISM (min 20 chars). Vague whys are rejected.
5. Prefer \`same_mechanism_as\` over \`analogous_to\` when you can justify the underlying mechanism.

For the full method, load the \`using-mind-vault\` skill.`;
```

- [ ] **Step 3: Write test `test/helpers.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { toolError, toolSuccess, safeToolHandler } from '../src/mcp/helpers.js';

describe('helpers', () => {
  it('toolError shape', () => {
    const r = toolError('x');
    expect(r).toEqual({ content: [{ type: 'text', text: 'x' }], isError: true });
  });

  it('toolSuccess stringifies objects', () => {
    const r = toolSuccess({ a: 1 });
    expect(r.content[0].text).toContain('"a": 1');
  });

  it('safeToolHandler catches D1 error', async () => {
    const h = safeToolHandler(async () => { throw new Error('D1_ERROR: something'); });
    const r = await h();
    expect((r as any).isError).toBe(true);
    expect((r as any).content[0].text).toContain('banco');
  });
});
```

- [ ] **Step 4: Run tests, commit**

Run: `npm test`
Expected: green.

```bash
git add src/mcp/helpers.ts src/mcp/instructions.ts test/helpers.test.ts
git commit -m "feat(mcp): helpers + server instructions"
```

---

## Task 6: Tool — `save_note`

**Files:**
- Create: `src/mcp/tools/save-note.ts`
- Create: `test/tools/save-note.test.ts`

- [ ] **Step 1: Write failing test `test/tools/save-note.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { registerSaveNote } from '../../src/mcp/tools/save-note.js';

const E = env as any;

function fakeAI() {
  return { run: vi.fn(async () => ({ data: [Array(768).fill(0.1)] })) };
}
function fakeVectorize() {
  return { upsert: vi.fn(async () => ({})), query: vi.fn(async () => ({ matches: [] })) };
}

function makeServer() {
  const registered: Record<string, any> = {};
  const server: any = {
    registerTool: (name: string, _meta: any, handler: any) => {
      registered[name] = handler;
    },
  };
  return { server, registered };
}

describe('save_note', () => {
  beforeEach(async () => {
    E.AI = fakeAI();
    E.VECTORIZE = fakeVectorize();
    await runMigrations(E);
    await E.DB.exec('DELETE FROM edges; DELETE FROM tags; DELETE FROM notes;');
  });

  it('saves a note and embeds the tldr', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    const r = await registered.save_note({
      title: 'Red Queen',
      body: 'bod',
      tldr: 'coevolution forces constant running just to keep place',
      domains: ['evolutionary-biology'],
    });
    expect(r.isError).toBeUndefined();
    expect(E.AI.run).toHaveBeenCalled();
    expect(E.VECTORIZE.upsert).toHaveBeenCalled();
    const row = await E.DB.prepare('SELECT * FROM notes').first();
    expect(row.title).toBe('Red Queen');
  });

  it('rejects edge why shorter than 20 chars', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    await E.DB.prepare(
      `INSERT INTO notes VALUES ('target','t','b','tl','["x"]',null,0,0)`
    ).run();
    const r = await registered.save_note({
      title: 'X',
      body: 'b',
      tldr: 'tl of at least ten chars here ok',
      domains: ['x'],
      edges: [{ to_id: 'target', relation_type: 'analogous_to', why: 'too short' }],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('20 caracteres');
  });

  it('rejects edge pointing to missing note', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    const r = await registered.save_note({
      title: 'X', body: 'b',
      tldr: 'tldr long enough here really',
      domains: ['x'],
      edges: [{ to_id: 'ghost', relation_type: 'analogous_to', why: 'this is a long enough why to pass validation' }],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('ghost');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- save-note`
Expected: fail with "Cannot find module save-note.js".

- [ ] **Step 3: Implement `src/mcp/tools/save-note.ts`**

```ts
import { z } from 'zod';
import type { Env } from '../../env.js';
import { newId } from '../../util/id.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { EDGE_TYPES, insertEdge, insertNote, insertTags, getNoteById } from '../../db/queries.js';
import { embed, upsertNoteVector } from '../../vector/index.js';

const edgeSchema = z.object({
  to_id: z.string().min(1),
  relation_type: z.enum(EDGE_TYPES as unknown as [string, ...string[]]),
  why: z.string(),
});

const inputSchema = {
  title: z.string().min(1).max(200).describe('Title atômico. Sem "and/e".'),
  body: z.string().min(1).describe('Corpo em markdown'),
  tldr: z.string().min(10).max(280).describe('Uma frase. Teste de Feynman.'),
  domains: z.array(z.string().min(1)).min(1).max(3).describe('Domínios específicos (1-3)'),
  kind: z.string().optional(),
  tags: z.array(z.string()).optional(),
  edges: z.array(edgeSchema).optional(),
};

const DESCRIPTION = `Grava uma nota atômica no cofre, opcionalmente com edges a notas existentes.

FLUXO OBRIGATÓRIO antes de chamar:
1. Atomize: uma nota = um conceito. Se o title contém "and/e", quebre em duas chamadas separadas.
2. Chame recall() primeiro para varredura cross-domain. Mesmo que você ache que a ideia é inédita.
3. Para cada analogia em OUTRO domínio, inclua uma edge no array edges desta mesma chamada.

O campo tldr é um teste de Feynman: se você não consegue resumir em uma frase concreta, a nota não está pronta.
O campo domains deve ser ESPECÍFICO (evolutionary-biology, não science).

IMPORTANTE: o campo why de cada edge é rejeitado se tiver menos de 20 caracteres.`;

export function registerSaveNote(server: any, env: Env): void {
  server.registerTool(
    'save_note',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        title: 'Save atomic note',
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    safeToolHandler(async (input: z.infer<z.ZodObject<typeof inputSchema>>) => {
      const now = Date.now();
      const id = newId();

      if (input.edges) {
        for (const e of input.edges) {
          if (e.why.length < 20) {
            return toolError(
              `A justificativa (why) da edge tem apenas ${e.why.length} caracteres — mínimo 20. ` +
              `Reescreva explicitando o MECANISMO compartilhado entre as notas, não apenas que elas se relacionam.`
            );
          }
          const target = await getNoteById(env, e.to_id);
          if (!target) {
            return toolError(
              `Note '${e.to_id}' não encontrada no cofre. Chame recall() primeiro com um termo relacionado ` +
              `para descobrir o id correto. Não retente com este id.`
            );
          }
        }
      }

      await insertNote(env, {
        id,
        title: input.title,
        body: input.body,
        tldr: input.tldr,
        domains: JSON.stringify(input.domains),
        kind: input.kind ?? null,
        created_at: now,
        updated_at: now,
      });
      if (input.tags?.length) await insertTags(env, id, input.tags);

      if (input.edges) {
        for (const e of input.edges) {
          await insertEdge(env, {
            id: newId(),
            from_id: id,
            to_id: e.to_id,
            relation_type: e.relation_type as any,
            why: e.why,
            created_at: now,
          });
        }
      }

      const vec = await embed(env, input.tldr);
      await upsertNoteVector(env, id, vec, {
        domains: input.domains,
        kind: input.kind ?? null,
        created_at: now,
      });

      return toolSuccess({
        id,
        saved: { title: input.title, domains: input.domains },
        edges_created: input.edges?.length ?? 0,
      });
    }) as any
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- save-note`
Expected: all three cases green.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/save-note.ts test/tools/save-note.test.ts
git commit -m "feat(mcp): save_note tool with edge validation + embedding"
```

---

## Task 7: Tool — `recall`

**Files:**
- Create: `src/mcp/tools/recall.ts`
- Create: `test/tools/recall.test.ts`

- [ ] **Step 1: Write failing test `test/tools/recall.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { registerRecall } from '../../src/mcp/tools/recall.js';

const E = env as any;

async function seed() {
  const rows = [
    ['a','Red Queen','coevolution forces running','["evolutionary-biology"]'],
    ['b','Arms race','military escalation loop','["military-history"]'],
    ['c','Tech debt spiral','compounding code rot','["software-engineering"]'],
    ['d','Predator-prey','population oscillation','["evolutionary-biology"]'],
    ['e','Moloch','multi-party race to bottom','["game-theory"]'],
  ];
  for (const [id,t,tl,dom] of rows) {
    await E.DB.prepare(
      `INSERT INTO notes VALUES (?,?,?,?,?,null,0,0)`
    ).bind(id,t,'body',tl,dom).run();
  }
}

describe('recall', () => {
  beforeEach(async () => {
    await runMigrations(E);
    await E.DB.exec('DELETE FROM edges; DELETE FROM tags; DELETE FROM notes;');
    E.AI = { run: vi.fn(async () => ({ data: [Array(768).fill(0.1)] })) };
    E.VECTORIZE = {
      upsert: vi.fn(),
      query: vi.fn(async () => ({ matches: [
        { id: 'a', score: 0.9 }, { id: 'b', score: 0.85 },
        { id: 'c', score: 0.8 }, { id: 'e', score: 0.75 }, { id: 'd', score: 0.7 },
      ] })),
    };
    await seed();
  });

  it('returns domain-balanced results without body', async () => {
    const registered: any = {};
    const server: any = { registerTool: (n: string, _m: any, h: any) => { registered[n] = h; } };
    registerRecall(server, E);
    const r = await registered.recall({ query: 'coevolution', limit: 15 });
    const parsed = JSON.parse(r.content[0].text);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBeGreaterThan(0);
    for (const x of parsed.results) {
      expect(x.body).toBeUndefined();
      expect(x.tldr).toBeDefined();
    }
    const domains = new Set(parsed.results.map((x: any) => x.domain));
    expect(domains.size).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- recall`
Expected: module not found.

- [ ] **Step 3: Implement `src/mcp/tools/recall.ts`**

```ts
import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolSuccess } from '../helpers.js';
import { ftsSearch, type NoteRow } from '../../db/queries.js';
import { embed, queryVector } from '../../vector/index.js';

const inputSchema = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(30).optional().default(15),
  domains_filter: z.array(z.string()).optional(),
};

const DESCRIPTION = `Busca híbrida cross-domain no cofre (vetorial + FTS).

Retorna até \`limit\` resultados balanceados por domínio (no máximo 3 por domínio, até 5 domínios distintos).
Retorna apenas {id, title, domain, kind, tldr} — NUNCA o body. Para ler o body, chame get_note(id).

IMPORTANTE: leia TODOS os domínios retornados antes de responder. O match valioso frequentemente vem do domínio inesperado — é exatamente isso que o cofre serve para expor.`;

interface RecallHit {
  id: string; title: string; domain: string; kind: string | null; tldr: string;
}

export function registerRecall(server: any, env: Env): void {
  server.registerTool(
    'recall',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        title: 'Cross-domain recall',
        readOnlyHint: true, destructiveHint: false, openWorldHint: false,
      },
    },
    safeToolHandler(async (input: { query: string; limit?: number; domains_filter?: string[] }) => {
      const limit = input.limit ?? 15;
      const vec = await embed(env, input.query);
      const [vectorMatches, ftsRows] = await Promise.all([
        queryVector(env, vec, 30),
        ftsSearch(env, input.query, 30),
      ]);

      const ids = new Set<string>();
      for (const m of vectorMatches) ids.add(m.id);
      for (const r of ftsRows) ids.add(r.id);
      if (ids.size === 0) return toolSuccess({ results: [] });

      const placeholders = Array.from(ids).map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT id, title, tldr, domains, kind FROM notes WHERE id IN (${placeholders})`
      ).bind(...Array.from(ids)).all<Pick<NoteRow,'id'|'title'|'tldr'|'domains'|'kind'>>();

      const byId = new Map<string, RecallHit>();
      for (const r of rows.results ?? []) {
        const domains: string[] = JSON.parse(r.domains);
        byId.set(r.id, {
          id: r.id, title: r.title, tldr: r.tldr, kind: r.kind,
          domain: domains[0] ?? 'unknown',
        });
      }

      const vectorOrder = vectorMatches.map((m) => m.id).filter((id) => byId.has(id));
      const ftsOrder = ftsRows.map((r) => r.id).filter((id) => byId.has(id) && !vectorOrder.includes(id));
      const merged = [...vectorOrder, ...ftsOrder];

      let pool: RecallHit[] = merged.map((id) => byId.get(id)!).filter(Boolean);
      if (input.domains_filter?.length) {
        const allow = new Set(input.domains_filter);
        pool = pool.filter((h) => allow.has(h.domain));
      }

      const perDomain = new Map<string, number>();
      const distinctDomains = new Set<string>();
      const results: RecallHit[] = [];
      for (const h of pool) {
        const count = perDomain.get(h.domain) ?? 0;
        if (count >= 3) continue;
        if (!distinctDomains.has(h.domain) && distinctDomains.size >= 5) continue;
        perDomain.set(h.domain, count + 1);
        distinctDomains.add(h.domain);
        results.push(h);
        if (results.length >= limit) break;
      }

      return toolSuccess({ results });
    }) as any
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- recall`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/recall.ts test/tools/recall.test.ts
git commit -m "feat(mcp): recall tool with domain-balanced hybrid search"
```

---

## Task 8: Tool — `expand`

**Files:**
- Create: `src/mcp/tools/expand.ts`
- Create: `test/tools/expand.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, it, expect } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { registerExpand } from '../../src/mcp/tools/expand.js';

const E = env as any;

describe('expand', () => {
  beforeEach(async () => {
    await runMigrations(E);
    await E.DB.exec('DELETE FROM edges; DELETE FROM tags; DELETE FROM notes;');
    await E.DB.prepare(`INSERT INTO notes VALUES ('a','A','b','tl','["x"]',null,0,0)`).run();
    await E.DB.prepare(`INSERT INTO notes VALUES ('b','B','b','tl','["y"]',null,0,0)`).run();
    await E.DB.prepare(`INSERT INTO notes VALUES ('c','C','b','tl','["z"]',null,0,0)`).run();
    await E.DB.prepare(`INSERT INTO edges VALUES ('e1','a','b','analogous_to','long enough mechanism why text',0)`).run();
    await E.DB.prepare(`INSERT INTO edges VALUES ('e2','c','a','causes','long enough mechanism why text',0)`).run();
  });

  function reg() {
    const r: any = {};
    const s: any = { registerTool: (n: string, _m: any, h: any) => { r[n] = h; } };
    registerExpand(s, E);
    return r;
  }

  it('returns both directions by default', async () => {
    const r = reg().expand({ note_id: 'a' });
    const parsed = JSON.parse((await r).content[0].text);
    expect(parsed.neighbors.length).toBe(2);
  });

  it('direction=out filters', async () => {
    const parsed = JSON.parse((await reg().expand({ note_id: 'a', direction: 'out' })).content[0].text);
    expect(parsed.neighbors.every((n: any) => n.note.id !== 'c')).toBe(true);
  });

  it('errors on unknown note', async () => {
    const r = await reg().expand({ note_id: 'ghost' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('ghost');
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm test -- expand`
Expected: module not found.

- [ ] **Step 3: Implement `src/mcp/tools/expand.ts`**

```ts
import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { EDGE_TYPES, getEdgesFrom, getEdgesTo, getNoteById, type EdgeRow, type NoteRow } from '../../db/queries.js';

const inputSchema = {
  note_id: z.string().min(1),
  relation_types: z.array(z.enum(EDGE_TYPES as unknown as [string, ...string[]])).optional(),
  direction: z.enum(['in','out','both']).optional().default('both'),
};

const DESCRIPTION = `Vizinhos imediatos (1 hop) de uma nota no grafo.

Retorna {neighbors: [{note, edge}]} onde edge inclui relation_type e why.
Para navegar mais fundo, chame expand recursivamente nos ids retornados.`;

export function registerExpand(server: any, env: Env): void {
  server.registerTool(
    'expand',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: { title: 'Expand neighbors', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    safeToolHandler(async (input: { note_id: string; relation_types?: string[]; direction?: 'in'|'out'|'both' }) => {
      const base = await getNoteById(env, input.note_id);
      if (!base) {
        return toolError(
          `Note '${input.note_id}' não encontrada. Chame recall() primeiro para descobrir o id correto. Não retente com este id.`
        );
      }
      const dir = input.direction ?? 'both';
      const edges: Array<{ edge: EdgeRow; otherId: string }> = [];
      if (dir === 'out' || dir === 'both') {
        for (const e of await getEdgesFrom(env, input.note_id)) edges.push({ edge: e, otherId: e.to_id });
      }
      if (dir === 'in' || dir === 'both') {
        for (const e of await getEdgesTo(env, input.note_id)) edges.push({ edge: e, otherId: e.from_id });
      }
      const filtered = input.relation_types
        ? edges.filter((x) => input.relation_types!.includes(x.edge.relation_type))
        : edges;

      const ids = Array.from(new Set(filtered.map((x) => x.otherId)));
      if (ids.length === 0) return toolSuccess({ neighbors: [] });
      const placeholders = ids.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT id,title,tldr,domains FROM notes WHERE id IN (${placeholders})`
      ).bind(...ids).all<Pick<NoteRow,'id'|'title'|'tldr'|'domains'>>();
      const byId = new Map((rows.results ?? []).map((r) => [r.id, r]));

      const neighbors = filtered.map((x) => {
        const n = byId.get(x.otherId);
        if (!n) return null;
        const domains: string[] = JSON.parse(n.domains);
        return {
          note: { id: n.id, title: n.title, domain: domains[0] ?? 'unknown', tldr: n.tldr },
          edge: { relation_type: x.edge.relation_type, why: x.edge.why },
        };
      }).filter(Boolean);

      return toolSuccess({ neighbors });
    }) as any
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- expand`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/expand.ts test/tools/expand.test.ts
git commit -m "feat(mcp): expand tool — 1-hop neighbors"
```

---

## Task 9: Tool — `get_note`

**Files:**
- Create: `src/mcp/tools/get-note.ts`
- Create: `test/tools/get-note.test.ts`

- [ ] **Step 1: Test**

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, it, expect } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { registerGetNote } from '../../src/mcp/tools/get-note.js';

const E = env as any;

describe('get_note', () => {
  beforeEach(async () => {
    await runMigrations(E);
    await E.DB.exec('DELETE FROM edges; DELETE FROM tags; DELETE FROM notes;');
    await E.DB.prepare(`INSERT INTO notes VALUES ('a','Title','full body','tl','["x"]','idea',1,1)`).run();
    await E.DB.prepare(`INSERT INTO tags (note_id,tag) VALUES ('a','t1'),('a','t2')`).run();
  });

  function reg() {
    const r: any = {};
    registerGetNote({ registerTool: (n: string, _m: any, h: any) => { r[n] = h; } } as any, E);
    return r;
  }

  it('returns full body + tags + edges', async () => {
    const r = await reg().get_note({ id: 'a' });
    const p = JSON.parse(r.content[0].text);
    expect(p.body).toBe('full body');
    expect(p.tags.sort()).toEqual(['t1','t2']);
    expect(Array.isArray(p.edges.out)).toBe(true);
  });

  it('errors on unknown', async () => {
    const r = await reg().get_note({ id: 'ghost' });
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { getEdgesFrom, getEdgesTo, getNoteById, getTagsByNote } from '../../db/queries.js';

const inputSchema = { id: z.string().min(1) };

const DESCRIPTION = `Busca o conteúdo completo de uma nota por id (body + tags + edges).

Use quando você precisa ler/citar o conteúdo integral de uma nota encontrada via recall.`;

export function registerGetNote(server: any, env: Env): void {
  server.registerTool(
    'get_note',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: { title: 'Get full note', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    safeToolHandler(async (input: { id: string }) => {
      const n = await getNoteById(env, input.id);
      if (!n) {
        return toolError(
          `Note '${input.id}' não encontrada. Chame recall() para descobrir o id correto. Não retente com este id.`
        );
      }
      const [tags, edgesOut, edgesIn] = await Promise.all([
        getTagsByNote(env, input.id),
        getEdgesFrom(env, input.id),
        getEdgesTo(env, input.id),
      ]);
      return toolSuccess({
        id: n.id,
        title: n.title,
        body: n.body,
        tldr: n.tldr,
        domains: JSON.parse(n.domains),
        kind: n.kind,
        created_at: n.created_at,
        updated_at: n.updated_at,
        tags,
        edges: {
          out: edgesOut.map((e) => ({ id: e.id, to_id: e.to_id, relation_type: e.relation_type, why: e.why })),
          in:  edgesIn.map((e) => ({ id: e.id, from_id: e.from_id, relation_type: e.relation_type, why: e.why })),
        },
      });
    }) as any
  );
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npm test -- get-note
git add src/mcp/tools/get-note.ts test/tools/get-note.test.ts
git commit -m "feat(mcp): get_note tool"
```

---

## Task 10: Tool — `link`

**Files:**
- Create: `src/mcp/tools/link.ts`
- Create: `test/tools/link.test.ts`

- [ ] **Step 1: Test**

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, it, expect } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { registerLink } from '../../src/mcp/tools/link.js';

const E = env as any;

describe('link', () => {
  beforeEach(async () => {
    await runMigrations(E);
    await E.DB.exec('DELETE FROM edges; DELETE FROM tags; DELETE FROM notes;');
    await E.DB.prepare(`INSERT INTO notes VALUES ('a','A','','tl','[]',null,0,0)`).run();
    await E.DB.prepare(`INSERT INTO notes VALUES ('b','B','','tl','[]',null,0,0)`).run();
  });
  function reg() {
    const r: any = {};
    registerLink({ registerTool: (n: string, _m: any, h: any) => { r[n] = h; } } as any, E);
    return r;
  }

  it('creates edge', async () => {
    const r = await reg().link({ from_id: 'a', to_id: 'b', relation_type: 'analogous_to', why: 'shared feedback-loop mechanism substantive text' });
    expect(r.isError).toBeUndefined();
    const row = await E.DB.prepare('SELECT * FROM edges').first();
    expect(row.from_id).toBe('a');
  });

  it('rejects self-loop', async () => {
    const r = await reg().link({ from_id: 'a', to_id: 'a', relation_type: 'analogous_to', why: 'shared feedback-loop mechanism substantive text' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('para ela mesma');
  });

  it('rejects short why', async () => {
    const r = await reg().link({ from_id: 'a', to_id: 'b', relation_type: 'analogous_to', why: 'short' });
    expect(r.isError).toBe(true);
  });

  it('rejects missing note', async () => {
    const r = await reg().link({ from_id: 'a', to_id: 'ghost', relation_type: 'analogous_to', why: 'shared feedback-loop mechanism substantive text' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('ghost');
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { EDGE_TYPES, getNoteById, insertEdge } from '../../db/queries.js';
import { newId } from '../../util/id.js';

const inputSchema = {
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  relation_type: z.enum(EDGE_TYPES as unknown as [string, ...string[]]),
  why: z.string(),
};

const DESCRIPTION = `Cria uma aresta entre duas notas existentes.

Use quando você descobre uma conexão entre notas antigas durante a conversa, sem criar nota nova.
IMPORTANTE: why mínimo 20 caracteres, explicando o MECANISMO compartilhado.`;

export function registerLink(server: any, env: Env): void {
  server.registerTool(
    'link',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: { title: 'Create edge', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safeToolHandler(async (input: { from_id: string; to_id: string; relation_type: string; why: string }) => {
      if (input.from_id === input.to_id) {
        return toolError(
          `Não é possível criar uma edge de uma nota para ela mesma. ` +
          `Se o objetivo é marcar tensão interna, crie uma nova nota refinando o conceito e ligue as duas com 'refines' ou 'contradicts'.`
        );
      }
      if (input.why.length < 20) {
        return toolError(
          `A justificativa (why) tem apenas ${input.why.length} caracteres — mínimo 20. ` +
          `Explique o MECANISMO compartilhado, não apenas que as notas se relacionam.`
        );
      }
      const [from, to] = await Promise.all([
        getNoteById(env, input.from_id),
        getNoteById(env, input.to_id),
      ]);
      if (!from) {
        return toolError(`Note '${input.from_id}' não encontrada. Chame recall() para descobrir o id correto. Não retente com este id.`);
      }
      if (!to) {
        return toolError(`Note '${input.to_id}' não encontrada. Chame recall() para descobrir o id correto. Não retente com este id.`);
      }
      const id = newId();
      await insertEdge(env, {
        id, from_id: input.from_id, to_id: input.to_id,
        relation_type: input.relation_type as any, why: input.why,
        created_at: Date.now(),
      });
      return toolSuccess({ id, from_id: input.from_id, to_id: input.to_id, relation_type: input.relation_type });
    }) as any
  );
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npm test -- link
git add src/mcp/tools/link.ts test/tools/link.test.ts
git commit -m "feat(mcp): link tool with self-loop + why validation"
```

---

## Task 11: Tool registry + MCP agent

**Files:**
- Create: `src/mcp/registry.ts`
- Create: `src/mcp/agent.ts`

- [ ] **Step 1: Write `src/mcp/registry.ts`**

```ts
import type { Env } from '../env.js';
import { registerSaveNote } from './tools/save-note.js';
import { registerRecall } from './tools/recall.js';
import { registerExpand } from './tools/expand.js';
import { registerGetNote } from './tools/get-note.js';
import { registerLink } from './tools/link.js';

export function registerAllTools(server: any, env: Env): void {
  registerSaveNote(server, env);
  registerRecall(server, env);
  registerExpand(server, env);
  registerGetNote(server, env);
  registerLink(server, env);
}
```

- [ ] **Step 2: Write `src/mcp/agent.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { Env, AuthContext } from '../env.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { registerAllTools } from './registry.js';

export class MindVaultMCP extends McpAgent<Env, Record<string, never>, AuthContext> {
  server = new McpServer(
    { name: 'mind-vault', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );

  async init(): Promise<void> {
    const auth = (this as any).props as AuthContext | undefined;
    if (!auth) throw new Error('MindVaultMCP: missing auth props');
    registerAllTools(this.server, this.env);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0. If `McpServer.registerTool` signature narrows vs our `any`-typed helpers, widen the local tool signature — do NOT loosen `strict`.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/registry.ts src/mcp/agent.ts
git commit -m "feat(mcp): MindVaultMCP agent + tool registry"
```

---

## Task 12: Auth — password hashing + verification

**Files:**
- Create: `src/auth/password.ts`
- Create: `test/auth.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('password', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `src/auth/password.ts`**

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2';

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { algorithm: Algorithm.Argon2id });
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try { return await verify(stored, plain); } catch { return false; }
}
```

- [ ] **Step 3: Run test**

Run: `npm test -- auth`
Expected: green. If `@node-rs/argon2` fails on Workers runtime, fall back to `hash-wasm` argon2id implementation (pure WASM, runs on Workers).

- [ ] **Step 4: Commit**

```bash
git add src/auth/password.ts test/auth.test.ts
git commit -m "feat(auth): argon2id password hashing"
```

---

## Task 13: Setup wizard — HTML + endpoints

**Files:**
- Create: `src/static/styles.ts`
- Create: `src/static/wizard.ts`
- Create: `src/util/html.ts`
- Create: `src/auth/setup.ts`

- [ ] **Step 1: Write `src/util/html.ts`**

```ts
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]!));
}
```

- [ ] **Step 2: Write `src/static/styles.ts`**

```ts
export const BASE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0b0d10; color:#e6e8eb; font: 15px/1.55 ui-sans-serif,system-ui,sans-serif; }
  main { max-width: 680px; margin: 56px auto; padding: 0 24px; }
  h1 { font-size: 28px; letter-spacing:-.01em; margin:0 0 8px; }
  h2 { font-size: 18px; margin: 32px 0 8px; color:#cdd2d8; }
  p  { color:#a7adb5; }
  a  { color:#7cc0ff; }
  .card { background:#111418; border:1px solid #1e242b; border-radius:12px; padding:20px; margin:16px 0; }
  input[type=email],input[type=password] { width:100%; padding:10px 12px; background:#0b0d10; border:1px solid #222931; border-radius:8px; color:#e6e8eb; }
  button { padding:10px 16px; background:#3390ff; color:white; border:0; border-radius:8px; cursor:pointer; font-weight:600; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  code, pre { background:#0b0d10; border:1px solid #1e242b; border-radius:6px; padding:2px 6px; font-family:ui-monospace,Menlo,monospace; }
  pre { padding:12px; overflow-x:auto; }
  .footer { margin-top:56px; color:#6b7278; font-size:13px; }
  .tabs { display:flex; gap:8px; margin-top:8px; }
  .tab { padding:8px 14px; border:1px solid #1e242b; border-radius:8px; cursor:pointer; }
  .tab.active { background:#1a2230; border-color:#3390ff; }
`;
```

- [ ] **Step 3: Write `src/static/wizard.ts`**

```ts
import { BASE_CSS } from './styles.js';

export function renderWizard(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Mind Vault — Setup</title>
<style>${BASE_CSS}</style></head>
<body><main>
  <h1>Mind Vault</h1>
  <p>Um cofre pessoal de conhecimento latticework operado via Claude MCP.</p>

  <div class="card">
    <h2>1. Credenciais</h2>
    <p>Defina email + passphrase. A passphrase é hashada com argon2id e o hash é guardado como secret do Worker.</p>
    <form id="credentials" method="post" action="/setup/credentials">
      <p><label>Email<br><input type="email" name="email" required></label></p>
      <p><label>Passphrase<br><input type="password" name="password" required minlength="12"></label></p>
      <p><label>Confirmar<br><input type="password" name="password2" required minlength="12"></label></p>
      <button type="submit">Continuar</button>
    </form>
  </div>

  <div class="card">
    <h2>2. Provisioning</h2>
    <p>Migrations D1 + check do índice Vectorize rodam quando você clica em <em>Provision</em>.</p>
    <form method="post" action="/setup/provision"><button type="submit">Provision</button></form>
  </div>

  <div class="card">
    <h2>3. Conectar ao Claude</h2>
    <p>URL MCP: <code id="mcp-url"></code></p>
    <p>Escolha seu cliente:</p>
    <div class="tabs">
      <div class="tab active">Claude Code</div>
      <div class="tab">Desktop</div>
      <div class="tab">Web</div>
    </div>
    <pre>claude mcp add mind-vault --transport http &lt;URL&gt;/mcp</pre>
  </div>

  <div class="card">
    <h2>4. Instalar a skill</h2>
    <p><a href="/skill/using-mind-vault.zip">Download skill (.zip)</a></p>
    <p>Claude Code: descompactar em <code>~/.claude/skills/</code>.</p>
    <p>Desktop/Web: upload via UI de skills.</p>
  </div>

  <div class="card">
    <h2>5. Personalize o Claude</h2>
    <p>Em Settings → Personal preferences, adicione:</p>
    <pre id="prefs">Mind Vault is connected as an MCP server. When I am discussing
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
Follow the using-mind-vault skill for the full method.</pre>
    <button onclick="navigator.clipboard.writeText(document.getElementById('prefs').innerText)">Copy</button>
  </div>

  <div class="footer">
    Feito por <strong>Robson Lins</strong>. Se esse projeto te ajudou, me segue:<br>
    <a href="https://www.instagram.com/orobsonn">Instagram</a> ·
    <a href="https://x.com/orobsonnn">X/Twitter</a> ·
    <a href="https://youtube.com/@orobsonnn">YouTube</a>
  </div>
<script>document.getElementById('mcp-url').textContent = location.origin + '/mcp';</script>
</main></body></html>`;
}

export function renderLanding(stats: { notes: number; edges: number; lastWrite: number | null }): string {
  const lw = stats.lastWrite ? new Date(stats.lastWrite).toISOString() : '—';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Mind Vault</title>
<style>${BASE_CSS}</style></head><body><main>
  <h1>Mind Vault</h1>
  <p>Cofre conectado.</p>
  <div class="card">
    <h2>Status</h2>
    <p>Notas: <strong>${stats.notes}</strong> · Edges: <strong>${stats.edges}</strong> · Último write: <code>${lw}</code></p>
    <p>URL MCP: <code id="mcp-url"></code></p>
  </div>
  <div class="footer">
    Feito por <strong>Robson Lins</strong> —
    <a href="https://www.instagram.com/orobsonn">Instagram</a> ·
    <a href="https://x.com/orobsonnn">X/Twitter</a> ·
    <a href="https://youtube.com/@orobsonnn">YouTube</a>
  </div>
<script>document.getElementById('mcp-url').textContent = location.origin + '/mcp';</script>
</main></body></html>`;
}
```

- [ ] **Step 4: Write `src/auth/setup.ts`**

```ts
import type { Env } from '../env.js';
import { runMigrations } from '../db/migrate.js';
import { renderLanding, renderWizard } from '../static/wizard.js';

export function isSetup(env: Env): boolean {
  return Boolean(env.OWNER_EMAIL && env.OWNER_PASSWORD_HASH);
}

export async function handleRoot(_req: Request, env: Env): Promise<Response> {
  if (!isSetup(env)) {
    return new Response(renderWizard(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const [n, e, lw] = await Promise.all([
    env.DB.prepare(`SELECT count(*) c FROM notes`).first<{ c: number }>(),
    env.DB.prepare(`SELECT count(*) c FROM edges`).first<{ c: number }>(),
    env.DB.prepare(`SELECT max(updated_at) m FROM notes`).first<{ m: number | null }>(),
  ]);
  return new Response(renderLanding({
    notes: n?.c ?? 0, edges: e?.c ?? 0, lastWrite: lw?.m ?? null,
  }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function handleProvision(env: Env): Promise<Response> {
  await runMigrations(env);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
}
```

Note: the `/setup/credentials` POST intentionally does not write secrets directly — on Cloudflare Workers, secrets can only be set via `wrangler secret put` or the dashboard. The wizard will display the argon2id hash to the user and instruct them to run `wrangler secret put OWNER_EMAIL` / `OWNER_PASSWORD_HASH`. This is spec section 10's "to verify" item — implemented as the manual-command fallback for now.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0.

- [ ] **Step 6: Commit**

```bash
git add src/static src/util/html.ts src/auth/setup.ts
git commit -m "feat(setup): first-run wizard + read-only landing"
```

---

## Task 14: OAuth handler + worker entry

**Files:**
- Modify: `src/index.ts`
- Create: `src/auth/handler.ts`
- Modify: `wrangler.toml` (add `OAUTH_KV`)

- [ ] **Step 1: Add KV binding to `wrangler.toml`**

Append:

```toml
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "PLACEHOLDER_SET_ON_DEPLOY"
```

- [ ] **Step 2: Write `src/auth/handler.ts`**

```ts
import type { Env } from '../env.js';
import { handleRoot, handleProvision, isSetup } from './setup.js';
import { verifyPassword } from './password.js';
import { BASE_CSS } from '../static/styles.js';
import { esc } from '../util/html.js';

export const authHandler = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/' ) return handleRoot(req, env);
    if (url.pathname === '/setup/provision' && req.method === 'POST') return handleProvision(env);

    if (url.pathname === '/skill/using-mind-vault.zip') {
      return env.ASSETS.fetch(new Request(new URL('/using-mind-vault.zip', url.origin)));
    }

    if (url.pathname === '/authorize') {
      if (!isSetup(env)) return new Response('Vault not configured', { status: 503 });
      if (req.method === 'POST') {
        const form = await req.formData();
        const email = String(form.get('email') ?? '');
        const password = String(form.get('password') ?? '');
        if (email !== env.OWNER_EMAIL) return renderLogin('Credenciais inválidas.', url.search);
        const ok = await verifyPassword(password, env.OWNER_PASSWORD_HASH!);
        if (!ok) return renderLogin('Credenciais inválidas.', url.search);
        const provider = (ctx as any).oauth ?? (env as any).OAUTH_PROVIDER;
        return provider.completeAuthorization({
          request: req,
          userId: email,
          metadata: { email },
          scope: ['mcp'],
          props: { email, loggedInAt: Date.now() },
        });
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
```

Note: the exact shape of `completeAuthorization` comes from `@cloudflare/workers-oauth-provider`. If the runtime API differs (e.g., the provider is reached via a different mechanism), adjust this function to match — the contract we need is: given a successful login, return a Response the provider hands to the client. Check the README of that package before implementing.

- [ ] **Step 3: Rewrite `src/index.ts`**

```ts
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { MindVaultMCP } from './mcp/agent.js';
import { authHandler } from './auth/handler.js';

export { MindVaultMCP };

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: MindVaultMCP.serve('/mcp') as any,
  defaultHandler: authHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  accessTokenTTL: 86400,
  refreshTokenTTL: 2592000,
});
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: 0. If OAuthProvider's generic types reject our handlers, cast via `as any` at the boundary (the interior types are already strict).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/auth/handler.ts wrangler.toml
git commit -m "feat(auth): OAuth provider + login handler + worker entry"
```

---

## Task 15: Skill content

**Files:**
- Create: `skills/using-mind-vault/SKILL.md`
- Create: `skills/using-mind-vault/reference/edge-types.md`
- Create: `skills/using-mind-vault/reference/examples.md`

- [ ] **Step 1: Write `SKILL.md`**

```markdown
---
name: using-mind-vault
description: Captures atomic concepts and their structural connections into a personal knowledge graph on Cloudflare D1. Use when the user is discussing an idea, insight, or concept that could compound with prior thinking. Applies latticework method — atomize, tag by specific domain, search cross-domain analogies, link with substantive justifications. Requires MindVault MCP connected.
---

# Using Mind Vault

## Purpose

Build a latticework of atomic concepts across domains so future thinking can reach for structural analogies instead of restating the same idea twice.

## When to save

- The user articulates a non-obvious idea, insight, or decision worth reusing.
- The user recognizes a pattern they'll want to find again.
- The user makes a judgment call with reasoning worth preserving.

## When NOT to save

- Ephemeral chat, task logistics, or day-to-day execution.
- Facts already common in Claude's training (definitions, well-known concepts).
- Anything you can't write a one-sentence Feynman tldr for — if you can't, it isn't ready.

## The four disciplines

### 1. Atomize
One note = one concept. If the title contains "and" or "e", split it.

### 2. Domain specifically
Use `evolutionary-biology`, not `science`. Use `behavioral-economics`, not `economics`. 1–3 domains, each as narrow as you can make it.

### 3. Cross-domain sweep
ALWAYS call `MindVault:recall` before `MindVault:save_note`, even when you think the idea is original. The vault's value comes from surfacing analogies across fields.

### 4. Edge discipline
Every edge needs a substantive `why` — a sentence naming the shared MECHANISM. If you can't write the why, don't create the edge.

## Save workflow

```
- [ ] Atomized? (one concept, one note)
- [ ] tldr in one concrete sentence (Feynman test)
- [ ] 1–3 specific domains chosen
- [ ] MindVault:recall called to sweep cross-domain
- [ ] Analogies drafted into edges with substantive whys
- [ ] MindVault:save_note called with edges in the same call
```

## Recall workflow

- Call `MindVault:recall` with a short query (not the full question).
- Read ALL returned domains before answering. The valuable match usually comes from the unexpected domain.
- For any hit that looks promising, call `MindVault:get_note` to read the body, or `MindVault:expand` to see neighbors.
- Prefer recall + expand + synthesize over answering from generic training.

## Tool reference

- `MindVault:save_note` — atomic note + optional edges in one call.
- `MindVault:recall` — domain-balanced hybrid search. Returns only tldrs.
- `MindVault:expand` — 1-hop neighbors of a note.
- `MindVault:get_note` — full body + tags + edges of one note.
- `MindVault:link` — create an edge between two existing notes.

## Anti-patterns

- Saving everything. Be ruthless.
- Edges with lazy whys ("both are about X"). Name the mechanism.
- Skipping recall because "this is obviously new".
- `instance_of` when the correct edge is `analogous_to` — an instance is a literal case of the same concept; an analogy shares structure across different concepts.

## Pointers

- `reference/edge-types.md` — full catalog of the 9 edge types and when to use each.
- `reference/examples.md` — annotated sessions showing the full workflow.
```

- [ ] **Step 2: Write `reference/edge-types.md`**

```markdown
# Edge types

| Category | Type | Use when |
|---|---|---|
| Structural | `analogous_to` | Same shape, different domains |
| Structural | `same_mechanism_as` | Same underlying mechanism (Gentner structure mapping) |
| Structural | `instance_of` | Concrete example of an abstract concept |
| Structural | `generalizes` | Abstract generalization of a concrete example |
| Causal | `causes` | A produces B |
| Causal | `depends_on` | A requires B (causal or cognitive prerequisite) |
| Epistemic | `contradicts` | Tension: both cannot be true |
| Epistemic | `evidence_for` | Empirical support |
| Epistemic | `refines` | More precise version (correction, not contradiction) |

## analogous_to vs same_mechanism_as

`analogous_to` = same shape. `same_mechanism_as` = same underlying mechanism. Use the stronger one when you can justify the why at mechanism level. Example: "Red Queen" and "tech debt spiral" are `analogous_to` (both feel like running to stand still) but probably not `same_mechanism_as` (the mechanisms differ — coevolution vs compounding interest).

## instance_of vs analogous_to

`instance_of`: "Bitcoin is an instance_of cryptographic commitment scheme." The specific IS a case of the abstract.
`analogous_to`: "Bitcoin mining is analogous_to an arms race." Same shape, different concepts.

## causes vs depends_on

`causes`: temporal/mechanistic. A produces B.
`depends_on`: prerequisite. B can't exist/function without A. Includes cognitive dependencies (you can't understand B without first understanding A).

## contradicts vs refines

`contradicts`: both can't be true; something must give.
`refines`: newer note is a more precise version of the older one — the older one was a coarser approximation, not wrong.
```

- [ ] **Step 3: Write `reference/examples.md`**

```markdown
# Example sessions

## Example 1 — cross-domain hit on first save

User: "I just realized tech debt behaves like compound interest — the longer you ignore it the worse the rate gets."

Claude: calls `MindVault:recall({ query: "compounding debt feedback loop" })`.
Returns include a note "Red Queen" (evolutionary-biology). Claude reads the domains list, spots the cross-domain signal.

Claude: "Worth saving — and there's a resonance with the Red Queen note from biology. Save?"

User: "yes"

Claude: calls `MindVault:save_note`:
\`\`\`json
{
  "title": "Tech debt compounds like interest",
  "body": "...",
  "tldr": "Unpaid tech debt accrues interest in the form of future changes getting slower.",
  "domains": ["software-engineering"],
  "edges": [
    { "to_id": "n_red_queen_id", "relation_type": "analogous_to",
      "why": "Both describe systems where not running forward means falling behind, because the cost of inaction compounds." }
  ]
}
\`\`\`

## Example 2 — recall before answering

User: "why do I keep bouncing off Rust's borrow checker?"

Claude: calls `MindVault:recall({ query: "ownership aliasing mental model" })`. Reads the domain spread. Finds a note on linear types from type theory.

Claude: "You have a note from type theory on linear types that might reframe this — want me to pull it?"

User: "yes"

Claude: calls `MindVault:get_note`, reads body, synthesizes an answer that cites the user's own prior thinking.

## Example 3 — deciding NOT to save

User: "ugh, the tests are flaky again, probably timing."

Claude: recognizes this as task logistics, not a concept. Does not save. Moves on.

## Example 4 — linking two existing notes mid-conversation

User discussing two ideas Claude already saved months apart. Claude notices mechanism overlap that wasn't edged at save time.

Claude: calls `MindVault:link` with a substantive why naming the shared mechanism.
```

- [ ] **Step 4: Commit**

```bash
git add skills/
git commit -m "feat(skill): using-mind-vault skill + edge/examples references"
```

---

## Task 16: Build-skill-zip script

**Files:**
- Create: `scripts/build-skill-zip.ts`

- [ ] **Step 1: Write script**

```ts
import AdmZip from 'adm-zip';
import { readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'skills/using-mind-vault';
const OUT_DIR = 'assets';
const OUT = join(OUT_DIR, 'using-mind-vault.zip');

function addDir(zip: AdmZip, dir: string, base: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) addDir(zip, full, base);
    else zip.addLocalFile(full, relative(base, dir));
  }
}

mkdirSync(OUT_DIR, { recursive: true });
const zip = new AdmZip();
addDir(zip, SRC, SRC);
zip.writeZip(OUT);
console.log(`Wrote ${OUT}`);
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/build-skill-zip.ts`
Expected: `assets/using-mind-vault.zip` exists and contains SKILL.md + reference/ files.

- [ ] **Step 3: Verify contents**

Run: `unzip -l assets/using-mind-vault.zip`
Expected: lists SKILL.md, reference/edge-types.md, reference/examples.md.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-skill-zip.ts
git commit -m "build: skill zip packager script"
```

---

## Task 17: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

```markdown
# Mind Vault

A personal latticework knowledge graph, served entirely from your own Cloudflare account, operated through Claude via MCP. Concepts are atomic, edges carry justifications, recall is domain-balanced to surface cross-domain analogies.

Not a notes app. A thinking tool.

## Deploy to your Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_USER/mind-vault)

After deploy, open the Worker URL — the first visit runs a setup wizard (credentials → migrations → connect to Claude → install skill → personalize Claude).

## Security

**Single-user by design.** Do not share the URL. Access is gated by an email + passphrase you set during setup. If you want multi-user, fork and adapt — it is not a drop-in change.

## Method & intellectual lineage

- Charlie Munger — latticework of mental models (north star, not dogma).
- Scott E. Page, *The Model Thinker* — diversity prediction theorem.
- Hofstadter & Sander, *Surfaces and Analogies* — analogy at the core of cognition.
- Dedre Gentner — structure-mapping theory.
- Luhmann / Ahrens — Zettelkasten, atomic notes, links with substance.
- Feynman — if you can't explain it simply, you don't understand it (tldr field).
- Popper — falsifiability (contradicts / refines edges).

Framing: **latticework thinking / many-model knowledge graph**.

## Tools exposed over MCP

- `save_note` — atomic note + edges.
- `recall` — domain-balanced hybrid search.
- `expand` — 1-hop neighbors.
- `get_note` — full body.
- `link` — edge between two existing notes.

## Free-tier notes

D1 + Vectorize + Workers AI free tiers are sufficient for personal use. Confirm current limits on Cloudflare's pricing pages before relying on them.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README with deploy button + security + lineage"
```

---

## Task 18: End-to-end smoke test

**Files:**
- Create: `test/e2e.test.ts`

- [ ] **Step 1: Write smoke test**

```ts
import { env } from 'cloudflare:test';
import { beforeAll, describe, it, expect, vi } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import { registerSaveNote } from '../src/mcp/tools/save-note.js';
import { registerRecall } from '../src/mcp/tools/recall.js';
import { registerGetNote } from '../src/mcp/tools/get-note.js';
import { registerExpand } from '../src/mcp/tools/expand.js';
import { registerLink } from '../src/mcp/tools/link.js';

const E = env as any;

describe('e2e: all tools wired', () => {
  const tools: any = {};
  beforeAll(async () => {
    E.AI = { run: vi.fn(async () => ({ data: [Array(768).fill(0.1)] })) };
    E.VECTORIZE = {
      upsert: vi.fn(async () => ({})),
      query: vi.fn(async () => ({ matches: [] })),
    };
    await runMigrations(E);
    await E.DB.exec('DELETE FROM edges; DELETE FROM tags; DELETE FROM notes;');
    const s: any = { registerTool: (n: string, _m: any, h: any) => { tools[n] = h; } };
    registerSaveNote(s, E); registerRecall(s, E); registerGetNote(s, E);
    registerExpand(s, E); registerLink(s, E);
  });

  it('save → link → get flow works', async () => {
    const a = await tools.save_note({
      title: 'Red Queen', body: 'coevolution body',
      tldr: 'coevolution forces constant running just to stay in place',
      domains: ['evolutionary-biology'],
    });
    const b = await tools.save_note({
      title: 'Tech debt spiral', body: 'compounding',
      tldr: 'unpaid debt accrues interest via slower future work',
      domains: ['software-engineering'],
    });
    const aId = JSON.parse(a.content[0].text).id;
    const bId = JSON.parse(b.content[0].text).id;

    const linked = await tools.link({
      from_id: aId, to_id: bId, relation_type: 'analogous_to',
      why: 'Both describe systems where cost of inaction compounds over time',
    });
    expect(linked.isError).toBeUndefined();

    const full = await tools.get_note({ id: aId });
    const fp = JSON.parse(full.content[0].text);
    expect(fp.edges.out.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all suites green.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0.

- [ ] **Step 4: Commit**

```bash
git add test/e2e.test.ts
git commit -m "test(e2e): save → link → get flow"
```

---

## Task 19: Final verification + placeholder screenshots dir

**Files:**
- Create: `assets/skill-screenshots/.gitkeep`

- [ ] **Step 1: Create placeholder dir**

```bash
mkdir -p assets/skill-screenshots
touch assets/skill-screenshots/.gitkeep
```

- [ ] **Step 2: Full suite green + typecheck + skill build**

Run:
```bash
npm run typecheck && npm test && npm run build:skill
```
Expected: all three exit 0 and `assets/using-mind-vault.zip` is present.

- [ ] **Step 3: Final commit**

```bash
git add assets/skill-screenshots/.gitkeep
git commit -m "chore: placeholder for skill screenshots"
```

---

## Deferred / out of scope for this plan

- Real deployment: requires Robson to run `wrangler deploy` with D1/Vectorize IDs filled in. The plan produces a repo that compiles and passes tests; wiring real IDs and running the deploy is a manual pass after code is in.
- Screenshots for the wizard's "Install the skill" tabs — Robson fornece depois.
- Fine-tuning of the OAuthProvider `completeAuthorization` call shape — may need a small fixup once the exact API from `@cloudflare/workers-oauth-provider` is exercised end-to-end against a real Claude client.
- Secrets persistence strategy (wizard UI vs `wrangler secret put` vs D1 singleton row) — spec §10 flagged this as "to verify". Current plan uses the manual `wrangler secret put` fallback shown in Task 13.
