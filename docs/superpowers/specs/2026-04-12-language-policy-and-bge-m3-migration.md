# Mind Vault — Language Policy + bge-m3 Migration

**Date:** 2026-04-12
**Status:** approved design, ready for planning
**Author:** Robson + Claude (brainstorm colaborativo)
**Supersedes:** nothing. Amends the original Mind Vault design (`2026-04-12-mind-vault-design.md`) in three specific areas.

---

## 1. Context

The initial Mind Vault MVP shipped with `@cf/baai/bge-base-en-v1.5` (768-dim, English-primary) as the embedding model and a mixed pt-BR / en codebase (tool descriptions, wizard UI, error messages all in Portuguese).

During the first end-to-end acceptance test, the Claude running on Claude Web successfully executed the full flow (save → link → expand → recall) and surfaced a real architectural gap:

> "FTS search is sensitive to the content language. English queries did not find notes written in Portuguese and vice-versa in the first attempts."

Root causes identified:

1. **Embedding model is English-primary.** Vectors derived from Portuguese text have degraded quality and the vector space does not align with English queries. The cross-domain analogy promise — which is the core value proposition of the vault — breaks down whenever language crosses.
2. **FTS5 `unicode61` tokenizer** has no stemming and no cross-language bridging. It helps at the word-token level but cannot resolve "feedback loop" ↔ "loop de retroalimentação".

Additionally, the repo is open-source, intended for any global user to deploy their own instance. Shipping a mixed pt-BR / en codebase is a discoverability and usability tax: a Spanish-speaking developer who clones the repo sees Portuguese tool descriptions and gets confused. The README is English; everything shipped should match.

## 2. Decisions

Three architectural decisions resolve the gap above.

### 2.1. Embedding model: `bge-m3`

Replace `@cf/baai/bge-base-en-v1.5` with `@cf/baai/bge-m3`. Dimensions change **768 → 1024**.

`bge-m3` is a state-of-the-art multilingual retrieval model trained on 100+ languages with a shared semantic space. Portuguese and English embeddings fall in the same space, so cross-lingual recall works "through the back door" without needing explicit translation, dual embeddings, or a normalization pipeline.

This is option **(B)** from the brainstorm (multi-lingual neutral), not option **(A)** (cross-lingual as hard guarantee). The difference: we don't *promise* perfect cross-lingual recall; we get ~80% of it for free as a side effect of using a multilingual model. If daily use reveals it's insufficient at scale, we evolve to (A) later with data-driven justification. No over-engineering.

Trade-off acknowledged: bge-m3 is larger and marginally slower than bge-base-en. For a single-user vault the cost is negligible.

### 2.2. Domain field is canonical English, enforced server-side

The `domains` field on notes is **schema, not content**. It's used as:
- A filter key in `recall({domains_filter: [...]})`
- A grouping key in the domain-balance recall logic (top 3 per domain, up to 5 distinct domains)

Neither usage benefits from embedding similarity — they both require exact string equality. If Claude writes `["evolutionary-biology"]` in an English conversation and `["biologia-evolutiva"]` in a Portuguese conversation, the system sees four distinct domains where a human sees two. The domain taxonomy fragments silently.

**Decision:** `domains[]` entries must match the regex `/^[a-z][a-z0-9-]{1,39}$/` — lowercase ASCII kebab-case, 2–40 characters. This is enforced at the tool handler level (not just zod validation) so the error message can be pedagogical, following spec §7.5 ("errors as instructions").

