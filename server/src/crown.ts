// BEST 𝕏 (the owner's admin account) is always the richest player: a ₦5bn floor and always ₦1bn ahead of the next
// richest account. Top-ups are recorded as normal wallet transactions ("crown_reserve") so the ledger stays honest.
// Also: his main car is a white GLK 350-style SUV, parked at the mansion.
import type { DB } from './db.js';
import { applyTransaction } from './wallet.js';
import { ADMIN_USERNAME } from '../../shared/constants.js';

export const CROWN_FLOOR = 5_000_000_000;
export const CROWN_LEAD = 1_000_000_000;
export const CROWN_CAR = { model: 'glk', color: '#e9e9e4' };

function admin(db: DB): { id: number; balance: number } | undefined {
  return db.prepare('SELECT id, balance FROM users WHERE username = ?').get(ADMIN_USERNAME) as { id: number; balance: number } | undefined;
}
/** returns the amount topped up (0 if none) */
export function ensureCrown(db: DB): number {
  const a = admin(db); if (!a) return 0;
  const top = (db.prepare('SELECT MAX(balance) AS m FROM users WHERE id != ?').get(a.id) as { m: number | null }).m ?? 0;
  const want = Math.max(CROWN_FLOOR, top + CROWN_LEAD);
  if (a.balance >= want) return 0;
  applyTransaction(db, a.id, want - a.balance, 'crown_reserve', 'BEST 𝕏 crown reserve');
  return want - a.balance;
}
/** white GLK-style SUV as BEST 𝕏's active car (adds one if he doesn't own it; existing GLK is repainted white) */
export function ensureCrownCar(db: DB): void {
  const a = admin(db); if (!a) return;
  let v = db.prepare('SELECT id FROM vehicles WHERE owner_id = ? AND model = ? ORDER BY id LIMIT 1').get(a.id, CROWN_CAR.model) as { id: number } | undefined;
  if (!v) v = { id: Number(db.prepare('INSERT INTO vehicles (owner_id, model, color, bought_at) VALUES (?,?,?,?)').run(a.id, CROWN_CAR.model, CROWN_CAR.color, Date.now()).lastInsertRowid) };
  else db.prepare('UPDATE vehicles SET color = ? WHERE id = ?').run(CROWN_CAR.color, v.id);
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const done = db.prepare("SELECT value FROM meta WHERE key = 'crown_car'").get() as { value: string } | undefined;
  if (!done) { db.prepare('UPDATE users SET active_vehicle = ? WHERE id = ?').run(v.id, a.id); db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('crown_car', '1')").run(); }
}
export interface RichRow { rank: number; id: number; name: string; balance: number; admin: boolean }
export function richList(db: DB, limit = 20): RichRow[] {
  const rows = db.prepare('SELECT id, display_name AS name, balance, is_admin FROM users ORDER BY balance DESC, id ASC LIMIT ?').all(limit) as { id: number; name: string; balance: number; is_admin: number }[];
  return rows.map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, balance: r.balance, admin: !!r.is_admin }));
}
