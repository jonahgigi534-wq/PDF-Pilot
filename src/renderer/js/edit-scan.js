// "Edit scanned text" — Acrobat-style editing of image/photocopied pages.
// Clicking a scanned line runs OCR on the page (once, cached), lets the user
// retype the recognised text in an overlay, then on commit paints over the
// original scanned pixels with the sampled background colour and redraws the
// edited text as real, selectable vector text. Great on clean printed scans;
// substituted font won't perfectly match the original (same trade-off Acrobat
// makes). Handwriting is not reliable — that's an OCR limitation.
import {
  StandardFonts, rgb, PDFOperator, PDFOperatorNames, PDFNumber,
} from 'pdf-lib';
import { setStatus } from './state.js';
import { getPageView, pdfRectToCss, onDocChanged } from './viewer.js';
import { applyEdit } from './document.js';
import { registerTool } from './tools.js';
import { recognizePage } from './ocr.js';

// pageNum -> { lines: [{ text, pdfRect:[x1,y1,x2,y2], bg:{r,g,b} }] }
const cache = new Map();
let session = null; // { input, n, line }

export function initEditScan() {
  registerTool('edit-scan', {
    cursor: 'text',
    onPageClick: (n, view, x, y) => beginScanEdit(n, view, x, y),
  });
  // Page geometry/content changes after any edit — drop cached OCR.
  onDocChanged(() => cache.clear());
}

async function ensurePageOcr(n) {
  if (cache.has(n)) return cache.get(n);
  setStatus(`Recognising text on page ${n}… (local OCR, a few seconds)`);
  const { lines, viewport, canvas } = await recognizePage(n);
  const ctx = canvas.getContext('2d');
  const entries = lines.map((line) => {
    const pts = line.box.map(([px, py]) => viewport.convertToPdfPoint(px, py));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return {
      text: line.text,
      pdfRect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      bg: sampleBackground(ctx, line.box),
    };
  });
  const entry = { lines: entries };
  cache.set(n, entry);
  setStatus(entries.length
    ? `Recognised ${entries.length} line(s) — click any to edit`
    : 'No recognisable text found on this page');
  return entry;
}

// Estimates paper colour: the brightest ~40% of pixels inside the text box
// (paper is lighter than ink), averaged. Handles off-white/coloured scans.
function sampleBackground(ctx, box) {
  const xs = box.map((p) => p[0]);
  const ys = box.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(ctx.canvas.width - x0, Math.ceil(Math.max(...xs)) - x0);
  const h = Math.min(ctx.canvas.height - y0, Math.ceil(Math.max(...ys)) - y0);
  if (w <= 0 || h <= 0) return { r: 1, g: 1, b: 1 };

  const data = ctx.getImageData(x0, y0, w, h).data;
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    px.push([0.299 * r + 0.587 * g + 0.114 * b, r, g, b]);
  }
  px.sort((a, b) => b[0] - a[0]);
  const take = Math.max(1, Math.floor(px.length * 0.4));
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < take; i++) {
    r += px[i][1];
    g += px[i][2];
    b += px[i][3];
  }
  return { r: r / take / 255, g: g / take / 255, b: b / take / 255 };
}

async function beginScanEdit(n, view, cssX, cssY) {
  cancelScanEdit();
  const entry = await ensurePageOcr(n);
  const [pdfX, pdfY] = view.viewport.convertToPdfPoint(cssX, cssY);
  const line = entry.lines.find((l) => {
    const [x1, y1, x2, y2] = l.pdfRect;
    return pdfX >= x1 - 2 && pdfX <= x2 + 2 && pdfY >= y1 - 2 && pdfY <= y2 + 2;
  });
  if (!line) {
    setStatus('No recognised text there — click directly on a line of text');
    return;
  }

  const css = pdfRectToCss(view.viewport, line.pdfRect);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit';
  input.value = line.text;
  input.style.left = `${css.left - 2}px`;
  input.style.top = `${css.top - 2}px`;
  input.style.width = `${Math.max(css.width + 60, 100)}px`;
  input.style.fontSize = `${Math.max(10, css.height * 0.8)}px`;
  view.div.appendChild(input);
  session = { input, n, line };
  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitScanEdit();
    } else if (e.key === 'Escape') {
      cancelScanEdit();
    }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => commitScanEdit());
  input.addEventListener('click', (e) => e.stopPropagation());
}

function cancelScanEdit() {
  if (!session) return;
  session.input.remove();
  session = null;
}

function sanitizeWinAnsi(text) {
  return text.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, '?');
}

async function commitScanEdit() {
  if (!session) return;
  const { input, n, line } = session;
  session = null;
  const newText = input.value;
  input.remove();
  if (newText === line.text) return;

  const [x1, y1, x2, y2] = line.pdfRect;
  const width = x2 - x1;
  const height = y2 - y1;
  const size = height * 0.72;

  await applyEdit('Edit scanned text', async (doc) => {
    const page = doc.getPage(n - 1);
    const font = await doc.embedFont(StandardFonts.Helvetica);

    // Cover the original scanned pixels with the sampled paper colour.
    page.drawRectangle({
      x: x1 - 1,
      y: y1 - 1,
      width: width + 2,
      height: height + 2,
      color: rgb(line.bg.r, line.bg.g, line.bg.b),
    });

    const text = sanitizeWinAnsi(newText).trim();
    if (!text) return;

    // Squeeze/stretch horizontally so the replacement fills the original box.
    const natural = font.widthOfTextAtSize(text, size) || 1;
    const hscale = Math.min(300, Math.max(30, (width / natural) * 100));
    page.pushOperators(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(hscale)]));
    page.drawText(text, {
      x: x1,
      y: y1 + height * 0.2,
      size,
      font,
      color: rgb(0.08, 0.08, 0.08),
    });
    page.pushOperators(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(100)]));
  });
  setStatus('Scanned text replaced with editable text');
}

// Smoke helper: OCR page n, replace the line containing `needle` with `replacement`.
export async function smokeEditScan(n, needle, replacement) {
  const view = getPageView(n);
  const entry = await ensurePageOcr(n);
  const line = entry.lines.find((l) => l.text.replace(/\s+/g, '').includes(needle.replace(/\s+/g, '')));
  if (!line) throw new Error(`smokeEditScan: "${needle}" not recognised; got: ${entry.lines.map((l) => l.text).join(' | ')}`);
  const css = pdfRectToCss(view.viewport, line.pdfRect);
  await beginScanEdit(n, view, css.left + css.width / 2, css.top + css.height / 2);
  if (!session) throw new Error('smokeEditScan: no edit session started');
  session.input.value = replacement;
  await commitScanEdit();
}
