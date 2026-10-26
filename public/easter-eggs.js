// A few little surprises on the create page, from Finn the dog (Finn from Venn). Loaded only once
// someone types a poll's name or taps the same template over and over (create.js). Each one shows
// once per visit: a message, read out politely by screen readers, and a quick burst of emoji with
// Finn peeking in, unless the device asks for less motion. Nothing here gets in the way.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The surprise for a poll's name typed so far, or for tapping template `value` again: { id, emoji, text } or null. */
export function eggFor(kind, value, now = new Date()) {
  if (kind === 'taps') return { id: 'taps', emoji: value.emoji, text: `Finn agrees: ${value.label}. Definitely ${value.label}.` };
  const name = String(value)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim();
  if (/^finns? (birthday|bday|party)$/.test(name))
    return { id: 'finn', emoji: '🎂', text: 'Finn says this is the most important poll ever made. Treats are not optional.' };
  if (name === 'taco tuesday') {
    const today = WEEKDAYS[now.getDay()];
    return {
      id: 'taco',
      emoji: '🌮',
      text: today === 'Tuesday' ? 'Taco Tuesday, on a Tuesday. Finn approves.' : `Taco Tuesday, on a ${today}? Finn won’t tell.`,
    };
  }
  if (name.includes('secret santa'))
    return { id: 'santa', emoji: '🤫', text: 'Shh. Finn knows who has whom, and Finn won’t tell.' };
  if (name === 'meeting about meetings')
    return { id: 'meeting', emoji: '📎', text: 'Finn moves that this meeting be an email. Finn is a dog, but still.' };
  return null;
}

const shown = new Set();

/** Show the surprise for what was typed or tapped, if there is one and it hasn't shown yet. */
export function react(toast, kind, value, now = new Date()) {
  const egg = eggFor(kind, value, now);
  if (!egg || shown.has(egg.id)) return null;
  shown.add(egg.id);
  toast(egg.text);
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return egg;
  // Decorative, and out of the way: it never takes a tap or focus, and it's gone in two seconds.
  const burst = document.createElement('div');
  burst.className = 'egg';
  burst.setAttribute('aria-hidden', 'true');
  burst.innerHTML = `<style>
    .egg { position: fixed; inset: 0; z-index: 50; pointer-events: none; overflow: hidden; }
    .egg i { position: absolute; bottom: -40px; font-size: 28px; font-style: normal; animation: egg-up 1.6s ease-out forwards; }
    .egg img { position: absolute; right: 12px; bottom: -90px; width: 84px; animation: egg-peek 1.9s ease-in-out forwards; }
    @keyframes egg-up { to { transform: translate(var(--x), -70vh) rotate(var(--r)); opacity: 0; } }
    @keyframes egg-peek { 25%, 75% { transform: translateY(-96px); } }
  </style><img src="/img/dog.webp" alt="">`;
  for (let i = 0; i < 14; i++) {
    const e = Object.assign(document.createElement('i'), { textContent: egg.emoji });
    e.style.cssText = `left:${5 + Math.random() * 90}%;--x:${Math.round(Math.random() * 80 - 40)}px;--r:${Math.round(Math.random() * 120 - 60)}deg;animation-delay:${Math.random() * 0.4}s`;
    burst.append(e);
  }
  document.body.append(burst);
  setTimeout(() => burst.remove(), 2200);
  return egg;
}
