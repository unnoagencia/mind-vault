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

Bad examples that will be rejected: `Evolutionary-Biology` (uppercase), `evolutionary biology` (space), `evolutionary_biology` (underscore), `1biology` (leading digit), `biologia-evolutiva-avançada` (accented). Note: `biologia-evolutiva` passes the regex because it is syntactically valid kebab-case — but you must NOT use it. The server cannot syntactically distinguish Portuguese from English at this level, so this is load-bearing on your discipline. Always translate mentally to the canonical English slug.

## Save workflow

~~~
- [ ] Atomized? (one concept, one note)
- [ ] tldr in one concrete sentence (Feynman test)
- [ ] 1–3 specific domains chosen
- [ ] MindVault:recall called to sweep cross-domain
- [ ] Analogies drafted into edges with substantive whys
- [ ] MindVault:save_note called with edges in the same call
~~~

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
