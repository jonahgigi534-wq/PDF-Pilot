// PDF rendering: page shells, lazy canvas rendering, text layers, thumbnails, zoom.
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import { state, setStatus } from './state.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdfjs/pdf.worker.min.mjs', location.href).toString();

const DOC_OPTS = {
  cMapUrl: new URL('./pdfjs/cmaps/', location.href).toString(),
  cMapPacked: true,
  standardFontDataUrl: new URL('./pdfjs/standard_fonts/', location.href).toString(),
  wasmUrl: new URL('./pdfjs/wasm/', location.href).toString(),
  iccUrl: new URL('./pdfjs/iccs/', location.href).toString(),
};

export { pdfjsLib };

const THUMB_WIDTH = 132;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;

const pagesEl = () => document.getElementById('pages');
const containerEl = () => document.getElementById('viewer-container');

// pageNum -> { div, canvas, textLayerDiv, overlay, page, viewport, rendered, renderTask }
const pageViews = new Map();
let observer = null;
let thumbObserver = null;
const thumbViews = new Map(); // pageNum -> { div, canvas, rendered }

const docChangeListeners = [];
const pageRenderedListeners = [];
const currentPageListeners = [];

export function onDocChanged(fn) { docChangeListeners.push(fn); }
export function onPageRendered(fn) { pageRenderedListeners.push(fn); }
export function onCurrentPageChanged(fn) { currentPageListeners.push(fn); }

export async function openBytes(bytes, filePath) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  setStatus('Opening…');
  // pdf.js transfers the buffer it is given to its worker, so pass a copy and
  // keep `state.bytes` intact for pdf-lib edits.
  const pdf = await pdfjsLib.getDocument({ data: data.slice(), ...DOC_OPTS }).promise;
  if (state.pdf) {
    await state.pdf.destroy().catch(() => {});
  }
  state.bytes = data;
  state.pdf = pdf;
  state.filePath = filePath ?? state.filePath;
  state.pageCount = pdf.numPages;
  if (state.currentPage > pdf.numPages) state.currentPage = pdf.numPages;

  document.getElementById('welcome')?.classList.add('hidden');
  await buildPageShells();
  await buildThumbnails();
  for (const fn of docChangeListeners) await fn();
  setStatus(`${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`);
}

async function buildPageShells() {
  const container = pagesEl();
  if (observer) observer.disconnect();
  for (const v of pageViews.values()) v.renderTask?.cancel();
  pageViews.clear();
  container.textContent = '';

  observer = new IntersectionObserver(onIntersect, {
    root: containerEl(),
    rootMargin: '600px 0px',
  });

  for (let n = 1; n <= state.pageCount; n++) {
    const page = await state.pdf.getPage(n);
    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.num = String(n);

    const canvas = document.createElement('canvas');
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    div.append(canvas, textLayerDiv, overlay);
    container.appendChild(div);

    const view = { div, canvas, textLayerDiv, overlay, page, viewport: null, rendered: false, renderTask: null };
    pageViews.set(n, view);
    applyViewportToShell(view);
    observer.observe(div);
  }
}

function applyViewportToShell(view) {
  view.viewport = view.page.getViewport({ scale: state.scale });
  view.div.style.width = `${Math.floor(view.viewport.width)}px`;
  view.div.style.height = `${Math.floor(view.viewport.height)}px`;
  view.div.style.setProperty('--total-scale-factor', String(view.viewport.scale));
}

function onIntersect(entries) {
  for (const entry of entries) {
    const n = Number(entry.target.dataset.num);
    const view = pageViews.get(n);
    if (!view) continue;
    if (entry.isIntersecting && !view.rendered && !view.renderTask) {
      renderPage(n).catch((err) => console.error(`render page ${n}:`, err));
    }
  }
}

export async function renderPage(n) {
  const view = pageViews.get(n);
  if (!view || view.rendered || view.renderTask) return;

  const { page, canvas, viewport, textLayerDiv } = view;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  const ctx = canvas.getContext('2d');

  view.renderTask = page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  });
  try {
    await view.renderTask.promise;
  } catch (err) {
    if (err instanceof pdfjsLib.RenderingCancelledException) return;
    throw err;
  } finally {
    view.renderTask = null;
  }
  view.rendered = true;

  textLayerDiv.textContent = '';
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent(),
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();

  for (const fn of pageRenderedListeners) fn(n, view);
}

export function getPageView(n) {
  return pageViews.get(n);
}

export function eachPageView(fn) {
  for (const [n, view] of pageViews) fn(n, view);
}

