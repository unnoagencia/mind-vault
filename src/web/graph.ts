import type { Env } from '../env.js';
import { requireSession } from './session.js';
import { renderShell, htmlResponse } from './render.js';

export async function handleGraphPage(req: Request, env: Env): Promise<Response> {
  const session = await requireSession(req, env);
  if (!session.ok) return session.response;

  const body = `
    <div style="position:relative;height:calc(100vh - 64px);margin:-32px -40px;">
      <div id="graph-overlay" style="position:absolute;top:16px;left:16px;z-index:10;background:rgba(10,6,24,0.75);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--text-dim);pointer-events:none;">
        <div id="graph-count">Loading…</div>
        <div style="margin-top:6px;display:flex;gap:10px;align-items:center;">
          <span style="display:inline-block;width:16px;border-top:2px solid #b48cff;"></span> explicit
          <span style="display:inline-block;width:16px;border-top:2px dashed #8cc8ff;margin-left:6px;"></span> similar
        </div>
      </div>
      <div id="graph-canvas" style="position:absolute;inset:0;"></div>
    </div>
    <script src="/app/graph/bundle.js" defer></script>
  `;

  return htmlResponse(
    renderShell({ title: 'Graph', active: 'graph', email: session.email, body })
  );
}
