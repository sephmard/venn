// A stand-in for the Claude API used by the browser tests. The real Anthropic SDK in the
// Venn server talks to it over HTTP (ANTHROPIC_BASE_URL), so requests are checked end to end.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8792);

function reply(body) {
  const props = body.output_config?.format?.schema?.properties || {};
  const prompt = body.messages?.[0]?.content || '';
  if (props.slots) {
    const today = prompt.match(/Today is \w+ (\d{4}-\d{2}-\d{2})/)[1];
    const day = (n) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
    return {
      title: 'Design review',
      description: 'Walk through the new onboarding flow.',
      durationMinutes: 45,
      slots: [1, 2, 3].map((n) => ({ date: day(n), time: '14:00' })),
    };
  }
  // Describe it on /new. "date night" reads as this week's Wednesday, Thursday and weekend
  // evenings, as a model following the rules would; "2-4pm" as Tuesday and Thursday hours; "trip"
  // as 3 days in a row; anything else as Friday and Saturday evenings in the next two weeks, with
  // Saturdays only if needed.
  if (props.timeOfDay) {
    const today = prompt.match(/Today is \w+ (\d{4}-\d{2}-\d{2})/)[1];
    const text = prompt.match(/<user_text>([\s\S]*)<\/user_text>/)?.[1] || '';
    const week = prompt.match(/This week:\n((?: {2}\w+ \d{4}-\d{2}-\d{2}\n?)+)/)[1];
    const named = (names, from = prompt) =>
      [...from.matchAll(/^\s*(\w+) (\d{4}-\d{2}-\d{2})$/gm)]
        .filter(([, n]) => names.includes(n))
        .map(([, n, date]) => ({ n, date }));
    const base = { reading: '', emoji: '🍝', tile: 'sunny', location: text.match(/ at (.+?)(,|$)/)?.[1] || '' };
    const day = (date, more = {}) => ({ date, parts: [], from: '', to: '', ifNeeded: false, ...more });
    if (/date night/i.test(text))
      return {
        ...base,
        title: 'Date night',
        emoji: '💕',
        tile: 'berry',
        timeOfDay: 'parts',
        usualParts: ['evening'],
        firstDate: today,
        lastDate: named(['Sunday'], week)[0]?.date || today,
        daysInRow: 1,
        days: named(['Wednesday', 'Thursday', 'Saturday', 'Sunday'], week).map(({ date }) => day(date)),
        note: 'Took date night as evenings.',
      };
    if (/2-4pm/.test(text))
      return {
        ...base,
        title: 'Team sync',
        emoji: '💬',
        tile: 'paper',
        timeOfDay: 'clock',
        usualParts: [],
        firstDate: today,
        lastDate: '',
        daysInRow: 1,
        days: named(['Tuesday', 'Thursday'])
          .slice(0, 2)
          .map(({ date }) => day(date, { from: '14:00', to: '16:00' })),
        note: '',
      };
    if (/trip/i.test(text))
      return {
        ...base,
        title: 'Lake trip',
        emoji: '🏕️',
        tile: 'sky',
        timeOfDay: 'any',
        usualParts: [],
        firstDate: today,
        lastDate: '',
        daysInRow: 3,
        days: named(['Friday', 'Saturday', 'Sunday', 'Monday'])
          .slice(0, 4)
          .map(({ date }) => day(date)),
        note: '',
      };
    return {
      ...base,
      title: 'Dinner',
      timeOfDay: 'parts',
      usualParts: [],
      firstDate: today,
      lastDate: '',
      daysInRow: 1,
      // "whenever": no days, so the page says what to do.
      days: /whenever/.test(text)
        ? []
        : named(['Friday', 'Saturday'])
            .slice(0, 4)
            .filter(({ date }) => date > today)
            .map(({ n, date }) => day(date, { parts: ['evening'], ifNeeded: n === 'Saturday' })),
      note: '',
    };
  }
  // A vote on /new/topic.
  if (props.yesNo)
    return { question: 'Where should we eat Friday?', yesNo: false, options: ['Rosa’s', 'Luigi’s', 'Thai Garden'] };
  // A brand template's look.
  if (props.ownPage)
    return {
      accent: '#c2410c',
      ownPage: false,
      bg: '',
      surface: '',
      text: '',
      font: 'slab',
      bodyFont: 'humanist',
      corners: 'round',
      buttons: 'corners',
      title: 'Climb night',
      name: /Summit Gym/.test(prompt) ? 'Summit Gym' : '', // only a name the description gives
      emoji: '🧗',
    };
  if (props.recommendedOption)
    return { summary: 'Most people can make the first option.', recommendedOption: 1, reason: 'Nobody is busy then.' };
  if (props.answers) {
    const count = prompt.split('\n').filter((l) => /^\d+\. /.test(l)).length;
    return {
      answers: Array.from({ length: count }, (_, i) => ({
        option: i + 1,
        answer: i === 0 ? 'no' : 'yes',
        note: i === 0 ? 'You said no mornings' : 'Looks free',
      })),
    };
  }
  if (props.message) return { message: `Hi team! Please mark the times that work for you: ${prompt.match(/Link: (\S+)/)[1]}` };
  return {};
}

createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) return res.writeHead(404).end();
  const body = JSON.parse(raw);
  // SDK 1.x sends the key as a bearer token; older versions used x-api-key. The server's key, or
  // one someone brought (any sk-ant- key works, but sk-ant-bad… is turned down).
  const key = req.headers.authorization?.replace(/^Bearer /, '') || req.headers['x-api-key'];
  if (key?.startsWith('sk-ant-bad')) {
    res.writeHead(401, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
  }
  // Haiku has no server-side fallback; other models ask for it.
  const fallback = body.model.includes('haiku')
    ? body.fallbacks === undefined
    : String(req.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') && body.fallbacks === 'default';
  const ok = (key === 'sk-test' || key?.startsWith('sk-ant-')) && fallback && body.output_config?.format?.type === 'json_schema';
  if (!ok) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(
      JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'unexpected request shape' } }),
    );
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: JSON.stringify(reply(body)) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    }),
  );
}).listen(PORT, () => console.log(`fake Anthropic API on ${PORT}`));
