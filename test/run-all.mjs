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

export function runSmoke(inputPdf, outPng, action, extraArgs = [], env = {}) {
  const args = ['.', '--smoke', inputPdf, outPng, ...extraArgs];
  if (action) args.push('--action', action);
  const res = spawnSync(electronPath, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, ...env },
  });
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

test('annotations: markup keeps text and adds highlight blend', async () => {
  const out = path.join(output, 'annot-markup.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-annot-markup.png'), `annot-markup:${rel(out)}`);
  const text = await pageText(out, 1);
  assert(text.includes('quick brown fox'), 'highlighted text still extractable');
  assert(text.includes('MARKER-P1'), 'struck text still extractable');
  const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(out));
  const res = doc.getPage(0).node.Resources();
  const egs = res?.lookup?.(PDFName.of('ExtGState'));
  let hasMultiply = false;
  if (egs instanceof PDFDict) {
    for (const [, ref] of egs.entries()) {
      const gs = doc.context.lookup(ref);
      if (gs instanceof PDFDict && gs.get(PDFName.of('BM')) === PDFName.of('Multiply')) {
        hasMultiply = true;
      }
    }
  }
  assert(hasMultiply, 'highlight uses Multiply blend mode in ExtGState');
});

test('annotations: sticky note is a real /Text annotation', async () => {
  const out = path.join(output, 'annot-note.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-annot-note.png'), `annot-note:${rel(out)}`);
  const found = await withDoc(out, async (doc) => {
    const page = await doc.getPage(1);
    const annots = await page.getAnnotations();
    return annots.find((a) => a.subtype === 'Text');
  });
  assert(found, 'text annotation present');
  const contents = found.contentsObj?.str ?? found.contents;
  assert(contents === 'Smoke note text', `note contents preserved, got: ${contents}`);
});

test('annotations: drawing/shapes/textbox render into page', async () => {
  const out = path.join(output, 'annot-drawing.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-annot-drawing.png'), `annot-drawing:${rel(out)}`);
  const text = await pageText(out, 1);
  assert(text.includes('TEXTBOX-99-SMOKE'), 'text box content present');
});

test('fillform: values written into AcroForm fields', async () => {
  const out = path.join(output, 'filled-form.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample-form.pdf'), path.join(output, 't-fillform.png'), `fillform:${rel(out)}`);
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(out));
  const form = doc.getForm();
  assert(form.getTextField('name').getText() === 'Jane Tester', 'text field value');
  assert(form.getCheckBox('agree').isChecked(), 'checkbox checked');
  assert(form.getDropdown('colour').getSelected()[0] === 'Blue', 'dropdown selection');
  assert(form.getRadioGroup('size').getSelected() === 'L', 'radio selection');
});

test('createform: fields created with correct types', async () => {
  const out = path.join(output, 'created-form.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-createform.png'), `createform:${rel(out)}`);
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(out));
  const form = doc.getForm();
  assert(form.getTextField('created_text'), 'text field exists');
  assert(form.getCheckBox('created_check'), 'checkbox exists');
  const dd = form.getDropdown('created_drop');
  assert(dd.getOptions().join(',') === 'A,B,C', 'dropdown options');
  const sig = form.acroForm.getAllFields().find(([f]) => {
    return f.dict.get(PDFName.of('FT')) === PDFName.of('Sig');
  });
  assert(sig, 'signature field exists in AcroForm');
});

test('esign: signature image embedded on page', async () => {
  const out = path.join(output, 'signed.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-esign.png'), `esign:${rel(out)}`);
  const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(out));
  const xobj = doc.getPage(0).node.Resources()?.lookup?.(PDFName.of('XObject'));
  assert(xobj instanceof PDFDict && [...xobj.entries()].length >= 1, 'page 1 has an image XObject');
});

