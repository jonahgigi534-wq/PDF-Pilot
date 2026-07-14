// Shared per-page text index (text items + joined string), cached until the
// document changes. Used by search, inline editing, and annotations.
import { pdfjsLib, getPageView, onDocChanged } from './viewer.js';

let cache = new Map();

onDocChanged(() => {
  cache = new Map();
});

export async function getPageIndex(n) {
  if (cache.has(n)) return cache.get(n);
  const view = getPageView(n);
  const content = await view.page.getTextContent();
  const items = content.items.filter((it) => 'str' in it);
  let joined = '';
  const offsets = [];
  for (const it of items) {
    offsets.push(joined.length);
    joined += it.str;
    if (it.hasEOL) joined += ' ';
  }
  const entry = { items, styles: content.styles, joined, lower: joined.toLowerCase(), offsets };
  cache.set(n, entry);
  return entry;
}

// CSS-space rect of a text item in the page's current viewport.
export function itemCssRect(view, item) {
  const t = pdfjsLib.Util.transform(view.viewport.transform, item.transform);
  const fontHeight = Math.hypot(t[2], t[3]);
  return {
    left: t[4],
    top: t[5] - fontHeight,
    width: item.width * view.viewport.scale,
    height: fontHeight * 1.2,
    fontHeight,
  };
}
