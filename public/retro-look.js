// The retro look on the app's pages: a poll's (its organizer's choice), and the create page's preview
// of it. Loaded only when wanted, so other polls never fetch it.

/** The retro look (a poll's, or the create page's preview): html.retro, with retro-app.css, which only
 * those pages fetch. */
export function retroLook(on) {
  document.documentElement.classList.toggle('retro', !!on);
  if (on && !document.querySelector('link[href="/retro-app.css"]'))
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/retro-app.css' }));
}
/** Whether a new poll starts in the retro look: only when its link says ?retro=1. The website is
 * retro by default, so it doesn't decide a poll's look; the organizer does. */
export const wantsRetro = () => new URLSearchParams(location.search).get('retro') === '1';
