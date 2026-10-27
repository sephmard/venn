// Address search in the create pages' "Where" field: suggestions of real places and addresses as
// people type, from GET /api/places (src/places.js). Loaded the first time "Where" is focused, and
// only when the server has it switched on. Picking one fills the field in; anything typed that
// doesn't match is kept as it is, and video links are never searched.
//
// An ARIA combobox: the field is role=combobox, the suggestions a listbox under it. ↑ and ↓ move
// through them, Enter picks, Escape closes; a tap picks too.

import { esc } from './ui.js';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 300;
// Each provider's own attribution, which its terms require next to the suggestions.
const CREDIT = {
  photon: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>',
  google: '<span translate="no">Google Maps</span>',
};

const CSS = `
.ps-host{position:relative}
.ps-pop{position:absolute;left:0;right:0;z-index:30;margin:0;padding:4px;background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 8px 24px -8px rgb(0 0 0 / .3);overflow:hidden}
.ps-pop[hidden]{display:none}
.ps-list{list-style:none;margin:0;padding:0}
.ps-opt{display:flex;flex-direction:column;justify-content:center;min-height:44px;padding:6px 10px;border-radius:10px;cursor:pointer;line-height:1.3;overflow-wrap:anywhere}
.ps-opt strong{font-weight:600}
.ps-opt span{color:var(--muted);font-size:.875rem}
@media (hover:hover){.ps-opt:hover{background:var(--surface-2)}}
.ps-opt[aria-selected=true]{background:var(--accent-soft)}
.ps-none{margin:0;padding:10px 10px 2px;color:var(--muted);font-size:.875rem}
.ps-credit{margin:0;padding:4px 10px 2px;text-align:right;color:var(--muted);font-size:.75rem}
.ps-credit a{color:inherit}
`;

/** Text that is a link (https://…, www.…, zoom.us/j/…), or has no letters: not something to search for. */
export const notAPlace = (text) => /^(https?:|www\.)|:\/\/|^[\w-]+(\.[\w-]+)+\/|^[^\p{L}]*$/iu.test(text.trim());

/** Turn "Where" (`input`) into a place search, with `provider` ('photon' or 'google') for the credit line. */
export function attach(input, provider) {
  if (input.getAttribute('role') === 'combobox') return;
  if (!document.getElementById('ps-css'))
    document.head.append(Object.assign(document.createElement('style'), { id: 'ps-css', textContent: CSS }));
  const host = input.parentElement;
  host.classList.add('ps-host');
  const pop = Object.assign(document.createElement('div'), { className: 'ps-pop', hidden: true });
  pop.innerHTML = `<ul class="ps-list" role="listbox" id="ps-list" aria-label="Suggested places"></ul><p class="ps-none" hidden>No matches. We'll use what you typed.</p><p class="ps-credit">${CREDIT[provider] || ''}</p>`;
  const status = Object.assign(document.createElement('p'), { className: 'sr-only', role: 'status' });
  status.setAttribute('aria-live', 'polite');
  input.after(pop, status);
  const list = pop.querySelector('ul');
  const none = pop.querySelector('.ps-none');
  for (const [k, v] of Object.entries({
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': 'ps-list',
    autocomplete: 'off',
  }))
    input.setAttribute(k, v);

  let places = [];
  let active = -1;
  let timer;
  let seq = 0;
  let session = '';
  const cache = new Map();

  function close() {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function show(found, q) {
    places = found;
    active = -1;
    list.innerHTML = found
      .map(
        (p, i) =>
          `<li class="ps-opt" role="option" id="ps-opt-${i}" data-i="${i}" aria-selected="false"><strong>${esc(p.name)}</strong>${p.detail ? `<span>${esc(p.detail)}</span>` : ''}</li>`,
      )
      .join('');
    none.hidden = !!found.length;
    pop.style.top = `${input.offsetTop + input.offsetHeight + 4}px`;
    pop.hidden = false;
    input.setAttribute('aria-expanded', String(!!found.length));
    input.removeAttribute('aria-activedescendant');
    status.textContent = found.length
      ? `${found.length} suggested ${found.length === 1 ? 'place' : 'places'}. Use the up and down arrows to choose one.`
      : `No matches for ${q}. We'll use what you typed.`;
    // On a phone, keep the suggestions above the keyboard where there's room.
    if (pop.getBoundingClientRect().bottom > (visualViewport?.height ?? innerHeight)) pop.scrollIntoView({ block: 'nearest' });
  }

  function highlight(i) {
    active = i;
    for (const [j, li] of [...list.children].entries()) li.setAttribute('aria-selected', String(j === i));
    if (i < 0) input.removeAttribute('aria-activedescendant');
    else {
      input.setAttribute('aria-activedescendant', `ps-opt-${i}`);
      list.children[i].scrollIntoView({ block: 'nearest' });
    }
  }

  function pick(i) {
    const p = places[i];
    if (!p) return;
    input.value = p.label;
    session = ''; // a pick ends the typing session (Google bills by them)
    seq++;
    close();
    status.textContent = `${p.label} chosen.`;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function search() {
    const q = input.value.trim();
    const id = ++seq;
    if (q.length < MIN_CHARS || notAPlace(q)) return close();
    const lang = (navigator.language || '').slice(0, 2);
    const key = `${lang}|${q.toLowerCase()}`;
    let found = cache.get(key);
    if (!found) {
      if (provider === 'google') session ||= crypto.randomUUID();
      const params = new URLSearchParams({ q, lang, ...(session && { session }) });
      try {
        const res = await fetch(`/api/places?${params}`);
        if (!res.ok) throw new Error(String(res.status));
        found = (await res.json()).places || [];
        cache.set(key, found);
      } catch {
        // No suggestions this time; what they typed is still there, so say nothing.
        if (id === seq) close();
        return;
      }
    }
    // Only the latest search counts, and only while they're still in the field.
    if (id === seq && document.activeElement === input) show(found, q);
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    seq++;
    if (input.value.trim().length < MIN_CHARS || notAPlace(input.value)) return close();
    timer = setTimeout(search, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (pop.hidden) {
      if (e.key === 'ArrowDown' && input.value.trim().length >= MIN_CHARS) {
        e.preventDefault();
        search();
      }
      return;
    }
    const n = places.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      highlight((active + 1) % n);
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      highlight(active <= 0 ? n - 1 : active - 1);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', () => {
    clearTimeout(timer);
    seq++;
    close();
  });
  // Taps on the suggestions (and the credit's link) keep the field focused, so blur doesn't close them first.
  pop.addEventListener('mousedown', (e) => e.preventDefault());
  pop.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) pick(+li.dataset.i);
  });
  // What they'd typed before this loaded.
  if (document.activeElement === input && input.value.trim().length >= MIN_CHARS) input.dispatchEvent(new Event('input'));
}
