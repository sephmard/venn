// The site's phone menu (a <details>): it closes when you tap outside it, press Escape, or pick one of its links.
const menu = document.querySelector('details.menu');

if (menu) {
  // "Sign in" or "My polls" at the top of the menu, when the server has sign-in (account-menu.js).
  import('./account-menu.js').then((m) => m.accountMenu()).catch(() => {});
  document.addEventListener('click', (e) => {
    if (menu.open && (!menu.contains(e.target) || e.target.closest('.menu-panel a'))) menu.open = false;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !menu.open) return;
    menu.open = false;
    menu.querySelector('summary').focus();
  });
}
