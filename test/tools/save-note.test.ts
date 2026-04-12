import { env } from 'cloudflare:test';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { registerSaveNote } from '../../src/mcp/tools/save-note.js';

const E = env as any;

function fakeAI() {
  return { run: vi.fn(async () => ({ data: [Array(768).fill(0.1)] })) };
}
function fakeVectorize() {
  return { upsert: vi.fn(async () => ({})), query: vi.fn(async () => ({ matches: [] })) };
}

function makeServer() {
  const registered: Record<string, any> = {};
  const server: any = {
    registerTool: (name: string, _meta: any, handler: any) => {
      registered[name] = handler;
    },
  };
  return { server, registered };
}

describe('save_note', () => {
  beforeEach(async () => {
    E.AI = fakeAI();
    E.VECTORIZE = fakeVectorize();
    await runMigrations(E);
    await E.DB.exec('DELETE FROM edges');
    await E.DB.exec('DELETE FROM tags');
    await E.DB.exec('DELETE FROM notes');
  });

  it('saves a note and embeds the tldr', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    const r = await registered.save_note({
      title: 'Red Queen',
      body: 'bod',
      tldr: 'coevolution forces constant running just to keep place',
      domains: ['evolutionary-biology'],
    });
    expect(r.isError).toBeUndefined();
    expect(E.AI.run).toHaveBeenCalled();
    expect(E.VECTORIZE.upsert).toHaveBeenCalled();
    const row = await E.DB.prepare('SELECT * FROM notes').first();
    expect(row.title).toBe('Red Queen');
  });

  it('rejects edge why shorter than 20 chars', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    await E.DB.prepare(
      `INSERT INTO notes VALUES ('target','t','b','tl','["x"]',null,0,0)`
    ).run();
    const r = await registered.save_note({
      title: 'X',
      body: 'b',
      tldr: 'tl of at least ten chars here ok',
      domains: ['x'],
      edges: [{ to_id: 'target', relation_type: 'analogous_to', why: 'too short' }],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('20 caracteres');
  });

  it('rejects edge pointing to missing note', async () => {
    const { server, registered } = makeServer();
    registerSaveNote(server, E);
    const r = await registered.save_note({
      title: 'X', body: 'b',
      tldr: 'tldr long enough here really',
      domains: ['x'],
      edges: [{ to_id: 'ghost', relation_type: 'analogous_to', why: 'this is a long enough why to pass validation' }],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('ghost');
  });
});
