// Server-authoritative vehicle ownership: buying at BEST 𝕏 Car Stands, choosing the active car, home parking spot.
import type { DB } from './db.js';
import { applyTransaction, WalletError } from './wallet.js';
import { ADMIN_USERNAME, CAR_MODELS, DEALER_RADIUS, DISPLAY_SLOTS, HOUSES, PARKING_SLOTS, carModel, dist } from '../../shared/constants.js';

export interface VehicleRow { id: number; owner_id: number; model: string; color: string; bought_at: number }
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function listVehicles(db: DB, uid: number): VehicleRow[] {
  return db.prepare('SELECT * FROM vehicles WHERE owner_id = ? ORDER BY id').all(uid) as VehicleRow[];
}
export function activeVehicle(db: DB, uid: number): { id: number | null; model: string; color: string } {
  const u = db.prepare('SELECT active_vehicle FROM users WHERE id = ?').get(uid) as { active_vehicle: number | null } | undefined;
  if (u?.active_vehicle) {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ? AND owner_id = ?').get(u.active_vehicle, uid) as VehicleRow | undefined;
    if (v) return { id: v.id, model: v.model, color: v.color };
  }
  const starterColors = ['#5b6770', '#7a1d1d', '#1d2e4a', '#d9d9d4', '#2a2a2c', '#4a5a3a', '#8a7a5a', '#3a4a5c'];
  return { id: null, model: 'starter', color: starterColors[uid % starterColors.length] };
}
/** Where a player's active car is delivered: their house (roadside in front), BEST 𝕏's gate, else the public car park. */
export function homeSpot(db: DB, uid: number): { x: number; z: number; rot: number } {
  const owned = db.prepare('SELECT id FROM houses WHERE owner_id = ? ORDER BY bought_at').all(uid) as { id: string }[];
  const defs = owned.map((o) => HOUSES.find((h) => h.id === o.id));
  const house = defs.find((h) => h && h.kind === 'mansion') ?? defs.find(Boolean); // the mansion owner parks at the mansion
  if (house) return house.kind === 'mansion' ? { x: 126, z: 10.2, rot: -Math.PI / 2 } : { x: house.door.x + 4.5, z: 11.8, rot: Math.PI / 2 };
  return PARKING_SLOTS[uid % PARKING_SLOTS.length];
}

export function buyCar(db: DB, uid: number, modelId: string, color: string, pos: { x: number; z: number }): Res<{ vehicle: VehicleRow; balance: number }> {
  const m = CAR_MODELS.find((c) => c.id === modelId);
  if (!m) return { ok: false, error: 'No such car' };
  const slot = DISPLAY_SLOTS.find((s) => s.model === modelId)!;
  if (dist(pos, slot) > DEALER_RADIUS + 1) return { ok: false, error: 'Walk up to the car at BEST 𝕏 Car Stands to buy it' };
  const col = m.colors.includes(color) ? color : m.colors[0];
  try {
    return db.transaction(() => {
      const balance = applyTransaction(db, uid, -m.price, 'car', `Bought ${m.name}`);
      const info = db.prepare('INSERT INTO vehicles (owner_id, model, color, bought_at) VALUES (?,?,?,?)').run(uid, m.id, col, Date.now());
      db.prepare('UPDATE users SET active_vehicle = ? WHERE id = ?').run(info.lastInsertRowid, uid);
      const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(info.lastInsertRowid) as VehicleRow;
      return { ok: true as const, vehicle, balance };
    })();
  } catch (e) { return { ok: false, error: e instanceof WalletError ? e.message : 'Purchase failed' }; }
}

export function setActive(db: DB, uid: number, vehicleId: number | null): Res {
  if (vehicleId !== null) {
    const v = db.prepare('SELECT id FROM vehicles WHERE id = ? AND owner_id = ?').get(vehicleId, uid);
    if (!v) return { ok: false, error: 'You do not own that car' };
  }
  db.prepare('UPDATE users SET active_vehicle = ? WHERE id = ?').run(vehicleId, uid);
  return { ok: true };
}

/** BEST 𝕏 starts with a white GLK-style SUV (main car), an RX 350-style SUV and an ES 350-style sedan. */
export function seedAdminVehicles(db: DB): void {
  const admin = db.prepare('SELECT id, active_vehicle FROM users WHERE username = ?').get(ADMIN_USERNAME) as { id: number; active_vehicle: number | null } | undefined;
  if (!admin || listVehicles(db, admin.id).length) return;
  const ins = db.prepare('INSERT INTO vehicles (owner_id, model, color, bought_at) VALUES (?,?,?,?)');
  const ids = [['glk', '#e9e9e4'], ['rx350', '#e9e9e4'], ['es350', '#7a7f86']].map(([m, c]) => Number(ins.run(admin.id, m, c, Date.now()).lastInsertRowid));
  db.prepare('UPDATE users SET active_vehicle = ? WHERE id = ?').run(ids[0], admin.id);
  void carModel;
}
