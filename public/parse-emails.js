// Turning a pasted list into emails, for invite-fields.js (and its tests, without a page).

import { isEmail } from './core.js';

/**
 * Emails pasted from anywhere (a spreadsheet column, a mail app's To line, a chat): separated by
 * commas, semicolons, spaces or new lines, with names and <brackets> around them. Returns the
 * addresses (lowercase, first time each), the bits with an @ that aren't emails, and how many repeats
 * were dropped. Words without an @ are names, and left out.
 */
export function parseEmails(text) {
  const emails = [];
  const invalid = [];
  let repeats = 0;
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const bit = raw.replace(/^mailto:/i, '').replace(/^[<("'[]+|[>)"'\].:]+$/g, '');
    if (!bit.includes('@')) continue;
    const email = bit.toLowerCase();
    if (!isEmail(email)) invalid.push(bit);
    else if (emails.includes(email)) repeats++;
    else emails.push(email);
  }
  return { emails, invalid, repeats };
}
