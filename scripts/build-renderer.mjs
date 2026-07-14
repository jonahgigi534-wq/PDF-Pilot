// Builds the renderer bundle with esbuild and stages static assets into dist/renderer.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist', 'renderer');
const pdfjsDir = path.join(root, 'node_modules', 'pdfjs-dist');

fs.mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src', 'renderer', 'js', 'app.js')],
  bundle: true,
  format: 'esm',
  outfile: path.join(dist, 'app.js'),
  sourcemap: true,
  target: 'chrome132',
  logLevel: 'warning',
});

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Copies a directory once; pdfjs assets never change between builds of the same version.
function copyDirOnce(src, dest) {
  if (fs.existsSync(dest)) return;
  fs.cpSync(src, dest, { recursive: true });
}

for (const f of ['index.html', 'styles.css']) {
  copyFile(path.join(root, 'src', 'renderer', f), path.join(dist, f));
}

copyFile(
  path.join(pdfjsDir, 'build', 'pdf.worker.min.mjs'),
  path.join(dist, 'pdfjs', 'pdf.worker.min.mjs'),
);
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  copyDirOnce(path.join(pdfjsDir, dir), path.join(dist, 'pdfjs', dir));
}

// Static assets (icons, fonts) shipped with the app.
const assetsSrc = path.join(root, 'assets');
if (fs.existsSync(assetsSrc)) {
  fs.cpSync(assetsSrc, path.join(dist, 'assets'), { recursive: true });
}

console.log('renderer built -> dist/renderer');