test('compress: lossless keeps text, rasterize flattens it', async () => {
  const outA = path.join(output, 'compressed-lossless.pdf');
  const outB = path.join(output, 'compressed-lossy.pdf');
  fs.rmSync(outA, { force: true });
  fs.rmSync(outB, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-compress1.png'), `compress-lossless:${rel(outA)}`);
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-compress2.png'), `compress-lossy:${rel(outB)}`);
  assert(await pageCount(outA) === 5, 'lossless keeps page count');
  assert((await pageText(outA, 1)).includes('MARKER-P1'), 'lossless keeps text');
  assert(await pageCount(outB) === 5, 'rasterize keeps page count');
  assert((await pageText(outB, 1)).trim() === '', 'rasterize flattens text to image');
});

test('protect: password required to open', async () => {
  const out = path.join(output, 'protected.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-protect.png'), `protect:secret123|${rel(out)}`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let rejected = false;
  try {
    await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(out)) }).promise;
  } catch (e) {
    rejected = e.name === 'PasswordException';
  }
  assert(rejected, 'opening without password throws PasswordException');
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(out)), password: 'secret123' });
  const doc = await task.promise;
  assert(doc.numPages === 5, 'opens with password');
  await task.destroy();
});

test('removepw: decrypts an encrypted document', async () => {
  // Build an encrypted input, then remove its password through the app.
  const encIn = path.join(output, 'enc-input.pdf');
  const out = path.join(output, 'decrypted.pdf');
  fs.rmSync(out, { force: true });
  const { PDFDocument: Enc } = await import('@cantoo/pdf-lib');
  const doc = await Enc.load(fs.readFileSync(path.join(samples, 'sample.pdf')));
  await doc.encrypt({ userPassword: 'topsecret', ownerPassword: 'topsecret' });
  fs.writeFileSync(encIn, await doc.save());

  runSmoke(encIn, path.join(output, 't-removepw.png'), `removepw:topsecret|${rel(out)}`, ['--pw', 'topsecret']);
  assert(await pageCount(out) === 5, 'decrypted file opens without password');
  assert((await pageText(out, 1)).includes('MARKER-P1'), 'content intact after decryption');
});

test('redact: permanently removes text from the page', async () => {
  const out = path.join(output, 'redacted.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-redact.png'), `redact:${rel(out)}`);
  assert(await pageCount(out) === 5, 'page count preserved');
  const p1 = await pageText(out, 1);
  assert(!p1.includes('MARKER-P1'), 'redacted text is gone from extraction');
  assert(p1.trim() === '', 'redacted page was flattened to an image');
  assert((await pageText(out, 2)).includes('MARKER-P2'), 'other pages untouched');
});

test('exportimages: writes PNG files', async () => {
  const outDir = path.join(output, 'images');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-export.png'), `exportimages:${rel(outDir)}`);
  for (const f of ['sample-page-001.png', 'sample-page-002.png']) {
    const bytes = fs.readFileSync(path.join(outDir, f));
    assert(bytes[0] === 0x89 && bytes[1] === 0x50, `${f} is a PNG`);
    assert(bytes.length > 5000, `${f} has content`);
  }
});

test('ocr: sidecar adds searchable invisible text to a scanned PDF', async () => {
  const scanned = path.join(output, 'scanned.pdf');
  const out = path.join(output, 'ocr-out.pdf');
  fs.rmSync(scanned, { force: true });
  fs.rmSync(out, { force: true });

  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-scanned.png'), `make-scanned:${rel(scanned)}`);
  assert((await pageText(scanned, 1)).trim() === '', 'scanned PDF starts with no text layer');

  runSmoke(scanned, path.join(output, 't-ocr.png'), `ocr:1|${rel(out)}`);
  const text = await pageText(out, 1);
  assert(/MARKER[-–]?P1/i.test(text), `OCR text contains the page marker, got: ${text.slice(0, 200)}`);
  assert(/quick\s?brown\s?fox/i.test(text.replace(/\s+/g, ' ')), 'OCR captured the paragraph text');
  assert((await pageText(out, 2)).trim() === '', 'non-OCRed pages unchanged');
});

test('ocr-fallback: Tesseract.js used when the sidecar is unavailable', async () => {
  const scanned = path.join(output, 'scanned.pdf');
  const out = path.join(output, 'ocr-fallback-out.pdf');
  fs.rmSync(out, { force: true });
  assert(fs.existsSync(scanned), 'scanned.pdf exists (ocr test ran first)');

  runSmoke(scanned, path.join(output, 't-ocr-fallback.png'), `ocr:1|${rel(out)}`, [], {
    PDFPILOT_NO_SIDECAR: '1',
  });
  const text = await pageText(out, 1);
  assert(/MARKER/i.test(text), `fallback OCR found the marker, got: ${text.slice(0, 200)}`);
});

