// Annotations: text markup (highlight/underline/strikethrough), sticky notes,
// freehand drawing, shapes, and text boxes. All annotations are committed to
// the document bytes immediately (undoable via the snapshot stack); sticky
// notes become real /Text annotations so other viewers show them too.
import { rgb, BlendMode, StandardFonts, PDFName, PDFArray, PDFString, PDFHexString } from 'pdf-lib';
import { state, setStatus } from './state.js';
import { getPageView, eachPageView, onPageRendered, pdfRectToCss } from './viewer.js';
import { applyEdit } from './document.js';
import { registerTool, activeTool, setTool } from './tools.js';
import { showModal } from './modal.js';

const MARKUP_TOOLS = new Set(['highlight', 'underline', 'strikethrough']);

function annotColor() {
  const hex = document.getElementById('annot-color')?.value || '#e02020';
  return rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );
}

export function initAnnotations() {
  for (const t of MARKUP_TOOLS) {
    registerTool(t, { cursor: 'text' });
  }
  registerTool('note', {
    cursor: 'copy',
    overlayEvents: true,
    onPageClick: addNoteAt,
  });
  registerTool('draw', {
    cursor: 'crosshair',
    overlayEvents: true,
    onPointerDown: drawStart,
    onPointerMove: drawMove,
    onPointerUp: drawEnd,
  });
  for (const shape of ['rect', 'ellipse', 'line']) {
    registerTool(`shape-${shape}`, {
      cursor: 'crosshair',
      overlayEvents: true,
      onPointerDown: (n, v, x, y, e) => shapeStart(shape, n, v, x, y, e),
      onPointerMove: shapeMove,
      onPointerUp: shapeEnd,
    });
  }
  registerTool('textbox', {
    cursor: 'text',
    overlayEvents: true,
    onPageClick: beginTextbox,
  });

  // Text markup applies on mouseup over a live selection.
  document.addEventListener('mouseup', () => {
    if (!MARKUP_TOOLS.has(activeTool())) return;
    setTimeout(() => applyMarkupFromSelection(activeTool()), 10);
  });

  onPageRendered((n, view) => renderNoteIcons(n, view));
}

// ---------------- text markup ----------------

export async function applyMarkupFromSelection(kind) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const clientRects = Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1);
  if (!clientRects.length) return;

  // Assign rects to pages and convert to page-local CSS coords.
  const perPage = new Map();
  eachPageView((n, view) => {
    if (!view.rendered) return;
    const pr = view.div.getBoundingClientRect();
    for (const r of clientRects) {
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (cx < pr.left || cx > pr.right || cy < pr.top || cy > pr.bottom) continue;
      if (!perPage.has(n)) perPage.set(n, []);
      perPage.get(n).push({
        left: r.left - pr.left,
        top: r.top - pr.top,
        right: r.right - pr.left,
        bottom: r.bottom - pr.top,
      });
    }
  });
  if (!perPage.size) return;

  const color = kind === 'highlight' ? rgb(1, 0.85, 0.1) : annotColor();
  sel.removeAllRanges();

  await applyEdit(
    kind === 'highlight' ? 'Highlight' : kind === 'underline' ? 'Underline' : 'Strikethrough',
    (doc) => {
      for (const [n, rects] of perPage) {
        const page = doc.getPage(n - 1);
        const view = getPageView(n);
        for (const r of mergeLineRects(rects)) {
          const [x1, y1] = view.viewport.convertToPdfPoint(r.left, r.top);
          const [x2, y2] = view.viewport.convertToPdfPoint(r.right, r.bottom);
          const left = Math.min(x1, x2);
          const right = Math.max(x1, x2);
          const bottom = Math.min(y1, y2);
          const top = Math.max(y1, y2);
          if (kind === 'highlight') {
            page.drawRectangle({
              x: left,
              y: bottom,
              width: right - left,
              height: top - bottom,
              color,
              blendMode: BlendMode.Multiply,
            });
          } else {
            const y = kind === 'underline' ? bottom + (top - bottom) * 0.08 : (top + bottom) / 2;
            page.drawLine({
              start: { x: left, y },
              end: { x: right, y },
              thickness: Math.max(0.8, (top - bottom) * 0.07),
              color,
            });
          }
        }
      }
    },
  );
}

