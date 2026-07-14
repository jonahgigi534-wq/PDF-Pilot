// Feature 12: OCR. Pages are rasterised at 300 DPI and sent to the Python
// sidecar (OpenCV preprocessing + RapidOCR / PP-OCR ONNX models). If the
// sidecar is unavailable, falls back to Tesseract.js (pure JS, bundled
// offline). Recognised text is written back as an invisible text layer over
// the original page image, so the PDF becomes searchable/selectable without
// changing its appearance.
import {
  StandardFonts, rgb, degrees, TextRenderingMode, setTextRenderingMode,
  PDFOperator, PDFOperatorNames, PDFNumber,
} from 'pdf-lib';
import { state, setStatus } from './state.js';
import { getPageView } from './viewer.js';
import { applyEdit } from './document.js';
import { showModal } from './modal.js';
import { parseRanges } from './pageops.js';
import { renderPageCanvas, canvasToBytes } from './render-utils.js';

const api = window.pdfpilot;
const OCR_DPI = 300;

export function initOcr() {
  document.getElementById('btn-ocr').addEventListener('click', ocrDialog);
}

async function ocrDialog() {
  if (!state.bytes) return;
  const values = await showModal({
    title: 'OCR — make scanned pages searchable',
    message: 'Recognised text is added as an invisible, selectable layer over the scanned image. Processing runs locally and takes a few seconds per page.',
    fields: [{ name: 'ranges', label: 'Pages', value: `1-${state.pageCount}` }],
    okText: 'Run OCR',
  });
  if (!values) return;
  let pages;
  try {
    pages = [...new Set(parseRanges(values.ranges, state.pageCount).flat())].sort((a, b) => a - b);
  } catch (err) {
    setStatus(err.message);
    return;
  }
  await runOcr(pages.map((i) => i + 1));
}

export async function runOcr(pageNumbers) {
  const status = await api.ocrStatus();
  const useSidecar = status.available;
  setStatus(useSidecar
    ? `OCR engine: ${status.engine}`
    : 'OCR engine unavailable — using Tesseract.js fallback');

  const results = []; // { n, viewport, lines }
  for (const n of pageNumbers) {
    setStatus(`OCR page ${n} of ${pageNumbers[pageNumbers.length - 1]}… (local processing)`);
    const { canvas, viewport } = await renderPageCanvas(n, OCR_DPI);
    let lines;
    if (useSidecar) {
      const png = await canvasToBytes(canvas, 'image/png');
      const resp = await api.ocrPage(png);
      if (!resp.ok) {
        if (resp.unavailable) {
          lines = await tesseractOcr(canvas);
        } else {
          throw new Error(`OCR failed on page ${n}: ${resp.error}`);
        }
      } else {
        lines = resp.lines;
      }
    } else {
      lines = await tesseractOcr(canvas);
    }
    results.push({ n, viewport, lines });
  }

  const totalLines = results.reduce((sum, r) => sum + r.lines.length, 0);
  if (!totalLines) {
    setStatus('OCR found no text on the selected pages');
    return;
  }

  await applyEdit('OCR text layer', async (doc) => {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const { n, viewport, lines } of results) {
      const page = doc.getPage(n - 1);
      page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));
      for (const line of lines) {
        drawInvisibleLine(page, font, viewport, line);
      }
      page.pushOperators(
        setTextRenderingMode(TextRenderingMode.Fill),
        PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(100)]),
      );
    }
  });
  setStatus(`OCR complete — ${totalLines} line${totalLines === 1 ? '' : 's'} of text added (invisible layer)`);
}

// Places one recognised line as invisible text matching its box geometry.
function drawInvisibleLine(page, font, viewport, line) {
  const text = line.text
    .replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return;

  // Box corners (image px, y-down) -> PDF space (y-up): [tl, tr, br, bl].
  const [tl, tr, , bl] = line.box.map(([x, y]) => {
    const [px, py] = viewport.convertToPdfPoint(x, y);
    return { x: px, y: py };
  });
  const height = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const width = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  if (height < 2 || width < 2) return;

  const size = height * 0.92;
  const angle = Math.atan2(tr.y - tl.y, tr.x - tl.x) * (180 / Math.PI);

  // Stretch/squeeze glyphs horizontally so the invisible text spans exactly
  // the recognised box, keeping selection and search hits aligned.
  const natural = font.widthOfTextAtSize(text, size) || 1;
  const hscale = Math.min(400, Math.max(25, (width / natural) * 100));
  page.pushOperators(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(hscale)]));

  page.drawText(text, {
    x: bl.x,
    y: bl.y + size * 0.18,
    size,
    font,
    color: rgb(0, 0, 0),
    rotate: degrees(angle),
  });
}

// ---------------- Tesseract.js fallback ----------------

let tesseractWorker = null;

async function tesseractOcr(canvas) {
  if (!tesseractWorker) {
    setStatus('Starting Tesseract.js fallback engine…');
    const { createWorker } = await import('tesseract.js');
    tesseractWorker = await createWorker('eng', 1, {
      workerPath: new URL('./tesseract/worker.min.js', location.href).toString(),
      corePath: new URL('./tesseract/core/', location.href).toString(),
      langPath: new URL('./tesseract/lang/', location.href).toString(),
      gzip: true,
    });
  }
  const { data } = await tesseractWorker.recognize(
    canvas.toDataURL('image/png'),
    {},
    { blocks: true }, // v6+ only emits line/word geometry when asked
  );
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const l of para.lines || []) {
        if (!l.text?.trim() || l.confidence < 35) continue;
        const { x0, y0, x1, y1 } = l.bbox;
        lines.push({
          text: l.text.trim(),
          box: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
          score: l.confidence / 100,
        });
      }
    }
  }
  return lines;
}
