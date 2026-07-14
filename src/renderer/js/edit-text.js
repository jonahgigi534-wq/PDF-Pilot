// Tier-1 inline editing: click existing text, edit it in an HTML overlay, then
// white-out the original and redraw matching text with pdf-lib. Also insert
// image and white-out (cover) tools.
import { StandardFonts, rgb } from 'pdf-lib';
import { state, setStatus } from './state.js';
import { getPageView } from './viewer.js';
import { getPageIndex, itemCssRect } from './textindex.js';
import { applyEdit } from './document.js';
import { registerTool, setTool } from './tools.js';
import { tryRemoveTextOp } from './pdf-utils.js';

const api = window.pdfpilot;
let editSession = null; // { input, n, item, fontMeta }

export function initEditTools() {
  registerTool('edit-text', {
    cursor: 'text',
    onPageClick: (n, view, x, y) => beginEditAt(n, view, x, y),
  });

  registerTool('insert-image', {
    cursor: 'crosshair',
    overlayEvents: true,
    activate: pickImage,
    onPageClick: (n, view, x, y) => placeImage(n, view, x, y),
  });

  registerTool('whiteout', {
    cursor: 'crosshair',
    overlayEvents: true,
    onPointerDown: startWhiteout,
    onPointerMove: moveWhiteout,
    onPointerUp: endWhiteout,
  });
}

// ---------------- inline text editing ----------------

async function findItemAt(n, view, x, y) {
  const idx = await getPageIndex(n);
  let best = null;
  for (const item of idx.items) {
    if (!item.str.trim() || !item.width) continue;
    const r = itemCssRect(view, item);
    if (x >= r.left - 2 && x <= r.left + r.width + 2 && y >= r.top - 2 && y <= r.top + r.height + 2) {
      // Prefer the smallest rect that contains the point (nested/overlapping items).
      if (!best || r.width * r.height < best.rect.width * best.rect.height) {
        best = { item, rect: r, styles: idx.styles };
      }
    }
  }
  return best;
}

async function pickStandardFont(view, item) {
  let name = '';
  let serif = false;
  let mono = false;
  try {
    const font = view.page.commonObjs.get(item.fontName);
    name = (font?.name || '').toLowerCase();
    serif = !!font?.isSerifFont;
    mono = !!font?.isMonospace;
  } catch {
    // Font not resolved yet; fall back to generic heuristics below.
  }
  if (/times|georgia|garamond|book|roman|serif/.test(name)) serif = true;
  if (/courier|mono|consolas/.test(name)) mono = true;
  const bold = /bold|black|heavy|semibold|demi/.test(name);
  const italic = /italic|oblique/.test(name);

  let key;
  if (mono) {
    key = bold && italic ? 'CourierBoldOblique' : bold ? 'CourierBold' : italic ? 'CourierOblique' : 'Courier';
  } else if (serif) {
    key = bold && italic ? 'TimesRomanBoldItalic' : bold ? 'TimesRomanBold' : italic ? 'TimesRomanItalic' : 'TimesRoman';
  } else {
    key = bold && italic ? 'HelveticaBoldOblique' : bold ? 'HelveticaBold' : italic ? 'HelveticaOblique' : 'Helvetica';
  }
  return { standardFont: StandardFonts[key], bold, italic, serif, mono };
}

async function beginEditAt(n, view, x, y) {
  cancelEdit();
  const found = await findItemAt(n, view, x, y);
  if (!found) return;
  const { item, rect } = found;
  const fontMeta = await pickStandardFont(view, item);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit';
  input.value = item.str;
  input.style.left = `${rect.left - 3}px`;
  input.style.top = `${rect.top - 3}px`;
  input.style.width = `${Math.max(rect.width + 40, 80)}px`;
  input.style.fontSize = `${rect.fontHeight}px`;
  input.style.fontFamily = fontMeta.mono
    ? 'Consolas, monospace'
    : fontMeta.serif
      ? 'Georgia, "Times New Roman", serif'
      : 'Arial, Helvetica, sans-serif';
  if (fontMeta.bold) input.style.fontWeight = 'bold';
  if (fontMeta.italic) input.style.fontStyle = 'italic';

  view.div.appendChild(input);
  editSession = { input, n, item, fontMeta };
  input.focus();
  input.select();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
    e.stopPropagation();
  });
  input.addEventListener('blur', () => commitEdit());
  input.addEventListener('click', (e) => e.stopPropagation());
}

function cancelEdit() {
  if (!editSession) return;
  const { input } = editSession;
  editSession = null;
  input.remove();
}

// WinAnsi-safe text for the pdf-lib standard fonts.
function sanitizeWinAnsi(text) {
  return text.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, '?');
}

