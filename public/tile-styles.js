// A poll's tile style: the background behind its emoji (poll page, My polls, the create page's tile).
// A fixed set drawn from the Venn circles, so a poll can look like its own without anything a person
// or the AI could draw: the poll stores only the key, and styles.css draws each one in both looks.

/** Each style: its key (stored on the poll) and its name (said by screen readers in the picker). */
export const TILE_STYLES = [
  { key: 'mint', name: 'Mint' },
  { key: 'sunny', name: 'Sunny' },
  { key: 'berry', name: 'Berry' },
  { key: 'sky', name: 'Sky' },
  { key: 'dusk', name: 'Dusk' },
  { key: 'paper', name: 'Paper' },
];

export const TILE_KEYS = TILE_STYLES.map((t) => t.key);

export const isTileStyle = (v) => typeof v === 'string' && TILE_KEYS.includes(v);
