// Form filling: AcroForm widgets get live HTML inputs overlaid on the page.
// Values collect in a pending map and are flushed into the PDF (via pdf-lib)
// before any other edit and before saving.
import { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import { setStatus } from './state.js';
import { onPageRendered, pdfRectToCss } from './viewer.js';
import { applyEdit, registerPreEditHook } from './document.js';

const pending = new Map(); // fieldName -> value (string | boolean)
let flushing = false;

export function initForms() {
  onPageRendered((n, view) => renderFormFields(n, view));
  registerPreEditHook(async () => {
    if (!flushing) await flushFormValues();
  });
}

export async function flushFormValues() {
  if (!pending.size || flushing) return;
  flushing = true;
  const entries = [...pending];
  pending.clear();
  try {
    await applyEdit('Fill form fields', async (doc) => {
      let form;
      try {
        form = doc.getForm();
      } catch {
        return;
      }
      for (const [name, value] of entries) {
        try {
          const field = form.getField(name);
          if (field instanceof PDFTextField) {
            field.setText(String(value));
          } else if (field instanceof PDFCheckBox) {
            if (value) field.check();
            else field.uncheck();
          } else if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
            field.select(String(value));
          }
        } catch (err) {
          console.warn(`form field "${name}":`, err.message);
        }
      }
      form.updateFieldAppearances();
    });
  } finally {
    flushing = false;
  }
}

export function setPendingFieldValue(name, value) {
  pending.set(name, value);
  setStatus('Form changes pending — they are applied when you save');
}

async function renderFormFields(n, view) {
  for (const el of view.overlay.querySelectorAll('.form-field')) el.remove();
  let annots;
  try {
    annots = await view.page.getAnnotations();
  } catch {
    return;
  }

  for (const a of annots) {
    if (a.subtype !== 'Widget' || !a.fieldName) continue;
    const { left, top, width: w, height: h } = pdfRectToCss(view.viewport, a.rect);

    let el = null;
    if (a.fieldType === 'Tx') {
      el = document.createElement(a.multiLine ? 'textarea' : 'input');
      if (!a.multiLine) el.type = 'text';
      el.value = pending.get(a.fieldName) ?? a.fieldValue ?? '';
      el.style.fontSize = `${Math.max(9, h * 0.55)}px`;
      el.addEventListener('input', () => setPendingFieldValue(a.fieldName, el.value));
    } else if (a.fieldType === 'Btn' && a.checkBox) {
      el = document.createElement('input');
      el.type = 'checkbox';
      const cur = pending.get(a.fieldName);
      el.checked = cur != null ? !!cur : a.fieldValue !== 'Off' && a.fieldValue != null;
      el.addEventListener('change', () => setPendingFieldValue(a.fieldName, el.checked));
    } else if (a.fieldType === 'Btn' && a.radioButton) {
      el = document.createElement('input');
      el.type = 'radio';
      el.name = `radio-${a.fieldName}`;
      el.checked = (pending.get(a.fieldName) ?? a.fieldValue) === a.buttonValue;
      el.addEventListener('change', () => {
        if (el.checked) setPendingFieldValue(a.fieldName, a.buttonValue);
      });
    } else if (a.fieldType === 'Ch') {
      el = document.createElement('select');
      for (const opt of a.options || []) {
        const o = document.createElement('option');
        o.value = opt.exportValue ?? opt.displayValue;
        o.textContent = opt.displayValue ?? opt.exportValue;
        el.appendChild(o);
      }
      const cur = pending.get(a.fieldName) ?? a.fieldValue;
      if (cur != null) el.value = Array.isArray(cur) ? cur[0] : cur;
      el.addEventListener('change', () => setPendingFieldValue(a.fieldName, el.value));
    } else if (a.fieldType === 'Sig') {
      el = document.createElement('div');
      el.className = 'sig-placeholder';
      el.title = 'Signature field — use the Sign tool to place a signature';
      el.textContent = '✎ Signature';
    }
    if (!el) continue;

    el.classList.add('form-field');
    el.dataset.name = a.fieldName;
    if (a.readOnly) el.disabled = true;
    Object.assign(el.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => e.stopPropagation());
    view.overlay.appendChild(el);
  }
}
