// Form creation: drag a rectangle on the page to place text fields,
// checkboxes, dropdowns, or signature fields.
import { rgb, PDFName, PDFArray, PDFHexString } from 'pdf-lib';
import { setStatus } from './state.js';
import { getPageView } from './viewer.js';
import { applyEdit } from './document.js';
import { registerTool, setTool } from './tools.js';
import { showModal } from './modal.js';

const FIELD_STYLE = {
  borderColor: rgb(0.45, 0.55, 0.75),
  borderWidth: 1,
  backgroundColor: rgb(0.94, 0.96, 1),
};

export function initFormCreate() {
  for (const kind of ['text', 'checkbox', 'dropdown', 'signature']) {
    registerTool(`form-${kind}`, {
      cursor: 'crosshair',
      overlayEvents: true,
      onPointerDown: (n, v, x, y, e) => fieldDragStart(kind, n, v, x, y, e),
      onPointerMove: fieldDragMove,
      onPointerUp: fieldDragEnd,
    });
  }
}

let drag = null; // { kind, n, view, x0, y0, marquee }

function fieldDragStart(kind, n, view, x, y, e) {
  try {
    view.overlay.setPointerCapture(e.pointerId);
  } catch { /* programmatic invocation */ }
  const marquee = document.createElement('div');
  marquee.className = 'marquee field-marquee';
  view.overlay.appendChild(marquee);
  drag = { kind, n, view, x0: x, y0: y, marquee };
}

function fieldDragMove(n, view, x, y) {
  if (!drag) return;
  drag.marquee.style.left = `${Math.min(drag.x0, x)}px`;
  drag.marquee.style.top = `${Math.min(drag.y0, y)}px`;
  drag.marquee.style.width = `${Math.abs(x - drag.x0)}px`;
  drag.marquee.style.height = `${Math.abs(y - drag.y0)}px`;
}

async function fieldDragEnd(n, view, x, y) {
  if (!drag) return;
  const { kind, n: dn, view: dview, x0, y0, marquee } = drag;
  drag = null;
  marquee.remove();
  if (Math.abs(x - x0) < 8 || Math.abs(y - y0) < 8) {
    setStatus('Drag a rectangle to size the field');
    return;
  }

  const fields = [{ name: 'name', label: 'Field name', value: '' }];
  if (kind === 'dropdown') {
    fields.push({ name: 'options', label: 'Options (comma-separated)', value: 'Option 1, Option 2' });
  }
  const values = await showModal({
    title: `New ${kind} field`,
    fields,
    okText: 'Create field',
  });
  if (!values || !values.name.trim()) return;

  const opts = (values.options || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await createFormField(kind, dn, dview, x0, y0, x, y, values.name.trim(), opts);
  setTool('select');
}

export async function createFormField(kind, n, view, cx0, cy0, cx1, cy1, name, options = []) {
  const [px0, py0] = view.viewport.convertToPdfPoint(cx0, cy0);
  const [px1, py1] = view.viewport.convertToPdfPoint(cx1, cy1);
  const x = Math.min(px0, px1);
  const y = Math.min(py0, py1);
  let width = Math.abs(px1 - px0);
  let height = Math.abs(py1 - py0);
  if (kind === 'checkbox') {
    width = height = Math.min(width, height);
  }

  await applyEdit(`Create ${kind} field`, (doc) => {
    const form = doc.getForm();
    // Ensure a unique field name.
    let unique = name;
    let i = 2;
    while (fieldExists(form, unique)) {
      unique = `${name}_${i++}`;
    }
    const page = doc.getPage(n - 1);
    const box = { x, y, width, height, ...FIELD_STYLE };

    if (kind === 'text') {
      form.createTextField(unique).addToPage(page, box);
    } else if (kind === 'checkbox') {
      form.createCheckBox(unique).addToPage(page, box);
    } else if (kind === 'dropdown') {
      const dd = form.createDropdown(unique);
      dd.addOptions(options.length ? options : ['Option 1']);
      dd.addToPage(page, box);
    } else if (kind === 'signature') {
      addSignatureField(doc, form, page, unique, [x, y, x + width, y + height]);
    }
  });
  setStatus(`Field "${name}" created`);
}

function fieldExists(form, name) {
  try {
    form.getField(name);
    return true;
  } catch {
    return false;
  }
}

// pdf-lib has no signature-field creation API, so build the Widget/Sig
// dictionary directly and register it with the AcroForm.
function addSignatureField(doc, form, page, name, rect) {
  const widget = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: rect,
    T: PDFHexString.fromText(name),
    F: 4,
  });
  const ref = doc.context.register(widget);

  let annots = page.node.get(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    annots.push(ref);
  } else {
    page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
  }
  form.acroForm.normalizedEntries().Fields.push(ref);
}
