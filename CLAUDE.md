# CLAUDE.md — Mind Vault agent setup runbook

This file is the single source of truth for setting up Mind Vault end-to-end from an agentic IDE (Claude Code, Cursor, etc). If the user asks you to "set up Mind Vault", "install Mind Vault", or similar, follow this runbook step by step. Do not improvise.

## What Mind Vault needs

A single Cloudflare Worker with five resources bound to it:

| Resource | Kind | Binding name |
|---|---|---|
| D1 database | SQL (SQLite) | `DB` |
| Vectorize index | 1024-dim cosine | `VECTORIZE` (name `mind-vault-embeddings`) |
| KV namespace | OAuth tokens | `OAUTH_KV` |
| KV namespace | Graph layout cache | `GRAPH_CACHE` |
| Workers AI | Multilingual embeddings (`@cf/baai/bge-m3`) | `AI` |

And three Worker secrets:

| Secret | Purpose |
|---|---|
| `OWNER_EMAIL` | Login email for the web dashboard and MCP OAuth |
| `OWNER_PASSWORD_HASH` | PBKDF2-SHA256 hash (100k iter) of the user's passphrase |
| `SESSION_SECRET` | Random 32-byte hex string — HMAC key for web dashboard session cookies |

Everything runs on Cloudflare's free tier. No credit card required.

## Preflight (once per machine)

Before the first run of this runbook, confirm the host has `wrangler` CLI authenticated to Cloudflare:

```bash
npx wrangler whoami
```

If that fails, ask the user to run `npx wrangler login` in their terminal (it opens a browser). Do not try to authenticate on their behalf.

## Setup runbook

Execute these steps in order. Stop and report to the user if any command fails — do not silently retry.

### 1. Ask the user for credentials

Ask two questions in a single message:

1. **Email** for the vault login (any email works — it is just an identifier, no verification happens)
2. **Passphrase** — recommend "a memorable phrase of 12+ characters", warn that losing it means losing dashboard access (the vault data itself survives because it lives in D1)

Do NOT proceed without both values.

### 2. Create the Cloudflare resources

Run these four commands and capture the IDs from the output:

```bash
npx wrangler d1 create mind-vault
npx wrangler vectorize create mind-vault-embeddings --dimensions=1024 --metric=cosine
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create GRAPH_CACHE
```

Each command prints an ID. Parse the output and extract:

- `database_id` from `wrangler d1 create`
- two `id` values from the two `kv namespace create` runs (the command's output labels them)

Vectorize does not return an ID — it is referenced by name in `wrangler.toml`.

### 3. Update `wrangler.toml`

Open `wrangler.toml` and replace the three `REPLACE_ME_*` placeholders with the IDs from step 2:

- `database_id = "REPLACE_ME_D1_ID"` → the D1 ID
- The `[[kv_namespaces]]` block with `binding = "OAUTH_KV"` — set `id` to the OAUTH_KV ID
- The `[[kv_namespaces]]` block with `binding = "GRAPH_CACHE"` — set `id` to the GRAPH_CACHE ID

Do not touch any other field. Specifically: do not add a custom `[[routes]]` block unless the user explicitly asked for a custom domain.

### 4. Generate the three secrets locally

Two are derived from user input, one is random:

**`OWNER_EMAIL`** — the email the user gave you, verbatim.

**`OWNER_PASSWORD_HASH`** — the passphrase hashed with PBKDF2-SHA256, 100k iterations. The repo ships a helper script (plain Node ESM, no dependencies):

```bash
node scripts/hash-password.mjs "<passphrase>"
```

The output is a single line starting with `pbkdf2$sha256$100000$...`. Treat it as opaque — do not split or reformat it. This format is what the Worker expects in `src/auth/password.ts`.

**`SESSION_SECRET`** — 32 bytes of randomness in hex:

```bash
openssl rand -hex 32
```

### 5. Push the three secrets to the Worker

Secrets are set one at a time via `wrangler secret put`. The command reads from stdin when you pipe a value in, so pipe each value:

```bash
echo "<email>" | npx wrangler secret put OWNER_EMAIL
echo "<hash>" | npx wrangler secret put OWNER_PASSWORD_HASH
echo "<session_secret>" | npx wrangler secret put SESSION_SECRET
```

If any of the three fails, stop and report the error. The Worker cannot start without all three.

### 6. Deploy the Worker

```bash
npx wrangler deploy
```

Capture the Worker URL from the output (it looks like `https://mind-vault.<your-subdomain>.workers.dev`). You will need it for the next step and to hand back to the user.

### 7. Apply the D1 schema

Migrations are applied at runtime by the Worker via a `/setup/provision` endpoint. Hit it once:

```bash
curl -X POST "<worker-url>/setup/provision"
```

Expected response: `{"ok":true}`. If you see anything else, report it.

### 8. Verify the vault is up

```bash
curl "<worker-url>/status"
```

Expected: `{"configured":true,"notes":0,"edges":0,...}`. If `configured` is false, a secret is missing — re-check step 5.

### 9. Hand off to the user

Print a short summary with:

- The Worker URL
- The MCP endpoint: `<worker-url>/mcp`
- The Claude Code install command: `claude mcp add --transport http mind-vault <worker-url>/mcp`
- A reminder to install the `using-mind-vault` skill from `<worker-url>/skill/using-mind-vault.zip` (or from the `skills/using-mind-vault/` directory in this repo)
- A reminder that the token cost of connecting the MCP is ~2,400 tokens per request (see README section "The real cost: Claude tokens" for plan-specific impact)

Do not walk the user through the Claude-side connection unless they ask. They know how to paste a URL.

## Failure modes

- **`wrangler d1 create` says "already exists"**: the user already has a `mind-vault` D1. Run `npx wrangler d1 list` to find it and ask the user whether to reuse it (and use its existing ID) or pick a different name.
- **`wrangler deploy` fails on KV binding**: the ID in `wrangler.toml` is still a placeholder or wrong. Re-run step 2/3.
- **`curl /setup/provision` returns a 503**: the secrets are not set. Re-run step 5 and redeploy.
- **`curl /status` returns `{"configured":false}`**: at least one of the three secrets is missing. Check all three were actually set by running `npx wrangler secret list`.

## Do not

- Do not commit `wrangler.local.toml`, `.dev.vars`, or any file containing a real D1/KV ID, email, passphrase, hash, or session secret.
- Do not modify `src/db/migrate.ts` to "simplify" the migrations — they are authored manually for a reason (see the comment in the file about trigger bodies).
- Do not add a `[[routes]]` custom domain unless the user asks.
- Do not skip the `using-mind-vault` skill install — the MCP tool descriptions alone are not enough for Claude to actually follow the latticework method across sessions.
