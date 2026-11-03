// Venn as an MCP server (/api/mcp), so people can make a Venn and read its answers from Claude,
// ChatGPT or any other assistant that speaks the Model Context Protocol. The assistant does the
// language work on its person's own plan; Venn only makes and reads polls through its public API,
// so this costs Venn nothing in AI and needs no key. Stateless JSON-RPC over HTTP POST
// ("Streamable HTTP", answered as plain JSON).

import { isDaysPoll, rankTimes } from '../public/core.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 64 * 1024;

const TOOLS = [
  {
    name: 'create_venn',
    title: 'Create a Venn',
    description:
      'Create a Venn: a group poll that finds the day (or time) that works for everyone. Give either whole days to choose from, or specific times. Returns the link to share with guests and a private organizer link to manage the poll.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What it is, e.g. "Book club" (up to 120 characters)' },
        timezone: { type: 'string', description: 'IANA time zone of the organizer, e.g. "Europe/London"' },
        days: {
          type: 'array',
          items: { type: 'string', description: 'YYYY-MM-DD' },
          description: 'Whole days guests choose from (up to 62). Use this or times.',
        },
        times: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              start: { type: 'string', description: 'ISO 8601 with offset, e.g. 2026-11-06T19:00:00+00:00' },
              end: { type: 'string', description: 'ISO 8601 with offset' },
            },
            required: ['start', 'end'],
          },
          description: 'Specific times guests choose from (up to 60). Use this or days.',
        },
        organizer: { type: 'string', description: "The organizer's name, shown to guests (optional)" },
        description: { type: 'string', description: 'Details for guests (optional, up to 1000 characters)' },
        location: { type: 'string', description: 'Where (optional)' },
      },
      required: ['title', 'timezone'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'get_venn_results',
    title: 'Read a Venn’s answers',
    description:
      'Read who has answered a Venn and which days or times work best. Takes the poll link (or its id). Names are left out when the organizer hid them.',
    inputSchema: {
      type: 'object',
      properties: { poll: { type: 'string', description: 'The poll link, e.g. https://venn.day/e/abc123, or its id' } },
      required: ['poll'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const toolText = (data, isError = false) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  ...(isError && { isError: true }),
});

/** "Fri, Nov 6" or "Fri, Nov 6, 7:00 PM", in the poll's time zone. */
function label(ms, tz, wholeDay) {
  const opts = {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(!wholeDay && { hour: 'numeric', minute: '2-digit' }),
  };
  return new Intl.DateTimeFormat('en-US', opts).format(ms);
}

async function createVenn(args, call, origin) {
  const { title, timezone, days, times, organizer, description, location } = args || {};
  if (!!days?.length === !!times?.length) return toolText('Give either days or times (one of them, not both).', true);
  const body = { title, timezone, organizer, description, location };
  if (days?.length)
    Object.assign(body, { dates: days, startMinute: 0, endMinute: 1440, slotMinutes: 1440, durationMinutes: 1440 });
  else {
    const options = times.map((t) => ({ start: Date.parse(t?.start), end: Date.parse(t?.end) }));
    if (options.some((o) => !Number.isFinite(o.start) || !Number.isFinite(o.end)))
      return toolText('Each time needs a start and end in ISO 8601, like 2026-11-06T19:00:00+00:00.', true);
    Object.assign(body, { mode: 'options', options });
  }
  const res = await call('events', { method: 'POST', body });
  const data = await res.json();
  if (!res.ok) return toolText(data.error || 'Venn could not create the poll.', true);
  return toolText({
    link: `${origin}/e/${data.id}`,
    organizerLink: `${origin}/e/${data.id}#admin=${data.adminToken}`,
    note: 'Share the link with guests. Keep the organizer link private: it manages the poll and picks the date.',
  });
}

async function getResults(args, call, origin) {
  const m = /(?:^|\/e\/)([A-Za-z0-9]{1,32})(?:[/?#]|$)/.exec(String(args?.poll || '').trim());
  if (!m) return toolText('Give the poll link, like https://venn.day/e/abc123, or its id.', true);
  const res = await call(`events/${m[1]}`, { method: 'GET' });
  const ev = await res.json();
  if (!res.ok) return toolText(ev.error || 'Venn could not find that poll.', true);
  const people = ev.participants || [];
  const wholeDay = ev.slotMinutes === 1440;
  const options = (ev.slots || []).map((s) => {
    const yes = people.filter((p) => p.availability?.[s] === 2);
    const ifNeeded = people.filter((p) => p.availability?.[s] === 1);
    return {
      when: label(s, ev.timezone, wholeDay),
      start: new Date(s).toISOString(),
      available: yes.length,
      ifNeeded: ifNeeded.length,
      ...(!ev.hideNames && { who: { available: yes.map((p) => p.name), ifNeeded: ifNeeded.map((p) => p.name) } }),
    };
  });
  const answers = ev.responses ?? people.length;
  const picked = ev.finalStart != null ? label(ev.finalStart, ev.timezone, wholeDay) : null;
  const pickedLine = picked != null ? `The organizer picked ${picked}. ` : '';
  const head = {
    title: ev.title,
    link: `${origin}/e/${ev.id}`,
    timezone: ev.timezone,
    answers,
    ...(picked != null && { picked }),
  };
  if (ev.hideResults)
    return toolText({ ...head, summary: `${pickedLine}The organizer hid the answers.`, note: 'The organizer hid the answers.' });
  const { best, leading, summary } = bestTimes(ev, people, answers);
  return toolText({ ...head, summary: pickedLine + summary, leading, best, options: options.slice(0, 100) });
}

/** "Fri, Nov 6 – Sun, Nov 8" or "Fri, Nov 6, 7:00 PM – 9:00 PM": a ranked stretch, in the poll's time zone. */
function span(start, end, ev) {
  const wholeDay = ev.slotMinutes === 1440;
  const first = label(start, ev.timezone, wholeDay);
  if (wholeDay) {
    const last = label(end - 1, ev.timezone, true);
    return last === first ? first : `${first} – ${last}`;
  }
  const time = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: ev.timezone, hour: 'numeric', minute: '2-digit' }).format(ms);
  return `${first} – ${time(end)}`;
}

/**
 * The best days or times, ranked exactly as the poll page ranks them (rankTimes in public/core.js:
 * most people who can make it, then most yeses, then the earliest; a trip's or meeting's length
 * counts every day or hour of it). Times nobody can make are left out. Ties are named only for
 * whole days, as on the page (public/event.js): a trip's or meeting's ranked stretches overlap
 * one another, and the page doesn't name ties on specific times yet (backlog P10).
 */
function bestTimes(ev, people, answers) {
  const ranked = rankTimes(ev, ev.slots || [], people, Infinity);
  const best = ranked.slice(0, 5).map((r) => ({
    when: span(r.start, r.end, ev),
    start: new Date(r.start).toISOString(),
    end: new Date(r.end).toISOString(),
    available: r.yes.length,
    ifNeeded: r.ifNeeded.length,
    ...(!ev.hideNames && { who: { available: r.yes, ifNeeded: r.ifNeeded } }),
  }));
  const [first] = ranked;
  const days = isDaysPoll(ev);
  const trip = days && ev.durationMinutes > 1440;
  const [one, many] = trip ? ['run of days', 'runs of days'] : days ? ['day', 'days'] : ['time', 'times'];
  if (!answers) return { best, leading: [], summary: 'Nobody has answered yet.' };
  if (!first) return { best, leading: [], summary: `${answers} answered, but no ${one} works for anyone yet.` };
  const n = people.length;
  const can = first.yes.length + first.ifNeeded.length;
  const who =
    can === n && !first.ifNeeded.length
      ? n === 1
        ? 'it works for the one person so far'
        : 'everyone can make it'
      : can === n && n > 1 && !first.yes.length
        ? `all ${n} can make it if needed`
        : `${can} of ${n} can make it${first.ifNeeded.length ? `, ${first.ifNeeded.length} if needed` : ''}`;
  const same = (r) => r.yes.length === first.yes.length && r.ifNeeded.length === first.ifNeeded.length;
  const alone = days && ev.durationMinutes <= ev.slotMinutes;
  const top = alone ? ranked.filter(same) : [first];
  const leading = top.map((r) => span(r.start, r.end, ev));
  if (top.length > 1)
    return { best, leading, summary: `Tied: ${andList(leading)}; for each, ${who}. No single best ${one} yet.` };
  const others = !alone && ranked.slice(1).some(same) ? ` Other ${many} work as well.` : '';
  return { best, leading, summary: `${leading[0]} works best: ${who}.${others}` };
}

const andList = (xs) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * Answer one MCP request. `call(path, { method, body })` runs a request against Venn's own API
 * (as the same visitor, with its limits) and returns its Response.
 */
export async function handleMcp(request, call) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  const send = (obj, status = 200) => new Response(obj ? JSON.stringify(obj) : null, { status, headers });
  // Stateless: no server-to-client stream to open, and no session to end.
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return send(rpcError(null, -32600, 'Request too large'), 413);
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return send(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(msg) || msg?.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return send(rpcError(msg?.id, -32600, 'Invalid request'), 400);
  // A notification (no id) needs no answer.
  if (msg.id === undefined) return send(null, 202);
  const origin = new URL(request.url).origin;
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return send(
        rpc(msg.id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'venn', title: 'Venn', version: '1.0.0' },
          instructions:
            'Venn finds the day that works for everyone. Use create_venn to make a poll and share its link; use get_venn_results to see which days work best. Venn is free, with no sign-up.',
        }),
      );
    }
    case 'ping':
      return send(rpc(msg.id, {}));
    case 'tools/list':
      return send(rpc(msg.id, { tools: TOOLS }));
    case 'tools/call': {
      const { name, arguments: args } = msg.params || {};
      if (name === 'create_venn') return send(rpc(msg.id, await createVenn(args, call, origin)));
      if (name === 'get_venn_results') return send(rpc(msg.id, await getResults(args, call, origin)));
      return send(rpcError(msg.id, -32602, `Unknown tool: ${name}`));
    }
    default:
      return send(rpcError(msg.id, -32601, `Method not found: ${msg.method}`));
  }
}
