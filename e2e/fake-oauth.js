// A stand-in for Google's sign-in, for the browser tests of accounts (e2e/account.spec.js). The Venn
// server under test sends people here (OAUTH_TEST_BASE) and swaps the code here, server to server.
// Who signs in is the test's `x-test-user` header, so two browsers can be the same person.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8793);
const codes = new Map();
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/google/authorize') {
    const user = String(req.headers['x-test-user'] || 'someone');
    const code = Math.random().toString(36).slice(2);
    codes.set(code, { user, nonce: url.searchParams.get('nonce'), client: url.searchParams.get('client_id') });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: String(back) });
    return res.end();
  }
  if (url.pathname === '/google/token' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    const found = codes.get(form.get('code'));
    codes.delete(form.get('code'));
    res.writeHead(found && form.get('code_verifier') ? 200 : 400, { 'content-type': 'application/json' });
    if (!found) return res.end(JSON.stringify({ error: 'invalid_grant' }));
    const claims = {
      iss: 'https://accounts.google.com',
      aud: found.client,
      sub: found.user,
      email: `${found.user}@example.com`,
      email_verified: true,
      name: 'Robin Park',
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: found.nonce,
    };
    return res.end(JSON.stringify({ access_token: 'x', id_token: `${b64url({ alg: 'none' })}.${b64url(claims)}.x` }));
  }
  res.writeHead(404).end();
}).listen(PORT);
