import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { EDGE_TYPES, getEdgesFrom, getEdgesTo, getNoteById, type EdgeRow, type NoteRow } from '../../db/queries.js';

const inputSchema = {
  note_id: z.string().min(1),
  relation_types: z.array(z.enum(EDGE_TYPES as unknown as [string, ...string[]])).optional(),
  direction: z.enum(['in','out','both']).optional().default('both'),
};

const DESCRIPTION = `Vizinhos imediatos (1 hop) de uma nota no grafo.

FLUXO: chame recall() antes para descobrir o note_id. Não chame expand com um id inventado.

Retorna {neighbors: [{note, edge}]} onde edge inclui relation_type e why.
Para navegar mais fundo, chame expand recursivamente nos ids retornados — mas pense duas vezes antes de expandir mais de 2 hops, costuma ser ruído.

IMPORTANTE: se recall já traz a analogia que você precisa, não chame expand só por reflexo. Use expand quando quiser seguir uma linha de raciocínio específica pelo grafo.`;

interface ExpandInput {
  note_id: string;
  relation_types?: string[];
  direction?: 'in'|'out'|'both';
}

export function registerExpand(server: any, env: Env): void {
  server.registerTool(
    'expand',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: { title: 'Expand neighbors', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    safeToolHandler(async (input: ExpandInput) => {
      const base = await getNoteById(env, input.note_id);
      if (!base) {
        return toolError(
          `Note '${input.note_id}' não encontrada. Chame recall() primeiro para descobrir o id correto. Não retente com este id.`
        );
      }
      const dir = input.direction ?? 'both';
      const edges: Array<{ edge: EdgeRow; otherId: string }> = [];
      if (dir === 'out' || dir === 'both') {
        for (const e of await getEdgesFrom(env, input.note_id)) edges.push({ edge: e, otherId: e.to_id });
      }
      if (dir === 'in' || dir === 'both') {
        for (const e of await getEdgesTo(env, input.note_id)) edges.push({ edge: e, otherId: e.from_id });
      }
      const filtered = input.relation_types
        ? edges.filter((x) => input.relation_types!.includes(x.edge.relation_type))
        : edges;

      const ids = Array.from(new Set(filtered.map((x) => x.otherId)));
      if (ids.length === 0) return toolSuccess({ neighbors: [] });
      const placeholders = ids.map(() => '?').join(',');
      const rows = await env.DB.prepare(
        `SELECT id,title,tldr,domains FROM notes WHERE id IN (${placeholders})`
      ).bind(...ids).all<Pick<NoteRow,'id'|'title'|'tldr'|'domains'>>();
      const byId = new Map((rows.results ?? []).map((r) => [r.id, r]));

      const neighbors = filtered.map((x) => {
        const n = byId.get(x.otherId);
        if (!n) return null;
        const domains: string[] = JSON.parse(n.domains);
        return {
          note: { id: n.id, title: n.title, domain: domains[0] ?? 'unknown', tldr: n.tldr },
          edge: { relation_type: x.edge.relation_type, why: x.edge.why },
        };
      }).filter(Boolean);

      return toolSuccess({ neighbors });
    }) as any
  );
}
