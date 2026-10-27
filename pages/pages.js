// The website's landing pages: one per kind of plan people search for (/templates/book-club), and
// one per tool people compare Venn with (/alternatives/doodle). `npm run pages` writes them into
// public/ (scripts/build-pages.js), with the templates hub and the sitemap; `npm run og` draws their
// link-preview pictures. Add a page here, never by hand in public/.
//
// In headings, *words* are set in italics. Everything else is plain text.
//   slug         its address, and the `from` it sends to usage stats (src/usage.js)
//   template     the template its button opens (public/templates.js), on /new/<kind>
//   group        where it's listed on /templates: 'season' or 'everyday'
//   title        the browser tab and search result (about 60 characters at most)
//   description  under it in search results (about 155 at most)
//   share        [headline, line] for link previews
//   poll         the example on the page: its name, [date, how many can make it], and out of how many

export const ORIGIN = 'https://venn.day';

const FREE = ['Is Venn free?', 'Yes. Venn is free and open source, with no ads and no tracking.'];
const NO_ACCOUNT = [
  'Does everyone need an account?',
  'No. People open the link, type their name and tap their answers. Nobody signs up or installs anything.',
];

/** Pages for kinds of plan, under /templates/. */
export const TEMPLATE_PAGES = [
  {
    slug: 'friendsgiving',
    template: 'friendsgiving',
    kind: 'pick',
    group: 'season',
    name: 'Friendsgiving',
    card: 'Find the weekend around Thanksgiving that works for the whole crew.',
    title: 'Friendsgiving poll: find a date everyone can make · Venn',
    description:
      'Pick a Friendsgiving date your whole group can make. Suggest a few days around Thanksgiving, share one link, and see who can come. Free, no sign-up.',
    share: ['Find a Friendsgiving date *everyone can make.*', 'Suggest a few days. Share one link. Free, no sign-up.'],
    ogDescription: 'Suggest a few days around Thanksgiving, share one link, and see who can come. Free, no sign-up.',
    ogTitle: 'Find a Friendsgiving date everyone can make',
    h1: 'Find a Friendsgiving date *everyone can make.*',
    lede: 'Suggest a few days around Thanksgiving, send one link to the group chat, and watch the best day rise to the top. Free, no sign-up, nothing to install.',
    cta: 'Start a Friendsgiving poll',
    small: 'Opens with Friendsgiving filled in: an evening, four hours long, with a potluck note you can change.',
    poll: {
      name: "Friendsgiving at Ana's",
      of: 8,
      rows: [
        ['Sat, Nov 21', 8],
        ['Sun, Nov 22', 6],
        ['Fri, Nov 27', 5],
        ['Sat, Nov 28', 4],
      ],
    },
    how: {
      heading: 'How to pick a Friendsgiving date with friends',
      steps: [
        [
          'Start early.',
          'Send the poll three or four weeks ahead, before people book trips home. Late October or the first week of November is ideal.',
        ],
        [
          'Offer three to five dates.',
          'The weekend before Thanksgiving is the favorite. The Friday and Saturday after catch friends who stay in town, and a weeknight can work for people who live close.',
        ],
        [
          'Let people say "if needed".',
          'Everyone answers yes, if needed or no for each date, so you can see which day is a stretch and which is simply out.',
        ],
        [
          'Pick the date and lock it in.',
          'Once a day wins, pick it in Venn. Everyone can add it to Google, Apple or Outlook Calendar in a tap.',
        ],
      ],
    },
    tips: {
      heading: 'Tips for a smooth Friendsgiving',
      items: [
        ['Settle the host first', "The host's kitchen and calendar set the limits, so only offer dates that work for them."],
        [
          'Plan the potluck in the note',
          "The template adds a note asking everyone to say what they're bringing. Edit it to suit your crowd.",
        ],
        [
          'Mind the travelers',
          'Friends flying home for Thanksgiving are often away from the Wednesday to the Sunday of that week.',
        ],
        ['Keep it to one link', 'Share the poll in the group chat. Nobody signs up or installs anything.'],
      ],
    },
    timeline: {
      heading: 'A sample Friendsgiving timeline',
      items: [
        ['Four weeks before', 'Send the Venn poll with three to five dates.'],
        ['Three weeks before', 'Pick the date. Everyone adds it to their calendar.'],
        ['Two weeks before', 'Sort the menu: who brings the sides, the drinks and the pie.'],
        ['One week before', 'Check allergies, chairs and oven space.'],
        ['The day', 'Eat, talk, and argue about which pie was best.'],
      ],
    },
    faq: [
      [
        'When should Friendsgiving be?',
        'Most groups choose the weekend before Thanksgiving. In 2026, Thanksgiving is Thursday, November 26, so Saturday, November 21 and Sunday, November 22 are popular picks. The weekend after works too, for friends who stay in town.',
      ],
      [
        'How far ahead should I send the poll?',
        'Three to four weeks ahead gives everyone time to answer before travel plans are set.',
      ],
      [
        'Does everyone need an account?',
        'No. Friends open the link, type their name and tap their answers. Nobody signs up, and there are no ads.',
      ],
      FREE,
    ],
    related: ['holiday-party', 'secret-santa', 'dinner-party'],
  },
  {
    slug: 'holiday-party',
    template: 'holiday-party',
    kind: 'pick',
    group: 'season',
    name: 'Holiday party',
    card: 'Pick an evening before December fills up, for friends or the team.',
    title: 'Holiday party poll: pick a date before December fills up · Venn',
    description:
      'Find the December evening that works for your friends or team. Offer a few dates, share one link, and see the best night. Free, no sign-up.',
    share: ['Pick a holiday party date *before December fills up.*', 'Offer a few evenings. Share one link. Free, no sign-up.'],
    h1: 'Pick a holiday party date *before December fills up.*',
    lede: 'December weekends go fast. Offer a few evenings, share one link with your friends or team, and see which night works for the most people.',
    cta: 'Start a holiday party poll',
    small: 'Opens with a holiday party filled in: an evening, four hours long, with a note you can change.',
    poll: {
      name: 'Holiday party',
      of: 10,
      rows: [
        ['Fri, Dec 4', 7],
        ['Sat, Dec 5', 9],
        ['Fri, Dec 11', 10],
        ['Sat, Dec 12', 6],
      ],
    },
    how: {
      heading: 'How to choose a holiday party date',
      steps: [
        ['Send it by mid-November.', 'Calendars fill up quickly once December starts, so ask four to six weeks ahead.'],
        ['Offer weeknights too.', 'A Thursday can beat a packed Saturday, especially for a work party.'],
        [
          'Let people say "if needed".',
          'Yes, if needed or no for each evening shows which night is easy for most people, not just possible.',
        ],
        [
          'Pick the date and share it.',
          'Pick the winning night in Venn, and everyone can add it to their calendar from the poll.',
        ],
      ],
    },
    tips: {
      heading: 'Tips for a holiday party people actually come to',
      items: [
        [
          'Stay clear of the last week',
          'The week of Christmas is when people travel. Aim for the first two or three weekends of December.',
        ],
        ['Say what kind of party it is', 'Potluck, ugly sweaters, or just drinks? Put it in the note so nobody has to ask.'],
        ['Keep work polls low-pressure', 'Under Privacy options you can hide names from guests, so people answer honestly.'],
        ['Book the place after the date', 'Once you know the night and roughly how many can come, booking a room is easy.'],
      ],
    },
    timeline: {
      heading: 'A sample holiday party timeline',
      items: [
        ['Six weeks before', 'Send the Venn poll with three to five evenings.'],
        ['Five weeks before', 'Pick the date. Everyone adds it to their calendar.'],
        ['Four weeks before', 'Book the place, or confirm the host.'],
        ['One week before', 'Send a reminder, and sort food and drinks.'],
        ['The night', 'Celebrate the year with your people.'],
      ],
    },
    faq: [
      [
        'When is the best time for a holiday party?',
        'The first two weekends of December are the most popular, before people leave for the holidays. In 2026 that is Friday, December 4 to Saturday, December 12.',
      ],
      [
        'How far ahead should I plan?',
        'Send the poll four to six weeks ahead. By early December most weekends are already taken.',
      ],
      [
        'Can I use Venn for a work holiday party?',
        "Yes. You can hide names or everyone's answers from guests, and ask for emails, under Privacy options when you create the poll.",
      ],
      FREE,
    ],
    related: ['friendsgiving', 'secret-santa', 'team-offsite'],
  },
  {
    slug: 'secret-santa',
    template: 'secret-santa',
    kind: 'pick',
    group: 'season',
    name: 'Secret Santa',
    card: 'Find the night everyone can be there to swap gifts.',
    title: 'Secret Santa poll: find a date for your gift swap · Venn',
    description:
      'Find the night everyone can make for your Secret Santa swap. Offer a few evenings, share one link, then draw names. Free, no sign-up.',
    share: ['Find a date for your *Secret Santa* swap.', 'Offer a few evenings. Share one link. Free, no sign-up.'],
    h1: 'Find a date for your *Secret Santa* swap.',
    lede: 'Before anyone draws a name, find the night everyone can be there to swap gifts. Share one link, and Venn shows where everyone overlaps.',
    cta: 'Start a Secret Santa poll',
    small: 'Opens with Secret Santa filled in, plus a note about drawing names and the gift budget.',
    poll: {
      name: 'Secret Santa swap',
      of: 6,
      rows: [
        ['Thu, Dec 10', 5],
        ['Fri, Dec 11', 6],
        ['Sat, Dec 19', 4],
      ],
    },
    how: {
      heading: 'How to organize a Secret Santa',
      steps: [
        ['Find the date first.', 'Everyone needs to be at the swap, so settle the night before drawing names.'],
        ['Offer a few evenings.', 'Early to mid December works best, before people travel.'],
        ['Set the budget in the note.', 'The template suggests one. Change it, and add a theme if you like.'],
        [
          'Pick the date, then draw names.',
          "Venn finds the date; it doesn't draw names. Pull them from a hat, or use any name-drawing app.",
        ],
      ],
    },
    tips: {
      heading: 'Tips for a Secret Santa that goes well',
      items: [
        ['Agree on a budget', 'Twenty to thirty dollars is common among friends. Saying it up front avoids awkward moments.'],
        ['Share wish lists', 'A few ideas each makes shopping easier and gifts better.'],
        ['Pick a theme, maybe', 'Books, something handmade, or under ten dollars: a theme makes it more fun.'],
        ['Keep it a secret', "Only the gift giver should know. Finn won't tell."],
      ],
    },
    timeline: {
      heading: 'A sample Secret Santa timeline',
      items: [
        ['Four weeks before', 'Send the Venn poll with a few evenings.'],
        ['Three weeks before', 'Pick the date, then draw names.'],
        ['Two weeks before', 'Share wish lists and the budget.'],
        ['One week before', 'Wrap the gifts and send a reminder.'],
        ['Swap night', 'Open the gifts and guess who gave what.'],
      ],
    },
    faq: [
      [
        'How do I organize a Secret Santa?',
        'Find a date everyone can make, set a budget, draw names, and swap gifts on the night. Venn helps with the first step: one link, and everyone marks the dates that work.',
      ],
      [
        'Does Venn draw the names?',
        'No. Venn finds the date. Draw names from a hat, or with any name-drawing app, once the date is set.',
      ],
      [
        'What is a good Secret Santa budget?',
        "Twenty to thirty dollars is common among friends. Put it in the poll's note so everyone sees it.",
      ],
      FREE,
    ],
    related: ['friendsgiving', 'holiday-party', 'game-night'],
  },
  {
    slug: 'book-club',
    template: 'book-club',
    kind: 'pick',
    group: 'everyday',
    name: 'Book club',
    card: 'Find the evening everyone has finished the book, every month.',
    title: 'Book club scheduler: find a date everyone can make · Venn',
    description:
      'Schedule your next book club meeting in one link. Suggest a few evenings, everyone taps what works, and Venn shows the best night. Free, no sign-up.',
    share: ['Find a book club night *everyone can make.*', 'Suggest a few evenings. Share one link. Free, no sign-up.'],
    h1: 'Find a book club night *everyone can make.*',
    lede: 'Suggest a few evenings, drop one link in the group chat, and see which night works for the most readers. No accounts, no back-and-forth.',
    cta: 'Start a book club poll',
    small: 'Opens with a book club filled in: an evening, two hours long. Add the book in the note.',
    poll: {
      name: 'Book club: November pick',
      of: 7,
      rows: [
        ['Tue, Nov 17', 5],
        ['Wed, Nov 18', 7],
        ['Thu, Nov 19', 6],
      ],
    },
    how: {
      heading: 'How to schedule a book club meeting',
      steps: [
        ['Pick the book first.', 'Give people three to five weeks to read it, then ask about dates near the end of that.'],
        ['Offer three or four evenings.', 'The same weekday each month is easy to remember; offer a couple of others as backup.'],
        [
          'Let people say "if needed".',
          'Someone who can make it but would rather not is different from someone who can’t. Venn shows both.',
        ],
        ['Pick the night.', 'Everyone adds it to their calendar from the poll, and nobody has to scroll back through the chat.'],
      ],
    },
    tips: {
      heading: 'Tips for a book club that keeps meeting',
      items: [
        ['Put the book in the note', 'The title, the chapters to read, and whose turn it is to host.'],
        ['Plan the next one at the end', 'Send the next poll the week after you meet, while everyone is keen.'],
        ['Mix up hosting', 'Add the address in “Where”, or a video link for members who join from afar.'],
        ['Copy last month’s poll', 'Duplicate your poll from its organizer tools, change the dates, and share again.'],
      ],
    },
    faq: [
      ['How often should a book club meet?', 'Most meet once a month, which leaves time to read a book of about 300 pages.'],
      [
        'Can members join by video?',
        'Yes. Put a video link in “Where” and everyone sees it on the poll, and in their calendar once the date is picked.',
      ],
      NO_ACCOUNT,
      FREE,
    ],
    related: ['dinner-party', 'study-group', 'game-night'],
  },
  {
    slug: 'game-night',
    template: 'game-night',
    kind: 'pick',
    group: 'everyday',
    name: 'Board game night',
    card: 'Get the whole table together for a long evening of games.',
    title: 'Game night scheduler: get everyone at the table · Venn',
    description:
      'Plan your next board game night without the group chat chaos. Suggest a few evenings, share one link, see who can play. Free, no sign-up.',
    share: ['Get everyone *at the table* for game night.', 'Suggest a few evenings. Share one link. Free, no sign-up.'],
    h1: 'Get everyone *at the table* for game night.',
    lede: 'Some games need four players, some need six. Suggest a few evenings, share one link, and see which night fills the table.',
    cta: 'Start a game night poll',
    small: 'Opens with game night filled in: an evening, three hours long.',
    poll: {
      name: 'Game night',
      of: 6,
      rows: [
        ['Fri, Nov 13', 4],
        ['Sat, Nov 14', 6],
        ['Fri, Nov 20', 5],
      ],
    },
    how: {
      heading: 'How to plan a board game night',
      steps: [
        ['Know your player count.', 'Pick the game, then you know how many people you need for the night to work.'],
        ['Offer a few evenings.', 'Fridays and Saturdays are favorites; a weeknight works for shorter games.'],
        ['See who can come.', 'Venn shows how many people can make each night, so you know which one fills the table.'],
        ['Pick the night.', 'Everyone adds it to their calendar in a tap.'],
      ],
    },
    tips: {
      heading: 'Tips for a great game night',
      items: [
        ['Say what you’ll play', 'Put the game in the note, so people can learn the rules or bring their copy.'],
        ['Allow for long games', 'Three hours is a good default; make it longer for a campaign or a heavy game.'],
        ['Sort snacks in the note', 'Who brings drinks, who brings chips, and whose table it is.'],
        ['Make it a regular thing', 'Duplicate the poll each month from its organizer tools.'],
      ],
    },
    faq: [
      [
        'How many people do I need for game night?',
        'Most party and strategy games play best with four to six. Venn shows how many can make each night.',
      ],
      ['Can I use Venn for a regular game night?', 'Yes. Duplicate last time’s poll, change the dates, and share the new link.'],
      NO_ACCOUNT,
      FREE,
    ],
    related: ['dnd', 'dinner-party', 'book-club'],
  },
  {
    slug: 'dnd',
    template: 'dnd',
    kind: 'pick',
    group: 'everyday',
    name: 'D&D session',
    card: 'Find the next session your whole party can make, without the scheduling boss fight.',
    title: 'D&D session scheduler: find a night the whole party can play · Venn',
    description:
      'Schedule your next D&D or tabletop RPG session in one link. Offer a few evenings, players tap what works, and the GM sees the best night. Free.',
    share: ['Find a night the *whole party* can play.', 'D&D scheduling in one link. Free, no sign-up.'],
    h1: 'Find a night the *whole party* can play.',
    lede: 'Scheduling is the hardest encounter in any campaign. Offer a few evenings, share one link in your Discord, and see when every player is free.',
    cta: 'Start a session poll',
    small: 'Opens with a D&D session filled in: an evening, four hours long, with a note for character sheets and dice.',
    poll: {
      name: 'D&D: session 12',
      of: 5,
      rows: [
        ['Fri, Nov 13', 4],
        ['Sun, Nov 15', 5],
        ['Wed, Nov 18', 3],
      ],
    },
    how: {
      heading: 'How to schedule a D&D session',
      steps: [
        ['Offer the GM’s free nights.', 'The game can’t run without the GM, so only suggest evenings that work for them.'],
        ['Share one link in your Discord.', 'Players tap the nights they can make. Nobody signs up.'],
        [
          'Look for a full table.',
          'Venn shows how many players can make each night, and who said "if needed", so you can tell a sure thing from a maybe.',
        ],
        ['Pick the session.', 'Everyone adds it to their calendar, with your video link or address in it.'],
      ],
    },
    tips: {
      heading: 'Tips for keeping a campaign on schedule',
      items: [
        ['Plan the next one at the table', 'Send the next poll right after a session, while everyone is still there.'],
        ['Set a quorum', 'Decide how many players you need to run; Venn shows when you have them.'],
        ['Mind the time zones', 'Online groups across time zones each see the times in their own zone.'],
        ['Repeat what works', 'Duplicate the last poll from its organizer tools and change the dates.'],
      ],
    },
    faq: [
      [
        'Does it work for online groups?',
        'Yes. Put your VTT or video link in “Where”. Everyone sees the times in their own time zone.',
      ],
      ['Can players answer "if needed"?', 'Yes. Each player answers yes, if needed or no for every night you offer.'],
      ['Can I post it to Discord?', 'Yes. Share the poll’s link in your server; it shows a preview with the poll’s name.'],
      FREE,
    ],
    related: ['game-night', 'band-practice', 'study-group'],
  },
  {
    slug: 'dinner-party',
    template: 'dinner',
    kind: 'pick',
    group: 'everyday',
    name: 'Dinner party',
    card: 'Find the evening your friends can all make it to dinner.',
    title: 'Dinner party planner: find a night everyone can come · Venn',
    description:
      'Find the evening all your friends can make dinner. Suggest a few nights, share one link, and see the best one at a glance. Free, no sign-up.',
    share: ['Find the night everyone can *come to dinner.*', 'Suggest a few evenings. Share one link. Free, no sign-up.'],
    h1: 'Find the night everyone can *come to dinner.*',
    lede: 'Suggest a few evenings, share one link, and stop scrolling back through the group chat to count who said yes.',
    cta: 'Start a dinner poll',
    small: 'Opens with dinner filled in: an evening, two hours long.',
    poll: {
      name: "Dinner at Finn's",
      of: 6,
      rows: [
        ['Thu, Nov 12', 4],
        ['Fri, Nov 13', 6],
        ['Sat, Nov 14', 5],
      ],
    },
    how: {
      heading: 'How to find a date for dinner with friends',
      steps: [
        ['Offer three or four evenings.', 'Enough to find one that works, few enough that everyone answers quickly.'],
        ['Share one link.', 'In the group chat or by email. Friends tap yes, if needed or no for each evening.'],
        ['See the best night.', 'Venn puts the evening that works for the most people at the top.'],
        ['Pick it and add it to calendars.', 'Book the table once you know the night and how many are coming.'],
      ],
    },
    tips: {
      heading: 'Tips for a dinner everyone shows up to',
      items: [
        ['Book after the date', 'Once you know the night and the head count, booking a table is easy.'],
        ['Say who’s cooking', 'Potluck, restaurant or your place? Put it in the note.'],
        ['Hide answers if you like', 'Under Privacy options, only you see who said what.'],
        ['Mind dietary needs', 'Ask in the note, so nobody has to bring it up.'],
      ],
    },
    faq: [
      ['How many dates should I offer?', 'Three or four evenings in the next two or three weeks works well.'],
      ['Can I see who can come, not just how many?', 'Yes. Tap a date to see who said yes or if needed.'],
      NO_ACCOUNT,
      FREE,
    ],
    related: ['book-club', 'game-night', 'friendsgiving'],
  },
  {
    slug: 'band-practice',
    template: 'band-practice',
    kind: 'pick',
    group: 'everyday',
    name: 'Band practice',
    card: 'Find a rehearsal slot when every member can make it.',
    title: 'Band practice scheduler: find a rehearsal time that works · Venn',
    description:
      'Schedule band rehearsals in one link. Suggest a few times, every member taps what works, and Venn shows when the whole band is free. Free.',
    share: ['Find a rehearsal time *the whole band* can make.', 'Suggest a few times. Share one link. Free, no sign-up.'],
    h1: 'Find a rehearsal time *the whole band* can make.',
    lede: 'A rehearsal without the drummer is just a jam. Suggest a few times, share one link, and see when every member is free.',
    cta: 'Start a rehearsal poll',
    small: 'Opens with band practice filled in: an evening, two hours long.',
    poll: {
      name: 'Band practice',
      of: 4,
      rows: [
        ['Mon, Nov 9', 3],
        ['Wed, Nov 11', 4],
        ['Sat, Nov 14', 3],
      ],
    },
    how: {
      heading: 'How to schedule band practice',
      steps: [
        ['Check the room first.', 'Offer only the times your rehearsal space is free.'],
        ['Share one link.', 'Every member taps the times they can make.'],
        ['Look for a full band.', 'Venn shows how many can make each slot, and who said "if needed".'],
        ['Pick the slot.', 'Everyone adds it to their calendar, with the room’s address in it.'],
      ],
    },
    tips: {
      heading: 'Tips for rehearsals that happen',
      items: [
        ['Put the set list in the note', 'Everyone knows what to practice before they arrive.'],
        ['Book a regular slot', 'Once a time works a few weeks running, keep it.'],
        ['Plan around gigs', 'Offer extra rehearsals in the two weeks before a show.'],
        ['Duplicate each week', 'Copy last week’s poll from its organizer tools and change the dates.'],
      ],
    },
    faq: [
      ['Can I offer exact times?', 'Yes. Draw each time on the week, or offer whole evenings.'],
      ['Does everyone need an account?', 'No. Band members open the link, type their name and tap their answers.'],
      ['Can I see who can’t make it?', 'Yes. Tap a time to see everyone’s answer.'],
      FREE,
    ],
    related: ['dnd', 'study-group', 'game-night'],
  },
  {
    slug: 'study-group',
    template: 'study-group',
    kind: 'pick',
    group: 'everyday',
    name: 'Study group',
    card: 'Find a time the whole group can study, before the exam.',
    title: 'Study group scheduler: find a time before the exam · Venn',
    description:
      'Find a study session time that works for your whole group. Suggest a few times, share one link, see the best one. Free, no sign-up, no ads.',
    share: ['Find a study time that works *before the exam.*', 'Suggest a few times. Share one link. Free, no sign-up.'],
    h1: 'Find a study time that works *before the exam.*',
    lede: 'Everyone has different classes and shifts. Suggest a few times, share one link, and see when the most people can study together.',
    cta: 'Start a study group poll',
    small: 'Opens with a study group filled in: two hours in the afternoon, with a note for what to cover.',
    poll: {
      name: 'Study group: midterm',
      of: 5,
      rows: [
        ['Mon, Nov 9', 3],
        ['Tue, Nov 10', 5],
        ['Thu, Nov 12', 4],
      ],
    },
    how: {
      heading: 'How to schedule a study group',
      steps: [
        ['Work back from the exam.', 'Offer a few times in the week or two before it.'],
        ['Share one link.', 'In the class chat or by email. Nobody needs an account.'],
        ['See the best time.', 'Venn puts the time that works for the most people at the top.'],
        ['Pick it.', 'Everyone adds it to their calendar, with the room or video link in it.'],
      ],
    },
    tips: {
      heading: 'Tips for study sessions that help',
      items: [
        ['Say what you’ll cover', 'Put the chapters or problem sets in the note.'],
        ['Book the room after', 'Once you know the time and the head count, book a library room.'],
        ['Meet online if you need to', 'Add a video link in “Where” for anyone studying from home.'],
        ['Plan two sessions', 'One early to cover the material, one just before the exam to review.'],
      ],
    },
    faq: [
      ['Is it free for students?', 'Venn is free for everyone, with no ads and no tracking.'],
      ['Do classmates need an account?', 'No. They open the link, type their name and tap their answers.'],
      ['Can we meet online?', 'Yes. Put a video link in “Where”.'],
      ['What about different time zones?', 'Everyone sees the times in their own time zone.'],
    ],
    related: ['book-club', 'band-practice', 'dnd'],
  },
  {
    slug: 'group-trip',
    template: 'trip',
    kind: 'free',
    group: 'everyday',
    name: 'Group trip',
    card: 'Find the days in a row when everyone can get away.',
    title: 'Group trip planner: find dates everyone can travel · Venn',
    description:
      'Find trip dates that work for the whole group. Pick a range of days, everyone marks when they’re free, and Venn finds the days in a row that work. Free.',
    share: ['Find trip dates *everyone can make.*', 'Everyone marks their free days. Venn finds the overlap.'],
    h1: 'Find trip dates *everyone can make.*',
    lede: 'Pick a range of days, share one link, and everyone marks the days they’re free. Venn finds the days in a row that work for the most people.',
    cta: 'Start a trip poll',
    small: 'Opens “ask when people are available” with a trip filled in: three days in a row. Change it to suit.',
    poll: {
      name: 'Lisbon trip',
      of: 6,
      rows: [
        ['Jun 4 – 6', 4],
        ['Jun 11 – 13', 6],
        ['Jun 18 – 20', 5],
      ],
    },
    how: {
      heading: 'How to pick dates for a group trip',
      steps: [
        ['Pick the window.', 'A month or two when the trip could happen. Venn handles the rest.'],
        ['Say how many days.', 'Three days in a row for a long weekend, a week for something bigger.'],
        ['Everyone marks their free days.', 'They tap whole days, or "if needed" for days they could swap.'],
        ['See the dates that work.', 'Venn finds the days in a row the most people can make. Book once it’s picked.'],
      ],
    },
    tips: {
      heading: 'Tips for planning a trip with friends',
      items: [
        ['Ask early', 'Flights and rooms are cheaper two to three months ahead.'],
        ['Settle dates before places', 'Once you know when, choosing where gets much easier.'],
        ['Use "if needed"', 'People can mark days they could take off but would rather not.'],
        ['Share costs after', 'Put a rough budget in the note so nobody is surprised.'],
      ],
    },
    faq: [
      [
        'How does Venn find trip dates?',
        'You pick a range of days and how many in a row you need. Everyone marks their free days, and Venn finds the runs of days that work for the most people.',
      ],
      ['Can people say "if needed"?', 'Yes. Each day can be available, if needed or unavailable.'],
      NO_ACCOUNT,
      FREE,
    ],
    related: ['bachelor-party', 'family-reunion', 'team-offsite'],
  },
  {
    slug: 'family-reunion',
    template: 'family-reunion',
    kind: 'free',
    group: 'everyday',
    name: 'Family reunion',
    card: 'Find the day the whole family can get together, from every branch.',
    title: 'Family reunion planner: find a date the whole family can make · Venn',
    description:
      'Find a family reunion date that works for every branch of the family. Pick a range of days, share one link, see the best day. Free, no sign-up.',
    share: ['Find a day *the whole family* can make.', 'Pick a range of days. Share one link. Free, no sign-up.'],
    h1: 'Find a day *the whole family* can make.',
    lede: 'Grandparents, cousins and in-laws all have their own calendars. Pick a range of days, share one link, and see the day that works for the most people.',
    cta: 'Start a family reunion poll',
    small: 'Opens “ask when people are available” for whole days, with a family reunion filled in.',
    poll: {
      name: 'Family reunion',
      of: 14,
      rows: [
        ['Sat, Jul 11', 11],
        ['Sat, Jul 18', 14],
        ['Sun, Jul 19', 12],
      ],
    },
    how: {
      heading: 'How to plan a family reunion date',
      steps: [
        ['Ask months ahead.', 'Three to six months gives far-away relatives time to plan travel.'],
        ['Pick a range of days.', 'A few weekends in the summer, say. Everyone marks the days they can make.'],
        ['Share one link with everyone.', 'Text it, email it, or post it in the family chat. Nobody needs an account.'],
        ['Pick the day.', 'Venn shows the day the most people can make. Everyone adds it to their calendar.'],
      ],
    },
    tips: {
      heading: 'Tips for a reunion the whole family can make',
      items: [
        ['Start with the elders', 'Check the dates that work for the people everyone wants to see.'],
        ['Help less techy relatives', 'There’s nothing to install: they open the link in any browser and tap.'],
        ['Settle the place after', 'Once you know the date and head count, choose the house, park or venue.'],
        ['Plan food in the note', 'Who brings what, and any allergies to know about.'],
      ],
    },
    faq: [
      ['How far ahead should we plan a family reunion?', 'Three to six months, or more if people need to fly.'],
      ['Do relatives need an app?', 'No. They open the link in any browser, type their name and tap the days they can make.'],
      ['Can we plan a whole weekend?', 'Yes. Choose how many days in a row you need, and Venn finds the runs that work.'],
      FREE,
    ],
    related: ['group-trip', 'dinner-party', 'friendsgiving'],
  },
  {
    slug: 'bachelor-party',
    template: 'bachelor-party',
    kind: 'free',
    group: 'everyday',
    name: 'Bachelor & bachelorette weekend',
    card: 'Find the weekend the whole crew can get away before the wedding.',
    title: 'Bachelor & bachelorette party planner: pick the weekend · Venn',
    description:
      'Find the bachelor or bachelorette weekend everyone can make. Pick a range of days, share one link, and Venn finds the weekend that works. Free.',
    share: ['Find the weekend *the whole crew* can make.', 'Bachelor and bachelorette dates in one link. Free.'],
    h1: 'Find the weekend *the whole crew* can make.',
    lede: 'Pick a few months before the wedding, share one link, and everyone marks the days they’re free. Venn finds the weekend that works for the most people.',
    cta: 'Start a weekend poll',
    small: 'Opens “ask when people are available” with three days in a row filled in.',
    poll: {
      name: "Sam's bachelor weekend",
      of: 8,
      rows: [
        ['Apr 9 – 11', 6],
        ['Apr 16 – 18', 8],
        ['Apr 23 – 25', 7],
      ],
    },
    how: {
      heading: 'How to pick the date for a bachelor or bachelorette party',
      steps: [
        ['Check with the guest of honor.', 'Only offer weekends they can make, and that aren’t too close to the wedding.'],
        ['Pick a range and a length.', 'A few months, and three days in a row for a weekend away.'],
        ['Share one link.', 'Everyone marks their free days, or "if needed" for days they could move.'],
        ['Pick the weekend, then book.', 'Venn finds the weekend the most people can make.'],
      ],
    },
    tips: {
      heading: 'Tips from people who’ve planned one',
      items: [
        ['Ask four to six months ahead', 'Weekends away need time for flights and leave.'],
        ['Keep it a surprise if you like', 'Hide everyone’s answers under Privacy options.'],
        ['Mention the budget early', 'A rough cost in the note helps people say yes honestly.'],
        ['Collect emails', 'Ask everyone for their email, so you can send the plan later.'],
      ],
    },
    faq: [
      [
        'When should a bachelor or bachelorette party be?',
        'Usually one to three months before the wedding, on a weekend the guest of honor can make.',
      ],
      ['Can I keep the plans from the guest of honor?', 'Yes. Only people with the link see the poll, and you can hide answers.'],
      NO_ACCOUNT,
      FREE,
    ],
    related: ['group-trip', 'holiday-party', 'dinner-party'],
  },
  {
    slug: 'team-offsite',
    template: 'team-offsite',
    kind: 'free',
    group: 'everyday',
    name: 'Team offsite',
    card: 'Find two days the whole team can travel and be in one room.',
    title: 'Team offsite planner: find days the whole team can make · Venn',
    description:
      'Find offsite dates that work for your whole team. Pick a range of days, share one link, and Venn finds the days in a row that work. Free, no sign-up.',
    share: ['Find offsite days *the whole team* can make.', 'Pick a range of days. Share one link. Free.'],
    h1: 'Find offsite days *the whole team* can make.',
    lede: 'Pick a range of weeks, share one link, and everyone marks the days they can travel. Venn finds the days in a row that work for the most people.',
    cta: 'Start an offsite poll',
    small: 'Opens “ask when people are available” with two days in a row filled in.',
    poll: {
      name: 'Q1 offsite',
      of: 12,
      rows: [
        ['Feb 3 – 4', 10],
        ['Feb 10 – 11', 12],
        ['Feb 17 – 18', 9],
      ],
    },
    how: {
      heading: 'How to schedule a team offsite',
      steps: [
        ['Pick a window.', 'A few weeks, clear of launches and holidays.'],
        ['Say how many days.', 'Two days in a row is common; Venn finds the runs that work.'],
        ['Share one link with the team.', 'In Slack, Teams or email. Nobody needs an account.'],
        ['Pick the days and book.', 'Venn shows the dates the most people can make. Book the venue once they’re set.'],
      ],
    },
    tips: {
      heading: 'Tips for an offsite everyone can attend',
      items: [
        ['Ask six to eight weeks ahead', 'Enough time for travel, childcare and covering work.'],
        ['Let people answer privately', 'Under Privacy options, hide names so people answer honestly.'],
        ['Get updates in Slack', 'Add a webhook to post each answer to a channel.'],
        ['Mind time zones', 'Remote teammates see the days in their own time zone.'],
      ],
    },
    faq: [
      [
        'Is Venn free for work?',
        'Yes. Venn is free and open source, with no ads and no tracking. You can also host it yourself.',
      ],
      [
        'Can it post to Slack or Teams?',
        'Yes. Add a webhook from the poll’s Notifications panel to get each answer in a channel.',
      ],
      ['Can I hide who answered what?', 'Yes. Hide names, or everyone’s answers, from guests under Privacy options.'],
      NO_ACCOUNT,
    ],
    related: ['holiday-party', 'group-trip', 'study-group'],
  },
];

