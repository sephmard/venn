// Link previews for poll pages. Chat apps (iMessage, WhatsApp, Slack, Discord) don't run
// JavaScript, so when a server sends the app shell for /e/<id> it puts that poll's own title,
// description and image into <head>. Shared by the Worker and the Node server.

import { allDaySpan, buildSlots, isOptionsPoll, meetingEnd, rankTimes } from '../public/core.js';
import { imagePath } from './images.js';

// Static images, rendered by `npm run og` (scripts/og-image.js): one to ask, one once it's set,
// and both again for polls in the retro look.
export const OG_IMAGES = {
  vote: { path: '/og.png', alt: 'Venn: find the day that works for everyone' },
  set: { path: '/og-set.png', alt: "Venn: it's set" },
  retroVote: { path: '/og-retro.png', alt: 'Venn: find the day that works for everyone' },
  retroSet: { path: '/og-set-retro.png', alt: "Venn: it's set" },
};

// For a poll that doesn't exist (any more): the same as the home page's.
const GENERIC = {
  pageTitle: 'Venn: find a time that works',
  title: 'Venn: find the day that works for everyone',
  description: 'Free polls for dinners, book clubs and trips. Share one link and see which day works for everyone.',
  image: OG_IMAGES.vote,
};

const POLL_PATH = /^\/e\/([A-Za-z0-9]{1,40})\/?$/;

const escAttr = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** "Fri, Nov 13, 7:00 PM GMT", or "Fri, Nov 13" / "Fri, Nov 13 – Sun, Nov 15" for whole days, in the poll's time zone. */
export function setLabel(ev, start) {
  const tz = ev.timezone;
  const span = allDaySpan(start, meetingEnd(ev, start), tz);
  const day = { weekday: 'short', month: 'short', day: 'numeric' };
  let label;
  if (span) {
    const f = new Intl.DateTimeFormat('en-US', { ...day, timeZone: 'UTC' });
    const first = Date.parse(`${span.startDate}T00:00Z`);
    const last = Date.parse(`${span.endDate}T00:00Z`) - 86_400_000;
    label = last > first ? f.formatRange(first, last) : f.format(first);
  } else {
    label = new Intl.DateTimeFormat('en-US', {
      ...day,
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
      timeZoneName: 'short',
    }).format(start);
  }
  // Intl uses thin and narrow no-break spaces; chat apps show plain ones better.
  return label.replace(/[\u2009\u202f\u00a0]/g, ' ');
}

/** The days a poll asks about, in its time zone: "Fri, Nov 13", or "Nov 12 – 20". */
function spanLabel(ev, slots) {
  const first = Math.min(...slots);
  const last = Math.max(...slots);
  const f = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: ev.timezone });
  const day = (t) =>
    f
      .formatToParts(t)
      .map((p) => p.value)
      .join('');
  const label =
    day(first) === day(last)
      ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: ev.timezone }).format(
          first,
        )
      : f.formatRange(first, last);
  return label.replace(/[\u2009\u202f\u00a0]/g, ' ');
}

/**
 * Title, description and image for a poll's preview, from what `store.getPreview` returns.
 * Only what anyone with the link can already see: no participant names or emails, and no counts
 * when the organizer hides results or names. `answers` is empty unless the date is picked and
 * results are visible. A poll with its own picture (src/images.js) shows its card instead of Venn's
 * images, at a versioned URL so chat apps fetch it again when it changes. A poll in the retro look
 * gets Venn's retro images.
 */
export function pollPreview(ev) {
  // A poll's own picture is its icon: then its emoji isn't shown as well.
  const title = [ev.image ? '' : ev.emoji, ev.title].filter(Boolean).join(' ');
  const own = ev.id && ev.image?.card && { path: imagePath(ev.id, ev.image, 'card'), alt: ev.title };
  if (ev.finalStart == null) {
    const who = !ev.hideNames && ev.organizer ? `${ev.organizer} wants to find a time for ${ev.title}.` : 'When works for you?';
    const slots = ev.options || ev.dates || ev.windows ? buildSlots(ev) : [];
    const ask = !slots.length
      ? 'Tap your answers.'
      : isOptionsPoll(ev)
        ? `${slots.length} ${slots.length === 1 ? 'choice' : 'choices'}, ${spanLabel(ev, slots)}. Tap the ones that work.`
        : `${spanLabel(ev, slots)}. Tap when you're free.`;
    return { title, description: `${who} ${ask} No sign-up.`, image: own || (ev.retro ? OG_IMAGES.retroVote : OG_IMAGES.vote) };
  }
  let description = `It's set: ${setLabel(ev, ev.finalStart)}`;
  const answers = ev.answers || [];
  if (!ev.hideResults && !ev.hideNames && answers.length) {
    const people = answers.map((availability) => ({ name: '', availability }));
    const best = rankTimes(ev, buildSlots(ev), people, Infinity).find((r) => r.start === ev.finalStart);
    const can = best ? best.yes.length + best.ifNeeded.length : 0;
    description += ` · ${can} of ${answers.length} can make it`;
  }
  return { title, description, image: own || (ev.retro ? OG_IMAGES.retroSet : OG_IMAGES.set) };
}

/** The <head> tags for a preview. Every value is escaped; `url` and image paths are made absolute against `origin`. */
export function previewTags({ title, description, image }, { origin, url, pageTitle = `${title} · Venn` }) {
  const meta = (attr, key, value) => `<meta ${attr}="${key}" content="${escAttr(value)}" />`;
  return [
    `<title>${escAttr(pageTitle)}</title>`,
    meta('name', 'description', description),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', 'Venn'),
    meta('property', 'og:url', url),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:image', origin + image.path),
    meta('property', 'og:image:width', '1200'),
    meta('property', 'og:image:height', '630'),
    meta('property', 'og:image:alt', image.alt),
    meta('name', 'twitter:card', 'summary_large_image'),
  ].join('\n    ');
}

/** Replace the shell's own <title> and description with `tags`. */
export function injectTags(html, tags) {
  return html.replace(/<meta\s+name="description"[^>]*>\s*/i, '').replace(/<title>[\s\S]*?<\/title>/i, () => tags);
}

/**
 * The home page (public/index.html) at /classic, the site in its classic look: the classic image
 * in its preview, and /classic as its address, so chat apps show the look it was shared in. The
 * page itself (at /) previews the retro look, the site's own.
 */
export function homePage(html, url) {
  return html
    .replace(/(<meta property="og:image" content=")[^"]*/, `$1${url.origin}${OG_IMAGES.vote.path}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${url.origin}/classic`);
}

/**
 * The app shell (public/app.html) to send for `pathname`: for a poll page, with that poll's
 * preview tags (or the generic ones for an unknown poll). One database read. Other app routes
 * get the shell as it is.
 */
export async function appShell(html, { pathname, origin, store }) {
  const m = POLL_PATH.exec(pathname);
  if (!m) return html;
  const url = `${origin}/e/${m[1]}`;
  let ev = null;
  try {
    ev = await store.getPreview(m[1]);
  } catch (e) {
    console.error(e); // a preview is never worth failing the page over
  }
  if (!ev) return injectTags(html, previewTags(GENERIC, { origin, url, pageTitle: GENERIC.pageTitle }));
  return injectTags(html, previewTags(pollPreview(ev), { origin, url }));
}
