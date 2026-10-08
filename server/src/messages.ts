import type { DB } from './db.js';

export interface MsgRow { id: number; channel: string; from_id: number; to_id: number | null; body: string; created_at: number; read_at: number | null; from_name?: string }

export function cleanBody(b: unknown): string | null {
  if (typeof b !== 'string') return null;
  const t = b.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);
  return t.length ? t : null;
}

export function saveGlobal(db: DB, fromId: number, body: string): MsgRow {
  const now = Date.now();
  const info = db.prepare('INSERT INTO messages (channel, from_id, body, created_at) VALUES (\'global\',?,?,?)').run(fromId, body, now);
  return db.prepare('SELECT m.*, u.display_name AS from_name FROM messages m JOIN users u ON u.id = m.from_id WHERE m.id = ?').get(info.lastInsertRowid) as MsgRow;
}
export function recentGlobal(db: DB, limit = 40): MsgRow[] {
  const rows = db.prepare('SELECT m.*, u.display_name AS from_name FROM messages m JOIN users u ON u.id = m.from_id WHERE channel = \'global\' ORDER BY m.id DESC LIMIT ?').all(limit) as MsgRow[];
  return rows.reverse();
}
export function saveDm(db: DB, fromId: number, toId: number, body: string): MsgRow {
  const info = db.prepare('INSERT INTO messages (channel, from_id, to_id, body, created_at) VALUES (\'dm\',?,?,?,?)').run(fromId, toId, body, Date.now());
  return db.prepare('SELECT m.*, u.display_name AS from_name FROM messages m JOIN users u ON u.id = m.from_id WHERE m.id = ?').get(info.lastInsertRowid) as MsgRow;
}
export function dmThread(db: DB, a: number, b: number, limit = 100): MsgRow[] {
  const rows = db.prepare(`SELECT m.*, u.display_name AS from_name FROM messages m JOIN users u ON u.id = m.from_id
    WHERE channel = 'dm' AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) ORDER BY m.id DESC LIMIT ?`).all(a, b, b, a, limit) as MsgRow[];
  return rows.reverse();
}
export function markRead(db: DB, readerId: number, otherId: number): void {
  db.prepare('UPDATE messages SET read_at = ? WHERE channel = \'dm\' AND to_id = ? AND from_id = ? AND read_at IS NULL').run(Date.now(), readerId, otherId);
}
export function unreadCounts(db: DB, userId: number): Record<number, number> {
  const rows = db.prepare('SELECT from_id, COUNT(*) AS n FROM messages WHERE channel = \'dm\' AND to_id = ? AND read_at IS NULL GROUP BY from_id').all(userId) as { from_id: number; n: number }[];
  const out: Record<number, number> = {};
  for (const r of rows) out[r.from_id] = r.n;
  return out;
}
