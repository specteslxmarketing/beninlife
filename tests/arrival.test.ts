import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, ack, once, wait, type Harness } from './helpers.js';
import { AIRPORT, inPlayableArea } from '../shared/constants.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

describe('arrival (plane intro → Benin Airport)', () => {
  it('a new player is hidden while on the plane, then the server places them in the arrivals hall exactly once', async () => {
    const other = await h.register('Watcher');
    const fresh = await h.register('Newcomer', true);
    const W = (await h.connect(other.cookie)).s;
    const { s: N, init } = await h.connect(fresh.cookie);
    expect((init.me as { introSeen: boolean }).introSeen).toBe(false);
    const snap1 = await once<{ players: { id: number }[] }>(W, 'snap');
    expect(snap1.players.some((p) => p.id === fresh.id)).toBe(false); // still on the plane
    const corr = once<{ x: number; z: number; teleport: boolean }>(N, 'correct');
    const r = await ack<{ ok: boolean; airport: boolean }>(N, 'intro:seen', {});
    expect(r).toEqual({ ok: true, airport: true });
    const c = await corr;
    expect(c.teleport).toBe(true);
    expect(c.x).toBeCloseTo(AIRPORT.arrival.x); expect(c.z).toBeCloseTo(AIRPORT.arrival.z);
    await wait(200);
    const snap2 = await once<{ players: { id: number; x: number; z: number }[] }>(W, 'snap');
    const me = snap2.players.find((p) => p.id === fresh.id);
    expect(me && Math.round(me.z)).toBe(Math.round(AIRPORT.arrival.z));
    // replaying the intro does not teleport again
    expect(await ack<{ ok: boolean; airport: boolean }>(N, 'intro:seen', {})).toEqual({ ok: true, airport: false });
  });
  it('the airport landside is playable; the fenced airside and runway are not', () => {
    expect(inPlayableArea(AIRPORT.arrival.x, AIRPORT.arrival.z)).toBe(true);
    expect(inPlayableArea(0, -205)).toBe(true);
    expect(inPlayableArea(24, -268)).toBe(false); // apron / parked plane
    expect(inPlayableArea(0, -322)).toBe(false); // runway
    expect(inPlayableArea(0, -1200)).toBe(false); // the plane cabin is client-only
  });
});
