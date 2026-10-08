// Combat, weapons, safe zones and gangs — shared constants + pure rules used by both server (authoritative) and client (UI/visuals).
import { CAR_STANDS, CLOTHING_STORE, LAGOS_AIRPORT, POLICE_STATION, inAirport, type Vec2, type Zone } from './constants.js';

// ---------- places ----------
/** Licensed firearms dealer (fictional). Buying needs a firearms licence and a clean record (no wanted stars). */
export const GUN_SHOP = { name: 'Ekehuan Arms & Licensing', door: { x: 68, z: -12.4 } as Vec2, radius: 4.5 };
/** Knocked-down players are treated here; respawn costs a hospital fee. */
export const HOSPITAL = { name: 'Ogbe General Hospital', door: { x: -100, z: -12.4 } as Vec2, respawn: { x: -100, z: -10.2, rot: Math.PI }, fee: 2500 };

/** Weapons are disabled inside these zones (and inside houses unless the owner allows it, and on the plane). */
export const SAFE_ZONES: (Zone & { name: string })[] = [
  { name: HOSPITAL.name, x: -100, z: -17, w: 26, d: 22 },
  { name: POLICE_STATION.name, x: 100, z: -17, w: 28, d: 22 },
  { name: CLOTHING_STORE.name, x: 42, z: -16, w: 20, d: 18 },
  { name: GUN_SHOP.name, x: 68, z: -17, w: 22, d: 20 },
  { name: 'Car Stands', x: CAR_STANDS.x + 1.5, z: CAR_STANDS.z, w: CAR_STANDS.w + 6, d: CAR_STANDS.d + 6 },
  { name: 'Lagos airport', x: LAGOS_AIRPORT.x, z: LAGOS_AIRPORT.z, w: LAGOS_AIRPORT.w + 20, d: LAGOS_AIRPORT.d + 30 },
];
/** name of the safe zone at a point, or null. `inHouse` is passed by the caller (house interiors + owner setting). */
export function safeZoneAt(x: number, z: number): string | null {
  if (inAirport(x, z)) return 'Benin Airport';
  for (const s of SAFE_ZONES) if (Math.abs(x - s.x) <= s.w / 2 && Math.abs(z - s.z) <= s.d / 2) return s.name;
  return null;
}

// ---------- weapons ----------
export type WeaponId = 'pistol' | 'smg' | 'shotgun';
export interface WeaponDef {
  id: WeaponId; name: string; desc: string; price: number; ammoPrice: number; ammoPack: number;
  damage: number; pellets: number; intervalMs: number; mag: number; reloadMs: number;
  range: number; spread: number; recoil: number; falloffStart: number; maxReserve: number;
}
// Generic, fictional weapons — no real manufacturers or model names.
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: { id: 'pistol', name: 'Sentry 9 pistol', desc: 'Compact 9 mm semi-automatic. 12-round magazine.', price: 180_000, ammoPrice: 2_500, ammoPack: 24,
    damage: 24, pellets: 1, intervalMs: 280, mag: 12, reloadMs: 1500, range: 50, spread: 0.012, recoil: 0.035, falloffStart: 25, maxReserve: 96 },
  smg: { id: 'smg', name: 'Harmattan SMG', desc: 'Compact automatic. Fast fire, 30-round magazine, short range.', price: 650_000, ammoPrice: 6_000, ammoPack: 60,
    damage: 13, pellets: 1, intervalMs: 95, mag: 30, reloadMs: 2100, range: 38, spread: 0.035, recoil: 0.02, falloffStart: 15, maxReserve: 180 },
  shotgun: { id: 'shotgun', name: 'Bulwark 12 pump shotgun', desc: 'Pump-action 12 gauge. Devastating up close, 6 shells.', price: 900_000, ammoPrice: 5_000, ammoPack: 12,
    damage: 11, pellets: 8, intervalMs: 850, mag: 6, reloadMs: 3000, range: 22, spread: 0.075, recoil: 0.09, falloffStart: 8, maxReserve: 48 },
};
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const isWeaponId = (v: unknown): v is WeaponId => typeof v === 'string' && v in WEAPONS;
export const LICENCE_PRICE = 50_000;
export const ARMOUR_PRICE = 120_000;
export const ARMOUR_MAX = 100;
/** fraction of incoming damage the vest soaks while it has points left */
export const ARMOUR_ABSORB = 0.65;
export const HEALTH_MAX = 100;
export const DOWNED_MS = 10_000;           // lying wounded before being taken to hospital
export const HEADSHOT_MULT = 1.8;
export const HEALTH_REGEN_DELAY_MS = 20_000; // slow regeneration after being out of combat
export const HEALTH_REGEN_PER_S = 1;
export const EYE_HEIGHT = 1.5;
export const BODY_RADIUS = 0.42;
export const BODY_HEIGHT = 1.8;
export const POLICE_SHOTS_STARS = 1;       // shots fired in public (witnesses call it in)
export const POLICE_HIT_STARS = 2;         // wounding someone
export const POLICE_DOWN_STARS = 3;        // knocking someone down

