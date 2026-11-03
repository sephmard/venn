// Runs "Use AI" on /new against the real model for each case of the acceptance matrix (docs/AI.md,
// "How Use AI reads times"), a few times each, and says which come out right.
//
//   ANTHROPIC_API_KEY=sk-ant-… npm run ai:eval            # 3 runs of every case
//   ANTHROPIC_API_KEY=sk-ant-… npm run ai:eval -- 5 date  # 5 runs of cases whose name has "date"
//
// Each run is one Haiku request (a fraction of a cent). AI_MODEL picks another model.
import { draftDays } from '../src/ai.js';
import { zonedToUtc } from '../public/core.js';

const NY = 'America/New_York';
const at = (date, hour = 10, tz = NY) => zonedToUtc(date, hour * 60, tz);
const MON = at('2026-11-02');
const W = (dates, part) => dates.map((d) => `${d} ${part}`);
const H = (dates, from, to) => dates.map((d) => `${d} ${from}-${to}`);

// Each case: what's typed, when, and the windows expected ("2026-11-04 evening", "2026-11-03 840-960"
// or "2026-11-07 all"), with the mode and days in a row where they matter.
const CASES = [
  {
    name: '1 date night, only free wed thu weekend',
    text: 'I’m only free wed Thu and the weekend this week, create a date poll for a date night with my wife.',
    level: 'parts',
    want: W(['2026-11-04', '2026-11-05', '2026-11-07', '2026-11-08'], 'evening'),
  },
  {
    name: '1b date night, asked on Thursday',
    now: at('2026-11-05'),
    text: 'I’m only free wed Thu and the weekend this week, create a date poll for a date night with my wife.',
    level: 'parts',
    want: W(['2026-11-05', '2026-11-07', '2026-11-08'], 'evening'),
  },
  {
    name: '2 brunch mornings',
    text: 'Brunch Saturday or Sunday morning',
    level: 'parts',
    want: W(['2026-11-07', '2026-11-08'], 'morning'),
  },
  {
    name: '3 lunch next week',
    text: 'Team lunch, any afternoon next week',
    level: 'parts',
    want: W(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], 'afternoon'),
  },
  {
    name: '4 date night but afternoons',
    text: 'Date night, but we’re only available in the afternoon, Friday or Saturday',
    level: 'parts',
    want: W(['2026-11-06', '2026-11-07'], 'afternoon'),
  },
  {
    name: '5 sync 2-4pm',
    text: 'Team sync Tuesday or Thursday 2–4pm',
    level: 'hours',
    want: H(['2026-11-03', '2026-11-05'], 840, 960),
  },
  {
    name: '6 after 6pm',
    text: 'Call after 6pm on Wednesday or Thursday',
    level: 'hours',
    want: H(['2026-11-04', '2026-11-05'], 1080, 1440),
  },
  {
    name: '7 45 minutes between 9 and noon',
    text: '45-minute meeting Wednesday between 9 and noon',
    level: 'hours',
    want: H(['2026-11-04'], 540, 720),
  },
  {
    name: '8 beach day Saturdays',
    text: 'Beach day, any Saturday in November',
    level: 'days',
    want: W(['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28'], 'all'),
  },
  {
    name: '9 three-day trip',
    text: 'Weekend trip to the lake, 3 days in a row, sometime in the next three weeks',
    level: 'days',
    row: 3,
  },
  {
    name: '10 fri evening or sat afternoon',
    text: 'Friday evening or Saturday afternoon',
    level: 'parts',
    want: ['2026-11-06 evening', '2026-11-07 afternoon'],
  },
  {
    name: '11 sat any time or sun evening',
    text: 'Saturday any time or Sunday evening',
    level: 'parts',
    want: [
      ...W(['2026-11-07'], 'morning'),
      ...W(['2026-11-07'], 'afternoon'),
      ...W(['2026-11-07'], 'evening'),
      '2026-11-08 evening',
    ],
  },
  {
    name: '12 mon 7-9pm or wed evening',
    text: 'Monday 7–9pm or Wednesday evening',
    level: 'hours',
    want: ['2026-11-04 1080-1320', '2026-11-09 1140-1260'],
  },
  {
    name: '13 except monday',
    text: 'Dinner any evening next week except Monday',
    level: 'parts',
    want: W(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], 'evening'),
  },
  {
    name: '14 prefer weekend',
    text: 'Drinks next week, ideally the weekend but weeknights work too',
    level: 'parts',
    want: W(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], 'evening'),
    ifNeeded: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'],
  },
  {
    name: '15 correction',
    text: 'Dinner Tuesday evening, actually I’m busy Tuesday, make it Wednesday',
    level: 'parts',
    want: ['2026-11-04 evening'],
  },
  {
    name: '16 this week on a Sunday',
    now: at('2026-11-01'),
    text: 'Coffee this week, morning',
    level: 'parts',
    want: ['2026-11-01 morning'],
  },
  {
    name: '17 next week over a month end',
    now: at('2026-11-27'),
    text: 'Dinner next week, any evening',
    level: 'parts',
    want: W(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'], 'evening'),
  },
  {
    name: '18 first saturday of next year',
    now: at('2026-12-29'),
    text: 'Party on the first Saturday of next year',
    level: 'parts',
    want: ['2027-01-02 evening'],
  },
  {
    name: '19 tonight in Los Angeles',
    now: Date.UTC(2026, 10, 3, 3),
    tz: 'America/Los_Angeles',
    text: 'Drinks tonight or tomorrow evening',
    level: 'parts',
    want: W(['2026-11-02', '2026-11-03'], 'evening'),
  },
  {
    name: '19 tonight in Tokyo',
    now: Date.UTC(2026, 10, 3, 3),
    tz: 'Asia/Tokyo',
    text: 'Drinks tonight or tomorrow evening',
    level: 'parts',
    want: W(['2026-11-03', '2026-11-04'], 'evening'),
  },
  {
    name: '20 tonight is over',
    now: at('2026-11-02', 23),
    text: 'Drinks tonight or tomorrow',
    level: 'parts',
    want: ['2026-11-03 evening'],
  },
  // What the group is deciding (docs/AI.md, "A vote, not a time"): `vote` is 'what', 'both' or 'when'.
  {
    name: 'v1 choose between three dinners',
    text: 'Choose between Italian, Thai, and Mexican for dinner.',
    vote: 'what',
    options: 3,
  },
  { name: 'v2 vote on the next book', text: 'Vote on our next book: Piranesi, Dune or Circe', vote: 'what', options: 3 },
  { name: 'v2b vote on the next book, none named', text: 'Vote on our next book.', vote: 'what' },
  {
    name: 'v3 where and when for dinner',
    text: 'Let’s decide where and when to have dinner this week',
    vote: 'both',
    level: 'parts',
  },
  { name: 'v4 a plain plan is no vote', text: 'Which weekend works for a cabin trip?', vote: 'when', level: 'days' },
];

