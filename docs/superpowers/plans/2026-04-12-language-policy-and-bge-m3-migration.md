# Language Policy + bge-m3 Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch Mind Vault from `bge-base-en-v1.5` (768-dim, English-primary) to `bge-m3` (1024-dim, multilingual), enforce English-canonical domain slugs server-side, and translate all human-facing UI + Claude-facing strings from pt-BR to English.

**Architecture:** Single coherent commit bundle. A new `src/db/validation.ts` centralizes the domain slug regex + pedagogical error so both `save_note` and `recall` use the same validator. The embedding model switch is a one-line change in `src/vector/index.ts` — the response shape of `@cf/baai/bge-m3` has the same `{ data: number[][] }` contract, just 1024-dim instead of 768. UI and Claude-facing strings are translated in-place, no i18n framework. Migration wipes the 2 test notes (user confirmed disposable) and recreates the Vectorize index with the new dimension.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Vectorize, Workers AI (`@cf/baai/bge-m3`), vitest + `@cloudflare/vitest-pool-workers`.

**Spec:** `docs/superpowers/specs/2026-04-12-language-policy-and-bge-m3-migration.md`

---

## File structure

```
src/
├── db/
│   └── validation.ts        # NEW — validateDomains() + regex + pedagogical error
├── vector/
│   └── index.ts             # MODIFY — bge-base-en-v1.5 → bge-m3
├── mcp/
│   ├── helpers.ts           # MODIFY — error messages pt → en
│   └── tools/
│       ├── save-note.ts     # MODIFY — description en + domain validation
│       ├── recall.ts        # MODIFY — description en + domains_filter validation
│       ├── expand.ts        # MODIFY — description en
│       ├── get-note.ts      # MODIFY — description en
│       └── link.ts          # MODIFY — description en
├── static/
│   └── wizard.ts            # MODIFY — wizard + landing HTML en
└── auth/
    └── handler.ts           # MODIFY — credentials, login, error pages en

skills/using-mind-vault/
└── SKILL.md                 # MODIFY — add Language policy + Domain naming convention

test/
├── db/
│   └── validation.test.ts   # NEW
├── helpers.test.ts          # MODIFY
└── tools/
    ├── save-note.test.ts    # MODIFY + new domain cases
    ├── recall.test.ts       # MODIFY + new domains_filter cases
    ├── expand.test.ts       # MODIFY (pt → en substrings)
    ├── get-note.test.ts     # MODIFY
    └── link.test.ts         # MODIFY
```

No files deleted. Plan is 12 tasks: 9 code/test tasks, 1 full-suite safety net, 1 release procedure, 1 human-in-loop acceptance test.


---

## Task 1: Domain slug validator

Self-contained pure module that both `save_note` and `recall` will call. Has its own unit tests — no DB or network dependency.

**Files:**
- Create: `src/db/validation.ts`
- Test: `test/db/validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/db/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateDomains, DOMAIN_SLUG_REGEX } from '../../src/db/validation.js';

describe('validateDomains', () => {
  it('accepts canonical slugs', () => {
    expect(validateDomains(['evolutionary-biology'])).toBeNull();
    expect(validateDomains(['systems-thinking', 'game-theory'])).toBeNull();
    expect(validateDomains(['ai', 'ml', 'nlp'])).toBeNull();
    expect(validateDomains(['economics-101'])).toBeNull();
  });

  it('rejects uppercase', () => {
    const err = validateDomains(['Evolutionary-Biology']);
    expect(err).not.toBeNull();
    expect(err).toContain('Evolutionary-Biology');
    expect(err).toContain('kebab-case');
  });

  it('rejects accented chars', () => {
    const err = validateDomains(['biologia-evolutiva-avançada']);
    expect(err).not.toBeNull();
    expect(err).toContain('biologia-evolutiva-avançada');
  });

  it('rejects spaces', () => {
    const err = validateDomains(['evolutionary biology']);
    expect(err).not.toBeNull();
    expect(err).toContain('evolutionary biology');
  });

  it('rejects underscore', () => {
    expect(validateDomains(['evolutionary_biology'])).not.toBeNull();
  });

  it('rejects leading digit', () => {
    expect(validateDomains(['1biology'])).not.toBeNull();
  });

  it('rejects too short (single char)', () => {
    expect(validateDomains(['a'])).not.toBeNull();
  });

  it('rejects too long (>40 chars)', () => {
    const longSlug = 'a' + '-b'.repeat(25);
    expect(validateDomains([longSlug])).not.toBeNull();
  });

  it('rejects Portuguese translation with pedagogical error', () => {
    const err = validateDomains(['biologia-evolutiva']);
    expect(err).not.toBeNull();
    expect(err).toContain('evolutionary-biology');
    expect(err).toContain('biologia-evolutiva');
  });

  it('stops at first invalid in list', () => {
    const err = validateDomains(['valid-one', 'INVALID', 'another-valid']);
    expect(err).toContain('INVALID');
  });

  it('DOMAIN_SLUG_REGEX is exported and correct', () => {
    expect(DOMAIN_SLUG_REGEX).toBeInstanceOf(RegExp);
    expect('evolutionary-biology').toMatch(DOMAIN_SLUG_REGEX);
    expect('INVALID').not.toMatch(DOMAIN_SLUG_REGEX);
  });
});
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm test -- validation`
Expected: fail with "Cannot find module".

