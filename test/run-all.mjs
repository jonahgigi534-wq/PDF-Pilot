// Automated feature tests. Each test drives the real app via the smoke harness
// (Electron renders + executes a scripted UI action), then verifies the
// resulting PDF bytes in Node. Usage: node test/run-all.mjs [filter]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const samples = path.join(root, 'test', 'samples');
const output = path.join(root, 'test', 'output');
fs.mkdirSync(output, { recursive: true });

const rel = (p) => path.relative(root, p).replaceAll('\\', '/');

export function runSmoke(inputPdf, outPng, action) {
  const args = ['.', '--smoke', inputPdf, outPng];
  if (action) args.push('--action', action);
  const res = spawnSync(electronPath, args, { cwd: root, encoding: 'utf8', timeout: 90000 });
  const out = (res.stdout || '') + (res.stderr || '');
  if (!out.includes('SMOKE_OK')) {
    throw new Error(`smoke failed (${action || 'render'}):\n${out}`);
  }
  return out;
}

export async function withDoc(pdfPath, fn) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const task = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  try {
    return await fn(doc);
  } finally {
    await task.destroy();
  }
}

export async function pageText(pdfPath, pageNum) {
  return withDoc(pdfPath, async (doc) => {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    return content.items.map((i) => i.str ?? '').join(' ');
  });
}

export async function pageCount(pdfPath) {
  return withDoc(pdfPath, (doc) => doc.numPages);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// ---------------- tests ----------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('viewer: renders and searches', async () => {
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-viewer.png'), 'search:MARKER-P3');
});

test('edittext: inline edit replaces text in saved PDF', async () => {
  const out = path.join(output, 'edited.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-edit.png'), `edittext:${rel(out)}`);
  const text = await pageText(out, 1);
  assert(text.includes('EDITED-42-OK'), `edited text present, got: ${text.slice(0, 300)}`);
  assert(!text.includes('MARKER-P1-XYZ'), 'original text removed from text layer');
});

test('edittext: undo restores original bytes', async () => {
  const out = path.join(output, 'edited-undone.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-edit-undo.png'), `edittext-undo:${rel(out)}`);
  const text = await pageText(out, 1);
  assert(text.includes('MARKER-P1-XYZ'), 'original text restored after undo');
  assert(!text.includes('EDITED-42-OK'), 'edited text gone after undo');
});

test('pageops: insert/rotate/move/delete', async () => {
  const out = path.join(output, 'pageops.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-pageops.png'), `pageops:${rel(out)}`);
  // [P1..P5] -> +blank after 1 -> rotate page3(P2) -> move page6(P5) up -> delete page4(P3)
  // Expected: [P1, blank, P2(rot90), P5, P4]
  assert(await pageCount(out) === 5, 'page count is 5');
  assert((await pageText(out, 2)).trim() === '', 'page 2 is the inserted blank');
  assert((await pageText(out, 3)).includes('MARKER-P2'), 'page 3 is old P2');
  assert((await pageText(out, 4)).includes('MARKER-P5'), 'page 4 is old P5 (moved up)');
  assert((await pageText(out, 5)).includes('MARKER-P4'), 'page 5 is old P4');
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(out));
  assert(doc.getPage(2).getRotation().angle === 90, 'page 3 rotated 90°');
});

test('merge: appends second document', async () => {
  const out = path.join(output, 'merged.pdf');
  fs.rmSync(out, { force: true });
  const src2 = path.join(samples, 'sample2.pdf');
  runSmoke(
    path.join(samples, 'sample.pdf'),
    path.join(output, 't-merge.png'),
    `merge:${rel(src2)}|${rel(out)}`,
  );
  assert(await pageCount(out) === 8, 'merged count is 5+3');
  assert((await pageText(out, 6)).includes('Second document'), 'page 6 comes from sample2');
});

test('split: writes range files', async () => {
  const outDir = path.join(output, 'split');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  runSmoke(
    path.join(samples, 'sample.pdf'),
    path.join(output, 't-split.png'),
    `split:1-2;3-5|${rel(outDir)}`,
  );
  assert(await pageCount(path.join(outDir, 'sample-part1.pdf')) === 2, 'part1 has 2 pages');
  assert(await pageCount(path.join(outDir, 'sample-part2.pdf')) === 3, 'part2 has 3 pages');
  assert((await pageText(path.join(outDir, 'sample-part2.pdf'), 1)).includes('MARKER-P3'), 'part2 starts at page 3');
});

// ---------------- runner ----------------

const filter = process.argv[2];
let failed = 0;
console.log('regenerating samples…');
spawnSync(process.execPath, [path.join(root, 'test', 'make-samples.mjs')], { stdio: 'inherit' });

for (const t of tests) {
  if (filter && !t.name.includes(filter)) continue;
  try {
    await t.fn();
    console.log(`PASS  ${t.name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${t.name}\n      ${err.message}`);
  }
}
process.exit(failed ? 1 : 0);
