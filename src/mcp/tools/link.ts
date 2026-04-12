import { z } from 'zod';
import type { Env } from '../../env.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { EDGE_TYPES, getNoteById, insertEdge } from '../../db/queries.js';
import { newId } from '../../util/id.js';

const inputSchema = {
  from_id: z.string().min(1),
  to_id: z.string().min(1),
  relation_type: z.enum(EDGE_TYPES as unknown as [string, ...string[]]),
  why: z.string(),
};

const DESCRIPTION = `Cria uma aresta entre duas notas existentes.

Use APENAS quando ambas as notas já existem e você descobre uma conexão nova durante a conversa. Se você está criando um conceito novo, NÃO use link — use save_note com edges, é mais barato.

FLUXO: chame recall() para confirmar os ids de ambas as notas antes de chamar link. Self-loops (from_id == to_id) são rejeitados.

IMPORTANTE: why mínimo 20 caracteres, explicando o MECANISMO compartilhado, não só "relacionados". Edges duplicadas (mesmo from_id, to_id, relation_type) são silenciosamente ignoradas.`;

interface LinkInput {
  from_id: string;
  to_id: string;
  relation_type: string;
  why: string;
}

export function registerLink(server: any, env: Env): void {
  server.registerTool(
    'link',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: { title: 'Create edge', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    safeToolHandler(async (input: LinkInput) => {
      if (input.from_id === input.to_id) {
        return toolError(
          `Não é possível criar uma edge de uma nota para ela mesma. ` +
          `Se o objetivo é marcar tensão interna, crie uma nova nota refinando o conceito e ligue as duas com 'refines' ou 'contradicts'.`
        );
      }
      if (input.why.length < 20) {
        return toolError(
          `A justificativa (why) tem apenas ${input.why.length} caracteres — mínimo 20. ` +
          `Explique o MECANISMO compartilhado, não apenas que as notas se relacionam.`
        );
      }
      const [from, to] = await Promise.all([
        getNoteById(env, input.from_id),
        getNoteById(env, input.to_id),
      ]);
      if (!from) {
        return toolError(`Note '${input.from_id}' não encontrada. Chame recall() para descobrir o id correto. Não retente com este id.`);
      }
      if (!to) {
        return toolError(`Note '${input.to_id}' não encontrada. Chame recall() para descobrir o id correto. Não retente com este id.`);
      }
      const id = newId();
      await insertEdge(env, {
        id, from_id: input.from_id, to_id: input.to_id,
        relation_type: input.relation_type as any, why: input.why,
        created_at: Date.now(),
      });
      return toolSuccess({ id, from_id: input.from_id, to_id: input.to_id, relation_type: input.relation_type });
    }) as any
  );
}
