// Scripted actions for automated smoke tests: `--smoke in.pdf out.png --action name[:arg]`.
// Each action drives the real UI the way a user would, then the harness screenshots.
import { state } from './state.js';
import { runSearch } from './search.js';
import { goToPage, setScale } from './viewer.js';

export async function runSmokeAction(action, params) {
  const [name, arg] = action.split(':');
  switch (name) {
    case 'search': {
      document.getElementById('search-input').value = arg || 'marker';
      await runSearch(arg || 'marker', 1);
      break;
    }
    case 'goto': {
      goToPage(parseInt(arg, 10) || 1);
      break;
    }
    case 'zoom': {
      setScale(parseFloat(arg) || 1);
      break;
    }
    default:
      throw new Error(`unknown smoke action: ${name}`);
  }
}
