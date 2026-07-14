// Feature 11: compress. "Optimize" resaves losslessly with object streams;
// "Rasterize" re-renders pages as JPEGs (much smaller for scan-heavy files,
// but text/forms/annotations become flat images).
import { PDFDocument } from 'pdf-lib';
import { state, setStatus } from './state.js';
import { getPageView } from './viewer.js';
import { applyBytes } from './document.js';
import { showModal } from './modal.js';
import { renderPageCanvas, canvasToBytes } from './render-utils.js';

function fmtSize(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export async function compressDialog() {
  if (!state.bytes) return;
  const values = await showModal({
    title: 'Compress PDF',
    message: 'Optimize is lossless. Rasterize converts pages to images — much smaller for scanned documents, but text selection, form fields and annotations are flattened.',
    fields: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        options: [
          { value: 'optimize', label: 'Optimize (lossless)' },
          { value: 'rasterize', label: 'Rasterize pages (aggressive)' },
        ],
      },
      {
        name: 'dpi',
        label: 'Rasterize DPI',
        type: 'select',
        value: '150',
        options: [
          { value: '100', label: '100 — smallest' },
          { value: '150', label: '150 — balanced' },
          { value: '200', label: '200 — sharper' },
        ],
      },
      {
        name: 'quality',
        label: 'JPEG quality',
        type: 'select',
        value: '0.7',
        options: [
          { value: '0.5', label: 'Low' },
          { value: '0.7', label: 'Medium' },
          { value: '0.85', label: 'High' },
        ],
      },
    ],
    okText: 'Compress',
  });
  if (!values) return;
  await compress(values.mode, parseInt(values.dpi, 10), parseFloat(values.quality));
}

export async function compress(mode, dpi = 150, quality = 0.7) {
  const before = state.bytes.length;
  if (mode === 'optimize') {
    await applyBytes('Compress (optimize)', async (bytes) => {
      const doc = await PDFDocument.load(bytes);
      return doc.save({ useObjectStreams: true });
    });
  } else {
    const pageCount = state.pageCount;
    const images = [];
    for (let n = 1; n <= pageCount; n++) {
      setStatus(`Rasterizing page ${n} / ${pageCount}…`);
      const view = getPageView(n);
      const base = view.page.getViewport({ scale: 1 });
      const { canvas } = await renderPageCanvas(n, dpi);
      images.push({
        jpg: await canvasToBytes(canvas, 'image/jpeg', quality),
        width: base.width,
        height: base.height,
        rotated: view.page.rotate % 180 !== 0,
      });
    }
    await applyBytes('Compress (rasterize)', async () => {
      const doc = await PDFDocument.create();
      for (const im of images) {
        const w = im.rotated ? im.height : im.width;
        const h = im.rotated ? im.width : im.height;
        const img = await doc.embedJpg(im.jpg);
        const page = doc.addPage([w, h]);
        page.drawImage(img, { x: 0, y: 0, width: w, height: h });
      }
      return doc.save();
    });
  }
  const after = state.bytes.length;
  setStatus(`Compressed: ${fmtSize(before)} → ${fmtSize(after)}${after >= before ? ' (no gain on this file)' : ''}`);
}
