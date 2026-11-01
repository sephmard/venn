// The retro look on the app's pages: html.retro, styled by retro-app.css (always loaded, see
// app.html). A poll's look is its organizer's choice; a new poll's starts like the website's.

/** Show the retro look, or the usual one. */
export const retroLook = (on) => document.documentElement.classList.toggle('retro', !!on);

/** Whether a new poll starts in the retro look: yes, like the website, unless the link says
 * ?retro=0 or this browser chose the website's Classic mode (app-look.js decides the same). */
export function wantsRetro() {
  const asked = new URLSearchParams(location.search).get('retro');
  if (asked) return asked !== '0';
  try {
    return localStorage.getItem('venn:retro') !== '0';
  } catch {
    return true;
  }
}
