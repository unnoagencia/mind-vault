import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { getEdgesFrom, getEdgesTo, getNoteById, getTagsByNote } from '../../db/queries.js';

const inputSchema = { id: z.string().min(1) };

const DESCRIPTION = `Busca o conteúdo completo de uma nota por id (body + tags + edges).

Use quando você precisa ler/citar o conteúdo integral de uma nota encontrada via recall.`;

export function registerGetNote(server: any, env: Env): void {
  server.registerTool(
    'get_note',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: { title: 'Get full note', readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    safeToolHandler(async (input: { id: string }) => {
      const n = await getNoteById(env, input.id);
      if (!n) {
        return toolError(
          `Note '${input.id}' não encontrada. Chame recall() para descobrir o id correto. Não retente com este id.`
        );
      }
      const [tags, edgesOut, edgesIn] = await Promise.all([
        getTagsByNote(env, input.id),
        getEdgesFrom(env, input.id),
        getEdgesTo(env, input.id),
      ]);
      return toolSuccess({
        id: n.id,
        title: n.title,
        body: n.body,
        tldr: n.tldr,
        domains: JSON.parse(n.domains),
        kind: n.kind,
        created_at: n.created_at,
        updated_at: n.updated_at,
        tags,
        edges: {
          out: edgesOut.map((e) => ({ id: e.id, to_id: e.to_id, relation_type: e.relation_type, why: e.why })),
          in:  edgesIn.map((e) => ({ id: e.id, from_id: e.from_id, relation_type: e.relation_type, why: e.why })),
        },
      });
    }) as any
  );
}