- [ ] **Step 3: Implement the validator**

Create `src/db/validation.ts`:

```ts
// Canonical domain slug format: lowercase ASCII kebab-case, 2-40 chars.
// Domains are vault schema, not content — they must not drift between
// conversation languages. Enforced server-side so Claude cannot fragment
// the taxonomy accidentally.
export const DOMAIN_SLUG_REGEX = /^[a-z][a-z0-9-]{1,39}$/;

export function validateDomains(domains: string[]): string | null {
  for (const d of domains) {
    if (typeof d \!== 'string' || \!DOMAIN_SLUG_REGEX.test(d)) {
      return buildDomainError(d);
    }
  }
  return null;
}

function buildDomainError(offender: unknown): string {
  const shown = typeof offender === 'string' ? offender : String(offender);
  return (
    `Domain '${shown}' is not a valid canonical slug. Use English kebab-case lowercase ` +
    `(e.g. 'evolutionary-biology', 'behavioral-economics', 'systems-thinking', ` +
    `'competitive-strategy', 'game-theory'). Domains are vault schema — they need to be ` +
    `stable identifiers that do not drift between conversation languages. Do NOT use ` +
    `accented characters, spaces, uppercase, or translations to other languages. ` +
    `If the conversation is in Portuguese and you were going to use 'biologia-evolutiva', ` +
    `use 'evolutionary-biology' instead.`
  );
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test -- validation`
Expected: all 11 cases green.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/db/validation.ts test/db/validation.test.ts
git commit -m "feat(db): canonical domain slug validator with pedagogical error"
```

---

## Task 2: Wire validator into save_note + translate description

**Files:**
- Modify: `src/mcp/tools/save-note.ts`
- Modify: `test/tools/save-note.test.ts`

- [ ] **Step 1: Update test — pt asserts become en, add new domain validation cases**

Full replacement for `test/tools/save-note.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { registerSaveNote } from '../../src/mcp/tools/save-note.js';

const E = env as any;

