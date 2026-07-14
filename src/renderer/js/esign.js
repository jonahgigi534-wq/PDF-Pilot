// E-sign: draw, type, or upload a signature image, then click to place it.
// Typed/drawn signatures are rendered to a transparent PNG (no font embedding
// needed — Windows script fonts are rasterised via canvas). Not certificate
// signing; this stamps a visual signature.
import { setStatus } from './state.js';
import { registerTool, setTool } from './tools.js';
import { applyEdit } from './document.js';

const api = window.pdfpilot;
const LS_KEY = 'pdfpilot-last-signature';
let pendingSig = null; // { bytes: Uint8Array, width, height }

export function initEsign() {
  registerTool('sign', {
    cursor: 'crosshair',
    overlayEvents: true,
    activate: chooseSignature,
    onPageClick: placeSignature,
  });
}

async function chooseSignature() {
  const result = await signatureDialog();
  if (!result) return false;
  pendingSig = result;
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        data: btoa(String.fromCharCode(...result.bytes)),
        width: result.width,
        height: result.height,
      }),
    );
  } catch { /* localStorage full or unavailable — reuse just won't work */ }
  setStatus('Click on the page to place your signature');
  return true;
}

async function placeSignature(n, view, x, y) {
  if (!pendingSig) return;
  const sig = pendingSig;
  const [px, py] = view.viewport.convertToPdfPoint(x, y);
  const targetW = 160; // points
  const targetH = targetW * (sig.height / sig.width);

  await applyEdit('Place signature', async (doc) => {
    const page = doc.getPage(n - 1);
    const img = await doc.embedPng(sig.bytes);
    page.drawImage(img, {
      x: px - targetW / 2,
      y: py - targetH / 2,
      width: targetW,
      height: targetH,
    });
  });
  setTool('select');
}

function loadLastSignature() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const { data, width, height } = JSON.parse(raw);
    return { bytes: Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), width, height };
  } catch {
    return null;
  }
}

// ---------------- signature dialog ----------------

function signatureDialog() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal-box sig-dialog';
    backdrop.appendChild(box);
    box.innerHTML = `
      <h3>Add signature</h3>
      <div class="sig-tabs">
        <button data-tab="draw" class="active">Draw</button>
        <button data-tab="type">Type</button>
        <button data-tab="image">Image</button>
      </div>
      <div class="sig-panel" data-panel="draw">
        <canvas id="sig-canvas" width="440" height="160"></canvas>
        <button id="sig-clear">Clear</button>
      </div>
      <div class="sig-panel hidden" data-panel="type">
        <input id="sig-text" type="text" placeholder="Type your name…" />
        <div id="sig-preview"></div>
      </div>
      <div class="sig-panel hidden" data-panel="image">
        <button id="sig-pick">Choose PNG/JPG…</button>
        <img id="sig-img" class="hidden" alt="signature preview" />
      </div>
      <div class="modal-buttons">
        <button id="sig-last" class="hidden">Use last signature</button>
        <button id="sig-cancel">Cancel</button>
        <button id="sig-ok" class="primary">Use signature</button>
      </div>`;
    document.body.appendChild(backdrop);

    const $ = (sel) => box.querySelector(sel);
    let tab = 'draw';
    let imageBytes = null; // uploaded image

    for (const btn of box.querySelectorAll('.sig-tabs button')) {
      btn.addEventListener('click', () => {
        tab = btn.dataset.tab;
        for (const b of box.querySelectorAll('.sig-tabs button')) b.classList.toggle('active', b === btn);
        for (const p of box.querySelectorAll('.sig-panel')) {
          p.classList.toggle('hidden', p.dataset.panel !== tab);
        }
      });
    }

    // Draw panel
    const canvas = $('#sig-canvas');
    const ctx = canvas.getContext('2d');
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#102040';
    let drawing = false;
    let hasInk = false;
    canvas.addEventListener('pointerdown', (e) => {
      drawing = true;
      hasInk = true;
      const r = canvas.getBoundingClientRect();
      ctx.beginPath();
      ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const r = canvas.getBoundingClientRect();
      ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
      ctx.stroke();
    });
    canvas.addEventListener('pointerup', () => {
      drawing = false;
    });
    $('#sig-clear').addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasInk = false;
    });

    // Type panel
    const sigText = $('#sig-text');
    const sigPreview = $('#sig-preview');
    sigText.addEventListener('input', () => {
      sigPreview.textContent = sigText.value;
    });

    // Image panel
    $('#sig-pick').addEventListener('click', async () => {
      const paths = await api.openPdfDialog({
        title: 'Choose signature image',
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
      });
      if (!paths.length) return;
      imageBytes = new Uint8Array(await api.readFile(paths[0]));
      const img = $('#sig-img');
      img.src = URL.createObjectURL(new Blob([imageBytes]));
      img.classList.remove('hidden');
    });

    // Last signature
    const last = loadLastSignature();
    if (last) $('#sig-last').classList.remove('hidden');
    $('#sig-last').addEventListener('click', () => close(last));

    function close(result) {
      backdrop.remove();
      resolve(result);
    }
    $('#sig-cancel').addEventListener('click', () => close(null));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });

    $('#sig-ok').addEventListener('click', async () => {
      if (tab === 'draw') {
        if (!hasInk) return close(null);
        close(await canvasToSig(trimCanvas(canvas)));
      } else if (tab === 'type') {
        const text = sigText.value.trim();
        if (!text) return close(null);
        close(await canvasToSig(typedSignatureCanvas(text)));
      } else {
        if (!imageBytes) return close(null);
        const bitmap = await createImageBitmap(new Blob([imageBytes]));
        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close();
        close(await canvasToSig(c));
      }
    });
  });
}

export function typedSignatureCanvas(text) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '96px "Segoe Script", "Ink Free", cursive';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 60;
  c.width = w;
  c.height = 180;
  const ctx2 = c.getContext('2d');
  ctx2.font = font;
  ctx2.fillStyle = '#102040';
  ctx2.textBaseline = 'middle';
  ctx2.fillText(text, 30, 90);
  return c;
}

// Crops transparent padding so the placed signature is tight.
function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

async function canvasToSig(canvas) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

// Smoke helper: place a typed signature without the dialog.
export async function smokePlaceSignature(n, x, y, text = 'Jane Tester') {
  const { getPageView } = await import('./viewer.js');
  pendingSig = await canvasToSig(typedSignatureCanvas(text));
  await placeSignature(n, getPageView(n), x, y);
}