async function commitEdit() {
  if (!editSession) return;
  const { input, n, item, fontMeta } = editSession;
  editSession = null;
  const newText = input.value;
  input.remove();
  if (newText === item.str) return;

  // PDF-space geometry straight from the text item's matrix.
  const [a, b, c, d, tx, ty] = item.transform;
  const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || 12;

  await applyEdit('Edit text', async (doc) => {
    const page = doc.getPage(n - 1);
    const font = await doc.embedFont(fontMeta.standardFont);
    // Try to strip the original text operator from the content stream so the
    // old text is really gone; fall back to covering it with a white box.
    const removed = tryRemoveTextOp(doc, page, item.str);
    if (!removed) {
      page.drawRectangle({
        x: tx - 1,
        y: ty - fontSize * 0.25,
        width: item.width + 2,
        height: fontSize * 1.25,
        color: rgb(1, 1, 1),
      });
    }
    if (newText.trim()) {
      page.drawText(sanitizeWinAnsi(newText), {
        x: tx,
        y: ty,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  });
  setStatus(newText.trim() ? 'Text edited' : 'Text removed');
}

// Exposed for smoke tests: edit the first item containing `find` on page `n`.
export async function smokeEditText(n, find, replace) {
  const view = getPageView(n);
  const idx = await getPageIndex(n);
  const item = idx.items.find((it) => it.str.includes(find));
  if (!item) throw new Error(`smokeEditText: "${find}" not found on page ${n}`);
  const r = itemCssRect(view, item);
  await beginEditAt(n, view, r.left + r.width / 2, r.top + r.height / 2);
  if (!editSession) throw new Error('smokeEditText: no edit session started');
  editSession.input.value = item.str.replace(find, replace);
  await commitEdit();
}

// ---------------- insert image ----------------

let pendingImage = null; // { bytes, isPng, width, height }

async function pickImage() {
  const paths = await api.openPdfDialog({
    title: 'Choose an image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (!paths.length) return false;
  const bytes = new Uint8Array(await api.readFile(paths[0]));
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const bitmap = await createImageBitmap(new Blob([bytes]));
  pendingImage = { bytes, isPng, width: bitmap.width, height: bitmap.height };
  bitmap.close();
  setStatus('Click on the page to place the image');
  return true;
}

async function placeImage(n, view, x, y) {
  if (!pendingImage) return;
  const img = pendingImage;
  pendingImage = null;
  const [px, py] = view.viewport.convertToPdfPoint(x, y);
  const targetW = Math.min(img.width * 0.75, 300); // points
  const targetH = targetW * (img.height / img.width);

  await applyEdit('Insert image', async (doc) => {
    const page = doc.getPage(n - 1);
    const embedded = img.isPng ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
    page.drawImage(embedded, {
      x: px - targetW / 2,
      y: py - targetH / 2,
      width: targetW,
      height: targetH,
    });
  });
  setTool('select');
}

// Smoke-test helpers driving the same code paths as the UI tools.
export async function smokeInsertImage(n, x, y) {
  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 60;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#cc2222';
  ctx.fillRect(0, 0, 80, 60);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  pendingImage = {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    isPng: true,
    width: 80,
    height: 60,
  };
  await placeImage(n, getPageView(n), x, y);
}

export async function smokeWhiteout(n, x0, y0, x1, y1) {
  const view = getPageView(n);
  startWhiteout(n, view, x0, y0, { pointerId: undefined });
  moveWhiteout(n, view, x1, y1);
  await endWhiteout(n, view, x1, y1);
}

// ---------------- white-out (cover) ----------------

let drag = null; // { n, view, x0, y0, marquee }

function startWhiteout(n, view, x, y, e) {
  try {
    view.overlay.setPointerCapture(e.pointerId);
  } catch {
    // No live pointer (programmatic/smoke invocation) — capture is best-effort.
  }
  const marquee = document.createElement('div');
  marquee.className = 'marquee whiteout-marquee';
  view.overlay.appendChild(marquee);
  drag = { n, view, x0: x, y0: y, marquee };
  moveWhiteout(n, view, x, y);
}

function moveWhiteout(n, view, x, y) {
  if (!drag) return;
  const l = Math.min(drag.x0, x);
  const t = Math.min(drag.y0, y);
  drag.marquee.style.left = `${l}px`;
  drag.marquee.style.top = `${t}px`;
  drag.marquee.style.width = `${Math.abs(x - drag.x0)}px`;
  drag.marquee.style.height = `${Math.abs(y - drag.y0)}px`;
}

async function endWhiteout(n, view, x, y) {
  if (!drag) return;
  const { n: dn, view: dview, x0, y0, marquee } = drag;
  drag = null;
  marquee.remove();
  if (Math.abs(x - x0) < 4 || Math.abs(y - y0) < 4) return;

  const [p1x, p1y] = dview.viewport.convertToPdfPoint(x0, y0);
  const [p2x, p2y] = dview.viewport.convertToPdfPoint(x, y);
  await applyEdit('White-out area', async (doc) => {
    const page = doc.getPage(dn - 1);
    page.drawRectangle({
      x: Math.min(p1x, p2x),
      y: Math.min(p1y, p2y),
      width: Math.abs(p2x - p1x),
      height: Math.abs(p2y - p1y),
      color: rgb(1, 1, 1),
    });
  });
}
