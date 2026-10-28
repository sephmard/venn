import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, inSeason, orderTemplates, slug, templateIndex } from '../public/templates.js';
import { EXTRAS, prefill } from '../public/template-notes.js';
import { eggFor, react } from '../public/easter-eggs.js';

const byId = (id) => TEMPLATES[templateIndex(id)];
// The labels of the cards that show, in order, on a day (in the browser's own time zone).
const shown = (kind, y, m, d) =>
  orderTemplates(kind, new Date(y, m - 1, d))
    .filter(([, hidden]) => !hidden)
    .map(([i]) => TEMPLATES[i].label);

test('templates: the everyday ones keep their places, so links and edited polls still find them', () => {
  assert.deepEqual(
    TEMPLATES.slice(0, 13).map((t) => t.label),
    ['Dinner', 'Drinks', 'Coffee', 'Book club', 'Brunch', 'Game night', 'Hike', 'Party', 'Gym', 'Run', 'Bike', 'Golf', 'Trip'],
  );
  // Every template has its own emoji and its own name in links.
  assert.equal(new Set(TEMPLATES.map((t) => t.emoji)).size, TEMPLATES.length);
  assert.equal(new Set(TEMPLATES.map(slug)).size, TEMPLATES.length);
  // A handful of seasonal ones, each with something to fill in.
  const seasonal = TEMPLATES.filter((t) => t.season);
  assert.ok(seasonal.length >= 3 && seasonal.length <= 5);
  for (const t of seasonal) assert.ok(EXTRAS[t.id]?.note, t.id);
});

test('templates: links name them by id or by their label', () => {
  assert.equal(slug(TEMPLATES[3]), 'book-club');
  assert.equal(templateIndex('book-club'), 3);
  assert.equal(templateIndex('Friendsgiving'), TEMPLATES.indexOf(byId('friendsgiving')));
  assert.equal(templateIndex('nope'), -1);
  assert.equal(templateIndex(null), -1);
});

test('templates: seasons, including one that runs into the new year', () => {
  const fg = byId('friendsgiving');
  assert.equal(inSeason(fg, new Date(2026, 9, 14)), false);
  assert.equal(inSeason(fg, new Date(2026, 9, 15)), true);
  assert.equal(inSeason(fg, new Date(2026, 10, 30)), true);
  assert.equal(inSeason(fg, new Date(2026, 11, 1)), false);
  const ny = byId('new-year');
  assert.equal(inSeason(ny, new Date(2026, 11, 20)), true);
  assert.equal(inSeason(ny, new Date(2027, 0, 5)), true);
  assert.equal(inSeason(ny, new Date(2027, 0, 11)), false);
  assert.equal(inSeason(ny, new Date(2026, 6, 1)), false);
  assert.equal(inSeason(TEMPLATES[0], new Date(2026, 6, 1)), true);
  assert.equal(typeof inSeason(fg), 'boolean'); // today, by default
});

test('templates: what is in season comes first, Friendsgiving in November and the holiday ones in December', () => {
  // Summer: just the everyday ones, as they always were.
  assert.deepEqual(
    shown('pick', 2026, 7, 1),
    TEMPLATES.slice(0, 13).map((t) => t.label),
  );
  // Late October: Friendsgiving leads.
  assert.equal(shown('pick', 2026, 10, 26)[0], 'Friendsgiving');
  assert.equal(shown('pick', 2026, 10, 26)[1], 'Dinner');
  // November: Friendsgiving, then the holiday party and Secret Santa.
  assert.deepEqual(shown('pick', 2026, 11, 20).slice(0, 4), ['Friendsgiving', 'Holiday party', 'Secret Santa', 'Dinner']);
  // December: the holiday party, Secret Santa, then New Year's.
  assert.deepEqual(shown('pick', 2026, 12, 12).slice(0, 4), ['Holiday party', 'Secret Santa', 'New Year’s', 'Dinner']);
  // After Christmas, and into January: New Year's.
  assert.deepEqual(shown('pick', 2026, 12, 27).slice(0, 2), ['New Year’s', 'Dinner']);
  assert.deepEqual(shown('pick', 2027, 1, 4).slice(0, 2), ['New Year’s', 'Dinner']);
  // Asking when people are available suits trips: the trip follows what's in season.
  assert.deepEqual(shown('free', 2026, 7, 1).slice(0, 2), ['Trip', 'Dinner']);
  assert.deepEqual(shown('free', 2026, 11, 20).slice(0, 4), ['Friendsgiving', 'Holiday party', 'Secret Santa', 'Trip']);
});

