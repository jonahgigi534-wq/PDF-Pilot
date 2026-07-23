// Scripted actions for automated smoke tests: `--smoke in.pdf out.png --action name[:arg]`.
// Each action drives the real UI paths the way a user would, then the harness screenshots.
import { state } from './state.js';
import { runSearch } from './search.js';
import { goToPage, setScale } from './viewer.js';
import { smokeEditText, smokeInsertImage, smokeWhiteout } from './edit-text.js';
import { undo, redo } from './document.js';
import { movePage, rotatePage, deletePage, insertBlankAfter, mergePdfs, splitPdf } from './pageops.js';
import {
  applyMarkupFromSelection, addStickyNote, commitFreehand, commitShape, commitTextboxAt,
} from './annotations.js';
import { getPageView } from './viewer.js';
import { flushFormValues } from './forms.js';
import { createFormField } from './formcreate.js';
import { smokePlaceSignature } from './esign.js';
import { compress } from './compress.js';
import { protect, removePassword, smokeRedactText } from './security.js';
import { exportImages } from './export-images.js';
import { printDocument } from './print.js';
import { runOcr } from './ocr.js';
import { beginSession, reimport } from './wordmode.js';
import { pdfToWord, wordToPdf, imagesToPdf } from './convert.js';
import { setSidebarWidth, filterTools } from './sidebar.js';
import { smokeEditScan } from './edit-scan.js';

const api = window.pdfpilot;

