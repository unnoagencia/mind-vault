# Mind Vault — a personal knowledge graph for Claude, built on Cloudflare

**The latticework thinking tool for people who talk to Claude.** Mind Vault is a single-user, self-hosted knowledge graph that runs entirely in your own Cloudflare account and plugs into Claude Code, Claude Desktop, or Claude Web as an MCP server. You talk to Claude about ideas, Claude decides what is worth keeping, atomizes the concept, sweeps the vault for cross-domain analogies, and saves the note with edges that name the shared *mechanism* — not just "related".

**Not a notes app. A thinking tool.**

- ✅ **Concepts, not pages.** Every note is one idea, titled in one line, summarized in one sentence (Feynman test).
- ✅ **Edges with substance.** 9 typed relations (`analogous_to`, `same_mechanism_as`, `contradicts`, `refines`, …) each requiring a 20-character minimum *why* — the mechanism behind the connection.
- ✅ **Cross-domain by design.** Recall is domain-balanced — the vault surfaces the unexpected match from another field, because that's where insight lives.
- ✅ **Multilingual.** Write in Portuguese, English, or whatever the conversation is in. The embedding model (`bge-m3`) retrieves across 100+ languages.
- ✅ **Sovereign.** Everything lives in your Cloudflare account — D1 (SQLite), Vectorize (embeddings), Workers AI. No third party, no lock-in, no subscription.
- ✅ **OAuth 2.1 + dynamic client registration.** Claude Desktop and Claude Web plug in with just the URL; no token juggling.

## Who is this for?

- **Developers who live in Claude Code** and want their learnings to compound across sessions instead of evaporating at the end of each conversation.
- **Anyone looking for a "Claude-native" alternative to Obsidian or Notion** for idea capture — specifically the cross-domain, analogy-driven style from Charlie Munger's latticework of mental models or Luhmann's Zettelkasten.
- **Writers, researchers, thinkers** who read across fields and want a second brain that *forces* them to look for the structural overlap instead of burying notes in folders.

Mind Vault is **not** a replacement for a daily-capture notes app. It is for the subset of your thinking worth preserving with rigor — the ideas you want to find again, in a different context, years later.

## Quickstart — deploy to your own Cloudflare in ~5 minutes

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/orobsonn/mind-vault)

1. Click the button above. Cloudflare forks this repo into your GitHub account and provisions a D1 database + Vectorize index + KV namespace from the `wrangler.toml` bindings automatically.
2. After the deploy completes, open the Worker URL. The first visit runs a **5-step setup wizard**:
   1. **Credentials** — set an email + passphrase. The Worker hashes the passphrase with PBKDF2-SHA256 (100k iter, Workers-native WebCrypto, no WASM) and shows you the exact `wrangler secret put` commands to run — since the Worker cannot write its own secrets, this step is manual but guided.
   2. **Provisioning** — one click runs the D1 schema migration (notes, edges, tags, FTS5 + triggers). Idempotent.
   3. **Connect to Claude** — the wizard shows your MCP URL and copy-pasteable commands for Claude Code, plus a 5-step guide for Claude Desktop / Claude Web via Settings → Connectors → Add custom connector.
   4. **Install the skill** — download `using-mind-vault.zip` (the method guide that Claude loads to understand the latticework workflow). Works with Claude Code (`~/.claude/skills/`), Claude Desktop, and Claude Web.
   5. **Personalize Claude** — copy a block into your Claude Custom Instructions to activate the latticework behavior proactively in every conversation.
3. Redeploy once with `wrangler deploy` after setting the two secrets so the Worker picks them up.
4. Start talking to Claude. The first time you share an idea, Claude will offer to save it, atomize it, sweep the vault for analogies, and persist with edges — all in a single MCP call.

## Architecture

A single Cloudflare Worker serves three responsibilities on the same URL:

| Path | Function |
|---|---|
| `/` | Landing + setup wizard (first visit detects missing secrets and shows the wizard; after setup it shows vault status with connection badge + copy-pasteable MCP URL + skill download + personalization prompt) |
| `/authorize`, `/token`, `/register` | OAuth 2.1 via `@cloudflare/workers-oauth-provider` with dynamic client registration |
| `/mcp` | MCP endpoint protected by OAuth, served by `McpAgent` (`agents/mcp`) wrapping `McpServer` from `@modelcontextprotocol/sdk` |
| `/skill/using-mind-vault.zip` | The skill ZIP served as a static asset |
| `/status` | JSON vault status (notes, edges, OAuth clients, active tokens, connection state) |

**Bindings (all in `wrangler.toml`):**
- `DB` — D1 (SQLite) for notes, edges, tags, FTS5
- `VECTORIZE` — 1024-dim cosine index, one vector per note
- `AI` — Workers AI, model `@cf/baai/bge-m3` for multilingual embeddings
- `OAUTH_KV` — KV namespace for OAuth grants/tokens/client registrations
- `ASSETS` — static assets (skill ZIP)

