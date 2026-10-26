// What counts as a poll's emoji: one emoji (a single character as people see it, flags and
// families included), and nothing else. Checked in the browser as it's typed (poll-image.js) and
// again on the server (src/validate.js).

const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;

/** The characters as people see them (grapheme clusters). */
const graphemes = (s) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map((g) => g.segment);

/** True for one emoji: at most 16 UTF-16 code units, one grapheme, no letters, digits or markup. */
export function isEmoji(v) {
  return (
    typeof v === 'string' && v.length > 0 && v.length <= 16 && EMOJI_RE.test(v) && !/[0-9#*]/.test(v) && graphemes(v).length === 1
  );
}

/** The first emoji in what someone typed or pasted ("🎂 yay" → "🎂"), or '' if it doesn't start with one. */
export function firstEmoji(text) {
  const first = graphemes(String(text ?? '').trim())[0] || '';
  return isEmoji(first) ? first : '';
}
