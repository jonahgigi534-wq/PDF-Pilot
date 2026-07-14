// Feature 13: password protect / remove password (via @cantoo/pdf-lib, an
// MIT-licensed pdf-lib fork with encryption) and true redaction (redacted
// pages are re-rendered as images with black boxes, permanently destroying
// the underlying text/content — not just visually covering it).
import { PDFDocument as EncryptablePDF } from '@cantoo/pdf-lib';
import { PDFDocument } from 'pdf-lib';
import { state, setStatus } from './state.js';
import { getPageView, onPageRendered, pdfRectToCss } from './viewer.js';
import { applyBytes } from './document.js';
import { registerTool } from './tools.js';
import { showModal } from './modal.js';
import { getPageIndex, itemCssRect } from './textindex.js';
import { renderPageCanvas, canvasToBytes } from './render-utils.js';

// ---------------- password protect / remove ----------------

export async function protectDialog() {
  if (!state.bytes) return;
  const values = await showModal({
    title: 'Password-protect PDF',
    message: 'The password will be required to open the document. There is no way to recover a lost password.',
    fields: [
      { name: 'pw', label: 'Password', type: 'password' },
      { name: 'confirm', label: 'Confirm password', type: 'password' },
    ],
    okText: 'Protect',
  });
  if (!values) return;
  if (!values.pw || values.pw !== values.confirm) {
    setStatus('Passwords are empty or do not match');
    return;
  }
  await protect(values.pw);
  setStatus('Password set — save the document to keep it');
}

export async function protect(password) {
  // Set the password first so the viewer can reload the freshly-encrypted
  // bytes without prompting; docPassword also blocks further edits.
  state.docPassword = password;
  try {
    await applyBytes('Protect with password', async (bytes) => {
      const doc = await EncryptablePDF.load(bytes);
      await doc.encrypt({ userPassword: password, ownerPassword: password });
      return doc.save();
    }, { allowEncrypted: true });
  } catch (err) {
    state.docPassword = null;
    throw err;
  }
}

export async function removePasswordDialog() {
  if (!state.bytes) return;
  let password = state.docPassword;
  if (!password) {
    const values = await showModal({
      title: 'Remove password',
      fields: [{ name: 'pw', label: 'Current password', type: 'password' }],
      okText: 'Remove',
    });
    if (!values) return;
    password = values.pw;
  }
  await removePassword(password);
}

export async function removePassword(password) {
  const prev = state.docPassword;
  state.docPassword = null; // decrypted bytes reload without a prompt
  try {
    await applyBytes('Remove password', async (bytes) => {
      const doc = await EncryptablePDF.load(bytes, { password });
      return doc.save();
    }, { allowEncrypted: true });
    setStatus('Password removed — save the document to keep it');
  } catch (err) {
    state.docPassword = prev;
    throw err;
  }
}

// ---------------- redaction ----------------

// pageNum -> array of PDF-space rects [x1, y1, x2, y2]
const pendingRedactions = new Map();

export function initSecurity() {
  registerTool('redact', {
    cursor: 'crosshair',
    overlayEvents: true,
    onPointerDown: redactStart,
    onPointerMove: redactMove,
    onPointerUp: redactEnd,
  });
  onPageRendered((n, view) => drawRedactionMarks(n, view));

  document.getElementById('btn-apply-redactions').addEventListener('click', applyRedactions);
  document.getElementById('btn-compress').addEventListener('click', async () => {
    const { compressDialog } = await import('./compress.js');
    compressDialog();
  });
  document.getElementById('btn-protect').addEventListener('click', protectDialog);
  document.getElementById('btn-remove-pw').addEventListener('click', removePasswordDialog);
  document.getElementById('btn-export-images').addEventListener('click', async () => {
    const { exportImagesDialog } = await import('./export-images.js');
    exportImagesDialog();
  });
}

let drag = null;

function redactStart(n, view, x, y, e) {
  try {
    view.overlay.setPointerCapture(e.pointerId);
  } catch { /* programmatic invocation */ }
  const marquee = document.createElement('div');
  marquee.className = 'marquee redact-marquee';
  view.overlay.appendChild(marquee);
  drag = { n, view, x0: x, y0: y, marquee };
}

function redactMove(n, view, x, y) {
  if (!drag) return;
  drag.marquee.style.left = `${Math.min(drag.x0, x)}px`;
  drag.marquee.style.top = `${Math.min(drag.y0, y)}px`;
  drag.marquee.style.width = `${Math.abs(x - drag.x0)}px`;
  drag.marquee.style.height = `${Math.abs(y - drag.y0)}px`;
}

