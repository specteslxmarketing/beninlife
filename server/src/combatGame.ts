// Wires weapons, damage, knockdown/hospital, police response and gangs into the live game (sockets + tick).
import type { Server, Socket } from 'socket.io';
import type { DB } from './db.js';
import { applyTransaction, getBalance } from './wallet.js';
import {
  buyAmmo, buyArmour, buyLicence, buyWeapon, fireCheck, loadArsenal, migrateCombat, reload, resolveShot, saveAmmo, saveArmour,
  type Arsenal, type FireState,
} from './combat.js';
import { houseStates } from './houses.js';
import { createGang, gangChat, gangOf, invite, invitesFor, kick, leave, members, migrateGangs, postGangChat, respond, updateGang, type GangInfo } from './gangs.js';
import { spawnResponder, stepResponder, unitsFor, type Responder } from './responders.js';
import { RateLimit } from './voice.js';
import {
  DOWNED_MS, HEALTH_MAX, HEALTH_REGEN_DELAY_MS, HEALTH_REGEN_PER_S, HOSPITAL, POLICE_DOWN_STARS, POLICE_HIT_STARS, POLICE_SHOTS_STARS, WEAPONS,
  applyDamage, isWeaponId, safeZoneAt, type Box2, type WeaponId,
} from '../../shared/combat.js';
import { WALLS } from '../../shared/walls.js';
import { FINE_PER_STAR, POLICE_STATION, WANTED_MAX, houseAt, inLagos } from '../../shared/constants.js';

export interface CombatLive {
  health: number; armour: number; arsenal: Arsenal; equipped: WeaponId | null; fire: FireState;
  downedUntil: number; lastHurt: number; gang: GangInfo | null; lastShotFired: number;
}
/** the subset of the server's Live record the combat system needs */
export interface LiveLike {
  userId: number; name: string; admin: boolean; x: number; z: number; rot: number; inCar: boolean; arrived: boolean;
  carX: number; carZ: number; carRot: number; speed: number; ride: { driver: number } | null;
  police: { wanted: number; lastSeenAt: number; lastDecayAt: number }; job: unknown; taxi: unknown; station: unknown; cb: CombatLive;
}
export interface GameHooks {
  lives: Map<number, LiveLike>;
  teleportLive(l: LiveLike, x: number, z: number, rot: number): void;
  sendWallet(uid: number): void;
  saveWanted(l: LiveLike): void;
}
type Ack = (r: Record<string, unknown>) => void;
const safeAck = (a: unknown): Ack => (typeof a === 'function' ? (a as Ack) : () => {});
export const walls: Box2[] = [];
for (let i = 0; i + 3 < WALLS.length; i += 4) walls.push({ minX: WALLS[i]!, maxX: WALLS[i + 1]!, minZ: WALLS[i + 2]!, maxZ: WALLS[i + 3]! });

export class CombatSystem {
  responders: Responder[] = [];
  constructor(private db: DB, private io: Server, private g: GameHooks) { migrateCombat(db); migrateGangs(db); }