function fakeAI() {
  return { run: vi.fn(async () => ({ data: [Array(1024).fill(0.1)] })) };
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
    await E.DB.exec('DELETE FROM edges');
    await E.DB.exec('DELETE FROM tags');
    await E.DB.exec('DELETE FROM notes');
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
      `INSERT INTO notes VALUES ('target','t','b','tl','["seed-domain"]',null,0,0)`
    ).run();
    const r = await registered.save_note({
      title: 'X',
      body: 'b',
      tldr: 'tl of at least ten chars here ok',
      domains: ['seed-domain'],
      edges: [{ to_id: 'target', relation_type: 'analogous_to', why: 'too short' }],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('20 characters');
  });

  it('rejects edge pointing to missing note', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    const r = await registered.save_note({
      title: 'X', body: 'b',
      tldr: 'tldr long enough here really',
      domains: ['seed-domain'],
      edges: [{ to_id: 'ghost', relation_type: 'analogous_to', why: 'this is a long enough why to pass validation' }],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('ghost');
  });

  it('rejects non-canonical domain (portuguese translation)', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    const r = await registered.save_note({
      title: 'X', body: 'b',
      tldr: 'tldr long enough here really',
      domains: ['biologia-evolutiva'],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('biologia-evolutiva');
    expect(r.content[0].text).toContain('evolutionary-biology');
  });

  it('rejects uppercase domain', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    const r = await registered.save_note({
      title: 'X', body: 'b',
      tldr: 'tldr long enough here really',
      domains: ['Evolutionary-Biology'],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Evolutionary-Biology');
  });

  it('does not write to D1 when domain validation fails', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    await registered.save_note({
      title: 'X', body: 'b',
      tldr: 'tldr long enough here really',
      domains: ['INVALID'],
    });
    const count = await E.DB.prepare('SELECT count(*) c FROM notes').first();
    expect(count.c).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect failures**

Run: `npm test -- save-note`
Expected: old tests fail on pt→en substrings; new domain tests fail (no validator wired).

- [ ] **Step 3: Update `src/mcp/tools/save-note.ts` — full replacement**

```ts
import { z } from 'zod';
import type { Env } from '../../env.js';
import { newId } from '../../util/id.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { EDGE_TYPES, insertEdge, insertNote, insertTags, getNoteById } from '../../db/queries.js';
import { validateDomains } from '../../db/validation.js';
import { embed, upsertNoteVector } from '../../vector/index.js';

const edgeSchema = z.object({
  to_id: z.string().min(1),
  relation_type: z.enum(EDGE_TYPES as unknown as [string, ...string[]]),
  why: z.string(),
});

const inputSchema = {
  title: z.string().min(1).max(200).describe('Atomic title. No "and".'),
  body: z.string().min(1).describe('Body in markdown'),
  tldr: z.string().min(10).max(280).describe('One sentence. Feynman test.'),
  domains: z.array(z.string().min(1)).min(1).max(3).describe('Canonical English slugs (1-3)'),
  kind: z.string().optional(),
  tags: z.array(z.string()).optional(),
  edges: z.array(edgeSchema).optional(),
};

const DESCRIPTION = `Saves an atomic note to the vault, optionally with edges to existing notes.

MANDATORY FLOW before calling:
1. Atomize: one note = one concept. If the title contains "and", split it into separate calls.
2. Call recall() first to sweep for cross-domain analogies. Even if you think the idea is original.
3. For each analogy in ANOTHER domain, include an edge in the edges array of this same call.

The tldr field is a Feynman test: if you cannot summarize the concept in one concrete sentence, the note is NOT ready — do not force it, keep talking with the user until you have clarity. Do NOT call save_note without a concrete tldr.

Write title/body/tldr in the CONVERSATION LANGUAGE (if the user is speaking Portuguese, save in Portuguese; English → English). The embedding model is multilingual.

The domains field MUST always use canonical English kebab-case slugs (e.g. 'evolutionary-biology', 'behavioral-economics', 'systems-thinking'), regardless of conversation language. Domains are schema — do NOT translate them.

IMPORTANT: the why field of each edge is rejected if it has fewer than 20 characters, and edges pointing to non-existent ids are rejected. If you do not have the target note id, call recall() first. Domains that do not match the canonical slug format are rejected with an explanation.`;

interface SaveNoteInput {
  title: string;
  body: string;
  tldr: string;
  domains: string[];
  kind?: string;
  tags?: string[];
  edges?: Array<{ to_id: string; relation_type: string; why: string }>;
}

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
    safeToolHandler(async (input: SaveNoteInput) => {
      const domainError = validateDomains(input.domains);
      if (domainError) {
        return toolError(domainError);
      }

      const now = Date.now();
      const id = newId();

      if (input.edges) {
        for (const e of input.edges) {
          if (e.why.length < 20) {
            return toolError(
              `The why field of this edge has only ${e.why.length} characters — minimum is 20. ` +
              `Rewrite it naming the shared MECHANISM between the two notes, not just saying they are related. ` +
              `Good example: "Both are systems with delayed negative feedback, so both oscillate." ` +
              `Bad example: "both are about growth".`
            );
          }
          const target = await getNoteById(env, e.to_id);
          if (\!target) {
            return toolError(
              `Note '${e.to_id}' not found in the vault. Call recall() first with a related query ` +
              `to discover the correct id. Do NOT retry with this id.`
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

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- save-note`
Expected: all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/save-note.ts test/tools/save-note.test.ts
git commit -m "feat(mcp): save_note with English description + domain validation"
```

---

## Task 3: Wire validator into recall + translate description

**Files:**
- Modify: `src/mcp/tools/recall.ts`
- Modify: `test/tools/recall.test.ts`

- [ ] **Step 1: Update `test/tools/recall.test.ts`**

Add these cases inside the existing `describe('recall', ...)` block:

```ts
  it('rejects invalid domains_filter slug', async () => {
    const registered: any = {};
    const server: any = { registerTool: (n: string, _m: any, h: any) => { registered[n] = h; } };
    registerRecall(server, E);
    const r = await registered.recall({ query: 'x', domains_filter: ['biologia-evolutiva'] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('biologia-evolutiva');
    expect(r.content[0].text).toContain('evolutionary-biology');
  });

  it('accepts valid domains_filter slug', async () => {
    const registered: any = {};
    const server: any = { registerTool: (n: string, _m: any, h: any) => { registered[n] = h; } };
    registerRecall(server, E);
    const r = await registered.recall({ query: 'coevolution', domains_filter: ['evolutionary-biology'] });
    expect(r.isError).toBeUndefined();
  });
```

Also replace `Array(768).fill(0.1)` with `Array(1024).fill(0.1)` in the existing `fakeAI` mock.

- [ ] **Step 2: Run, expect fails**

Run: `npm test -- recall`
Expected: new cases fail.

- [ ] **Step 3: Replace `src/mcp/tools/recall.ts`**

```ts
import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { ftsSearch, type NoteRow } from '../../db/queries.js';
import { validateDomains } from '../../db/validation.js';
import { embed, queryVector } from '../../vector/index.js';

const inputSchema = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(30).optional().default(15),
  domains_filter: z.array(z.string()).optional(),
};

const DESCRIPTION = `Hybrid cross-domain search in the vault (vector + FTS).

Returns up to \`limit\` results balanced by domain (at most 3 per domain, up to 5 distinct domains).
Returns only {id, title, domain, kind, tldr} — NEVER the body. To read the body, call get_note(id).

Query in any language — the embedding model is multilingual and matches across languages. A Portuguese query can surface English notes and vice versa.

IMPORTANT: read ALL returned domains before answering. The valuable match often comes from the unexpected domain — that is exactly what the vault is for. If domains_filter is provided, all entries must be canonical English slugs (same rules as save_note.domains).`;

interface RecallHit {
  id: string; title: string; domain: string; kind: string | null; tldr: string;
}

interface RecallInput { query: string; limit?: number; domains_filter?: string[]; }

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
    safeToolHandler(async (input: RecallInput) => {
      if (input.domains_filter && input.domains_filter.length > 0) {
        const err = validateDomains(input.domains_filter);
        if (err) return toolError(err);
      }

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
      const ftsOrder = ftsRows.map((r) => r.id).filter((id) => byId.has(id) && \!vectorOrder.includes(id));
      const merged = [...vectorOrder, ...ftsOrder];

      let pool: RecallHit[] = merged.map((id) => byId.get(id)\!).filter(Boolean);
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
        if (\!distinctDomains.has(h.domain) && distinctDomains.size >= 5) continue;
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

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test -- recall`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/recall.ts test/tools/recall.test.ts
git commit -m "feat(mcp): recall with English description + domains_filter validation"
```

---

## Task 4: Translate expand, get_note, link descriptions + errors

**Files:**
- Modify: `src/mcp/tools/expand.ts`
- Modify: `src/mcp/tools/get-note.ts`
- Modify: `src/mcp/tools/link.ts`
- Modify: `test/tools/expand.test.ts`
- Modify: `test/tools/get-note.test.ts`
- Modify: `test/tools/link.test.ts`

- [ ] **Step 1: Update `src/mcp/tools/expand.ts`**

Replace the `DESCRIPTION` constant:

```ts
const DESCRIPTION = `Immediate neighbors (1 hop) of a note in the graph.

FLOW: call recall() first to discover the note_id. Do not call expand with an invented id.

Returns {neighbors: [{note, edge}]} where edge includes relation_type and why.
To navigate deeper, call expand recursively on the returned ids — but think twice before going more than 2 hops, it is usually noise.

IMPORTANT: if recall already surfaces the analogy you need, do not reflexively call expand. Use expand when you want to follow a specific reasoning line through the graph.`;
```

Replace the unknown-note error:

```ts
return toolError(
  `Note '${input.note_id}' not found. Call recall() first to discover the correct id. Do NOT retry with this id.`
);
```

- [ ] **Step 2: Update `src/mcp/tools/get-note.ts`**

```ts
const DESCRIPTION = `Fetch the full content of a note by id (body + tags + edges).

FLOW: call recall() first to discover the id. Do not invent ids.

IMPORTANT: the body can be long — cite the relevant passages in your reply, do not dump the entire content back to the user. If you are not sure which note to pull, prefer recall() + expand() before falling back to get_note.`;
```

Replace the not-found error:

```ts
return toolError(
  `Note '${input.id}' not found. Call recall() to discover the correct id. Do NOT retry with this id.`
);
```

- [ ] **Step 3: Update `src/mcp/tools/link.ts`**

```ts
const DESCRIPTION = `Create an edge between two existing notes.

Use ONLY when both notes already exist and you discover a new connection during the conversation. If you are creating a new concept, do NOT use link — use save_note with edges, it is cheaper.

FLOW: call recall() to confirm the ids of both notes before calling link. Self-loops (from_id == to_id) are rejected.

IMPORTANT: why minimum 20 characters, naming the shared MECHANISM, not just "related". Duplicate edges (same from_id, to_id, relation_type) are silently ignored.`;
```

Replace the four error messages inside the handler:

```ts
if (input.from_id === input.to_id) {
  return toolError(
    `Cannot create an edge from a note to itself. ` +
    `If the goal is to capture internal tension, create a new note refining the concept and link the two with 'refines' or 'contradicts'.`
  );
}
if (input.why.length < 20) {
  return toolError(
    `The why field has only ${input.why.length} characters — minimum is 20. ` +
    `Explain the shared MECHANISM, not just that the notes are related.`
  );
}
// ... inside from/to checks:
if (\!from) {
  return toolError(`Note '${input.from_id}' not found. Call recall() to discover the correct id. Do NOT retry with this id.`);
}
if (\!to) {
  return toolError(`Note '${input.to_id}' not found. Call recall() to discover the correct id. Do NOT retry with this id.`);
}
```

- [ ] **Step 4: Update test assertions pt → en**

In `test/tools/link.test.ts`, replace the self-loop assertion:

```ts
// before
expect(r.content[0].text).toContain('para ela mesma');
// after
expect(r.content[0].text).toContain('itself');
```

In `test/tools/expand.test.ts` and `test/tools/get-note.test.ts` — no Portuguese substring asserts exist (only `'ghost'` literal ids, which stay valid).

- [ ] **Step 5: Run tests**

Run: `npm test -- "expand|get-note|link"`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/expand.ts src/mcp/tools/get-note.ts src/mcp/tools/link.ts \
        test/tools/expand.test.ts test/tools/get-note.test.ts test/tools/link.test.ts
git commit -m "feat(mcp): English tool descriptions + error messages for expand, get_note, link"
```

---

## Task 5: Translate safeToolHandler errors

**Files:**
- Modify: `src/mcp/helpers.ts`
- Modify: `test/helpers.test.ts`

- [ ] **Step 1: Update test assertion**

In `test/helpers.test.ts`, find `expect((r as any).content[0].text).toContain('banco')` and replace with:

```ts
expect((r as any).content[0].text).toContain('vault database');
```

- [ ] **Step 2: Run test, expect fail**

Run: `npm test -- helpers`
Expected: fails.

- [ ] **Step 3: Update `src/mcp/helpers.ts`**

Replace both branches of the catch block:

```ts
if (msg.includes('D1_ERROR') || msg.includes('SQLITE_ERROR')) {
  console.error('MindVault D1 error:', msg);
  return toolError(
    `Internal error in the vault database (D1). Probably transient — wait a few seconds and try again. ` +
    `If it persists, report the timestamp ${new Date().toISOString()} and the attempted action to the maintainer.`
  );
}
console.error('MindVault tool error:', msg);
return toolError(`Unexpected error: ${msg}. Check the input and try again.`);
```

- [ ] **Step 4: Run test, expect pass**

Run: `npm test -- helpers`
Expected: all 3 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/helpers.ts test/helpers.test.ts
git commit -m "feat(mcp): English error messages in safeToolHandler"
```

---

## Task 6: Switch embedding model to bge-m3

**Files:**
- Modify: `src/vector/index.ts`

No new tests — Vectorize and AI are faked in tool tests, fakes already return 1024-dim arrays (updated in Tasks 2 and 3). The real bge-m3 call is exercised in the acceptance test (Task 12).

- [ ] **Step 1: Update `src/vector/index.ts`**

Replace the `embed` function:

```ts
// @cf/baai/bge-m3 returns 1024-dim vectors. Multilingual (100+ languages).
// The Vectorize index must be created with dimensions=1024.
export async function embed(env: Env, text: string): Promise<number[]> {
  const res = await env.AI.run('@cf/baai/bge-m3', { text: [text] }) as {
    data: number[][];
  };
  const v = res.data?.[0];
  if (\!v) throw new Error('embed: empty response from Workers AI');
  return v;
}
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all tests green.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/vector/index.ts
git commit -m "feat(vector): switch embedding model to bge-m3 (1024-dim, multilingual)"
```

---

## Task 7: SKILL.md — add Language policy + Domain naming convention

**Files:**
- Modify: `skills/using-mind-vault/SKILL.md`

- [ ] **Step 1: Insert new sections between "The four disciplines" and "Save workflow"**

Add this content after the end of "The four disciplines" section:

```markdown
## Language policy

The vault is language-agnostic by design. Write `title`, `body`, and `tldr` in whichever language the user is speaking — if the conversation is in Portuguese, save in Portuguese; if in English, save in English; if mixed, pick the dominant one. The embedding model (`bge-m3`) is multilingual and retrieves across languages, so a Portuguese note can surface on an English query and vice versa.

The ONE exception is the `domains` field: always use canonical English kebab-case slugs (e.g. `evolutionary-biology`, `behavioral-economics`, `systems-thinking`), regardless of conversation language. Domains are schema, not content — they need to be stable identifiers that do not drift with the speaker.

## Domain naming convention

Every entry in `domains[]` must match `^[a-z][a-z0-9-]{1,39}$` — lowercase ASCII, 2-40 characters, kebab-case. No accented characters, no spaces, no uppercase, no underscores, no translations.

Good examples, across fields:
- Biology: `evolutionary-biology`, `molecular-genetics`, `ecology`
- Economics: `behavioral-economics`, `game-theory`, `public-finance`
- Engineering: `software-engineering`, `distributed-systems`, `embedded-systems`
- Philosophy: `philosophy-of-mind`, `epistemology`, `virtue-ethics`
- History: `military-history`, `economic-history`, `history-of-science`
- Systems thinking: `systems-thinking`, `feedback-loops`, `complexity`

Bad examples that will be rejected: `Evolutionary-Biology` (uppercase), `biologia-evolutiva` (Portuguese), `evolutionary biology` (space), `evolutionary_biology` (underscore), `1biology` (leading digit).
```

- [ ] **Step 2: Verify frontmatter intact**

Run: `head -5 skills/using-mind-vault/SKILL.md`
Expected: `---\nname: using-mind-vault\ndescription: ...\n---`.

- [ ] **Step 3: Commit**

```bash
git add skills/using-mind-vault/SKILL.md
git commit -m "docs(skill): language policy + domain naming convention"
```

---

## Task 8: Translate wizard.ts (wizard + landing HTML)

**Files:**
- Modify: `src/static/wizard.ts`

No tests — HTML strings are not under test. Visual verification in Task 11.

- [ ] **Step 1: `PREFS_BLOCK` is already English — verify**

Run: `grep -c "Mind Vault is connected" src/static/wizard.ts`
Expected: `1` (no change needed).

- [ ] **Step 2: Update `FOOTER_HTML`**

Replace the existing constant:

```ts
const FOOTER_HTML = `
<div class="card footer">
  Made by Robson Lins &nbsp;·&nbsp;
  <a href="https://www.instagram.com/orobsonn" target="_blank">Instagram</a> &nbsp;·&nbsp;
  <a href="https://x.com/orobsonnn" target="_blank">X / Twitter</a> &nbsp;·&nbsp;
  <a href="https://youtube.com/@orobsonnn" target="_blank">YouTube</a>
</div>`;
```

- [ ] **Step 3: Replace `renderWizard()` with English version**

Full replacement:

```ts
export function renderWizard(): string {
  return `<\!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mind Vault — Setup</title>
  <style>${BASE_CSS}</style>
</head>
<body>
<main>
  <h1>Mind Vault</h1>
  <p>Set up your personal knowledge graph in 5 steps.</p>

  <div class="card">
    <h2>1. Credentials</h2>
    <p>Set the email and passphrase you will use to authorize Claude to access the vault.</p>
    <form method="post" action="/setup/credentials">
      <p><label>Email<br><input type="email" name="email" required placeholder="you@example.com"></label></p>
      <p><label>Passphrase<br><input type="password" name="password" required placeholder="long memorable phrase"></label></p>
      <p><label>Confirm passphrase<br><input type="password" name="password_confirm" required placeholder="repeat the passphrase"></label></p>
      <button type="submit">Save credentials</button>
    </form>
  </div>

  <div class="card">
    <h2>2. Provisioning</h2>
    <p>Applies the Mind Vault schema to your D1 database (tables <code>notes</code>, <code>edges</code>, <code>tags</code>, FTS5 and triggers). Idempotent — safe to click multiple times.</p>
    <p style="color:#a7adb5;font-size:13px">The Vectorize index <code>mind-vault-embeddings</code> and the KV namespace <code>OAUTH_KV</code> are provisioned separately, before the first <code>wrangler deploy</code>, via CLI: <code>wrangler vectorize create mind-vault-embeddings --dimensions=1024 --metric=cosine</code> and <code>wrangler kv namespace create OAUTH_KV</code>. If you deployed via the "Deploy to Cloudflare" button in the README, Cloudflare already created everything from the <code>wrangler.toml</code> bindings.</p>
    <button id="btn-provision" onclick="provision(this)">Provision database</button>
    <p id="provision-status" style="display:none;color:#4caf50">Schema applied successfully\!</p>
    <script>
      async function provision(btn) {
        btn.disabled = true;
        const r = await fetch('/setup/provision', { method: 'POST' });
        const j = await r.json();
        if (j.ok) {
          document.getElementById('provision-status').style.display = '';
          btn.textContent = 'Provisioned ✓';
        } else {
          btn.disabled = false;
          alert('Provisioning error: ' + JSON.stringify(j));
        }
      }
    <\/script>
  </div>

  <div class="card">
    <h2>3. Connect to Claude</h2>
    <p>MCP server URL:</p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <code id="mcp-url" style="flex:1;min-width:280px">/mcp</code>
      <button type="button" onclick="copyMcpUrl(this)">Copy URL</button>
    </div>
    <div class="tabs" style="margin-top:16px">
      <div class="tab active" onclick="showTab(this,'code')">Claude Code</div>
      <div class="tab" onclick="showTab(this,'ui')">Claude Desktop / Web</div>
    </div>
    <div id="tab-code">
      <p>Run in the terminal (the command already includes this Worker URL):</p>
      <pre id="code-add">claude mcp add --transport http mind-vault &lt;URL&gt;</pre>
      <button type="button" onclick="copyCodeCmd(this)">Copy command</button>
    </div>
    <div id="tab-ui" style="display:none">
      <p>Claude Desktop and Claude Web use the same flow — both plug in a remote MCP via the Connectors UI:</p>
      <ol>
        <li>Open <strong>Claude Desktop</strong> or <a href="https://claude.ai" target="_blank">claude.ai</a>.</li>
        <li>Go to <strong>Settings → Connectors</strong> (older versions: <em>Integrations</em>).</li>
        <li>Click <strong>Add custom connector</strong> (or <em>Add MCP server</em>).</li>
        <li>Paste the URL above into the <em>URL</em> field and give it a name (e.g. <code>mind-vault</code>).</li>
        <li>Claude will open an OAuth window — log in with the email + passphrase you set in step 1.</li>
      </ol>
      <p style="color:#a7adb5;font-size:13px">Note: Claude automatically detects that this is an MCP server with OAuth 2.1 + dynamic client registration, so the only piece of data you need to paste is the URL.</p>
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
        btn.textContent = 'Copied ✓';
        setTimeout(() => { btn.textContent = original; }, 1500);
      }
    <\/script>
  </div>

  <div class="card">
    <h2>4. Install the Skill</h2>
    <p>Download the skill ZIP and install it in Claude:</p>
    <p><a href="/skill/using-mind-vault.zip" download>⬇ using-mind-vault.zip</a></p>
    <p><strong>Claude Code:</strong> extract to <code>~/.claude/skills/</code></p>
    <p><strong>Claude Desktop / Web:</strong> Settings → Skills → Import and select the ZIP file.</p>
  </div>

  <div class="card">
    <h2>5. Personalize Claude</h2>
    <p>Paste the block below into Settings → Personalization → Custom instructions:</p>
    <pre id="prefs">${PREFS_BLOCK}</pre>
    <button onclick="copyPrefs()">Copy</button>
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
```

- [ ] **Step 4: Replace `renderLanding()` with English version**

```ts
export function renderLanding(stats: LandingStats): string {
  const lastWriteStr = stats.lastWrite
    ? new Date(stats.lastWrite).toLocaleString('en-US')
    : 'Never';

  const badge = stats.connected
    ? `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#14351f;color:#6fe39a;font-size:12px;font-weight:600;border:1px solid #1f5a33">● Claude connected</span>`
    : `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#2a2017;color:#ffb870;font-size:12px;font-weight:600;border:1px solid #5a3a1f">○ Waiting for Claude connection</span>`;

  return `<\!doctype html>
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
      if (\!el) return;
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
      if (\!r.ok) return;
      const j = await r.json();
      if (\!j.configured) return;
      const wasConnected = ${stats.connected ? 'true' : 'false'};
      if (j.connected \!== wasConnected) {
        location.reload();
      }
    } catch (_) {}
  }
  setInterval(refreshStatus, 15000);
<\/script>
</body>
</html>`;
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add src/static/wizard.ts
git commit -m "i18n(ui): translate wizard and landing HTML to English"
```

---

## Task 9: Translate credentials + login + error pages

**Files:**
- Modify: `src/auth/handler.ts`

- [ ] **Step 1: Update validation messages at the top of `handleCredentials`**

```ts
if (\!email || \!password) return renderCredentialsError('Email and passphrase are required.');
if (password.length < 12) return renderCredentialsError('Passphrase must be at least 12 characters.');
if (password \!== password2) return renderCredentialsError('Confirmation does not match the passphrase.');
```

- [ ] **Step 2: Replace `handleCredentials` response HTML**

```ts
  return new Response(
    `<\!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mind Vault — Credentials</title><style>${BASE_CSS}</style></head>
<body><main>
  <h1>Credentials generated</h1>
  <p>Paste the values below into the Worker secrets. Since the Worker cannot write secrets to itself, this step is manual — run the commands in your terminal one at a time and paste the value when wrangler prompts for it.</p>

  <div class="card">
    <h2>1. Email</h2>
    <p>Command: <code>${esc(emailCmd)}</code></p>
    <p>Value:</p>
    <pre id="email-value">${esc(email)}</pre>
    <button type="button" data-copy="email-value">Copy email</button>
  </div>

  <div class="card">
    <h2>2. Passphrase hash (PBKDF2-SHA256, 100k iter)</h2>
    <p>Command: <code>${esc(hashCmd)}</code></p>
    <p>Value:</p>
    <pre id="hash-value">${esc(hash)}</pre>
    <button type="button" data-copy="hash-value">Copy hash</button>
  </div>

  <div class="card">
    <h2>3. Redeploy</h2>
    <p>After running both <code>wrangler secret put</code> commands, run <code>wrangler deploy</code> once so the Worker picks up the new secrets. The next visit to the home page will show the vault status instead of this wizard, and <code>/authorize</code> will render the login screen instead of "Vault not configured".</p>
  </div>

  <p><a href="/">← Back to wizard</a></p>

  <script>
    async function copyText(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      document.body.removeChild(ta);
      return ok;
    }
    document.querySelectorAll('button[data-copy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-copy');
        const el = document.getElementById(id);
        if (\!el) return;
        const text = (el.textContent || '').trim();
        const ok = await copyText(text);
        const original = btn.textContent;
        btn.textContent = ok ? 'Copied ✓' : 'Select the text and Ctrl+C';
        btn.style.background = ok ? '#4caf50' : '#ff9800';
        setTimeout(() => {
          btn.textContent = original;
          btn.style.background = '';
        }, 1800);
      });
    });
  <\/script>
</main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
```

- [ ] **Step 3: Replace `renderCredentialsError`**

```ts
function renderCredentialsError(msg: string): Response {
  return new Response(
    `<\!doctype html><html lang="en"><head><meta charset="utf-8"><title>Error</title><style>${BASE_CSS}</style></head>
<body><main><h1>Error</h1><p style="color:#ff6b6b">${esc(msg)}</p><p><a href="/">← Back</a></p></main></body></html>`,
    { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
```

- [ ] **Step 4: Replace `renderLogin`**

```ts
function renderLogin(error: string | null, qs: string): Response {
  return new Response(
    `<\!doctype html><html lang="en"><head><meta charset="utf-8"><title>Login</title><style>${BASE_CSS}</style></head>
<body><main><h1>Mind Vault</h1><p>Log in to authorize MCP access.</p>
${error ? `<p style="color:#ff6b6b">${esc(error)}</p>` : ''}
<form method="post" action="/authorize${esc(qs)}">
<p><label>Email<br><input type="email" name="email" required></label></p>
<p><label>Passphrase<br><input type="password" name="password" required></label></p>
<button type="submit">Authorize</button></form></main></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}
```

- [ ] **Step 5: Update login error string in the `/authorize` POST handler**

```ts
if (email \!== env.OWNER_EMAIL) return renderLogin('Invalid credentials.', url.search);
const ok = await verifyPassword(password, env.OWNER_PASSWORD_HASH\!);
if (\!ok) return renderLogin('Invalid credentials.', url.search);
```

The `'Vault not configured'` 503 response is already English — no change.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/auth/handler.ts
git commit -m "i18n(ui): translate credentials/login/error pages to English"
```

---

## Task 10: Full test suite + typecheck (safety net)

Before touching production, make sure nothing regressed.

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests across both pools (workers + node) green. Count ≥ 27 (original 24 + 11 new validation + ~2 new recall domain cases).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Build skill ZIP and verify SKILL.md updates are included**

Run: `npm run build:skill`
Expected: `Wrote assets/using-mind-vault.zip`.

Run: `unzip -p assets/using-mind-vault.zip SKILL.md | grep -c "Language policy"`
Expected: `1`.

---

## Task 11: Release — wipe data, recreate Vectorize, deploy

One-shot release procedure, not TDD-able. Each sub-step is an irreversible operation against production.

**Pre-conditions:** all local checks green (Task 10 done). No uncommitted changes.

- [ ] **Step 1: Wipe D1 data (schema stays)**

```bash
npx wrangler d1 execute mind-vault --remote --command "DELETE FROM edges"
npx wrangler d1 execute mind-vault --remote --command "DELETE FROM tags"
npx wrangler d1 execute mind-vault --remote --command "DELETE FROM notes"
```

Each should report a successful `rows_written: N`.

- [ ] **Step 2: Verify D1 is empty**

```bash
npx wrangler d1 execute mind-vault --remote --command "SELECT count(*) FROM notes"
```

Expected: `count(*) = 0`.

- [ ] **Step 3: Delete the old Vectorize index**

```bash
npx wrangler vectorize delete mind-vault-embeddings
```

Confirm when prompted. Expected: `Successfully deleted`.

**This is the point of no return for the old 768-dim index.**

- [ ] **Step 4: Create new Vectorize index with 1024-dim**

```bash
npx wrangler vectorize create mind-vault-embeddings --dimensions=1024 --metric=cosine
```

Expected: `Successfully created a new Vectorize index: mind-vault-embeddings`.

- [ ] **Step 5: Deploy**

```bash
npx wrangler deploy
```

Expected: success. Output lists bindings including `VECTORIZE: mind-vault-embeddings` and `AI: AI`.

- [ ] **Step 6: Smoke test — home page**

```bash
curl -sS -o /tmp/mv-home.html -w "status=%{http_code}\n" https://mind-vault.roblinscorjunior01.workers.dev/
```

Expected: `status=200`. Grep body:

```bash
grep -c "Vault Status" /tmp/mv-home.html
```

Expected: `1` (confirms English content is live).

- [ ] **Step 7: Smoke test — `/status`**

```bash
curl -sS https://mind-vault.roblinscorjunior01.workers.dev/status
```

Expected JSON: `{"configured":true,"notes":0,"edges":0,"lastWrite":null,"clients":N,"tokens":M,"connected":...}` with `notes:0, edges:0` mandatory.

- [ ] **Step 8: Smoke test — `/mcp` still protected**

```bash
curl -sS -o /dev/null -w "mcp=%{http_code}\n" https://mind-vault.roblinscorjunior01.workers.dev/mcp
```

Expected: `mcp=401`.

---

## Task 12: Human-in-the-loop acceptance test (via Claude Web)

The decisive test that validates the architectural decision. Robson runs this via Claude Web, not an automated subagent.

- [ ] **Step 1: Open a new conversation in Claude Web with Mind Vault connector active**

- [ ] **Step 2: Paste this prompt (in Portuguese, intentionally):**

```
Salva essa ideia no vault:

"Dívida técnica se comporta como juros compostos — cada dia que você posterga refatoração, o custo de mudança futura cresce multiplicativamente, não linearmente."

Antes de salvar, chama MindVault:recall com query "compounding feedback loop" (em inglês) pra verificar se tem algo parecido. Eu quero ver se o vault encontra notas independente do idioma.

Depois de salvar, me mostra o id retornado.
```

- [ ] **Step 3: Expected Claude behavior**

- Calls `MindVault:recall({query: "compounding feedback loop"})` → returns `{results: []}` (empty vault).
- Calls `MindVault:save_note` with pt-BR `title/body/tldr` and `domains` like `["software-engineering", "financial-mathematics"]` (English slugs).
- Returns a note id.

- [ ] **Step 4: Verify server-side**

```bash
npx wrangler d1 execute mind-vault --remote --command "SELECT id, title, tldr, domains FROM notes"
```

Expected: one row with Portuguese `title/tldr` and English-canonical `domains`.

- [ ] **Step 5: Cross-lingual query — paste this prompt (in English):**

```
Now use MindVault:recall with query "compounding debt systems" and show me the results. I expect it to find the Portuguese note I just saved — this is the cross-lingual test.
```

- [ ] **Step 6: Expected Claude behavior**

- Calls `MindVault:recall({query: "compounding debt systems"})`.
- Returns results containing the previously saved Portuguese note.
- **If the note appears in the results, the bge-m3 cross-lingual migration is validated.** This is the decisive check.

If the note does NOT appear, diagnose:
- Vector generated? Check `/status` — `notes:1`.
- Vector stored? `npx wrangler vectorize info mind-vault-embeddings` should show `count: 1`.
- If stored but not retrieved, cross-lingual is weaker than expected. Document in a project memory; not a regression of the migration itself, just calibration data.

- [ ] **Step 7: Domain enforcement — paste this prompt:**

```
Salva essa ideia, mas eu quero ver o erro: use o domain "biologia-evolutiva" de propósito (não traduza).

"Hipótese da Rainha Vermelha: em coevolução, melhorar continuamente é o preço de entrada para permanecer no mesmo lugar relativo."
```

- [ ] **Step 8: Expected Claude behavior**

- Attempts `MindVault:save_note` with `domains: ["biologia-evolutiva"]`.
- Server returns `toolError` with the pedagogical message ("Domain 'biologia-evolutiva' is not a valid canonical slug... use 'evolutionary-biology' instead").
- Claude retries with `domains: ["evolutionary-biology"]` without being prompted — because the error told it exactly what to do.
- Second call succeeds.

- [ ] **Step 9: Final verification**

```bash
npx wrangler d1 execute mind-vault --remote --command "SELECT count(*) FROM notes"
```

Expected: `count(*) = 2`.

```bash
npx wrangler d1 execute mind-vault --remote --command "SELECT domains FROM notes"
```

Expected: both rows show English-canonical slugs only — no `biologia-evolutiva` slipped through.

- [ ] **Step 10: Success — migration validated in production**

If step 6 (cross-lingual recall) failed, that is data worth capturing but not a rollback trigger. The migration itself worked; it just means bge-m3 cross-lingual is weaker than hoped. Note in a project memory for future evolution.

---

## Deferred / out of scope

All of these were explicitly listed in spec §7 and remain out of scope:

- Domain taxonomy suggestion tool
- Domain aliasing table
- FTS5 stemming upgrade
- Per-tenant model configuration
- Data migration tooling (not needed — wiped as test data)
