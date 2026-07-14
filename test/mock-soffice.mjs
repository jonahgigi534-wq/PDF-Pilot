// Stand-in for headless LibreOffice used by the automated tests. Mimics
// `soffice --headless --convert-to <fmt> --outdir <dir> <input>` closely
// enough to exercise PDFPilot's conversion plumbing without LibreOffice.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const fmt = args[args.indexOf('--convert-to') + 1];
const outDir = args[args.indexOf('--outdir') + 1];
const input = args[args.length - 1];
const out = path.join(outDir, path.basename(input, path.extname(input)) + '.' + fmt);

if (fmt === 'docx') {
  fs.writeFileSync(out, 'MOCKDOCX from ' + path.basename(input));
} else if (fmt === 'pdf') {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText('WORDMODE-EDITED-PAGE', { x: 72, y: 700, size: 24, font });
  fs.writeFileSync(out, await doc.save());
} else {
  console.error('mock-soffice: unsupported format ' + fmt);
  process.exit(1);
}
console.log(`convert ${input} -> ${out}`);
