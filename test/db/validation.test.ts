import { describe, it, expect } from 'vitest';
import { validateDomains, DOMAIN_SLUG_REGEX } from '../../src/db/validation.js';

describe('validateDomains', () => {
  it('accepts canonical slugs', () => {
    expect(validateDomains(['evolutionary-biology'])).toBeNull();
    expect(validateDomains(['systems-thinking', 'game-theory'])).toBeNull();
    expect(validateDomains(['ai', 'ml', 'nlp'])).toBeNull();
    expect(validateDomains(['economics-101'])).toBeNull();
  });

  it('rejects uppercase', () => {
    const err = validateDomains(['Evolutionary-Biology']);
    expect(err).not.toBeNull();
    expect(err).toContain('Evolutionary-Biology');
    expect(err).toContain('kebab-case');
  });

  it('rejects accented chars', () => {
    const err = validateDomains(['biologia-evolutiva-avançada']);
    expect(err).not.toBeNull();
    expect(err).toContain('biologia-evolutiva-avançada');
  });

  it('rejects spaces', () => {
    const err = validateDomains(['evolutionary biology']);
    expect(err).not.toBeNull();
    expect(err).toContain('evolutionary biology');
  });

  it('rejects underscore', () => {
    expect(validateDomains(['evolutionary_biology'])).not.toBeNull();
  });

  it('rejects leading digit', () => {
    expect(validateDomains(['1biology'])).not.toBeNull();
  });

  it('rejects too short (single char)', () => {
    expect(validateDomains(['a'])).not.toBeNull();
  });

  it('rejects too long (>40 chars)', () => {
    const longSlug = 'a' + '-b'.repeat(25); // 51 chars
    expect(validateDomains([longSlug])).not.toBeNull();
  });

  it('rejects Portuguese translation with pedagogical error', () => {
    const err = validateDomains(['biologia-evolutiva']);
    expect(err).not.toBeNull();
    expect(err).toContain('evolutionary-biology');
    expect(err).toContain('biologia-evolutiva');
  });

  it('stops at first invalid in list', () => {
    const err = validateDomains(['valid-one', 'INVALID', 'another-valid']);
    expect(err).toContain('INVALID');
  });

  it('DOMAIN_SLUG_REGEX is exported and correct', () => {
    expect(DOMAIN_SLUG_REGEX).toBeInstanceOf(RegExp);
    expect('evolutionary-biology').toMatch(DOMAIN_SLUG_REGEX);
    expect('INVALID').not.toMatch(DOMAIN_SLUG_REGEX);
  });
});
