import type { Server, Socket } from 'socket.io';
import type { DB, UserRow } from './db.js';
import { getUser, getUserByName } from './db.js';
import { applyTransaction, getBalance, listTransactions, WalletError } from './wallet.js';
import { ensureCrown, ensureCrownCar, richList } from './crown.js';
import { canEnterCar, canWash, tryDeliver, tryPickup, validMove, type JobState } from './rules.js';
import { newPoliceState, policeDecay, policeStep, surrenderFine, type PoliceState } from './police.js';
import { travelCheck } from './travel.js';
import { buyClothes, ownedClothes, wearClothes, wornStyle } from './clothes.js';
import { stationStart, stationWork, taxiDropoff, taxiPickup, taxiStart, type StationState, type TaxiState } from './jobs.js';
import { activeVehicle, buyCar, homeSpot, listVehicles, seedAdminVehicles, setActive } from './vehicles.js';
import { buyHouse, canEnter, canExit, houseStates, seedHouses, setLock } from './houses.js';
import { rideCheck, exitSpot, type RideState } from './ride.js';
import { voiceRelayAllowed, RateLimit, VOICE_SIGNALS_PER_SEC } from './voice.js';
import { CombatSystem, type CombatLive, type GameHooks } from './combatGame.js';
import { CallManager, addContact, removeContact, listContacts } from './calls.js';
import { cleanBody, dmThread, markRead, recentGlobal, saveDm, saveGlobal, unreadCounts } from './messages.js';
import {
  CARWASH_PRICE, DELIVERY_PAY, DIRT_PER_METRE, DROPOFFS, PARKING_SLOTS, SPAWN,
  type Appearance, type PlayerSnapshot, type StateUpdate, validAppearance,
  WORLD_HALF, AIRPORT, inAirport, houseAt, dist, POLICE_STATION, TRAVEL, inLagos, STATION_JOBS, TAXI_STOPS, taxiFare, WEATHER_KINDS, weatherAt, type WeatherKind,
} from '../../shared/constants.js';

interface Live {
  userId: number; name: string; admin: boolean; sockets: Set<string>;
  x: number; z: number; rot: number; moving: number;
  inCar: boolean; carX: number; carZ: number; carRot: number;
  dirt: number; lastDirtSent: number; lastUpdate: number; lastChat: number;
  app: Appearance | null; job: JobState | null;
  carModel: string; carColor: string;
  /** false while the player is still on the plane (intro); hidden from snapshots until they walk off */
  arrived: boolean;
  taxi: TaxiState | null; station: StationState | null;
  style: string;
  speed: number; spd: { d: number; t0: number }; police: PoliceState;
  /** riding as a passenger in another player's car */
  ride: RideState | null;
  /** proximity voice chat switched on */
  voice: boolean;
  /** health, armour, weapons, gang (see combatGame.ts) */
  cb: CombatLive;
}

type Ack = (r: Record<string, unknown>) => void;
const safeAck = (a: unknown): Ack => (typeof a === 'function' ? (a as Ack) : () => {});

export class Game {
  lives = new Map<number, Live>();
  private timer: NodeJS.Timeout;
  private crownTimer: NodeJS.Timeout;
  private persistTimer: NodeJS.Timeout;

  calls: CallManager;
  combat: CombatSystem;
  weatherTimer: NodeJS.Timeout;
  weatherOverride: { kind: WeatherKind; until: number } | null = null;
  private lastWeather: WeatherKind | null = null;
  weather(now = Date.now()): WeatherKind { return this.weatherOverride && this.weatherOverride.until > now ? this.weatherOverride.kind : weatherAt(now); }
  private weatherTick(): void { const w = this.weather(); if (w !== this.lastWeather) { this.lastWeather = w; this.io.emit('weather', { kind: w }); } }

  constructor(private db: DB, private io: Server) {
    this.combat = new CombatSystem(db, io, this as unknown as GameHooks);
    this.calls = new CallManager(db, io, (uid) => this.isOnline(uid));
    seedHouses(db);
    seedAdminVehicles(db);
    ensureCrownCar(db); ensureCrown(db);
    this.crownTimer = setInterval(() => { if (ensureCrown(this.db)) { const a = [...this.lives.values()].find((l) => l.admin); if (a) this.sendWallet(a.userId); } }, 15000);
    this.weatherTimer = setInterval(() => this.weatherTick(), 3000);
    this.timer = setInterval(() => this.broadcastSnapshot(), 100);
    this.persistTimer = setInterval(() => { for (const l of this.lives.values()) this.persist(l); }, 30_000);
  }

