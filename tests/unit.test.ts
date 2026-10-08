import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, getUserByName, type DB } from '../server/src/db.js';
import { hashPassword, verifyPassword, registerUser, loginUser, AuthError, signToken, verifyToken } from '../server/src/auth.js';
import { applyTransaction, getBalance, listTransactions, WalletError } from '../server/src/wallet.js';
import { tryPickup, tryDeliver, canWash, validMove } from '../server/src/rules.js';
import { saveDm, unreadCounts, markRead, dmThread } from '../server/src/messages.js';
import { CARWASH_ZONE, DROPOFFS, MARKET_PICKUP, START_BALANCE, minDeliverySeconds, dist } from '../shared/constants.js';

let db: DB;
beforeEach(() => { db = openDb(':memory:'); });

describe('auth', () => {
  it('hashes passwords with bcrypt and verifies them', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h).not.toContain('correct horse');
    expect(h).toMatch(/^\$2[aby]\$10\$/);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong password', h)).toBe(false);
  });
  it('validates signup server-side (18+, username, password)', async () => {
    await expect(registerUser(db, 'osas', 'password123', false)).rejects.toThrow(/18/);
    await expect(registerUser(db, 'os', 'password123', true)).rejects.toThrow(AuthError);
    await expect(registerUser(db, 'bad name!', 'password123', true)).rejects.toThrow(AuthError);
    await expect(registerUser(db, 'osas', 'short', true)).rejects.toThrow(/8 characters/);
    const u = await registerUser(db, 'osas', 'password123', true);
    expect(u.password_hash).not.toBe('password123');
    await expect(registerUser(db, 'OSAS', 'password123', true)).rejects.toThrow(/taken/);
  });
  it('logs in only with the right password and starts with ₦5,000', async () => {
    await registerUser(db, 'efosa', 'password123', true);
    await expect(loginUser(db, 'efosa', 'nope-nope-nope')).rejects.toThrow(AuthError);
    await expect(loginUser(db, 'ghost', 'password123')).rejects.toThrow(AuthError);
    const u = await loginUser(db, 'efosa', 'password123');
    expect(getBalance(db, u.id)).toBe(START_BALANCE);
    expect(listTransactions(db, u.id)[0].kind).toBe('signup_bonus');
  });
  it('signs and verifies session tokens; rejects tampered tokens', () => {
    const t = signToken('secret-a', 7);
    expect(verifyToken('secret-a', t)).toBe(7);
    expect(verifyToken('secret-b', t)).toBeNull();
    expect(verifyToken('secret-a', t.slice(0, -2) + 'xx')).toBeNull();
  });
});

describe('wallet', () => {
  it('credits/debits atomically with a transaction record and never goes negative', async () => {
    const u = await registerUser(db, 'iyobosa', 'password123', true);
    expect(applyTransaction(db, u.id, 1500, 'job_delivery')).toBe(6500);
    expect(applyTransaction(db, u.id, -500, 'car_wash')).toBe(6000);
    expect(() => applyTransaction(db, u.id, -999999, 'car_wash')).toThrow(WalletError);
    expect(() => applyTransaction(db, u.id, 1.5, 'x')).toThrow(WalletError);
    expect(getBalance(db, u.id)).toBe(6000);
    expect(listTransactions(db, u.id).map((t) => t.amount)).toEqual([-500, 1500, 5000]);
  });
});

describe('job rules', () => {
  it('pickup requires being at the market', () => {
    expect(tryPickup({ x: 0, z: 0 }, Date.now(), null).ok).toBe(false);
    const r = tryPickup({ x: MARKET_PICKUP.x + 1, z: MARKET_PICKUP.z }, Date.now(), null, () => 0);
    expect(r.ok).toBe(true);
  });
  it('delivery requires right place and plausible travel time', () => {
    const t0 = 1_000_000;
    const r = tryPickup(MARKET_PICKUP, t0, null, () => 0);
    if (!r.ok) throw new Error('pickup failed');
    const job = r.value; const d = DROPOFFS[job.dropoff];
    const minMs = minDeliverySeconds(dist(MARKET_PICKUP, d)) * 1000;
    expect(tryDeliver({ x: d.x + 30, z: d.z }, t0 + minMs + 1000, job).ok).toBe(false); // wrong place
    const fast = tryDeliver(d, t0 + 2000, job);
    expect(fast.ok).toBe(false);
    if (!fast.ok) expect(fast.error).toMatch(/fast/);
    expect(tryDeliver(d, t0 + minMs + 10, job).ok).toBe(true);
    expect(tryDeliver(d, t0 + minMs + 10, null).ok).toBe(false);
  });
  it('car wash needs car, zone and money', () => {
    const inside = { x: CARWASH_ZONE.x, z: CARWASH_ZONE.z };
    expect(canWash(false, inside, 5000, 500).ok).toBe(false);
    expect(canWash(true, { x: 0, z: 0 }, 5000, 500).ok).toBe(false);
    expect(canWash(true, inside, 100, 500).ok).toBe(false);
    expect(canWash(true, inside, 500, 500).ok).toBe(true);
  });
  it('movement validation rejects teleports and speed hacks', () => {
    expect(validMove({ x: 0, z: 0 }, { x: 0.8, z: 0 }, 100, false)).toBe(true);
    expect(validMove({ x: 0, z: 0 }, { x: 50, z: 0 }, 100, false)).toBe(false);
    expect(validMove({ x: 0, z: 0 }, { x: 4, z: 0 }, 100, true)).toBe(true);
    expect(validMove({ x: 0, z: 0 }, { x: 0, z: 9999 }, 100000, true)).toBe(false);
    expect(validMove({ x: 0, z: 0 }, { x: NaN, z: 0 }, 100, true)).toBe(false);
  });
});

describe('direct messages', () => {
  it('stores DMs with unread counts and marks them read', async () => {
    const a = await registerUser(db, 'ada', 'password123', true);
    const b = await registerUser(db, 'bayo', 'password123', true);
    saveDm(db, a.id, b.id, 'How far?');
    saveDm(db, a.id, b.id, 'You dey come market?');
    expect(unreadCounts(db, b.id)).toEqual({ [a.id]: 2 });
    expect(unreadCounts(db, a.id)).toEqual({});
    expect(dmThread(db, b.id, a.id).map((m) => m.body)).toEqual(['How far?', 'You dey come market?']);
    markRead(db, b.id, a.id);
    expect(unreadCounts(db, b.id)).toEqual({});
    expect(getUserByName(db, 'ada')).toBeTruthy();
  });
});
