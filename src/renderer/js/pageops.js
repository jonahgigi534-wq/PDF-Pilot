// Page management (add/remove/reorder/rotate) plus merge and split.
import { PDFDocument, degrees } from 'pdf-lib';
import { state, setStatus } from './state.js';
import { openBytes, onThumbBuilt, goToPage } from './viewer.js';
import { applyEdit } from './document.js';
import { showModal } from './modal.js';

const api = window.pdfpilot;

export async function movePage(n, delta) {
  const to = n - 1 + delta;
  if (to < 0 || to >= state.pageCount) return;
  await applyEdit('Move page', (doc) => {
    const page = doc.getPage(n - 1);
    doc.removePage(n - 1);
    doc.insertPage(to, page);
  });
  goToPage(n + delta);
}

export async function rotatePage(n) {
  await applyEdit('Rotate page', (doc) => {
    const page = doc.getPage(n - 1);
    page.setRotation(degrees((page.getRotation().angle + 90) % 360));
  });
}

export async function deletePage(n) {
  if (state.pageCount <= 1) {
    setStatus('Cannot delete the only page');
    return;
  }
  await applyEdit('Delete page', (doc) => {
    doc.removePage(n - 1);
  });
}

export async function insertBlankAfter(n) {
  await applyEdit('Insert blank page', (doc) => {
    const ref = doc.getPage(n - 1);
    doc.insertPage(n, [ref.getWidth(), ref.getHeight()]);
  });
}

export async function insertPdfAfter(n) {
  const paths = await api.openPdfDialog({ title: 'Insert pages from PDF' });
  if (!paths.length) return;
  const srcBytes = new Uint8Array(await api.readFile(paths[0]));
  await applyEdit('Insert PDF pages', async (doc) => {
    const src = await PDFDocument.load(srcBytes);
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((p, i) => doc.insertPage(n + i, p));
  });
}

// ---------------- merge ----------------

export async function mergePdfs(pathsOverride) {
  const paths = pathsOverride ?? await api.openPdfDialog({
    title: 'Choose PDFs to merge (appended in order)',
    multi: true,
  });
  if (!paths.length) return;

  if (state.bytes) {
    await applyEdit('Merge PDFs', async (doc) => {
      for (const p of paths) {
        const src = await PDFDocument.load(new Uint8Array(await api.readFile(p)));
        const pages = await doc.copyPages(src, src.getPageIndices());
        for (const page of pages) doc.addPage(page);
      }
    });
  } else {
    const doc = await PDFDocument.create();
    for (const p of paths) {
      const src = await PDFDocument.load(new Uint8Array(await api.readFile(p)));
      const pages = await doc.copyPages(src, src.getPageIndices());
      for (const page of pages) doc.addPage(page);
    }
    await openBytes(new Uint8Array(await doc.save()), null);
    state.dirty = true;
    setStatus('Merged — save the new document');
  }
}

// ---------------- split ----------------

// Parses "1-3; 4; 5-" into arrays of zero-based page indices.
export function parseRanges(text, pageCount) {
  const parts = text.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
  const groups = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)?\s*-\s*(\d+)?$|^(\d+)$/);
    if (!m) throw new Error(`Invalid range: "${part}"`);
    let from;
    let to;
    if (m[3]) {
      from = to = parseInt(m[3], 10);
    } else {
      from = m[1] ? parseInt(m[1], 10) : 1;
      to = m[2] ? parseInt(m[2], 10) : pageCount;
    }
    if (from < 1 || to > pageCount || from > to) throw new Error(`Range out of bounds: "${part}"`);
    const indices = [];
    for (let i = from; i <= to; i++) indices.push(i - 1);
    groups.push(indices);
  }
  if (!groups.length) throw new Error('No ranges given');
  return groups;
}

export async function splitPdf(rangesText, outDir) {
  if (!state.bytes) return;

  if (rangesText == null) {
    const values = await showModal({
      title: 'Split PDF',
      message: `Separate parts with ";". Example: 1-3; 4; 5-  (document has ${state.pageCount} pages)`,
      fields: [{ name: 'ranges', label: 'Page ranges', value: `1-${state.pageCount}` }],
      okText: 'Split',
    });
    if (!values) return;
    rangesText = values.ranges;
  }
  let groups;
  try {
    groups = parseRanges(rangesText, state.pageCount);
  } catch (err) {
    setStatus(err.message);
    return;
  }

  outDir = outDir ?? await api.pickDirDialog({ title: 'Choose folder for the split files' });
  if (!outDir) return;

  const base = (state.filePath ? state.filePath.split(/[\\/]/).pop() : 'document.pdf').replace(/\.pdf$/i, '');
  const src = await PDFDocument.load(state.bytes);
  let written = 0;
  for (const indices of groups) {
    const part = await PDFDocument.create();
    const pages = await part.copyPages(src, indices);
    for (const page of pages) part.addPage(page);
    const bytes = await part.save();
    written++;
    await api.writeFile(`${outDir}/${base}-part${written}.pdf`, new Uint8Array(bytes));
  }
  setStatus(`Split into ${written} file${written === 1 ? '' : 's'}`);
}

// ---------------- thumbnail hover actions ----------------

export function initPageOps() {
  onThumbBuilt((n, div) => {
    const bar = document.createElement('div');
    bar.className = 'thumb-actions';
    const actions = [
      ['↑', 'Move page up', () => movePage(n, -1)],
      ['↓', 'Move page down', () => movePage(n, +1)],
      ['⟳', 'Rotate 90°', () => rotatePage(n)],
      ['＋', 'Insert blank page after', () => insertBlankAfter(n)],
      ['⇪', 'Insert PDF after this page', () => insertPdfAfter(n)],
      ['✕', 'Delete page', () => deletePage(n)],
    ];
    for (const [text, title, fn] of actions) {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      bar.appendChild(b);
    }
    div.appendChild(bar);
  });

  document.getElementById('btn-merge').addEventListener('click', () => mergePdfs());
  document.getElementById('btn-split').addEventListener('click', () => splitPdf());
}