test('templates: out of season ones are still on the page, hidden, at the end', () => {
  const order = orderTemplates('pick', new Date(2026, 6, 1));
  assert.equal(order.length, TEMPLATES.length);
  assert.deepEqual(new Set(order.map(([i]) => i)).size, TEMPLATES.length);
  const hidden = order.filter(([, h]) => h).map(([i]) => TEMPLATES[i].id);
  // Out of season, and the quiet ones that only a landing page's link chooses.
  const quiet = TEMPLATES.filter((t) => t.quiet).map((t) => t.id);
  assert.ok(quiet.length >= 6);
  assert.deepEqual(hidden.sort(), ['friendsgiving', 'holiday-party', 'new-year', 'secret-santa', ...quiet].sort());
  assert.ok(order.slice(-hidden.length).every(([, h]) => h));
  assert.equal(orderTemplates('pick').length, TEMPLATES.length); // today, by default
});

test('templates: choosing one fills in a name to suggest, where, and a note, but never over what someone wrote', () => {
  const fg = byId('friendsgiving');
  const santa = byId('secret-santa');
  const first = prefill(fg, '', '');
  assert.equal(first.title, "Friendsgiving at Ana's");
  assert.equal(first.where, 'Whose place? Add the address');
  assert.equal(first.desc, EXTRAS.friendsgiving.note);
  // Another seasonal one swaps its own note in for the last one's.
  assert.equal(prefill(santa, first.desc, first.desc).desc, EXTRAS['secret-santa'].note);
  // An everyday one takes the note back, and suggests its own name.
  const dinner = prefill(TEMPLATES[0], first.desc, first.desc);
  assert.deepEqual(dinner, { title: 'Dinner', where: 'A place, an address or a video link', desc: '' });
  // What someone typed stays.
  assert.equal(prefill(santa, 'Bring snacks', first.desc).desc, 'Bring snacks');
  assert.equal(prefill(fg, '  ', '').desc, EXTRAS.friendsgiving.note);
  // None chosen: the placeholders go back, and the note goes.
  assert.deepEqual(prefill(null, first.desc, first.desc), {
    title: undefined,
    where: 'A place, an address or a video link',
    desc: '',
  });
});

test('easter eggs: a few names get a little reaction from Finn', () => {
  const tue = new Date(2026, 9, 27);
  const fri = new Date(2026, 9, 30);
  assert.equal(eggFor('title', "Finn's birthday").id, 'finn');
  assert.equal(eggFor('title', 'FINNS BDAY!').id, 'finn');
  assert.equal(eggFor('title', 'Finn’s party').id, 'finn');
  assert.match(eggFor('title', 'Taco Tuesday', fri).text, /on a Friday\?/);
  assert.match(eggFor('title', 'taco tuesday', tue).text, /on a Tuesday\. Finn approves/);
  assert.match(eggFor('title', 'Office Secret Santa 2026').text, /^Shh/);
  assert.equal(eggFor('title', 'Meeting about meetings').id, 'meeting');
  assert.equal(eggFor('taps', TEMPLATES[0]).emoji, '🍝');
  assert.match(eggFor('taps', TEMPLATES[0]).text, /Dinner/);
  for (const plain of ['Dinner at Rosa’s', 'Finn', 'Tuesday tacos', 'meeting', ''])
    assert.equal(eggFor('title', plain), null, plain);
  assert.equal(eggFor('title', 'Taco Tuesday').id, 'taco'); // today, by default
});

