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
