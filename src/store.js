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
  // Plans that repeat (src/reminders.js): each poll whose date has passed is handled once, by an
  // email to the organizer ('email'), or not ('skipped'), or because the next one was planned
  // ('continued').
  `CREATE TABLE IF NOT EXISTS series_reminders (
     event_id TEXT PRIMARY KEY,
     at INTEGER NOT NULL,
     how TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS events_final_start ON events(final_start)`,
];

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
      const row = await db.first('SELECT * FROM events WHERE id = ?', [id]);
      if (!row) return null;
      return {
        id: row.id,
        ...JSON.parse(row.data),
        adminHash: row.admin_hash,
        finalStart: row.final_start ?? null,
        createdAt: row.created_at,
      };
    },

    /**
     * What a link preview needs (src/preview.js), in one read: the poll, and — only once a date is
     * picked and the organizer shows results and names — everyone's answers, without their names.
     */
    async getPreview(id) {
      await init();
      const rows = await db.all(
        `SELECT e.data, e.final_start, p.availability FROM events e
         LEFT JOIN participants p ON p.event_id = e.id AND e.final_start IS NOT NULL
           AND NOT COALESCE(json_extract(e.data, '$.hideResults'), 0) AND NOT COALESCE(json_extract(e.data, '$.hideNames'), 0)
         WHERE e.id = ?`,
        [id],
      );
      if (!rows.length) return null;
      return {
        ...JSON.parse(rows[0].data),
        finalStart: rows[0].final_start ?? null,
        answers: rows.filter((r) => r.availability != null).map((r) => JSON.parse(r.availability)),
      };
    },

    async deleteEvent(id) {
      await init();
      await db.run('DELETE FROM participants WHERE event_id = ?', [id]);
      await db.run('DELETE FROM participant_emails WHERE event_id = ?', [id]);
      await db.run('DELETE FROM notifications WHERE event_id = ?', [id]);
      await db.run('DELETE FROM series_reminders WHERE event_id = ?', [id]);
      await db.run('DELETE FROM events WHERE id = ?', [id]);
    },

    /** Replace the poll's settings (everything stored in `data`). */
    async updateEvent(id, event) {
      await init();
      await db.run('UPDATE events SET data = ? WHERE id = ?', [JSON.stringify(event), id]);
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

    /**
     * Polls that repeat, whose date was between `since` and `before` (ms) and that haven't been
     * handled yet (markReminded): their ids, oldest date first.
     */
    async dueReminders(before, since, limit = 200) {
      await init();
      const rows = await db.all(
        `SELECT e.id FROM events e LEFT JOIN series_reminders r ON r.event_id = e.id
         WHERE r.event_id IS NULL AND e.final_start IS NOT NULL AND e.final_start < ? AND e.final_start >= ?
           AND json_extract(e.data, '$.repeat') IS NOT NULL
         ORDER BY e.final_start LIMIT ?`,
        [before, since, limit],
      );
      return rows.map((r) => r.id);
    },

    /** Mark a poll's "time to plan the next one?" as handled. True only for the first call, so it happens once. */
    async markReminded(eventId, at, how) {
      await init();
      const r = await db.run(
        'INSERT INTO series_reminders (event_id, at, how) VALUES (?, ?, ?) ON CONFLICT(event_id) DO NOTHING',
        [eventId, at, how],
      );
      // node:sqlite says how many rows changed as `changes`; D1 as `meta.changes`.
      return Number(r?.changes ?? r?.meta?.changes ?? 0) > 0;
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
