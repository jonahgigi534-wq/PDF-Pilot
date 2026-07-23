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

Requires Node.js 20+ on Windows. To build the OCR engine (optional but
recommended — without it OCR uses the slower Tesseract.js fallback), you need
Python 3.10+ once, to build the self-contained sidecar:

```
cd sidecar
python -m venv venv
venv\Scripts\pip install rapidocr-onnxruntime opencv-python-headless pyinstaller
cd ..
npm run build:sidecar    # produces sidecar/dist/pdfpilot-ocr (bundled into the installer)
```

End users never need Python — the sidecar is a self-contained executable
inside the installer.

## Automatic updates

PDFPilot updates itself. On launch (and every 6 hours) the installed app
checks GitHub Releases for a newer version, downloads it in the background,
and installs it the next time the app is restarted — the user never
re-installs manually. Delta updates mean only the changed parts download, not
the whole installer each time. A small toast appears when an update is ready,
with a **Restart now** button.

**To enable it (one-time setup by the publisher):**

1. Create a **public** GitHub repository named `PDFPilot`.
2. In `package.json`, under `build.publish`, replace `YOUR_GITHUB_USERNAME`
   with your GitHub username.
3. Create a [personal access token](https://github.com/settings/tokens) with
   the `repo` scope and set it in your shell: `set GH_TOKEN=ghp_yourtoken`.

**To ship an update:** bump `"version"` in `package.json` (e.g. `0.1.1`),
rebuild the OCR sidecar if it changed (`npm run build:sidecar`), then run:

```
npm run release
```

That builds the installer and uploads it plus the `latest.yml` manifest to a
GitHub release. Every installed copy picks it up automatically within a few
hours (or on next launch). Until this setup is done, the app simply skips the
update check — everything else works normally.

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
- **Edit scan** — edit text on scanned or photocopied pages, where the "text"
  is really just image pixels. Click a line: PDFPilot runs OCR on that page,
  then lets you retype the recognised text. On commit it paints over the
  original scanned pixels (matching the paper colour) and drops in real,
  selectable text — the same approach Acrobat uses. Works well on clean
  printed scans; the substituted font won't perfectly match the original, and
  handwriting isn't reliable (an OCR limitation).
- **Image** — insert a PNG/JPG, then click where it should go.
- **White-out** — drag a rectangle to cover content with white (visual cover
  only; use **Redact** to permanently remove content).
- **Word mode…** — for heavy edits (rewriting paragraphs, reformatting). The
  current page or whole document is converted to .docx via LibreOffice and
  opened in your word processor; edit, save, then click **Re-import into
  PDF** in the yellow bar. Because this is a full round-trip, complex
  layouts may shift slightly — the UI warns you. Requires LibreOffice (see
  below).

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
- **OCR…** — makes scanned/image-only pages searchable and selectable. Pages
  are preprocessed with OpenCV (denoise, deskew, upscale) and read by
  PaddleOCR's PP-OCR models running on ONNX Runtime, all inside a bundled
  local engine; recognised text is added as an invisible layer over the scan,
  so the page looks exactly the same but search, selection, and copy work.
  If the bundled engine is missing, a pure-JS Tesseract fallback runs
  instead. Expect a few seconds per page — everything is processed locally.
- **Export images…** — save pages as PNG/JPG at 96–300 DPI.
- **Protect…** — set an open password (AES). **Remove password** decrypts
  (you need the current password). Don't lose the password — there is no
  recovery.
- **Redact** — drag black boxes over anything sensitive, then **Apply
  redactions**. Affected pages are re-rendered as images with the areas
  blacked out, so the underlying text/graphics are *permanently destroyed*,
  not just covered. Double-click a pending mark to remove it before applying.
- **Convert…** — *PDF → Word (.docx)*, *Word/ODT/RTF → PDF* (both via
  LibreOffice), and *Images → PDF* (built in, no LibreOffice needed).
- **Print** (Ctrl+P) — sends rendered pages to the system print dialog.

### About LibreOffice
Word mode and PDF ↔ Word conversion use headless LibreOffice (free, open
source) running locally. PDFPilot looks for an installed copy automatically;
if none is found, it offers to install it for you via Windows' built-in
`winget` package manager (~350 MB, user-approved), or you can point it at an
existing `soffice.exe`. Everything else in PDFPilot works without it.

Note: OCR and Word-mode conversion take a few seconds per page — all
processing happens locally on your machine, never in the cloud.

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