// ---------------- zoom ----------------

export function setScale(newScale, { anchorCenter = true } = {}) {
  newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
  if (Math.abs(newScale - state.scale) < 0.001) return;

  const container = containerEl();
  const frac = container.scrollHeight > 0
    ? (container.scrollTop + container.clientHeight / 2) / container.scrollHeight
    : 0;

  state.scale = newScale;
  for (const view of pageViews.values()) {
    view.renderTask?.cancel();
    view.renderTask = null;
    view.rendered = false;
    view.textLayerDiv.textContent = '';
    applyViewportToShell(view);
    // Re-observe so the IntersectionObserver reports fresh visibility.
    observer.unobserve(view.div);
    observer.observe(view.div);
  }

  if (anchorCenter) {
    container.scrollTop = frac * container.scrollHeight - container.clientHeight / 2;
  }
  updateZoomLabel();
}

export function zoomIn() { setScale(state.scale * 1.2); }
export function zoomOut() { setScale(state.scale / 1.2); }

export function fitWidth() {
  const view = pageViews.get(state.currentPage) || pageViews.get(1);
  if (!view) return;
  const baseWidth = view.page.getViewport({ scale: 1 }).width;
  const available = containerEl().clientWidth - 48 - 18; // padding + scrollbar
  setScale(available / baseWidth);
}

function updateZoomLabel() {
  const el = document.getElementById('zoom-label');
  if (el) el.textContent = `${Math.round(state.scale * 100)}%`;
}

// ---------------- navigation / current page tracking ----------------

export function scrollToPage(n, offsetY = 0) {
  const view = pageViews.get(n);
  if (!view) return;
  const container = containerEl();
  container.scrollTop = view.div.offsetTop - 12 + offsetY;
}

export function goToPage(n) {
  n = Math.min(state.pageCount, Math.max(1, n));
  scrollToPage(n);
  setCurrentPage(n);
}

function setCurrentPage(n) {
  if (n === state.currentPage) return;
  state.currentPage = n;
  for (const [tn, tv] of thumbViews) tv.div.classList.toggle('current', tn === n);
  for (const fn of currentPageListeners) fn(n);
}

let scrollRaf = 0;
export function initViewerEvents() {
  containerEl().addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      updateCurrentPageFromScroll();
    });
  });
}

function updateCurrentPageFromScroll() {
  const container = containerEl();
  const centerY = container.scrollTop + container.clientHeight / 2;
  let best = state.currentPage;
  let bestDist = Infinity;
  for (const [n, view] of pageViews) {
    const mid = view.div.offsetTop + view.div.offsetHeight / 2;
    const dist = Math.abs(mid - centerY);
    if (dist < bestDist) {
      bestDist = dist;
      best = n;
    }
  }
  setCurrentPage(best);
}

// ---------------- thumbnails ----------------

async function buildThumbnails() {
  const rail = document.getElementById('thumb-rail');
  if (thumbObserver) thumbObserver.disconnect();
  thumbViews.clear();
  rail.textContent = '';

  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const n = Number(entry.target.dataset.num);
        renderThumb(n).catch((err) => console.error(`thumb ${n}:`, err));
      }
    },
    { root: rail, rootMargin: '400px 0px' },
  );

  for (let n = 1; n <= state.pageCount; n++) {
    const view = pageViews.get(n);
    const base = view.page.getViewport({ scale: 1 });
    const scale = THUMB_WIDTH / base.width;

    const div = document.createElement('div');
    div.className = 'thumb' + (n === state.currentPage ? ' current' : '');
    div.dataset.num = String(n);
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.floor(base.height * scale);
    canvas.style.width = `${THUMB_WIDTH}px`;
    canvas.style.height = `${Math.floor(base.height * scale)}px`;
    const label = document.createElement('div');
    label.className = 'thumb-label';
    label.textContent = String(n);
    div.append(canvas, label);
    div.addEventListener('click', () => goToPage(n));
    rail.appendChild(div);

    thumbViews.set(n, { div, canvas, rendered: false });
    thumbObserver.observe(div);
  }
}

async function renderThumb(n) {
  const tv = thumbViews.get(n);
  const view = pageViews.get(n);
  if (!tv || tv.rendered || !view) return;
  tv.rendered = true;
  const base = view.page.getViewport({ scale: 1 });
  const viewport = view.page.getViewport({ scale: THUMB_WIDTH / base.width });
  await view.page.render({ canvasContext: tv.canvas.getContext('2d'), viewport }).promise;
}
