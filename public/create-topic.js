// /new/topic: a Venn about what, not when. The organizer lists the options (places, books, ideas)
// or asks one yes-or-no question; everyone says which ones they'd go with; the organizer picks one,
// then can find a date for it. Shares the create pages' parts (create.js).

import { LIMITS } from './core.js';
import {
  createBar,
  explainNotReady,
  fillCommon,
  loadSource,
  nameAndEmail,
  planFields,
  prefillTitle,
  setReady,
  showConfig,
  source,
  startForm,
  submit,
  tzLine,
  wirePlan,
  youFields,
} from './create.js';
import { $, $$, app, esc, getConfig, plural, track } from './ui.js';

const YES_NO = ['Yes', 'No'];

const row = (value = '', n = 1) => `
  <li class="topic-opt">
    <input type="text" maxlength="${LIMITS.title}" value="${esc(value)}" aria-label="Option ${n}" placeholder="${n === 1 ? "Rosa's" : n === 2 ? 'Luigi’s' : 'Another option'}" enterkeyhint="next">
    <button type="button" class="icon-btn" data-remove aria-label="Remove option ${n}">✕</button>
  </li>`;

export function renderTopic() {
  document.title = 'Create a Venn';
  const src = source();
  if (!src?.edit) track('view', { page: 'topic' });
  startForm();
  let kind = 'options'; // or 'yesno'

  app.innerHTML = `
    <form id="create" class="create topic-create" novalidate>
      <a class="back" href="/new" data-link>‹ Pick a date instead</a>
      <h1>Create a Venn</h1>
      <p class="lede create-lede">List the options. Everyone taps the ones they'd go with, and Venn finds the favourite.</p>
      ${planFields('topic')}
      <section class="sheet" aria-labelledby="opts-h">
        <h2 id="opts-h">What are the options?</h2>
        <div class="seg" role="radiogroup" aria-label="Guests answer">
          <button type="button" role="radio" data-kind="options" aria-checked="true">Options</button>
          <button type="button" role="radio" data-kind="yesno" aria-checked="false">Yes or no</button>
        </div>
        <div id="opts-box">
          <ol class="topic-opts" id="opts">${row('', 1)}${row('', 2)}</ol>
          <button type="button" class="pill" id="add-opt">+ Add option</button>
          <div class="topic-single"><label class="switch"><input type="checkbox" role="switch" id="single"> One pick each</label></div>
        </div>
        <ol class="topic-opts topic-yesno" id="yesno" hidden>${YES_NO.map((l) => `<li>${l}</li>`).join('')}</ol>
      </section>
      ${youFields()}
      ${tzLine()}
      ${createBar('Create Venn')}
    </form>`;
  // A question, not a name: "Where should we eat?"
  $('label[for="title"]').textContent = 'What are you deciding?';
  $('#title').placeholder = 'Where should we eat?';
  $('#deadline-box')?.remove(); // a deadline lives with date polls for now

  const occasion = wirePlan(() => {});
  const inputs = () => $$('#opts input');
  const labels = () =>
    kind === 'yesno'
      ? YES_NO
      : inputs()
          .map((i) => i.value.trim())
          .filter(Boolean);
  const dupe = () => {
    const seen = new Set();
    return labels().find((l) => seen.size === seen.add(l.toLowerCase()).size);
  };

  function renumber() {
    inputs().forEach((el, i) => {
      el.setAttribute('aria-label', `Option ${i + 1}`);
      el.nextElementSibling.setAttribute('aria-label', `Remove option ${i + 1}`);
      el.nextElementSibling.hidden = inputs().length < 2;
    });
    $('#add-opt').hidden = inputs().length >= LIMITS.topics;
    update();
  }
  function addRow(value = '', focus = true) {
    $('#opts').insertAdjacentHTML('beforeend', row(value, inputs().length + 1));
    renumber();
    if (focus) inputs().at(-1).focus();
  }
  $('#add-opt').onclick = () => addRow();
  $('#opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const li = b.closest('li');
    (li.nextElementSibling || li.previousElementSibling)?.querySelector('input').focus();
    li.remove();
    renumber();
  });
  // Enter goes to the next option, or adds one after the last.
  $('#opts').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
    e.preventDefault();
    const next = e.target.closest('li').nextElementSibling;
    if (next) next.querySelector('input').focus();
    else if (e.target.value.trim()) addRow();
  });
  $('#opts').addEventListener('input', update);
  // Places as options: the address search, when this server has it, on each option as it's focused.
  getConfig().then((c) => {
    if (!c.places) return;
    $('#opts')?.addEventListener('focusin', (e) => {
      const el = e.target;
      if (!el.matches('input') || el.dataset.places) return;
      el.dataset.places = '1';
      import('./place-search.js').then((m) => m.attach(el, c.places)).catch(() => {});
    });
  });

  function setKind(k) {
    kind = k;
    for (const b of $$('[data-kind]')) b.setAttribute('aria-checked', String(b.dataset.kind === k));
    $('#opts-box').hidden = k === 'yesno';
    $('#yesno').hidden = k !== 'yesno';
    update();
  }
  $('.seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (b) setKind(b.dataset.kind);
  });

  function update() {
    const n = labels().length;
    const twice = dupe();
    const few = kind === 'options' && n < 2;
    setReady(
      kind === 'yesno' ? 'A yes or no question' : `${plural(n, 'option')} to vote on`,
      [few, 'Add at least two options to create the poll', () => inputs().find((i) => !i.value.trim()), null, 'options'],
      [
        !!twice,
        `“${twice}” is in the list twice`,
        () => inputs().findLast((i) => i.value.trim() === twice),
        null,
        'a repeated option',
      ],
      ...nameAndEmail(),
    );
  }

  $('#create').onsubmit = (e) => {
    e.preventDefault();
    if (explainNotReady()) return;
    const body = { mode: 'topic', options: labels().map((label) => ({ label })) };
    if (kind === 'yesno' || $('#single').checked) body.single = true;
    submit(body, occasion);
  };

  /** Start from an existing topic poll: its options, and whether it's yes or no. */
  async function prefill() {
    const ev = await loadSource(src);
    if (!ev || ev.mode !== 'topic' || !$('#create')) return;
    fillCommon(ev, src);
    const words = ev.options.map((o) => o.label);
    if (ev.single && words.join() === YES_NO.join()) return setKind('yesno');
    $('#opts').innerHTML = words.map((w, i) => row(w, i + 1)).join('');
    $('#single').checked = !!ev.single;
    renumber();
  }

  renumber();
  showConfig(update);
  if (src) prefill();
  else prefillTitle();
  $('#title').focus();
  return () => {};
}
