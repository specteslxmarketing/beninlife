import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, ack, wait, once, type Harness } from './helpers.js';
import {
  WEAPONS, GUN_SHOP, HOSPITAL, LICENCE_PRICE, ARMOUR_PRICE, applyDamage, falloff, rayBody, lineOfSight, safeZoneAt, validGangName, validGangTag, dirFrom, HEALTH_MAX,
} from '../shared/combat.js';
import { resolveShot, fireCheck, reload } from '../server/src/combat.js';
import { stepResponder, spawnResponder, ARREST_HOLD_MS } from '../server/src/responders.js';
import { roadRoute } from '../shared/roads.js';
import { applyTransaction } from '../server/src/wallet.js';
import { START_BALANCE, CLOTHING_STORE, POLICE_STATION } from '../shared/constants.js';

const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]!; };

describe('combat rules (pure)', () => {
  it('damage falls off with distance and armour soaks most of a hit', () => {
    const p = WEAPONS.pistol;
    expect(falloff(p, 10)).toBe(1);
    expect(falloff(p, p.range)).toBeCloseTo(0.4);
    expect(applyDamage(100, 0, 30)).toEqual({ health: 70, armour: 0 });
    const a = applyDamage(100, 100, 30); expect(a.armour).toBeCloseTo(80.5); expect(a.health).toBeCloseTo(89.5);
    expect(applyDamage(10, 0, 50).health).toBe(0);
  });
  it('ray vs body capsule: hits a person in front, misses beside/behind/beyond range', () => {
    const o = { x: 0, y: 1.5, z: 0 }; const d = { x: 0, y: 0, z: -1 };
    expect(rayBody(o, d, 50, 0, -10)?.t).toBeCloseTo(9.58, 1);
    expect(rayBody(o, d, 50, 1.2, -10)).toBeNull();
    expect(rayBody(o, d, 50, 0, 10)).toBeNull();
    expect(rayBody(o, d, 5, 0, -10)).toBeNull();
  });
  it('line of sight is blocked by walls', () => {
    const wall = { minX: -5, maxX: 5, minZ: -6, maxZ: -5 };
    expect(lineOfSight({ x: 0, z: 0 }, { x: 0, z: -10 }, [wall])).toBeCloseTo(0.5);
    expect(lineOfSight({ x: 0, z: 0 }, { x: 10, z: 0 }, [wall])).toBe(1);
  });
  it('server resolves hits: target, wall, headshot, protected (safe zone / gang mate), seated in car', () => {
    const aim = { x: 0, y: 0, z: -1 }; const p = WEAPONS.pistol; const r0 = seq(0, 0);
    const t = (over: object = {}) => [{ id: 7, x: 0, z: -10, inCar: false, protected: false, ...over }];
    const hit = resolveShot({ x: 0, z: 0 }, aim, p, t(), [], r0)[0]!;
    expect(hit.id).toBe(7); expect(hit.dmg).toBe(p.damage); expect(hit.head).toBe(false);
    expect(resolveShot({ x: 0, z: 0 }, aim, p, t(), [{ minX: -5, maxX: 5, minZ: -6, maxZ: -5 }], r0)[0]!.id).toBeNull();
    const up = { x: 0, y: Math.tan(0.012), z: -1 };
    expect(resolveShot({ x: 0, z: 0 }, up, p, t(), [], r0)[0]!.head).toBe(true);
    expect(resolveShot({ x: 0, z: 0 }, aim, p, t({ protected: true }), [], r0)[0]!.dmg).toBe(0);
    const car = resolveShot({ x: 0, z: 0 }, { x: 0, y: -0.04, z: -1 }, p, t({ inCar: true }), [], r0)[0]!;
    expect(car.id).toBe(7); expect(car.dmg).toBeCloseTo(p.damage * 0.6);
    expect(resolveShot({ x: 0, z: 0 }, aim, p, t({ z: -80 }), [], r0)[0]!.id).toBeNull(); // out of range
    expect(resolveShot({ x: 0, z: 0 }, aim, WEAPONS.shotgun, t({ z: -5 }), [], Math.random).length).toBe(8);
  });
  it('fire checks enforce magazine, fire rate, reload time and sane aim', () => {
    const f = { lastShot: 0, reloadUntil: 0, burst: [] as number[] }; const p = WEAPONS.pistol; const a = { mag: 2, reserve: 5 };
    expect(fireCheck(f, p, a, { x: 0, y: 0, z: -1 }, 1000).ok).toBe(true);
    expect(fireCheck(f, p, a, { x: 0, y: 0, z: -1 }, 1050)).toEqual({ ok: false, error: 'rate' });
    expect(fireCheck(f, p, a, { x: 0, y: 1, z: 0 }, 2000)).toEqual({ ok: false, error: 'bad_aim' });
    expect(fireCheck(f, p, a, 'nope', 3000)).toEqual({ ok: false, error: 'bad_aim' });
    expect(fireCheck(f, p, { mag: 0, reserve: 5 }, { x: 0, y: 0, z: -1 }, 4000)).toEqual({ ok: false, error: 'empty' });
    expect(fireCheck(f, p, undefined, { x: 0, y: 0, z: -1 }, 5000)).toEqual({ ok: false, error: 'no_weapon' });
    f.reloadUntil = 7000; expect(fireCheck(f, p, a, { x: 0, y: 0, z: -1 }, 6000)).toEqual({ ok: false, error: 'reloading' });
    expect(reload({ mag: 3, reserve: 5 }, p)).toEqual({ ammo: { mag: 8, reserve: 0 }, loaded: 5 });
  });
  it('safe zones: hospital, police station, clothing store, car stands, airport, gun shop', () => {
    expect(safeZoneAt(HOSPITAL.door.x, HOSPITAL.door.z)).toMatch(/Hospital/);
    expect(safeZoneAt(POLICE_STATION.door.x, POLICE_STATION.door.z)).toMatch(/Police/);
    expect(safeZoneAt(CLOTHING_STORE.door.x, CLOTHING_STORE.door.z)).toMatch(/Fashion/);
    expect(safeZoneAt(28, 91)).toBe('Car Stands');
    expect(safeZoneAt(0, -230)).toBe('Benin Airport');
    expect(safeZoneAt(GUN_SHOP.door.x, GUN_SHOP.door.z)).toMatch(/Arms/);
    expect(safeZoneAt(-44, 10.5)).toBeNull();
  });
  it('gang names refuse real cults/confraternities (incl. spacing and leetspeak) and accept fictional ones', () => {
    for (const bad of ['Black Axe', 'BL4CK  @XE crew', 'Eiye Boys', 'Buccaneers', 'Sea Dogs', 'The Vikings', 'Aiye', 'Maphite', 'M@phite', 'Klansman', 'KK', 'Neo Black Movement', 'Supreme Eiye', 'Green Circuit', 'Mafia Kings'])
      expect(validGangName(bad).ok, bad).toBe(false);
    for (const good of ['Ring Road Kings', 'Ugbowo Hustlers', 'Night Okada Union', 'Sapele Rd Crew']) expect(validGangName(good).ok, good).toBe(true);
    expect(validGangName('ab').ok).toBe(false);
    expect(validGangTag('RRK')).toBe('RRK'); expect(validGangTag('KK')).toBeNull(); expect(validGangTag('NBM')).toBeNull(); expect(validGangTag('toolong')).toBeNull();
  });
  it('police responders follow roads, close in on foot and arrest a suspect who stops (not one who keeps sprinting)', () => {
    const r = spawnResponder(1, 0); const suspect = { pos: { x: -60, z: 5 }, speed: 0, inCar: false, downed: false, inside: false };
    let res: string | null = null; let t = 0;
    for (; t < 120 && !res; t += 0.1) res = stepResponder(r, suspect, 0.1, t * 1000, []);
    expect(res).toBe('arrest'); expect(r.mode).toBe('foot');
    const r2 = spawnResponder(2, 0); r2.mode = 'foot'; r2.x = -60; r2.z = 9;
    const runner = { pos: { x: -60, z: 5 }, speed: 9, inCar: false, downed: false, inside: false };
    for (let i = 0; i < ARREST_HOLD_MS / 100 * 3; i++) { runner.pos.x -= 0.9; expect(stepResponder(r2, runner, 0.1, i * 100, [])).toBeNull(); }
    const pts = roadRoute(100, -8, -60, 5); expect(pts.length).toBeGreaterThan(3); expect(pts.at(-1)).toEqual([-60, 5.6]);
  });
  it('dirFrom yaw/pitch matches the camera convention (yaw 0 looks toward -z)', () => {
    const d = dirFrom(0, 0); expect(d.z).toBeCloseTo(-1); expect(d.x).toBeCloseTo(0);
  });
});

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });
type R = { ok: boolean; error?: string; balance?: number; state?: { licence: boolean; weapons: Record<string, { mag: number; reserve: number }>; armour: number }; mag?: number; hits?: { id: number | null; dmg: number }[]; equipped?: string };
const place = (id: number, x: number, z: number) => { const l = h.srv.game.lives.get(id)!; l.x = x; l.z = z; l.inCar = false; };
const fund = (id: number, n: number) => applyTransaction(h.db, id, n, 'test', 'test funds');

