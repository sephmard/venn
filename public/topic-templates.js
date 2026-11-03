// Starters for a vote (/new/topic): the question, the kind of answer, an emoji and a hint for each
// option. Options are always the group's own, so a starter never fills one in, and it never
// replaces what someone typed (create-topic.js). /new/topic?template=<id> presses one; /templates
// lists them (scripts/build-pages.js). Words only: no dates, no votes, no names, nothing from a poll.
//   id        its name in links; never a date template's (public/templates.js)
//   question  what the question box starts with ('' leaves it empty, with `ask` as its hint)
//   hint      the hint in each option box
//   yesNo     answered Yes or No, with no options
//   card      the line under its name on /templates
//   then      "Find a date for it" (topic-poll.js): the date poll's name, {option} for what was decided
//   plan      ... and the date template it starts from (public/templates.js), for its length and time
// Their emoji count as plans in usage stats (src/usage.js PLANS).
export const TOPIC_TEMPLATES = [
  {
    id: 'where-to-eat',
    emoji: '🍜',
    label: 'Where to eat',
    question: 'Where should we eat?',
    hint: 'Place, e.g. Luigi’s',
    card: 'List a few places and settle it before anyone books a table.',
    then: 'Dinner at {option}',
    plan: 'dinner',
  },
  {
    id: 'what-to-do',
    emoji: '🎳',
    label: 'What to do',
    question: 'What should we do?',
    hint: 'Idea, e.g. bowling',
    card: 'Bowling or karaoke? Everyone ticks what they’d go for.',
  },
  {
    id: 'next-book',
    emoji: '📚',
    label: 'Next book',
    question: 'Which book should we read next?',
    hint: 'Book title',
    card: 'Everyone suggests, everyone votes, the club reads the winner.',
    then: 'Book club: {option}',
    plan: 'book-club',
  },
  {
    id: 'team-decision',
    emoji: '🗂️',
    label: 'Team decision',
    question: 'Which should we go with?',
    hint: 'Option',
    card: 'Lay out the options and see where the team lands.',
  },
  {
    id: 'where-to-go',
    emoji: '🧭',
    label: 'Trip destination',
    question: 'Where should we go?',
    hint: 'Place, e.g. Lisbon',
    card: 'Shortlist the places, then find a date for the winner.',
    then: 'Trip to {option}',
    plan: 'trip',
  },
  {
    id: 'yes-or-no',
    emoji: '👍',
    label: 'Yes or no',
    question: '',
    ask: 'Should we…?',
    yesNo: true,
    card: 'One question, a quick yes or no from everyone.',
  },
];

/** The starter a vote was made from, known by its emoji (each starter's is its own), or null. */
export const starterOf = (ev) => TOPIC_TEMPLATES.find((x) => x.emoji === ev?.emoji) || null;

/** The starter a link or a draft names, or null. */
export const topicTemplate = (name) => TOPIC_TEMPLATES.find((x) => x.id === String(name ?? '').toLowerCase()) || null;
