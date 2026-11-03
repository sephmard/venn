// An Anthropic API key of your own, for AI past this week's free requests (or on servers where
// people always bring one). It's kept in this browser only and sent with each AI request; Venn's
// server uses it for that request and never stores it. Loaded only when AI needs it.

import { $, esc, toast } from './ui.js';

const CONSOLE = 'https://platform.claude.com/settings/keys';
const AI_KEY = 'venn:anthropic-key';

/** The key this browser keeps, or ''. */
export function ownAiKey() {
  try {
    return localStorage.getItem(AI_KEY) || '';
  } catch {
    return '';
  }
}

/** Headers for an AI request: the key, if there is one. */
export const aiHeaders = (headers = {}) => (ownAiKey() ? { ...headers, 'x-anthropic-key': ownAiKey() } : headers);

// Its look, here rather than in the page's stylesheet, since most pages never need it.
document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
  .ai-key { margin-top: 10px; }
  .ai-key p:first-child { margin: 0 0 8px; }
  .ai-row { display: flex; gap: 8px; align-items: flex-start; }
  .ai-row > :first-child { flex: 1; min-width: 0; }
  .ai-open { margin: -6px 0 4px; }
  .ai-inline { margin: 0 0 14px; padding: 12px 14px; border-radius: var(--radius); background: var(--accent-soft); }
  .ai-inline > label { display: block; margin-bottom: 6px; font-weight: 600; }
  .ai-inline .hint { margin: 6px 0 0; }
  @media (max-width: 520px) { .ai-row { flex-direction: column; align-items: stretch; } }
  </style>`,
);

/** The form to add, change or remove your key, put inside `box`. `done()` runs once it's saved. */
export function keyForm(box, { why = '', done, byHand } = {}) {
  const has = !!ownAiKey();
  box.hidden = false;
  box.innerHTML = `<div class="ai-key">
      ${why ? `<p>${esc(why)}</p>` : ''}
      ${why && byHand ? '<p class="ai-by-hand">No key? <button type="button" class="link-btn" id="ai-by-hand">Fill it in yourself</button>. It only takes a minute.</p>' : ''}
      <label for="ai-key-in">Your Anthropic API key</label>
      <div class="ai-row">
        <input id="ai-key-in" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${has ? 'Saved on this device' : 'sk-ant-…'}">
        <button type="button" class="btn" id="ai-key-save">Save key</button>
      </div>
      <p class="hint">Kept on this device only, and sent with your AI requests. Venn never stores it. Get a key from the <a href="${CONSOLE}" target="_blank" rel="noopener">Claude Console</a>.${has ? ' <button type="button" class="link-btn" id="ai-key-rm">Remove key</button>' : ''}</p>
    </div>`;
  $('#ai-key-save', box).onclick = () => {
    const key = $('#ai-key-in', box).value.trim();
    if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(key)) {
      toast("That doesn't look like an Anthropic API key. They start with sk-ant-.");
      return $('#ai-key-in', box).focus();
    }
    try {
      localStorage.setItem(AI_KEY, key);
    } catch {
      return toast("This browser won't keep the key. Try another browser.");
    }
    box.hidden = true;
    toast('Key saved on this device.');
    done?.();
  };
  const rm = $('#ai-key-rm', box);
  if (rm)
    rm.onclick = () => {
      try {
        localStorage.removeItem(AI_KEY);
      } catch {
        // nothing kept
      }
      box.hidden = true;
      toast('Key removed from this device.');
    };
  // AI is a shortcut, never a wall: the page that offers it says where to go instead.
  const btn = $('#ai-by-hand', box);
  if (btn) btn.onclick = byHand;
  $('#ai-key-in', box).focus();
}

/** "Use your own key": a small button for an AI panel's hint, wired with `wireKeyLink`. */
export const keyLink = () =>
  `<button type="button" class="link-btn" data-ai-key>${ownAiKey() ? 'Your key' : 'Use your own key'}</button>`;

/** Wire the panel's "Use your own key" button to open the form in `box`. */
export function wireKeyLink(panel, box) {
  const b = panel.querySelector('[data-ai-key]');
  if (b) b.onclick = () => (box.hidden || !box.firstChild ? keyForm(box) : (box.hidden = true));
}

/**
 * What an AI request that failed should show: the key form when the free requests are used up
 * (or the key that was used didn't work), otherwise the error. `byHand`, when given, is offered as
 * "Fill it in yourself" for people with no key.
 */
export function aiFailed(ex, box, retry, byHand) {
  if ((ex.status === 402 || (ex.status === 400 && /key/i.test(ex.message))) && box)
    return keyForm(box, { why: ex.message, done: retry, byHand });
  toast(ex.message);
}