function redactEnd(n, view, x, y) {
  if (!drag) return;
  const { n: dn, view: dview, x0, y0, marquee } = drag;
  drag = null;
  marquee.remove();
  if (Math.abs(x - x0) < 4 || Math.abs(y - y0) < 4) return;
  addRedaction(dn, dview, x0, y0, x, y);
}

export function addRedaction(n, view, x0, y0, x1, y1) {
  const [px0, py0] = view.viewport.convertToPdfPoint(x0, y0);
  const [px1, py1] = view.viewport.convertToPdfPoint(x1, y1);
  if (!pendingRedactions.has(n)) pendingRedactions.set(n, []);
  pendingRedactions.get(n).push([
    Math.min(px0, px1), Math.min(py0, py1), Math.max(px0, px1), Math.max(py0, py1),
  ]);
  drawRedactionMarks(n, view);
  updateRedactionButton();
  setStatus(`${countRedactions()} area(s) marked — click "Apply redactions" to permanently remove them`);
}

function countRedactions() {
  let c = 0;
  for (const rects of pendingRedactions.values()) c += rects.length;
  return c;
}

function updateRedactionButton() {
  const btn = document.getElementById('btn-apply-redactions');
  btn.disabled = countRedactions() === 0;
  btn.textContent = countRedactions() ? `Apply redactions (${countRedactions()})` : 'Apply redactions';
}

function drawRedactionMarks(n, view) {
  for (const el of view.overlay.querySelectorAll('.redact-mark')) el.remove();
  for (const rect of pendingRedactions.get(n) || []) {
    const css = pdfRectToCss(view.viewport, rect);
    const mark = document.createElement('div');
    mark.className = 'redact-mark';
    mark.title = 'Pending redaction — double-click to remove the mark';
    Object.assign(mark.style, {
      left: `${css.left}px`,
      top: `${css.top}px`,
      width: `${css.width}px`,
      height: `${css.height}px`,
    });
    mark.addEventListener('dblclick', () => {
      const rects = pendingRedactions.get(n) || [];
      pendingRedactions.set(n, rects.filter((r) => r !== rect));
      mark.remove();
      updateRedactionButton();
    });
    view.overlay.appendChild(mark);
  }
}

export async function applyRedactions({ skipConfirm = false } = {}) {
  if (!countRedactions()) return;
  if (!skipConfirm) {
    const ok = await showModal({
      title: 'Apply redactions',
      message: `${countRedactions()} area(s) will be blacked out PERMANENTLY. The affected pages are converted to images, so all their text, form fields and annotations are destroyed. This cannot be undone after saving.`,
      okText: 'Redact permanently',
    });
    if (!ok) return;
  }

  const DPI = 200;
  const replacements = []; // { index, jpg, width, height }
  for (const [n, rects] of pendingRedactions) {
    setStatus(`Redacting page ${n}…`);
    const view = getPageView(n);
    const base = view.page.getViewport({ scale: 1 });
    const { canvas, viewport } = await renderPageCanvas(n, DPI);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'black';
    for (const rect of rects) {
      const css = pdfRectToCss(viewport, rect);
      ctx.fillRect(css.left, css.top, css.width, css.height);
    }
    replacements.push({
      index: n - 1,
      jpg: await canvasToBytes(canvas, 'image/jpeg', 0.92),
      width: base.width,
      height: base.height,
      rotated: view.page.rotate % 180 !== 0,
    });
  }

  await applyBytes('Apply redactions', async (bytes) => {
    const doc = await PDFDocument.load(bytes);
    for (const rep of replacements) {
      const w = rep.rotated ? rep.height : rep.width;
      const h = rep.rotated ? rep.width : rep.height;
      const img = await doc.embedJpg(rep.jpg);
      doc.removePage(rep.index);
      const page = doc.insertPage(rep.index, [w, h]);
      page.drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
    return doc.save();
  });

  pendingRedactions.clear();
  updateRedactionButton();
  setStatus('Redactions applied — affected pages were flattened to images');
}

// Smoke helper: redact the text item containing `needle` on page n, then apply.
export async function smokeRedactText(n, needle) {
  const view = getPageView(n);
  const idx = await getPageIndex(n);
  const item = idx.items.find((it) => it.str.includes(needle));
  if (!item) throw new Error(`smokeRedactText: "${needle}" not found`);
  const r = itemCssRect(view, item);
  addRedaction(n, view, r.left - 4, r.top - 4, r.left + r.width + 4, r.top + r.height + 4);
  await applyRedactions({ skipConfirm: true });
}
