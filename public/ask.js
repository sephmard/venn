// "Are you sure?" in the page, never with the browser's confirm(): it looks like another product,
// can't take the retro or classic look, and some in-app browsers block it.
import { esc } from './ui.js';

/**
 * Ask one yes-or-no question in a small dialog (a sheet at the bottom on phones).
 * Resolves true for yes; Cancel, Escape and a tap outside the box resolve false.
 * { title, text?, yes, no = 'Cancel', danger = false }: danger makes yes the pink "unavailable" button.
 */
export function ask({ title, text = '', yes, no = 'Cancel', danger = false }) {
  const d = document.createElement('dialog');
  d.className = 'submit-check ask';
  d.setAttribute('aria-labelledby', 'ask-h');
  if (text) d.setAttribute('aria-describedby', 'ask-p');
  d.innerHTML = `<h2 id="ask-h">${esc(title)}</h2>
    ${text ? `<p id="ask-p">${esc(text)}</p>` : ''}
    <div class="sc-actions">
      <button type="button" class="btn" data-ask="no">${esc(no)}</button>
      <button type="button" class="btn ${danger ? 'btn-no' : 'btn-primary'}" data-ask="yes">${esc(yes)}</button>
    </div>`;
  const back = document.activeElement;
  document.body.append(d);
  return new Promise((done) => {
    let closed = false;
    const close = (answer) => {
      if (closed) return;
      closed = true;
      d.close();
      d.remove();
      if (back?.isConnected) back.focus();
      done(answer);
    };
    d.onclick = (e) => {
      const b = e.target.closest('[data-ask]');
      if (b) close(b.dataset.ask === 'yes');
      else if (e.target === d) close(false); // a tap outside the box
    };
    d.oncancel = (e) => {
      e.preventDefault();
      close(false);
    };
    // Escape closes it here too, not only through the browser's cancel, which some browsers skip
    // (Chrome's close-request rules, on phones).
    d.onkeydown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(false);
    };
    d.showModal(); // modal: focus stays inside until it closes
    // A destructive yes isn't the default: focus starts on the way out.
    d.querySelector(`[data-ask="${danger ? 'no' : 'yes'}"]`).focus();
  });
}
