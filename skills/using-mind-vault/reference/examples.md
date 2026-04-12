# Example sessions

## Example 1 — cross-domain hit on first save

User: "I just realized tech debt behaves like compound interest — the longer you ignore it the worse the rate gets."

Claude: calls `MindVault:recall({ query: "compounding debt feedback loop" })`.
Returns include a note "Red Queen" (evolutionary-biology). Claude reads the domains list, spots the cross-domain signal.

Claude: "Worth saving — and there's a resonance with the Red Queen note from biology. Save?"

User: "yes"

Claude: calls `MindVault:save_note`:

~~~json
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
~~~

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
