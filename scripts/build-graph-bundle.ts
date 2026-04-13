import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

await build({
  entryPoints: [path.join(root, 'src/web/client/graph.ts')],
  outfile: path.join(root, 'assets/graph.bundle.js'),
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  loader: { '.ts': 'ts' },
});

console.log('built assets/graph.bundle.js');
