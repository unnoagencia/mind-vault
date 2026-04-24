# Mind Vault — Operations

Private operational runbook for this fork. Not part of upstream.

## URLs

- **Worker (production):** https://mind-vault.contato-30f.workers.dev
- **MCP endpoint:** https://mind-vault.contato-30f.workers.dev/mcp
- **Web dashboard:** https://mind-vault.contato-30f.workers.dev/app/
- **Status (no auth):** https://mind-vault.contato-30f.workers.dev/status

## Credentials

- **Email:** contato@unnoagencia.com.br
- **Passphrase:** stored in 1Password under "Mind Vault"
- **Cloudflare account:** contato@unnoagencia.com.br (ID `a30fdd1f107390620da5769ce39a72b3`)

## Cloudflare resources

| Resource | Identifier |
|---|---|
| D1 database | `cd6cd7b4-f26c-461c-96db-aafd8f5f8ce4` (`mind-vault`) |
| Vectorize index | `mind-vault-embeddings` (1024d cosine) |
| KV `OAUTH_KV` | `6bbbf77319a647ef93dbb227b1ab32c8` |
| KV `GRAPH_CACHE` | `f9d7d26c48ab4dc58b7a57119af010e4` |
| Worker secrets | `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `SESSION_SECRET` |

## Useful commands

Run from `/Users/uelitonsantos/mind-vault/`.

```bash
# Redeploy
npx wrangler deploy

# Tail live logs
npx wrangler tail

# Backup D1 to SQL dump
npx wrangler d1 export mind-vault --remote --output=backup-$(date +%F).sql

# List secrets (names only, values never shown)
npx wrangler secret list

# Rotate a secret
echo "<new-value>" | npx wrangler secret put SESSION_SECRET

# Pull updates from upstream
git fetch upstream
git merge upstream/master  # or main, check upstream default

# Check vault state
curl -s https://mind-vault.contato-30f.workers.dev/status | python3 -m json.tool
```

## MCP client setup

- **Claude Desktop / Web:** Settings → Connectors → Add custom → URL `https://mind-vault.contato-30f.workers.dev/mcp` → OAuth with email + passphrase
- **Claude Code:** `claude mcp add --transport http --scope user mind-vault https://mind-vault.contato-30f.workers.dev/mcp` (must be `--scope user` to show up across all projects)
- **Custom prompt:** paste the personalization block from `https://mind-vault.contato-30f.workers.dev/` into Claude Desktop/Web Settings → Personalization

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/status` returns `configured:false` | A secret is missing. `npx wrangler secret list` to check, re-set any missing one |
| OAuth flow fails repeatedly | Remove connector from Claude client, re-add, retry. Sometimes Cloudflare's OAuth has transient bugs |
| Vectorize returns stale or missing embeddings | Call `reembed` tool for the specific note id. Embeddings can lag 30-60s after save |
| New MCP added in Claude Code doesn't show in `/mcp` dialog | Restart the Claude Code session — config loads at startup only |
| Worker deploys but tools 500 | `npx wrangler tail` to see runtime errors, check bindings in `wrangler.toml` match actual resource IDs |
| Lost passphrase | Data in D1 survives. Recover by overwriting `OWNER_PASSWORD_HASH` with a new hash: `node scripts/hash-password.mjs "<new-pass>" | npx wrangler secret put OWNER_PASSWORD_HASH` then redeploy |

## Rollback (destructive)

Only if abandoning the project entirely:

```bash
cd /Users/uelitonsantos/mind-vault
npx wrangler d1 delete mind-vault
npx wrangler vectorize delete mind-vault-embeddings
npx wrangler kv namespace delete --namespace-id 6bbbf77319a647ef93dbb227b1ab32c8
npx wrangler kv namespace delete --namespace-id f9d7d26c48ab4dc58b7a57119af010e4
npx wrangler delete mind-vault
# Remove MCP from Claude clients manually via UI
rm -rf /Users/uelitonsantos/mind-vault
```

## Design and plan references

- Spec: `/Users/uelitonsantos/docs/superpowers/specs/2026-04-24-mind-vault-setup-design.md`
- Plan: `/Users/uelitonsantos/docs/superpowers/plans/2026-04-24-mind-vault-setup.md`