describe('gun shop (server-side purchases)', () => {
  it('needs presence at the shop, a licence first, money, and a clean record', async () => {
    const u = await h.register('gs_buyer'); const { s } = await h.connect(u.cookie);
    place(u.id, 0, 40);
    expect((await ack<R>(s, 'gun:licence')).error).toMatch(/Go to/);
    place(u.id, GUN_SHOP.door.x, GUN_SHOP.door.z);
    expect((await ack<R>(s, 'gun:buy', { id: 'pistol' })).error).toMatch(/licence is required/);
    expect((await ack<R>(s, 'gun:licence')).error).toMatch(/Not enough money/); // START_BALANCE < licence
    fund(u.id, LICENCE_PRICE + WEAPONS.pistol.price + WEAPONS.pistol.ammoPrice + ARMOUR_PRICE);
    const lic = await ack<R>(s, 'gun:licence'); expect(lic.ok).toBe(true); expect(lic.state!.licence).toBe(true);
    const gun = await ack<R>(s, 'gun:buy', { id: 'pistol' }); expect(gun.ok).toBe(true);
    expect(gun.state!.weapons.pistol).toEqual({ mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.ammoPack });
    expect((await ack<R>(s, 'gun:buy', { id: 'pistol' })).error).toMatch(/already own/);
    expect((await ack<R>(s, 'gun:buy', { id: 'rocket' })).error).toMatch(/No such weapon/);
    const ammo = await ack<R>(s, 'gun:ammo', { id: 'pistol' }); expect(ammo.state!.weapons.pistol!.reserve).toBe(WEAPONS.pistol.ammoPack * 2);
    const arm = await ack<R>(s, 'gun:armour'); expect(arm.state!.armour).toBe(100);
    expect(arm.balance).toBe(START_BALANCE);
    h.srv.game.lives.get(u.id)!.police.wanted = 2;
    expect((await ack<R>(s, 'gun:ammo', { id: 'pistol' })).error).toMatch(/wanted/);
    h.srv.game.lives.get(u.id)!.police.wanted = 0;
  });
});

