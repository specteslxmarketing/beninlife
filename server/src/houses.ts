// Server-authoritative houses: purchase (wallet debit), lock/unlock, enter/exit with proximity + permission checks.
import type { DB } from './db.js';
import { applyTransaction, WalletError } from './wallet.js';
import { HOUSES, HOUSE_DOOR_RADIUS, houseById, houseAt, interiorExit, interiorSpawn, dist, ADMIN_USERNAME } from '../../shared/constants.js';

export interface HouseState { id: string; ownerId: number | null; ownerName: string | null; locked: boolean; weaponsAllowed: boolean }
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function seedHouses(db: DB): void {
  const ins = db.prepare('INSERT OR IGNORE INTO houses (id, owner_id, locked) VALUES (?, NULL, 1)');
  for (const h of HOUSES) ins.run(h.id);
  const admin = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USERNAME) as { id: number } | undefined;
  if (admin) db.prepare("UPDATE houses SET owner_id = ?, bought_at = COALESCE(bought_at, ?) WHERE id = 'mansion' AND owner_id IS NULL").run(admin.id, Date.now());
}

export function houseStates(db: DB): HouseState[] {
  const rows = db.prepare('SELECT h.id, h.owner_id, h.locked, h.weapons_allowed, u.display_name FROM houses h LEFT JOIN users u ON u.id = h.owner_id').all() as { id: string; owner_id: number | null; locked: number; weapons_allowed: number; display_name: string | null }[];
  return rows.filter((r) => houseById(r.id)).map((r) => ({ id: r.id, ownerId: r.owner_id, ownerName: r.display_name, locked: !!r.locked, weaponsAllowed: !!r.weapons_allowed }));
}
function state(db: DB, id: string): HouseState | undefined { return houseStates(db).find((h) => h.id === id); }

export function buyHouse(db: DB, uid: number, id: string, pos: { x: number; z: number }): Res<{ balance: number }> {
  const def = houseById(id); const st = state(db, id);
  if (!def || !st) return { ok: false, error: 'No such house' };
  if (!def.forSale) return { ok: false, error: 'This property is not for sale' };
  if (st.ownerId !== null) return { ok: false, error: st.ownerId === uid ? 'You already own this house' : 'Already owned by someone else' };
  if (dist(pos, def.door) > HOUSE_DOOR_RADIUS + 1) return { ok: false, error: 'Go to the house to buy it' };
  try {
    const bal = db.transaction(() => {
      const b = applyTransaction(db, uid, -def.price, 'house', `Bought ${def.name}`);
      const r = db.prepare('UPDATE houses SET owner_id = ?, locked = 1, bought_at = ? WHERE id = ? AND owner_id IS NULL').run(uid, Date.now(), id);
      if (r.changes !== 1) throw new WalletError('Already owned by someone else');
      return b;
    })();
    return { ok: true, balance: bal };
  } catch (e) { return { ok: false, error: e instanceof WalletError ? e.message : 'Purchase failed' }; }
}

export function setLock(db: DB, uid: number, id: string, locked: boolean): Res {
  const st = state(db, id);
  if (!st) return { ok: false, error: 'No such house' };
  if (st.ownerId !== uid) return { ok: false, error: 'Only the owner can lock or unlock' };
  db.prepare('UPDATE houses SET locked = ? WHERE id = ?').run(locked ? 1 : 0, id);
  return { ok: true };
}

/** Returns the teleport target if the player may enter (owner, or house unlocked) and is at the door on foot. */
export function canEnter(db: DB, uid: number, id: string, pos: { x: number; z: number }, inCar: boolean): Res<{ x: number; z: number; rot: number }> {
  const def = houseById(id); const st = state(db, id);
  if (!def || !st) return { ok: false, error: 'No such house' };
  if (inCar) return { ok: false, error: 'Get out of the car first' };
  if (dist(pos, def.door) > HOUSE_DOOR_RADIUS + 1) return { ok: false, error: 'You are not at the door' };
  if (st.ownerId === null) return { ok: false, error: 'This house is for sale — buy it to enter' };
  if (st.ownerId !== uid && st.locked) return { ok: false, error: def.kind === 'mansion' ? 'The guards stop you: private residence (locked)' : 'The door is locked' };
  return { ok: true, ...interiorSpawn(def) };
}

export function canExit(pos: { x: number; z: number }): Res<{ x: number; z: number; rot: number; house: string }> {
  const def = houseAt(pos.x, pos.z);
  if (!def) return { ok: false, error: 'You are not inside a house' };
  if (dist(pos, interiorExit(def)) > 3) return { ok: false, error: 'Walk to the front door to leave' };
  return { ok: true, x: def.door.x, z: def.door.z + (def.door.z < def.lot.z ? -1.2 : 1.2), rot: Math.PI, house: def.id };
}
