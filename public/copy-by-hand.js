// The link to copy by hand, where the clipboard says no (ui.js copy). Loaded only then, so the
// poll page doesn't carry it.
import { app, esc } from './ui.js';

/**
 * Where the clipboard says no (an in-app browser, a denied permission): `text` in a selected,
 * read-only box under `at`'s row (or at the end of the page), to copy by hand. Never a browser dialog.
 */
export function copyByHand(text, at, label = 'Copy this link:') {
  document.getElementById('copy-by-hand')?.remove();
  const p = Object.assign(document.createElement('p'), { className: 'copy-by-hand', id: 'copy-by-hand' });
  p.innerHTML = `<label>${esc(label)}<input readonly autocomplete="off"></label>`;
  const input = p.querySelector('input');
  input.value = text;
  // Under the button's row, not inside it (a flex row would squeeze it).
  const row = at?.parentElement;
  if (!at || at === document.body) app.append(p);
  else (row && row !== app && !/^(FORM|SECTION|MAIN|DETAILS|BODY|DIALOG)$/.test(row.tagName) ? row : at).after(p);
  input.focus();
  input.setSelectionRange(0, 9999);
}