  newLive(uid: number): CombatLive {
    const arsenal = loadArsenal(this.db, uid);
    return { health: HEALTH_MAX, armour: arsenal.armour, arsenal, equipped: null, fire: { lastShot: 0, reloadUntil: 0, burst: [] }, downedUntil: 0, lastHurt: 0, gang: gangOf(this.db, uid), lastShotFired: 0 };
  }
  /** weapons-disabled reason at the player's position, or null */
  weaponBlock(l: LiveLike): string | null {
    if (!l.arrived) return 'On the plane';
    const h = houseAt(l.x, l.z);
    if (h) {
      const r = this.db.prepare('SELECT weapons_allowed FROM houses WHERE id = ?').get(h.id) as { weapons_allowed: number } | undefined;
      if (!r?.weapons_allowed) return `Inside ${h.name} (owner has not allowed weapons)`;
      return null;
    }
    return safeZoneAt(l.x, l.z);
  }
  isDowned(l: LiveLike, now = Date.now()): boolean { return l.cb.downedUntil > now; }
  snapshotExtra(l: LiveLike): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    if (l.cb.health < HEALTH_MAX) o.hp = Math.round(l.cb.health);
    if (l.cb.downedUntil > Date.now()) o.down = true;
    if (l.cb.equipped) o.wpn = l.cb.equipped;
    if (l.cb.gang) o.gang = { id: l.cb.gang.id, tag: l.cb.gang.tag, color: l.cb.gang.color, emblem: l.cb.gang.emblem };
    if (l.cb.armour > 0) o.arm = 1;
    return o;
  }
  state(l: LiveLike): Record<string, unknown> {
    return { health: l.cb.health, armour: l.cb.armour, licence: l.cb.arsenal.licence, weapons: l.cb.arsenal.weapons, equipped: l.cb.equipped, downedUntil: l.cb.downedUntil, gang: l.cb.gang };
  }
  private push(l: LiveLike): void { this.io.to(`u:${l.userId}`).emit('combat:state', this.state(l)); }
  private addStars(l: LiveLike, n: number, reason: string): void {
    // GTA-style: each crime sets a minimum level (shots ★1, wounding ★2, knock-down ★3); only repeated knock-downs escalate
    const before = l.police.wanted;
    const next = before >= n ? (n >= POLICE_DOWN_STARS ? before + 1 : before) : n;
    l.police.wanted = Math.min(WANTED_MAX, next);
    const now = Date.now(); l.police.lastSeenAt = now; l.police.lastDecayAt = now;
    if (l.police.wanted !== before) { this.g.saveWanted(l); this.io.to(`u:${l.userId}`).emit('wanted', { wanted: l.police.wanted, reason, crime: true }); }
  }

  attach(socket: Socket, l: LiveLike): void {
    const uid = l.userId;
    const shop = () => ({ pos: { x: l.x, z: l.z }, onFoot: !l.inCar && !l.ride, wanted: l.police.wanted });
    const after = (ack: unknown, r: { ok: true; value: number } | { ok: false; error: string }) => {
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.cb.arsenal = loadArsenal(this.db, uid); l.cb.armour = l.cb.arsenal.armour; this.g.sendWallet(uid); this.push(l);
      safeAck(ack)({ ok: true, balance: r.value, state: this.state(l) });
    };
    socket.on('combat:state', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, state: this.state(l) }));
    socket.on('gun:licence', (_: unknown, ack: unknown) => after(ack, buyLicence(this.db, uid, shop())));
    socket.on('gun:buy', (p: { id?: unknown }, ack: unknown) => after(ack, buyWeapon(this.db, uid, p?.id, shop())));
    socket.on('gun:ammo', (p: { id?: unknown }, ack: unknown) => after(ack, buyAmmo(this.db, uid, p?.id, shop())));
    socket.on('gun:armour', (_: unknown, ack: unknown) => after(ack, buyArmour(this.db, uid, shop())));
    socket.on('gun:equip', (p: { id?: unknown }, ack: unknown) => {
      if (p?.id === null) { l.cb.equipped = null; return safeAck(ack)({ ok: true, equipped: null }); }
      if (!isWeaponId(p?.id) || !l.cb.arsenal.weapons[p.id]) return safeAck(ack)({ ok: false, error: 'You do not own that weapon' });
      const block = this.weaponBlock(l); if (block) return safeAck(ack)({ ok: false, error: `Weapons are disabled here — ${block}` });
      if (l.inCar || l.ride) return safeAck(ack)({ ok: false, error: 'Not from inside a vehicle' });
      if (this.isDowned(l)) return safeAck(ack)({ ok: false, error: 'You are wounded' });
      l.cb.equipped = p.id; safeAck(ack)({ ok: true, equipped: p.id });
    });
    socket.on('gun:reload', (_: unknown, ack: unknown) => {
      const w = l.cb.equipped; const a = w ? l.cb.arsenal.weapons[w] : undefined;
      if (!w || !a) return safeAck(ack)({ ok: false, error: 'no_weapon' });
      const now = Date.now(); if (now < l.cb.fire.reloadUntil) return safeAck(ack)({ ok: false, error: 'reloading' });
      const r = reload(a, WEAPONS[w]); if (!r.loaded) return safeAck(ack)({ ok: false, error: a.reserve ? 'full' : 'no_ammo' });
      l.cb.arsenal.weapons[w] = r.ammo; l.cb.fire.reloadUntil = now + WEAPONS[w].reloadMs; saveAmmo(this.db, uid, w, r.ammo);
      safeAck(ack)({ ok: true, ms: WEAPONS[w].reloadMs, mag: r.ammo.mag, reserve: r.ammo.reserve });
    });
    const shotLimit = new RateLimit(14);
    socket.on('gun:fire', (p: { aim?: unknown; seq?: unknown }, ack: unknown) => {
      const now = Date.now(); const w = l.cb.equipped;
      if (!shotLimit.take()) return safeAck(ack)({ ok: false, error: 'rate' });
      if (!w) return safeAck(ack)({ ok: false, error: 'no_weapon' });
      if (this.isDowned(l)) return safeAck(ack)({ ok: false, error: 'downed' });
      if (l.inCar || l.ride) return safeAck(ack)({ ok: false, error: 'in_vehicle' });
      const block = this.weaponBlock(l); if (block) { l.cb.equipped = null; return safeAck(ack)({ ok: false, error: 'safe_zone', zone: block }); }
      const def = WEAPONS[w]; const ammo = l.cb.arsenal.weapons[w];
      const c = fireCheck(l.cb.fire, def, ammo, p?.aim, now);
      if (!c.ok) return safeAck(ack)({ ok: false, error: c.error, mag: ammo?.mag, reserve: ammo?.reserve });
      ammo!.mag--; l.cb.lastShotFired = now;
      if (ammo!.mag % 5 === 0) saveAmmo(this.db, uid, w, ammo!);
      const city = inLagos(l.x, l.z);
      const targets = [...this.g.lives.values()].filter((o) => o !== l && o.arrived && inLagos(o.x, o.z) === city && !this.isDowned(o, now) && Math.hypot(o.x - l.x, o.z - l.z) < def.range + 2 && !houseAt(o.x, o.z))
        .map((o) => ({ id: o.userId, x: o.ride ? o.x : o.inCar ? o.carX : o.x, z: o.ride ? o.z : o.inCar ? o.carZ : o.z, inCar: o.inCar || !!o.ride,
          protected: !!safeZoneAt(o.x, o.z) || (!!l.cb.gang && o.cb.gang?.id === l.cb.gang.id && !l.cb.gang.friendlyFire) }));
      const hits = resolveShot({ x: l.x, z: l.z }, c.aim, def, targets, walls);
      // apply damage per victim
      const per = new Map<number, { dmg: number; head: boolean }>();
      for (const h of hits) if (h.id !== null && h.dmg > 0) { const e = per.get(h.id) ?? { dmg: 0, head: false }; e.dmg += h.dmg; e.head ||= h.head; per.set(h.id, e); }
      let downed = 0;
      for (const [vid, e] of per) {
        const v = this.g.lives.get(vid)!; const r = applyDamage(v.cb.health, v.cb.armour, e.dmg);
        v.cb.health = r.health; if (r.armour !== v.cb.armour) { v.cb.armour = r.armour; saveArmour(this.db, vid, r.armour); }
        v.cb.lastHurt = now;
        this.io.to(`u:${vid}`).emit('combat:hurt', { from: uid, fromName: l.name, dmg: e.dmg, head: e.head, health: v.cb.health, armour: v.cb.armour, fx: l.x, fz: l.z });
        if (v.cb.health <= 0) { downed++; this.knockDown(v, l); }
      }
      // police respond to every shooting in public
      const rep = l.cb.fire as FireState & { reportedAt?: number };
      if (downed) this.addStars(l, POLICE_DOWN_STARS, 'Knocked someone down with a firearm');
      else if (per.size) this.addStars(l, POLICE_HIT_STARS, 'Shot a person — police are responding');
      else if (!rep.reportedAt || now - rep.reportedAt > 15_000) { rep.reportedAt = now; this.addStars(l, POLICE_SHOTS_STARS, 'Shots fired — witnesses called the police'); }
      // tell everyone nearby (tracers, muzzle flash, sound)
      for (const o of this.g.lives.values()) if (o !== l && inLagos(o.x, o.z) === city && Math.hypot(o.x - l.x, o.z - l.z) < 220)
        this.io.to(`u:${o.userId}`).emit('gun:shot', { from: uid, w, x: l.x, z: l.z, hits: hits.map((h) => ({ x: h.point.x, y: h.point.y, z: h.point.z, id: h.id })) });
      safeAck(ack)({ ok: true, mag: ammo!.mag, reserve: ammo!.reserve, hits: hits.map((h) => ({ x: h.point.x, y: h.point.y, z: h.point.z, id: h.id, dmg: h.dmg, head: h.head })), seq: p?.seq });
    });

    // ---- houses: owner toggles weapons inside
    socket.on('house:weapons', (p: { id?: unknown; allowed?: unknown }, ack: unknown) => {
      const r = this.db.prepare('UPDATE houses SET weapons_allowed = ? WHERE id = ? AND owner_id = ?').run(p?.allowed === true ? 1 : 0, String(p?.id ?? ''), uid);
      if (r.changes) this.io.emit('houses', houseStates(this.db));
      safeAck(ack)(r.changes ? { ok: true, allowed: p?.allowed === true } : { ok: false, error: 'Only the owner can change this' });
    });

    // ---- gangs
    const refreshGang = (gid: number | null) => {
      for (const o of this.g.lives.values()) if (gid === null ? o === l : (o.cb.gang?.id === gid || o === l)) { o.cb.gang = gangOf(this.db, o.userId); this.push(o); }
    };
    socket.on('gang:info', (_: unknown, ack: unknown) => {
      const gang = gangOf(this.db, uid);
      safeAck(ack)({ ok: true, gang, members: gang ? members(this.db, gang.id).map((m) => ({ ...m, online: this.g.lives.has(m.id) })) : [], invites: invitesFor(this.db, uid), chat: gang ? gangChat(this.db, gang.id) : [] });
    });
    socket.on('gang:create', (p: Record<string, unknown>, ack: unknown) => {
      const r = createGang(this.db, uid, p ?? {}); if (!r.ok) return safeAck(ack)(r);
      socket.join(`gang:${r.gang.id}`); this.g.sendWallet(uid); refreshGang(r.gang.id); safeAck(ack)({ ok: true, gang: r.gang });
    });
    socket.on('gang:invite', (p: { id?: unknown }, ack: unknown) => {
      const r = invite(this.db, uid, typeof p?.id === 'number' ? p.id : -1); if (!r.ok) return safeAck(ack)(r);
      this.io.to(`u:${p.id}`).emit('gang:invited', { gang: r.gang, fromName: l.name }); safeAck(ack)({ ok: true });
    });
    socket.on('gang:respond', (p: { id?: unknown; accept?: unknown }, ack: unknown) => {
      const r = respond(this.db, uid, typeof p?.id === 'number' ? p.id : -1, p?.accept === true); if (!r.ok) return safeAck(ack)(r);
      if (r.gang) { for (const s of this.socketsOf(uid)) s.join(`gang:${r.gang.id}`); this.io.to(`gang:${r.gang.id}`).emit('gang:event', { text: `${l.name} joined the gang` }); refreshGang(r.gang.id); }
      safeAck(ack)({ ok: true, gang: r.gang });
    });
    socket.on('gang:leave', (_: unknown, ack: unknown) => {
      const r = leave(this.db, uid); if (!r.ok) return safeAck(ack)(r);
      for (const s of this.socketsOf(uid)) s.leave(`gang:${r.gangId}`);
      this.io.to(`gang:${r.gangId}`).emit('gang:event', { text: `${l.name} left the gang` }); refreshGang(r.gangId); refreshGang(null); safeAck(ack)({ ok: true });
    });
    socket.on('gang:kick', (p: { id?: unknown }, ack: unknown) => {
      const tid = typeof p?.id === 'number' ? p.id : -1; const r = kick(this.db, uid, tid); if (!r.ok) return safeAck(ack)(r);
      for (const s of this.socketsOf(tid)) s.leave(`gang:${r.gangId}`);
      this.io.to(`u:${tid}`).emit('gang:event', { text: 'You were removed from the gang' });
      const t = this.g.lives.get(tid); if (t) { t.cb.gang = null; this.push(t); }
      refreshGang(r.gangId); safeAck(ack)({ ok: true });
    });
    socket.on('gang:update', (p: Record<string, unknown>, ack: unknown) => { const r = updateGang(this.db, uid, p ?? {}); if (!r.ok) return safeAck(ack)(r); refreshGang(r.gang.id); safeAck(ack)({ ok: true, gang: r.gang }); });
    let lastGangChat = 0;
    socket.on('gang:chat', (body: unknown, ack: unknown) => {
      const now = Date.now(); if (now - lastGangChat < 500) return safeAck(ack)({ ok: false, error: 'slow down' }); lastGangChat = now;
      const r = postGangChat(this.db, uid, body); if (!r.ok) return safeAck(ack)(r);
      this.io.to(`gang:${r.gangId}`).emit('gang:chat', r.msg); safeAck(ack)({ ok: true });
    });
    if (l.cb.gang) socket.join(`gang:${l.cb.gang.id}`);
  }
  private socketsOf(uid: number): Socket[] { return [...this.io.sockets.sockets.values()].filter((s) => s.rooms.has(`u:${uid}`)); }

  knockDown(v: LiveLike, by: LiveLike | null): void {
    const now = Date.now();
    v.cb.downedUntil = now + DOWNED_MS; v.cb.equipped = null; v.job = null; v.taxi = null; v.station = null;
    this.io.to(`u:${v.userId}`).emit('combat:down', { by: by?.name ?? null, until: v.cb.downedUntil, ms: DOWNED_MS });
    if (by) this.io.to(`u:${by.userId}`).emit('combat:downed-other', { name: v.name });
  }
  private hospitalise(v: LiveLike): void {
    const bal = getBalance(this.db, v.userId); const fee = Math.min(HOSPITAL.fee, bal);
    if (fee > 0) applyTransaction(this.db, v.userId, -fee, 'hospital', `Treatment at ${HOSPITAL.name}`);
    let fine = 0; const stars = v.police.wanted;
    if (stars > 0) { fine = Math.min(FINE_PER_STAR * stars, getBalance(this.db, v.userId)); if (fine > 0) applyTransaction(this.db, v.userId, -fine, 'police_fine', `Police fine — taken into custody at hospital (${stars}★)`); v.police.wanted = 0; this.g.saveWanted(v); }
    v.cb.downedUntil = 0; v.cb.health = HEALTH_MAX; v.cb.lastHurt = 0;
    this.g.teleportLive(v, HOSPITAL.respawn.x, HOSPITAL.respawn.z, HOSPITAL.respawn.rot);
    this.io.to(`u:${v.userId}`).emit('combat:respawn', { fee, fine, stars, hospital: HOSPITAL.name });
    if (stars) this.io.to(`u:${v.userId}`).emit('wanted', { wanted: 0, arrested: true, fine, reason: `Treated under police guard and fined at ${HOSPITAL.name}` });
    this.g.sendWallet(v.userId); this.push(v);
  }
  private arrest(l: LiveLike): void {
    const stars = l.police.wanted; const fine = Math.min(FINE_PER_STAR * stars, getBalance(this.db, l.userId));
    if (fine > 0) applyTransaction(this.db, l.userId, -fine, 'police_fine', `Police fine — arrested by responding officers (${stars}★)`);
    l.police.wanted = 0; this.g.saveWanted(l); l.job = null; l.taxi = null; l.station = null; l.cb.equipped = null; l.cb.downedUntil = 0; l.cb.health = Math.max(l.cb.health, 40);
    this.g.teleportLive(l, POLICE_STATION.release.x, POLICE_STATION.release.z, POLICE_STATION.release.rot);
    this.io.to(`u:${l.userId}`).emit('wanted', { wanted: 0, arrested: true, fine, reason: `Arrested by responding officers and taken to ${POLICE_STATION.name}` });
    this.g.sendWallet(l.userId); this.push(l);
  }

  /** called 10×/s from the game tick */
  tick(dt: number): void {
    const now = Date.now();
    for (const l of this.g.lives.values()) {
      if (l.cb.downedUntil && now >= l.cb.downedUntil) this.hospitalise(l);
      else if (!l.cb.downedUntil && l.cb.health < HEALTH_MAX && now - l.cb.lastHurt > HEALTH_REGEN_DELAY_MS) l.cb.health = Math.min(HEALTH_MAX, l.cb.health + HEALTH_REGEN_PER_S * dt);
      if (l.cb.equipped && this.weaponBlock(l)) { l.cb.equipped = null; this.io.to(`u:${l.userId}`).emit('combat:holster', { zone: this.weaponBlock(l) }); }
    }
    // police response units: only for violent wanted levels (shots fired or worse) — speeding is still handled at checkpoints
    for (const l of this.g.lives.values()) {
      const want = l.arrived && l.cb.lastShotFired > 0 ? unitsFor(l.police.wanted) : 0;
      const mine = this.responders.filter((r) => r.target === l.userId);
      for (let i = mine.length; i < want; i++) this.responders.push(spawnResponder(l.userId, i));
      if (want === 0 && mine.length) { this.responders = this.responders.filter((r) => r.target !== l.userId); if (l.police.wanted === 0) l.cb.lastShotFired = 0; }
    }
    this.responders = this.responders.filter((r) => this.g.lives.has(r.target));
    for (const r of this.responders) {
      const l = this.g.lives.get(r.target)!;
      const pos = l.inCar ? { x: l.carX, z: l.carZ } : { x: l.x, z: l.z };
      const res = stepResponder(r, { pos, speed: l.speed, inCar: l.inCar || !!l.ride, downed: this.isDowned(l, now), inside: !!houseAt(l.x, l.z) }, dt, now, walls);
      if (res === 'arrest' && !this.isDowned(l, now)) { this.arrest(l); this.responders = this.responders.filter((o) => o.target !== l.userId); break; }
    }
  }
  respondersSnap(): { id: number; x: number; z: number; rot: number; mode: string; cx: number; cz: number; crot: number; t: number }[] {
    return this.responders.map((r) => ({ id: r.id, x: r.x, z: r.z, rot: r.rot, mode: r.mode, cx: r.carX, cz: r.carZ, crot: r.carRot, t: r.target }));
  }
}
