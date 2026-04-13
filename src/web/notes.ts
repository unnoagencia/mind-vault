import type { Env } from '../env.js';
import { esc } from '../util/html.js';
import { requireSession } from './session.js';
import { renderShell, htmlResponse } from './render.js';
import { renderMarkdown } from './markdown.js';
import { getNoteById, getEdgesFrom, type NoteRow, type EdgeRow } from '../db/queries.js';

interface NoteListItem {
  id: string;
  title: string;
  domains: string;
  updated_at: number;
}

// updated_at / created_at are stored as milliseconds (Date.now()) — not seconds.
function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// The `domains` column is a JSON-encoded string array (e.g. `["infra","ml"]`).
// Tolerate legacy CSV just in case some rows were written in the old format.
function parseDomains(raw: string): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    } catch { /* fall through to CSV */ }
  }
  return trimmed.split(',').map((d) => d.trim()).filter(Boolean);
}

function domainsToBadges(raw: string): string {
  return parseDomains(raw)
    .map((d) => `<span class="badge">${esc(d)}</span>`)
    .join('');
}

export async function handleNotesList(req: Request, env: Env): Promise<Response> {
  const session = await requireSession(req, env);
  if (!session.ok) return session.response;

  const rows = await env.DB.prepare(
    `SELECT id, title, domains, updated_at FROM notes ORDER BY updated_at DESC`
  ).all<NoteListItem>();
  const notes = rows.results ?? [];

  const body = `
    <div class="page-header">
      <h1>Notes</h1>
      <span class="count">${notes.length} ${notes.length === 1 ? 'note' : 'notes'}</span>
    </div>
    ${notes.length === 0 ? '<p style="color:var(--text-dim)">No notes yet.</p>' : ''}
    ${notes
      .map(
        (n) => `
      <a class="note-card" href="/app/notes/${esc(n.id)}">
        <div class="title">${esc(n.title)}</div>
        <div class="meta">${domainsToBadges(n.domains)}<span>${formatDate(n.updated_at)}</span></div>
      </a>`
      )
      .join('')}
  `;

  return htmlResponse(
    renderShell({ title: 'Notes', active: 'notes', email: session.email, body })
  );
}

export async function handleNoteDetail(req: Request, env: Env, id: string): Promise<Response> {
  const session = await requireSession(req, env);
  if (!session.ok) return session.response;

  const note = await getNoteById(env, id);
  if (!note) {
    return htmlResponse(
      renderShell({
        title: 'Not found',
        active: 'notes',
        email: session.email,
        body: '<h1>Note not found</h1><p><a href="/app/notes">← Back to notes</a></p>',
      }),
      404
    );
  }

  const outbound = await getEdgesFrom(env, id);
  const targetIds = outbound.map((e) => e.to_id);
  const targets = new Map<string, NoteRow>();
  if (targetIds.length > 0) {
    const placeholders = targetIds.map(() => '?').join(',');
    const rs = await env.DB.prepare(
      `SELECT * FROM notes WHERE id IN (${placeholders})`
    ).bind(...targetIds).all<NoteRow>();
    for (const r of rs.results ?? []) targets.set(r.id, r);
  }

  const linksHtml = outbound.length
    ? `<h2>Connected to</h2>${outbound
        .map((e) => {
          const t = targets.get(e.to_id);
          if (!t) return '';
          return `<a class="note-card" href="/app/notes/${esc(t.id)}">
            <div class="title">→ ${esc(t.title)}</div>
            <div class="meta"><span class="badge">${esc(e.relation_type)}</span>${esc(e.why)}</div>
          </a>`;
        })
        .join('')}`
    : '';

  const body = `
    <h1>${esc(note.title)}</h1>
    <div class="meta" style="margin-bottom:32px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${domainsToBadges(note.domains)}<span>Updated ${formatDate(note.updated_at)}</span></div>
    <div class="note-body">${renderMarkdown(note.body)}</div>
    ${linksHtml}
  `;

  return htmlResponse(
    renderShell({ title: note.title, active: 'notes', email: session.email, body })
  );
}