**Schema (5 tables):**
- `notes(id, title, body, tldr, domains JSON, kind, created_at, updated_at)`
- `notes_fts` (virtual FTS5 on title + tldr + body, auto-synced via triggers)
- `tags(note_id, tag)` (escape hatch; real structure lives in edges)
- `edges(id, from_id, to_id, relation_type, why, created_at)` with `CHECK` enum of 9 relation types and `UNIQUE(from_id, to_id, relation_type)`
- `meta(key, value)` for singleton metadata

## MCP tools (what Claude calls)

| Tool | Purpose |
|---|---|
| `save_note` | Atomic note + edges in a single call. Validates edge `why` ≥ 20 chars, domain slugs against regex, edge target existence. |
| `recall` | Hybrid search: Workers AI embedding query + FTS5, merged and **domain-balanced** (max 3 per domain, up to 5 distinct domains). Returns only `{id, title, domain, kind, tldr}` — never the body. |
| `expand` | 1-hop neighbors of a note in the graph. |
| `get_note` | Full body + tags + edges of one note by id. |
| `link` | Create an edge between two existing notes (for when Claude spots a connection between prior saves mid-conversation). |

Tool descriptions are written in English with mandatory-flow instructions ("call `recall` first before `save_note`") and pedagogical error messages ("if the conversation is in Portuguese and you were going to use `biologia-evolutiva`, use `evolutionary-biology` instead") that teach Claude how to recover from mistakes in one shot.

## Method & intellectual lineage

This is not a clean-room design. Each decision has roots in a tradition:

- **Charlie Munger** — latticework of mental models, the value of cross-domain thinking. North star.
- **Scott E. Page**, *The Model Thinker* — diversity prediction theorem (diversity of models beats depth of one). Foundation for **domain-balanced recall**.
- **Douglas Hofstadter & Emmanuel Sander**, *Surfaces and Analogies* — analogy as the core of cognition. Foundation for the weight of `analogous_to` and `same_mechanism_as` edges.
- **Dedre Gentner**, *Structure-Mapping Theory* — the distinction between surface and structural similarity. Keeps edges honest.
- **Niklas Luhmann / Sönke Ahrens**, *How to Take Smart Notes* (Zettelkasten) — atomic notes, links with substance, emergent structure. Foundation for "one concept one note", "never link without a why", and "not every conversation becomes a note".
- **Richard Feynman** — if you cannot explain it simply, you do not understand it. Foundation for the mandatory `tldr` field.
- **Karl Popper** — fallibilism. Foundation for `contradicts` and `refines` as first-class edge types.

The public framing is **latticework thinking / many-model knowledge graph**, not "Munger mental models" — the academic basis (Page, Hofstadter, Gentner, Luhmann) is more rigorous than Munger's speeches alone.

## Continuous deployment

This repo ships with a **GitHub Actions workflow** ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) that runs typecheck + tests + skill build on every push, and auto-deploys to your Worker on push to `master` or `main`.

To enable auto-deploy on your fork:

1. In Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, and add these additional permissions: `D1 Edit`, `Vectorize Edit`, `Workers KV Storage Edit`, `Workers AI Edit`. Save the token.
2. In your Cloudflare dashboard → right sidebar → copy your Account ID.
3. In your GitHub fork → Settings → Secrets and variables → Actions → New repository secret:
   - `CLOUDFLARE_API_TOKEN` = the token from step 1
   - `CLOUDFLARE_ACCOUNT_ID` = the account id from step 2
4. Push any change to `master`. The workflow runs tests, builds the skill ZIP, and deploys the Worker to your account.

The workflow runs the full test suite (vitest + `@cloudflare/vitest-pool-workers`) before deploying, so a failing test blocks the deploy.

## Development

```bash
npm install
npm run dev          # wrangler dev on local Miniflare
npm test             # vitest-pool-workers (workers pool + node pool for auth)
npm run typecheck    # tsc --noEmit
npm run build:skill  # package skills/using-mind-vault/ into assets/using-mind-vault.zip
npm run deploy       # build skill + wrangler deploy
```

Tests run in two pools: the main workers pool (for D1 + MCP tool tests with mocked Vectorize / Workers AI), and a separate node pool for the password hashing test (`crypto.subtle` is available in both, but the node pool keeps the auth module isolated from the workers runtime constraints).

## Security

**Single-user by design.** Do not share the Worker URL. Access is gated by OAuth 2.1 using an email + passphrase hash stored as Worker secrets. The passphrase itself is hashed with PBKDF2-SHA256 at 100k iterations (Workers-capped — see `src/auth/password.ts`). The tokens issued by the OAuth provider are stored in the `OAUTH_KV` namespace.

If you want a multi-user version, fork and adapt — it is not a drop-in change. You will need per-user rows in D1, per-user Vectorize filtering, and a registration flow.

There is currently **no login rate limit**. Pull requests welcome.

## Free tier

D1 + Vectorize + Workers AI free tiers are sufficient for personal use. Confirm current limits on Cloudflare's pricing pages before relying on them for large vaults.

---

Made by **[Robson Lins](https://github.com/orobsonn)** · [Instagram](https://www.instagram.com/orobsonn) · [X / Twitter](https://x.com/orobsonnn) · [YouTube](https://youtube.com/@orobsonnn)