async function armed(name: string) {
  const u = await h.register(name); const c = await h.connect(u.cookie);
  fund(u.id, LICENCE_PRICE + WEAPONS.pistol.price);
  place(u.id, GUN_SHOP.door.x, GUN_SHOP.door.z);
  await ack(c.s, 'gun:licence'); await ack(c.s, 'gun:buy', { id: 'pistol' });
  return { ...u, s: c.s };
}

describe('shooting (server-authoritative)', () => {
  it('equip is refused in safe zones; shots hit, damage, raise the wanted level, and knock down → hospital with fee', async () => {
    const A = await armed('sh_a'); const B = await h.register('sh_b'); const b = await h.connect(B.cookie);
    expect((await ack<R>(A.s, 'gun:equip', { id: 'pistol' })).error).toMatch(/disabled here/); // still at the gun shop
    place(A.id, -60, 5); place(B.id, -60, -5);
    expect((await ack<R>(A.s, 'gun:equip', { id: 'pistol' })).equipped).toBe('pistol');
    const hurt = once<{ health: number; fromName: string }>(b.s, 'combat:hurt');
    const r = await ack<R>(A.s, 'gun:fire', { aim: { x: 0, y: -0.02, z: -1 } });
    expect(r.ok).toBe(true); expect(r.mag).toBe(WEAPONS.pistol.mag - 1); expect(r.hits![0]!.id).toBe(B.id);
    const hh = await hurt; expect(hh.health).toBeLessThan(HEALTH_MAX); expect(hh.fromName).toBe('sh_a');
    expect(h.srv.game.lives.get(A.id)!.police.wanted).toBeGreaterThanOrEqual(2);
    // too fast → rate limited
    expect((await ack<R>(A.s, 'gun:fire', { aim: { x: 0, y: -0.02, z: -1 } })).error).toBe('rate');
    // knock down
    const vb = h.srv.game.lives.get(B.id)!; vb.cb.health = 5;
    const down = once<{ ms: number }>(b.s, 'combat:down');
    await wait(300); await ack<R>(A.s, 'gun:fire', { aim: { x: 0, y: -0.02, z: -1 } });
    expect((await down).ms).toBeGreaterThan(0);
    expect(h.srv.game.combat.isDowned(vb as never)).toBe(true);
    const bal0 = h.db.prepare('SELECT balance FROM users WHERE id = ?').get(B.id) as { balance: number };
    vb.cb.downedUntil = Date.now() - 1; // fast-forward the 10 s
    const resp = await once<{ fee: number }>(b.s, 'combat:respawn', 2000);
    expect(resp.fee).toBe(HOSPITAL.fee);
    expect(vb.cb.health).toBe(HEALTH_MAX); expect(Math.hypot(vb.x - HOSPITAL.respawn.x, vb.z - HOSPITAL.respawn.z)).toBeLessThan(0.1);
    expect((h.db.prepare('SELECT balance FROM users WHERE id = ?').get(B.id) as { balance: number }).balance).toBe(bal0.balance - HOSPITAL.fee);
    expect(h.srv.game.combat.responders.some((r2) => r2.target === A.id)).toBe(true); // police dispatched
  });
  it('targets inside a safe zone take no damage; shooting from inside one is refused', async () => {
    const A = await armed('sz_a'); const B = await h.register('sz_b'); await h.connect(B.cookie);
    place(A.id, HOSPITAL.door.x, HOSPITAL.door.z + 14); place(B.id, HOSPITAL.door.x, HOSPITAL.door.z + 2);
    await ack(A.s, 'gun:equip', { id: 'pistol' });
    const r = await ack<R>(A.s, 'gun:fire', { aim: { x: 0, y: -0.02, z: -1 } });
    expect(r.ok).toBe(true); expect(r.hits![0]!.dmg).toBe(0);
    place(A.id, HOSPITAL.door.x, HOSPITAL.door.z);
    await wait(320);
    expect((await ack<R>(A.s, 'gun:fire', { aim: { x: 0, y: 0, z: -1 } })).error).toMatch(/^(safe_zone|no_weapon)$/); // auto-holstered on entry
    expect(h.srv.game.lives.get(A.id)!.cb.equipped).toBeNull();
  });
});

