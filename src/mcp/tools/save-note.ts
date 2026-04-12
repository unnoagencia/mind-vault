import { z } from 'zod';
import type { Env } from '../../env.js';
import { newId } from '../../util/id.js';
import { safeToolHandler, toolError, toolSuccess } from '../helpers.js';
import { EDGE_TYPES, insertEdge, insertNote, insertTags, getNoteById } from '../../db/queries.js';
import { embed, upsertNoteVector } from '../../vector/index.js';

const edgeSchema = z.object({
  to_id: z.string().min(1),
  relation_type: z.enum(EDGE_TYPES as unknown as [string, ...string[]]),
  why: z.string(),
});

const inputSchema = {
  title: z.string().min(1).max(200).describe('Title atômico. Sem "and/e".'),
  body: z.string().min(1).describe('Corpo em markdown'),
  tldr: z.string().min(10).max(280).describe('Uma frase. Teste de Feynman.'),
  domains: z.array(z.string().min(1)).min(1).max(3).describe('Domínios específicos (1-3)'),
  kind: z.string().optional(),
  tags: z.array(z.string()).optional(),
  edges: z.array(edgeSchema).optional(),
};

const DESCRIPTION = `Grava uma nota atômica no cofre, opcionalmente com edges a notas existentes.

FLUXO OBRIGATÓRIO antes de chamar:
1. Atomize: uma nota = um conceito. Se o title contém "and/e", quebre em duas chamadas separadas.
2. Chame recall() primeiro para varredura cross-domain. Mesmo que você ache que a ideia é inédita.
3. Para cada analogia em OUTRO domínio, inclua uma edge no array edges desta mesma chamada.

O campo tldr é um teste de Feynman: se você não consegue resumir em uma frase concreta, a nota NÃO está pronta — não force, converse mais com o usuário até ter clareza. NÃO chame save_note sem um tldr concreto.
O campo domains deve ser ESPECÍFICO (evolutionary-biology, não science).

IMPORTANTE: o campo why de cada edge é rejeitado se tiver menos de 20 caracteres, e edges apontando para ids inexistentes são rejeitadas. Se você não tem o id da nota alvo, chame recall() primeiro.`;

interface SaveNoteInput {
  title: string;
  body: string;
  tldr: string;
  domains: string[];
  kind?: string;
  tags?: string[];
  edges?: Array<{ to_id: string; relation_type: string; why: string }>;
}

export function registerSaveNote(server: any, env: Env): void {
  server.registerTool(
    'save_note',
    {
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        title: 'Save atomic note',
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    safeToolHandler(async (input: SaveNoteInput) => {
      const now = Date.now();
      const id = newId();

      if (input.edges) {
        for (const e of input.edges) {
          if (e.why.length < 20) {
            return toolError(
              `A justificativa (why) da edge tem apenas ${e.why.length} caracteres — mínimo de 20 caracteres. ` +
              `Reescreva explicitando o MECANISMO compartilhado entre as notas, não apenas que elas se relacionam.`
            );
          }
          const target = await getNoteById(env, e.to_id);
          if (!target) {
            return toolError(
              `Note '${e.to_id}' não encontrada no cofre. Chame recall() primeiro com um termo relacionado ` +
              `para descobrir o id correto. Não retente com este id.`
            );
          }
        }
      }

      await insertNote(env, {
        id,
        title: input.title,
        body: input.body,
        tldr: input.tldr,
        domains: JSON.stringify(input.domains),
        kind: input.kind ?? null,
        created_at: now,
        updated_at: now,
      });
      if (input.tags?.length) await insertTags(env, id, input.tags);

      if (input.edges) {
        for (const e of input.edges) {
          await insertEdge(env, {
            id: newId(),
            from_id: id,
            to_id: e.to_id,
            relation_type: e.relation_type as any,
            why: e.why,
            created_at: now,
          });
        }
      }

      const vec = await embed(env, input.tldr);
      await upsertNoteVector(env, id, vec, {
        domains: input.domains,
        kind: input.kind ?? null,
        created_at: now,
      });

      return toolSuccess({
        id,
        saved: { title: input.title, domains: input.domains },
        edges_created: input.edges?.length ?? 0,
      });
    }) as any
  );
}
