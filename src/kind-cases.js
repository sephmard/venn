// A fixed set of things people type into the one Use AI box, each with the kind of poll it should
// make. It scores how well a picker chooses the kind: today's word rules (test/jev.test.js)
// and Jev (src/jev.js, checked on the server by the cron in src/worker.js). Nothing here comes
// from real people: every sentence was written for this set, so it can be sent anywhere.
//
//   date:  a time to find (including a choice between named days or times)
//   vote:  a choice between things (places, food, books, themes), named or still to come
//   yesno: one yes-or-no question
//   none:  nothing to set up

export const KINDS = ['date', 'vote', 'yesno', 'none'];

export const KIND_CASES = [
  // Seph's own (Nov 4 2026) and the #286 cases
  ['k01', 'I want to ask my wife if she thinks I’m cute', 'yesno'],
  ['k02', 'Should we get a dog?', 'yesno'],
  ['k03', 'What kind of dog should we get?', 'vote'],
  ['k04', 'Ask the team what the party theme should be', 'vote'],
  ['k05', 'Italian, Thai or Mexican?', 'vote'],
  ['k06', 'Dinner with the Smiths next week', 'date'],
  ['k07', 'When can everyone do a call?', 'date'],
  ['k08', 'I’m only free wed Thu and the weekend this week, create a date poll for a date night with my wife.', 'date'],
  // Times to find
  ['k09', 'Brunch Saturday or Sunday morning', 'date'],
  ['k10', 'Team lunch, any afternoon next week', 'date'],
  ['k11', 'Team sync Tuesday or Thursday 2–4pm', 'date'],
  ['k12', 'Beach day, any Saturday in November', 'date'],
  ['k13', 'Weekend trip to the lake, 3 days in a row, sometime in the next three weeks', 'date'],
  ['k14', 'Which weekend works for a cabin trip?', 'date'],
  ['k15', 'Pick a day for the BBQ', 'date'],
  ['k16', 'Can everyone do Saturday?', 'date'],
  ['k17', 'Figure out a time that works for game night', 'date'],
  ['k18', 'Book club: pick a date in December', 'date'],
  ['k19', 'Poll the team about availability next week', 'date'],
  ['k20', 'Dinner with the team, which works better, Thursday or Friday?', 'date'],
  ['k21', 'Which of Friday or Saturday works?', 'date'],
  ['k22', 'Help me choose a time for the office party', 'date'],
  ['k23', 'Should we do the trip in March or April?', 'date'],
  ['k24', 'Let’s decide where and when to have dinner this week', 'date'],
  ['k25', 'Drinks tonight or tomorrow evening', 'date'],
  ['k26', 'Coffee with Maya sometime next week', 'date'],
  ['k27', 'Grandma’s 80th birthday party, a Sunday in January', 'date'],
  ['k28', 'Schedule a 45-minute interview with the design team', 'date'],
  ['k29', 'Movie night with the cousins', 'date'],
  ['k30', 'When should we vote on the budget?', 'date'],
  // Choices
  ['k31', 'Choose between Italian, Thai, and Mexican for dinner.', 'vote'],
  ['k32', 'Vote on our next book: Piranesi, Dune or Circe', 'vote'],
  ['k33', 'Vote on our next book.', 'vote'],
  ['k34', 'Find out which movie people want to see', 'vote'],
  ['k35', 'Get everyone to pick their favorite pizza toppings', 'vote'],
  ['k36', 'Pizza or tacos on Friday?', 'vote'],
  ['k37', 'Where should we go for the team offsite?', 'vote'],
  ['k38', 'Which restaurant should we book for Saturday?', 'vote'],
  ['k39', 'Name for the new puppy: Biscuit, Mochi or Pepper', 'vote'],
  ['k40', 'What game should we play on Friday?', 'vote'],
  ['k41', 'Logo A or logo B?', 'vote'],
  ['k42', 'What should we cook for the potluck?', 'vote'],
  // Yes or no
  ['k43', 'Is everyone okay with moving book club online?', 'yesno'],
  ['k44', 'Do we want to keep the Thursday standup?', 'yesno'],
  ['k45', 'Ask the group if they want to do Secret Santa this year', 'yesno'],
  ['k46', 'Pizza night, yes or no?', 'yesno'],
  ['k47', 'Should we invite the neighbors?', 'yesno'],
  // Nothing to set up
  ['k48', 'asdf qwerty zxcv?', 'none'],
  ['k49', 'hmm', 'none'],
  ['k50', 'Thanks!', 'none'],
].map(([id, text, kind]) => ({ id, text, kind }));

/** The cases' ids, for the usage counts the server keeps of each check (src/usage.js, kind.check). */
export const KIND_CASE_IDS = KIND_CASES.map((c) => c.id);
