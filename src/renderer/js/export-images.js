// Feature 14: export pages as PNG/JPG images.
import { state, setStatus } from './state.js';
import { showModal } from './modal.js';
import { parseRanges } from './pageops.js';
import { renderPageCanvas, canvasToBytes } from './render-utils.js';

const api = window.pdfpilot;

export async function exportImagesDialog() {
  if (!state.bytes) return;
  const values = await showModal({
    title: 'Export pages as images',
    fields: [
      {
        name: 'format',
        label: 'Format',
        type: 'select',
        options: [
          { value: 'png', label: 'PNG' },
          { value: 'jpg', label: 'JPG' },
        ],
      },
      {
        name: 'dpi',
        label: 'Resolution (DPI)',
        type: 'select',
        value: '150',
        options: [
          { value: '96', label: '96 — screen' },
          { value: '150', label: '150 — good' },
          { value: '300', label: '300 — print' },
        ],
      },
      { name: 'ranges', label: 'Pages', value: `1-${state.pageCount}` },
    ],
    okText: 'Export',
  });
  if (!values) return;

  let pages;
  try {
    pages = [...new Set(parseRanges(values.ranges, state.pageCount).flat())].sort((a, b) => a - b);
  } catch (err) {
    setStatus(err.message);
    return;
  }
  const outDir = await api.pickDirDialog({ title: 'Choose folder for the images' });
  if (!outDir) return;
  await exportImages(values.format, parseInt(values.dpi, 10), pages, outDir);
}

export async function exportImages(format, dpi, pageIndices, outDir) {
  const base = (state.filePath ? state.filePath.split(/[\\/]/).pop() : 'document.pdf').replace(/\.pdf$/i, '');
  const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
  let written = 0;
  for (const idx of pageIndices) {
    const n = idx + 1;
    setStatus(`Exporting page ${n}…`);
    const { canvas } = await renderPageCanvas(n, dpi);
    const bytes = await canvasToBytes(canvas, type, format === 'jpg' ? 0.9 : undefined);
    const name = `${base}-page-${String(n).padStart(3, '0')}.${format}`;
    await api.writeFile(`${outDir}/${name}`, bytes);
    written++;
  }
  setStatus(`Exported ${written} image${written === 1 ? '' : 's'}`);
}
