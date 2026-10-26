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

    async deleteEvent(id) {
      await init();
      await db.run('DELETE FROM participants WHERE event_id = ?', [id]);
      await db.run('DELETE FROM participant_emails WHERE event_id = ?', [id]);
      await db.run('DELETE FROM notifications WHERE event_id = ?', [id]);
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
