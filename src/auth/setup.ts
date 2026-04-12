import type { Env } from '../env.js';
import { runMigrations } from '../db/migrate.js';
import { renderLanding, renderWizard } from '../static/wizard.js';

export function isSetup(env: Env): boolean {
  return Boolean(env.OWNER_EMAIL && env.OWNER_PASSWORD_HASH);
}

export async function handleRoot(_req: Request, env: Env): Promise<Response> {
  if (!isSetup(env)) {
    return new Response(renderWizard(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const [n, e, lw] = await Promise.all([
    env.DB.prepare(`SELECT count(*) c FROM notes`).first<{ c: number }>(),
    env.DB.prepare(`SELECT count(*) c FROM edges`).first<{ c: number }>(),
    env.DB.prepare(`SELECT max(updated_at) m FROM notes`).first<{ m: number | null }>(),
  ]);
  return new Response(renderLanding({
    notes: n?.c ?? 0, edges: e?.c ?? 0, lastWrite: lw?.m ?? null,
  }), { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export async function handleProvision(env: Env): Promise<Response> {
  await runMigrations(env);
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
}
