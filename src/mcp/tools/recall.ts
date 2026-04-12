import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { ftsSearch, type NoteRow } from '../../db/queries.js';
import { validateDomains } from '../../db/validation.js';
import { embed, queryVector } from '../../vector/index.js';

const inputSchema = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(30).optional().default(15),
  domains_filter: z.array(z.string()).optional(),
};

const DESCRIPTION = `Hybrid cross-domain search in the vault (vector + FTS).

Returns up to \`limit\` results balanced by domain (at most 3 per domain, up to 5 distinct domains).
Returns only {id, title, domain, kind, tldr} — NEVER the body. To read the body, call get_note(id).

Query in any language — the embedding model is multilingual and matches across languages. A Portuguese query can surface English notes and vice versa.

IMPORTANT: read ALL returned domains before answering. The valuable match often comes from the unexpected domain — that is exactly what the vault is for. If domains_filter is provided, all entries must be canonical English slugs (same rules as save_note.domains).`;

interface RecallHit {
  id: string; title: string; domain: string; kind: string | null; tldr: string;
}

interface RecallInput { query: string; limit?: number; domains_filter?: string[]; }

export function registerRecall(server: any, env: Env): void {
  server.registerTool(
    'recall',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        title: 'Cross-domain recall',
        readOnlyHint: true, destructiveHint: false, openWorldHint: false,
      },
    },
    safeToolHandler(async (input: RecallInput) => {
      if (input.domains_filter && input.domains_filter.length > 0) {
        const err = validateDomains(input.domains_filter);
        if (err) return toolError(err);
      }

      const limit = input.limit ?? 15;
      const vec = await embed(env, input.query);
      const [vectorMatches, ftsRows] = await Promise.all([
        queryVector(env, vec, 30),
        ftsSearch(env, input.query, 30),
      ]);

      const ids = new Set<string>();
      for (const m of vectorMatches) ids.add(m.id);
      for (const r of ftsRows) ids.add(r.id);
      if (ids.size === 0) return toolSuccess({ results: [] });

      const placeholders = Array.from(ids).map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT id, title, tldr, domains, kind FROM notes WHERE id IN (${placeholders})`
      ).bind(...Array.from(ids)).all<Pick<NoteRow,'id'|'title'|'tldr'|'domains'|'kind'>>();

      const byId = new Map<string, RecallHit>();
      for (const r of rows.results ?? []) {
        const domains: string[] = JSON.parse(r.domains);
        byId.set(r.id, {
          id: r.id, title: r.title, tldr: r.tldr, kind: r.kind,
          domain: domains[0] ?? 'unknown',
        });
      }

      const vectorOrder = vectorMatches.map((m) => m.id).filter((id) => byId.has(id));
      const ftsOrder = ftsRows.map((r) => r.id).filter((id) => byId.has(id) && !vectorOrder.includes(id));
      const merged = [...vectorOrder, ...ftsOrder];

      let pool: RecallHit[] = merged.map((id) => byId.get(id)!).filter(Boolean);
      if (input.domains_filter?.length) {
        const allow = new Set(input.domains_filter);
        pool = pool.filter((h) => allow.has(h.domain));
      }

      const perDomain = new Map<string, number>();
      const distinctDomains = new Set<string>();
      const results: RecallHit[] = [];
      for (const h of pool) {
        const count = perDomain.get(h.domain) ?? 0;
        if (count >= 3) continue;
        if (!distinctDomains.has(h.domain) && distinctDomains.size >= 5) continue;
        perDomain.set(h.domain, count + 1);
        distinctDomains.add(h.domain);
        results.push(h);
        if (results.length >= limit) break;
      }

      return toolSuccess({ results });
    }) as any
  );
}
