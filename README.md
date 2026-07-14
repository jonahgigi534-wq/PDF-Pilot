# PDFPilot

A free, open-source desktop PDF editor for Windows 11 — similar in spirit to
Adobe Acrobat, but with no license keys, no subscriptions, no accounts, and no
cloud. Everything runs **100% locally and offline** on your machine.

Built with [Electron](https://www.electronjs.org/),
[PDF.js](https://mozilla.github.io/pdf.js/) (Mozilla) for rendering, and
[pdf-lib](https://pdf-lib.js.org/) for editing. Password protection uses
[@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (an MIT-licensed
pdf-lib fork with encryption support). All dependencies are MIT/Apache-style
licensed, so PDFPilot stays free to use and distribute. Licensed under the
[MIT License](LICENSE).

## Install

Grab `PDFPilot-Setup-<version>.exe` from the releases folder (or build it
yourself, below), run it, and pick an install folder. That's it — no product
key, no sign-in. Windows SmartScreen may warn that the app is unsigned; click
**More info → Run anyway** (code-signing certificates cost money, and this
project is free).

### Building from source

```
npm install          # fetch dependencies
npm start            # run the app in development
npm test             # run the automated feature tests
node scripts/make-icon.mjs   # regenerate the app icon (optional)
npm run dist         # build the Windows installer into release/
```

Requires Node.js 20+ on Windows. No Python or other runtime is needed for the
features below.

## Using PDFPilot

Open a PDF with **Open** (Ctrl+O). The left rail shows page thumbnails; the
sidebar holds the tools. **Save** (Ctrl+S) / **Save As** (Ctrl+Shift+S) write
your changes; every edit below is undoable with **Undo/Redo** (Ctrl+Z /
Ctrl+Y) until you close the app.

### View & navigate
- **Zoom** with the −/+ buttons, `Ctrl+-`/`Ctrl+=`, or **Fit** for fit-width.
- **Navigate** with the ◀/▶ buttons, the page number box, or by clicking a
  thumbnail.
- **Search** (Ctrl+F): type a term and press Enter; ↑/↓ hop between matches,
  which are highlighted on the page. Esc clears.

### Edit
- **Edit text** — click any piece of text, retype it in the box that appears,
  press Enter. PDFPilot removes the original text (really removes it from the
  file where possible) and redraws your text in a matching size and font
  style. Best for small fixes — a typo, a date, a name. For rewriting whole
  paragraphs, wait for "Edit in Word mode" (planned, see below).
- **Image** — insert a PNG/JPG, then click where it should go.
- **White-out** — drag a rectangle to cover content with white (visual cover
  only; use **Redact** to permanently remove content).

### Pages
- Hover a thumbnail for per-page actions: move up/down, rotate 90°, insert a
  blank page, insert pages from another PDF, delete.
- **Merge…** appends whole PDFs to the current document (or builds a new one
  if nothing is open).
- **Split…** writes page ranges (e.g. `1-3; 4; 5-`) as separate files.

### Annotate
Pick a colour from the dropdown, then:
- **Highlight / Underline / Strike** — choose the tool, then select text with
  the mouse; the markup applies when you release.
- **Note** — click the page, type a comment. Notes are saved as real PDF
  annotations, so Acrobat and other viewers show them too. Click a note icon
  to read or delete it.
- **Draw** — freehand pen. **Rectangle / Ellipse / Line** — drag to draw.
- **Text box** — click the page and type; click away to commit, Esc cancels.

### Forms
- Opening a PDF with form fields shows them as live inputs — just type. Your
  entries are written into the real form fields when you save (they remain
  editable in other PDF apps).
- Create your own form with **Text field / Checkbox / Dropdown / Sig field**:
  drag a rectangle, name the field, done.

### Sign
**Sign** opens a dialog where you can **draw** a signature, **type** it (it's
rendered in a handwriting font), or **upload** an image — then click the page
to place it. Your last signature is remembered. This places a visual
signature image; it is not certificate-based digital signing.

### Tools
- **Compress…** — *Optimize* is lossless; *Rasterize* converts pages to
  images (much smaller for scans, but text/forms are flattened).
- **Export images…** — save pages as PNG/JPG at 96–300 DPI.
- **Protect…** — set an open password (AES). **Remove password** decrypts
  (you need the current password). Don't lose the password — there is no
  recovery.
- **Redact** — drag black boxes over anything sensitive, then **Apply
  redactions**. Affected pages are re-rendered as images with the areas
  blacked out, so the underlying text/graphics are *permanently destroyed*,
  not just covered. Double-click a pending mark to remove it before applying.
- **Print** (Ctrl+P) — sends rendered pages to the system print dialog.

## Planned (not yet built)
These are coming in a later phase because they add heavyweight local
processing to the installer:
- **OCR for scanned PDFs** (OpenCV preprocessing + PaddleOCR/docTR, with a
  Tesseract.js fallback) producing an invisible, selectable text layer.
- **"Edit in Word mode"** and **PDF ↔ Word conversion** via headless
  LibreOffice round-trips.

Note: when these land, OCR and Word-mode conversions may take a few seconds
per page — all processing happens locally on your machine, never in the
cloud.

## Notes & limitations
- Inline text editing matches the original with the closest standard font
  (Helvetica/Times/Courier families); exotic embedded fonts are approximated.
- Highlights and drawings are drawn into the page content on save (they
  print and display everywhere, but can't be re-selected as annotation
  objects afterwards). Sticky notes are real annotations.
- Rasterize-compress and redaction flatten the affected pages to images by
  design.
- No telemetry, no network calls: you can verify — the app sets a strict
  Content-Security-Policy and never requests a remote URL.
