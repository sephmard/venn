// Read free/busy times from Google Calendar or Outlook, entirely in the browser.
// Access tokens are kept in memory for this page only and never sent to the Venn server.
// Only time ranges are requested: no event titles, attendees or descriptions.

const CALLBACK_PATH = '/oauth-callback.html';
const CHANNEL = 'venn-oauth';

export const PROVIDERS = {
  google: { label: 'Google Calendar' },
  microsoft: { label: 'Outlook' },
};

const tokens = {}; // provider -> { accessToken, expiresAt }

function randomString(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function pkceChallenge(verifier) {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

/**
 * Open the provider's sign-in page in a popup and wait for it to come back to
 * oauth-callback.html, which reports the result over a BroadcastChannel. That works
 * even though the popup visits another site (which cuts the window.opener link).
 */
function signInPopup(popup, url, state) {
  if (!popup || popup.closed) return Promise.reject(new Error('Allow pop-ups for this site to connect your calendar.'));
  popup.location.href = url;
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL);
    const done = (fn, value) => {
      clearInterval(timer);
      channel.close();
      fn(value);
    };
    channel.onmessage = (e) => {
      if (!e.data || e.data.state !== state) return;
      if (e.data.error)
        done(reject, new Error(e.data.error === 'access_denied' ? 'Calendar access was not granted.' : e.data.error));
      else done(resolve, e.data);
    };
    // If the person closes the popup without finishing, stop waiting.
    const timer = setInterval(() => {
      if (popup.closed) setTimeout(() => done(reject, new Error('Sign-in was closed before it finished.')), 500);
    }, 500);
  });
}

// ---------- Google: OAuth token flow for browser apps, then the freeBusy API ----------

async function googleToken(popup, clientId) {
  const state = randomString(16);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: location.origin + CALLBACK_PATH,
    response_type: 'token',
    scope: 'https://www.googleapis.com/auth/calendar.freebusy',
    state,
    prompt: 'select_account',
    include_granted_scopes: 'false',
  });
  const result = await signInPopup(popup, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state);
  if (!result.access_token) throw new Error('Google did not return access to your calendar.');
  return { accessToken: result.access_token, expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000 };
}

async function googleBusy(token, start, end) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { authorization: `Bearer ${token.accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      items: [{ id: 'primary' }],
    }),
  });
  if (res.status === 401) throw Object.assign(new Error('expired'), { expired: true });
  if (!res.ok) throw new Error("Couldn't read your Google Calendar.");
  const data = await res.json();
  return (data.calendars?.primary?.busy || []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}

// ---------- Microsoft: authorization code with PKCE (no secret), then calendarView ----------

async function microsoftToken(popup, clientId, tenant = 'common') {
  const state = randomString(16);
  const verifier = randomString(48);
  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
  const redirectUri = location.origin + CALLBACK_PATH;
  const scope = 'Calendars.ReadBasic';
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope,
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  const result = await signInPopup(popup, `${base}/authorize?${params}`, state);
  if (!result.code) throw new Error('Microsoft did not return access to your calendar.');
  const res = await fetch(`${base}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error('Microsoft sign-in failed. Please try again.');
  return { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
}

async function microsoftBusy(token, start, end) {
  const busy = [];
  let url =
    'https://graph.microsoft.com/v1.0/me/calendarView?' +
    new URLSearchParams({
      startDateTime: new Date(start).toISOString(),
      endDateTime: new Date(end).toISOString(),
      $select: 'start,end,showAs,isAllDay,isCancelled',
      $top: '250',
    });
  for (let page = 0; url && page < 20; page++) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token.accessToken}`, prefer: 'outlook.timezone="UTC"' } });
    if (res.status === 401) throw Object.assign(new Error('expired'), { expired: true });
    if (!res.ok) throw new Error("Couldn't read your Outlook calendar.");
    const data = await res.json();
    for (const e of data.value || []) {
      // All-day entries (holidays, out-of-office markers) are skipped like in .ics imports.
      if (e.isCancelled || e.isAllDay || e.showAs === 'free' || e.showAs === 'workingElsewhere') continue;
      busy.push({
        start: Date.parse(e.start.dateTime + 'Z'),
        end: Date.parse(e.end.dateTime + 'Z'),
        tentative: e.showAs === 'tentative',
      });
    }
    url = data['@odata.nextLink'];
  }
  return busy;
}

export const needsSignIn = (provider) => !tokens[provider] || tokens[provider].expiresAt < Date.now() + 60_000;

/**
 * Open the sign-in popup. Must be called directly in a click handler, before any `await`:
 * browsers (Safari especially) block popups that open later.
 */
export function openSignInWindow() {
  return window.open('about:blank', 'venn-oauth', 'popup,width=520,height=680');
}

/**
 * Busy intervals for [start, end) from the chosen provider. Pass the popup from
 * openSignInWindow() when needsSignIn(provider) is true; otherwise the in-memory token is reused.
 */
export async function fetchBusy(provider, config, start, end, popup) {
  const get = provider === 'google' ? googleBusy : microsoftBusy;
  if (needsSignIn(provider)) {
    tokens[provider] =
      provider === 'google'
        ? await googleToken(popup, config.google)
        : await microsoftToken(popup, config.microsoft, config.microsoftTenant);
  } else popup?.close();
  try {
    return await get(tokens[provider], start, end);
  } catch (e) {
    if (!e.expired) throw e;
    delete tokens[provider];
    throw new Error('Your calendar connection expired. Tap again to reconnect.', { cause: e });
  }
}
