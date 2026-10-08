import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, ack, once, wait, type Harness } from './helpers.js';
import { travelCheck } from '../server/src/travel.js';
import { TRAVEL, cityAt, inLagos, inPlayableArea } from '../shared/constants.js';

describe('travel rules (pure)', () => {
  it('needs the right desk in the current city, on foot, money; flights refuse wanted players', () => {
    const bd = TRAVEL.bus.desk.benin, fl = TRAVEL.flight.desk.lagos;
    expect(travelCheck('bus', { x: 0, z: 0 }, true, 0, 1e6).ok).toBe(false);
    expect(travelCheck('bus', bd, false, 0, 1e6).ok).toBe(false); // in a car
    expect(travelCheck('bus', bd, true, 0, 100)).toMatchObject({ ok: false, error: 'Not enough money' });
    expect(travelCheck('bus', bd, true, 0, 1e6)).toMatchObject({ ok: true, from: 'benin', to: 'lagos', price: TRAVEL.bus.price });
    expect(travelCheck('flight', fl, true, 2, 1e6).ok).toBe(false);
    expect(travelCheck('flight', fl, true, 0, 1e6)).toMatchObject({ ok: true, from: 'lagos', to: 'benin' });
    expect(travelCheck('teleport', bd, true, 0, 1e6).ok).toBe(false);
    for (const c of ['benin', 'lagos'] as const) for (const m of ['bus', 'flight'] as const) {
      const a = TRAVEL[m].arrive[c]; expect(inPlayableArea(a.x, a.z)).toBe(true); expect(cityAt(a.x, a.z)).toBe(c);
    }
    expect(inLagos(TRAVEL.bus.arrive.lagos.x, TRAVEL.bus.arrive.lagos.z)).toBe(true);
  });
});

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });
describe('travel (socket)', () => {
  it('bus to Lagos charges the fare once, moves you there, players in Lagos see each other, and you can fly back', async () => {
    type R = { ok: boolean; error?: string; to?: string };
    const a = await h.register('roadtrip'), b = await h.register('lagosian');
    for (const u of [a, b]) h.db.prepare('UPDATE users SET is_admin = 1, balance = 200000 WHERE id = ?').run(u.id); // admin only to reach the desk
    const { s: A } = await h.connect(a.cookie); const { s: B } = await h.connect(b.cookie);
    expect((await ack<R>(A, 'travel:go', { mode: 'bus' })).ok).toBe(false); // not at the motor park
    await ack(A, 'admin:teleport', TRAVEL.bus.desk.benin);
    const r = await ack<R>(A, 'travel:go', { mode: 'bus' });
    expect(r).toMatchObject({ ok: true, to: 'lagos' });
    expect((h.db.prepare('SELECT balance FROM users WHERE id = ?').get(a.id) as { balance: number }).balance).toBe(200000 - TRAVEL.bus.price);
    // B flies from Benin Airport
    await ack(B, 'admin:teleport', TRAVEL.flight.desk.benin);
    expect((await ack<R>(B, 'travel:go', { mode: 'flight' })).to).toBe('lagos');
    await wait(250);
    const snap = await once<{ players: { id: number; x: number; z: number }[] }>(B, 'snap');
    const pa = snap.players.find((p) => p.id === a.id)!, pb = snap.players.find((p) => p.id === b.id)!;
    expect(inLagos(pa.x, pa.z) && inLagos(pb.x, pb.z)).toBe(true);
    // walking around Lagos is a valid move (inside the playable area)
    A.emit('state', { x: pa.x + 1, z: pa.z, rot: 0, inCar: false, carX: 0, carZ: 0, carRot: 0, moving: 1 });
    await wait(150);
    // back to Benin by plane from the Lagos airport desk
    await ack(A, 'admin:teleport', TRAVEL.flight.desk.lagos);
    expect((await ack<R>(A, 'travel:go', { mode: 'flight' }))).toMatchObject({ ok: true, to: 'benin' });
    await wait(250);
    const s2 = await once<{ players: { id: number; x: number; z: number }[] }>(B, 'snap');
    const pa2 = s2.players.find((p) => p.id === a.id)!;
    expect(cityAt(pa2.x, pa2.z)).toBe('benin');
  });
});
