// Server-authoritative weapons: licence/weapon/ammo/armour purchases (wallet debits), shot validation and hit resolution.
// The client only sends an aim direction; the server owns position, ammo, fire rate, spread, range, line of sight and damage.
import type { DB } from './db.js';
import { applyTransaction, WalletError } from './wallet.js';
import { dist, type Vec2 } from '../../shared/constants.js';
import {
  ARMOUR_MAX, ARMOUR_PRICE, BODY_RADIUS, EYE_HEIGHT, GUN_SHOP, HEADSHOT_MULT, LICENCE_PRICE, WEAPONS, falloff, isWeaponId, lineOfSight, normalize, rayBody,
  type Box2, type V3, type WeaponDef, type WeaponId,
} from '../../shared/combat.js';

type Res<T> = { ok: true; value: T } | { ok: false; error: string };
export interface Ammo { mag: number; reserve: number }
export interface Arsenal { licence: boolean; armour: number; weapons: Partial<Record<WeaponId, Ammo>> }

export function migrateCombat(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weapons (
      owner_id INTEGER NOT NULL REFERENCES users(id), weapon TEXT NOT NULL,
      mag INTEGER NOT NULL DEFAULT 0, reserve INTEGER NOT NULL DEFAULT 0, bought_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, weapon)
    );`);
  for (const col of ['gun_licence INTEGER NOT NULL DEFAULT 0', 'armour REAL NOT NULL DEFAULT 0']) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* exists */ }
  }
  try { db.exec('ALTER TABLE houses ADD COLUMN weapons_allowed INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }
}

export function loadArsenal(db: DB, uid: number): Arsenal {
  const u = db.prepare('SELECT gun_licence, armour FROM users WHERE id = ?').get(uid) as { gun_licence: number; armour: number } | undefined;
  const rows = db.prepare('SELECT weapon, mag, reserve FROM weapons WHERE owner_id = ?').all(uid) as { weapon: string; mag: number; reserve: number }[];
  const weapons: Arsenal['weapons'] = {};
  for (const r of rows) if (isWeaponId(r.weapon)) weapons[r.weapon] = { mag: r.mag, reserve: r.reserve };
  return { licence: !!u?.gun_licence, armour: u?.armour ?? 0, weapons };
}
export function saveAmmo(db: DB, uid: number, w: WeaponId, a: Ammo): void {
  db.prepare('UPDATE weapons SET mag = ?, reserve = ? WHERE owner_id = ? AND weapon = ?').run(a.mag, a.reserve, uid, w);
}
export function saveArmour(db: DB, uid: number, armour: number): void { db.prepare('UPDATE users SET armour = ? WHERE id = ?').run(armour, uid); }

export interface ShopCtx { pos: Vec2; onFoot: boolean; wanted: number }
function shopCheck(c: ShopCtx): string | null {
  if (!c.onFoot) return 'Get out of the car first';
  if (dist(c.pos, GUN_SHOP.door) > GUN_SHOP.radius + 1) return `Go to ${GUN_SHOP.name} to buy`;
  if (c.wanted > 0) return 'The dealer refuses — you are wanted by the police';
  return null;
}
function pay(db: DB, uid: number, amount: number, kind: string, note: string, extra: () => void): Res<number> {
  try {
    const bal = db.transaction(() => { const b = applyTransaction(db, uid, -amount, kind, note); extra(); return b; })();
    return { ok: true, value: bal };
  } catch (e) { return { ok: false, error: e instanceof WalletError ? (e.message === 'insufficient funds' ? 'Not enough money' : e.message) : 'Purchase failed' }; }
}

export function buyLicence(db: DB, uid: number, c: ShopCtx): Res<number> {
  const e = shopCheck(c); if (e) return { ok: false, error: e };
  if (loadArsenal(db, uid).licence) return { ok: false, error: 'You already hold a firearms licence' };
  return pay(db, uid, LICENCE_PRICE, 'gun_licence', `Firearms licence — ${GUN_SHOP.name}`, () => db.prepare('UPDATE users SET gun_licence = 1 WHERE id = ?').run(uid));
}
export function buyWeapon(db: DB, uid: number, id: unknown, c: ShopCtx): Res<number> {
  const e = shopCheck(c); if (e) return { ok: false, error: e };
  if (!isWeaponId(id)) return { ok: false, error: 'No such weapon' };
  const a = loadArsenal(db, uid);
  if (!a.licence) return { ok: false, error: 'A firearms licence is required first' };
  if (a.weapons[id]) return { ok: false, error: 'You already own this weapon' };
  const w = WEAPONS[id];
  return pay(db, uid, w.price, 'gun_buy', `${w.name} — ${GUN_SHOP.name}`,
    () => db.prepare('INSERT INTO weapons (owner_id, weapon, mag, reserve, bought_at) VALUES (?,?,?,?,?)').run(uid, id, w.mag, w.ammoPack, Date.now()));
}
export function buyAmmo(db: DB, uid: number, id: unknown, c: ShopCtx): Res<number> {
  const e = shopCheck(c); if (e) return { ok: false, error: e };
  if (!isWeaponId(id)) return { ok: false, error: 'No such weapon' };
  const own = loadArsenal(db, uid).weapons[id];
  if (!own) return { ok: false, error: 'Buy the weapon first' };
  const w = WEAPONS[id];
  if (own.reserve >= w.maxReserve) return { ok: false, error: 'You cannot carry more ammunition' };
  return pay(db, uid, w.ammoPrice, 'gun_ammo', `Ammunition (${w.ammoPack}) for ${w.name}`,
    () => db.prepare('UPDATE weapons SET reserve = MIN(?, reserve + ?) WHERE owner_id = ? AND weapon = ?').run(w.maxReserve, w.ammoPack, uid, id));
}
export function buyArmour(db: DB, uid: number, c: ShopCtx): Res<number> {
  const e = shopCheck(c); if (e) return { ok: false, error: e };
  if (loadArsenal(db, uid).armour >= ARMOUR_MAX) return { ok: false, error: 'Your vest is already at full strength' };
  return pay(db, uid, ARMOUR_PRICE, 'armour', `Body armour vest — ${GUN_SHOP.name}`, () => saveArmour(db, uid, ARMOUR_MAX));
}

// ---------- shots ----------
export interface Target { id: number; x: number; z: number; inCar: boolean; protected: boolean }
export interface PelletHit { id: number | null; point: V3; dmg: number; head: boolean; dist: number }
/** deterministic-per-call RNG is injected for tests */
export function resolveShot(shooter: { x: number; z: number }, aim: V3, w: WeaponDef, targets: Target[], walls: Box2[], rand: () => number = Math.random): PelletHit[] {
  const o: V3 = { x: shooter.x, y: EYE_HEIGHT, z: shooter.z };
  const base = normalize(aim);
  // orthonormal basis around the aim for the spread cone
  const up: V3 = Math.abs(base.y) > 0.95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const r1 = normalize({ x: up.y * base.z - up.z * base.y, y: up.z * base.x - up.x * base.z, z: up.x * base.y - up.y * base.x });
  const r2 = { x: base.y * r1.z - base.z * r1.y, y: base.z * r1.x - base.x * r1.z, z: base.x * r1.y - base.y * r1.x };
  const out: PelletHit[] = [];
  for (let p = 0; p < w.pellets; p++) {
    const a = rand() * Math.PI * 2, s = Math.sqrt(rand()) * w.spread;
    const d = normalize({ x: base.x + (r1.x * Math.cos(a) + r2.x * Math.sin(a)) * s, y: base.y + (r1.y * Math.cos(a) + r2.y * Math.sin(a)) * s, z: base.z + (r1.z * Math.cos(a) + r2.z * Math.sin(a)) * s });
    // ground hit
    let maxT = w.range; if (d.y < -1e-3) maxT = Math.min(maxT, -o.y / d.y);
    const end = { x: o.x + d.x * maxT, z: o.z + d.z * maxT };
    const wallFrac = lineOfSight({ x: o.x, z: o.z }, end, walls); maxT *= wallFrac;
    let best: { t: number; y: number; tg: Target } | null = null;
    for (const tg of targets) {
      const h = tg.inCar ? rayBody(o, d, maxT, tg.x, tg.z, BODY_RADIUS + 0.1, 0.55, 1.05) : rayBody(o, d, maxT, tg.x, tg.z);
      if (h && (!best || h.t < best.t)) best = { ...h, tg };
    }
    if (best) {
      const head = !best.tg.inCar && best.y > 1.52;
      let dmg = w.damage * falloff(w, best.t) * (head ? HEADSHOT_MULT : 1) * (best.tg.inCar ? 0.6 : 1);
      if (best.tg.protected) dmg = 0;
      out.push({ id: best.tg.id, point: { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t }, dmg: Math.round(dmg * 10) / 10, head, dist: best.t });
    } else out.push({ id: null, point: { x: o.x + d.x * maxT, y: o.y + d.y * maxT, z: o.z + d.z * maxT }, dmg: 0, head: false, dist: maxT });
  }
  return out;
}

export interface FireState { lastShot: number; reloadUntil: number; burst: number[] }
/** fire-rate / magazine / aim sanity checks. Returns an error code or null. */
export function fireCheck(f: FireState, w: WeaponDef, ammo: Ammo | undefined, aim: unknown, now: number): { ok: true; aim: V3 } | { ok: false; error: string } {
  if (!ammo) return { ok: false, error: 'no_weapon' };
  if (now < f.reloadUntil) return { ok: false, error: 'reloading' };
  if (ammo.mag <= 0) return { ok: false, error: 'empty' };
  if (now - f.lastShot < w.intervalMs * 0.8) return { ok: false, error: 'rate' };
  f.burst = f.burst.filter((t) => now - t < 1000);
  if (f.burst.length >= Math.ceil(1000 / w.intervalMs) + 2) return { ok: false, error: 'rate' };
  const a = aim as Partial<V3> | null;
  if (!a || ![a.x, a.y, a.z].every((v) => typeof v === 'number' && Number.isFinite(v))) return { ok: false, error: 'bad_aim' };
  const n = normalize(a as V3);
  if (Math.abs(n.y) > 0.87) return { ok: false, error: 'bad_aim' }; // ±60° pitch
  f.lastShot = now; f.burst.push(now);
  return { ok: true, aim: n };
}
export function reload(ammo: Ammo, w: WeaponDef): { ammo: Ammo; loaded: number } {
  const need = w.mag - ammo.mag; const loaded = Math.min(need, ammo.reserve);
  return { ammo: { mag: ammo.mag + loaded, reserve: ammo.reserve - loaded }, loaded };
}
