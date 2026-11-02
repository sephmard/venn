// Venn as an MCP server (/api/mcp), so people can make a Venn and read its answers from Claude,
// ChatGPT or any other assistant that speaks the Model Context Protocol. The assistant does the
// language work on its person's own plan; Venn only makes and reads polls through its public API,
// so this costs Venn nothing in AI and needs no key. Stateless JSON-RPC over HTTP POST
// ("Streamable HTTP", answered as plain JSON).

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
  const best = [...options].sort((a, b) => b.available - a.available || b.ifNeeded - a.ifNeeded).slice(0, 5);
  return toolText({
    title: ev.title,
    link: `${origin}/e/${ev.id}`,
    timezone: ev.timezone,
    answers: people.length,
    ...(ev.finalStart != null && { picked: label(ev.finalStart, ev.timezone, wholeDay) }),
    ...(ev.hideResults ? { note: 'The organizer hid the answers.' } : { best, options: options.slice(0, 100) }),
  });
}

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
