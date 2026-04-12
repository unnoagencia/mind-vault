import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolSuccess } from '../helpers.js';
import { ftsSearch, type NoteRow } from '../../db/queries.js';
import { embed, queryVector } from '../../vector/index.js';

const inputSchema = {
  query: z.string().min(1),
  limit: z.number().int().min(1).max(30).optional().default(15),
  domains_filter: z.array(z.string()).optional(),
};

const DESCRIPTION = `Busca híbrida cross-domain no cofre (vetorial + FTS).

Retorna até \`limit\` resultados balanceados por domínio (no máximo 3 por domínio, até 5 domínios distintos).
Retorna apenas {id, title, domain, kind, tldr} — NUNCA o body. Para ler o body, chame get_note(id).

IMPORTANTE: leia TODOS os domínios retornados antes de responder. O match valioso frequentemente vem do domínio inesperado — é exatamente isso que o cofre serve para expor.`;

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
