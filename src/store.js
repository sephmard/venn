// SQL-backed storage. Works with Cloudflare D1 and node:sqlite through tiny adapters
// that expose `run(sql, params)`, `all(sql, params)` and `first(sql, params)`.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (
     id TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     admin_hash TEXT NOT NULL,
     final_start INTEGER,
     created_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS participants (
     id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL,
     name TEXT NOT NULL,
     availability TEXT NOT NULL,
     edit_hash TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS participants_event ON participants(event_id)`,
  // Organizer-only settings (email, webhook). Kept apart from the event so they're never in public responses.
  `CREATE TABLE IF NOT EXISTS notifications (
     event_id TEXT PRIMARY KEY,
     data TEXT NOT NULL
   )`,
  // Emails, when the organizer asks everyone for one. Only ever shown to the organizer.
  `CREATE TABLE IF NOT EXISTS participant_emails (
     participant_id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL,
     email TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS participant_emails_event ON participant_emails(event_id)`,
  // Usage stats (src/usage.js): a count per day, event and set of properties. Nothing else.
  `CREATE TABLE IF NOT EXISTS usage_counts (
     day TEXT NOT NULL,
     name TEXT NOT NULL,
     props TEXT NOT NULL,
     count INTEGER NOT NULL,
     PRIMARY KEY (day, name, props)
   )`,
  // A poll's own picture (src/images.js), in base64 so D1 and node:sqlite store it the same way: the
  // square icon, and the link-preview card. `updated_at` is its version, for the URLs that serve it.
  `CREATE TABLE IF NOT EXISTS event_images (
     event_id TEXT PRIMARY KEY,
     icon TEXT NOT NULL,
     icon_type TEXT NOT NULL,
     card TEXT,
     card_type TEXT,
     updated_at INTEGER NOT NULL
   )`,
  // What was left of plans that repeat, which were taken out: when each "time to plan the next one?"
  // email went.
  `DROP TABLE IF EXISTS series_reminders`,
  `CREATE INDEX IF NOT EXISTS events_final_start ON events(final_start)`,
  // When a poll with a deadline is next due a look (src/deadline.js): reminders to invitees who
  // haven't answered, or the organizer's "answers are closed" email. Gone once that's sent.
  `CREATE TABLE IF NOT EXISTS reminders (
     event_id TEXT PRIMARY KEY,
     next_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS reminders_next ON reminders(next_at)`,
  // Brand templates (src/brands.js): an organization's look and defaults, and its logo in base64.
  // `logo_v` is the logo's version, for the URL that serves it.
  `CREATE TABLE IF NOT EXISTS brands (
     id TEXT PRIMARY KEY,
     data TEXT NOT NULL,
     admin_hash TEXT NOT NULL,
     logo TEXT,
     logo_type TEXT,
     logo_v INTEGER,
     created_at INTEGER NOT NULL
   )`,
  // Accounts (src/auth.js), for people who choose to sign in: who they are at Google, Microsoft or
  // GitHub (the provider's own id, never matched by email), their name and email.
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     provider TEXT NOT NULL,
     subject TEXT NOT NULL,
     email TEXT,
     name TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     UNIQUE (provider, subject)
   )`,
  // Signed-in browsers: the SHA-256 hash of each session cookie, never the cookie itself.
  `CREATE TABLE IF NOT EXISTS sessions (
     hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at)`,
  // Whose account a poll or brand template is kept with ('poll' or 'brand'): at most one each. Its
  // organizer or manage link works as before, with or without it.
  `CREATE TABLE IF NOT EXISTS owners (
     kind TEXT NOT NULL,
     item_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (kind, item_id)
   )`,
  `CREATE INDEX IF NOT EXISTS owners_user ON owners(user_id, kind)`,
];

/** The picture's details for a poll's JSON (or nothing, when it has none), from a joined row. */
const imageOf = (row) => (row.image_v != null ? { image: { v: row.image_v, card: !!row.image_card, type: row.image_type } } : {});
const IMAGE_COLUMNS = 'i.updated_at AS image_v, i.icon_type AS image_type, i.card IS NOT NULL AS image_card';

export function createStore(db) {
  let ready = null;
  const init = () =>
    (ready ??= (async () => {
      for (const sql of SCHEMA) await db.run(sql, []);
    })());

  return {
    async createEvent({ id, event, adminHash, now }) {
      await init();
      await db.run('INSERT INTO events (id, data, admin_hash, final_start, created_at) VALUES (?, ?, ?, NULL, ?)', [
        id,
        JSON.stringify(event),
        adminHash,
        now,
      ]);
    },

    async getEvent(id) {
      await init();
      const row = await db.first(
        `SELECT e.*, ${IMAGE_COLUMNS} FROM events e LEFT JOIN event_images i ON i.event_id = e.id WHERE e.id = ?`,
        [id],
      );
      if (!row) return null;
      return {
        id: row.id,
        ...JSON.parse(row.data),
        adminHash: row.admin_hash,
        finalStart: row.final_start ?? null,
        createdAt: row.created_at,
        ...imageOf(row),
      };
    },

    /**
     * What a link preview needs (src/preview.js), in one read: the poll, and — only once a date is
     * picked and the organizer shows results and names — everyone's answers, without their names.
     */
    async getPreview(id) {
      await init();
      const rows = await db.all(
        `SELECT e.data, e.final_start, p.availability, ${IMAGE_COLUMNS} FROM events e
         LEFT JOIN participants p ON p.event_id = e.id AND e.final_start IS NOT NULL
           AND NOT COALESCE(json_extract(e.data, '$.hideResults'), 0) AND NOT COALESCE(json_extract(e.data, '$.hideNames'), 0)
         LEFT JOIN event_images i ON i.event_id = e.id
         WHERE e.id = ?`,
        [id],
      );
      if (!rows.length) return null;
      return {
        id,
        ...JSON.parse(rows[0].data),
        ...imageOf(rows[0]),
        finalStart: rows[0].final_start ?? null,
        answers: rows.filter((r) => r.availability != null).map((r) => JSON.parse(r.availability)),
      };
    },

    async deleteEvent(id) {
      await init();
      await db.run('DELETE FROM participants WHERE event_id = ?', [id]);
      await db.run('DELETE FROM participant_emails WHERE event_id = ?', [id]);
      await db.run('DELETE FROM notifications WHERE event_id = ?', [id]);
      await db.run('DELETE FROM event_images WHERE event_id = ?', [id]);
      await db.run('DELETE FROM reminders WHERE event_id = ?', [id]);
      await db.run("DELETE FROM owners WHERE kind = 'poll' AND item_id = ?", [id]);
      await db.run('DELETE FROM events WHERE id = ?', [id]);
    },

    /** When poll `eventId` is next due a look for its deadline (src/deadline.js), or never (null). */
    async setReminderDue(eventId, at) {
      await init();
      if (at == null) return db.run('DELETE FROM reminders WHERE event_id = ?', [eventId]);
      await db.run(
        'INSERT INTO reminders (event_id, next_at) VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET next_at = excluded.next_at',
        [eventId, at],
      );
    },

    /** The polls due a look for their deadline by `now`. */
    async dueReminders(now) {
      await init();
      return (await db.all('SELECT event_id FROM reminders WHERE next_at <= ? ORDER BY next_at LIMIT 200', [now])).map(
        (r) => r.event_id,
      );
    },

    /** Replace the poll's settings (everything stored in `data`). Its picture is kept apart. */
    async updateEvent(id, { image: _image, ...event }) {
      await init();
      await db.run('UPDATE events SET data = ? WHERE id = ?', [JSON.stringify(event), id]);
    },

    /**
     * Save the poll's picture: `icon` and (optionally) `card`, each { data (base64), type }. Returns
     * its new version, always later than the one it replaces so links to the old one don't serve it.
     */
    async setImage(eventId, { icon, card = null, now }) {
      await init();
      const prev = await db.first('SELECT updated_at FROM event_images WHERE event_id = ?', [eventId]);
      const v = Math.max(now, (prev?.updated_at ?? 0) + 1);
      await db.run(
        `INSERT INTO event_images (event_id, icon, icon_type, card, card_type, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET icon = excluded.icon, icon_type = excluded.icon_type,
           card = excluded.card, card_type = excluded.card_type, updated_at = excluded.updated_at`,
        [eventId, icon.data, icon.type, card?.data ?? null, card?.type ?? null, v],
      );
      return v;
    },

    /** One of the poll's pictures ('icon' or 'card'): { data, type, v }, or null. */
    async getImage(eventId, which) {
      await init();
      const col = which === 'card' ? 'card' : 'icon';
      const row = await db.first(`SELECT ${col} AS data, ${col}_type AS type, updated_at FROM event_images WHERE event_id = ?`, [
        eventId,
      ]);
      return row?.data ? { data: row.data, type: row.type, v: row.updated_at } : null;
    },

    async deleteImage(eventId) {
      await init();
      await db.run('DELETE FROM event_images WHERE event_id = ?', [eventId]);
    },

    async createBrand({ id, brand, adminHash, now }) {
      await init();
      await db.run('INSERT INTO brands (id, data, admin_hash, created_at) VALUES (?, ?, ?, ?)', [
        id,
        JSON.stringify(brand),
        adminHash,
        now,
      ]);
    },

    /** A brand template: its settings, adminHash and logoV (null without a logo), or null. */
    async getBrand(id) {
      await init();
      const row = await db.first('SELECT id, data, admin_hash, logo_v FROM brands WHERE id = ?', [id]);
      return row && { id: row.id, ...JSON.parse(row.data), adminHash: row.admin_hash, logoV: row.logo_v ?? null };
    },

    async updateBrand(id, brand) {
      await init();
      await db.run('UPDATE brands SET data = ? WHERE id = ?', [JSON.stringify(brand), id]);
    },

    async deleteBrand(id) {
      await init();
      await db.run("DELETE FROM owners WHERE kind = 'brand' AND item_id = ?", [id]);
      await db.run('DELETE FROM brands WHERE id = ?', [id]);
    },

    /** Save the logo ({ data (base64), type }), or take it away with null. Returns its new version. */
    async setBrandLogo(id, logo, now) {
      await init();
      const prev = await db.first('SELECT logo_v FROM brands WHERE id = ?', [id]);
      const v = logo ? Math.max(now, (prev?.logo_v ?? 0) + 1) : null;
      await db.run('UPDATE brands SET logo = ?, logo_type = ?, logo_v = ? WHERE id = ?', [
        logo?.data ?? null,
        logo?.type ?? null,
        v,
        id,
      ]);
      return v;
    },

    /** A brand's logo: { data, type, v }, or null. */
    async getBrandLogo(id) {
      await init();
      const row = await db.first('SELECT logo, logo_type, logo_v FROM brands WHERE id = ?', [id]);
      return row?.logo ? { data: row.logo, type: row.logo_type, v: row.logo_v } : null;
    },

    // ---------- accounts (src/auth.js) ----------

    /** The account for this sign-in, made the first time; its name and email follow the provider's. */
    async upsertUser({ provider, subject, email, name, now }) {
      await init();
      await db.run(
        `INSERT INTO users (id, provider, subject, email, name, created_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(provider, subject) DO UPDATE SET email = excluded.email, name = excluded.name`,
        [crypto.randomUUID(), provider, subject, email, name, now],
      );
      return db.first('SELECT id, provider, email, name FROM users WHERE provider = ? AND subject = ?', [provider, subject]);
    },

    async createSession({ hash, userId, now, expiresAt }) {
      await init();
      await db.run('DELETE FROM sessions WHERE expires_at <= ?', [now]);
      await db.run('INSERT INTO sessions (hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
        hash,
        userId,
        now,
        expiresAt,
      ]);
    },

    /** The account signed in with this session, while it lasts: { id, provider, email, name }, or null. */
    async getSessionUser(hash, now) {
      await init();
      return db.first(
        `SELECT u.id, u.provider, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.hash = ? AND s.expires_at > ?`,
        [hash, now],
      );
    },

    async deleteSession(hash) {
      await init();
      await db.run('DELETE FROM sessions WHERE hash = ?', [hash]);
    },

    /** Forget an account: its sessions and its list. Its polls and templates stay. */
    async deleteUser(userId) {
      await init();
      await db.run('DELETE FROM owners WHERE user_id = ?', [userId]);
      await db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
      await db.run('DELETE FROM users WHERE id = ?', [userId]);
    },

    /** Keep a poll or template ('poll' | 'brand') with an account. True if it's newly theirs. */
    async addOwner(kind, itemId, userId, now) {
      await init();
      const prev = await db.first('SELECT user_id FROM owners WHERE kind = ? AND item_id = ?', [kind, itemId]);
      if (prev) return false;
      await db.run('INSERT INTO owners (kind, item_id, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', [
        kind,
        itemId,
        userId,
        now,
      ]);
      return true;
    },

    /** The id of the account a poll or template is kept with, or null. */
    async ownerOf(kind, itemId) {
      await init();
      return (await db.first('SELECT user_id FROM owners WHERE kind = ? AND item_id = ?', [kind, itemId]))?.user_id ?? null;
    },

    async removeOwner(kind, itemId, userId) {
      await init();
      await db.run('DELETE FROM owners WHERE kind = ? AND item_id = ? AND user_id = ?', [kind, itemId, userId]);
    },

    /** An account's polls, newest first: what "My polls" lists. */
    async listOwnedPolls(userId) {
      await init();
      const rows = await db.all(
        `SELECT e.id, e.data, e.final_start, e.created_at,
           (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.id IS NOT COALESCE(json_extract(e.data, '$.hostId'), '')) AS answers
         FROM owners o JOIN events e ON e.id = o.item_id
         WHERE o.user_id = ? AND o.kind = 'poll' ORDER BY e.created_at DESC LIMIT 500`,
        [userId],
      );
      return rows.map((r) => {
        const d = JSON.parse(r.data);
        return {
          id: r.id,
          title: d.title,
          ...(d.emoji && { emoji: d.emoji }),
          createdAt: r.created_at,
          finalStart: r.final_start ?? null,
          ...(d.deadline != null && { deadline: d.deadline }),
          answers: Number(r.answers),
        };
      });
    },

    /** An account's brand templates, newest first. */
    async listOwnedBrands(userId) {
      await init();
      const rows = await db.all(
        `SELECT b.id, b.data, b.logo_v, b.created_at FROM owners o JOIN brands b ON b.id = o.item_id
         WHERE o.user_id = ? AND o.kind = 'brand' ORDER BY b.created_at DESC LIMIT 200`,
        [userId],
      );
      return rows.map((r) => ({ id: r.id, name: JSON.parse(r.data).name, logoV: r.logo_v ?? null, createdAt: r.created_at }));
    },

    async setFinal(id, finalStart) {
      await init();
      await db.run('UPDATE events SET final_start = ? WHERE id = ?', [finalStart, id]);
    },

    async listParticipants(eventId) {
      await init();
      const rows = await db.all('SELECT * FROM participants WHERE event_id = ? ORDER BY updated_at', [eventId]);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        availability: JSON.parse(r.availability),
        editHash: r.edit_hash,
        updatedAt: r.updated_at,
      }));
    },

    async countParticipants(eventId) {
      await init();
      const row = await db.first('SELECT COUNT(*) AS n FROM participants WHERE event_id = ?', [eventId]);
      return Number(row?.n ?? 0);
    },

    async getParticipant(eventId, id) {
      await init();
      const r = await db.first('SELECT * FROM participants WHERE event_id = ? AND id = ?', [eventId, id]);
      return r && { id: r.id, name: r.name, editHash: r.edit_hash };
    },

    async insertParticipant({ id, eventId, name, availability, editHash, now }) {
      await init();
      await db.run(
        'INSERT INTO participants (id, event_id, name, availability, edit_hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, eventId, name, JSON.stringify(availability), editHash, now],
      );
    },

    async updateParticipant({ id, eventId, name, availability, now }) {
      await init();
      await db.run('UPDATE participants SET name = ?, availability = ?, updated_at = ? WHERE id = ? AND event_id = ?', [
        name,
        JSON.stringify(availability),
        now,
        id,
        eventId,
      ]);
    },

    async getNotify(eventId) {
      await init();
      const row = await db.first('SELECT data FROM notifications WHERE event_id = ?', [eventId]);
      return row ? JSON.parse(row.data) : null;
    },

    async setNotify(eventId, data) {
      await init();
      await db.run(
        'INSERT INTO notifications (event_id, data) VALUES (?, ?) ON CONFLICT(event_id) DO UPDATE SET data = excluded.data',
        [eventId, JSON.stringify(data)],
      );
    },

    async deleteParticipant(eventId, id) {
      await init();
      await db.run('DELETE FROM participants WHERE event_id = ? AND id = ?', [eventId, id]);
      await db.run('DELETE FROM participant_emails WHERE participant_id = ?', [id]);
    },

    /** Save (or, with no email, forget) the email someone answered with. */
    async setParticipantEmail(eventId, id, email) {
      await init();
      if (!email) return db.run('DELETE FROM participant_emails WHERE participant_id = ?', [id]);
      await db.run(
        'INSERT INTO participant_emails (participant_id, event_id, email) VALUES (?, ?, ?) ON CONFLICT(participant_id) DO UPDATE SET email = excluded.email',
        [id, eventId, email],
      );
    },

    async countUsage(day, name, props) {
      await init();
      await db.run(
        'INSERT INTO usage_counts (day, name, props, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, name, props) DO UPDATE SET count = count + 1',
        [day, name, props],
      );
    },

    /** Usage counts from `since` (YYYY-MM-DD) on: [{ day, name, props, count }]. */
    async listUsage(since) {
      await init();
      return db.all('SELECT day, name, props, count FROM usage_counts WHERE day >= ? ORDER BY day, name', [since]);
    },

    /** Polls created since `since` (ms), with how many answers each has and whether a date was picked. */
    async pollOutcomes(since) {
      await init();
      const rows = await db.all(
        `SELECT e.data, e.final_start, (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS answers
         FROM events e WHERE e.created_at >= ? LIMIT 50000`,
        [since],
      );
      return rows.map((r) => ({ data: r.data, final_start: r.final_start ?? null, answers: Number(r.answers) }));
    },

    /** Participant id → email, for one poll. */
    async listEmails(eventId) {
      await init();
      const rows = await db.all('SELECT participant_id, email FROM participant_emails WHERE event_id = ?', [eventId]);
      return new Map(rows.map((r) => [r.participant_id, r.email]));
    },
  };
}

export function d1Adapter(d1) {
  return {
    run: (sql, params) =>
      d1
        .prepare(sql)
        .bind(...params)
        .run(),
    all: async (sql, params) =>
      (
        await d1
          .prepare(sql)
          .bind(...params)
          .all()
      ).results,
    first: (sql, params) =>
      d1
        .prepare(sql)
        .bind(...params)
        .first(),
  };
}

export function sqliteAdapter(db) {
  return {
    run: async (sql, params) => db.prepare(sql).run(...params),
    all: async (sql, params) => db.prepare(sql).all(...params),
    first: async (sql, params) => db.prepare(sql).get(...params) ?? null,
  };
}
