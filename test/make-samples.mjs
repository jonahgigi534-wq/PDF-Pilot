// Generates sample PDFs used by tests and smoke runs into test/samples/.
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'samples');
fs.mkdirSync(outDir, { recursive: true });

export async function makeTextSample() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);

  for (let p = 1; p <= 5; p++) {
    const page = doc.addPage([612, 792]); // US Letter
    page.drawText(`Sample Document — Page ${p}`, {
      x: 72, y: 720, size: 22, font: helvBold, color: rgb(0.1, 0.1, 0.35),
    });
    page.drawLine({ start: { x: 72, y: 708 }, end: { x: 540, y: 708 }, thickness: 1.5, color: rgb(0.3, 0.3, 0.6) });

    const para = [
      'The quick brown fox jumps over the lazy dog. This paragraph exists so',
      'that searching, selecting and editing text can be exercised in tests.',
      `Unique marker for this page: MARKER-P${p}-XYZ.`,
      'PDFPilot is a free, open-source PDF editor that works fully offline.',
    ];
    para.forEach((line, i) => {
      page.drawText(line, { x: 72, y: 660 - i * 20, size: 12, font: p % 2 ? helv : times });
    });

    page.drawRectangle({ x: 72, y: 480, width: 140, height: 80, color: rgb(0.85, 0.9, 1), borderColor: rgb(0.2, 0.4, 0.8), borderWidth: 2 });
    page.drawEllipse({ x: 320, y: 520, xScale: 60, yScale: 40, color: rgb(1, 0.9, 0.85), borderColor: rgb(0.8, 0.4, 0.2), borderWidth: 2 });
    page.drawText(`${p}`, { x: 300, y: 40, size: 12, font: helv, color: rgb(0.4, 0.4, 0.4) });
  }
  const bytes = await doc.save();
  const file = path.join(outDir, 'sample.pdf');
  fs.writeFileSync(file, bytes);
  return file;
}

export async function makeSecondSample() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= 3; p++) {
    const page = doc.addPage([595, 842]); // A4
    page.drawText(`Second document, page ${p} of 3`, { x: 60, y: 780, size: 18, font: helv });
    if (p === 2) page.setRotation(degrees(90));
  }
  const file = path.join(outDir, 'sample2.pdf');
  fs.writeFileSync(file, await doc.save());
  return file;
}

export async function makeFormSample() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('Test Form', { x: 72, y: 720, size: 20, font: helv });

  const form = doc.getForm();
  const label = (text, y) => page.drawText(text, { x: 72, y, size: 11, font: helv });

  label('Name:', 664);
  const name = form.createTextField('name');
  name.addToPage(page, { x: 160, y: 650, width: 220, height: 24 });

  label('I agree:', 614);
  const agree = form.createCheckBox('agree');
  agree.addToPage(page, { x: 160, y: 604, width: 18, height: 18 });

  label('Colour:', 564);
  const colour = form.createDropdown('colour');
  colour.addOptions(['Red', 'Blue', 'Green']);
  colour.select('Red');
  colour.addToPage(page, { x: 160, y: 552, width: 140, height: 24 });

  label('Size:', 514);
  const size = form.createRadioGroup('size');
  size.addOptionToPage('S', page, { x: 160, y: 500, width: 16, height: 16 });
  size.addOptionToPage('M', page, { x: 200, y: 500, width: 16, height: 16 });
  size.addOptionToPage('L', page, { x: 240, y: 500, width: 16, height: 16 });

  const file = path.join(outDir, 'sample-form.pdf');
  fs.writeFileSync(file, await doc.save());
  return file;
}

const made = [await makeTextSample(), await makeSecondSample(), await makeFormSample()];
console.log('samples written:\n  ' + made.join('\n  '));
