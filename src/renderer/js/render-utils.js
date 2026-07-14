// Rasterisation helpers shared by compress, redaction, image export, print.
import { getPageView } from './viewer.js';

export async function renderPageCanvas(n, dpi = 150) {
  const view = getPageView(n);
  const viewport = view.page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await view.page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, viewport };
}

export async function canvasToBytes(canvas, type = 'image/png', quality) {
  const blob = await new Promise((r) => canvas.toBlob(r, type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}
