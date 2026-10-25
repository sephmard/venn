// Paths the single-page app handles. Both servers send the app shell (public/app.html) for
// these; anything else that isn't a file in public/ gets the 404 page.

export const isAppRoute = (pathname) => /^\/(new(\/(pick|free))?|e\/[A-Za-z0-9]+)\/?$/.test(pathname);