// Merges fragment rects that sit on the same text line.
function mergeLineRects(rects) {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines = [];
  for (const r of sorted) {
    const h = r.bottom - r.top;
    const line = lines.find((l) => Math.abs(l.top - r.top) < h * 0.6);
    if (line) {
      line.left = Math.min(line.left, r.left);
      line.right = Math.max(line.right, r.right);
      line.top = Math.min(line.top, r.top);
      line.bottom = Math.max(line.bottom, r.bottom);
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

// ---------------- sticky notes ----------------

const NOTE_SIZE = 20; // PDF points

async function addNoteAt(n, view, x, y) {
  const values = await showModal({
    title: 'Add sticky note',
    fields: [{ name: 'text', label: 'Note', type: 'textarea', placeholder: 'Write your comment…' }],
    okText: 'Add note',
  });
  if (!values || !values.text.trim()) return;
  await addStickyNote(n, x, y, values.text.trim());
  setTool('select');
}

export async function addStickyNote(n, x, y, text) {
  const view = getPageView(n);
  const [px, py] = view.viewport.convertToPdfPoint(x, y);
  await applyEdit('Add note', (doc) => {
    const page = doc.getPage(n - 1);
    const annot = doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [px, py - NOTE_SIZE, px + NOTE_SIZE, py],
      Contents: PDFHexString.fromText(text),
      T: PDFHexString.fromText('PDFPilot'),
      Name: 'Comment',
      C: [1, 0.82, 0.2],
      F: 4,
      M: PDFString.fromDate(new Date()),
    });
    const ref = doc.context.register(annot);
    let annots = page.node.get(PDFName.of('Annots'));
    if (annots instanceof PDFArray) {
      annots.push(ref);
    } else {
      page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
    }
  });
}

async function renderNoteIcons(n, view) {
  for (const el of view.overlay.querySelectorAll('.note-icon')) el.remove();
  let annots;
  try {
    annots = await view.page.getAnnotations();
  } catch {
    return;
  }
  for (const a of annots) {
    if (a.subtype !== 'Text') continue;
    const r = pdfRectToCss(view.viewport, a.rect);
    const icon = document.createElement('div');
    icon.className = 'note-icon';
    icon.style.left = `${r.left}px`;
    icon.style.top = `${r.top}px`;
    icon.textContent = '🗨';
    const text = a.contentsObj?.str ?? a.contents ?? '';
    icon.title = text;
    icon.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = await showModal({
        title: 'Sticky note',
        message: text,
        okText: 'Close',
        cancelText: 'Delete note',
      });
      if (action === null) await deleteNote(n, a.rect);
    });
    view.overlay.appendChild(icon);
  }
}

async function deleteNote(n, rect) {
  await applyEdit('Delete note', (doc) => {
    const page = doc.getPage(n - 1);
    const annots = page.node.get(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = doc.context.lookup(annots.get(i));
      const sub = a?.get(PDFName.of('Subtype'));
      if (sub !== PDFName.of('Text')) continue;
      const r = a.get(PDFName.of('Rect'));
      const vals = r?.asArray?.().map((v) => v?.asNumber?.() ?? 0) ?? [];
      if (vals.length === 4 && vals.every((v, idx) => Math.abs(v - rect[idx]) < 1)) {
        annots.remove(i);
        return;
      }
    }
  });
}

// ---------------- freehand drawing ----------------

let draw = null; // { n, view, points, svg, polyline }

function ensureSvg(view) {
  let svg = view.overlay.querySelector('svg.anno-preview');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('anno-preview');
    view.overlay.appendChild(svg);
  }
  return svg;
}

function drawStart(n, view, x, y, e) {
  try {
    view.overlay.setPointerCapture(e.pointerId);
  } catch { /* programmatic invocation */ }
  const svg = ensureSvg(view);
  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', document.getElementById('annot-color')?.value || '#e02020');
  polyline.setAttribute('stroke-width', '2.5');
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(polyline);
  draw = { n, view, points: [[x, y]], svg, polyline };
}

function drawMove(n, view, x, y) {
  if (!draw) return;
  const last = draw.points[draw.points.length - 1];
  if (Math.hypot(x - last[0], y - last[1]) < 2) return;
  draw.points.push([x, y]);
  draw.polyline.setAttribute('points', draw.points.map((p) => p.join(',')).join(' '));
}

async function drawEnd() {
  if (!draw) return;
  const { n, view, points, svg } = draw;
  draw = null;
  svg.remove();
  if (points.length < 3) return;
  await commitFreehand(n, view, points);
}

export async function commitFreehand(n, view, points) {
  const color = annotColor();
  const pageH = view.page.getViewport({ scale: 1 }).height;
  const pdfPts = points.map(([x, y]) => view.viewport.convertToPdfPoint(x, y));
  // drawSvgPath uses SVG's y-down space anchored at the given x/y.
  const d = 'M ' + pdfPts.map(([px, py]) => `${px.toFixed(2)} ${(pageH - py).toFixed(2)}`).join(' L ');
  await applyEdit('Freehand drawing', (doc) => {
    const page = doc.getPage(n - 1);
    page.drawSvgPath(d, {
      x: 0,
      y: page.getHeight(),
      borderColor: color,
      borderWidth: 2,
      borderLineCap: 1,
    });
  });
}

