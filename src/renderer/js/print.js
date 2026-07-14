// Print: rasterise pages and hand them to a hidden window in the main process.
import { state, setStatus } from './state.js';
import { renderPageCanvas } from './render-utils.js';

const api = window.pdfpilot;

export async function printDocument({ dryRun = false } = {}) {
  if (!state.bytes) return null;
  setStatus('Preparing to print…');
  const images = [];
  for (let n = 1; n <= state.pageCount; n++) {
    const { canvas } = await renderPageCanvas(n, 150);
    images.push(canvas.toDataURL('image/jpeg', 0.92));
  }
  const result = await api.printPages({ images, dryRun });
  setStatus(result.ok ? (dryRun ? 'Print preview ready' : 'Sent to printer') : `Print cancelled${result.reason ? `: ${result.reason}` : ''}`);
  return result;
}
