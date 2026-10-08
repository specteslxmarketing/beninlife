import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, ack, once, wait, type Harness } from './helpers.js';
import { newPoliceState, policeDecay, policeStep } from '../server/src/police.js';
import { FINE_PER_STAR, POLICE_OFFICERS, POLICE_STATION, SURRENDER_PER_STAR, WANTED_DECAY_MS } from '../shared/constants.js';

const officer = POLICE_OFFICERS[2]; // airport road checkpoint
describe('wanted level rules (pure)', () => {
  it('speeding is only a crime where police can see it, with a cooldown', () => {
    const s = newPoliceState(0, 0);
    expect(policeStep(s, { pos: { x: 0, z: 60 }, inCar: true, speed: 30, now: 1000, pedestrians: [] }).events).toEqual([]); // nobody watching
    const r = policeStep(s, { pos: { x: officer.x - 6, z: officer.z + 20 }, inCar: true, speed: 30, now: 2000, pedestrians: [] });
    expect(r.events[0]).toMatchObject({ type: 'crime', stars: 1 }); expect(s.wanted).toBe(1);
    policeStep(s, { pos: { x: officer.x - 6, z: officer.z + 15 }, inCar: true, speed: 30, now: 2500, pedestrians: [] });
    expect(s.wanted).toBe(1); // cooldown, no double count
    expect(policeStep(newPoliceState(0, 0), { pos: { x: officer.x - 6, z: officer.z }, inCar: true, speed: 15, now: 1000, pedestrians: [] }).events).toEqual([]); // legal speed
  });
  it('knocking down a pedestrian = 2 stars; police arrest you when you stop near them; stars decay unseen', () => {
    const s = newPoliceState(0, 0);
    const r = policeStep(s, { pos: { x: 0, z: 60 }, inCar: true, speed: 12, now: 10_000, pedestrians: [{ id: 7, pos: { x: 0.8, z: 60.5 } }, { id: 8, pos: { x: 20, z: 60 } }] });
    expect(r.hitIds).toEqual([7]); expect(s.wanted).toBe(2);
    expect(policeDecay(s, 10_000 + WANTED_DECAY_MS - 1)).toBeNull();
    expect(policeDecay(s, 10_000 + WANTED_DECAY_MS + 1)).toMatchObject({ wanted: 1 });
    const a = policeStep(s, { pos: { x: officer.x + 1, z: officer.z }, inCar: false, speed: 0, now: 200_000, pedestrians: [] });
    expect(a.events).toContainEqual({ type: 'arrest', fine: FINE_PER_STAR * 1, stars: 1 }); expect(s.wanted).toBe(0);
  });
});

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });
describe('police (socket)', () => {
  it('a wanted player who walks up to an officer is arrested, fined by the server and taken to the station', async () => {
    const u = await h.register('outlaw');
    h.db.prepare('UPDATE users SET is_admin = 1, wanted = 2, balance = 50000 WHERE id = ?').run(u.id); // admin only to teleport
    const { s } = await h.connect(u.cookie);
    const got = once<{ wanted: number; arrested?: boolean; fine?: number }>(s, 'wanted', 5000);
    await ack(s, 'admin:teleport', { x: officer.x + 1.5, z: officer.z });
    const w = await got;
    expect(w).toMatchObject({ wanted: 0, arrested: true, fine: 2 * FINE_PER_STAR });
    await wait(100);
    const row = h.db.prepare('SELECT balance, wanted FROM users WHERE id = ?').get(u.id) as { balance: number; wanted: number };
    expect(row).toEqual({ balance: 50000 - 2 * FINE_PER_STAR, wanted: 0 });
  });
  it('handing yourself in at the station costs less; not possible elsewhere or when not wanted', async () => {
    const u = await h.register('honest');
    h.db.prepare('UPDATE users SET is_admin = 1, wanted = 3, balance = 20000 WHERE id = ?').run(u.id);
    const { s } = await h.connect(u.cookie);
    expect((await ack<{ ok: boolean; error?: string }>(s, 'police:surrender')).ok).toBe(false); // not at the station
    await ack(s, 'admin:teleport', POLICE_STATION.door);
    const r = await ack<{ ok: boolean; fine?: number }>(s, 'police:surrender');
    expect(r).toMatchObject({ ok: true, fine: 3 * SURRENDER_PER_STAR });
    expect((await ack<{ ok: boolean }>(s, 'police:surrender')).ok).toBe(false);
    expect((h.db.prepare('SELECT balance FROM users WHERE id = ?').get(u.id) as { balance: number }).balance).toBe(20000 - 9000);
  });
});
