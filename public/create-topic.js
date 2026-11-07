// /new/topic: a Venn about what, not when. The organizer lists the options (places, books, ideas)
// or asks one yes-or-no question; everyone says which ones they'd go with; the organizer picks one,
// then can find a date for it. Shares the create pages' parts (create.js).

import { LIMITS } from './core.js';
import {
  createBar,
  draftChanged,
  explainNotReady,
  keepDraft,
  fillCommon,
  formReady,
  kindSwitch,
  focusStart,
  loadSource,
  nameAndEmail,
  planEmoji,
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
import { TOPIC_TEMPLATES, topicTemplate } from './topic-templates.js';
import { $, $$, app, esc, getConfig, plural, track } from './ui.js';

const YES_NO = ['Yes', 'No'];
// What the question box suggests: something to choose between, or something to say yes or no to.
const ASK = { options: 'Where should we eat?', yesno: 'Should we do a book swap?' };

// An option's hint: a starter's, or these.
const hintFor = (n, hint = '') => hint || (n === 1 ? "Rosa's" : n === 2 ? 'Luigi’s' : 'Another option');
const row = (value = '', n = 1, hint = '') => `
  <li class="topic-opt">
    <input type="text" maxlength="${LIMITS.title}" value="${esc(value)}" aria-label="Option ${n}" placeholder="${esc(hintFor(n, hint))}" enterkeyhint="next">
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
      <a class="back" href="/" hidden>‹ Back</a>
      <h1>Create a Venn</h1>
      ${src ? '' : kindSwitch('topic')}
      ${planFields('topic')}
      <section class="sheet" aria-labelledby="opts-h" id="opts-sheet">
        <h2 id="opts-h">What are the options?</h2>
        <ol class="topic-opts" id="opts">${row('', 1)}${row('', 2)}</ol>
        <button type="button" class="pill" id="add-opt">+ Add option</button>
        <div class="topic-single"><label class="switch"><input type="checkbox" role="switch" id="single"> One pick each</label></div>
      </section>
      ${youFields()}
      ${tzLine()}
      ${createBar('Create a Venn')}
    </form>`;
  // A question, not a name: it comes first, typed in full. In place of the date templates, starters
  // for a vote (topic-templates.js), the same pills.
  $('#plan-h').textContent = 'What are you deciding?';
  $('.occasions').setAttribute('aria-label', 'Starters');
  $('.occasions').innerHTML = TOPIC_TEMPLATES.map(
    (t) =>
      `<button type="button" class="pill tpl" data-starter="${t.id}" aria-pressed="false"><span class="tpl-emoji" aria-hidden="true">${t.emoji}</span>${esc(t.label)}</button>`,
  ).join('');
  $('#emoji-tile').textContent = '🗳️';
  Object.assign($('#title'), { value: '', placeholder: ASK.options });
  $('#title').dataset.seed = '';
  $('label[for="title"]').textContent = 'Your question';
  // Options to choose between, or one yes-or-no question: asked before the question is typed.
  $('.title-row').insertAdjacentHTML(
    'beforebegin',
    `<div class="seg topic-kind" role="radiogroup" aria-label="Kind of question">
       <button type="button" role="radio" data-kind="options" aria-checked="true">Pick from options</button>
       <button type="button" role="radio" data-kind="yesno" aria-checked="false">Yes or no</button>
     </div>`,
  );
  // Yes or no: the answers are fixed, shown as what guests will tap, not as boxes to fill in.
  $('.title-row').insertAdjacentHTML(
    'afterend',
    `<p class="topic-yesno" id="yesno" hidden><span class="muted">Everyone answers</span>${YES_NO.map((l) => `<span class="yn-chip yn-${l.toLowerCase()}">${l}</span>`).join('')}</p>`,
  );

  wirePlan(() => {});
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
    $('#opts').insertAdjacentHTML('beforeend', row(value, inputs().length + 1, current?.hint));
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
  $('#title').addEventListener('input', update);
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
    $('#opts-sheet').hidden = k === 'yesno';
    $('#yesno').hidden = k !== 'yesno';
    $('#title').placeholder = ASK[k];
    update();
  }
  $('.topic-kind').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    setKind(b.dataset.kind);
    // A starter for the other kind of question no longer fits.
    if (current && !!current.yesNo !== (b.dataset.kind === 'yesno')) mark(null);
  });

  // ---------- starters (topic-templates.js): they fill what's empty, never what was typed ----------
  let current = null; // the starter pressed
  /** Show `t` (or none) as pressed, with its hints and emoji, filling nothing in. */
  function mark(t) {
    current = t;
    for (const b of $$('[data-starter]')) b.setAttribute('aria-pressed', String(b.dataset.starter === t?.id));
    inputs().forEach((el, i) => (el.placeholder = hintFor(i + 1, t?.hint)));
    $('#title').placeholder = t?.ask || ASK[kind];
    planEmoji(t?.emoji || '🗳️');
    update();
  }
  /** Press a starter: its question if the box is empty (or holds another starter's), its kind, three rows. */
  function press(t) {
    const title = $('#title');
    const asked = current?.question;
    if (!title.value.trim() || title.value === asked) title.value = t.question;
    setKind(t.yesNo ? 'yesno' : 'options');
    if (!t.yesNo) {
      while (inputs().length < 3) addRow('', false);
      while (inputs().length > 3 && !inputs().at(-1).value.trim()) inputs().at(-1).closest('li').remove();
      renumber();
    }
    mark(t);
    if (t.yesNo) title.focus();
  }
  $('.occasions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-starter]');
    if (!b) return;
    const t = topicTemplate(b.dataset.starter);
    if (current?.id === t.id) mark(null);
    else press(t);
  });

  function update() {
    draftChanged();
    const n = labels().length;
    const twice = dupe();
    const few = kind === 'options' && n < 2;
    setReady(
      kind === 'yesno' ? 'A yes or no question' : `${plural(n, 'option')} to vote on`,
      [!$('#title').value.trim(), 'Add your question', '#title', null, 'your question'],
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
    submit(body, () => current);
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
    // The next one of a decided vote: last time's pick left out, unless they tick it back in.
    const at = ev.options.findIndex((o) => o.id === ev.picked);
    if (new URLSearchParams(location.search).has('next') && at >= 0) {
      const li = $$('#opts > li')[at];
      $('#opts').insertAdjacentHTML(
        'beforebegin',
        `<label class="leave-out"><input type="checkbox" id="leave-out" checked> <span>Leave out ${esc(words[at])} <span class="muted">(last time's pick)</span></span></label>`,
      );
      $('#leave-out').onchange = ({ target: { checked } }) => {
        if (checked) li.remove();
        else $('#opts').insertBefore(li, $$('#opts > li')[at] || null);
        renumber();
      };
      li.remove();
    }
    renumber();
  }

  renumber();
  showConfig(update);
  if (src) prefill();
  else {
    // ?template=next-book: that starter, pressed once the form (and any draft of it) is in place.
    const linked = topicTemplate(new URLSearchParams(location.search).get('template'));
    prefillTitle();
    if (linked) {
      const left = new URLSearchParams(location.search);
      left.delete('template');
      history.replaceState(null, '', location.pathname + (left.size ? `?${left}` : ''));
    }
    // A half-made vote comes back after a reload or Back (create.js), with its starter.
    keepDraft(
      'topic',
      () => ({ kind, options: inputs().map((i) => i.value), single: $('#single').checked, starter: current?.id || '' }),
      (d) => {
        if (d.options.length) {
          $('#opts').innerHTML = d.options.map((w, i) => row(w, i + 1)).join('');
          renumber();
        }
        $('#single').checked = d.single;
        setKind(d.kind);
        mark(topicTemplate(d.starter));
      },
    ).then(() => linked && $('#create') && press(linked));
  }
  // The Use AI box under Date · Vote (ai-draft.js) writes the question and the options; without AI
  // there's no box here, but a vote the box on /new made still lands.
  if (!src)
    getConfig().then((c) =>
      import('./ai-draft.js').then((m) =>
        m.aiTopic(
          ({ question, yesNo, options, note }) => {
            mark(null); // what AI wrote isn't a starter's
            $('#title').value = question;
            // A time that's already set ("pizza or tacos on Friday?") goes in the note, not the question.
            if (note && !$('#desc').value.trim()) $('#more-box').open = !!($('#desc').value = note);
            if (yesNo) return setKind('yesno');
            setKind('options');
            // Two rows at least: a question with its choices still to come ("vote on our next book").
            const rows = [...options, '', ''].slice(0, Math.max(2, options.length));
            $('#opts').innerHTML = rows.map((w, i) => row(w, i + 1)).join('');
            renumber();
          },
          // For Undo: the form as it was, put back exactly.
          () => {
            const [title, was, values] = [$('#title').value, kind, $$('#opts input').map((i) => i.value)];
            const [desc, open] = [$('#desc').value, $('#more-box').open];
            return () => {
              $('#title').value = title;
              $('#opts').innerHTML = values.map((w, i) => row(w, i + 1)).join('');
              renumber();
              setKind(was);
              $('#desc').value = desc;
              $('#more-box').open = open;
            };
          },
          { ai: !!c.ai, jev: !!c.jev, ready: formReady() },
        ),
      ),
    );
  focusStart();
  return () => {};
}
