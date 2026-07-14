// Scripted actions for automated smoke tests: `--smoke in.pdf out.png --action name[:arg]`.
// Each action drives the real UI paths the way a user would, then the harness screenshots.
import { state } from './state.js';
import { runSearch } from './search.js';
import { goToPage, setScale } from './viewer.js';
import { smokeEditText, smokeInsertImage, smokeWhiteout } from './edit-text.js';
import { undo, redo } from './document.js';

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
    default:
      throw new Error(`unknown smoke action: ${name}`);
  }
}

async function saveTo(relPath) {
  if (relPath) await api.writeFile(relPath, state.bytes);
}
