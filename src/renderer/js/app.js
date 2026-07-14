// Entry point: wires toolbar actions and boot (including smoke-test mode).
import { state, setStatus } from './state.js';
import { openBytes } from './viewer.js';

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

function wireToolbar() {
  document.getElementById('btn-open').addEventListener('click', openFromDialog);
  document.getElementById('btn-welcome-open').addEventListener('click', openFromDialog);

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openFromDialog();
    }
  });
}

async function boot() {
  wireToolbar();
  const params = new URLSearchParams(location.search);
  if (params.get('smoke')) {
    try {
      await openPath(params.get('file'));
      // Wait until the first page's canvas has real content.
      await new Promise((r) => setTimeout(r, 800));
      api.smokeRendered({ pages: state.pageCount, scale: state.scale });
    } catch (err) {
      api.smokeError(err.stack || String(err));
    }
  }
}

boot();