export async function runSmokeAction(action, params) {
  const sep = action.indexOf(':');
  const name = sep === -1 ? action : action.slice(0, sep);
  const arg = sep === -1 ? '' : action.slice(sep + 1);

  switch (name) {
    case 'search':
      document.getElementById('search-input').value = arg || 'marker';
      await runSearch(arg || 'marker', 1);
      break;
    case 'goto':
      goToPage(parseInt(arg, 10) || 1);
      break;
    case 'zoom':
      setScale(parseFloat(arg) || 1);
      break;
    case 'edittext':
      await smokeEditText(1, 'MARKER-P1-XYZ', 'EDITED-42-OK');
      await saveTo(arg);
      break;
    case 'edittext-undo':
      await smokeEditText(1, 'MARKER-P1-XYZ', 'EDITED-42-OK');
      await undo();
      await saveTo(arg);
      break;
    case 'insertimage':
      await smokeInsertImage(1, 300, 300);
      await saveTo(arg);
      break;
    case 'whiteout':
      // Covers the left half of the blue rectangle on page 1.
      await smokeWhiteout(1, 80, 320, 180, 420);
      await saveTo(arg);
      break;
    case 'pageops':
      // [P1..P5] -> blank after 1 -> rotate 3 (P2) -> move 6 (P5) up -> delete 4 (P3)
      await insertBlankAfter(1);
      await rotatePage(3);
      await movePage(6, -1);
      await deletePage(4);
      await saveTo(arg);
      break;
    case 'merge': {
      const [src, out] = arg.split('|');
      await mergePdfs([src]);
      await saveTo(out);
      break;
    }
    case 'split': {
      const [ranges, outDir] = arg.split('|');
      await splitPdf(ranges, outDir);
      break;
    }
    case 'annot-markup': {
      await selectSpanAndMark('quick brown fox', 'highlight');
      await selectSpanAndMark('searching, selecting', 'underline');
      await selectSpanAndMark('MARKER-P1', 'strikethrough');
      await saveTo(arg);
      break;
    }
    case 'annot-note':
      await addStickyNote(1, 420, 180, 'Smoke note text');
      await saveTo(arg);
      break;
    case 'annot-drawing': {
      const view = getPageView(1);
      await commitFreehand(1, view, [[100, 620], [140, 580], [180, 640], [220, 590], [260, 630]]);
      await commitShape('rect', 1, getPageView(1), 300, 560, 420, 640);
      await commitShape('ellipse', 1, getPageView(1), 440, 560, 560, 640);
      await commitShape('line', 1, getPageView(1), 580, 560, 660, 640);
      await commitTextboxAt(1, getPageView(1), 100, 680, 'TEXTBOX-99-SMOKE');
      await saveTo(arg);
      break;
    }
    case 'fillform': {
      const view = await waitForPageRender(1);
      const byName = (fieldName) => view.overlay.querySelector(`.form-field[data-name="${fieldName}"]`);
      const nameInput = byName('name');
      nameInput.value = 'Jane Tester';
      nameInput.dispatchEvent(new Event('input'));
      const agree = byName('agree');
      agree.checked = true;
      agree.dispatchEvent(new Event('change'));
      const colour = byName('colour');
      colour.value = 'Blue';
      colour.dispatchEvent(new Event('change'));
      const radios = view.overlay.querySelectorAll('.form-field[data-name="size"]');
      const l = Array.from(radios)[2];
      l.checked = true;
      l.dispatchEvent(new Event('change'));
      await flushFormValues();
      await saveTo(arg);
      break;
    }
    case 'createform': {
      const view = await waitForPageRender(1);
      await createFormField('text', 1, view, 100, 500, 320, 530, 'created_text');
      await createFormField('checkbox', 1, await waitForPageRender(1), 100, 550, 130, 580, 'created_check');
      await createFormField('dropdown', 1, await waitForPageRender(1), 100, 600, 260, 630, 'created_drop', ['A', 'B', 'C']);
      await createFormField('signature', 1, await waitForPageRender(1), 100, 650, 320, 700, 'created_sig');
      await saveTo(arg);
      break;
    }
    case 'esign':
      await smokePlaceSignature(1, 400, 600);
      await saveTo(arg);
      break;
    case 'compress-lossless':
      await compress('optimize');
      await saveTo(arg);
      break;
    case 'compress-lossy':
      await waitForPageRender(1);
      await compress('rasterize', 100, 0.6);
      await saveTo(arg);
      break;
    case 'protect': {
      const [pw, out] = arg.split('|');
      await protect(pw);
      await saveTo(out);
      break;
    }
    case 'removepw': {
      const [pw, out] = arg.split('|');
      await removePassword(pw);
      await saveTo(out);
      break;
    }
    case 'redact':
      await waitForPageRender(1);
      await smokeRedactText(1, 'MARKER-P1');
      await saveTo(arg);
      break;
    case 'exportimages': {
      await waitForPageRender(1);
      await exportImages('png', 96, [0, 1], arg);
      break;
    }
    case 'editscan':
      await waitForPageRender(1, { requireText: false });
      await smokeEditScan(1, 'Uniquemarkerforthispage', 'EDITED-SCAN-OK replaced line');
      await saveTo(arg);
      break;
    case 'make-scanned':
      // Produces an image-only PDF (no text layer) for OCR tests.
      await waitForPageRender(1);
      await compress('rasterize', 150, 0.9);
      await saveTo(arg);
      break;
    case 'ocr': {
      const [pagesArg, out] = arg.split('|');
      const pages = pagesArg.split(',').map((s) => parseInt(s, 10));
      await runOcr(pages);
      await saveTo(out);
      break;
    }
    case 'wordmode': {
      await waitForPageRender(1);
      const session = await beginSession('page', 2, { open: false });
      if (!session) throw new Error('wordmode: session did not start');
      await reimport();
      await saveTo(arg);
      break;
    }
    case 'pdf2word':
      await pdfToWord(arg);
      break;
    case 'word2pdf': {
      const [input, out] = arg.split('|');
      await wordToPdf(input);
      await saveTo(out);
      break;
    }
    case 'img2pdf': {
      const [img, out] = arg.split('|');
      await imagesToPdf([img]);
      await saveTo(out);
      break;
    }
    case 'sidebar': {
      // arg: "<width>,<query>" — resize the sidebar, filter tools, report counts.
      const [w, query] = arg.split(',');
      setSidebarWidth(parseInt(w, 10));
      document.getElementById('tool-search').value = query || '';
      filterTools(query || '');
      const buttons = document.querySelectorAll('#tool-sidebar button');
      const visible = Array.from(buttons).filter((b) => !b.classList.contains('hidden'));
      window.__sidebarSmoke = { total: buttons.length, visible: visible.length, labels: visible.map((b) => b.textContent) };
      console.log('[sidebar-smoke]', JSON.stringify(window.__sidebarSmoke));
      break;
    }
    case 'exporticon': {
      await waitForPageRender(1);
      await exportImages('png', 72, [0], arg);
      break;
    }
    case 'printprep': {
      await waitForPageRender(1);
      const result = await printDocument({ dryRun: true });
      if (!result?.ok || result.pages !== state.pageCount) {
        throw new Error(`printprep failed: ${JSON.stringify(result)}`);
      }
      break;
    }
    default:
      throw new Error(`unknown smoke action: ${name}`);
  }
}

async function saveTo(relPath) {
  if (relPath) await api.writeFile(relPath, state.bytes);
}

async function waitForPageRender(n, { timeoutMs = 10000, requireText = true } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const view = getPageView(n);
    // Image-only (scanned) pages have no text layer, so requireText:false
    // waits for just the canvas render.
    if (view?.rendered && (!requireText || view.textLayerDiv.childElementCount > 0)) return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitForPageRender: page ${n} not rendered in time`);
}

// Selects the first text-layer span containing `needle` and applies a markup.
async function selectSpanAndMark(needle, kind) {
  const view = await waitForPageRender(1);
  const spans = view.textLayerDiv.querySelectorAll('span');
  const span = Array.from(spans).find((s) => s.textContent.includes(needle));
  if (!span) throw new Error(`selectSpanAndMark: "${needle}" not found in text layer`);
  const range = document.createRange();
  range.selectNodeContents(span);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  await applyMarkupFromSelection(kind);
}