  stop(): void { clearInterval(this.crownTimer); clearInterval(this.timer); clearInterval(this.persistTimer); clearInterval(this.weatherTimer); }

  isOnline(userId: number): boolean { return this.lives.has(userId); }

  private loadLive(u: UserRow): Live {
    const slot = PARKING_SLOTS[u.id % PARKING_SLOTS.length];
    let app: Appearance | null;
    try { app = u.appearance ? JSON.parse(u.appearance) : null; } catch { app = null; }
    return {
      userId: u.id, name: u.display_name, admin: !!u.is_admin, sockets: new Set(),
      x: u.pos_x ?? SPAWN.x, z: u.pos_z ?? SPAWN.z, rot: u.rot ?? SPAWN.rot, moving: 0,
      inCar: false, carX: u.car_x ?? slot.x, carZ: u.car_z ?? slot.z, carRot: u.car_rot ?? slot.rot,
      dirt: u.car_dirt, lastDirtSent: u.car_dirt, lastUpdate: Date.now(), lastChat: 0, app, job: null,
      carModel: activeVehicle(this.db, u.id).model, carColor: activeVehicle(this.db, u.id).color,
      arrived: !!u.intro_seen, taxi: null, station: null, style: wornStyle(this.db, u.id, !!u.is_admin),
      speed: 0, spd: { d: 0, t0: Date.now() }, police: newPoliceState(u.wanted ?? 0), ride: null, voice: false, cb: this.combat.newLive(u.id),
    };
  }

  private persist(l: Live): void {
    this.db.prepare('UPDATE users SET pos_x=?, pos_z=?, rot=?, car_x=?, car_z=?, car_rot=?, car_dirt=?, last_seen=? WHERE id=?')
      .run(l.x, l.z, l.rot, l.carX, l.carZ, l.carRot, l.dirt, Date.now(), l.userId);
  }

  snapshot(l: Live): PlayerSnapshot {
    return {
      id: l.userId, name: l.name, admin: l.admin, x: l.x, z: l.z, rot: l.rot, moving: l.moving,
      inCar: l.inCar, carX: l.carX, carZ: l.carZ, carRot: l.carRot, dirt: Math.round(l.dirt * 100) / 100, app: l.app, carModel: l.carModel, carColor: l.carColor, style: l.style, wanted: l.police.wanted,
      ...(l.ride ? { ride: { driver: l.ride.driver, seat: l.ride.seat } } : {}),
      ...(l.voice ? { voice: true } : {}),
      ...this.combat.snapshotExtra(l),
    };
  }

  private tickN = 0;
  private broadcastSnapshot(): void {
    if (!this.lives.size) return;
    for (const l of this.lives.values()) if (l.ride) {
      const d = this.lives.get(l.ride.driver);
      if (!d) { l.ride = null; this.io.to(`u:${l.userId}`).emit('ride:end', { x: l.x, z: l.z, reason: 'The driver left' }); continue; }
      l.x = d.carX; l.z = d.carZ; l.rot = d.carRot; l.lastUpdate = Date.now();
    }
    if (++this.tickN % 5 === 0) { // police: standing-still arrests + wanted decay (2×/s)
      const now = Date.now();
      for (const l of this.lives.values()) {
        if (now - l.lastUpdate > 600) { l.speed = 0; l.spd = { d: 0, t0: now }; }
        if (!l.arrived) continue;
        if (l.police.wanted > 0) this.policeEval(l);
        const e = policeDecay(l.police, now);
        if (e) { this.saveWanted(l); this.io.to(`u:${l.userId}`).emit('wanted', { wanted: l.police.wanted, reason: 'Police lost track of you' }); }
      }
    }
    this.combat.tick(0.1);
    this.io.emit('snap', { t: Date.now(), players: [...this.lives.values()].filter((l) => l.arrived).map((l) => this.snapshot(l)), police: this.combat.respondersSnap() });
  }

  playersList(): { id: number; name: string; admin: boolean; online: boolean; lastSeen: number | null }[] {
    const rows = this.db.prepare('SELECT id, display_name, is_admin, last_seen FROM users ORDER BY last_seen DESC LIMIT 200').all() as
      { id: number; display_name: string; is_admin: number; last_seen: number | null }[];
    return rows.map((r) => ({ id: r.id, name: r.display_name, admin: !!r.is_admin, online: this.isOnline(r.id), lastSeen: r.last_seen }))
      .sort((a, b) => Number(b.online) - Number(a.online));
  }

