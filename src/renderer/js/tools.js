// Tool manager: one active tool at a time; delegates pointer events on pages.
import { state } from './state.js';
import { getPageView, eachPageView, onDocChanged } from './viewer.js';

const tools = new Map(); // name -> handlers
let active = 'select';

// handlers: { cursor, overlayEvents, activate(), deactivate(),
//             onPageClick(n, view, x, y, e), onPointerDown/Move/Up(n, view, x, y, e) }
export function registerTool(name, handlers) {
  tools.set(name, handlers);
}

export function activeTool() {
  return active;
}

export async function setTool(name) {
  if (!tools.has(name) && name !== 'select') return;
  const prev = tools.get(active);
  if (prev?.deactivate) await prev.deactivate();
  active = name;
  state.tool = name;
  const next = tools.get(name);
  if (next?.activate) {
    const ok = await next.activate();
    if (ok === false) {
      // Tool refused to activate (e.g. user cancelled a file picker).
      active = 'select';
      state.tool = 'select';
    }
  }
  applyToolToPages();
  for (const btn of document.querySelectorAll('.tool-btn')) {
    btn.classList.toggle('active', btn.dataset.tool === active);
  }
}

function applyToolToPages() {
  const handlers = tools.get(active);
  const overlayActive = !!(handlers?.overlayEvents);
  eachPageView((n, view) => {
    view.overlay.style.pointerEvents = overlayActive ? 'auto' : 'none';
    view.div.style.cursor = handlers?.cursor || '';
  });
}

function pagePos(e) {
  const pageDiv = e.target.closest?.('.page');
  if (!pageDiv) return null;
  const n = Number(pageDiv.dataset.num);
  const view = getPageView(n);
  if (!view) return null;
  const rect = pageDiv.getBoundingClientRect();
  return { n, view, x: e.clientX - rect.left, y: e.clientY - rect.top };
}

export function initTools() {
  const pages = document.getElementById('pages');

  pages.addEventListener('click', (e) => {
    const h = tools.get(active);
    if (!h?.onPageClick) return;
    const p = pagePos(e);
    if (p) h.onPageClick(p.n, p.view, p.x, p.y, e);
  });
  pages.addEventListener('pointerdown', (e) => {
    const h = tools.get(active);
    if (!h?.onPointerDown) return;
    const p = pagePos(e);
    if (p) h.onPointerDown(p.n, p.view, p.x, p.y, e);
  });
  pages.addEventListener('pointermove', (e) => {
    const h = tools.get(active);
    if (!h?.onPointerMove) return;
    const p = pagePos(e);
    if (p) h.onPointerMove(p.n, p.view, p.x, p.y, e);
  });
  pages.addEventListener('pointerup', (e) => {
    const h = tools.get(active);
    if (!h?.onPointerUp) return;
    const p = pagePos(e);
    if (p) h.onPointerUp(p.n, p.view, p.x, p.y, e);
  });

  for (const btn of document.querySelectorAll('.tool-btn')) {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  }

  onDocChanged(() => applyToolToPages());
}
