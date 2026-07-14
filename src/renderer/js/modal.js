// Minimal form-modal helper. showModal returns entered values or null on cancel.
export function showModal({ title, message, fields = [], okText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal-box';
    backdrop.appendChild(box);

    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);

    if (message) {
      const p = document.createElement('p');
      p.className = 'modal-message';
      p.textContent = message;
      box.appendChild(p);
    }

    const inputs = new Map();
    for (const f of fields) {
      const row = document.createElement('label');
      row.className = 'modal-row';
      const span = document.createElement('span');
      span.textContent = f.label;
      row.appendChild(span);
      let input;
      if (f.type === 'select') {
        input = document.createElement('select');
        for (const opt of f.options) {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          input.appendChild(o);
        }
        if (f.value != null) input.value = f.value;
      } else if (f.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = f.rows || 4;
        input.value = f.value ?? '';
        if (f.placeholder) input.placeholder = f.placeholder;
        row.classList.add('modal-row-textarea');
      } else if (f.type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!f.value;
        row.classList.add('modal-row-checkbox');
      } else {
        input = document.createElement('input');
        input.type = f.type || 'text';
        input.value = f.value ?? '';
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      inputs.set(f.name, input);
      row.appendChild(input);
      box.appendChild(row);
    }

    const buttons = document.createElement('div');
    buttons.className = 'modal-buttons';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelText;
    const okBtn = document.createElement('button');
    okBtn.textContent = okText;
    okBtn.className = 'primary';
    buttons.append(cancelBtn, okBtn);
    box.appendChild(buttons);

    function close(result) {
      backdrop.remove();
      resolve(result);
    }
    function collect() {
      const values = {};
      for (const [name, input] of inputs) {
        values[name] = input.type === 'checkbox' ? input.checked : input.value;
      }
      return values;
    }

    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => close(collect()));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !['SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
        e.preventDefault();
        close(collect());
      }
      if (e.key === 'Escape') close(null);
      e.stopPropagation();
    });

    document.body.appendChild(backdrop);
    const first = inputs.values().next().value;
    (first || okBtn).focus();
    if (first?.select) first.select();
  });
}