test('easter eggs: each shows once, read out, without motion when the device asks for less', () => {
  const said = [];
  globalThis.matchMedia = () => ({ matches: false }); // prefers reduced motion
  try {
    assert.equal(
      react((m) => said.push(m), 'title', 'Dinner'),
      null,
    );
    assert.equal(react((m) => said.push(m), 'title', 'Meeting about meetings').id, 'meeting');
    assert.equal(
      react((m) => said.push(m), 'title', 'meeting about meetings'),
      null,
    ); // once is enough
    assert.deepEqual(said, [eggFor('title', 'Meeting about meetings').text]);
  } finally {
    delete globalThis.matchMedia;
  }
});

test('easter eggs: with motion, a burst of emoji that clears itself away', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const made = [];
  const el = (tag) => {
    const node = { tag, style: {}, children: [], attrs: {}, removed: false };
    node.setAttribute = (k, v) => (node.attrs[k] = v);
    node.append = (...c) => node.children.push(...c);
    node.remove = () => (node.removed = true);
    made.push(node);
    return node;
  };
  const body = el('body');
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.document = { createElement: el, body };
  try {
    const egg = react(() => {}, 'taps', TEMPLATES[13]);
    assert.equal(egg.emoji, '🦃');
    const [burst] = body.children;
    assert.equal(burst.attrs['aria-hidden'], 'true');
    assert.match(burst.innerHTML, /dog\.webp/);
    assert.equal(burst.children.length, 14);
    assert.ok(burst.children.every((c) => c.textContent === '🦃'));
    t.mock.timers.tick(2500);
    assert.equal(burst.removed, true);
  } finally {
    delete globalThis.matchMedia;
    delete globalThis.document;
  }
});

test('template pages: served at clean paths, in the sitemap, each with its own title and a link that opens its template', async () => {
  const { createApp } = await import('../server.js');
  const server = createApp();
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  try {
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    const titles = new Set();
    for (const path of ['/templates', '/templates/friendsgiving', '/templates/holiday-party', '/templates/secret-santa']) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type'), /text\/html/);
      const html = await res.text();
      assert.ok(sitemap.includes(`<loc>https://venn.day${path}</loc>`), `${path} in the sitemap`);
      assert.ok(html.includes(`<link rel="canonical" href="https://venn.day${path}" />`), path);
      assert.ok(html.includes(`<meta property="og:url" content="https://venn.day${path}" />`), path);
      assert.match(html, /<meta\s+name="description"\s+content="[^"]{50,170}"/, path);
      assert.equal(html.match(/<h1>/g)?.length, 1, path);
      const title = html.match(/<title>([^<]+)<\/title>/)[1];
      assert.ok(!titles.has(title), title);
      titles.add(title);
      // Every link into the app names a template the app knows, and opens a Venn.
      assert.doesNotMatch(html, /href="\/new\/(pick|free)/, path);
      for (const [, name] of html.matchAll(/href="\/new\?template=([\w-]+)(?:&amp;from=[\w-]+)?"/g))
        assert.ok(templateIndex(name) >= 0, name);
      if (path === '/templates') continue;
      const slug = path.split('/').pop();
      assert.ok(html.includes(`href="/new?template=${slug}&amp;from=${slug}"`), path);
      // The questions, for search engines, are the ones on the page.
      const faq = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
      assert.equal(faq['@type'], 'FAQPage');
      for (const q of faq.mainEntity) assert.ok(html.includes(`<summary>${q.name}</summary>`), q.name);
    }
    // The home page links to them (in its footer), and starts a Venn from a few plans.
    const home = await (await fetch(`${base}/`)).text();
    assert.ok(home.includes('href="/templates"'));
    for (const [, name] of home.matchAll(/href="\/new\?template=([\w-]+)"/g)) assert.ok(templateIndex(name) >= 0, name);
  } finally {
    server.close();
  }
});
