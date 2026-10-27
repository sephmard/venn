// The message the share sheet sends with a poll's link: who's asking, and that it's one tap.

export function inviteText({ organizer, title, emoji, pick, set }) {
  const what = [title, emoji].filter(Boolean).join(' ');
  if (set) return `It's set: ${what}! Add it to your calendar:`;
  const ask = pick ? 'Tap the dates that work' : 'Tap your free days';
  return `${organizer ? `${organizer} wants to find a time for ${what}.` : `When works for ${what}?`} ${ask} (no sign-up)`;
}