  saveWanted(l: Live): void { this.db.prepare('UPDATE users SET wanted = ? WHERE id = ?').run(l.police.wanted, l.userId); }
  teleportLive(l: Live, x: number, z: number, rot: number): void {
    l.x = x; l.z = z; l.rot = rot; l.inCar = false; l.speed = 0; l.spd = { d: 0, t0: Date.now() }; l.lastUpdate = Date.now();
    this.io.to(`u:${l.userId}`).emit('correct', { x, z, rot, inCar: false, carX: l.carX, carZ: l.carZ, carRot: l.carRot, teleport: true });
  }
  /** crimes / arrest against the authoritative state */
  private policeEval(l: Live): void {
    if (houseAt(l.x, l.z)) return;
    const now = Date.now();
    const pedestrians = [...this.lives.values()].filter((o) => o !== l && o.arrived && !o.inCar && !houseAt(o.x, o.z)).map((o) => ({ id: o.userId, pos: { x: o.x, z: o.z } }));
    const { events, hitIds } = policeStep(l.police, { pos: { x: l.x, z: l.z }, inCar: l.inCar, speed: l.speed, now, pedestrians });
    for (const id of hitIds) this.io.to(`u:${id}`).emit('police:hit', { by: l.name });
    for (const e of events) {
      if (e.type === 'crime') { this.saveWanted(l); this.io.to(`u:${l.userId}`).emit('wanted', { wanted: l.police.wanted, reason: e.reason, crime: true }); }
      if (e.type === 'arrest') {
        const fine = Math.min(e.fine, getBalance(this.db, l.userId));
        if (fine > 0) applyTransaction(this.db, l.userId, -fine, 'police_fine', `Police fine — arrested (${e.stars}★)`);
        this.saveWanted(l); l.job = null; l.taxi = null; l.station = null;
        this.teleportLive(l, POLICE_STATION.release.x, POLICE_STATION.release.z, POLICE_STATION.release.rot);
        this.io.to(`u:${l.userId}`).emit('wanted', { wanted: 0, arrested: true, fine, reason: `Arrested and taken to ${POLICE_STATION.name}` });
        this.sendWallet(l.userId);
      }
    }
  }

  sendWallet(userId: number): void {
    this.io.to(`u:${userId}`).emit('wallet', { balance: getBalance(this.db, userId), tx: listTransactions(this.db, userId, 15) });
  }

  setAppearance(userId: number, app: Appearance): void {
    this.db.prepare('UPDATE users SET appearance = ? WHERE id = ?').run(JSON.stringify(app), userId);
    const l = this.lives.get(userId);
    if (l) l.app = app;
  }

  handleConnection(socket: Socket, userId: number): void {
    const u = getUser(this.db, userId);
    if (!u) { socket.disconnect(true); return; }
    let live = this.lives.get(userId);
    const firstSocket = !live;
    if (!live) { live = this.loadLive(u); this.lives.set(userId, live); }
    const l = live;
    l.sockets.add(socket.id);
    socket.join(`u:${userId}`);
    if (firstSocket) {
      this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Date.now(), userId);
      this.io.emit('presence', { id: userId, name: l.name, online: true, lastSeen: Date.now() });
    }

    socket.emit('init', {
      me: {
        id: u.id, username: u.username, name: u.display_name, admin: !!u.is_admin, balance: u.balance,
        introSeen: !!u.intro_seen, app: l.app, x: l.x, z: l.z, rot: l.rot,
        car: { x: l.carX, z: l.carZ, rot: l.carRot }, dirt: l.dirt, vehicle: { model: l.carModel, color: l.carColor }, style: l.style, wanted: l.police.wanted,
      },
      serverTime: Date.now(),
      tx: listTransactions(this.db, userId, 15),
      global: recentGlobal(this.db).map(pub),
      unread: unreadCounts(this.db, userId),
      players: this.playersList(),
      contacts: listContacts(this.db, userId),
      houses: houseStates(this.db),
      weather: this.weather(),
      combat: this.combat.state(l),
    });
    this.combat.attach(socket, l);

    socket.on('state', (s: StateUpdate) => this.onState(l, socket, s));

    // ---- proximity voice chat (signalling relay only; audio is peer-to-peer)
    const vLimit = new RateLimit(VOICE_SIGNALS_PER_SEC);
    const city = (o: Live) => (inLagos(o.x, o.z) ? 'lagos' : 'benin');
    socket.on('voice:set', (p: { on?: unknown }, ack: unknown) => { l.voice = p?.on === true; safeAck(ack)({ ok: true, voice: l.voice }); });
    socket.on('voice:signal', (p: { to?: unknown; data?: unknown }) => {
      if (!vLimit.take() || typeof p?.to !== 'number' || !p.data || typeof p.data !== 'object') return;
      if (JSON.stringify(p.data).length > 12000) return;
      const o = this.lives.get(p.to);
      if (!voiceRelayAllowed({ voice: l.voice, pos: { x: l.x, z: l.z }, city: city(l) }, o ? { voice: o.voice, pos: { x: o.x, z: o.z }, city: city(o) } : undefined)) return;
      this.io.to(`u:${p.to}`).emit('voice:signal', { from: userId, data: p.data });
    });

