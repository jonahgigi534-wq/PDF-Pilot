// Low-level pdf-lib helpers shared by editing features.
import { PDFName, PDFArray, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function latin1Bytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function regexEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reads a page's (possibly multi-part) content stream as a latin1 string.
export function readPageContent(doc, page) {
  const contents = page.node.Contents();
  if (!contents) return null;
  const streams = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const s = doc.context.lookup(contents.get(i));
      if (s instanceof PDFRawStream) streams.push(s);
      else return null;
    }
  } else {
    const s = contents instanceof PDFRawStream ? contents : doc.context.lookup(page.node.get(PDFName.of('Contents')));
    if (!(s instanceof PDFRawStream)) return null;
    streams.push(s);
  }
  try {
    return streams.map((s) => latin1(decodePDFRawStream(s).decode())).join('\n');
  } catch {
    return null;
  }
}

export function writePageContent(doc, page, content) {
  const stream = doc.context.stream(latin1Bytes(content));
  const ref = doc.context.register(stream);
  page.node.set(PDFName.of('Contents'), ref);
}

// Best-effort removal of the operator that paints `str` on the page. Returns
// true when the operator was found and removed; callers fall back to covering
// the text with a white box when this fails (e.g. subset-font encodings).
export function tryRemoveTextOp(doc, page, str) {
  const content = readPageContent(doc, page);
  if (!content) return false;

  // Literal string form: (escaped) Tj
  const lit = str.replace(/([\\()])/g, '\\$1');
  const litRe = new RegExp(regexEscape(`(${lit})`) + '\\s*Tj', 'g');

  // Hex string form: <hex> Tj (pdf-lib writes text this way)
  let hex = '';
  for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(2, '0');
  const hexRe = new RegExp('<' + regexEscape(hex) + '>\\s*Tj', 'gi');

  for (const re of [litRe, hexRe]) {
    const matches = content.match(re);
    if (matches && matches.length === 1) {
      writePageContent(doc, page, content.replace(re, ''));
      return true;
    }
  }
  return false;
}