const MOCK_SOFFICE = { PDFPILOT_SOFFICE: path.join(root, 'test', 'mock-soffice.cmd') };

test('wordmode: page round-trips through soffice and is replaced', async () => {
  const out = path.join(output, 'wordmode.pdf');
  fs.rmSync(out, { force: true });
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-wordmode.png'), `wordmode:${rel(out)}`, [], MOCK_SOFFICE);
  assert(await pageCount(out) === 5, 'page count preserved');
  assert((await pageText(out, 2)).includes('WORDMODE-EDITED-PAGE'), 'page 2 replaced by re-imported edit');
  assert((await pageText(out, 1)).includes('MARKER-P1'), 'page 1 untouched');
  assert((await pageText(out, 3)).includes('MARKER-P3'), 'page 3 untouched');
});

test('convert: pdf→word, word→pdf, images→pdf', async () => {
  const docxOut = path.join(output, 'converted.docx');
  const wordIn = path.join(output, 'dummy.docx');
  const pdfOut = path.join(output, 'from-word.pdf');
  const imgOut = path.join(output, 'from-image.pdf');
  for (const f of [docxOut, pdfOut, imgOut]) fs.rmSync(f, { force: true });
  fs.writeFileSync(wordIn, 'not a real docx — mock ignores content');

  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-pdf2word.png'), `pdf2word:${rel(docxOut)}`, [], MOCK_SOFFICE);
  assert(fs.readFileSync(docxOut, 'utf8').startsWith('MOCKDOCX'), 'pdf→word wrote the converted docx');

  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-word2pdf.png'), `word2pdf:${rel(wordIn)}|${rel(pdfOut)}`, [], MOCK_SOFFICE);
  assert((await pageText(pdfOut, 1)).includes('WORDMODE-EDITED-PAGE'), 'word→pdf opened converted PDF');

  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-img2pdf.png'), `img2pdf:build-resources/icon.png|${rel(imgOut)}`, [], MOCK_SOFFICE);
  assert(await pageCount(imgOut) === 1, 'images→pdf produced one page');
  const { PDFDocument, PDFName, PDFDict } = await import('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(imgOut));
  const xobj = doc.getPage(0).node.Resources()?.lookup?.(PDFName.of('XObject'));
  assert(xobj instanceof PDFDict && [...xobj.entries()].length === 1, 'image embedded');
});

test('sidebar: resizes and search filters tools', async () => {
  // "password" should match Protect… ("Set an open password") and
  // Remove password by label/description, hiding unrelated tools.
  const out = runSmoke(
    path.join(samples, 'sample.pdf'),
    path.join(output, 't-sidebar.png'),
    'sidebar:240,password',
  );
  const m = out.match(/\[sidebar-smoke\] (\{.*\})/);
  assert(m, 'sidebar smoke reported counts');
  const info = JSON.parse(m[1]);
  assert(info.visible >= 2 && info.visible < info.total, `password filter narrows tools (${info.visible}/${info.total})`);
  assert(info.labels.some((l) => l.includes('Protect')), 'Protect… matches "password"');
  assert(info.labels.some((l) => l.includes('Remove password')), 'Remove password matches');
  assert(!info.labels.some((l) => l.includes('Highlight')), 'unrelated tools hidden');
});

test('editscan: OCR-to-editable turns a scanned line into real editable text', async () => {
  const scanned = path.join(output, 'scanned-edit.pdf');
  const out = path.join(output, 'editscan-out.pdf');
  fs.rmSync(scanned, { force: true });
  fs.rmSync(out, { force: true });

  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-scanned-edit.png'), `make-scanned:${rel(scanned)}`);
  assert((await pageText(scanned, 1)).trim() === '', 'scanned input has no text layer');

  runSmoke(scanned, path.join(output, 't-editscan.png'), `editscan:${rel(out)}`);
  const text = await pageText(out, 1);
  assert(text.includes('EDITED-SCAN-OK'), `edited line is now real, extractable text; got: ${text.slice(0, 200)}`);
  assert(!/Unique marker/i.test(text), 'the original recognised line was replaced, not appended');
});

test('print: pages render and reach the print window (dry run)', async () => {
  runSmoke(path.join(samples, 'sample.pdf'), path.join(output, 't-print.png'), 'printprep');
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