// ---------------- shapes ----------------

let shape = null; // { kind, n, view, x0, y0, el, svg }

function shapeStart(kind, n, view, x, y, e) {
  try {
    view.overlay.setPointerCapture(e.pointerId);
  } catch { /* programmatic invocation */ }
  const svg = ensureSvg(view);
  const tag = kind === 'rect' ? 'rect' : kind === 'ellipse' ? 'ellipse' : 'line';
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', document.getElementById('annot-color')?.value || '#e02020');
  el.setAttribute('stroke-width', '2.5');
  svg.appendChild(el);
  shape = { kind, n, view, x0: x, y0: y, el, svg };
}

function shapeMove(n, view, x, y) {
  if (!shape) return;
  const { kind, x0, y0, el } = shape;
  if (kind === 'rect') {
    el.setAttribute('x', Math.min(x0, x));
    el.setAttribute('y', Math.min(y0, y));
    el.setAttribute('width', Math.abs(x - x0));
    el.setAttribute('height', Math.abs(y - y0));
  } else if (kind === 'ellipse') {
    el.setAttribute('cx', (x0 + x) / 2);
    el.setAttribute('cy', (y0 + y) / 2);
    el.setAttribute('rx', Math.abs(x - x0) / 2);
    el.setAttribute('ry', Math.abs(y - y0) / 2);
  } else {
    el.setAttribute('x1', x0);
    el.setAttribute('y1', y0);
    el.setAttribute('x2', x);
    el.setAttribute('y2', y);
  }
}

async function shapeEnd(n, view, x, y) {
  if (!shape) return;
  const { kind, n: sn, view: sview, x0, y0, svg, el } = shape;
  shape = null;
  el.remove();
  if (svg.childElementCount === 0) svg.remove();
  if (Math.abs(x - x0) < 3 && Math.abs(y - y0) < 3) return;
  await commitShape(kind, sn, sview, x0, y0, x, y);
}

export async function commitShape(kind, n, view, x0, y0, x1, y1) {
  const color = annotColor();
  const [px0, py0] = view.viewport.convertToPdfPoint(x0, y0);
  const [px1, py1] = view.viewport.convertToPdfPoint(x1, y1);
  await applyEdit('Draw shape', (doc) => {
    const page = doc.getPage(n - 1);
    if (kind === 'rect') {
      page.drawRectangle({
        x: Math.min(px0, px1),
        y: Math.min(py0, py1),
        width: Math.abs(px1 - px0),
        height: Math.abs(py1 - py0),
        borderColor: color,
        borderWidth: 2,
      });
    } else if (kind === 'ellipse') {
      page.drawEllipse({
        x: (px0 + px1) / 2,
        y: (py0 + py1) / 2,
        xScale: Math.abs(px1 - px0) / 2,
        yScale: Math.abs(py1 - py0) / 2,
        borderColor: color,
        borderWidth: 2,
      });
    } else {
      page.drawLine({
        start: { x: px0, y: py0 },
        end: { x: px1, y: py1 },
        thickness: 2,
        color,
      });
    }
  });
}

// ---------------- text boxes ----------------

let textboxSession = null;

function beginTextbox(n, view, x, y) {
  if (textboxSession) commitTextbox();
  const ta = document.createElement('textarea');
  ta.className = 'textbox-edit';
  ta.style.left = `${x}px`;
  ta.style.top = `${y}px`;
  ta.placeholder = 'Type text… (Esc cancels, click away commits)';
  view.div.appendChild(ta);
  textboxSession = { ta, n, view, x, y };
  setTimeout(() => ta.focus(), 0);

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      textboxSession = null;
      ta.remove();
    }
    e.stopPropagation();
  });
  ta.addEventListener('blur', () => commitTextbox());
  ta.addEventListener('pointerdown', (e) => e.stopPropagation());
}

async function commitTextbox() {
  if (!textboxSession) return;
  const { ta, n, view, x, y } = textboxSession;
  textboxSession = null;
  const text = ta.value;
  ta.remove();
  if (!text.trim()) return;
  await commitTextboxAt(n, view, x, y, text);
}

export async function commitTextboxAt(n, view, x, y, text, size = 14) {
  const color = annotColor();
  const [px, py] = view.viewport.convertToPdfPoint(x, y);
  await applyEdit('Add text box', async (doc) => {
    const page = doc.getPage(n - 1);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(text.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…\n]/g, '?'), {
      x: px,
      y: py - size,
      size,
      font,
      color,
      lineHeight: size * 1.3,
    });
  });
}
