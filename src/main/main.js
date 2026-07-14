const { app, BrowserWindow, protocol, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const DIST = path.join(__dirname, '..', '..', 'dist', 'renderer');

// Smoke-test mode: `electron . --smoke <input.pdf> <output.png>` renders the PDF,
// captures a screenshot, and exits. Used by automated tests.
let smoke = null;
{
  const i = process.argv.indexOf('--smoke');
  if (i !== -1 && process.argv[i + 1] && process.argv[i + 2]) {
    smoke = {
      input: path.resolve(process.argv[i + 1]),
      output: path.resolve(process.argv[i + 2]),
    };
    const a = process.argv.indexOf('--action');
    if (a !== -1 && process.argv[a + 1]) smoke.action = process.argv[a + 1];
    const p = process.argv.indexOf('--pw');
    if (p !== -1 && process.argv[p + 1]) smoke.pw = process.argv[p + 1];
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pfb': 'application/octet-stream',
  '.bcmap': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.icc': 'application/octet-stream',
};

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 600,
    show: !smoke,
    backgroundColor: '#26272b',
    title: 'PDFPilot',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Offscreen rendering keeps frames painting in the hidden smoke-test
      // window so capturePage sees current content and rAF fires.
      offscreen: !!smoke,
      backgroundThrottling: !smoke,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  if (smoke) {
    mainWindow.webContents.on('console-message', (e) => {
      console.log(`[renderer] ${e.message}`);
    });
  }
  let url = 'app://pdfpilot/index.html';
  if (smoke) {
    url += '?smoke=1&file=' + encodeURIComponent(smoke.input);
    if (smoke.action) url += '&action=' + encodeURIComponent(smoke.action);
    if (smoke.pw) url += '&pw=' + encodeURIComponent(smoke.pw);
  }
  mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const data = fs.readFileSync(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  createWindow();

  if (smoke) {
    setTimeout(() => {
      console.error('SMOKE_TIMEOUT');
      app.exit(1);
    }, 45000);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

// ---------------- IPC ----------------

ipcMain.handle('dialog:open-pdfs', async (e, opts = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'Open PDF',
    filters: opts.filters || [{ name: 'PDF documents', extensions: ['pdf'] }],
    properties: opts.multi ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:pick-dir', async (e, opts = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: opts.title || 'Choose folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:save', async (e, opts = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: opts.title || 'Save',
    defaultPath: opts.defaultPath,
    filters: opts.filters || [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('file:read', async (e, filePath) => {
  return fs.promises.readFile(filePath);
});

ipcMain.handle('file:write', async (e, filePath, data) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, Buffer.from(data));
  return true;
});

ipcMain.handle('window:set-title', (e, title) => {
  if (mainWindow) mainWindow.setTitle(title ? `${title} — PDFPilot` : 'PDFPilot');
});

// ---------------- OCR sidecar ----------------
// Long-running Python process (RapidOCR + OpenCV) speaking JSON-lines.
// Dev: sidecar/venv python. Packaged: resources/sidecar/pdfpilot-ocr.exe.

let sidecar = null; // { proc, pending: Map<id, {resolve, reject, timer}>, nextId }

function sidecarCommand() {
  if (app.isPackaged) {
    return { cmd: path.join(process.resourcesPath, 'sidecar', 'pdfpilot-ocr.exe'), args: [] };
  }
  const root = path.join(__dirname, '..', '..');
  return {
    cmd: path.join(root, 'sidecar', 'venv', 'Scripts', 'python.exe'),
    args: [path.join(root, 'sidecar', 'ocr_worker.py')],
  };
}

function ensureSidecar() {
  if (sidecar) return sidecar;
  if (process.env.PDFPILOT_NO_SIDECAR) return null; // fallback testing
  const { cmd, args } = sidecarCommand();
  if (!fs.existsSync(cmd)) return null;

  const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const s = { proc, pending: new Map(), nextId: 1 };

  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = s.pending.get(msg.id);
    if (waiter) {
      s.pending.delete(msg.id);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
    }
  });
  proc.stderr.on('data', (d) => console.error('[ocr-sidecar]', String(d).trim()));
  proc.on('exit', (code) => {
    for (const waiter of s.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`OCR sidecar exited (code ${code})`));
    }
    if (sidecar === s) sidecar = null;
  });

  s.request = (payload, timeoutMs = 180000) =>
    new Promise((resolve, reject) => {
      const id = s.nextId++;
      const timer = setTimeout(() => {
        s.pending.delete(id);
        reject(new Error('OCR request timed out'));
      }, timeoutMs);
      s.pending.set(id, { resolve, reject, timer });
      proc.stdin.write(JSON.stringify({ id, ...payload }) + '\n');
    });

  sidecar = s;
  return s;
}

app.on('will-quit', () => {
  sidecar?.proc.kill();
});

ipcMain.handle('ocr:status', async () => {
  const s = ensureSidecar();
  if (!s) return { available: false };
  try {
    const resp = await s.request({ op: 'ping' }, 30000);
    return { available: !!resp.ok, engine: resp.engine };
  } catch (err) {
    return { available: false, error: err.message };
  }
});

ipcMain.handle('ocr:page', async (e, pngBytes) => {
  const s = ensureSidecar();
  if (!s) return { ok: false, unavailable: true };
  const tmpDir = path.join(app.getPath('temp'), 'pdfpilot-ocr');
  fs.mkdirSync(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `page-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(file, Buffer.from(pngBytes));
  try {
    return await s.request({ op: 'ocr', image: file });
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    fs.rmSync(file, { force: true });
  }
});

// Print: receives rendered page images, shows the system print dialog from a
// hidden window. dryRun (used by tests) skips the dialog and reports success.
ipcMain.handle('print:pages', async (e, { images, dryRun }) => {
  const html = `<!DOCTYPE html><html><head><style>
    html, body { margin: 0; }
    img { display: block; width: 100vw; page-break-after: always; }
    img:last-child { page-break-after: auto; }
  </style></head><body>${images.map((src) => `<img src="${src}" />`).join('')}</body></html>`;

  const printWin = new BrowserWindow({ show: false, parent: mainWindow });
  await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  if (dryRun) {
    printWin.destroy();
    return { ok: true, pages: images.length };
  }
  return new Promise((resolve) => {
    printWin.webContents.print({}, (success, reason) => {
      printWin.destroy();
      resolve({ ok: success, reason });
    });
  });
});

// ---------------- smoke test ----------------

ipcMain.on('smoke:rendered', async (e, info) => {
  if (!smoke) return;
  try {
    // Give the compositor a moment to paint the final frame.
    await new Promise((r) => setTimeout(r, 500));
    const image = await mainWindow.webContents.capturePage();
    fs.mkdirSync(path.dirname(smoke.output), { recursive: true });
    fs.writeFileSync(smoke.output, image.toPNG());
    console.log('SMOKE_OK ' + JSON.stringify(info));
    app.exit(0);
  } catch (err) {
    console.error('SMOKE_CAPTURE_FAIL ' + err.message);
    app.exit(1);
  }
});

ipcMain.on('smoke:error', (e, msg) => {
  if (!smoke) return;
  console.error('SMOKE_ERROR ' + msg);
  app.exit(2);
});
