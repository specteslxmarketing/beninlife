// Passengers: another player's car can carry up to 3 passengers (front passenger + 2 rear). Server-authoritative:
// the server decides the seat and, while riding, the passenger's position simply follows the driver's car.
import { dist, type Vec2 } from '../../shared/constants.js';

export const RIDE_RADIUS = 4.5;
export const PASSENGER_SEATS = [1, 2, 3] as const;
export interface RideState { driver: number; seat: number }
export type RuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function rideCheck(o: {
  riderId: number; riderPos: Vec2; riderInCar: boolean; riderRiding: boolean;
  driverId: unknown; driverExists: boolean; driverCar: Vec2; sameCity: boolean; takenSeats: number[]; locked?: boolean;
}): RuleResult<RideState> {
  if (typeof o.driverId !== 'number' || !Number.isInteger(o.driverId)) return { ok: false, error: 'Unknown car' };
  if (o.driverId === o.riderId) return { ok: false, error: 'That is your own car — press E to drive it' };
  if (!o.driverExists || !o.sameCity) return { ok: false, error: 'That player is not here' };
  if (o.riderInCar) return { ok: false, error: 'Get out of your car first' };
  if (o.riderRiding) return { ok: false, error: 'You are already riding in a car' };
  if (o.locked) return { ok: false, error: 'The car is locked' };
  if (dist(o.riderPos, o.driverCar) > RIDE_RADIUS) return { ok: false, error: 'Walk up to the car' };
  const seat = PASSENGER_SEATS.find((s) => !o.takenSeats.includes(s));
  if (seat === undefined) return { ok: false, error: 'The car is full' };
  return { ok: true, value: { driver: o.driverId, seat } };
}

/** where a passenger steps out: next to their own door (left side = +x for seats 0/2, right side for 1/3) */
export function exitSpot(car: { x: number; z: number; rot: number }, seat: number): Vec2 {
  const side = seat % 2 === 0 ? 1 : -1, back = seat >= 2 ? -0.9 : 0.3;
  const fx = Math.sin(car.rot), fz = Math.cos(car.rot); // nose
  const lx = Math.cos(car.rot), lz = -Math.sin(car.rot); // left of the nose
  return { x: car.x + lx * 1.9 * side + fx * back, z: car.z + lz * 1.9 * side + fz * back };
}
