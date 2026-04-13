import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders basic markdown to HTML', () => {
    const out = renderMarkdown('# Hello\n\n**bold**');
    expect(out).toContain('<h1');
    expect(out).toContain('<strong>bold</strong>');
  });

  it('strips raw HTML block tags', () => {
    const out = renderMarkdown('<script>alert(1)</script>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips raw HTML img onerror', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('<img');
  });

  it('strips inline iframe', () => {
    const out = renderMarkdown('Text <iframe src="evil"></iframe> more');
    expect(out).not.toContain('<iframe');
  });
});
