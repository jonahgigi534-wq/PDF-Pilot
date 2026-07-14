// Entry point: wires toolbar actions and boot (including smoke-test mode).
import { state, setStatus } from './state.js';
import {
  openBytes, onDocChanged, onCurrentPageChanged, initViewerEvents,
  zoomIn, zoomOut, fitWidth, goToPage,
} from './viewer.js';
import { initSearch, runSearch } from './search.js';
import { initTools } from './tools.js';
import { initEditTools } from './edit-text.js';
import { initPageOps } from './pageops.js';
import { initAnnotations } from './annotations.js';
import { initForms } from './forms.js';
import { initFormCreate } from './formcreate.js';
import { initEsign } from './esign.js';
import { initSecurity } from './security.js';
import { initOcr } from './ocr.js';
import { initWordMode } from './wordmode.js';
import { initConvert } from './convert.js';
import { save, saveAs, undo, redo, onHistoryChanged } from './document.js';
import { printDocument } from './print.js';

const api = window.pdfpilot;

async function openFromDialog() {
  const paths = await api.openPdfDialog({});
  if (!paths.length) return;
  await openPath(paths[0]);
}

async function openPath(filePath) {
  try {
    const data = await api.readFile(filePath);
    state.docPassword = null;
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
  'btn-save', 'btn-save-as', 'btn-print', 'btn-zoom-out', 'btn-zoom-in', 'btn-fit-width',
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
  $('btn-save').addEventListener('click', save);
  $('btn-save-as').addEventListener('click', saveAs);
  $('btn-print').addEventListener('click', () => printDocument());
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);

  window.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, textarea, [contenteditable]')) return;
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openFromDialog();
    }
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); zoomOut(); }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printDocument(); }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveAs(); }
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      redo();
    }
  });

  onHistoryChanged(() => {
    document.getElementById('btn-undo').disabled = !state.undoStack.length;
    document.getElementById('btn-redo').disabled = !state.redoStack.length;
    const name = state.filePath ? state.filePath.split(/[\\/]/).pop() : 'Untitled';
    document.getElementById('doc-name').textContent = state.dirty ? `${name} •` : name;
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
  initTools();
  initEditTools();
  initPageOps();
  initAnnotations();
  initForms();
  initFormCreate();
  initEsign();
  initSecurity();
  initOcr();
  initWordMode();
  initConvert();

  const params = new URLSearchParams(location.search);
  if (params.get('smoke')) {
    try {
      if (params.get('pw')) {
        const { setPresetPassword } = await import('./viewer.js');
        setPresetPassword(params.get('pw'));
      }
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
