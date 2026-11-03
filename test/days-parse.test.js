// "Use AI" without AI (src/days-parse.js): plain words read into the same draft AI's answer becomes,
// only where AI can't answer, and only what the words say plainly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { draftFromWords, parseDays } from '../src/days-parse.js';
import { DAYS_SCHEMA } from '../src/days-draft.js';

const MON = '2026-11-02'; // Monday
const SUN = '2026-11-08';
const draft = (text, today = MON, nowMinutes = 600) => draftFromWords(text, { today, nowMinutes });
/** The draft as [date, part] pairs ('all' for whole days). */
const pairs = (d) => d.days.map((x) => [x.date, x.part ?? 'all']);
const dates = (d) => [...new Set(d.days.map((x) => x.date))];

test('the brief’s seven prompts: the date ones get a draft, the others are left to AI or the form', () => {
  // Votes, or a choice of what with no days: nothing to read here.
  assert.equal(draft('Choose between Italian, Thai, and Mexican for dinner.'), null);
  assert.equal(draft('Vote on our next book.'), null);
  assert.equal(draft('Let’s decide where and when to have dinner.'), null);
  assert.equal(draft('Create a branded team lunch poll.'), null); // no days said

  const meeting = draft('Find a 30-minute meeting next Tuesday afternoon.');
  assert.equal(meeting.level, 'parts');
  assert.deepEqual(pairs(meeting), [['2026-11-10', 'afternoon']]);
  assert.match(meeting.note, /next Tuesday as the one next week/);
  assert.match(meeting.note, /length isn’t set/);

  const cabin = draft('Which weekend works for a cabin trip?');
  assert.equal(cabin.title, 'Cabin trip');
  assert.equal(cabin.level, 'days');
  assert.equal(cabin.row, 2);
  assert.deepEqual(dates(cabin), ['2026-11-07', '2026-11-08', '2026-11-14', '2026-11-15', '2026-11-21', '2026-11-22']);

  const dateNight = draft(
    'I’m only free Wednesday, Thursday, and the weekend this week. Create a date poll for a date night with my wife.',
  );
  assert.equal(dateNight.title, 'Date night');
  assert.deepEqual(pairs(dateNight), [
    ['2026-11-04', 'evening'],
    ['2026-11-05', 'evening'],
    ['2026-11-07', 'evening'],
    ['2026-11-08', 'evening'],
  ]);
  assert.match(dateNight.note, /^Read from your words\. Check the days\. Took date night as evenings\.$/);
});

