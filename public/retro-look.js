// The retro look on the app's pages: a poll's (its organizer's choice), and the create page's preview
// of it. Loaded only when wanted, so other polls never fetch it.

/** The retro look (a poll's, or the create page's preview): html.retro, with retro-app.css, which only
 * those pages fetch. */
export function retroLook(on) {
  document.documentElement.classList.toggle('retro', !!on);
  if (on && !document.querySelector('link[href="/retro-app.css"]'))
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/retro-app.css' }));
}
/** Whether a new poll starts in the retro look: the link says ?retro=1, or the website is in retro mode. */
export function wantsRetro() {
  if (new URLSearchParams(location.search).get('retro') === '1') return true;
  try {
    return localStorage.getItem('venn:retro') === '1';
  } catch {
    return false;
  }
}
