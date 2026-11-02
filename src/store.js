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
  // AI requests paid for by the server's key this week (src/ai.js): a hashed person, or '*' for
  // everyone, and a count. Earlier weeks are deleted as the next one starts.
  `CREATE TABLE IF NOT EXISTS ai_allowance (
     week TEXT NOT NULL,
     who TEXT NOT NULL,
     count INTEGER NOT NULL,
     PRIMARY KEY (week, who)
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
  // Polls emailed to people (src/invites.js): how many invitations each account sent a day, for its limit.
  `CREATE TABLE IF NOT EXISTS email_sends (
     user_id TEXT NOT NULL,
     day TEXT NOT NULL,
     count INTEGER NOT NULL,
     PRIMARY KEY (user_id, day)
   )`,
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
  // Whose account a poll or brand template is kept with ('poll' or 'brand'), or an answer someone gave
  // while signed in ('answer', by participant id): at most one each. Links work as before, with or without it.
  `CREATE TABLE IF NOT EXISTS owners (
     kind TEXT NOT NULL,
     item_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (kind, item_id)
   )`,
  `CREATE INDEX IF NOT EXISTS owners_user ON owners(user_id, kind)`,
  // Signing in with an email and password (src/email-auth.js). `email` is the login, lowercased;
  // `hash` is the password's PBKDF2 hash (src/password.js), never the password. `failed` counts wrong
  // passwords in a row, and `locked_until` pauses guessing after too many.
  `CREATE TABLE IF NOT EXISTS passwords (
     user_id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     hash TEXT NOT NULL,
     failed INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER,
     updated_at INTEGER NOT NULL
   )`,
  // Links emailed to finish signing up, set a new password or move to a new email: the SHA-256 hash
  // of each link's secret, never the secret. `data` carries what the link finishes (a sign-up's
  // password hash). Each is used once, and expires.
  `CREATE TABLE IF NOT EXISTS email_tokens (
     hash TEXT PRIMARY KEY,
     purpose TEXT NOT NULL,
     email TEXT NOT NULL,
     user_id TEXT,
     data TEXT,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS email_tokens_email ON email_tokens(email, created_at)`,
  // More ways into one account: a Google, Microsoft or GitHub sign-in connected from Account
  // settings while signed in. Never joined up by matching emails.
  `CREATE TABLE IF NOT EXISTS identities (
     provider TEXT NOT NULL,
     subject TEXT NOT NULL,
     user_id TEXT NOT NULL,
     email TEXT,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (provider, subject)
   )`,
  `CREATE INDEX IF NOT EXISTS identities_user ON identities(user_id)`,
  // Brand templates shared with other accounts (src/brands.js): 'admin' can change the template,
  // 'user' has it in their templates to make polls with. Its owner is in `owners`, not here.
  `CREATE TABLE IF NOT EXISTS brand_members (
     brand_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     role TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (brand_id, user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS brand_members_user ON brand_members(user_id)`,
  // Invite links to a template, one role each: the SHA-256 hash of each link's secret, never the
  // secret. They work until the template's owner turns them off.
  `CREATE TABLE IF NOT EXISTS brand_invites (
     hash TEXT PRIMARY KEY,
     brand_id TEXT NOT NULL,
     role TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS brand_invites_brand ON brand_invites(brand_id)`,
];

/** The picture's details for a poll's JSON (or nothing, when it has none), from a joined row. */
const imageOf = (row) => (row.image_v != null ? { image: { v: row.image_v, card: !!row.image_card, type: row.image_type } } : {});
const IMAGE_COLUMNS = 'i.updated_at AS image_v, i.icon_type AS image_type, i.card IS NOT NULL AS image_card';

export function createStore(db) {
  // The tables, made once per server (a Worker isolate) before its first query: all in one batch, so
  // a cold Worker waits for one database round trip, not one per table. If that fails (the database
  // was briefly unreachable), the next request tries again instead of failing for the isolate's life.
  let ready = null;
  const init = () =>
    (ready ??= (
      db.batch
        ? db.batch(SCHEMA)
        : (async () => {
            for (const sql of SCHEMA) await db.run(sql, []);
          })()
    ).catch((e) => {
      ready = null;
      throw e;
    }));

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
      await db.run('DELETE FROM participant_emails WHERE event_id = ?', [id]);
      await db.run('DELETE FROM notifications WHERE event_id = ?', [id]);
      await db.run('DELETE FROM event_images WHERE event_id = ?', [id]);
      await db.run('DELETE FROM reminders WHERE event_id = ?', [id]);
      await db.run("DELETE FROM owners WHERE kind = 'poll' AND item_id = ?", [id]);
      await db.run("DELETE FROM owners WHERE kind = 'answer' AND item_id IN (SELECT id FROM participants WHERE event_id = ?)", [
        id,
      ]);
      await db.run('DELETE FROM participants WHERE event_id = ?', [id]);
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
      await db.run('DELETE FROM brand_members WHERE brand_id = ?', [id]);
      await db.run('DELETE FROM brand_invites WHERE brand_id = ?', [id]);
      await db.run('DELETE FROM brands WHERE id = ?', [id]);
    },

    // ---------- sharing a brand template ----------

    /** This account's role on a template it was invited to ('admin' | 'user'), or null. */
    async brandRole(brandId, userId) {
      await init();
      return (
        (await db.first('SELECT role FROM brand_members WHERE brand_id = ? AND user_id = ?', [brandId, userId]))?.role ?? null
      );
    },

    /** Give an account a role on a template (replacing the one it had). */
    async setBrandMember(brandId, userId, role, now) {
      await init();
      await db.run(
        `INSERT INTO brand_members (brand_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(brand_id, user_id) DO UPDATE SET role = excluded.role`,
        [brandId, userId, role, now],
      );
    },

    async removeBrandMember(brandId, userId) {
      await init();
      await db.run('DELETE FROM brand_members WHERE brand_id = ? AND user_id = ?', [brandId, userId]);
    },

    /** Who a template is shared with, first invited first: [{ userId, name, role }]. */
    async listBrandMembers(brandId) {
      await init();
      const rows = await db.all(
        `SELECT m.user_id, m.role, u.name, u.email FROM brand_members m JOIN users u ON u.id = m.user_id
         WHERE m.brand_id = ? ORDER BY m.created_at, m.user_id LIMIT 500`,
        [brandId],
      );
      return rows.map((r) => ({ userId: r.user_id, name: r.name || r.email || 'Someone', role: r.role }));
    },

    async addBrandInvite({ hash, brandId, role, now }) {
      await init();
      await db.run('INSERT INTO brand_invites (hash, brand_id, role, created_at) VALUES (?, ?, ?, ?)', [
        hash,
        brandId,
        role,
        now,
      ]);
    },

    /** The role an invite link to this template gives, or null. */
    async brandInviteRole(brandId, hash) {
      await init();
      return (await db.first('SELECT role FROM brand_invites WHERE hash = ? AND brand_id = ?', [hash, brandId]))?.role ?? null;
    },

    /** How many invite links a template has, by role: { admin, user }. */
    async countBrandInvites(brandId) {
      await init();
      const rows = await db.all('SELECT role, COUNT(*) AS n FROM brand_invites WHERE brand_id = ? GROUP BY role', [brandId]);
      const out = { admin: 0, user: 0 };
      for (const r of rows) out[r.role] = Number(r.n);
      return out;
    },

    /** Turn off a template's invite links (of one role, or all). */
    async removeBrandInvites(brandId, role) {
      await init();
      if (role) await db.run('DELETE FROM brand_invites WHERE brand_id = ? AND role = ?', [brandId, role]);
      else await db.run('DELETE FROM brand_invites WHERE brand_id = ?', [brandId]);
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
      await db.run('DELETE FROM passwords WHERE user_id = ?', [userId]);
      await db.run('DELETE FROM identities WHERE user_id = ?', [userId]);
      await db.run('DELETE FROM email_tokens WHERE user_id = ?', [userId]);
      await db.run('DELETE FROM owners WHERE user_id = ?', [userId]);
      await db.run('DELETE FROM brand_members WHERE user_id = ?', [userId]);
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
           (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id AND p.id IS NOT COALESCE(json_extract(e.data, '$.hostId'), '')) AS answers,
           COALESCE(json_array_length(json_extract(n.data, '$.remind.invitees')), 0) AS invitees
         FROM owners o JOIN events e ON e.id = o.item_id LEFT JOIN notifications n ON n.event_id = e.id
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
          // A topic poll: what was decided, or null while it's open.
          ...(d.mode === 'topic' && { mode: 'topic', decided: d.options.find((o) => o.id === d.picked)?.label ?? null }),
          ...(d.deadline != null && { deadline: d.deadline }),
          answers: Number(r.answers),
          ...(d.location && { location: d.location }),
          ...(Number(r.invitees) && { invitees: Number(r.invitees) }),
        };
      });
    },

    /** The answer this account gave on a poll (its participant id), or null. */
    async answerIn(userId, eventId) {
      await init();
      const r = await db.first(
        `SELECT p.id FROM owners o JOIN participants p ON p.id = o.item_id
         WHERE o.user_id = ? AND o.kind = 'answer' AND p.event_id = ? LIMIT 1`,
        [userId, eventId],
      );
      return r?.id ?? null;
    },

    /** The polls an account has answered, latest answer first: My polls' "Answered". */
    async listAnsweredPolls(userId) {
      await init();
      const rows = await db.all(
        `SELECT e.id, e.data, e.final_start, e.created_at, p.id AS answer_id, p.updated_at AS answered_at, p.availability,
           (SELECT COUNT(*) FROM participants q WHERE q.event_id = e.id AND q.id IS NOT COALESCE(json_extract(e.data, '$.hostId'), '')) AS answers
         FROM owners o JOIN participants p ON p.id = o.item_id JOIN events e ON e.id = p.event_id
         WHERE o.user_id = ? AND o.kind = 'answer' ORDER BY p.updated_at DESC LIMIT 500`,
        [userId],
      );
      return rows.map((r) => {
        const d = JSON.parse(r.data);
        // Whether they said they can make the picked date: 2 yes, 1 if needed, 0 no.
        // On a topic poll: whether they went with the option that was picked.
        const key = d.mode === 'topic' ? d.picked : r.final_start;
        const can = key == null ? undefined : (JSON.parse(r.availability)[key] ?? 0);
        return {
          id: r.id,
          answerId: r.answer_id,
          title: d.title,
          ...(d.emoji && { emoji: d.emoji }),
          ...(d.organizer && { organizer: d.organizer }),
          ...(d.location && { location: d.location }),
          createdAt: r.created_at,
          answeredAt: r.answered_at,
          finalStart: r.final_start ?? null,
          // A topic poll: what was decided, or null while it's open.
          ...(d.mode === 'topic' && { mode: 'topic', decided: d.options.find((o) => o.id === d.picked)?.label ?? null }),
          ...(can !== undefined && { can }),
          answers: Number(r.answers),
        };
      });
    },

    /**
     * An account's brand templates, newest first: the ones it keeps (role 'owner') and the ones
     * shared with it ('admin' can change it, 'user' makes polls with it).
     */
    async listOwnedBrands(userId) {
      await init();
      const rows = await db.all(
        `SELECT b.id, b.data, b.logo_v, b.created_at AS created_at, 'owner' AS role FROM owners o JOIN brands b ON b.id = o.item_id
           WHERE o.user_id = ? AND o.kind = 'brand'
         UNION ALL
         SELECT b.id, b.data, b.logo_v, b.created_at, m.role FROM brand_members m JOIN brands b ON b.id = m.brand_id
           WHERE m.user_id = ? AND NOT EXISTS (SELECT 1 FROM owners o WHERE o.kind = 'brand' AND o.item_id = b.id AND o.user_id = ?)
         ORDER BY created_at DESC LIMIT 200`,
        [userId, userId, userId],
      );
      return rows.map((r) => ({
        id: r.id,
        name: JSON.parse(r.data).name,
        logoV: r.logo_v ?? null,
        createdAt: r.created_at,
        role: r.role,
      }));
    },

    // ---------- email and password sign-in (src/email-auth.js) ----------

    /** A new account that signs in with its email: { id, provider: 'email', email, name }. */
    async createEmailUser({ email, hash, now }) {
      await init();
      const id = crypto.randomUUID();
      await db.run('INSERT INTO users (id, provider, subject, email, name, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        'email',
        id,
        email,
        '',
        now,
      ]);
      await db.run('INSERT INTO passwords (user_id, email, hash, updated_at) VALUES (?, ?, ?, ?)', [id, email, hash, now]);
      return { id, provider: 'email', email, name: '' };
    },

    /** The password login for an email (lowercased), or a user's: { userId, email, hash, failed, lockedUntil }. */
    async getPassword({ email, userId }) {
      await init();
      const r = await db.first(
        `SELECT user_id, email, hash, failed, locked_until FROM passwords WHERE ${email != null ? 'email' : 'user_id'} = ?`,
        [email ?? userId],
      );
      return r && { userId: r.user_id, email: r.email, hash: r.hash, failed: Number(r.failed), lockedUntil: r.locked_until };
    },

    /** Give an account a password (or a new one), signing in as `email`. */
    async setPassword({ userId, email, hash, now }) {
      await init();
      await db.run(
        `INSERT INTO passwords (user_id, email, hash, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, hash = excluded.hash, failed = 0, locked_until = NULL,
           updated_at = excluded.updated_at`,
        [userId, email, hash, now],
      );
    },

    /** After a wrong password: count it, and pause guessing from `lockedUntil` if given. */
    async passwordFailed(userId, lockedUntil = null) {
      await init();
      await db.run('UPDATE passwords SET failed = failed + 1, locked_until = COALESCE(?, locked_until) WHERE user_id = ?', [
        lockedUntil,
        userId,
      ]);
    },

    async passwordWorked(userId, rehash = null) {
      await init();
      await db.run('UPDATE passwords SET failed = 0, locked_until = NULL, hash = COALESCE(?, hash) WHERE user_id = ?', [
        rehash,
        userId,
      ]);
    },

    /** Move a password account to a new email: its login, and the address shown for it. */
    async changeEmail(userId, email) {
      await init();
      await db.run('UPDATE passwords SET email = ? WHERE user_id = ?', [email, userId]);
      await db.run("UPDATE users SET email = ? WHERE id = ? AND provider = 'email'", [email, userId]);
    },

    async getUser(id) {
      await init();
      return db.first('SELECT id, provider, email, name FROM users WHERE id = ?', [id]);
    },

    /**
     * The account a verified email belongs to, for "forgot password" and signing up twice: its
     * password login, or else a Google or GitHub account with that address (both vouch for it;
     * Microsoft's addresses aren't verified, so they never count). Null if none.
     */
    async findUserByVerifiedEmail(email) {
      await init();
      const login = await db.first('SELECT user_id FROM passwords WHERE email = ?', [email]);
      if (login) return { id: login.user_id, hasPassword: true };
      const u = await db.first(
        `SELECT id, provider FROM users WHERE lower(email) = ? AND provider IN ('google', 'github')
         ORDER BY created_at DESC LIMIT 1`,
        [email],
      );
      return u && { id: u.id, provider: u.provider, hasPassword: false };
    },

    async createEmailToken({ hash, purpose, email, userId = null, data = null, now, expiresAt }) {
      await init();
      await db.run('DELETE FROM email_tokens WHERE expires_at <= ?', [now]);
      await db.run(
        'INSERT INTO email_tokens (hash, purpose, email, user_id, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [hash, purpose, email, userId, data, now, expiresAt],
      );
    },

    /** How many links were emailed to an address since `since`: a cap on mail to any one inbox. */
    async countEmailTokens(email, since) {
      await init();
      return Number(
        (await db.first('SELECT COUNT(*) AS n FROM email_tokens WHERE email = ? AND created_at > ?', [email, since]))?.n ?? 0,
      );
    },

    /** Use a link: its row if it's live and for `purpose`, deleted so it can't be used again. Else null. */
    async takeEmailToken(hash, purpose, now) {
      await init();
      const r = await db.first('SELECT * FROM email_tokens WHERE hash = ? AND purpose = ? AND expires_at > ?', [
        hash,
        purpose,
        now,
      ]);
      if (!r) return null;
      await db.run('DELETE FROM email_tokens WHERE hash = ?', [hash]);
      return { purpose: r.purpose, email: r.email, userId: r.user_id, data: r.data };
    },

    /** Is this link live? (Without using it.) */
    async peekEmailToken(hash, purpose, now) {
      await init();
      const r = await db.first('SELECT email FROM email_tokens WHERE hash = ? AND purpose = ? AND expires_at > ?', [
        hash,
        purpose,
        now,
      ]);
      return r ? { email: r.email } : null;
    },

    /** Forget every live link of one kind for an account or an address, after one of them is used. */
    async dropEmailTokens({ userId, email, purpose }) {
      await init();
      if (userId) await db.run('DELETE FROM email_tokens WHERE user_id = ? AND purpose = ?', [userId, purpose]);
      if (email) await db.run('DELETE FROM email_tokens WHERE email = ? AND purpose = ?', [email, purpose]);
    },

    /** Sign out every browser of an account, except the session with hash `keep`, if given. */
    async deleteSessions(userId, keep = null) {
      await init();
      await db.run('DELETE FROM sessions WHERE user_id = ? AND hash IS NOT ?', [userId, keep]);
    },

    async countSessions(userId, now) {
      await init();
      return Number(
        (await db.first('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', [userId, now]))?.n ?? 0,
      );
    },

    // ---------- connected sign-ins ----------

    /** The account a connected sign-in leads to, or null. */
    async identityUser(provider, subject) {
      await init();
      return db.first(
        'SELECT u.id, u.provider, u.email, u.name FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?',
        [provider, subject],
      );
    },

    /** Whose this sign-in already is, as an account of its own or connected to one: a user id, or null. */
    async signInOwner(provider, subject) {
      await init();
      const own = await db.first('SELECT id FROM users WHERE provider = ? AND subject = ?', [provider, subject]);
      if (own) return own.id;
      return (
        (await db.first('SELECT user_id FROM identities WHERE provider = ? AND subject = ?', [provider, subject]))?.user_id ??
        null
      );
    },

    async addIdentity({ provider, subject, userId, email, now }) {
      await init();
      await db.run('INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)', [
        provider,
        subject,
        userId,
        email,
        now,
      ]);
    },

    /** The sign-ins connected to an account: [{ provider, email }]. */
    async listIdentities(userId) {
      await init();
      return db.all('SELECT provider, email FROM identities WHERE user_id = ? ORDER BY created_at', [userId]);
    },

    async removeIdentity(userId, provider) {
      await init();
      await db.run('DELETE FROM identities WHERE user_id = ? AND provider = ?', [userId, provider]);
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
      await db.run("DELETE FROM owners WHERE kind = 'answer' AND item_id = ?", [id]);
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

    /**
     * Take one AI request from this week's allowance: null when it's taken, or 'person' or 'total'
     * when that limit is already reached.
     */
    async takeAiAllowance(week, who, perPerson, total) {
      await init();
      const rows = await db.all('SELECT who, count FROM ai_allowance WHERE week = ? AND who IN (?, ?)', [week, who, '*']);
      const used = (k) => rows.find((r) => r.who === k)?.count || 0;
      if (used(who) >= perPerson) return 'person';
      if (used('*') >= total) return 'total';
      for (const k of [who, '*'])
        await db.run(
          'INSERT INTO ai_allowance (week, who, count) VALUES (?, ?, 1) ON CONFLICT(week, who) DO UPDATE SET count = count + 1',
          [week, k],
        );
      if (!used('*')) await db.run('DELETE FROM ai_allowance WHERE week < ?', [week]);
      return null;
    },

    /** Give back a request taken from this week's allowance, when it failed before Claude answered. */
    async returnAiAllowance(week, who) {
      await init();
      await db.run('UPDATE ai_allowance SET count = count - 1 WHERE week = ? AND who IN (?, ?) AND count > 0', [week, who, '*']);
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

    /** Invitations account `userId` sent on `day` (YYYY-MM-DD). */
    async sendsOn(userId, day) {
      await init();
      const row = await db.first('SELECT count FROM email_sends WHERE user_id = ? AND day = ?', [userId, day]);
      return row ? Number(row.count) : 0;
    },

    async addSends(userId, day, n) {
      await init();
      await db.run(
        'INSERT INTO email_sends (user_id, day, count) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET count = count + excluded.count',
        [userId, day, n],
      );
      // Only today's count matters; older days go.
      await db.run('DELETE FROM email_sends WHERE user_id = ? AND day < ?', [userId, day]);
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
    // Statements without parameters, in one round trip (D1 runs a batch as one transaction).
    batch: (sqls) => d1.batch(sqls.map((sql) => d1.prepare(sql))),
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
