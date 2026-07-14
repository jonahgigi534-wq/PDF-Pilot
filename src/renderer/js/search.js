// Full-text search across the document with highlight overlays.
import { state, setStatus } from './state.js';
import { pdfjsLib, getPageView, eachPageView, scrollToPage, onPageRendered, onDocChanged } from './viewer.js';
import { getPageIndex } from './textindex.js';

let pageIndexes = null; // pageNum -> index entry, snapshot for current search
let matches = []; // { page, start, len }
let currentIdx = -1;
let lastQuery = '';
const measureCtx = document.createElement('canvas').getContext('2d');

export function initSearch() {
  onDocChanged(() => {
    pageIndexes = null;
    matches = [];
    currentIdx = -1;
    lastQuery = '';
    updateSearchStatus();
  });
  onPageRendered((n) => {
    if (matches.length) drawHitsForPage(n);
  });

  const input = document.getElementById('search-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch(input.value, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      clearSearch();
      input.blur();
    }
  });
  document.getElementById('btn-search-next').addEventListener('click', () => runSearch(input.value, 1));
  document.getElementById('btn-search-prev').addEventListener('click', () => runSearch(input.value, -1));
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

export async function runSearch(query, direction = 1) {
  query = query.trim();
  if (!query) {
    clearSearch();
    return;
  }
  if (!state.pdf) return;

  if (!pageIndexes) {
    setStatus('Indexing text…');
    pageIndexes = new Map();
    for (let n = 1; n <= state.pageCount; n++) {
      pageIndexes.set(n, await getPageIndex(n));
    }
  }

  if (query.toLowerCase() !== lastQuery) {
    lastQuery = query.toLowerCase();
    matches = [];
    currentIdx = -1;
    for (let n = 1; n <= state.pageCount; n++) {
      const idx = pageIndexes.get(n);
      let from = 0;
      while (true) {
        const at = idx.lower.indexOf(lastQuery, from);
        if (at === -1) break;
        matches.push({ page: n, start: at, len: query.length });
        from = at + 1;
      }
    }
  }

  if (!matches.length) {
    clearAllHits();
    updateSearchStatus();
    setStatus(`No matches for “${query}”`);
    return;
  }

  currentIdx = (currentIdx + direction + matches.length) % matches.length;
  const m = matches[currentIdx];
  const rects = rectsForMatch(m);
  scrollToPage(m.page, rects.length ? rects[0].top - 120 : 0);
  clearAllHits();
  eachPageView((n, view) => {
    if (view.rendered) drawHitsForPage(n);
  });
  updateSearchStatus();
  setStatus('');
}

export function clearSearch() {
  matches = [];
  currentIdx = -1;
  lastQuery = '';
  clearAllHits();
  updateSearchStatus();
}

function updateSearchStatus() {
  const el = document.getElementById('search-status');
  if (!el) return;
  el.textContent = matches.length ? `${currentIdx + 1} / ${matches.length}` : '';
}

function clearAllHits() {
  eachPageView((n, view) => {
    for (const hit of view.overlay.querySelectorAll('.search-hit')) hit.remove();
  });
}

// Maps a match (character range in the page's joined text) to CSS rects in the
// current viewport, splitting across text items where needed.
function rectsForMatch(m) {
  const idx = pageIndexes?.get(m.page);
  const view = getPageView(m.page);
  if (!idx || !view) return [];
  const { items, offsets } = idx;
  const rects = [];
  const end = m.start + m.len;

  for (let i = 0; i < items.length; i++) {
    const itemStart = offsets[i];
    const itemEnd = itemStart + items[i].str.length;
    if (itemEnd <= m.start) continue;
    if (itemStart >= end) break;
    const it = items[i];
    if (!it.str.length || !it.width) continue;

    const t = pdfjsLib.Util.transform(view.viewport.transform, it.transform);
    const fontHeight = Math.hypot(t[2], t[3]);
    const widthCss = it.width * view.viewport.scale;
    const localStart = Math.max(0, m.start - itemStart);
    const localEnd = Math.min(it.str.length, end - itemStart);

    // Measure substring offsets with a comparable font so highlights line up
    // with proportional text, normalising by the full string's measured width.
    const family = idx.styles?.[it.fontName]?.fontFamily || 'sans-serif';
    measureCtx.font = `${fontHeight}px ${family}`;
    const fullW = measureCtx.measureText(it.str).width || 1;
    const startFrac = measureCtx.measureText(it.str.slice(0, localStart)).width / fullW;
    const endFrac = measureCtx.measureText(it.str.slice(0, localEnd)).width / fullW;

    rects.push({
      left: t[4] + startFrac * widthCss,
      top: t[5] - fontHeight,
      width: (endFrac - startFrac) * widthCss,
      height: fontHeight * 1.15,
    });
  }
  return rects;
}

function drawHitsForPage(n) {
  const view = getPageView(n);
  if (!view) return;
  for (const hit of view.overlay.querySelectorAll('.search-hit')) hit.remove();
  matches.forEach((m, idx) => {
    if (m.page !== n) return;
    for (const r of rectsForMatch(m)) {
      const div = document.createElement('div');
      div.className = 'search-hit' + (idx === currentIdx ? ' current' : '');
      div.style.left = `${r.left}px`;
      div.style.top = `${r.top}px`;
      div.style.width = `${r.width}px`;
      div.style.height = `${r.height}px`;
      view.overlay.appendChild(div);
    }
  });
}
