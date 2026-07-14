// Central app state. The Uint8Array in `bytes` is the single source of truth for
// the document; pdf.js renders from a copy of it and pdf-lib edits produce new bytes.
export const state = {
  filePath: null,
  bytes: null,          // Uint8Array — authoritative document bytes
  pdf: null,            // pdf.js PDFDocumentProxy rendered from `bytes`
  pageCount: 0,
  currentPage: 1,
  scale: 1.25,
  tool: 'select',
  dirty: false,
  undoStack: [],
  redoStack: [],
};

export function setStatus(text) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}
