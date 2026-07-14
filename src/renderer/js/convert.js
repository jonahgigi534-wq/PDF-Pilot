// Feature 10: conversions. PDF -> Word and Word -> PDF go through headless
// LibreOffice; images -> PDF is pure pdf-lib (no LibreOffice needed).
import { PDFDocument } from 'pdf-lib';
import { state, setStatus } from './state.js';
import { openBytes } from './viewer.js';
import { showModal } from './modal.js';
import { ensureSoffice } from './wordmode.js';

const api = window.pdfpilot;

export function initConvert() {
  document.getElementById('btn-convert').addEventListener('click', convertDialog);
}

async function convertDialog() {
  const values = await showModal({
    title: 'Convert',
    message: 'PDF ↔ Word conversions run through LibreOffice locally and may take a few seconds; complex layouts can shift slightly.',
    fields: [{
      name: 'kind',
      label: 'Conversion',
      type: 'select',
      options: [
        { value: 'pdf2word', label: 'This PDF → Word (.docx)' },
        { value: 'word2pdf', label: 'Word document → new PDF' },
        { value: 'img2pdf', label: 'Images → new PDF' },
      ],
    }],
    okText: 'Convert',
  });
  if (!values) return;
  if (values.kind === 'pdf2word') await pdfToWord();
  else if (values.kind === 'word2pdf') await wordToPdf();
  else await imagesToPdf();
}

export async function pdfToWord(outPath) {
  if (!state.bytes) {
    setStatus('Open a PDF first');
    return;
  }
  if (!(await ensureSoffice())) return;
  setStatus('Converting PDF to Word…');
  const pdfPath = await api.tempWrite(state.bytes, 'pdf');
  const res = await api.sofficeConvert({ input: pdfPath, to: 'docx' });
  if (!res.ok) {
    setStatus(`Conversion failed: ${res.error || 'LibreOffice not found'}`);
    return;
  }
  const target = outPath ?? await api.saveDialog({
    title: 'Save Word document',
    defaultPath: (state.filePath || 'document.pdf').replace(/\.pdf$/i, '.docx'),
    filters: [{ name: 'Word document', extensions: ['docx'] }],
  });
  if (!target) return;
  await api.writeFile(target, new Uint8Array(await api.readFile(res.path)));
  setStatus(`Saved ${target.split(/[\\/]/).pop()}`);
}

export async function wordToPdf(inputPath) {
  if (!(await ensureSoffice())) return;
  let input = inputPath;
  if (!input) {
    const paths = await api.openPdfDialog({
      title: 'Choose a document to convert',
      filters: [{ name: 'Documents', extensions: ['docx', 'doc', 'odt', 'rtf', 'txt'] }],
    });
    if (!paths.length) return;
    input = paths[0];
  }
  setStatus('Converting to PDF…');
  const res = await api.sofficeConvert({ input, to: 'pdf' });
  if (!res.ok) {
    setStatus(`Conversion failed: ${res.error || 'LibreOffice not found'}`);
    return;
  }
  state.docPassword = null;
  await openBytes(new Uint8Array(await api.readFile(res.path)), null);
  state.dirty = true;
  state.filePath = null;
  document.getElementById('doc-name').textContent = 'Converted document •';
  setStatus('Converted — save the new PDF');
}

export async function imagesToPdf(inputPaths) {
  const paths = inputPaths ?? await api.openPdfDialog({
    title: 'Choose images (pages are added in order)',
    multi: true,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (!paths.length) return;

  setStatus('Building PDF from images…');
  const doc = await PDFDocument.create();
  for (const p of paths) {
    const bytes = new Uint8Array(await api.readFile(p));
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // Treat image pixels as 96 DPI -> points.
    const w = img.width * 0.75;
    const h = img.height * 0.75;
    const page = doc.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  state.docPassword = null;
  await openBytes(new Uint8Array(await doc.save()), null);
  state.dirty = true;
  state.filePath = null;
  document.getElementById('doc-name').textContent = 'Images as PDF •';
  setStatus(`Created a ${paths.length}-page PDF from images — save it`);
}
