import { describe, expect, it } from 'vitest';
import { rideCheck, exitSpot, RIDE_RADIUS } from '../server/src/ride.js';

const base = { riderId: 2, riderPos: { x: 1, z: 0 }, riderInCar: false, riderRiding: false, driverId: 1, driverExists: true, driverCar: { x: 0, z: 0 }, sameCity: true, takenSeats: [] as number[] };
describe('passenger rides', () => {
  it('gives the front passenger seat first, then the rear seats, then refuses', () => {
    const r1 = rideCheck(base); expect(r1).toEqual({ ok: true, value: { driver: 1, seat: 1 } });
    expect(rideCheck({ ...base, takenSeats: [1] })).toEqual({ ok: true, value: { driver: 1, seat: 2 } });
    expect(rideCheck({ ...base, takenSeats: [1, 2, 3] })).toEqual({ ok: false, error: 'The car is full' });
  });
  it('refuses own car, far away, in a car, already riding, absent driver, locked', () => {
    expect(rideCheck({ ...base, driverId: 2 }).ok).toBe(false);
    expect(rideCheck({ ...base, riderPos: { x: RIDE_RADIUS + 1, z: 0 } }).ok).toBe(false);
    expect(rideCheck({ ...base, riderInCar: true }).ok).toBe(false);
    expect(rideCheck({ ...base, riderRiding: true }).ok).toBe(false);
    expect(rideCheck({ ...base, driverExists: false }).ok).toBe(false);
    expect(rideCheck({ ...base, sameCity: false }).ok).toBe(false);
    expect(rideCheck({ ...base, locked: true }).ok).toBe(false);
    expect(rideCheck({ ...base, driverId: 'x' }).ok).toBe(false);
  });
  it('exits on the seat side of the car', () => {
    const left = exitSpot({ x: 0, z: 0, rot: 0 }, 0), right = exitSpot({ x: 0, z: 0, rot: 0 }, 1);
    expect(left.x).toBeGreaterThan(1.5); expect(right.x).toBeLessThan(-1.5);
  });
});
