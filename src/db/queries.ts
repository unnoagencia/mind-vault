import type { Env } from '../env.js';

export type EdgeType =
  | 'analogous_to' | 'same_mechanism_as' | 'instance_of' | 'generalizes'
  | 'causes' | 'depends_on' | 'contradicts' | 'evidence_for' | 'refines';

export const EDGE_TYPES: readonly EdgeType[] = [
  'analogous_to','same_mechanism_as','instance_of','generalizes',
  'causes','depends_on','contradicts','evidence_for','refines',
] as const;

export interface NoteRow {
  id: string; title: string; body: string; tldr: string;
  domains: string; kind: string | null;
  created_at: number; updated_at: number;
}

export interface EdgeRow {
  id: string; from_id: string; to_id: string;
  relation_type: EdgeType; why: string; created_at: number;
}

export async function insertNote(env: Env, n: NoteRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notes (id,title,body,tldr,domains,kind,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(n.id, n.title, n.body, n.tldr, n.domains, n.kind, n.created_at, n.updated_at).run();
}

export async function insertEdge(env: Env, e: EdgeRow): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO edges (id,from_id,to_id,relation_type,why,created_at)
     VALUES (?,?,?,?,?,?)`
  ).bind(e.id, e.from_id, e.to_id, e.relation_type, e.why, e.created_at).run();
}

export async function insertTags(env: Env, noteId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const stmt = env.DB.prepare(`INSERT OR IGNORE INTO tags (note_id, tag) VALUES (?, ?)`);
  await env.DB.batch(tags.map((t) => stmt.bind(noteId, t)));
}

export async function getNoteById(env: Env, id: string): Promise<NoteRow | null> {
  return env.DB.prepare(`SELECT * FROM notes WHERE id = ?`).bind(id).first<NoteRow>();
}

export async function getTagsByNote(env: Env, id: string): Promise<string[]> {
  const r = await env.DB.prepare(`SELECT tag FROM tags WHERE note_id = ?`).bind(id).all<{ tag: string }>();
  return (r.results ?? []).map((x) => x.tag);
}

export async function getEdgesFrom(env: Env, id: string): Promise<EdgeRow[]> {
  const r = await env.DB.prepare(`SELECT * FROM edges WHERE from_id = ?`).bind(id).all<EdgeRow>();
  return r.results ?? [];
}

export async function getEdgesTo(env: Env, id: string): Promise<EdgeRow[]> {
  const r = await env.DB.prepare(`SELECT * FROM edges WHERE to_id = ?`).bind(id).all<EdgeRow>();
  return r.results ?? [];
}

export async function ftsSearch(
  env: Env, query: string, limit: number
): Promise<Array<Pick<NoteRow,'id'|'title'|'tldr'|'domains'|'kind'>>> {
  const r = await env.DB.prepare(
    `SELECT n.id, n.title, n.tldr, n.domains, n.kind
     FROM notes_fts f
     JOIN notes n ON n.rowid = f.rowid
     WHERE notes_fts MATCH ?
     ORDER BY rank
     LIMIT ?`
  ).bind(query, limit).all<Pick<NoteRow,'id'|'title'|'tldr'|'domains'|'kind'>>();
  return r.results ?? [];
}
