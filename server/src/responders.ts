// Police response units (server-simulated NPCs). When a player is wanted for violence, officers leave the police
// station by car, follow the roads to the suspect, then close in on foot and arrest them when they stop.
import { POLICE_STATION, ARREST_RADIUS, type Vec2 } from '../../shared/constants.js';
import { lineOfSight, type Box2 } from '../../shared/combat.js';
import { roadRoute, type Pt } from '../../shared/roads.js';

export interface Responder {
  id: number; target: number; x: number; z: number; rot: number;
  mode: 'car' | 'foot'; path: Pt[]; repathAt: number; holdMs: number; carX: number; carZ: number; carRot: number;
}
export const RESPONDER_CAR_SPEED = 15;   // m/s (~54 km/h) — a fast car can outrun them
export const RESPONDER_FOOT_SPEED = 6.6; // m/s — slower than a sprinting player
export const RESPONDER_DISMOUNT = 22;    // leave the car within this distance of the suspect
export const ARREST_HOLD_MS = 1600;      // suspect must stay within reach (and slow) this long
export const unitsFor = (wanted: number) => (wanted >= 4 ? 3 : wanted >= 2 ? 2 : wanted >= 1 ? 1 : 0);

let nextId = 1;
export function spawnResponder(target: number, i: number): Responder {
  const s = { x: POLICE_STATION.door.x - 6 + i * 6, z: POLICE_STATION.door.z + 6 };
  return { id: nextId++, target, x: s.x, z: s.z, rot: 0, mode: 'car', path: [], repathAt: 0, holdMs: 0, carX: s.x, carZ: s.z, carRot: 0 };
}

export interface SuspectView { pos: Vec2; speed: number; inCar: boolean; downed: boolean; inside: boolean }
/** advance one unit by dt seconds. Returns 'arrest' when the suspect is caught. */
export function stepResponder(r: Responder, s: SuspectView, dt: number, now: number, walls: Box2[]): 'arrest' | null {
  const dx = s.pos.x - r.x, dz = s.pos.z - r.z, d = Math.hypot(dx, dz);
  if (r.mode === 'car') {
    if (d < RESPONDER_DISMOUNT && !s.inCar) { r.mode = 'foot'; r.carX = r.x; r.carZ = r.z; r.carRot = r.rot; r.x += Math.cos(r.rot) * 1.4; r.z -= Math.sin(r.rot) * 1.4; }
    else {
      if (now > r.repathAt || !r.path.length) { r.path = roadRoute(r.x, r.z, s.pos.x, s.pos.z); r.repathAt = now + 2500; }
      // drive straight at the suspect when the road ahead is clear and close
      const direct = d < 45 && lineOfSight({ x: r.x, z: r.z }, s.pos, walls) >= 0.999;
      let [tx, tz] = direct ? [s.pos.x, s.pos.z] : r.path[0]!;
      if (!direct && Math.hypot(tx - r.x, tz - r.z) < 4) { r.path.shift(); if (!r.path.length) return null; [tx, tz] = r.path[0]!; }
      moveToward(r, tx, tz, RESPONDER_CAR_SPEED * dt, 2.8);
      r.carX = r.x; r.carZ = r.z; r.carRot = r.rot;
    }
    return null;
  }
  // on foot: re-enter the car if the suspect drives off
  if (s.inCar && d > RESPONDER_DISMOUNT * 1.6) { r.mode = 'car'; r.x = r.carX; r.z = r.carZ; r.rot = r.carRot; r.path = []; r.holdMs = 0; return null; }
  if (d > ARREST_RADIUS * 0.45) moveToward(r, s.pos.x, s.pos.z, RESPONDER_FOOT_SPEED * dt, ARREST_RADIUS * 0.45);
  if (d < ARREST_RADIUS && !s.inside && (s.downed || (s.speed < 2.2 && !s.inCar))) { r.holdMs += dt * 1000; if (r.holdMs >= ARREST_HOLD_MS) return 'arrest'; }
  else r.holdMs = Math.max(0, r.holdMs - dt * 2000);
  return null;
}
function moveToward(r: Responder, tx: number, tz: number, step: number, stopAt: number): void {
  const dx = tx - r.x, dz = tz - r.z, d = Math.hypot(dx, dz);
  if (d < 1e-3) return;
  const want = Math.atan2(dx, dz); let e = want - r.rot; e = Math.atan2(Math.sin(e), Math.cos(e));
  r.rot += Math.max(-0.25, Math.min(0.25, e));
  const k = Math.min(step, Math.max(0, d - stopAt)) / d;
  r.x += dx * k; r.z += dz * k;
}