    // ---- passengers
    socket.on('car:ride', (p: { driver?: unknown }, ack: unknown) => {
      const d = typeof p?.driver === 'number' ? this.lives.get(p.driver) : undefined;
      const taken = [...this.lives.values()].filter((o) => o.ride && o.ride.driver === p?.driver).map((o) => o.ride!.seat);
      const r = rideCheck({ riderId: userId, riderPos: { x: l.x, z: l.z }, riderInCar: l.inCar, riderRiding: !!l.ride, driverId: p?.driver, driverExists: !!d && d.arrived,
        driverCar: d ? { x: d.carX, z: d.carZ } : { x: 1e9, z: 1e9 }, sameCity: !!d && inLagos(d.carX, d.carZ) === inLagos(l.x, l.z), takenSeats: taken });
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.ride = r.value; l.job = null; l.taxi = null; l.station = null;
      safeAck(ack)({ ok: true, seat: r.value.seat, driver: r.value.driver });
    });
    socket.on('car:leave', (_: unknown, ack: unknown) => {
      if (!l.ride) return safeAck(ack)({ ok: false, error: 'You are not riding' });
      const d = this.lives.get(l.ride.driver);
      const spot = d ? exitSpot({ x: d.carX, z: d.carZ, rot: d.carRot }, l.ride.seat) : { x: l.x, z: l.z };
      l.ride = null; l.x = spot.x; l.z = spot.z; l.lastUpdate = Date.now(); l.spd = { d: 0, t0: Date.now() };
      safeAck(ack)({ ok: true, x: spot.x, z: spot.z });
    });


    socket.on('appearance', (a: unknown, ack: unknown) => {
      if (!validAppearance(a)) return safeAck(ack)({ ok: false, error: 'invalid appearance' });
      this.setAppearance(userId, a);
      safeAck(ack)({ ok: true });
    });

    // ---- intercity travel (bus park / airport desks)
    socket.on('travel:go', (p: { mode?: unknown }, ack: unknown) => {
      const c = travelCheck(p?.mode, { x: l.x, z: l.z }, !l.inCar, l.police.wanted, getBalance(this.db, userId));
      if (!c.ok) return safeAck(ack)({ ok: false, error: c.error });
      const t = TRAVEL[c.mode];
      try { applyTransaction(this.db, userId, -c.price, 'travel', `${t.name}: ${c.from === 'benin' ? 'Benin City → Lagos' : 'Lagos → Benin City'}`); }
      catch (e) { return safeAck(ack)({ ok: false, error: e instanceof WalletError ? 'Not enough money' : 'error' }); }
      l.job = null; l.taxi = null; l.station = null;
      const a = t.arrive[c.to];
      this.teleportLive(l, a.x, a.z, a.rot);
      this.sendWallet(userId);
      safeAck(ack)({ ok: true, to: c.to, mode: c.mode, price: c.price, cutsceneMs: t.cutsceneMs });
    });

    // ---- police
    socket.on('police:surrender', (_: unknown, ack: unknown) => {
      if (l.police.wanted <= 0) return safeAck(ack)({ ok: false, error: 'You are not wanted by the police' });
      if (l.inCar || dist({ x: l.x, z: l.z }, POLICE_STATION.door) > POLICE_STATION.radius) return safeAck(ack)({ ok: false, error: `Walk to the ${POLICE_STATION.name} front desk` });
      const fine = Math.min(surrenderFine(l.police.wanted), getBalance(this.db, userId));
      if (fine > 0) applyTransaction(this.db, userId, -fine, 'police_fine', `Fine paid at ${POLICE_STATION.name} (${l.police.wanted}★)`);
      l.police.wanted = 0; this.saveWanted(l); this.sendWallet(userId);
      safeAck(ack)({ ok: true, fine });
      this.io.to(`u:${userId}`).emit('wanted', { wanted: 0, reason: 'You handed yourself in and paid the fine' });
    });