describe('gangs', () => {
  it('create (₦ fee, fictional name only), invite, accept, chat, kick and leave', async () => {
    const L = await h.register('gg_lead'); const l = await h.connect(L.cookie); fund(L.id, 30_000);
    const M = await h.register('gg_mem'); const m = await h.connect(M.cookie);
    expect((await ack<R>(l.s, 'gang:create', { name: 'Black Axe', tag: 'BAX', color: '#c0392b', emblem: '★' })).error).toMatch(/real cult/);
    const c = await ack<R & { gang: { id: number; tag: string } }>(l.s, 'gang:create', { name: 'Ring Road Kings', tag: 'RRK', color: '#c0392b', emblem: '★' });
    expect(c.ok).toBe(true); expect(c.gang.tag).toBe('RRK');
    expect((await ack<R>(m.s, 'gang:invite', { id: L.id })).error).toMatch(/not in a gang/);
    const inv = once<{ gang: { name: string } }>(m.s, 'gang:invited');
    expect((await ack<R>(l.s, 'gang:invite', { id: M.id })).ok).toBe(true);
    expect((await inv).gang.name).toBe('Ring Road Kings');
    expect((await ack<R>(m.s, 'gang:respond', { id: c.gang.id, accept: true })).ok).toBe(true);
    const info = await ack<{ members: { name: string; role: string }[] }>(m.s, 'gang:info');
    expect(info.members.map((x) => x.name)).toEqual(['gg_lead', 'gg_mem']);
    const msg = once<{ body: string; fromName: string }>(l.s, 'gang:chat');
    await ack(m.s, 'gang:chat', 'meet at the roundabout');
    expect(await msg).toMatchObject({ body: 'meet at the roundabout', fromName: 'gg_mem' });
    expect(h.srv.game.snapshot(h.srv.game.lives.get(M.id)!).gang).toMatchObject({ tag: 'RRK' });
    // gang mates are protected from each other while friendly fire is off
    expect((await ack<R>(m.s, 'gang:update', { friendlyFire: true })).error).toMatch(/Only the leader/);
    expect((await ack<R>(l.s, 'gang:kick', { id: M.id })).ok).toBe(true);
    expect(h.srv.game.lives.get(M.id)!.cb.gang).toBeNull();
    expect((await ack<R>(l.s, 'gang:leave')).ok).toBe(true);
    expect((h.db.prepare('SELECT COUNT(*) AS n FROM gangs WHERE tag = ?').get('RRK') as { n: number }).n).toBe(0); // disbanded when empty
  });
});
