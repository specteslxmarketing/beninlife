import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, ack, once, type Harness } from './helpers.js';
import { CAR_MODELS, DISPLAY_SLOTS, START_BALANCE, houseById } from '../shared/constants.js';
import { applyTransaction } from '../server/src/wallet.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });
type R = { ok: boolean; error?: string; balance?: number; vehicle?: { id: number; model: string; color: string }; home?: { x: number; z: number } };
const place = (id: number, x: number, z: number) => { const l = h.srv.game.lives.get(id)!; l.x = x; l.z = z; l.inCar = false; };

describe('BEST 𝕏 Car Stands', () => {
  it('has 14 common Nigerian car styles with realistic ₦ tiers and no brand logos in names', () => {
    expect(CAR_MODELS.length).toBe(14);
    for (const m of CAR_MODELS) { expect(m.name).toMatch(/-style/); expect(m.price).toBeGreaterThanOrEqual(5_000_000); }
    expect(new Set(CAR_MODELS.map((m) => m.body))).toEqual(new Set(['compact', 'sedan', 'minivan', 'suv', 'bus', 'pickup']));
  });

  it('BEST 𝕏 owns a GLK-style and an RX 350-style SUV', () => {
    const rows = h.db.prepare("SELECT v.model FROM vehicles v JOIN users u ON u.id = v.owner_id WHERE u.username = 'bestx'").all() as { model: string }[];
    expect(rows.map((r) => r.model)).toEqual(expect.arrayContaining(['glk', 'rx350']));
  });

  it('purchase is server-side: needs money and presence at the display car; the car becomes active and is delivered', async () => {
    const u = await h.register('car_buyer'); const { s, init } = await h.connect(u.cookie);
    expect((init.me as { id: number }).id).toBe(u.id);
    const slot = DISPLAY_SLOTS.find((d) => d.model === 'corolla')!;
    place(u.id, slot.x, slot.z + 3);
    const poor = await ack<R>(s, 'car:buy', { model: 'corolla', color: '#121316' });
    expect(poor.ok).toBe(false); expect(poor.error).toMatch(/insufficient/i);
    applyTransaction(h.db, u.id, 13_000_000, 'test', 'grant');
    place(u.id, 0, 0);
    expect((await ack<R>(s, 'car:buy', { model: 'corolla' })).error).toMatch(/Walk up/);
    place(u.id, slot.x, slot.z + 3);
    const corrected = once<{ vehicle: { model: string; color: string }; carX: number; carZ: number }>(s, 'correct');
    const ok = await ack<R>(s, 'car:buy', { model: 'corolla', color: '#121316' });
    expect(ok.ok).toBe(true); expect(ok.balance).toBe(START_BALANCE); expect(ok.vehicle).toMatchObject({ model: 'corolla', color: '#121316' });
    expect((await corrected).vehicle).toEqual({ model: 'corolla', color: '#121316' });
    const live = h.srv.game.lives.get(u.id)!;
    expect(live.carModel).toBe('corolla');
    const snap = h.srv.game.snapshot(live); expect(snap.carModel).toBe('corolla');
    // an invalid colour falls back to a catalogue colour; unknown models are refused
    expect((await ack<R>(s, 'car:buy', { model: 'lambo' })).ok).toBe(false);
  });

  it('owned cars are delivered to the owner\'s house; you can only use cars you own', async () => {
    const u = await h.register('car_home'); const { s } = await h.connect(u.cookie);
    applyTransaction(h.db, u.id, 4_500_000 + 7_500_000, 'test', 'grant');
    const flat = houseById('flat1')!;
    place(u.id, flat.door.x, flat.door.z);
    expect((await ack<R>(s, 'house:buy', { id: 'flat1' })).ok).toBe(true);
    const slot = DISPLAY_SLOTS.find((d) => d.model === 'rio')!; place(u.id, slot.x, slot.z - 3);
    const r = await ack<R>(s, 'car:buy', { model: 'rio', color: '#b3121b' });
    expect(r.ok).toBe(true);
    expect(Math.hypot(r.home!.x - flat.door.x, r.home!.z - flat.door.z)).toBeLessThan(7);
    const live = h.srv.game.lives.get(u.id)!; expect(Math.hypot(live.carX - flat.door.x, live.carZ - flat.door.z)).toBeLessThan(7);
    const other = h.db.prepare("SELECT v.id FROM vehicles v JOIN users u ON u.id = v.owner_id WHERE u.username = 'bestx' LIMIT 1").get() as { id: number };
    expect((await ack<R>(s, 'car:use', { id: other.id })).error).toMatch(/do not own/);
    expect((await ack<R>(s, 'car:use', { id: null })).ok).toBe(true); // back to the starter car
    expect(h.srv.game.lives.get(u.id)!.carModel).toBe('starter');
    const list = await ack<{ vehicles: { model: string }[] }>(s, 'car:list');
    expect(list.vehicles.map((v) => v.model)).toEqual(['rio']);
  });
});
