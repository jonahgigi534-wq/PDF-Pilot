// Tool sidebar behaviour: drag-to-resize (width persisted) and a search box
// that filters tools by their label or description (title attribute).
const WIDTH_KEY = 'pdfpilot-sidebar-width';
const MIN_W = 72;
const MAX_W = 340;

export function initSidebar() {
  const sidebar = document.getElementById('tool-sidebar');
  const resizer = document.getElementById('sidebar-resizer');
  const search = document.getElementById('tool-search');

  // ----- resizable width -----
  const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10);
  if (!Number.isNaN(saved)) setSidebarWidth(saved);

  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('dragging');
    const startX = e.clientX;
    const startW = sidebar.getBoundingClientRect().width;

    const onMove = (ev) => setSidebarWidth(startW + (ev.clientX - startX));
    const onUp = () => {
      resizer.classList.remove('dragging');
      resizer.removeEventListener('pointermove', onMove);
      resizer.removeEventListener('pointerup', onUp);
      localStorage.setItem(WIDTH_KEY, String(Math.round(sidebar.getBoundingClientRect().width)));
    };
    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onUp);
  });

  // ----- tool search -----
  search.addEventListener('input', () => filterTools(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      search.value = '';
      filterTools('');
      search.blur();
    }
    e.stopPropagation();
  });
}

export function setSidebarWidth(px) {
  const sidebar = document.getElementById('tool-sidebar');
  sidebar.style.width = `${Math.min(MAX_W, Math.max(MIN_W, px))}px`;
}

// Shows only tools whose label or description matches; group labels stay
// visible while any of their tools match, and non-button controls (like the
// annotation colour picker) follow their group.
export function filterTools(query) {
  const sidebar = document.getElementById('tool-sidebar');
  const q = query.trim().toLowerCase();
  const children = Array.from(sidebar.children);

  let currentLabel = null;
  let groupHasMatch = true; // tools before the first label are always their own group
  let groupFollowers = [];
  let anyMatch = false;

  const closeGroup = () => {
    if (currentLabel) currentLabel.classList.toggle('hidden', !groupHasMatch);
    for (const el of groupFollowers) el.classList.toggle('hidden', !groupHasMatch);
  };

  for (const el of children) {
    if (el.id === 'tool-search' || el.id === 'tool-search-empty') continue;
    if (el.classList.contains('tool-group-label')) {
      closeGroup();
      currentLabel = el;
      groupHasMatch = false;
      groupFollowers = [];
      continue;
    }
    if (el.tagName === 'BUTTON') {
      const text = `${el.textContent} ${el.title}`.toLowerCase();
      const match = !q || text.includes(q);
      el.classList.toggle('hidden', !match);
      if (match) {
        groupHasMatch = true;
        anyMatch = true;
      }
    } else {
      // selects etc. show whenever their group has a visible tool
      groupFollowers.push(el);
    }
  }
  closeGroup();

  document.getElementById('tool-search-empty').classList.toggle('hidden', !q || anyMatch);
}
