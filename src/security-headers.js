// Security headers for every response. public/_headers repeats them for Cloudflare's
// static asset serving; a test keeps the two in sync.

export const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    // Calendar free/busy lookups happen in the browser, straight to Google and Microsoft.
    "connect-src 'self' https://www.googleapis.com https://login.microsoftonline.com https://graph.microsoft.com; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  // Poll links are shared secrets of a sort: never leak them to sites people click through to.
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};