**Validation scope:**
- `save_note.edges[i].to_id` is NOT affected (it's a note id, not a domain).
- `save_note.domains[]` is validated.
- `recall.domains_filter[]` is validated with the same regex.

**Error message (literal text Claude will receive on violation):**

```
Domain '<offender>' is not a valid canonical slug. Use English kebab-case lowercase (e.g. 'evolutionary-biology', 'behavioral-economics', 'systems-thinking', 'competitive-strategy', 'game-theory'). Domains are vault schema — they need to be stable identifiers that do not drift between conversation languages. Do NOT use accented characters, spaces, uppercase, or translations to other languages. If the conversation is in Portuguese and you were going to use 'biologia-evolutiva', use 'evolutionary-biology' instead.
```

This is the "say what happened, say what to do, say what not to do" pattern applied to the single error Claude is most likely to trigger once.

### 2.3. Language policy: write content in conversation language, everything else in English

**Content fields (`title`, `body`, `tldr`):** Claude writes in whichever language the conversation is in. Portuguese conversation → Portuguese note. English conversation → English note. Mixed conversation → dominant language. This is "language-agnostic" as a first principle — the vault adapts to the user, not the other way around.

**Everything else is English, always:**

| Thing | Language | Rationale |
|---|---|---|
| `domains[]` | en (enforced) | Schema; see §2.2 |
| Tool descriptions (`save_note`, `recall`, `expand`, `get_note`, `link`) | en | Claude-facing; Claude reads any language |
| Tool error messages | en | Claude-facing |
| `safeToolHandler` internal errors | en | Claude-facing |
| `SERVER_INSTRUCTIONS` | en (already) | MCP-client-facing |
| `SKILL.md` + `reference/edge-types.md` + `reference/examples.md` | en (already) | Shipped in skill ZIP, loaded by Claude |
| `PREFS_BLOCK` (personalization block) | en (already) | User copies it into Claude Custom Instructions; Claude reads it |
| `README.md` | en (already) | GitHub landing page |
| Wizard HTML (`src/static/wizard.ts`) | en (translate from pt) | Public-facing UI; open-source deploy target is global |
| Credentials page (`src/auth/handler.ts` `handleCredentials`) | en (translate) | Public-facing UI |
| Login page (`renderLogin`) | en (translate) | Public-facing UI |
| Error pages | en (translate) | Public-facing UI |
| Wizard footer "Feito por Robson Lins" | en ("Made by Robson Lins") | Public-facing |

**Design principle:** everything a human sees through a browser is English. Everything Claude sees programmatically is English. The ONLY place language varies is the `title/body/tldr` of individual notes, which adapts to the conversation. This is a clean fronteira.

**Explicitly rejected alternatives** (so the decision is traceable):

- **Language toggle (EN / PT / ES switcher in the UI).** Rejected after costing it at ~4h incremental (i18n module, cookie-based lang detection, template refactor to `t()` helper, POST `/lang/set`, 3× string authoring, smoke tests). Decided the simplicity of "English-only UI" wins for a global open-source repo where each deployer sees the UI once during setup and then interacts via Claude (which is language-aware).
- **Canonical language for content (pt always or en always).** Rejected because it forces the user to write in a language they don't think in, and the embedding model is good enough that we don't need it.

### 2.4. SKILL.md additions

Two new sections added to `skills/using-mind-vault/SKILL.md`:

**Language policy** — explains the rule ("write content in conversation language, domains in English, embedding is multilingual") with one sentence per part. Target length: 80–120 words.

**Domain naming convention** — specifies the regex constraint, gives 6 valid examples across different fields (biology, economics, engineering, philosophy, history, systems thinking), and explicitly warns against translating domain slugs even when the conversation is in another language. Target length: 60–100 words.

Both sections go under "The four disciplines" (or after it) since they're policy rules, not tools.

## 3. Non-goals

- **Cross-lingual embedding as a hard guarantee.** We ship (B) not (A).
- **Explicit translation pipeline** on save (run the body through an LLM to get an EN version).
- **Dual embeddings** per note (one en, one pt).
- **UI language toggle** in the wizard/landing.
- **Normalization of existing domains** in a data migration. No existing data worth migrating — see §4.
- **Stemming or language-specific FTS5 tokenizer.** `unicode61` stays. The embedding model does the heavy lifting; FTS5 is the secondary recall channel and degrading it further is not on the critical path. If FTS recall quality becomes a problem, that's a future change.

## 4. Migration

The user has confirmed the current vault state is test data only. This simplifies the migration to "wipe and start fresh":

1. **Wipe D1 tables** — `DELETE FROM edges; DELETE FROM tags; DELETE FROM notes;` via `wrangler d1 execute mind-vault --remote`. The 2 test notes and 1 test edge are gone. Schema stays.
2. **Destroy the old Vectorize index** — `wrangler vectorize delete mind-vault-embeddings`.
3. **Create the new index** — `wrangler vectorize create mind-vault-embeddings --dimensions=1024 --metric=cosine`. Same name, new dimension. No `wrangler.toml` edit needed.
4. **Apply all code changes in a single commit** (see §5 for file list).
5. **Local verification** — `npm run typecheck && npm test`. All tests green.
6. **Deploy** — `wrangler deploy`.
7. **Smoke test via HTTP:** `GET /status` returns `notes:0, edges:0, connected:true` (still connected — tokens in OAUTH_KV survive).

No re-embedding script. No backup JSON. No rollback plan for data loss because there is no data to lose.

**Rollback plan for code:** if `@cf/baai/bge-m3` misbehaves (different response shape, latency unacceptable, availability problem), `git revert` the commit, recreate Vectorize with dim 768, redeploy. Because we wiped data first, rollback is symmetric to the forward path — nothing to restore.

## 5. Scope — files touched

**Modify:**

- `src/vector/index.ts` — model name `@cf/baai/bge-base-en-v1.5` → `@cf/baai/bge-m3`. Test the response shape; if `data[0]` format differs, adjust the narrowing.
- `src/mcp/tools/save-note.ts` — full tool description translated to en; add "IMPORTANT: domains are canonical english slugs, never translated" line; add `domains` validation block before any insert (regex check, pedagogical error via `toolError`).
- `src/mcp/tools/recall.ts` — full tool description translated to en; add "Query in any language — the embedding model is multilingual" note; add same `domains_filter` validation.
- `src/mcp/tools/expand.ts` — tool description translated to en.
- `src/mcp/tools/get-note.ts` — tool description translated to en.
- `src/mcp/tools/link.ts` — tool description translated to en.
- `src/mcp/helpers.ts` — `safeToolHandler` D1 error message translated to en; generic fallback message translated to en.
- `src/static/wizard.ts` — wizard HTML and landing HTML fully translated to en. Footer "Feito por Robson Lins" → "Made by Robson Lins". All card titles, body copy, form placeholders, button labels, aria-equivalent text.
- `src/auth/handler.ts` — `handleCredentials`, `handleCredentialsError`, `renderLogin` fully translated to en.
- `skills/using-mind-vault/SKILL.md` — append "Language policy" and "Domain naming convention" sections. Existing English content stays.
- `wrangler.toml` — no change (binding is by name, dimension is on the index itself).
- Tests where Portuguese strings are asserted on error messages:
  - `test/tools/save-note.test.ts` — update `expect(...).toContain('20 caracteres')` → `'20 characters'`, etc.
  - `test/tools/link.test.ts` — update `expect(...).toContain('para ela mesma')` → `'itself'`.
  - `test/tools/get-note.test.ts`, `test/tools/expand.test.ts` — update any pt error substring asserts.
  - Add new test in `save-note.test.ts` for domain validation: rejects `["biologia-evolutiva"]`, accepts `["evolutionary-biology"]`, rejects `["Evolutionary-Biology"]` (uppercase), rejects `["evolutionary biology"]` (space).
  - Add corresponding test in `recall.test.ts` for `domains_filter` validation.

**Create:** nothing new.

**Delete:** nothing.

## 6. Success criteria

After the migration, the following must all be true:

1. `GET /` renders the landing page in English.
2. `GET /status` returns `notes: 0, connected: true`.
3. `npm test` passes 25+ tests (existing coverage + new domain validation tests).
4. `npm run typecheck` exits 0.
5. Via Claude Web, a new conversation saying "salva essa ideia sobre feedback loop" (in Portuguese) triggers `save_note` with a Portuguese `title`/`body`/`tldr` AND English-canonical `domains[]`. Verifiable via `wrangler d1 execute ... "SELECT title, domains FROM notes"`.
6. Via Claude Web, a subsequent query "recall about compounding systems" (in English) finds the Portuguese note from step 5. This is the decisive validation of bge-m3 cross-lingual retrieval.
7. A Claude attempt to save a note with `domains: ["biologia-evolutiva"]` is rejected with the pedagogical error message, and a retry with `["evolutionary-biology"]` succeeds.

Steps 5–7 are human-in-the-loop acceptance tests via Claude Web after the automated suite passes.

## 7. Deferred / out of scope

- **Domain taxonomy suggestion tool.** A future `suggest_domains(title, body)` tool that proposes canonical slugs based on a seed corpus. Out of scope for this change; relevant when the vault has enough notes to train against.
- **Domain aliasing.** Table like `domain_aliases(canonical TEXT, alias TEXT)` letting the user group equivalent slugs after the fact. Not needed at current scale; revisit if the taxonomy fragments despite enforcement.
- **FTS5 stemming.** Upgrading from `unicode61` to a stemming tokenizer is deferred. Embedding is the primary recall path; FTS is the fallback. Not worth the complexity yet.
- **Per-tenant configuration of the embedding model.** Not needed — single-user vault, one model.
- **Migration tooling for pre-existing data.** Specifically excluded; user confirmed no real data at stake.

---

**Next step:** human review of this spec by Robson. After approval, enter `writing-plans` to produce an incremental implementation plan covering the file list in §5 in TDD order.