const key = (d) => `${d.date} ${d.part ?? (d.start != null ? `${d.start}-${d.end}` : 'all')}`;

function check(c, draft) {
  const problems = [];
  if (c.vote) {
    const said = draft.vote ? (draft.vote.both ? 'both' : 'what') : 'when';
    if (said !== c.vote) problems.push(`read as ${said}, not ${c.vote}`);
    if (c.options && draft.vote?.options.length !== c.options) problems.push(`${draft.vote?.options.length ?? 0} choices`);
    if (c.vote === 'what') return problems; // no days to check
  }
  if (draft.level !== c.level) problems.push(`mode ${draft.level}, not ${c.level}`);
  if (c.row && draft.row !== c.row) problems.push(`${draft.row} in a row, not ${c.row}`);
  if (c.want) {
    const got = new Set(draft.days.map(key));
    const missing = c.want.filter((w) => !got.has(w));
    const extra = [...got].filter((g) => !c.want.includes(g));
    if (missing.length) problems.push(`missing ${missing.join(', ')}`);
    if (extra.length) problems.push(`extra ${extra.join(', ')}`);
  }
  if (c.ifNeeded) {
    const maybe = [...new Set(draft.days.filter((d) => d.ifNeeded).map((d) => d.date))].sort();
    if (maybe.join() !== c.ifNeeded.join()) problems.push(`if needed ${maybe.join(', ') || 'none'}`);
  }
  return problems;
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY to run the cases against the model.');
  process.exit(2);
}
const runs = Number(process.argv[2]) || 3;
const only = process.argv[3] || '';
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, AI_MODEL: process.env.AI_MODEL };
let passed = 0;
let total = 0;
for (const c of CASES.filter((x) => x.name.includes(only))) {
  const results = await Promise.all(
    Array.from({ length: runs }, () =>
      draftDays(env, { prompt: c.text, timezone: c.tz || NY }, { now: c.now ?? MON }).then(
        (draft) => ({ draft, problems: check(c, draft) }),
        (e) => ({ problems: [`error: ${e.message}`] }),
      ),
    ),
  );
  const ok = results.filter((r) => !r.problems.length).length;
  passed += ok;
  total += runs;
  console.log(`${ok === runs ? 'PASS' : 'FAIL'} ${ok}/${runs}  ${c.name}`);
  for (const r of results.filter((x) => x.problems.length))
    console.log(`        ${r.problems.join('; ')}${r.draft?.note ? `  (note: ${r.draft.note})` : ''}`);
}
console.log(`\n${passed}/${total} runs right`);
process.exit(passed === total ? 0 : 1);
