import type { Env } from '../env.js';
import { queryVector } from '../vector/index.js';

export interface SimilarityEdge { source: string; target: string; score: number; }

// For each note, query Vectorize for its top-k neighbors and keep those above threshold.
// Then deduplicate symmetric pairs (a↔b only once) and drop pairs that already have
// an explicit edge. The caller provides explicit pairs so this stays pure.
export async function computeSimilarityEdges(
  env: Env,
  noteVectors: Array<{ id: string; values: number[] }>,
  explicitPairs: Set<string>,
  opts: { topK: number; minScore: number }
): Promise<SimilarityEdge[]> {
  const seen = new Set<string>();
  const out: SimilarityEdge[] = [];

  for (const n of noteVectors) {
    const matches = await queryVector(env, n.values, opts.topK + 1); // +1 for self
    for (const m of matches) {
      if (m.id === n.id) continue;
      if (m.score < opts.minScore) continue;
      const [a, b] = [n.id, m.id].sort();
      const key = `${a}|${b}`;
      if (seen.has(key) || explicitPairs.has(key)) continue;
      seen.add(key);
      out.push({ source: a, target: b, score: m.score });
    }
  }

  return out;
}

export function explicitPairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}
