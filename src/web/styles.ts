export const NEBULA_CSS = `
:root {
  --bg: #0a0618;
  --bg-accent: #1a1438;
  --text: #e8dcff;
  --text-dim: rgba(232, 220, 255, 0.55);
  --border: rgba(180, 140, 255, 0.12);
  --surface: rgba(255, 255, 255, 0.03);
  --accent-lav: #b48cff;
  --accent-cyan: #8cc8ff;
  --accent-pink: #ff9ad5;
  --accent-violet: #a78bfa;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: radial-gradient(ellipse at 40% 30%, var(--bg-accent) 0%, var(--bg) 70%) fixed; color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif; min-height: 100vh; }
a { color: var(--accent-lav); text-decoration: none; }
a:hover { color: var(--text); }
.shell { display: flex; min-height: 100vh; }
.sidebar { width: 200px; flex-shrink: 0; padding: 24px 16px; border-right: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
.sidebar .logo { font-weight: 600; margin-bottom: 24px; letter-spacing: 0.3px; font-size: 15px; }
.sidebar .nav-item { padding: 9px 14px; border-radius: 8px; font-size: 14px; opacity: 0.6; }
.sidebar .nav-item.active { background: rgba(180, 140, 255, 0.18); color: var(--text); opacity: 1; }
.sidebar .nav-item:hover { opacity: 1; }
.sidebar .bottom { margin-top: auto; font-size: 12px; color: var(--text-dim); }
.sidebar .bottom form { margin-top: 4px; }
.sidebar .bottom button { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 0; font-size: 12px; }
.sidebar .bottom button:hover { color: var(--text); }
.main { flex: 1; padding: 32px 40px; min-width: 0; }
.main h1 { font-size: 24px; font-weight: 600; margin: 0 0 24px; }
.main h2 { font-size: 18px; font-weight: 500; margin: 24px 0 12px; }
.note-card { display: block; padding: 16px 18px; margin-bottom: 10px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); color: var(--text); }
.note-card:hover { border-color: rgba(180, 140, 255, 0.35); color: var(--text); }
.note-card .title { font-size: 15px; font-weight: 500; margin-bottom: 6px; }
.note-card .meta { font-size: 12px; color: var(--text-dim); }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: rgba(180, 140, 255, 0.15); color: var(--accent-lav); margin-right: 4px; }
.note-body { line-height: 1.7; font-size: 15px; }
.note-body pre { background: rgba(0,0,0,0.3); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
.note-body code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
.login-wrap { max-width: 360px; margin: 10vh auto; padding: 32px; }
.login-wrap h1 { text-align: center; }
.login-wrap label { display: block; margin-bottom: 14px; font-size: 13px; color: var(--text-dim); }
.login-wrap input { width: 100%; margin-top: 4px; padding: 10px 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 14px; }
.login-wrap button { width: 100%; padding: 12px; background: var(--accent-lav); color: #160a33; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
.error { color: #ff8a99; font-size: 13px; margin-bottom: 12px; }
`;
