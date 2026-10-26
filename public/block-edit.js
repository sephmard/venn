// Changing blocks on the time grid (picker.js): drag an edge to make a block longer or shorter
// (mouse or touch), or drag the block itself to another time or day (mouse). Only organizers do
// this, so it lives here and the poll page doesn't download it.

import { $, shortRange } from './ui.js';

const STEP = 30;

/** Pass as `editBlocks` to timeView; picker.js calls it with the grid's root and helpers. */
export function editBlocks(root, { blocks, range, minuteAt, rowPx, onResize, onMove }) {
  let edit = null;
  let suppressClick = false;
  const colAt = (x, y) => document.elementFromPoint(x, y)?.closest('.tg-col');
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.tg-block[data-key]');
    if (!el || e.button > 0) return;
    const b = blocks().find((x) => x.key === el.dataset.key);
    const edge = e.target.closest('[data-edge]')?.dataset.edge;
    if (!b || !(edge ? onResize : onMove && e.pointerType === 'mouse')) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture?.(e.pointerId);
    edit = { el, b, edge, y: e.clientY, from: b.from, to: b.to, date: b.date, moved: false };
  });
  root.addEventListener('pointermove', (e) => {
    if (!edit) return;
    const [from, to] = range();
    const col = colAt(e.clientX, e.clientY) || edit.el.closest('.tg-col');
    if (edit.edge) {
      const m = minuteAt(edit.el.closest('.tg-col'), e.clientY);
      if (edit.edge === 'top') edit.from = Math.min(m, edit.b.to - STEP);
      else edit.to = Math.max(m + STEP, edit.b.from + STEP);
    } else {
      const shift = Math.round((e.clientY - edit.y) / rowPx(root)) * STEP;
      const len = edit.b.to - edit.b.from;
      edit.from = Math.max(from, Math.min(to - len, edit.b.from + shift));
      edit.to = edit.from + len;
      if (col?.dataset.date && col.dataset.date !== edit.date) {
        edit.date = col.dataset.date;
        col.append(edit.el);
      }
    }
    edit.moved ||= edit.from !== edit.b.from || edit.to !== edit.b.to || edit.date !== edit.b.date;
    edit.el.style.top = `calc(${(edit.from - from) / STEP} * var(--row))`;
    edit.el.style.height = `calc(${(edit.to - edit.from) / STEP} * var(--row))`;
    const text = $('span', edit.el);
    if (text) text.textContent = shortRange(edit.from, edit.to);
  });
  const finishEdit = () => {
    if (!edit) return;
    const { b, edge, moved, date, from, to } = edit;
    edit = null;
    if (!moved) return;
    suppressClick = true; // the click that follows the drag isn't a tap
    if (edge) onResize(b.key, from, to);
    else onMove(b.key, date, from, to);
  };
  window.addEventListener('pointerup', finishEdit);
  const handle = (edge) => (onResize ? `<i class="tg-handle tg-${edge}" data-edge="${edge}" aria-hidden="true"></i>` : '');
  return {
    /** Markup for the edges of each block, which picker.js puts in. */
    top: handle('top'),
    bottom: handle('bottom'),
    active: () => Boolean(edit),
    /** True once after a drag, so the click that follows it isn't taken as a tap. */
    takeClick() {
      const was = suppressClick;
      suppressClick = false;
      return was;
    },
    cleanup: () => window.removeEventListener('pointerup', finishEdit),
  };
}
