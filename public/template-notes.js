// What a template fills in (see templates.js): seasonal ones suggest a name, a note for everyone
// and where. Loaded when a template is first chosen.

export const EXTRAS = {
  friendsgiving: {
    title: "Friendsgiving at Ana's",
    note: 'Potluck! Say what you’re bringing so we don’t end up with five pies.',
    where: 'Whose place? Add the address',
  },
  'holiday-party': {
    title: 'Holiday party',
    note: 'Festive sweaters encouraged, not required.',
    where: 'A home, a bar or a back room',
  },
  'secret-santa': {
    title: 'Secret Santa swap',
    note: 'We’ll draw names once we have a date. Gift budget: $25.',
    where: 'Where we swap gifts',
  },
  'new-year': {
    title: 'New Year’s get-together',
    note: 'Bring one resolution you’ll keep for at least a week.',
  },
};

/**
 * What choosing template `t` (or none) puts in the form: the placeholders, and the note, which only
 * goes in over an empty one or the note a template put there before (`noted`).
 */
export function prefill(t, desc, noted) {
  const extra = EXTRAS[t?.id];
  return {
    title: extra?.title || t?.label,
    where: extra?.where || 'A place, an address or a video link',
    desc: !desc.trim() || desc === noted ? extra?.note || '' : desc,
  };
}
