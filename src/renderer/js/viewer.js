// PDF rendering: page shells, lazy canvas rendering, text layers.
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

const pagesEl = () => document.getElementById('pages');

// pageNum -> { div, canvas, textLayerDiv, overlay, rendered, renderTask, viewport }
const pageViews = new Map();
let observer = null;

const docChangeListeners = [];
export function onDocChanged(fn) {
  docChangeListeners.push(fn);
}

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
    root: document.getElementById('viewer-container'),
    rootMargin: '600px 0px',
  });

  for (let n = 1; n <= state.pageCount; n++) {
    const page = await state.pdf.getPage(n);
    const viewport = page.getViewport({ scale: state.scale });

    const div = document.createElement('div');
    div.className = 'page';
    div.dataset.num = String(n);
    div.style.width = `${Math.floor(viewport.width)}px`;
    div.style.height = `${Math.floor(viewport.height)}px`;
    div.style.setProperty('--total-scale-factor', String(viewport.scale));

    const canvas = document.createElement('canvas');
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    div.append(canvas, textLayerDiv, overlay);
    container.appendChild(div);

    pageViews.set(n, { div, canvas, textLayerDiv, overlay, page, viewport, rendered: false, renderTask: null });
    observer.observe(div);
  }
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

  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: page.streamTextContent(),
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();
}

export function getPageView(n) {
  return pageViews.get(n);
}

export function eachPageView(fn) {
  for (const [n, view] of pageViews) fn(n, view);
}

export function scrollToPage(n) {
  const view = pageViews.get(n);
  if (view) view.div.scrollIntoView({ block: 'start' });
}
