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
  const ok =
    // SDK 1.x sends the key as a bearer token; older versions used x-api-key.
    (req.headers.authorization === 'Bearer sk-test' || req.headers['x-api-key'] === 'sk-test') &&
    String(req.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') &&
    body.fallbacks === 'default' &&
    body.output_config?.format?.type === 'json_schema';
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
