import Graph from 'graphology';
import Sigma from 'sigma';

interface GraphNode { id: string; label: string; domain: string; size: number; x: number; y: number; }
interface ExplicitEdge { id: string; source: string; target: string; type: 'explicit'; why: string; relation_type: string; }
interface SimilarEdge { id: string; source: string; target: string; type: 'similar'; score: number; }
type Edge = ExplicitEdge | SimilarEdge;
interface Payload { nodes: GraphNode[]; edges: Edge[]; }

// Stable color per domain using string hash → HSL hue in the nebula range.
function domainColor(domain: string): string {
  let h = 2166136261;
  for (let i = 0; i < domain.length; i++) h = Math.imul(h ^ domain.charCodeAt(i), 16777619);
  const hue = (h >>> 0) % 360;
  return `hsl(${hue}, 70%, 72%)`;
}

async function main() {
  const res = await fetch('/app/graph/data', { credentials: 'same-origin' });
  if (!res.ok) {
    document.getElementById('graph-count')!.textContent = 'Failed to load graph';
    return;
  }
  const payload = (await res.json()) as Payload;

  const container = document.getElementById('graph-canvas') as HTMLElement;
  const graph = new Graph({ type: 'undirected', multi: true });

  for (const n of payload.nodes) {
    graph.addNode(n.id, {
      label: n.label,
      x: n.x,
      y: n.y,
      size: 3 + n.size * 1.6,
      color: domainColor(n.domain),
    });
  }

  for (const e of payload.edges) {
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    graph.addEdgeWithKey(e.id, e.source, e.target, {
      type: 'line',
      size: e.type === 'explicit' ? 1.2 : 0.6,
      color: e.type === 'explicit' ? 'rgba(180, 140, 255, 0.55)' : 'rgba(140, 200, 255, 0.25)',
    });
  }

  const renderer = new Sigma(graph, container, {
    labelColor: { color: '#e8dcff' },
    labelSize: 12,
    labelWeight: '500',
    defaultNodeColor: '#b48cff',
    defaultEdgeColor: 'rgba(180, 140, 255, 0.35)',
    renderEdgeLabels: false,
    minCameraRatio: 0.1,
    maxCameraRatio: 10,
  });

  const explicitCount = payload.edges.filter((e) => e.type === 'explicit').length;
  const similarCount = payload.edges.length - explicitCount;
  document.getElementById('graph-count')!.textContent =
    `${payload.nodes.length} notes · ${explicitCount} explicit · ${similarCount} similar`;

  renderer.on('clickNode', ({ node }) => {
    window.location.href = `/app/notes/${encodeURIComponent(node)}`;
  });

  renderer.on('enterNode', ({ node }) => {
    const neighbors = new Set<string>();
    neighbors.add(node);
    graph.forEachNeighbor(node, (n) => neighbors.add(n));
    renderer.setSetting('nodeReducer' as any, (n: string, attrs: any) =>
      neighbors.has(n) ? attrs : { ...attrs, color: 'rgba(180, 140, 255, 0.15)', label: '' }
    );
    renderer.setSetting('edgeReducer' as any, (edge: string, attrs: any) => {
      const [s, t] = graph.extremities(edge);
      return neighbors.has(s) && neighbors.has(t) ? attrs : { ...attrs, hidden: true };
    });
  });
  renderer.on('leaveNode', () => {
    renderer.setSetting('nodeReducer' as any, null);
    renderer.setSetting('edgeReducer' as any, null);
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('graph-count');
  if (el) el.textContent = 'Error loading graph';
});
