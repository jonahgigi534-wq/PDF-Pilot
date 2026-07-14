// Feature 3: "Edit in Word mode" — tier-2 heavy editing. The current page (or
// whole document) is converted to .docx with headless LibreOffice, opened in
// the user's word processor, and re-imported back into the PDF on request.
// A round-trip like this can shift formatting slightly; the UI says so.
import { PDFDocument } from 'pdf-lib';
import { state, setStatus } from './state.js';
import { applyEdit } from './document.js';
import { openBytes } from './viewer.js';
import { showModal } from './modal.js';

const api = window.pdfpilot;
let session = null; // { docxPath, scope, page }

export function initWordMode() {
  document.getElementById('btn-wordmode').addEventListener('click', startWordMode);
  document.getElementById('wordmode-reimport').addEventListener('click', () => reimport());
  document.getElementById('wordmode-cancel').addEventListener('click', endSession);
}

// Shared by wordmode + convert: ensures LibreOffice is available, offering
// install/locate options when it is not. Returns true when usable.
export async function ensureSoffice() {
  let status = await api.sofficeStatus();
  if (status.found) return true;

  const choice = await showModal({
    title: 'LibreOffice required',
    message: 'Word mode and PDF ↔ Word conversion use LibreOffice (free, open source) running locally. PDFPilot could not find it on this PC. Install it with Windows’ built-in package manager (about 350 MB, a few minutes), or point PDFPilot to an existing soffice.exe.',
    fields: [{
      name: 'how',
      label: 'What to do',
      type: 'select',
      options: [
        { value: 'winget', label: 'Install LibreOffice now (winget)' },
        { value: 'locate', label: 'Locate soffice.exe manually…' },
      ],
    }],
    okText: 'Continue',
  });
  if (!choice) return false;

  if (choice.how === 'locate') {
    status = await api.sofficeLocate();
    if (!status.found) {
      setStatus('LibreOffice not set — Word features stay disabled');
      return false;
    }
    return true;
  }

  setStatus('Installing LibreOffice via winget — this can take a few minutes…');
  const res = await api.sofficeInstall();
  if (!res.found) {
    console.error('winget install log:', res.log);
    setStatus('LibreOffice install did not complete — try installing it from libreoffice.org, then use "Locate soffice.exe"');
    return false;
  }
  setStatus('LibreOffice installed');
  return true;
}

async function startWordMode() {
  if (!state.bytes) return;
  if (session) {
    setStatus('A Word-mode session is already open — re-import or cancel it first');
    return;
  }
  if (!(await ensureSoffice())) return;

  const values = await showModal({
    title: 'Edit in Word mode',
    message: 'The selection is converted to .docx and opened in your word processor. Save it there, then click "Re-import" in the bar below. Heads-up: this is a full round-trip through LibreOffice, so complex layouts may shift slightly.',
    fields: [{
      name: 'scope',
      label: 'Edit',
      type: 'select',
      options: [
        { value: 'page', label: `Current page (${state.currentPage})` },
        { value: 'doc', label: 'Entire document' },
      ],
    }],
    okText: 'Convert & open',
  });
  if (!values) return;
  await beginSession(values.scope, state.currentPage, { open: true });
}

export async function beginSession(scope, pageNum, { open }) {
  setStatus('Converting to Word… (local processing, a few seconds)');
  let pdfBytes;
  if (scope === 'page') {
    const src = await PDFDocument.load(state.bytes);
    const part = await PDFDocument.create();
    const [page] = await part.copyPages(src, [pageNum - 1]);
    part.addPage(page);
    pdfBytes = await part.save();
  } else {
    pdfBytes = state.bytes;
  }
  const pdfPath = await api.tempWrite(new Uint8Array(pdfBytes), 'pdf');
  const res = await api.sofficeConvert({ input: pdfPath, to: 'docx' });
  if (!res.ok) {
    setStatus(`Conversion failed: ${res.error || 'LibreOffice not found'}`);
    return null;
  }

  session = { docxPath: res.path, scope, page: pageNum };
  document.getElementById('wordmode-bar').classList.remove('hidden');
  document.getElementById('wordmode-text').textContent =
    scope === 'page'
      ? `Editing page ${pageNum} in your word processor — save the .docx, then re-import.`
      : 'Editing the whole document in your word processor — save the .docx, then re-import.';
  if (open) await api.openPath(res.path);
  setStatus('Word mode: waiting for you to edit and re-import');
  return session;
}

export async function reimport() {
  if (!session) return;
  const { docxPath, scope, page } = session;
  setStatus('Converting back to PDF…');
  const res = await api.sofficeConvert({ input: docxPath, to: 'pdf' });
  if (!res.ok) {
    setStatus(`Re-import failed: ${res.error || 'LibreOffice not found'}`);
    return;
  }
  const newPdf = new Uint8Array(await api.readFile(res.path));

  if (scope === 'doc') {
    const before = state.bytes;
    state.undoStack.push(before);
    state.redoStack.length = 0;
    state.dirty = true;
    await openBytes(newPdf, state.filePath);
    setStatus('Document replaced with the Word-mode edit');
  } else {
    await applyEdit('Word-mode edit', async (doc) => {
      const edited = await PDFDocument.load(newPdf);
      const pages = await doc.copyPages(edited, edited.getPageIndices());
      doc.removePage(page - 1);
      pages.forEach((p, i) => doc.insertPage(page - 1 + i, p));
    });
    setStatus(`Page ${page} replaced with the Word-mode edit`);
  }
  endSession();
}

function endSession() {
  session = null;
  document.getElementById('wordmode-bar').classList.add('hidden');
}
