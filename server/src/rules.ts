// Pure, testable server-side game rules (jobs, car wash, movement validation).
import {
  DROPOFFS, MARKET_PICKUP, PICKUP_RADIUS, DROPOFF_RADIUS, CARWASH_ZONE, CAR_ENTER_RADIUS,
  MAX_SPEED_CAR, MAX_SPEED_FOOT, inPlayableArea, dist, inZone, minDeliverySeconds, type Vec2,
} from '../../shared/constants.js';

export interface JobState { stage: 'carrying'; dropoff: number; pickedAt: number; pickup: Vec2 }

export type RuleResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export function tryPickup(pos: Vec2, now: number, current: JobState | null, rnd = Math.random): RuleResult<JobState> {
  if (current) return { ok: false, error: 'You are already carrying a package' };
  if (dist(pos, MARKET_PICKUP) > PICKUP_RADIUS) return { ok: false, error: 'You are not at the market pickup point' };
  const dropoff = Math.floor(rnd() * DROPOFFS.length) % DROPOFFS.length;
  return { ok: true, value: { stage: 'carrying', dropoff, pickedAt: now, pickup: { ...MARKET_PICKUP } } };
}

export function tryDeliver(pos: Vec2, now: number, job: JobState | null): RuleResult {
  if (!job) return { ok: false, error: 'No package to deliver' };
  const d = DROPOFFS[job.dropoff];
  if (dist(pos, d) > DROPOFF_RADIUS) return { ok: false, error: `Go to ${d.name} to deliver` };
  const minS = minDeliverySeconds(dist(job.pickup, d));
  if ((now - job.pickedAt) / 1000 < minS) return { ok: false, error: 'Delivery rejected: arrived impossibly fast' };
  return { ok: true, value: undefined };
}

export function canWash(inCar: boolean, car: Vec2, balance: number, price: number): RuleResult {
  if (!inCar) return { ok: false, error: 'You must be in your car' };
  if (!inZone(car, CARWASH_ZONE)) return { ok: false, error: 'Drive into the car wash bay first' };
  if (balance < price) return { ok: false, error: 'Not enough money' };
  return { ok: true, value: undefined };
}

export function canEnterCar(player: Vec2, car: Vec2): boolean {
  return dist(player, car) <= CAR_ENTER_RADIUS;
}

/** Validates a movement step; returns false if it is impossible (teleport / speed hack / out of bounds). */
export function validMove(from: Vec2, to: Vec2, dtMs: number, inCar: boolean): boolean {
  if (![to.x, to.z].every(Number.isFinite)) return false;
  if (!inPlayableArea(to.x, to.z)) return false;
  const maxV = inCar ? MAX_SPEED_CAR : MAX_SPEED_FOOT;
  const dt = Math.min(Math.max(dtMs, 50), 2000) / 1000;
  return dist(from, to) <= maxV * dt * 1.35 + 1.5;
}
