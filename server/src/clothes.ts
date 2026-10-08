// Clothing store: server-authoritative purchase (₦ debited via applyTransaction), ownership in `items`, worn style in users.outfit.
import type { DB } from './db.js';
import { applyTransaction, WalletError } from './wallet.js';
import { CLOTHING_STORE, clothById, dist, type OutfitStyle, type Vec2 } from '../../shared/constants.js';

export function ownedClothes(db: DB, userId: number, admin: boolean): OutfitStyle[] {
  const rows = db.prepare("SELECT item FROM items WHERE owner_id = ? AND item LIKE 'cloth:%'").all(userId) as { item: string }[];
  const owned = new Set<OutfitStyle>(['casual', ...rows.map((r) => r.item.slice(6) as OutfitStyle)]);
  if (admin) owned.add('white_suit'); // BEST 𝕏's signature look
  return [...owned];
}
export function wornStyle(db: DB, userId: number, admin: boolean): OutfitStyle {
  const r = db.prepare('SELECT outfit FROM users WHERE id = ?').get(userId) as { outfit: string | null } | undefined;
  const s = r?.outfit && clothById(r.outfit) ? (r.outfit as OutfitStyle) : null;
  return s ?? (admin ? 'white_suit' : 'casual');
}
export type Res<T> = { ok: true; value: T } | { ok: false; error: string };
export function buyClothes(db: DB, userId: number, admin: boolean, id: unknown, pos: Vec2, onFoot: boolean): Res<{ style: OutfitStyle; balance: number }> {
  const c = clothById(id);
  if (!c || c.price <= 0) return { ok: false, error: 'Not for sale' };
  if (!onFoot || dist(pos, CLOTHING_STORE.door) > CLOTHING_STORE.radius) return { ok: false, error: `Go inside ${CLOTHING_STORE.name} to buy clothes` };
  if (ownedClothes(db, userId, admin).includes(c.id)) return { ok: false, error: 'You already own this' };
  try {
    const run = db.transaction(() => {
      const bal = applyTransaction(db, userId, -c.price, 'clothes', `${c.name} — ${CLOTHING_STORE.name}`);
      db.prepare('INSERT INTO items (owner_id, item, bought_at) VALUES (?,?,?)').run(userId, 'cloth:' + c.id, Date.now());
      db.prepare('UPDATE users SET outfit = ? WHERE id = ?').run(c.id, userId);
      return bal;
    });
    return { ok: true, value: { style: c.id, balance: run() } };
  } catch (e) { return { ok: false, error: e instanceof WalletError ? (e.message === 'insufficient funds' ? 'Not enough money' : e.message) : 'error' }; }
}
export function wearClothes(db: DB, userId: number, admin: boolean, id: unknown): Res<OutfitStyle> {
  const c = clothById(id);
  if (!c) return { ok: false, error: 'Unknown outfit' };
  if (!ownedClothes(db, userId, admin).includes(c.id)) return { ok: false, error: 'You don\'t own that yet' };
  db.prepare('UPDATE users SET outfit = ? WHERE id = ?').run(c.id, userId);
  return { ok: true, value: c.id };
}
