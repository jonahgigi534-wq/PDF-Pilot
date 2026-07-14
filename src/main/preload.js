const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfpilot', {
  openPdfDialog: (opts) => ipcRenderer.invoke('dialog:open-pdfs', opts),
  pickDirDialog: (opts) => ipcRenderer.invoke('dialog:pick-dir', opts),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('file:write', filePath, data),
  setTitle: (title) => ipcRenderer.invoke('window:set-title', title),
  printPages: (payload) => ipcRenderer.invoke('print:pages', payload),
  ocrStatus: () => ipcRenderer.invoke('ocr:status'),
  ocrPage: (pngBytes) => ipcRenderer.invoke('ocr:page', pngBytes),
  sofficeStatus: () => ipcRenderer.invoke('soffice:status'),
  sofficeLocate: () => ipcRenderer.invoke('soffice:locate'),
  sofficeInstall: () => ipcRenderer.invoke('soffice:install-winget'),
  sofficeConvert: (opts) => ipcRenderer.invoke('soffice:convert', opts),
  tempWrite: (data, ext) => ipcRenderer.invoke('temp:write', data, ext),
  openPath: (p) => ipcRenderer.invoke('shell:open-path', p),
  smokeRendered: (info) => ipcRenderer.send('smoke:rendered', info),
  smokeError: (msg) => ipcRenderer.send('smoke:error', msg),
});
