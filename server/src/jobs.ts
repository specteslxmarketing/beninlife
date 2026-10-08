// Server-authoritative taxi + station jobs (pure rule functions; money is paid by the caller via applyTransaction).
import {
  STATION_JOBS, STATION_RADIUS, TAXI_PASSENGERS, TAXI_RADIUS, TAXI_STOPS, dist, minDeliverySeconds, stationSpot, taxiFare,
  type StationJob, type Vec2,
} from '../../shared/constants.js';
import type { RuleResult } from './rules.js';

export interface TaxiState { stage: 'to_pickup' | 'riding'; pickup: number; dest: number; passenger: string; pickedAt: number }
export interface StationState { id: StationJob['id']; done: boolean[]; lastAt: number; readyAt: number; cars: number }

export function taxiStart(inCar: boolean, car: Vec2, rnd = Math.random): RuleResult<TaxiState> {
  if (!inCar) return { ok: false, error: 'Taxi work needs a car: get in your car first' };
  const far = TAXI_STOPS.map((s, i) => ({ i, d: dist(s, car) })).filter((x) => x.d > 40 && x.d < 260);
  const pool = far.length ? far : TAXI_STOPS.map((_, i) => ({ i, d: 0 }));
  const pickup = pool[Math.floor(rnd() * pool.length) % pool.length].i;
  return { ok: true, value: { stage: 'to_pickup', pickup, dest: -1, passenger: TAXI_PASSENGERS[Math.floor(rnd() * TAXI_PASSENGERS.length) % TAXI_PASSENGERS.length], pickedAt: 0 } };
}
export function taxiPickup(t: TaxiState | null, inCar: boolean, car: Vec2, now: number, rnd = Math.random): RuleResult<TaxiState> {
  if (!t || t.stage !== 'to_pickup') return { ok: false, error: 'No passenger waiting for you' };
  if (!inCar) return { ok: false, error: 'Pick passengers up in your car' };
  const p = TAXI_STOPS[t.pickup];
  if (dist(car, p) > TAXI_RADIUS) return { ok: false, error: `Drive to ${p.name} to pick up ${t.passenger}` };
  const opts = TAXI_STOPS.map((s, i) => ({ i, d: dist(s, p) })).filter((x) => x.i !== t.pickup && x.d > 100);
  const dest = opts[Math.floor(rnd() * opts.length) % opts.length].i;
  return { ok: true, value: { ...t, stage: 'riding', dest, pickedAt: now } };
}
export function taxiDropoff(t: TaxiState | null, inCar: boolean, car: Vec2, now: number, dirt: number): RuleResult<{ fare: number; tip: number; name: string }> {
  if (!t || t.stage !== 'riding') return { ok: false, error: 'No passenger on board' };
  if (!inCar) return { ok: false, error: 'Stay in the car to drop off' };
  const d = TAXI_STOPS[t.dest], from = TAXI_STOPS[t.pickup];
  if (dist(car, d) > TAXI_RADIUS) return { ok: false, error: `Drive to ${d.name}` };
  const len = dist(from, d);
  if ((now - t.pickedAt) / 1000 < minDeliverySeconds(len)) return { ok: false, error: 'Fare rejected: arrived impossibly fast' };
  return { ok: true, value: { fare: taxiFare(len), tip: dirt < 0.3 ? 300 : 0, name: d.name } };
}

export function stationStart(id: unknown, onFoot: boolean, pos: Vec2, current: StationState | null, now: number): RuleResult<StationState> {
  if (id !== 'carwash' && id !== 'mechanic') return { ok: false, error: 'Unknown job' };
  const j = STATION_JOBS[id];
  if (current && current.id === id) return { ok: true, value: current }; // idempotent: a retried start (slow client / lost ack) resumes the shift
  if (current) return { ok: false, error: 'You are already on a shift' };
  if (!onFoot) return { ok: false, error: 'Get out of the car first' };
  if (dist(pos, j.start) > j.startRadius) return { ok: false, error: `Go to ${j.place} to start` };
  return { ok: true, value: { id, done: j.spots.map(() => false), lastAt: now, readyAt: now, cars: 0 } };
}
/** One task step. Each step needs the player at the right spot and takes at least workMs (no instant spam). */
export function stationWork(s: StationState | null, i: unknown, onFoot: boolean, pos: Vec2, now: number): RuleResult<{ state: StationState; finished: boolean; pay: number }> {
  if (!s) return { ok: false, error: 'Start a shift first' };
  const j = STATION_JOBS[s.id];
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= j.spots.length) return { ok: false, error: 'Invalid task' };
  if (!onFoot) return { ok: false, error: 'Get out of the car first' };
  if (now < s.readyAt) return { ok: false, error: 'The next customer is still pulling in' };
  if (s.done[i]) return { ok: false, error: 'Already done' };
  if (dist(pos, stationSpot(j, i)) > STATION_RADIUS) return { ok: false, error: `Stand at the spot to ${j.spots[i].label.toLowerCase()}` };
  if (now - s.lastAt < j.workMs * 0.9) return { ok: false, error: 'Take your time: do the job properly' };
  const done = s.done.slice(); done[i] = true;
  const finished = done.every(Boolean);
  const state: StationState = finished ? { ...s, done: j.spots.map(() => false), lastAt: now, readyAt: now + 4000, cars: s.cars + 1 } : { ...s, done, lastAt: now };
  return { ok: true, value: { state, finished, pay: finished ? j.pay : 0 } };
}
