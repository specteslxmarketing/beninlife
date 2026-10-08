import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb, getUser, type DB } from '../server/src/db.js';
import { createServer, seedAdmin } from '../server/src/app.js';
import { CARWASH_PRICE, CARWASH_ZONE, DELIVERY_PAY, DROPOFFS, MARKET_PICKUP, START_BALANCE, ADMIN_BALANCE } from '../shared/constants.js';

let db: DB; let srv: ReturnType<typeof createServer>; let base: string;
const sockets: Socket[] = [];

async function register(username: string): Promise<{ cookie: string; id: number }> {
  const r = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'password123', ageConfirmed: true }) });
  const j = await r.json() as { ok: boolean; user: { id: number } };
  expect(j.ok).toBe(true);
  return { cookie: r.headers.get('set-cookie')!.split(';')[0], id: j.user.id };
}
function connect(cookie: string): Promise<{ s: Socket; init: Record<string, unknown> }> {
  return new Promise((res, rej) => {
    const s = ioc(base, { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(s);
    s.once('init', (init) => res({ s, init }));
    s.once('connect_error', rej);
  });
}
const ack = <T = Record<string, unknown>>(s: Socket, ev: string, p: unknown = null) => new Promise<T>((r) => s.emit(ev, p, r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  db = openDb(':memory:');
  await seedAdmin(db);
  srv = createServer({ db, secret: 'test-secret' });
  await new Promise<void>((r) => srv.httpServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.httpServer.address() as AddressInfo).port}`;
});
afterAll(async () => { for (const s of sockets) s.close(); await srv.close(); });

describe('server integration', () => {
  it('seeds the BEST 𝕏 admin with ₦5,000,000,000 and a random password', () => {
    const admin = db.prepare("SELECT * FROM users WHERE username = 'bestx'").get() as { balance: number; is_admin: number; display_name: string; password_hash: string };
    expect(admin.balance).toBe(ADMIN_BALANCE); expect(admin.is_admin).toBe(1); expect(admin.display_name).toBe('BEST 𝕏');
    expect(admin.password_hash).toMatch(/^\$2/);
  });

  it('rejects unauthenticated sockets and bad logins', async () => {
    await expect(connect('bl_session=garbage')).rejects.toThrow(/unauthorized/);
    const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bestx', password: 'wrong-password' }) });
    expect(r.status).toBe(401);
    const r2 = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'kid', password: 'password123', ageConfirmed: false }) });
    expect(r2.status).toBe(400);
  });

  it('client cannot change its wallet', async () => {
    const u = await register('hacker1');
    const { s } = await connect(u.cookie);
    s.emit('wallet:set', { balance: 999999999 });
    s.emit('state', { x: -44, z: 10.5, rot: 0, moving: 0, inCar: false, carX: 0, carZ: 0, carRot: 0, balance: 999999999 });
    s.emit('job:deliver', { paid: 999999 });
    await wait(200);
    const w = await ack<{ balance: number }>(s, 'wallet');
    expect(w.balance).toBe(START_BALANCE);
    expect(getUser(db, u.id)!.balance).toBe(START_BALANCE);
  });

  it('rejects teleport position reports', async () => {
    const u = await register('teleporter');
    const { s } = await connect(u.cookie);
    const corrected = new Promise((r) => s.once('correct', r));
    s.emit('state', { x: MARKET_PICKUP.x, z: MARKET_PICKUP.z, rot: 0, moving: 0, inCar: false, carX: 0, carZ: 0, carRot: 0 });
    await corrected;
    const live = srv.game.lives.get(u.id)!;
    expect(Math.hypot(live.x - MARKET_PICKUP.x, live.z - MARKET_PICKUP.z)).toBeGreaterThan(20);
    const p = await ack<{ ok: boolean }>(s, 'job:pickup');
    expect(p.ok).toBe(false);
  });

  it('delivery job pays ₦1,500 only after valid pickup, drop-off and travel time', async () => {
    const u = await register('rider1');
    const { s } = await connect(u.cookie);
    const live = srv.game.lives.get(u.id)!;
    live.x = MARKET_PICKUP.x; live.z = MARKET_PICKUP.z; // test harness: place player at market
    const p = await ack<{ ok: boolean; dropoff: { name: string; x: number; z: number } }>(s, 'job:pickup');
    expect(p.ok).toBe(true);
    const d = DROPOFFS.find((x) => x.name === p.dropoff.name)!;
    live.x = d.x; live.z = d.z;
    const fast = await ack<{ ok: boolean; error: string }>(s, 'job:deliver');
    expect(fast.ok).toBe(false); expect(fast.error).toMatch(/fast/);
    live.job!.pickedAt -= 120_000; // simulate a realistic trip duration
    const walletEvt = new Promise<{ balance: number }>((r) => s.once('wallet', r));
    const ok = await ack<{ ok: boolean; paid: number }>(s, 'job:deliver');
    expect(ok.ok).toBe(true); expect(ok.paid).toBe(DELIVERY_PAY);
    expect((await walletEvt).balance).toBe(START_BALANCE + DELIVERY_PAY);
    const again = await ack<{ ok: boolean }>(s, 'job:deliver');
    expect(again.ok).toBe(false);
    const tx = db.prepare("SELECT * FROM transactions WHERE user_id = ? AND kind = 'job_delivery'").all(u.id);
    expect(tx).toHaveLength(1);
  });

  it('car wash charges ₦500 server-side and resets dirt; refuses outside the bay', async () => {
    const u = await register('washer1');
    const { s } = await connect(u.cookie);
    const notInCar = await ack<{ ok: boolean }>(s, 'carwash:buy');
    expect(notInCar.ok).toBe(false);
    const live = srv.game.lives.get(u.id)!;
    live.inCar = true; live.carX = 0; live.carZ = 0;
    expect((await ack<{ ok: boolean }>(s, 'carwash:buy')).ok).toBe(false);
    live.carX = CARWASH_ZONE.x; live.carZ = CARWASH_ZONE.z; live.dirt = 0.8;
    const dirtEvt = new Promise<{ dirt: number }>((r) => s.once('dirt', r));
    const r = await ack<{ ok: boolean; balance: number }>(s, 'carwash:buy');
    expect(r.ok).toBe(true); expect(r.balance).toBe(START_BALANCE - CARWASH_PRICE);
    expect((await dirtEvt).dirt).toBe(0);
    expect(getUser(db, u.id)!.car_dirt).toBe(0);
    expect(getUser(db, u.id)!.balance).toBe(START_BALANCE - CARWASH_PRICE);
  });

  it('driving accumulates dirt server-side', async () => {
    const u = await register('driver1');
    const { s, init } = await connect(u.cookie);
    const me = init.me as { car: { x: number; z: number }; x: number; z: number; dirt: number };
    const live = srv.game.lives.get(u.id)!;
    live.x = me.car.x; live.z = me.car.z; // stand next to car
    let x = me.car.x;
    for (let i = 0; i < 12; i++) { x += 3; s.emit('state', { x, z: me.car.z, rot: 0, moving: 20, inCar: true, carX: x, carZ: me.car.z, carRot: 0 }); await wait(120); }
    expect(live.inCar).toBe(true);
    expect(live.dirt).toBeGreaterThan(me.dirt);
  });

  it('presence, DMs and unread counts work across two players', async () => {
    const a = await register('ada_p'), b = await register('bayo_p');
    const A = await connect(a.cookie);
    const B = await connect(b.cookie);
    const list = await ack<{ players: { id: number; online: boolean }[] }>(A.s, 'players');
    expect(list.players.find((p) => p.id === b.id)!.online).toBe(true);
    const got = new Promise<{ body: string; from: number }>((r) => B.s.once('dm:new', r));
    const sent = await ack<{ ok: boolean }>(A.s, 'dm:send', { to: b.id, body: 'How far, Bayo?' });
    expect(sent.ok).toBe(true);
    const m = await got; expect(m.body).toBe('How far, Bayo?'); expect(m.from).toBe(a.id);
    expect((await ack<{ unread: Record<number, number> }>(B.s, 'dm:unread')).unread[a.id]).toBe(1);
    const th = await ack<{ messages: { body: string }[]; unread: Record<number, number> }>(B.s, 'dm:thread', { with: a.id });
    expect(th.messages.map((x) => x.body)).toEqual(['How far, Bayo?']);
    expect(th.unread[a.id]).toBeUndefined();
    const off = new Promise<{ id: number; online: boolean }>((r) => A.s.on('presence', (p) => { if (p.id === b.id && !p.online) r(p); }));
    B.s.close();
    expect((await off).online).toBe(false);
    const list2 = await ack<{ players: { id: number; online: boolean; lastSeen: number }[] }>(A.s, 'players');
    const bRow = list2.players.find((p) => p.id === b.id)!;
    expect(bRow.online).toBe(false); expect(bRow.lastSeen).toBeGreaterThan(0);
  });
});
