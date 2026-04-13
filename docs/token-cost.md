# Token cost on Claude

Mind Vault runs on Cloudflare's free tier ([see README](../README.md#-cost-0--runs-entirely-on-cloudflares-free-tier)), so the infrastructure is free. But connecting the MCP server to Claude *does* add tokens to every conversation. This page is the honest breakdown so you can decide if the trade-off is worth it for your usage.

> Numbers below are estimated from the source files at `~4 chars/token`. Real tokenization varies ±15%. Methodology at the bottom.

## TL;DR

| Cost | Tokens | When you pay |
|---|---|---|
| MCP always-on overhead | **~2,400** | Every request while MCP is connected (cacheable, 5-min TTL) |
| `using-mind-vault` skill | ~1,300 | Only when the skill is invoked |
| `recall` response | 100–300 | Per call (returns tldrs only, never bodies) |
| `get_note` response | 500–2,000 | Per call (full body) |

For a typical Claude Code session that uses the vault a few times, expect **~3–5k extra tokens per cold start** and **near-zero marginal cost while the prompt cache stays warm**.

## What gets injected into the system prompt

When you connect the MCP, Claude loads on every request:

1. **Server instructions** ([`src/mcp/instructions.ts`](../src/mcp/instructions.ts)) — ~240 tokens. The "when to use / recommended flow" preamble.
2. **Tool descriptions** for all 6 tools — ~1,250 tokens combined. `save_note` and `recall` are deliberately verbose because they encode the discipline (atomize, sweep cross-domain, edge `why` rules, indexing latency caveat). The other four (`expand`, `get_note`, `link`, `reembed`) are short.
3. **Input JSON schemas** for all 6 tools — ~900 tokens combined.

Total: **~2,400 tokens added to the system prompt** as long as the MCP is connected, *whether or not* you actually use the vault in that conversation.

## What loads on demand

- **The `using-mind-vault` skill** ([`skills/using-mind-vault/SKILL.md`](../skills/using-mind-vault/SKILL.md)) — ~1,300 tokens. Only loaded when Claude (or you) invokes it. The skill duplicates some of the tool descriptions on purpose so it works as a standalone reference, but the redundancy means that *invoking the skill in a session that already has the MCP connected costs ~1,300 extra tokens*.
- **Tool responses** — pay-as-you-go. `recall` is intentionally cheap (tldrs only, ~80 chars per hit, capped at ~15 hits). `get_note` is the heavy one — read bodies only when you actually need them.

## Impact by Claude plan

Anthropic doesn't publish exact token quotas for consumer plans, but community measurements give a workable picture. All paid plans use a **5-hour rolling window** (not a daily reset — messages fall off 5 hours after you send them), plus Pro/Max have **weekly caps** introduced in August 2025. On weekdays 5–11am PT / 1–7pm GMT (peak hours), the 5h limit tightens further.

| Plan | Observed 5h budget | MCP overhead as % of window | Verdict |
|---|---|---|---|
| Free | ~9k tok effective | ~27% | **Skip.** Mind Vault eats too much of the window. |
| Pro ($20/mo) | ~44k tok | ~5.5% per cold request | Connect selectively. Disconnect for non-vault work. |
| Max 5x ($100/mo) | ~220k tok | ~1.1% | Leave connected. |
| Max 20x ($200/mo) | ~880k tok | ~0.3% | Leave connected. |
| API / Claude Code | no window | billed per token | Cache discipline is your lever. |

Concrete API pricing for Opus 4.6 (~$15/Mtok input, ~$1.50 cached): the MCP overhead costs roughly **$0.036 per cold turn** or **$0.0036 while cache is warm**. A session with 20 turns in a 5-minute window is one cold start + 19 cached = ~$0.10 total for the overhead.

Check your live usage with `/usage` in Claude Code or at `claude.ai/settings/usage`.

## Prompt caching changes the math

Claude's prompt cache has a **5-minute TTL** and the MCP overhead sits in the cacheable system-prompt prefix. Practical consequences:

- **Active session** (you're chatting back and forth): you pay the 2,400 tokens *once*, then ~10× cheaper on every subsequent turn within 5 minutes.
- **Cold one-shots** (you ping Claude, walk away, come back an hour later): each cold start re-pays the full 2,400 tokens. If you do this dozens of times a day with the MCP connected but rarely use the vault, the overhead is wasted.
- **Disconnecting the MCP** when you don't need it eliminates the cost entirely. The vault keeps working — you just can't reach it from that session.

## Pros

- **Fixed overhead, not per-call.** ~2,400 tokens is ~1.2% of a 200k context. For most workflows this is negligible.
- **`recall` is designed to be cheap on output.** Returns tldrs only, capped and domain-balanced, so a single recall rarely exceeds 300 tokens regardless of vault size.
- **The verbose tool descriptions earn their cost.** They prevent the most expensive failure mode: Claude saving sloppy notes that pollute future recalls. Discipline at the schema level is cheaper than re-running conversations.
- **Compounds with use.** Every saved note increases the value of every future recall, while the token cost stays flat.

## Cons

- **Always-on, even when idle.** The MCP overhead is paid on every request while connected, including conversations that never touch the vault.
- **The skill duplicates the MCP instructions.** If you both connect the MCP *and* invoke the skill, you pay ~3,700 tokens of guidance for what is structurally the same content. The skill exists for environments without MCP support — keep it disabled when the MCP is connected.
- **Cold-start penalty.** Sporadic, short conversations (under 5 minutes apart) lose the cache benefit and pay full price each time.
- **`get_note` can be expensive on long notes.** A 2k-token note read 5 times in a session is 10k tokens. Prefer `recall` + tldr scanning when you don't actually need the body.

## How to keep the cost low

1. **Disconnect the MCP from sessions that don't need it.** The biggest single lever. If you're doing UI work for an hour, the vault doesn't need to be loaded.
2. **Don't invoke the skill if the MCP is connected.** The MCP's own tool descriptions already encode the discipline. The skill is for fallback environments.
3. **Prefer `recall` over `get_note`.** Read bodies only when the tldr is insufficient.
4. **Batch vault interactions inside a single session.** Cache stays warm under 5 minutes — five recalls in a row are nearly free; five recalls spread across the day each pay cold.
5. **Resist over-saving.** Token cost compounds with note count only on the *output* side (more notes → more recall hits). The system-prompt overhead stays flat, but a noisy vault makes recalls return less-relevant tldrs and tempts more `get_note` calls.

## Methodology

These numbers come from `wc -c` on the source files divided by 4. Specifically:

- `src/mcp/instructions.ts` — 955 chars
- `src/mcp/tools/save-note.ts` DESCRIPTION block — ~1,900 chars
- `src/mcp/tools/recall.ts` DESCRIPTION block — ~1,500 chars
- Other 4 tool files contain shorter descriptions plus input schemas
- `skills/using-mind-vault/SKILL.md` — 5,209 chars

Real tokenization depends on the tokenizer. English prose is roughly 4 chars/token; JSON schemas and code are denser. Treat the table above as ±15% rather than exact. If you want exact numbers for your account, run a single MCP-connected request and inspect the `usage` field on the API response.
