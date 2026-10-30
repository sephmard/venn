// The retro look on the app's pages: a poll's (its organizer's choice), and the create page's preview
// of it. Loaded only when wanted, so other polls never fetch it.

/** The retro look (a poll's, or the create page's preview): html.retro, with retro-app.css, which only
 * those pages fetch. */
export function retroLook(on) {
  document.documentElement.classList.toggle('retro', !!on);
  if (on && !document.querySelector('link[href="/retro-app.css"]'))
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/retro-app.css' }));
}
/** Whether a new poll starts in the retro look: yes, like the website, unless the link says
 * ?retro=0 or this browser chose the website's Classic mode. The organizer can switch it off. */
export function wantsRetro() {
  const asked = new URLSearchParams(location.search).get('retro');
  if (asked) return asked !== '0';
  try {
    return localStorage.getItem('venn:retro') !== '0';
  } catch {
    return true;
  }
}
