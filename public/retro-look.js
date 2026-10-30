// The retro look on the app's pages: a poll's (its organizer's choice), and the create page's preview
// of it. Loaded only when wanted, so other polls never fetch it.

/** The retro look (a poll's, or the create page's preview): html.retro, with retro-app.css, which only
 * those pages fetch. The first time, the look switches once the stylesheet is in, never half-styled. */
let wanted = false;
export function retroLook(on) {
  wanted = !!on;
  let css = document.querySelector('link[href="/retro-app.css"]');
  if (wanted && !css) {
    css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/retro-app.css' });
    css.onload = css.onerror = () => ((css.dataset.ready = '1'), document.documentElement.classList.toggle('retro', wanted));
    document.head.append(css);
  }
  if (!wanted || css.dataset.ready) document.documentElement.classList.toggle('retro', wanted);
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
