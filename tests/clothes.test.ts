import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, ack, once, wait, type Harness } from './helpers.js';
import { CLOTHING_STORE } from '../shared/constants.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

describe('clothing store', () => {
  it('buying needs the store + money, debits once, is saved, wearable later and visible to others', async () => {
    type R = { ok: boolean; error?: string; style?: string; owned?: string[]; balance?: number };
    const u = await h.register('fashion');
    h.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id); // teleport for positioning only
    h.db.prepare('UPDATE users SET balance = 100000 WHERE id = ?').run(u.id);
    const { s } = await h.connect(u.cookie);
    expect((await ack<R>(s, 'clothes:buy', { id: 'senator' })).error).toMatch(/Uyi Fashion House/); // not at the store
    await ack(s, 'admin:teleport', CLOTHING_STORE.door);
    expect((await ack<R>(s, 'clothes:buy', { id: 'white_suit_x' })).ok).toBe(false);
    expect((await ack<R>(s, 'clothes:buy', { id: 'agbada' })).error).toBe('Not enough money'); // ₦150k > ₦100k
    const r = await ack<R>(s, 'clothes:buy', { id: 'senator' });
    expect(r.ok).toBe(true); expect(r.balance).toBe(40_000); expect(r.style).toBe('senator');
    expect((await ack<R>(s, 'clothes:buy', { id: 'senator' })).error).toBe('You already own this');
    expect((await ack<R>(s, 'clothes:wear', { id: 'agbada' })).ok).toBe(false); // not owned
    expect((await ack<R>(s, 'clothes:wear', { id: 'casual' })).ok).toBe(true);
    expect((await ack<R>(s, 'clothes:wear', { id: 'senator' })).ok).toBe(true);
    // another player sees the outfit in snapshots
    const o = await h.register('watcher2'); const { s: W } = await h.connect(o.cookie);
    await wait(150);
    const snap = await once<{ players: { id: number; style?: string }[] }>(W, 'snap');
    expect(snap.players.find((p) => p.id === u.id)?.style).toBe('senator');
    // persisted
    expect((h.db.prepare('SELECT outfit FROM users WHERE id = ?').get(u.id) as { outfit: string }).outfit).toBe('senator');
    expect((await ack<R>(s, 'clothes:list')).owned).toEqual(expect.arrayContaining(['casual', 'senator', 'white_suit']));
  });
});
