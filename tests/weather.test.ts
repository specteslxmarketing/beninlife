import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, ack, once, wait, type Harness } from './helpers.js';
import { weatherAt, WEATHER_KINDS, WEATHER_SLOT_MS } from '../shared/constants.js';

describe('weather (deterministic schedule)', () => {
  it('is the same for everyone at the same time and covers all kinds', () => {
    const t = 1_790_000_000_000;
    expect(weatherAt(t)).toBe(weatherAt(t + 1000));
    const seen = new Map<string, number>();
    for (let i = 0; i < 2000; i++) { const k = weatherAt(t + i * WEATHER_SLOT_MS); seen.set(k, (seen.get(k) ?? 0) + 1); }
    for (const k of WEATHER_KINDS) expect(seen.get(k) ?? 0).toBeGreaterThan(40);
    expect(seen.get('sunny')!).toBeGreaterThan(seen.get('storm')!);
  });
});

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });
describe('weather sync', () => {
  it('init carries the server weather; only admins can override, and the change is broadcast', async () => {
    const u = await h.register('wx_user'); const { s, init } = await h.connect(u.cookie);
    expect(WEATHER_KINDS).toContain(init.weather);
    expect((await ack<{ ok: boolean }>(s, 'admin:weather', { kind: 'storm' })).ok).toBe(false);
    const a = await h.register('wx_admin'); h.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(a.id);
    const A = (await h.connect(a.cookie)).s;
    const target = init.weather === 'storm' ? 'sunny' : 'storm';
    const got = once<{ kind: string }>(s, 'weather');
    expect((await ack<{ ok: boolean; weather: string }>(A, 'admin:weather', { kind: target })).weather).toBe(target);
    expect((await got).kind).toBe(target);
    await ack(A, 'admin:weather', { kind: 'auto' }); await wait(50);
    expect(h.srv.game.weatherOverride).toBeNull();
  });
});
