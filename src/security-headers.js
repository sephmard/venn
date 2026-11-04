// Security headers for every response. public/_headers repeats them for Cloudflare's
// static asset serving; a test keeps the two in sync.

export const SECURITY_HEADERS = {
  'content-security-policy':
    // img-src blob: shows pictures drawn in the page (Finn stickers), so they can be pressed and held to copy.
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    // Calendar free/busy lookups happen in the browser, straight to Google and Microsoft.
    "connect-src 'self' https://www.googleapis.com https://login.microsoftonline.com https://graph.microsoft.com; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'",
  // Poll links are shared secrets of a sort: never leak them to sites people click through to.
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  // Only Venn frames Venn: the live preview on /brand shows a sample poll in a frame.
  'x-frame-options': 'SAMEORIGIN',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  // HTTPS only, for a year (#211). Browsers ignore it over plain http (local development, a
  // self-hosted server without HTTPS). Not includeSubDomains: other subdomains are set up
  // elsewhere, and one without HTTPS would stop working.
  'strict-transport-security': 'max-age=31536000',
};
