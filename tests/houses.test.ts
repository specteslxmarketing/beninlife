import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, ack, wait, type Harness } from './helpers.js';
import { houseById, interiorExit, interiorSpawn, START_BALANCE } from '../shared/constants.js';
import { applyTransaction } from '../server/src/wallet.js';
import { validMove } from '../server/src/rules.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });
type R = { ok: boolean; error?: string; balance?: number; x?: number; z?: number };
const place = (id: number, x: number, z: number) => { const l = h.srv.game.lives.get(id)!; l.x = x; l.z = z; l.inCar = false; };

describe('houses', () => {
  const flat = houseById('flat1')!;
  it('mansion is owned by BEST 𝕏 and locked; houses for sale are unowned', async () => {
    const u = await h.register('hs_view'); const { s, init } = await h.connect(u.cookie);
    const list = (init.houses as { id: string; ownerName: string | null; locked: boolean }[]);
    expect(list.find((x) => x.id === 'mansion')).toMatchObject({ ownerName: 'BEST 𝕏', locked: true });
    expect(list.find((x) => x.id === 'flat1')!.ownerName).toBeNull();
    // non-owner at the mansion gate is refused
    place(u.id, houseById('mansion')!.door.x, houseById('mansion')!.door.z);
    const r = await ack<R>(s, 'house:enter', { id: 'mansion' });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/private residence/);
    expect((await ack<R>(s, 'house:buy', { id: 'mansion' })).ok).toBe(false);
  });

  it('buying needs enough money and presence at the house; the server debits the wallet', async () => {
    const u = await h.register('hs_buyer'); const { s } = await h.connect(u.cookie);
    place(u.id, flat.door.x, flat.door.z);
    const poor = await ack<R>(s, 'house:buy', { id: 'flat1' });
    expect(poor.ok).toBe(false); expect(poor.error).toMatch(/insufficient/i);
    applyTransaction(h.db, u.id, flat.price, 'test', 'grant for test');
    place(u.id, 0, 0);
    expect((await ack<R>(s, 'house:buy', { id: 'flat1' })).error).toMatch(/Go to the house/);
    place(u.id, flat.door.x, flat.door.z);
    const ok = await ack<R>(s, 'house:buy', { id: 'flat1' });
    expect(ok.ok).toBe(true); expect(ok.balance).toBe(START_BALANCE);
    // a second buyer can't take it
    const v = await h.register('hs_second'); const V = (await h.connect(v.cookie)).s;
    applyTransaction(h.db, v.id, flat.price, 'test', 'grant');
    place(v.id, flat.door.x, flat.door.z);
    expect((await ack<R>(V, 'house:buy', { id: 'flat1' })).error).toMatch(/owned/);
  });

  it('owner enters a real interior; a visitor is blocked while locked and admitted when unlocked; both are inside together', async () => {
    const owner = h.db.prepare("SELECT id FROM users WHERE username = 'hs_buyer'").get() as { id: number };
    const ownerCookie = (await h.login('hs_buyer', 'password123'));
    const O = (await h.connect(ownerCookie)).s;
    const v = await h.register('hs_visitor'); const V = (await h.connect(v.cookie)).s;
    place(owner.id, flat.door.x, flat.door.z); place(v.id, flat.door.x, flat.door.z);
    expect((await ack<R>(V, 'house:enter', { id: 'flat1' })).error).toMatch(/locked/);
    expect((await ack<R>(V, 'house:lock', { id: 'flat1', locked: false })).ok).toBe(false); // not owner
    const enter = await ack<R>(O, 'house:enter', { id: 'flat1' });
    expect(enter.ok).toBe(true);
    const sp = interiorSpawn(flat);
    expect(h.srv.game.lives.get(owner.id)).toMatchObject({ x: sp.x, z: sp.z });
    expect((await ack<R>(O, 'house:lock', { id: 'flat1', locked: false })).ok).toBe(true);
    expect((await ack<R>(V, 'house:enter', { id: 'flat1' })).ok).toBe(true);
    await wait(250); // next snapshot
    const snap = await new Promise<{ players: { id: number; x: number; z: number }[] }>((r) => V.once('snap', r));
    const o = snap.players.find((p) => p.id === owner.id)!;
    expect(Math.hypot(o.x - sp.x, o.z - sp.z)).toBeLessThan(1);
    // exit only from the front door
    place(v.id, sp.x + 3, sp.z + 6);
    expect((await ack<R>(V, 'house:exit')).ok).toBe(false);
    const ex = interiorExit(flat); place(v.id, ex.x, ex.z);
    const out = await ack<R>(V, 'house:exit');
    expect(out.ok).toBe(true); expect(Math.hypot(out.x! - flat.door.x, out.z! - flat.door.z)).toBeLessThan(2);
  });

  it('interiors cannot be reached by walking/teleport reports (movement validation)', () => {
    const sp = interiorSpawn(flat);
    expect(validMove({ x: flat.door.x, z: flat.door.z }, sp, 100, false)).toBe(false);
    expect(validMove(sp, { x: sp.x + 0.5, z: sp.z }, 100, false)).toBe(true); // walking around inside is fine
    expect(validMove({ x: 0, z: 0 }, { x: 0, z: 400 }, 100, false)).toBe(false); // out of the world
  });
});

describe('admin teleport', () => {
  it('only the admin may teleport, and never into interiors', async () => {
    const u = await h.register('tp_user'); const U = (await h.connect(u.cookie)).s;
    expect((await ack<R>(U, 'admin:teleport', { x: 10, z: 50 })).ok).toBe(false);
    const pw = h.db.prepare("SELECT id FROM users WHERE username='bestx'").get() as { id: number };
    // the harness doesn't know the random admin password; authenticate by flagging a test user admin instead
    h.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(u.id);
    U.close(); await wait(200); // live state is rebuilt on the next connection
    const U2 = (await h.connect(u.cookie)).s;
    expect((await ack<R>(U2, 'admin:teleport', { x: 10, z: 50 })).ok).toBe(true);
    expect(h.srv.game.lives.get(u.id)).toMatchObject({ x: 10, z: 50 });
    const sp = interiorSpawn(houseById('mansion')!);
    expect((await ack<R>(U2, 'admin:teleport', sp)).ok).toBe(false);
    expect(pw.id).toBeGreaterThan(0);
  });
});
