import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: false,
  async: false,
});

// Drop all raw HTML tokens (block and inline) so no raw HTML survives into output.
// In marked v18 the renderer receives a token object { text, ... }.
marked.use({
  renderer: {
    html: () => '',
  },
});

export function renderMarkdown(src: string): string {
  return marked.parse(src, { async: false }) as string;
}
