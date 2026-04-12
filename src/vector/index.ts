import type { Env } from '../env.js';

// @cf/baai/bge-m3 returns 1024-dim vectors. Multilingual (100+ languages).
// The Vectorize index must be created with dimensions=1024.
export async function embed(env: Env, text: string): Promise<number[]> {
  const res = await env.AI.run('@cf/baai/bge-m3', { text: [text] }) as {
    data: number[][];
  };
  const v = res.data?.[0];
  if (!v) throw new Error('embed: empty response from Workers AI');
  return v;
}

export interface NoteVectorMeta {
  domains: string[];
  kind: string | null;
  created_at: number;
}

export async function upsertNoteVector(
  env: Env, id: string, values: number[], meta: NoteVectorMeta
): Promise<void> {
  await env.VECTORIZE.upsert([{
    id,
    values,
    metadata: {
      domains: meta.domains.join(','),
      kind: meta.kind ?? '',
      created_at: meta.created_at,
    },
  }]);
}

export interface VectorMatch { id: string; score: number; }

export async function queryVector(
  env: Env, values: number[], topK: number
): Promise<VectorMatch[]> {
  const res = await env.VECTORIZE.query(values, { topK, returnMetadata: 'none' });
  return (res.matches ?? []).map((m) => ({ id: m.id, score: m.score }));
}