/** damage multiplier by distance (full up to falloffStart, linearly to 40 % at max range) */
export function falloff(w: WeaponDef, d: number): number {
  if (d <= w.falloffStart) return 1;
  return Math.max(0.4, 1 - 0.6 * (d - w.falloffStart) / Math.max(1, w.range - w.falloffStart));
}
/** apply damage to health/armour; returns new values and how much the vest took */
export function applyDamage(health: number, armour: number, dmg: number): { health: number; armour: number } {
  let toArmour = armour > 0 ? Math.min(armour, dmg * ARMOUR_ABSORB) : 0;
  toArmour = Math.round(toArmour * 10) / 10;
  const toHealth = dmg - toArmour;
  return { health: Math.max(0, Math.round((health - toHealth) * 10) / 10), armour: Math.max(0, Math.round((armour - toArmour) * 10) / 10) };
}

// ---------- geometry (server hit test + line of sight) ----------
export interface V3 { x: number; y: number; z: number }
export interface Box2 { minX: number; maxX: number; minZ: number; maxZ: number }
export const dirFrom = (yaw: number, pitch: number): V3 => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });
export function normalize(v: V3): V3 { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
/**
 * Ray (origin o, unit dir d, length L) vs a standing body: vertical capsule from y=0.1 to BODY_HEIGHT at (cx, cz).
 * Returns distance along the ray and the hit height, or null.
 */
export function rayBody(o: V3, d: V3, L: number, cx: number, cz: number, radius = BODY_RADIUS, baseY = 0, height = BODY_HEIGHT): { t: number; y: number } | null {
  // closest approach between the ray and the vertical axis line (2D in xz), then clamp height
  const dx = d.x, dz = d.z, ox = o.x - cx, oz = o.z - cz;
  const a = dx * dx + dz * dz;
  let t: number;
  if (a < 1e-9) t = 0; else t = -(ox * dx + oz * dz) / a;
  if (t < 0 || t > L) return null;
  // solve for entry point into the cylinder for a nicer hit position
  const px = ox + dx * t, pz = oz + dz * t; const dist2 = px * px + pz * pz;
  if (dist2 > radius * radius) return null;
  const back = a > 1e-9 ? Math.sqrt((radius * radius - dist2) / a) : 0;
  const te = Math.max(0, t - back);
  const y = o.y + d.y * te;
  if (y < baseY + 0.05 || y > baseY + height + 0.1) return null;
  return { t: te, y: y - baseY };
}
/** first distance along a 2D segment where it enters a box (slab test), or null */
export function segBox(ax: number, az: number, bx: number, bz: number, b: Box2): number | null {
  const dx = bx - ax, dz = bz - az; let t0 = 0, t1 = 1;
  for (const [p, d, mn, mx] of [[ax, dx, b.minX, b.maxX], [az, dz, b.minZ, b.maxZ]] as const) {
    if (Math.abs(d) < 1e-9) { if (p < mn || p > mx) return null; continue; }
    let ta = (mn - p) / d, tb = (mx - p) / d; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null;
  }
  return t0;
}
/** fraction (0..1) along a→b where a wall blocks the line, or 1 when clear */
export function lineOfSight(a: Vec2, b: Vec2, boxes: Box2[]): number {
  let best = 1;
  for (const bx of boxes) {
    if (Math.max(a.x, b.x) < bx.minX || Math.min(a.x, b.x) > bx.maxX || Math.max(a.z, b.z) < bx.minZ || Math.min(a.z, b.z) > bx.maxZ) continue;
    if (a.x >= bx.minX && a.x <= bx.maxX && a.z >= bx.minZ && a.z <= bx.maxZ) continue; // shooter standing inside a prop footprint: ignore it
    const t = segBox(a.x, a.z, b.x, b.z, bx); if (t !== null && t < best) best = t;
  }
  return best;
}

// ---------- gangs ----------
export const GANG_CREATE_PRICE = 25_000;
export const GANG_MAX_MEMBERS = 20;
export const GANG_COLORS = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9', '#8e44ad', '#ecf0f1', '#7f8c8d', '#d35400', '#ff6fa8', '#00c2d1'];
/** original emblem set — deliberately avoids axes, birds/eagles, skulls & crossbones, anchors, horns and other confraternity symbols */
export const GANG_EMBLEMS = ['◆', '★', '⚡', '🔥', '🌊', '🌴', '🥁', '⬢', '☀', '🌙', '🛞', '🎲'];
/**
 * Names (and common spellings) of real Nigerian cults/confraternities and their aliases. Gangs in BENINLIFE are
 * fictional; any name containing one of these (after normalising case, spacing, punctuation and leetspeak) is refused.
 */
export const BANNED_GANG_TERMS = [
  'blackaxe', 'axeman', 'axemen', 'neoblack', 'nbm', 'eiye', 'eiy', 'airlord', 'supremeeiye', 'buccaneer', 'buccaneers', 'seadog', 'seadogs', 'pyrate', 'pirate',
  'nas', 'viking', 'vikings', 'aiye', 'aiyetoro', 'maphite', 'maphites', 'mafite', 'mephite', 'greencircuit', 'klansman', 'klan', 'kkk', 'kk', 'klanskonfraternity',
  'blackberet', 'deywell', 'deebam', 'deygbam', 'dbam', 'icelander', 'greenlander', 'bobos', 'jurist', 'mgba', 'blackcat', 'redsea', 'jezebel', 'blackbra', 'templeofeden',
  'whiteangel', 'barracuda', 'mafia', 'scorpion', 'cult', 'confraternity', 'fraternity', 'secretsociety', 'ogboni', 'shiite', 'boko', 'iswap', 'ipob', 'esn', 'arobaga',
];
export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[0@4]/g, (c) => (c === '0' ? 'o' : 'a')).replace(/[1!|]/g, 'i').replace(/3/g, 'e').replace(/[5$]/g, 's').replace(/7/g, 't').replace(/[^a-z]/g, '');
}
const SHORT_TERMS = new Set(['nbm', 'nas', 'kk', 'kkk', 'esn', 'eiy', 'klan', 'boko']);
export function validGangName(raw: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'Name required' };
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 24) return { ok: false, error: 'Gang name must be 3–24 characters' };
  if (!/^[\p{L}\p{N} '&.-]+$/u.test(name)) return { ok: false, error: 'Letters, numbers, spaces and \' & . - only' };
  const n = normaliseName(name); const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(normaliseName);
  for (const t of BANNED_GANG_TERMS) {
    if (SHORT_TERMS.has(t) ? words.includes(t) : n.includes(t)) return { ok: false, error: 'That name refers to a real cult/confraternity or group — gangs here must be fictional' };
  }
  return { ok: true, name };
}
export function validGangTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null; const t = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(t)) return null;
  const n = normaliseName(t); if (BANNED_GANG_TERMS.some((b) => n === b || (b.length <= 4 && n.includes(b) && b.length >= 2 && SHORT_TERMS.has(b)))) return null;
  return t;
}
