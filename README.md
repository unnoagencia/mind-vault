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
