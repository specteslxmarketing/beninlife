// Wanted-level rules (pure, unit-tested). The game loop feeds authoritative position/speed; this returns what happened.
import { ARREST_RADIUS, FINE_PER_STAR, POLICE_SIGHT, SPEED_LIMIT, SURRENDER_PER_STAR, WANTED_DECAY_MS, WANTED_MAX, nearestOfficer, type Vec2 } from '../../shared/constants.js';

export interface PoliceState { wanted: number; lastSeenAt: number; lastDecayAt: number; speedingAt: number; hitAt: number; evadeAt: number }
export const newPoliceState = (wanted = 0, now = Date.now()): PoliceState => ({ wanted, lastSeenAt: now, lastDecayAt: now, speedingAt: -1e12, hitAt: -1e12, evadeAt: -1e12 });
export type PoliceEvent = { type: 'crime'; stars: number; reason: string } | { type: 'arrest'; fine: number; stars: number } | { type: 'decay'; wanted: number };

function addStars(s: PoliceState, n: number, now: number): number { const before = s.wanted; s.wanted = Math.min(WANTED_MAX, s.wanted + n); s.lastSeenAt = now; s.lastDecayAt = now; return s.wanted - before; }

export interface PoliceInput { pos: Vec2; inCar: boolean; speed: number; now: number; pedestrians: { id: number; pos: Vec2 }[] }
/** One evaluation step. Returns events in order; `hitIds` lists pedestrians that were hit. */
export function policeStep(s: PoliceState, i: PoliceInput): { events: PoliceEvent[]; hitIds: number[] } {
  const events: PoliceEvent[] = []; const hitIds: number[] = [];
  const { d } = nearestOfficer(i.pos);
  const seen = d < POLICE_SIGHT;
  const kmh = Math.round(i.speed * 3.6);
  if (i.inCar && i.speed > SPEED_LIMIT && seen && i.now - s.speedingAt > 20_000) {
    s.speedingAt = i.now;
    if (addStars(s, 1, i.now)) events.push({ type: 'crime', stars: 1, reason: `Speeding past a police checkpoint (${kmh} km/h in a 70 zone)` });
  }
  if (i.inCar && i.speed > 7 && i.now - s.hitAt > 5000) {
    for (const p of i.pedestrians) if (Math.hypot(p.pos.x - i.pos.x, p.pos.z - i.pos.z) < 1.9) hitIds.push(p.id);
    if (hitIds.length) { s.hitAt = i.now; addStars(s, 2, i.now); events.push({ type: 'crime', stars: 2, reason: 'Knocked down a pedestrian' }); }
  }
  if (s.wanted > 0 && seen) {
    s.lastSeenAt = i.now;
    if (i.inCar && i.speed > 4 && d < 12 && i.now - s.evadeAt > 15_000 && i.now - s.speedingAt > 1000) {
      s.evadeAt = i.now;
      if (addStars(s, 1, i.now)) events.push({ type: 'crime', stars: 1, reason: 'Drove through a checkpoint while wanted' });
    }
    if (d < ARREST_RADIUS && i.speed < 2) { events.push({ type: 'arrest', fine: FINE_PER_STAR * s.wanted, stars: s.wanted }); s.wanted = 0; }
  }
  return { events, hitIds };
}
/** called from the server tick: lose a star for every WANTED_DECAY_MS spent out of police sight */
export function policeDecay(s: PoliceState, now: number): PoliceEvent | null {
  if (s.wanted <= 0 || now - s.lastSeenAt < WANTED_DECAY_MS || now - s.lastDecayAt < WANTED_DECAY_MS) return null;
  s.wanted--; s.lastDecayAt = now; return { type: 'decay', wanted: s.wanted };
}
export const surrenderFine = (wanted: number) => SURRENDER_PER_STAR * wanted;
