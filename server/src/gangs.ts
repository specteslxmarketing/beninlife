// Player-created fictional gangs: create (wallet debit), invite/accept/decline, leave/kick, colour/emblem, friendly-fire setting, gang chat.
import type { DB } from './db.js';
import { applyTransaction, WalletError } from './wallet.js';
import { GANG_COLORS, GANG_CREATE_PRICE, GANG_EMBLEMS, GANG_MAX_MEMBERS, validGangName, validGangTag } from '../../shared/combat.js';
import { cleanBody } from './messages.js';

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export interface GangInfo { id: number; name: string; tag: string; color: string; emblem: string; ownerId: number; friendlyFire: boolean }
export interface GangMember { id: number; name: string; role: 'leader' | 'member' }
export interface GangMsg { id: number; from: number; fromName: string; body: string; at: number }

export function migrateGangs(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gangs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
      color TEXT NOT NULL, emblem TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id),
      friendly_fire INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gang_members (
      gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      role TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY (gang_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS gang_invites (
      gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),
      from_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, PRIMARY KEY (gang_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS gang_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, gang_id INTEGER NOT NULL REFERENCES gangs(id) ON DELETE CASCADE,
      from_id INTEGER NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gang_msg ON gang_messages(gang_id, id);`);
}

const row2info = (r: { id: number; name: string; tag: string; color: string; emblem: string; owner_id: number; friendly_fire: number }): GangInfo =>
  ({ id: r.id, name: r.name, tag: r.tag, color: r.color, emblem: r.emblem, ownerId: r.owner_id, friendlyFire: !!r.friendly_fire });
export function gangOf(db: DB, uid: number): GangInfo | null {
  const r = db.prepare('SELECT g.* FROM gangs g JOIN gang_members m ON m.gang_id = g.id WHERE m.user_id = ?').get(uid) as Parameters<typeof row2info>[0] | undefined;
  return r ? row2info(r) : null;
}
export function gangById(db: DB, id: number): GangInfo | null {
  const r = db.prepare('SELECT * FROM gangs WHERE id = ?').get(id) as Parameters<typeof row2info>[0] | undefined;
  return r ? row2info(r) : null;
}
export function members(db: DB, gangId: number): GangMember[] {
  return (db.prepare('SELECT m.user_id, m.role, u.display_name FROM gang_members m JOIN users u ON u.id = m.user_id WHERE m.gang_id = ? ORDER BY m.role = \'leader\' DESC, m.joined_at')
    .all(gangId) as { user_id: number; role: string; display_name: string }[]).map((m) => ({ id: m.user_id, name: m.display_name, role: m.role === 'leader' ? 'leader' : 'member' }));
}
export function invitesFor(db: DB, uid: number): (GangInfo & { fromName: string })[] {
  return (db.prepare('SELECT g.*, u.display_name AS from_name FROM gang_invites i JOIN gangs g ON g.id = i.gang_id JOIN users u ON u.id = i.from_id WHERE i.user_id = ? ORDER BY i.created_at DESC')
    .all(uid) as (Parameters<typeof row2info>[0] & { from_name: string })[]).map((r) => ({ ...row2info(r), fromName: r.from_name }));
}

export function createGang(db: DB, uid: number, p: { name?: unknown; tag?: unknown; color?: unknown; emblem?: unknown }): Res<{ gang: GangInfo; balance: number }> {
  if (gangOf(db, uid)) return { ok: false, error: 'Leave your current gang first' };
  const n = validGangName(p.name); if (!n.ok) return n;
  const tag = validGangTag(p.tag); if (!tag) return { ok: false, error: 'Tag must be 2–4 letters/numbers (and not a real group\'s initials)' };
  const color = GANG_COLORS.includes(String(p.color)) ? String(p.color) : null; if (!color) return { ok: false, error: 'Pick a colour' };
  const emblem = GANG_EMBLEMS.includes(String(p.emblem)) ? String(p.emblem) : null; if (!emblem) return { ok: false, error: 'Pick an emblem' };
  if (db.prepare('SELECT 1 FROM gangs WHERE name = ? OR tag = ?').get(n.name, tag)) return { ok: false, error: 'That name or tag is taken' };
  try {
    const r = db.transaction(() => {
      const bal = applyTransaction(db, uid, -GANG_CREATE_PRICE, 'gang_create', `Registered gang "${n.name}"`);
      const id = Number(db.prepare('INSERT INTO gangs (name, tag, color, emblem, owner_id, created_at) VALUES (?,?,?,?,?,?)').run(n.name, tag, color, emblem, uid, Date.now()).lastInsertRowid);
      db.prepare('INSERT INTO gang_members (gang_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(id, uid, 'leader', Date.now());
      db.prepare('DELETE FROM gang_invites WHERE user_id = ?').run(uid);
      return { bal, id };
    })();
    return { ok: true, gang: gangById(db, r.id)!, balance: r.bal };
  } catch (e) { return { ok: false, error: e instanceof WalletError ? 'Not enough money' : 'Could not create the gang' }; }
}
export function invite(db: DB, uid: number, targetId: number): Res<{ gang: GangInfo }> {
  const g = gangOf(db, uid); if (!g) return { ok: false, error: 'You are not in a gang' };
  if (g.ownerId !== uid) return { ok: false, error: 'Only the leader can invite' };
  if (targetId === uid) return { ok: false, error: 'You are already in it' };
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(targetId)) return { ok: false, error: 'No such player' };
  if (gangOf(db, targetId)) return { ok: false, error: 'That player is already in a gang' };
  if (members(db, g.id).length >= GANG_MAX_MEMBERS) return { ok: false, error: `Gangs are limited to ${GANG_MAX_MEMBERS} members` };
  db.prepare('INSERT OR REPLACE INTO gang_invites (gang_id, user_id, from_id, created_at) VALUES (?,?,?,?)').run(g.id, targetId, uid, Date.now());
  return { ok: true, gang: g };
}
export function respond(db: DB, uid: number, gangId: number, accept: boolean): Res<{ gang: GangInfo | null }> {
  const inv = db.prepare('SELECT 1 FROM gang_invites WHERE gang_id = ? AND user_id = ?').get(gangId, uid);
  if (!inv) return { ok: false, error: 'No such invite' };
  if (!accept) { db.prepare('DELETE FROM gang_invites WHERE gang_id = ? AND user_id = ?').run(gangId, uid); return { ok: true, gang: null }; }
  if (gangOf(db, uid)) return { ok: false, error: 'Leave your current gang first' };
  const g = gangById(db, gangId); if (!g) return { ok: false, error: 'That gang no longer exists' };
  if (members(db, g.id).length >= GANG_MAX_MEMBERS) return { ok: false, error: 'The gang is full' };
  db.transaction(() => {
    db.prepare('INSERT INTO gang_members (gang_id, user_id, role, joined_at) VALUES (?,?,?,?)').run(g.id, uid, 'member', Date.now());
    db.prepare('DELETE FROM gang_invites WHERE user_id = ?').run(uid);
  })();
  return { ok: true, gang: g };
}
/** leaving as the leader hands leadership to the longest-serving member, or disbands an empty gang */
export function leave(db: DB, uid: number): Res<{ gangId: number; disbanded: boolean }> {
  const g = gangOf(db, uid); if (!g) return { ok: false, error: 'You are not in a gang' };
  let disbanded = false;
  db.transaction(() => {
    db.prepare('DELETE FROM gang_members WHERE user_id = ?').run(uid);
    if (g.ownerId === uid) {
      const next = db.prepare('SELECT user_id FROM gang_members WHERE gang_id = ? ORDER BY joined_at LIMIT 1').get(g.id) as { user_id: number } | undefined;
      if (next) { db.prepare('UPDATE gangs SET owner_id = ? WHERE id = ?').run(next.user_id, g.id); db.prepare("UPDATE gang_members SET role = 'leader' WHERE user_id = ?").run(next.user_id); }
      else { db.prepare('DELETE FROM gangs WHERE id = ?').run(g.id); disbanded = true; }
    }
  })();
  return { ok: true, gangId: g.id, disbanded };
}
export function kick(db: DB, uid: number, targetId: number): Res<{ gangId: number }> {
  const g = gangOf(db, uid); if (!g || g.ownerId !== uid) return { ok: false, error: 'Only the leader can remove members' };
  if (targetId === uid) return { ok: false, error: 'Use Leave instead' };
  const r = db.prepare('DELETE FROM gang_members WHERE gang_id = ? AND user_id = ?').run(g.id, targetId);
  return r.changes ? { ok: true, gangId: g.id } : { ok: false, error: 'Not a member' };
}
export function updateGang(db: DB, uid: number, p: { color?: unknown; emblem?: unknown; friendlyFire?: unknown }): Res<{ gang: GangInfo }> {
  const g = gangOf(db, uid); if (!g || g.ownerId !== uid) return { ok: false, error: 'Only the leader can change gang settings' };
  const color = p.color === undefined ? g.color : GANG_COLORS.includes(String(p.color)) ? String(p.color) : null;
  const emblem = p.emblem === undefined ? g.emblem : GANG_EMBLEMS.includes(String(p.emblem)) ? String(p.emblem) : null;
  if (!color || !emblem) return { ok: false, error: 'Invalid colour or emblem' };
  const ff = p.friendlyFire === undefined ? g.friendlyFire : p.friendlyFire === true;
  db.prepare('UPDATE gangs SET color = ?, emblem = ?, friendly_fire = ? WHERE id = ?').run(color, emblem, ff ? 1 : 0, g.id);
  return { ok: true, gang: gangById(db, g.id)! };
}
export function postGangChat(db: DB, uid: number, body: unknown): Res<{ gangId: number; msg: GangMsg }> {
  const g = gangOf(db, uid); if (!g) return { ok: false, error: 'You are not in a gang' };
  const b = cleanBody(body); if (!b) return { ok: false, error: 'empty' };
  const at = Date.now();
  const id = Number(db.prepare('INSERT INTO gang_messages (gang_id, from_id, body, created_at) VALUES (?,?,?,?)').run(g.id, uid, b, at).lastInsertRowid);
  const name = (db.prepare('SELECT display_name FROM users WHERE id = ?').get(uid) as { display_name: string }).display_name;
  return { ok: true, gangId: g.id, msg: { id, from: uid, fromName: name, body: b, at } };
}
export function gangChat(db: DB, gangId: number, limit = 50): GangMsg[] {
  return (db.prepare('SELECT m.id, m.from_id, m.body, m.created_at, u.display_name FROM gang_messages m JOIN users u ON u.id = m.from_id WHERE m.gang_id = ? ORDER BY m.id DESC LIMIT ?')
    .all(gangId, limit) as { id: number; from_id: number; body: string; created_at: number; display_name: string }[]).reverse()
    .map((m) => ({ id: m.id, from: m.from_id, fromName: m.display_name, body: m.body, at: m.created_at }));
}