    // ---- clothing store
    socket.on('clothes:list', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, owned: ownedClothes(this.db, userId, l.admin), style: l.style }));
    socket.on('clothes:buy', (p: { id?: unknown }, ack: unknown) => {
      const r = buyClothes(this.db, userId, l.admin, p?.id, { x: l.x, z: l.z }, !l.inCar);
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.style = r.value.style; this.sendWallet(userId);
      safeAck(ack)({ ok: true, style: l.style, balance: r.value.balance, owned: ownedClothes(this.db, userId, l.admin) });
    });
    socket.on('clothes:wear', (p: { id?: unknown }, ack: unknown) => {
      const r = wearClothes(this.db, userId, l.admin, p?.id);
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.style = r.value; safeAck(ack)({ ok: true, style: l.style });
    });

    socket.on('job:pickup', (_: unknown, ack: unknown) => {
      if (l.taxi || l.station) return safeAck(ack)({ ok: false, error: 'Finish your current job first' });
      const r = tryPickup({ x: l.x, z: l.z }, Date.now(), l.job);
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.job = r.value;
      const d = DROPOFFS[r.value.dropoff];
      safeAck(ack)({ ok: true, dropoff: { name: d.name, x: d.x, z: d.z } });
    });
    socket.on('job:deliver', (_: unknown, ack: unknown) => {
      const r = tryDeliver({ x: l.x, z: l.z }, Date.now(), l.job);
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      const name = DROPOFFS[l.job!.dropoff].name;
      l.job = null;
      const bal = applyTransaction(this.db, userId, DELIVERY_PAY, 'job_delivery', `Delivery to ${name}`);
      this.sendWallet(userId);
      safeAck(ack)({ ok: true, paid: DELIVERY_PAY, balance: bal });
    });
    socket.on('job:cancel', (_: unknown, ack: unknown) => { l.job = null; safeAck(ack)({ ok: true }); });

    // ---- taxi driver (server picks the passenger + destination, validates positions/time, pays the fare)
    const stop = (i: number) => ({ name: TAXI_STOPS[i].name, x: TAXI_STOPS[i].x, z: TAXI_STOPS[i].z });
    const carPos = () => ({ x: l.carX, z: l.carZ });
    socket.on('job:taxi:start', (_: unknown, ack: unknown) => {
      if (l.job || l.station || l.taxi) return safeAck(ack)({ ok: false, error: 'Finish your current job first' });
      const r = taxiStart(l.inCar, carPos());
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.taxi = r.value;
      safeAck(ack)({ ok: true, stage: 'to_pickup', passenger: r.value.passenger, pickup: stop(r.value.pickup) });
    });
    socket.on('job:taxi:pickup', (_: unknown, ack: unknown) => {
      const r = taxiPickup(l.taxi, l.inCar, carPos(), Date.now());
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.taxi = r.value;
      const len = Math.hypot(TAXI_STOPS[r.value.dest].x - TAXI_STOPS[r.value.pickup].x, TAXI_STOPS[r.value.dest].z - TAXI_STOPS[r.value.pickup].z);
      safeAck(ack)({ ok: true, stage: 'riding', passenger: r.value.passenger, dest: stop(r.value.dest), fare: taxiFare(len) });
    });
    socket.on('job:taxi:dropoff', (_: unknown, ack: unknown) => {
      const r = taxiDropoff(l.taxi, l.inCar, carPos(), Date.now(), l.dirt);
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      const who = l.taxi!.passenger; l.taxi = null;
      const total = r.value.fare + r.value.tip;
      const bal = applyTransaction(this.db, userId, total, 'job_taxi', `Taxi fare: ${who} to ${r.value.name}${r.value.tip ? ' (+tip, clean car)' : ''}`);
      this.sendWallet(userId);
      safeAck(ack)({ ok: true, fare: r.value.fare, tip: r.value.tip, balance: bal });
    });
    socket.on('job:taxi:stop', (_: unknown, ack: unknown) => { l.taxi = null; safeAck(ack)({ ok: true }); });

    // ---- station jobs: car-wash attendant / mechanic (each step validated: right spot, minimum work time)
    socket.on('job:station:start', (p: { id?: unknown }, ack: unknown) => {
      if (l.job || l.taxi) return safeAck(ack)({ ok: false, error: 'Finish your current job first' });
      const r = stationStart(p?.id, !l.inCar, { x: l.x, z: l.z }, l.station, Date.now());
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.station = r.value;
      safeAck(ack)({ ok: true, id: r.value.id, done: r.value.done });
    });
    socket.on('job:station:work', (p: { i?: unknown }, ack: unknown) => {
      const r = stationWork(l.station, p?.i, !l.inCar, { x: l.x, z: l.z }, Date.now());
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      l.station = r.value.state;
      let bal: number | undefined;
      if (r.value.finished) {
        const j = STATION_JOBS[r.value.state.id];
        bal = applyTransaction(this.db, userId, r.value.pay, `job_${j.id}`, `${j.name} at ${j.place}`);
        this.sendWallet(userId);
      }
      safeAck(ack)({ ok: true, done: r.value.state.done, finished: r.value.finished, paid: r.value.pay, cars: r.value.state.cars, balance: bal });
    });
    socket.on('job:station:stop', (_: unknown, ack: unknown) => { const cars = l.station?.cars ?? 0; l.station = null; safeAck(ack)({ ok: true, cars }); });

    socket.on('carwash:buy', (_: unknown, ack: unknown) => {
      const r = canWash(l.inCar, { x: l.carX, z: l.carZ }, getBalance(this.db, userId), CARWASH_PRICE);
      if (!r.ok) return safeAck(ack)({ ok: false, error: r.error });
      try {
        const bal = applyTransaction(this.db, userId, -CARWASH_PRICE, 'car_wash', 'Ring Road Car Wash');
        l.dirt = 0; l.lastDirtSent = 0;
        this.db.prepare('UPDATE users SET car_dirt = 0 WHERE id = ?').run(userId);
        this.io.to(`u:${userId}`).emit('dirt', { dirt: 0 });
        this.sendWallet(userId);
        safeAck(ack)({ ok: true, balance: bal });
      } catch (e) {
        safeAck(ack)({ ok: false, error: e instanceof WalletError ? e.message : 'error' });
      }
    });

    socket.on('chat:global', (body: unknown, ack: unknown) => {
      const b = cleanBody(body);
      const now = Date.now();
      if (!b) return safeAck(ack)({ ok: false, error: 'empty' });
      if (now - l.lastChat < 600) return safeAck(ack)({ ok: false, error: 'slow down' });
      l.lastChat = now;
      const m = saveGlobal(this.db, userId, b);
      this.io.emit('chat:global', pub(m));
      safeAck(ack)({ ok: true });
    });

    socket.on('dm:send', (p: { to?: unknown; body?: unknown }, ack: unknown) => {
      const b = cleanBody(p?.body);
      const to = typeof p?.to === 'number' ? getUser(this.db, p.to) : typeof p?.to === 'string' ? getUserByName(this.db, p.to) : undefined;
      if (!b || !to) return safeAck(ack)({ ok: false, error: 'invalid message or recipient' });
      if (to.id === userId) return safeAck(ack)({ ok: false, error: 'cannot message yourself' });
      const now = Date.now();
      if (now - l.lastChat < 400) return safeAck(ack)({ ok: false, error: 'slow down' });
      l.lastChat = now;
      const m = saveDm(this.db, userId, to.id, b);
      this.io.to(`u:${to.id}`).emit('dm:new', pub(m));
      this.io.to(`u:${to.id}`).emit('dm:unread', unreadCounts(this.db, to.id));
      safeAck(ack)({ ok: true, message: pub(m) });
    });
    socket.on('dm:thread', (p: { with?: unknown }, ack: unknown) => {
      const other = typeof p?.with === 'number' ? p.with : -1;
      markRead(this.db, userId, other);
      safeAck(ack)({ ok: true, messages: dmThread(this.db, userId, other).map(pub), unread: unreadCounts(this.db, userId) });
    });
    socket.on('dm:unread', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, unread: unreadCounts(this.db, userId) }));
    socket.on('players', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, players: this.playersList() }));
    socket.on('wallet', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, balance: getBalance(this.db, userId), tx: listTransactions(this.db, userId, 15) }));

    // ---- houses ----
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const teleport = (x: number, z: number, rot: number) => this.teleportLive(l, x, z, rot);
    // first arrival: after the plane intro (or skipping it) the new player walks out into the Benin Airport arrivals hall
    socket.on('intro:seen', (_: unknown, ack: unknown) => {
      const first = !getUser(this.db, userId)?.intro_seen;
      this.db.prepare('UPDATE users SET intro_seen = 1 WHERE id = ?').run(userId);
      l.arrived = true;
      if (first) teleport(AIRPORT.arrival.x, AIRPORT.arrival.z, AIRPORT.arrival.rot);
      safeAck(ack)({ ok: true, airport: first });
    });
    // admin-only teleport (BEST 𝕏 travel tool; also used by automated e2e runs). Never into house interiors.
    socket.on('admin:teleport', (p: { x?: unknown; z?: unknown; id?: unknown }, ack: unknown) => {
      const x = Number(p?.x), z = Number(p?.z);
      if (!l.admin) return safeAck(ack)({ ok: false, error: 'Admins only' });
      if (!Number.isFinite(x) || !Number.isFinite(z) || !((Math.abs(x) <= WORLD_HALF && Math.abs(z) <= WORLD_HALF) || inAirport(x, z) || inLagos(x, z))) return safeAck(ack)({ ok: false, error: 'Outside the city' });
      if (p?.id !== undefined) { // summon another online player (moderation tool; also used by automated runs)
        const t = this.lives.get(Number(p.id)); if (!t) return safeAck(ack)({ ok: false, error: 'Player not online' });
        if (t.inCar || t.ride) return safeAck(ack)({ ok: false, error: 'Player is in a vehicle' });
        this.teleportLive(t, x, z, t.rot); return safeAck(ack)({ ok: true });
      }
      teleport(x, z, l.rot); safeAck(ack)({ ok: true });
    });
    socket.on('rich:list', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, list: richList(this.db, 20) }));
    // admin-only: fund a (test) player's wallet from the crown reserve — lets automated runs use separate accounts
    socket.on('admin:grant', (p: { id?: unknown; amount?: unknown }, ack: unknown) => {
      if (!l.admin) return safeAck(ack)({ ok: false, error: 'Admins only' });
      const id = Number(p?.id), amount = Math.floor(Number(p?.amount));
      if (!Number.isSafeInteger(id) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 50_000_000) return safeAck(ack)({ ok: false, error: 'Invalid grant' });
      try { applyTransaction(this.db, id, amount, 'admin_grant', 'Grant from BEST 𝕏'); } catch { return safeAck(ack)({ ok: false, error: 'No such player' }); }
      this.sendWallet(id); safeAck(ack)({ ok: true });
    });
    socket.on('admin:weather', (p: { kind?: unknown }, ack: unknown) => {
      if (!l.admin) return safeAck(ack)({ ok: false, error: 'Admins only' });
      const k = WEATHER_KINDS.find((w) => w === p?.kind);
      this.weatherOverride = k ? { kind: k, until: Date.now() + 10 * 60_000 } : null;
      this.weatherTick(); safeAck(ack)({ ok: true, weather: this.weather() });
    });
    // ---- vehicles ----
    const deliverCar = () => {
      const a = activeVehicle(this.db, userId); const spot = homeSpot(this.db, userId);
      l.carModel = a.model; l.carColor = a.color; l.carX = spot.x; l.carZ = spot.z; l.carRot = spot.rot; l.dirt = 0.05;
      this.io.to(`u:${userId}`).emit('correct', { x: l.x, z: l.z, rot: l.rot, inCar: false, carX: l.carX, carZ: l.carZ, carRot: l.carRot, vehicle: { model: l.carModel, color: l.carColor } });
      this.io.to(`u:${userId}`).emit('dirt', { dirt: l.dirt });
    };
    socket.on('car:list', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, vehicles: listVehicles(this.db, userId), active: activeVehicle(this.db, userId), home: homeSpot(this.db, userId) }));
    socket.on('car:buy', (p: { model?: unknown; color?: unknown }, ack: unknown) => {
      if (l.inCar) return safeAck(ack)({ ok: false, error: 'Get out of your car first' });
      const r = buyCar(this.db, userId, str(p?.model), str(p?.color), l);
      if (r.ok) { this.sendWallet(userId); deliverCar(); }
      safeAck(ack)(r.ok ? { ...r, home: homeSpot(this.db, userId) } : r);
    });
    socket.on('car:use', (p: { id?: unknown }, ack: unknown) => {
      if (l.inCar) return safeAck(ack)({ ok: false, error: 'Get out of your car first' });
      const r = setActive(this.db, userId, p?.id === null ? null : num(p?.id));
      if (r.ok) deliverCar();
      safeAck(ack)(r);
    });
    socket.on('house:list', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, houses: houseStates(this.db) }));
    socket.on('house:buy', (p: { id?: unknown }, ack: unknown) => {
      const r = buyHouse(this.db, userId, str(p?.id), l);
      if (r.ok) { this.sendWallet(userId); this.io.emit('houses', houseStates(this.db)); }
      safeAck(ack)(r);
    });
    socket.on('house:lock', (p: { id?: unknown; locked?: unknown }, ack: unknown) => {
      const r = setLock(this.db, userId, str(p?.id), p?.locked !== false);
      if (r.ok) this.io.emit('houses', houseStates(this.db));
      safeAck(ack)(r);
    });
    socket.on('house:enter', (p: { id?: unknown }, ack: unknown) => {
      const r = canEnter(this.db, userId, str(p?.id), l, l.inCar);
      if (r.ok) teleport(r.x, r.z, r.rot);
      safeAck(ack)(r);
    });
    socket.on('house:exit', (_: unknown, ack: unknown) => {
      const r = canExit(l);
      if (r.ok) teleport(r.x, r.z, r.rot);
      safeAck(ack)(r);
    });

    // ---- calls & contacts ----
    const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : -1);
    socket.on('call:start', (p: { to?: unknown }, ack: unknown) => safeAck(ack)(this.calls.start(userId, num(p?.to))));
    socket.on('call:answer', (p: { callId?: unknown }, ack: unknown) => safeAck(ack)(this.calls.answer(userId, num(p?.callId))));
    socket.on('call:reject', (p: { callId?: unknown }, ack: unknown) => safeAck(ack)(this.calls.reject(userId, num(p?.callId))));
    socket.on('call:hangup', (p: { callId?: unknown }, ack: unknown) => safeAck(ack)(this.calls.hangup(userId, num(p?.callId))));
    socket.on('call:signal', (p: { callId?: unknown; data?: unknown }) => { this.calls.signal(userId, num(p?.callId), p?.data); });
    socket.on('calls:log', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, calls: this.calls.log(userId) }));
    socket.on('contacts:list', (_: unknown, ack: unknown) => safeAck(ack)({ ok: true, contacts: listContacts(this.db, userId) }));
    socket.on('contacts:add', (p: { id?: unknown }, ack: unknown) => safeAck(ack)({ ok: addContact(this.db, userId, num(p?.id)), contacts: listContacts(this.db, userId) }));
    socket.on('contacts:remove', (p: { id?: unknown }, ack: unknown) => { removeContact(this.db, userId, num(p?.id)); safeAck(ack)({ ok: true, contacts: listContacts(this.db, userId) }); });

    socket.on('disconnect', () => {
      l.sockets.delete(socket.id);
      if (l.sockets.size === 0) {
        this.calls.userDisconnected(userId);
        this.persist(l);
        this.lives.delete(userId);
        const now = Date.now();
        this.db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(now, userId);
        this.io.emit('presence', { id: userId, name: l.name, online: false, lastSeen: now });
      }
    });
  }

  private onState(l: Live, socket: Socket, s: StateUpdate): void {
    if (!s || typeof s !== 'object') return;
    const nums = [s.x, s.z, s.rot, s.carX, s.carZ, s.carRot];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return;
    if (this.combat.isDowned(l)) return; // wounded players can't move until treated
    if (l.ride) return; // passengers are carried by the driver's car (server-side, see broadcastSnapshot)
    const now = Date.now();
    const dt = now - l.lastUpdate;
    const wantCar = s.inCar === true;
    const correct = (): void => { socket.emit('correct', { x: l.x, z: l.z, rot: l.rot, inCar: l.inCar, carX: l.carX, carZ: l.carZ, carRot: l.carRot }); };

    const px = wantCar ? l.carX : l.x, pz = wantCar ? l.carZ : l.z;
    if (wantCar && !l.inCar && !canEnterCar({ x: l.x, z: l.z }, { x: l.carX, z: l.carZ })) return correct();

    if (wantCar) {
      const from = { x: l.carX, z: l.carZ };
      const to = { x: s.carX, z: s.carZ };
      if (!validMove(from, to, dt, true)) return correct();
      const d = Math.hypot(to.x - from.x, to.z - from.z);
      l.carX = to.x; l.carZ = to.z; l.carRot = s.carRot;
      l.x = to.x; l.z = to.z; l.rot = s.carRot;
      l.dirt = Math.min(1, l.dirt + d * DIRT_PER_METRE);
      if (l.dirt - l.lastDirtSent >= 0.02) { l.lastDirtSent = l.dirt; this.io.to(`u:${l.userId}`).emit('dirt', { dirt: l.dirt }); }
    } else {
      if (!validMove({ x: l.x, z: l.z }, { x: s.x, z: s.z }, dt, l.inCar)) return correct();
      l.x = s.x; l.z = s.z; l.rot = s.rot;
    }
    const moved = Math.hypot((wantCar ? s.carX : s.x) - px, (wantCar ? s.carZ : s.z) - pz);
    // speed over a ≥0.7 s window (robust to network jitter in packet timing)
    l.spd.d += moved;
    if (now - l.spd.t0 >= 700) { l.speed = l.spd.d / ((now - l.spd.t0) / 1000); l.spd = { d: 0, t0: now }; }
    l.inCar = wantCar;
    l.moving = Math.max(0, Math.min(50, Number(s.moving) || 0));
    l.lastUpdate = now;
    if (l.arrived) this.policeEval(l);
  }
}

function pub(m: { id: number; channel: string; from_id: number; to_id: number | null; body: string; created_at: number; read_at: number | null; from_name?: string }) {
  return { id: m.id, channel: m.channel, from: m.from_id, to: m.to_id, fromName: m.from_name, body: m.body, at: m.created_at, read: !!m.read_at };
}
