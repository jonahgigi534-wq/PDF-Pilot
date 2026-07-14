// Entry point: wires toolbar actions and boot (including smoke-test mode).
import { state, setStatus } from './state.js';
import {
  openBytes, onDocChanged, onCurrentPageChanged, initViewerEvents,
  zoomIn, zoomOut, fitWidth, goToPage,
} from './viewer.js';
import { initSearch, runSearch } from './search.js';

const api = window.pdfpilot;

async function openFromDialog() {
  const paths = await api.openPdfDialog({});
  if (!paths.length) return;
  await openPath(paths[0]);
}

async function openPath(filePath) {
  try {
    const data = await api.readFile(filePath);
    await openBytes(new Uint8Array(data), filePath);
    const name = filePath.split(/[\\/]/).pop();
    document.getElementById('doc-name').textContent = name;
    api.setTitle(name);
  } catch (err) {
    console.error(err);
    setStatus(`Failed to open: ${err.message}`);
    throw err;
  }
}

const docButtons = [
  'btn-save', 'btn-save-as', 'btn-zoom-out', 'btn-zoom-in', 'btn-fit-width',
  'btn-prev-page', 'btn-next-page', 'btn-search-prev', 'btn-search-next',
];

function enableDocControls() {
  for (const id of docButtons) document.getElementById(id).disabled = false;
  document.getElementById('page-input').disabled = false;
  document.getElementById('search-input').disabled = false;
}

function wireToolbar() {
  const $ = (id) => document.getElementById(id);
  $('btn-open').addEventListener('click', openFromDialog);
  $('btn-welcome-open').addEventListener('click', openFromDialog);
  $('btn-zoom-in').addEventListener('click', zoomIn);
  $('btn-zoom-out').addEventListener('click', zoomOut);
  $('btn-fit-width').addEventListener('click', fitWidth);
  $('btn-prev-page').addEventListener('click', () => goToPage(state.currentPage - 1));
  $('btn-next-page').addEventListener('click', () => goToPage(state.currentPage + 1));
  $('page-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const n = parseInt(e.target.value, 10);
      if (!Number.isNaN(n)) goToPage(n);
      e.target.blur();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openFromDialog();
    }
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); zoomOut(); }
  });

  onDocChanged(() => {
    enableDocControls();
    document.getElementById('page-count-label').textContent = `/ ${state.pageCount}`;
    document.getElementById('page-input').value = String(state.currentPage);
    document.getElementById('zoom-label').textContent = `${Math.round(state.scale * 100)}%`;
  });
  onCurrentPageChanged((n) => {
    document.getElementById('page-input').value = String(n);
  });
}

async function boot() {
  wireToolbar();
  initViewerEvents();
  initSearch();

  const params = new URLSearchParams(location.search);
  if (params.get('smoke')) {
    try {
      await openPath(params.get('file'));
      await new Promise((r) => setTimeout(r, 800));
      // Optional scripted action for feature smoke tests.
      const action = params.get('action');
      if (action) {
        const { runSmokeAction } = await import('./smoke-actions.js');
        await runSmokeAction(action, params);
        await new Promise((r) => setTimeout(r, 500));
      }
      api.smokeRendered({ pages: state.pageCount, scale: state.scale, action: action || null });
    } catch (err) {
      api.smokeError(err.stack || String(err));
    }
  }
}

boot();