/** Comparisons, under /alternatives/. What they say about other tools was checked in October 2026. */
export const ALTERNATIVE_PAGES = [
  {
    slug: 'doodle',
    name: 'Doodle',
    card: 'A free Doodle alternative with no ads and no accounts.',
    title: 'Free Doodle alternative: group polls with no ads or sign-up · Venn',
    description:
      'Looking for a Doodle alternative? Venn is a free, open-source group poll: suggest dates, share one link, see the best one. No ads, no accounts.',
    share: ['A Doodle alternative with *no ads.*', 'Free, open source, no sign-up.'],
    h1: 'A Doodle alternative with *no ads and no accounts.*',
    lede: 'Venn does the one thing groups use a scheduling poll for: suggest some dates, share one link, and see which one works. Free and open source.',
    rows: [
      ['Free', 'Yes, everything', 'Free plan, with paid plans'],
      ['Ads', 'None', 'On the free plan'],
      ['Guests need an account', 'No', 'No'],
      ['"If needed" answers', 'Yes', 'Yes'],
      ['Ask when people are free (days, parts of the day, hours)', 'Yes', 'Group polls with set times'],
      ['Open source, and you can host it yourself', 'Yes', 'No'],
      ['Booking pages for one-to-one meetings', 'No', 'Yes'],
    ],
    them: [
      'Doodle is the better choice for booking pages, where clients pick a slot from your calendar, and for teams already paying for it.',
    ],
    us: [
      'Venn is the better choice for getting a group of friends, a club or a team to agree on a date, with nothing to sign up for and nothing in the way.',
    ],
    faq: [
      ['Is Venn really free?', 'Yes. Every feature is free. There are no ads and no paid plan.'],
      ['Do people need an account to answer?', 'No. Nobody does: not the organizer, not the guests.'],
      [
        'Can I move my polls from Doodle?',
        'There’s no import, but making a poll takes about a minute: suggest the same dates and share the new link.',
      ],
      ['Is my data private?', 'Venn stores only what people type into a poll, and has no ads or third-party trackers.'],
    ],
    related: ['when2meet', 'calendly'],
  },
  {
    slug: 'when2meet',
    name: 'When2meet',
    card: 'Paint when you’re free like When2meet, plus "if needed", on any phone.',
    title: 'When2meet alternative: find a time on any phone, with "if needed" · Venn',
    description:
      'A When2meet alternative that works on phones and lets people say "if needed". Free, open source, no ads, no sign-up. Find a time that works.',
    share: ['A When2meet alternative *made for phones.*', 'Paint when you’re free, with "if needed". Free.'],
    h1: 'A When2meet alternative *made for phones.*',
    lede: 'Like When2meet, people mark when they’re free and Venn finds the overlap. Unlike it, there’s an "if needed" answer, and it’s built for the phone in your pocket.',
    rows: [
      ['Free, no account for anyone', 'Yes', 'Yes'],
      ['Ads', 'None', 'Yes'],
      ['Mark the hours you’re free', 'Yes', 'Yes'],
      ['"If needed" answers', 'Yes', 'No'],
      ['Answer with whole days, or mornings, afternoons and evenings', 'Yes', 'No'],
      ['Pick the date, and add it to calendars', 'Yes', 'No'],
      ['Open source', 'Yes', 'No'],
    ],
    them: ['When2meet is the better choice if your group already knows it and everyone answers from a laptop.'],
    us: [
      'Venn is the better choice when people answer from their phones, when "maybe" matters, or when you’re finding a day rather than an hour.',
    ],
    faq: [
      [
        'How is Venn different from When2meet?',
        'Both let people mark when they’re free. Venn adds "if needed" answers, whole-day and part-of-the-day polls, a picked date with calendar links, and a layout made for phones.',
      ],
      ['Is Venn free?', 'Yes, with no ads and no paid plan.'],
      NO_ACCOUNT,
      ['Does it handle time zones?', 'Yes. Everyone sees times in their own time zone.'],
    ],
    related: ['doodle', 'calendly'],
  },
  {
    slug: 'calendly',
    name: 'Calendly',
    card: 'For finding a time with a whole group, not booking one-on-one meetings.',
    title: 'Calendly for groups? Find a date for everyone, free · Venn',
    description:
      'Calendly books one-on-one meetings. To find a date that works for a whole group, use Venn: suggest dates, share one link, see the best one. Free.',
    share: ['Calendly books meetings. *Venn finds a date* for groups.', 'Free, open source, no sign-up.'],
    h1: 'Calendly books meetings. *Venn finds a date* for a group.',
    lede: 'Calendly is great when people book a slot on your calendar. When a whole group needs to agree on one date, a group poll does the job, and Venn is free.',
    rows: [
      ['Made for', 'A group agreeing on a date', 'People booking time with you'],
      ['Free', 'Yes, everything', 'Free plan, with paid plans'],
      ['Account needed', 'No one', 'The person whose calendar it is'],
      ['Everyone answers every option', 'Yes', 'No: each person books a slot'],
      ['"If needed" answers', 'Yes', 'No'],
      ['Open source', 'Yes', 'No'],
    ],
    them: [
      'Calendly is the better choice for sales calls, interviews and office hours: one person shares their availability and others book a slot.',
    ],
    us: ['Venn is the better choice when the whole group has to be there: a dinner, an offsite, a trip, a club.'],
    faq: [
      [
        'Can Calendly find a time for a group?',
        'Calendly is built for booking slots on someone’s calendar. To find one date a whole group can make, use a group poll like Venn.',
      ],
      ['Is Venn free?', 'Yes, every feature, with no ads.'],
      NO_ACCOUNT,
      [
        'Can I use Venn at work?',
        'Yes. You can hide names or answers, collect emails, and post answers to Slack with a webhook.',
      ],
    ],
    related: ['doodle', 'when2meet'],
  },
];

/** Every page, with where it lives: { …page, path, section }. */
export const PAGES = [
  ...TEMPLATE_PAGES.map((p) => ({ ...p, section: 'templates', path: `/templates/${p.slug}` })),
  ...ALTERNATIVE_PAGES.map((p) => ({ ...p, section: 'alternatives', path: `/alternatives/${p.slug}` })),
];

/** The `from` a page's buttons send, for usage stats: its slug. */
export const PAGE_SLUGS = PAGES.map((p) => p.slug);
