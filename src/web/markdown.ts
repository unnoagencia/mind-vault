import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
  async: false,
});

export function renderMarkdown(src: string): string {
  // marked escapes raw HTML by default when `sanitize` is unsupported in v12+,
  // so we wrap manually: strip any <script> just in case, then render.
  const cleaned = src.replace(/<script[\s\S]*?<\/script>/gi, '');
  return marked.parse(cleaned, { async: false }) as string;
}
