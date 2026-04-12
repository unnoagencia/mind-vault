// Canonical domain slug format: lowercase ASCII kebab-case, 2-40 chars.
// Domains are vault schema, not content — they must not drift between
// conversation languages. Enforced server-side so Claude cannot fragment
// the taxonomy accidentally.
export const DOMAIN_SLUG_REGEX = /^[a-z][a-z0-9-]{1,39}$/;

// Known non-English domain translations to reject with pedagogical guidance
const NON_ENGLISH_TRANSLATIONS: Record<string, string> = {
  'biologia-evolutiva': 'evolutionary-biology',
};

export function validateDomains(domains: string[]): string | null {
  for (const d of domains) {
    if (typeof d !== 'string' || !DOMAIN_SLUG_REGEX.test(d)) {
      return buildDomainError(d);
    }
    // Check for known non-English translations
    if (d in NON_ENGLISH_TRANSLATIONS) {
      return buildNonEnglishError(d, NON_ENGLISH_TRANSLATIONS[d]);
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

function buildNonEnglishError(nonEnglish: string, canonical: string): string {
  return (
    `Domain '${nonEnglish}' is a non-English translation. Use the canonical English form ` +
    `'${canonical}' instead. Domains are vault schema — they need to be stable identifiers ` +
    `that do not drift between conversation languages. If the conversation is in Portuguese ` +
    `and you were going to use '${nonEnglish}', use '${canonical}' instead.`
  );
}
