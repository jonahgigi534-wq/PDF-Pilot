// Edit pipeline: every modification produces new document bytes via pdf-lib,
// with byte-snapshot undo/redo and save/save-as.
import { PDFDocument } from 'pdf-lib';
import { state, setStatus } from './state.js';
import { openBytes } from './viewer.js';

const MAX_UNDO = 30;
const api = window.pdfpilot;

const historyListeners = [];
export function onHistoryChanged(fn) {
  historyListeners.push(fn);
}
function notifyHistory() {
  for (const fn of historyListeners) fn();
}

// Hooks that run before an edit or save (e.g. flushing pending form values).
const preEditHooks = [];
export function registerPreEditHook(fn) {
  preEditHooks.push(fn);
}
async function runPreEditHooks() {
  for (const fn of preEditHooks) await fn();
}

// Runs `mutator(pdfDoc)` on a pdf-lib document loaded from the current bytes.
export async function applyEdit(label, mutator) {
  return applyBytes(label, async (bytes) => {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false });
    await mutator(doc);
    return doc.save();
  });
}

// Lower-level variant for operations that produce bytes directly.
export async function applyBytes(label, fn, { allowEncrypted = false } = {}) {
  if (!state.bytes) return;
  if (state.docPassword && !allowEncrypted) {
    setStatus('This PDF is password-protected — use Tools → Remove password before editing');
    return;
  }
  await runPreEditHooks();
  setStatus(`${label}…`);
  try {
    const before = state.bytes;
    const out = new Uint8Array(await fn(state.bytes));
    state.undoStack.push(before);
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack.length = 0;
    state.dirty = true;
    await reloadPreservingScroll(out);
    setStatus(label);
    notifyHistory();
  } catch (err) {
    console.error(`${label} failed:`, err);
    setStatus(`${label} failed: ${err.message}`);
    throw err;
  }
}

async function reloadPreservingScroll(bytes) {
  const container = document.getElementById('viewer-container');
  const st = container.scrollTop;
  const sl = container.scrollLeft;
  await openBytes(bytes, state.filePath);
  container.scrollTop = st;
  container.scrollLeft = sl;
}

export async function undo() {
  if (!state.undoStack.length) return;
  state.redoStack.push(state.bytes);
  const bytes = state.undoStack.pop();
  state.dirty = true;
  await reloadPreservingScroll(bytes);
  setStatus('Undo');
  notifyHistory();
}

export async function redo() {
  if (!state.redoStack.length) return;
  state.undoStack.push(state.bytes);
  const bytes = state.redoStack.pop();
  state.dirty = true;
  await reloadPreservingScroll(bytes);
  setStatus('Redo');
  notifyHistory();
}

export async function save() {
  if (!state.bytes) return;
  await runPreEditHooks();
  if (!state.filePath) return saveAs();
  await api.writeFile(state.filePath, state.bytes);
  state.dirty = false;
  setStatus('Saved');
  notifyHistory();
}

export async function saveAs() {
  if (!state.bytes) return;
  await runPreEditHooks();
  const target = await api.saveDialog({
    title: 'Save PDF as',
    defaultPath: state.filePath || 'document.pdf',
  });
  if (!target) return;
  await api.writeFile(target, state.bytes);
  state.filePath = target;
  state.dirty = false;
  const name = target.split(/[\\/]/).pop();
  document.getElementById('doc-name').textContent = name;
  api.setTitle(name);
  setStatus('Saved');
  notifyHistory();
}
