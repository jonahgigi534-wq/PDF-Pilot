// Generates build-resources/icon.ico fully offline:
// pdf-lib draws the icon -> the app's own renderer rasterises it to a 256px
// PNG -> the PNG is wrapped in an ICO container (Windows supports PNG-ICO).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = path.join(root, 'test', 'output', 'icon-work');
fs.mkdirSync(tmp, { recursive: true });

// 1. Draw the icon as a 256x256pt PDF page.
const doc = await PDFDocument.create();
const page = doc.addPage([256, 256]);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

// Rounded dark-blue square.
page.drawSvgPath(
  'M 48 0 H 208 Q 256 0 256 48 V 208 Q 256 256 208 256 H 48 Q 0 256 0 208 V 48 Q 0 0 48 0 Z',
  { x: 0, y: 256, color: rgb(0.12, 0.31, 0.58) },
);
// White "P".
const p = 'P';
const size = 168;
const w = bold.widthOfTextAtSize(p, size);
page.drawText(p, { x: (256 - w) / 2 - 12, y: 62, size, font: bold, color: rgb(1, 1, 1) });
// Paper-plane accent.
page.drawSvgPath('M 150 190 L 226 158 L 174 216 L 168 194 Z', {
  x: 0,
  y: 256,
  color: rgb(0.62, 0.78, 1),
});

const iconPdf = path.join(tmp, 'icon.pdf');
fs.writeFileSync(iconPdf, await doc.save());

// 2. Rasterise via the app's smoke harness (72 DPI on a 256pt page = 256px).
const res = spawnSync(
  electronPath,
  ['.', '--smoke', iconPdf, path.join(tmp, 'shot.png'), '--action', `exporticon:${path.relative(root, tmp).replaceAll('\\', '/')}`],
  { cwd: root, encoding: 'utf8', timeout: 90000 },
);
if (!(res.stdout || '').includes('SMOKE_OK')) {
  console.error(res.stdout, res.stderr);
  process.exit(1);
}
const png = fs.readFileSync(path.join(tmp, 'icon-page-001.png'));

// 3. Wrap the PNG in an ICO container.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(0, 6); // width 256
header.writeUInt8(0, 7); // height 256
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bpp
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18); // data offset

const outDir = path.join(root, 'build-resources');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), Buffer.concat([header, png]));
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('icon written -> build-resources/icon.ico');
