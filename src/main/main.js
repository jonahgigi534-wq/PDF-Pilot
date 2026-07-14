const { app, BrowserWindow, protocol, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

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
    },
  });
  mainWindow.setMenuBarVisibility(false);

  let url = 'app://pdfpilot/index.html';
  if (smoke) {
    url += '?smoke=1&file=' + encodeURIComponent(smoke.input);
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