test('weekdays, weekends, parts of the day, and spans', () => {
  assert.deepEqual(dates(draft('Fridays next month')), ['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
  assert.deepEqual(pairs(draft('evenings this week')).slice(0, 2), [
    ['2026-11-02', 'evening'],
    ['2026-11-03', 'evening'],
  ]);
  assert.equal(draft('evenings this week').days.length, 7);
  assert.deepEqual(dates(draft('next week')), [
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
    '2026-11-14',
    '2026-11-15',
  ]);
  assert.deepEqual(dates(draft('weekdays next week')), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  assert.deepEqual(dates(draft('this weekend')), ['2026-11-07', '2026-11-08']);
  assert.deepEqual(dates(draft('next weekend')), ['2026-11-14', '2026-11-15']);
  assert.deepEqual(dates(draft('Saturday')), ['2026-11-07']); // the coming one
  assert.deepEqual(dates(draft('Saturdays')), ['2026-11-07', '2026-11-14', '2026-11-21']); // the next three weeks
  assert.deepEqual(dates(draft('mornings or afternoons on Fri and Sat this week')), ['2026-11-06', '2026-11-07']);
  assert.equal(draft('mornings or afternoons on Fri and Sat this week').days.length, 4);
  assert.deepEqual(pairs(draft('brunch on Sundays')), [
    ['2026-11-08', 'morning'],
    ['2026-11-15', 'morning'],
    ['2026-11-22', 'morning'],
  ]);
  assert.equal(draft('in December').days.length, 31);
  assert.deepEqual(dates(draft('late November')), [
    '2026-11-21',
    '2026-11-22',
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
    '2026-11-26',
    '2026-11-27',
    '2026-11-28',
    '2026-11-29',
    '2026-11-30',
  ]);
  assert.deepEqual(dates(draft('a Saturday in early December')), ['2026-12-05']);
  assert.equal(draft('the next two weeks').days.length, 14);
  assert.deepEqual(dates(draft('tomorrow evening')), ['2026-11-03']);
  const trip = draft('3-day trip in late November');
  assert.equal(trip.row, 3);
  assert.equal(trip.level, 'days');
  assert.equal(draft('two nights away next month').row, 3);
});

test('short day names are days, not plurals, and "the sun" is not Sunday', () => {
  assert.deepEqual(dates(draft('Dinner weds or thurs this week')), ['2026-11-04', '2026-11-05']);
  assert.deepEqual(dates(draft('Coffee tues or fri next week')), ['2026-11-10', '2026-11-13']);
  assert.deepEqual(dates(draft('Picnic in the sun on Saturday')), ['2026-11-07']);
  assert.deepEqual(dates(draft('Sat or Sun')), ['2026-11-07', '2026-11-08']);
  assert.deepEqual(dates(draft('Fridays next month')), ['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
  // Lunch implies afternoons, and the note names it.
  const lunch = draft('Lunch Wednesday or Friday');
  assert.deepEqual(pairs(lunch), [
    ['2026-11-04', 'afternoon'],
    ['2026-11-06', 'afternoon'],
  ]);
  assert.match(lunch.note, /Took lunch as afternoons\./);
  assert.doesNotMatch(lunch.note, /undefined/);
});

test('what it can’t read plainly is left alone, never guessed', () => {
  for (const words of [
    '', // nothing
    'soon', // no day at all
    'evenings', // a time of day, but no day
    'team sync Tue 2-4pm', // clock times
    'Dec 5', // a date by number
    'any day except Monday', // a hard limit it would lose
    'ideally Friday, Saturday if needed', // a preference it would lose
    'next week in December', // two spans
    'we may meet soon', // "may" the word, not the month
  ])
    assert.equal(draft(words), null, words);
  assert.equal(draft('in May').days[0].date, '2027-05-01'); // a month gone by this year is next year's
});

test('today is a Sunday: this week and this weekend are today, next week starts tomorrow', () => {
  assert.deepEqual(dates(draft('this week', SUN)), [SUN]);
  assert.deepEqual(dates(draft('this weekend', SUN)), [SUN]);
  assert.deepEqual(dates(draft('Saturday', SUN)), ['2026-11-14']);
  assert.deepEqual(dates(draft('Sunday', SUN)), [SUN]);
  assert.equal(dates(draft('next week', SUN))[0], '2026-11-09');
  assert.equal(dates(draft('next Friday', SUN))[0], '2026-11-13');
  // Tonight's evening is over at 11 PM: today is left out, and said.
  assert.equal(draft('tonight', SUN, 23 * 60), null);
  assert.deepEqual(pairs(draft('evenings this week', SUN, 600)), [[SUN, 'evening']]);
});

test('across the year’s end', () => {
  const dec30 = '2026-12-30';
  assert.deepEqual(dates(draft('next week', dec30)), [
    '2027-01-04',
    '2027-01-05',
    '2027-01-06',
    '2027-01-07',
    '2027-01-08',
    '2027-01-09',
    '2027-01-10',
  ]);
  assert.deepEqual(dates(draft('Fridays next month', dec30)), [
    '2027-01-01',
    '2027-01-08',
    '2027-01-15',
    '2027-01-22',
    '2027-01-29',
  ]);
  assert.equal(draft('in January', dec30).days[0].date, '2027-01-01');
  assert.deepEqual(dates(draft('in December', dec30)), ['2026-12-30', '2026-12-31']);
  assert.deepEqual(dates(draft('this week', dec30)), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
});

test('the answer has the shape AI’s does, so the same checks settle it', () => {
  const out = parseDays('Fridays next month', { today: MON });
  assert.deepEqual(Object.keys(out).sort(), [...DAYS_SCHEMA.required].sort());
  assert.equal(draft('Fridays next month').byWords, true);
});

// The API: only where AI can't answer, and never ahead of it.
async function serve(t, options) {
  const s = createApp(options);
  await new Promise((r) => s.listen(0, r));
  t.after(() => s.close());
  return (body, headers = {}) =>
    fetch(`http://localhost:${s.address().port}/api/ai/draft-days`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
}

test('a server without AI reads plain words, in the person’s time zone, across a clock change', async (t) => {
  // 00:30 on Sunday Nov 1 2026 in New York, the night the clocks go back; still Saturday in Los Angeles.
  const post = await serve(t, { env: {}, now: () => Date.UTC(2026, 10, 1, 4, 30) });
  const ny = await (await post({ prompt: 'this week, evenings', timezone: 'America/New_York' })).json();
  assert.deepEqual(pairs(ny), [['2026-11-01', 'evening']]);
  assert.equal(ny.note, 'Read from your words. Check the days.'); // no AI here, so it isn't mentioned
  const la = await (await post({ prompt: 'this week, evenings', timezone: 'America/Los_Angeles' })).json();
  assert.deepEqual(dates(la), ['2026-10-31', '2026-11-01']);
  // New Year's Eve in UTC is already New Year's Day in Auckland.
  const nz = await serve(t, { env: {}, now: () => Date.UTC(2026, 11, 31, 12) });
  assert.equal((await (await nz({ prompt: 'next month', timezone: 'Pacific/Auckland' })).json()).days[0].date, '2027-02-01');
  // Words it can't read: said, with what to do.
  const no = await post({ prompt: 'whenever', timezone: 'UTC' });
  assert.equal(no.status, 400);
  assert.match((await no.json()).error, /Name them, like “Fridays next month”, or pick them below/);
  assert.equal((await post({ prompt: 'Fridays', timezone: 'Mars/Base' })).status, 400);
  // Other AI requests are still off.
  const poll = await fetch(new URL('/api/ai/draft-poll', (await post({})).url), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(poll.status, 404);
});

test('with AI but no allowance, plain words still get a draft; anything else asks for a key as before', async (t) => {
  let asked = 0;
  const anthropic = {
    beta: {
      messages: {
        create: async () => {
          asked++;
          throw new Error('not in this test');
        },
      },
    },
  };
  const post = await serve(t, {
    env: { ANTHROPIC_API_KEY: 'sk-test', AI_WEEKLY_LIMIT: '0' },
    anthropic,
    now: () => Date.UTC(2026, 10, 2, 10),
  });
  const ok = await post({ prompt: 'Fridays next month', timezone: 'UTC' });
  assert.equal(ok.status, 200);
  const fridays = await ok.json();
  assert.deepEqual(dates(fridays), ['2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25']);
  assert.equal(fridays.note, 'Read from your words, without AI. Check the days.'); // on a server with AI, said
  const no = await post({ prompt: 'whenever suits', timezone: 'UTC' });
  assert.equal(no.status, 402); // the key form, with "Fill it in yourself" (#227)
  assert.match((await no.json()).error, /Add your own Anthropic API key/);
  // A person's own key goes to the model, never to the words.
  const own = await post({ prompt: 'Fridays next month', timezone: 'UTC' }, { 'x-anthropic-key': `sk-ant-${'a'.repeat(30)}` });
  assert.notEqual(own.status, 200);
  assert.equal(asked, 1);
});
