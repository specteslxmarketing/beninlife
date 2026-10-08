import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, ack, wait, type Harness } from './helpers.js';
import { stationStart, stationWork, taxiDropoff, taxiPickup, taxiStart } from '../server/src/jobs.js';
import { STATION_JOBS, TAXI_STOPS, stationSpot, taxiFare } from '../shared/constants.js';

describe('taxi rules (pure)', () => {
  it('needs a car, a real pickup, a plausible trip time; pays distance-based fare + clean-car tip', () => {
    expect(taxiStart(false, { x: 0, z: 0 }).ok).toBe(false);
    const s = taxiStart(true, { x: -44, z: 10 }, () => 0.3); expect(s.ok).toBe(true);
    if (!s.ok) return;
    const p = TAXI_STOPS[s.value.pickup];
    expect(taxiPickup(s.value, true, { x: p.x + 30, z: p.z }, 1000).ok).toBe(false); // not at the stop
    const r = taxiPickup(s.value, true, { x: p.x + 2, z: p.z }, 1000, () => 0.5); expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = TAXI_STOPS[r.value.dest];
    const len = Math.hypot(d.x - p.x, d.z - p.z); expect(len).toBeGreaterThan(100);
    expect(taxiDropoff(r.value, true, d, 1000 + 2000, 0).ok).toBe(false); // impossibly fast
    const ok = taxiDropoff(r.value, true, d, 1000 + 120_000, 0.1);
    expect(ok.ok && ok.value.fare).toBe(taxiFare(len));
    expect(ok.ok && ok.value.tip).toBe(300);
    const dirty = taxiDropoff(r.value, true, d, 1000 + 120_000, 0.8);
    expect(dirty.ok && dirty.value.tip).toBe(0);
  });
});

describe('station jobs (pure)', () => {
  it('must start at the place on foot; each step needs the right spot and real work time; 4 steps pay once', () => {
    const j = STATION_JOBS.mechanic;
    expect(stationStart('mechanic', true, { x: 0, z: 0 }, null, 0).ok).toBe(false);
    expect(stationStart('mechanic', false, j.start, null, 0).ok).toBe(false); // in a car
    expect(stationStart('hacker', true, j.start, null, 0).ok).toBe(false);
    const st = stationStart('mechanic', true, j.start, null, 0); expect(st.ok).toBe(true);
    if (!st.ok) return;
    let s = st.value, t = 0;
    expect(stationWork(s, 0, true, stationSpot(j, 0), 100).ok).toBe(false); // too fast
    expect(stationWork(s, 0, true, stationSpot(j, 2), 5000).ok).toBe(false); // wrong spot
    let paid = 0;
    for (let i = 0; i < 4; i++) {
      t += j.workMs; const r = stationWork(s, i, true, stationSpot(j, i), t); expect(r.ok).toBe(true);
      if (!r.ok) return; s = r.value.state; paid += r.value.pay;
      if (i < 3) expect(stationWork(s, i, true, stationSpot(j, i), t + j.workMs).ok).toBe(false); // no double-dipping
    }
    expect(paid).toBe(j.pay); expect(s.cars).toBe(1);
    expect(stationWork(s, 0, true, stationSpot(j, 0), t + 1000).ok).toBe(false); // next car still pulling in
  });
});

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

describe('car-wash attendant shift over sockets', () => {
  it('a full car pays ₦600 into the wallet; nothing is paid for partial/too-fast work', async () => {
    const u = await h.register('washer');
    h.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id); // admin teleport = quick positioning for the test
    const { s } = await h.connect(u.cookie);
    const j = STATION_JOBS.carwash;
    type R = { ok: boolean; error?: string; finished?: boolean; paid?: number; balance?: number };
    expect((await ack<R>(s, 'job:station:start', { id: 'carwash' })).ok).toBe(false); // not at the car wash
    await ack(s, 'admin:teleport', j.start);
    expect((await ack<R>(s, 'job:station:start', { id: 'carwash' })).ok).toBe(true);
    expect((await ack<R>(s, 'job:pickup')).ok).toBe(false); // one job at a time
    const before = (await ack<{ balance: number }>(s, 'wallet')).balance;
    await ack(s, 'admin:teleport', stationSpot(j, 0));
    expect((await ack<R>(s, 'job:station:work', { i: 0 })).ok).toBe(false); // too fast after starting
    let last: R = { ok: false };
    for (let i = 0; i < 4; i++) {
      await ack(s, 'admin:teleport', stationSpot(j, i));
      await wait(j.workMs);
      last = await ack<R>(s, 'job:station:work', { i });
      expect(last.ok).toBe(true);
    }
    expect(last.finished).toBe(true); expect(last.paid).toBe(600);
    expect((await ack<{ balance: number }>(s, 'wallet')).balance).toBe(before + 600);
  }, 30000);
});
