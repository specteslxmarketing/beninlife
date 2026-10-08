import { CombatClient } from './combat';
import { GUN_SHOP } from '../../shared/combat';
import { STATIONS } from './radio';
import * as THREE from 'three';
import type { Socket } from 'socket.io-client';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, type AABB } from './world';
import { Environment } from './environment';
import { Character, type CharacterOpts } from './character';
import { Car } from './car';
import { Ambient } from './ambient';
import { Weather } from './weather';
import { AudioEngine } from './audio';
import { VoiceChat } from './voice';
import { Arrival, type ArrivalPhase, type Line } from './arrival';
import { JobsClient } from './jobs';
import { Controls } from './controls';
import { setMaxAnisotropy } from './textures';
import { QUALITY_SETTINGS, storedQualityChoice, type Quality } from './quality';
import {
  type OutfitStyle, TRAVEL, TRAVEL_DESK_RADIUS, cityAt, type TravelMode, type City, LAGOS, CLOTHING_STORE, POLICE_STATION, SURRENDER_PER_STAR, nearestOfficer,
  AIRPORT,
  CARWASH_PRICE, CARWASH_ZONE, CAR_ENTER_RADIUS, DROPOFFS, DROPOFF_RADIUS, MARKET_PICKUP, PICKUP_RADIUS,
  gameHourAt, inZone, type Appearance, type PlayerSnapshot,
  type WeatherKind, DISPLAY_SLOTS, DEALER_RADIUS, carModel, HOUSES, HOUSE_DOOR_RADIUS, houseAt, houseById, interiorExit, type HouseDef,
} from '../../shared/constants';
import { emitAck, naira } from './net';

export interface Me {
  id: number; username: string; name: string; admin: boolean; balance: number; introSeen: boolean;
  app: Appearance | null; x: number; z: number; rot: number; car: { x: number; z: number; rot: number }; dirt: number;
  vehicle?: { model: string; color: string };
  style?: string; wanted?: number;
}

export interface HouseState { id: string; ownerId: number | null; ownerName: string | null; locked: boolean; weaponsAllowed?: boolean }
/** a get-in / get-out animation: walk to the door, door swings open, slide into the seat (or the reverse), door shuts */
interface CarSeq { kind: 'in' | 'out'; t: number; seat: number; from?: { x: number; z: number } }
const SEQ_IN = 1.3, SEQ_OUT = 1.2;
interface Remote { aimT?: number; aimYaw?: number; tagKey?: string; style?: string; carKey?: string; char: Character; car: Car; snap: PlayerSnapshot; x: number; z: number; rot: number; cx: number; cz: number; crot: number; cspeed?: number; csteer?: number; seq?: CarSeq; wasIn?: boolean; wasRide?: string }

const CAR_COLORS = ['#5b6770', '#7a1d1d', '#1d2e4a', '#d9d9d4', '#2a2a2c', '#4a5a3a', '#8a7a5a', '#3a4a5c'];
export const DEFAULT_APP: Appearance = { body: 'male', skin: 2, outfit: 1 };
/** worn outfit → character options (BEST 𝕏 always wears the gold crown pendant) */
export function styleOpts(style: string | undefined, admin: boolean): CharacterOpts {
  return { style: (style as OutfitStyle | undefined) ?? (admin ? 'white_suit' : 'casual'), crown: admin };
}

export type Mode = 'loading' | 'creator' | 'intro' | 'play';

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  world: World;
  env: Environment;
  controls: Controls;
  composer?: EffectComposer;
  player: Character;
  car: Car;
  mode: Mode = 'loading';
  pos = new THREE.Vector2(); rot = 0; speed = 0;
  inCar = false;
  carState = { x: 0, z: 0, rot: 0, speed: 0, steer: 0 };
  private lastHit = 0;
  /** on-foot jump: height above ground + vertical speed */
  jumpY = 0; private jumpV = 0; private lastRot = 0;
  /** my own get-in/out animation (own car or as a passenger) */
  seq: (CarSeq & { target: 'own' | number; done: () => void }) | null = null;
  /** riding as a passenger in another player's car */
  ride: { driver: number; seat: number } | null = null;
  voice!: VoiceChat;
  /** on-screen push-to-talk held (touch) */
  pttHeld = false;
  remotes = new Map<number, Remote>();
  serverOffset = 0;
  hourOverride: number | null = null;
  job: { name: string; x: number; z: number } | null = null;
  balance = 0;
  onlineCount = 0;
  houses: HouseState[] = [];
  weather: Weather;
  audio = new AudioEngine();
  radio = true;
  carModelId = 'starter'; carColor = '#5b6770';
  dealerColor = new Map<string, number>();
  inside: HouseDef | undefined;
  private houseLabels = new Map<string, THREE.Sprite>();
  private pickupMarker: THREE.Group; private dropMarker: THREE.Group;
  private lastSend = 0;
  private clock = new THREE.Clock();
  /** frame-time clamp; raised in ?capture mode so slow software-rendered capture runs closer to real time */
  maxDt = new URLSearchParams(location.search).has('capture') ? 0.12 : 0.05;
  private camTarget = new THREE.Vector3();
  private lastDragYaw = 0; private lastDragTime = 0;
  arrival?: Arrival;
  jobs!: JobsClient;
  private arrivalDone?: () => void;
  onArrivalLine: (l: Line | null) => void = () => {};
  onArrivalPhase: (p: ArrivalPhase) => void = () => {};
  onHud: () => void = () => {};
  onAction: (actions: { id: string; label: string; key: string }[]) => void = () => {};
  onShop: (shop: 'clothes' | 'guns') => void = () => {};
  combat!: CombatClient;
  private policeSnap: { id: number; x: number; z: number; rot: number; mode: string; cx: number; cz: number; crot: number }[] = [];
  /** intercity travel cutscene (main.ts overlay) */
  onTravel: (mode: TravelMode, to: City, ms: number) => void = () => {};
  travelling = false;
  /** a few ambient cars + pedestrians (Settings toggle; created when play starts) */
  ambient?: Ambient;
  ambientOn = localStorage.getItem('bl_ambient') !== '0';
  setAmbient(on: boolean): void { this.ambientOn = on; localStorage.setItem('bl_ambient', on ? '1' : '0'); this.ambient?.setEnabled(on); }
  get city(): City { return cityAt(this.inCar ? this.carState.x : this.pos.x, this.inCar ? this.carState.z : this.pos.y); }
  /** wanted stars (server-authoritative; updated by 'wanted' events) */
  wanted = 0;
  houseWeaponsAllowed(): boolean { const h = this.inside; return !!h && !!this.houses.find((x) => x.id === h.id)?.weaponsAllowed; }
  nearPoliceStation(): boolean { return !this.inCar && Math.hypot(this.pos.x - POLICE_STATION.door.x, this.pos.y - POLICE_STATION.door.z) < POLICE_STATION.radius - 0.5; }
  /** currently worn outfit (server-confirmed) */
  get style(): string { return this.me.style ?? (this.me.admin ? 'white_suit' : 'casual'); }
  setStyle(style: string): void { this.me.style = style; this.player.setOpts(styleOpts(style, this.me.admin)); this.shadowify(this.player.group); }
  nearClothingStore(): boolean { return !this.inCar && Math.hypot(this.pos.x - CLOTHING_STORE.door.x, this.pos.y - CLOTHING_STORE.door.z) < CLOTHING_STORE.radius - 0.5; }
  toast: (msg: string, kind?: 'ok' | 'err' | 'info') => void = () => {};

  constructor(container: HTMLElement, public quality: Quality, public socket: Socket, public me: Me,
    joyEl: HTMLElement, knobEl: HTMLElement) {
    const q = QUALITY_SETTINGS[quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('capture') });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatioMax));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.env = new Environment(this.scene, this.renderer, q.shadows, q.shadowSize);
    this.world = new World(this.scene, quality);
    this.controls = new Controls(this.renderer.domElement, joyEl, knobEl);

    if (q.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.5, 0.92));
      this.composer.addPass(new OutputPass());
    }

    this.weather = new Weather(this.scene, quality, this.world.puddleSpots);
    this.weather.onThunder = (d) => this.audio.thunder(d);
    this.player = new Character(me.app ?? DEFAULT_APP, styleOpts(me.style, me.admin));
    this.player.setNameTag(me.name, me.admin);
    this.shadowify(this.player.group);
    this.scene.add(this.player.group);
    this.car = new Car(CAR_COLORS[me.id % CAR_COLORS.length], { headlightLights: true, body: 'sedan', scale: 0.98, model: 'starter' });
    this.shadowify(this.car.group);
    this.scene.add(this.car.group);
    if (me.vehicle) this.setVehicle(me.vehicle.model, me.vehicle.color);
    this.pickupMarker = this.marker('#e0a030'); this.dropMarker = this.marker('#3fbf6f');
    this.jobs = new JobsClient(this);
    this.dropMarker.visible = false;
    this.pickupMarker.position.set(MARKET_PICKUP.x, 0, MARKET_PICKUP.z);

    this.applyServerState(me);
    this.balance = me.balance;
    const h = new URLSearchParams(location.search).get('hour');
    if (h !== null && !Number.isNaN(Number(h))) this.hourOverride = Number(h) % 24;
    this.controls.camYaw = this.rot + Math.PI;

    this.voice = new VoiceChat(this.socket, () => this.me.id, () => this.audio.ctx, () => this.audio.voiceOut());
    this.controls.on('e', () => this.toggleCar());
    this.controls.on('f', () => this.doContextAction());
    this.controls.on('h', () => { if (this.inCar) this.audio.horn(true); });
    this.controls.on(' ', () => this.jump());
    this.controls.on('r', () => { if (this.inCar) this.radioNext(this.controls.keys.has('shift') ? -1 : 1); else void this.combat.reload(); });
    this.combat = new CombatClient(this);
    this.controls.on('1', () => void this.combat.equip('pistol'));
    this.controls.on('2', () => void this.combat.equip('smg'));
    this.controls.on('3', () => void this.combat.equip('shotgun'));
    this.controls.on('x', () => void this.combat.equip(null));
    // mouse: right button aims (hold or toggle, see Settings), left button fires while aiming
    const cv = this.renderer.domElement;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.combat.setAim(this.combat.aimMode === 'toggle' ? !this.combat.aiming : true);
      if (e.button === 0 && this.combat.aiming) this.combat.firing = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2 && this.combat.aimMode === 'hold') this.combat.setAim(false);
      if (e.button === 0) this.combat.firing = false;
    });
    this.audio.onTrack = (st, title, artist) => { if (this.inCar) this.toast(`📻 ${st.name} ${st.freq} — “${title}” · ${artist}`, 'info'); };
    this.controls.on('g', () => { const a = this.contextActions().find((x) => x.key === 'G'); if (a) void this.doContextAction(a.id); });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.bindSocket();
  }

  private shadowify(o: THREE.Object3D): void {
    const cast = this.quality !== 'low';
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).castShadow = cast; });
  }

  private marker(color: string): THREE.Group {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.9, 40, 1, true), m); ring.position.y = 0.45; g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 15; g.add(beam);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), new THREE.MeshStandardMaterial({ color: '#a07a4a', roughness: 0.9 }));
    box.position.y = 1.4; box.name = 'box'; g.add(box);
    this.scene.add(g);
    return g;
  }

  applyServerState(s: { x: number; z: number; rot: number; car: { x: number; z: number; rot: number }; dirt: number }): void {
    this.pos.set(s.x, s.z); this.rot = s.rot;
    this.carState.x = s.car.x; this.carState.z = s.car.z; this.carState.rot = s.car.rot; this.carState.speed = 0;
    this.car.setDirt(s.dirt);
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h); this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 72 : 60;
    this.camera.updateProjectionMatrix();
  }

  now(): number { return Date.now() + this.serverOffset; }
  hour(): number { return this.hourOverride ?? gameHourAt(this.now()); }

  private bindSocket(): void {
    const s = this.socket;
    s.on('snap', (d: { t: number; players: PlayerSnapshot[]; police?: Game['policeSnap'] }) => { this.policeSnap = d.police ?? []; this.onSnap(d.players); });
    s.on('correct', (c: { x: number; z: number; rot: number; inCar: boolean; carX: number; carZ: number; carRot: number; vehicle?: { model: string; color: string } }) => {
      if (c.vehicle) this.setVehicle(c.vehicle.model, c.vehicle.color);
      this.pos.set(c.x, c.z); this.rot = c.rot; this.inCar = c.inCar;
      this.carState.x = c.carX; this.carState.z = c.carZ; this.carState.rot = c.carRot; this.carState.speed = 0;
    });
    s.on('weather', (w: { kind: WeatherKind }) => this.weather.set(w.kind));
    s.on('ride:end', (e: { x: number; z: number; reason: string }) => { this.ride = null; this.seq = null; this.pos.set(e.x, e.z); this.toast(e.reason, 'info'); });
    s.on('houses', (h: HouseState[]) => this.setHouses(h));
    s.on('dirt', (d: { dirt: number }) => this.car.setDirt(d.dirt));
    s.on('wallet', (w: { balance: number }) => { if (w.balance > this.balance) this.audio.cash(); this.balance = w.balance; this.onHud(); });
  }

  private onSnap(players: PlayerSnapshot[]): void {
    const seen = new Set<number>();
    this.onlineCount = players.length;
    for (const p of players) {
      if (p.id === this.me.id) continue;
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) {
        const char = new Character(p.app ?? DEFAULT_APP, styleOpts(p.style, p.admin)); char.setNameTag(p.name, p.admin);
        const car = new Car(CAR_COLORS[p.id % CAR_COLORS.length]);
        this.shadowify(char.group); this.shadowify(car.group);
        this.scene.add(char.group, car.group);
        r = { style: p.style, char, car, snap: p, x: p.x, z: p.z, rot: p.rot, cx: p.carX, cz: p.carZ, crot: p.carRot };
        this.remotes.set(p.id, r);
      }
      if (p.app && JSON.stringify(p.app) !== JSON.stringify(r.char.app)) r.char.setAppearance(p.app);
      const tagKey = p.gang ? `${p.gang.tag}|${p.gang.color}|${p.gang.emblem}` : '';
      if (r.tagKey !== tagKey) { r.tagKey = tagKey; r.char.setNameTag(p.name, p.admin, p.gang); }
      if ((r.aimT ?? 0) <= 0) r.char.setWeapon(p.wpn ?? null);
      if (p.style !== r.style) { r.style = p.style; r.char.setOpts(styleOpts(p.style, p.admin)); this.shadowify(r.char.group); }
      const key = (p.carModel ?? 'starter') + (p.carColor ?? '');
      if (r.carKey !== key) {
        const m = carModel(p.carModel); this.scene.remove(r.car.group);
        r.car = new Car(p.carColor ?? m.colors[0], { body: m.body, scale: m.scale, model: m.id }); this.shadowify(r.car.group); this.scene.add(r.car.group); r.carKey = key; r.car.setDirt(p.dirt);
      }
      if (Math.abs(p.dirt - r.car.dirt) > 0.01) r.car.setDirt(p.dirt);
      r.snap = p;
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) { this.scene.remove(r.char.group, r.car.group); this.remotes.delete(id); }
  }

  jump(): void {
    if (this.mode !== 'play' || this.inCar || this.ride || this.seq || this.jobs.working || this.jumpY > 0.001 || this.inside || this.combat.downed) return;
    this.jumpV = 4.1; this.audio.step();
  }
  /** radio: next/previous station (wraps through "off") */
  radioNext(dir: number): void {
    if (!this.inCar) return;
    this.audio.unlock(); this.audio.nextStation(dir);
    if (!this.audio.radioOn) this.toast('📻 Radio off', 'info');
    else { const st = STATIONS[this.audio.station]!; this.toast(`📻 ${st.name} ${st.freq} (${st.genre === 'afropop' ? 'Afro-pop' : st.genre[0]!.toUpperCase() + st.genre.slice(1)})`, 'info'); }
  }

  // ---------------- interactions ----------------
  private nearOwnCar(): boolean { return Math.hypot(this.pos.x - this.carState.x, this.pos.y - this.carState.z) < CAR_ENTER_RADIUS - 0.5; }

  toggleCar(): void {
    if (this.mode !== 'play' || this.seq || this.combat.downed) return;
    if (!this.inCar && !this.ride && this.combat.weapon) void this.combat.equip(null);
    if (this.ride) { void this.leaveRide(); return; }
    if (this.inCar) {
      if (Math.abs(this.carState.speed) > 3) { this.toast('Slow down to exit the car', 'info'); return; }
      const { x, z, rot } = this.carState;
      for (const [side, seat] of [[1, 0], [-1, 1]] as const) { // driver's side (left) first: Nigeria drives on the right
        const px = x + Math.cos(rot) * 1.9 * side, pz = z - Math.sin(rot) * 1.9 * side;
        if (!this.hits(px, pz, 0.35)) {
          this.carState.speed = 0;
          this.startSeq('out', seat, 'own', () => { this.pos.set(px, pz); this.inCar = false; this.rot = rot + side * Math.PI / 2; });
          return;
        }
      }
      this.toast('No space to get out here', 'info');
    } else if (this.nearOwnCar()) {
      const c = this.carState;
      // use the door on the side you're standing on (driver door on the left; climb across from the right)
      const side = (this.pos.x - c.x) * Math.cos(c.rot) - (this.pos.y - c.z) * Math.sin(c.rot) >= 0 ? 1 : -1;
      this.startSeq('in', side > 0 ? 0 : 1, 'own', () => { this.inCar = true; this.carState.speed = 0; this.controls.camYaw = this.carState.rot + Math.PI; });
    }
  }

  private startSeq(kind: 'in' | 'out', seat: number, target: 'own' | number, done: () => void): void {
    const car = target === 'own' ? this.car : this.remotes.get(target)?.car;
    if (!car) { done(); return; }
    this.seq = { kind, t: 0, seat, target, done, from: { x: this.pos.x, z: this.pos.y } };
    car.setDoor(car.doorForSeat(seat), true); this.audio.carDoor();
  }

  /** world placement for a seat / its door (car-local seat anchors → world) */
  seatWorld(car: Car, cx: number, cz: number, crot: number, seat: number, outside = 0): { x: number; y: number; z: number } {
    const sc = car.group.scale.x || 1;
    const sp = car.seats[seat] ?? car.seats[0] ?? new THREE.Vector3(seat % 2 ? -0.38 : 0.38, 0.62, seat >= 2 ? -0.7 : 0.1);
    const lx = sp.x + Math.sign(sp.x || 1) * outside, lz = sp.z;
    return { x: cx + (lx * Math.cos(crot) + lz * Math.sin(crot)) * sc, y: (sp.y - 0.5) * sc, z: cz + (-lx * Math.sin(crot) + lz * Math.cos(crot)) * sc };
  }
  /** pose a character for a car sequence (or seated) — shared by me and remote players */
  private poseInCar(ch: Character, car: Car, cx: number, cz: number, crot: number, seat: number, seq: CarSeq | undefined, gy: number, driving: boolean): { x: number; z: number; done: boolean } {
    const inside = this.seatWorld(car, cx, cz, crot, seat), out = this.seatWorld(car, cx, cz, crot, seat, 0.75);
    const side = (car.seats[seat]?.x ?? 1) >= 0 ? 1 : -1;
    let k: number; let sit: boolean; let done = false; let walk = 0;
    if (!seq) { k = 1; sit = true; }
    else if (seq.kind === 'in') {
      const t = seq.t;
      if (t < 0.3 && seq.from) { const a = t / 0.3; ch.group.position.set(seq.from.x + (out.x - seq.from.x) * a, gy, seq.from.z + (out.z - seq.from.z) * a); ch.group.rotation.y = crot - side * Math.PI / 2 * a; ch.pose = 'stand'; ch.animate(0.016, 1.5); return { x: ch.group.position.x, z: ch.group.position.z, done }; }
      k = Math.min(1, Math.max(0, (t - 0.3) / 0.6)); sit = t > 0.45; walk = t < 0.6 ? 0.8 : 0;
      if (t >= 1.0) car.setDoor(car.doorForSeat(seat), false);
      done = t >= SEQ_IN;
    } else {
      const t = seq.t;
      k = 1 - Math.min(1, Math.max(0, (t - 0.25) / 0.6)); sit = t < 0.55; walk = t > 0.6 ? 0.6 : 0;
      if (t >= 0.95) car.setDoor(car.doorForSeat(seat), false);
      done = t >= SEQ_OUT;
    }
    const e = k * k * (3 - 2 * k);
    const x = out.x + (inside.x - out.x) * e, z = out.z + (inside.z - out.z) * e, y = gy + inside.y * (sit ? 1 : e * 0.6);
    ch.group.position.set(x, y, z);
    ch.group.rotation.y = crot - side * (Math.PI / 2) * (1 - e) * (sit ? 0.6 : 1);
    ch.pose = sit ? 'sit' : 'stand'; ch.driving = driving && !seq; ch.animate(0.016, walk);
    return { x, z, done };
  }

  private async rideWith(driver: number): Promise<void> {
    if (this.seq) return;
    const r = await emitAck<{ ok: boolean; error?: string; seat?: number }>(this.socket, 'car:ride', { driver });
    if (!r.ok || r.seat === undefined) { this.toast(r.error ?? 'Failed', 'err'); return; }
    const seat = r.seat; const name = this.remotes.get(driver)?.snap.name ?? 'the driver';
    this.startSeq('in', seat, driver, () => { this.ride = { driver, seat }; this.toast(`🚗 Riding with ${name} (${seat === 1 ? 'front passenger' : 'back seat'}). Press E to get out.`, 'ok'); });
  }
  private async leaveRide(): Promise<void> {
    if (!this.ride || this.seq) return;
    const r = await emitAck<{ ok: boolean; error?: string; x?: number; z?: number }>(this.socket, 'car:leave');
    if (!r.ok) { this.toast(r.error ?? 'Failed', 'err'); return; }
    const ride = this.ride; this.ride = null;
    this.seq = null;
    const rem = this.remotes.get(ride.driver);
    if (!rem) { this.pos.set(r.x ?? this.pos.x, r.z ?? this.pos.y); return; }
    this.ride = ride; // keep seated during the get-out animation
    this.startSeq('out', ride.seat, ride.driver, () => { this.ride = null; this.pos.set(r.x ?? this.pos.x, r.z ?? this.pos.y); });
  }

  async doContextAction(id?: string): Promise<void> {
    const a = id ? this.contextActions().find((x) => x.id === id) : this.contextActions().find((x) => x.id !== 'car' && x.key === 'F');
    if (!a) return;
    if (a.id.startsWith('arrival:')) { this.arrivalAction(a.id); return; }
    if (a.id.startsWith('taxi:') || a.id.startsWith('station:')) { await this.jobs.action(a.id); this.onHud(); return; }
    if (a.id === 'car') { this.toggleCar(); return; }
    if (a.id.startsWith('ride:')) { await this.rideWith(Number(a.id.split(':')[1])); return; }
    if (a.id === 'shop:clothes') { this.onShop('clothes'); return; }
    if (a.id === 'shop:guns') { this.onShop('guns'); return; }
    if (a.id.startsWith('travel:')) {
      const mode = a.id.split(':')[1] as TravelMode;
      const r = await emitAck<{ ok: boolean; error?: string; to?: City; cutsceneMs?: number }>(this.socket, 'travel:go', { mode });
      if (!r.ok || !r.to) { this.toast(r.error ?? 'Failed', 'err'); return; }
      this.onTravel(mode, r.to, r.cutsceneMs ?? 8000);
      this.travelling = true; this.controls.enabled = false;
      setTimeout(() => { this.travelling = false; this.controls.enabled = true; this.toast(r.to === 'lagos' ? `Welcome to ${LAGOS.name}. Buses back at Eko Motor Park, flights at the Ikate terminal.` : 'Welcome back to Benin City.', 'ok'); this.onHud(); }, r.cutsceneMs ?? 8000);
      this.onHud(); return;
    }
    if (a.id === 'police:surrender') {
      const r = await emitAck<{ ok: boolean; error?: string; fine?: number }>(this.socket, 'police:surrender');
      if (r.ok) this.toast(`👮 You handed yourself in. Fine paid: ${naira(r.fine ?? 0)}. Stay out of trouble.`, 'ok'); else this.toast(r.error ?? 'Failed', 'err');
      this.onHud(); return;
    }
    if (a.id.startsWith('house:')) { await this.houseAction(a.id); this.onHud(); return; }
    if (a.id === 'car:color' || a.id === 'car:buy') {
      const slot = this.nearDisplay(); if (!slot) return; const m = carModel(slot.model);
      const ci = this.dealerColor.get(m.id) ?? 0;
      if (a.id === 'car:color') { const n = (ci + 1) % m.colors.length; this.dealerColor.set(m.id, n); this.world.displayCars.get(m.id)?.recolor(m.colors[n]); return; }
      const r = await emitAck<{ ok: boolean; error?: string; home?: { x: number; z: number } }>(this.socket, 'car:buy', { model: m.id, color: m.colors[ci] });
      if (r.ok) this.toast(`🚗 You bought the ${m.name}! It has been delivered to ${r.home && Math.hypot(r.home.x + 44, r.home.z - 20) < 30 ? 'the car park' : 'your house'} (check the minimap).`, 'ok'); else this.toast(r.error ?? 'Failed', 'err');
      this.onHud(); return;
    }
    if (a.id === 'pickup') {
      const r = await emitAck<{ ok: boolean; error?: string; dropoff?: { name: string; x: number; z: number } }>(this.socket, 'job:pickup');
      if (r.ok && r.dropoff) { this.job = r.dropoff; this.toast(`Package collected. Deliver to ${r.dropoff.name}.`, 'ok'); } else this.toast(r.error ?? 'Failed', 'err');
    } else if (a.id === 'deliver') {
      const r = await emitAck<{ ok: boolean; error?: string; paid?: number }>(this.socket, 'job:deliver');
      if (r.ok) { this.job = null; this.toast(`Delivered! Paid ${naira(r.paid ?? 0)}`, 'ok'); } else this.toast(r.error ?? 'Failed', 'err');
    } else if (a.id === 'wash') {
      const r = await emitAck<{ ok: boolean; error?: string }>(this.socket, 'carwash:buy');
      if (r.ok) this.toast(`Car washed — ${naira(CARWASH_PRICE)} paid. Sparkling!`, 'ok'); else this.toast(r.error ?? 'Failed', 'err');
    }
    this.onHud();
  }

  contextActions(): { id: string; label: string; key: string }[] {
    const out: { id: string; label: string; key: string }[] = [];
    if (this.mode === 'intro' && this.arrival) return this.arrivalActions();
    if (this.mode !== 'play') return out;
    const p = { x: this.inCar ? this.carState.x : this.pos.x, z: this.inCar ? this.carState.z : this.pos.y };
    out.push(...this.jobs.actions());
    if (this.ride) { out.push({ id: 'car', label: 'Get out (passenger)', key: 'E' }); return out; }
    if (this.inCar) out.push({ id: 'car', label: 'Exit car', key: 'E' });
    else if (this.nearOwnCar()) out.push({ id: 'car', label: 'Enter car', key: 'E' });
    if (!this.inCar && !this.seq) for (const [id, r] of this.remotes) {
      if (r.snap.ride || Math.hypot(this.pos.x - r.cx, this.pos.y - r.cz) > 4) continue;
      out.push({ id: `ride:${id}`, label: `Ride with ${r.snap.name} (passenger)`, key: 'F' }); break;
    }
    if (!this.job && !this.jobs.active && Math.hypot(p.x - MARKET_PICKUP.x, p.z - MARKET_PICKUP.z) < PICKUP_RADIUS - 0.5) out.push({ id: 'pickup', label: 'Pick up package', key: 'F' });
    if (this.job && Math.hypot(p.x - this.job.x, p.z - this.job.z) < DROPOFF_RADIUS - 0.5) out.push({ id: 'deliver', label: 'Deliver package', key: 'F' });
    if (this.inCar && inZone({ x: this.carState.x, z: this.carState.z }, CARWASH_ZONE)) out.push({ id: 'wash', label: `Wash car ${naira(CARWASH_PRICE)}`, key: 'F' });
    const slot = !this.inCar ? this.nearDisplay() : undefined;
    if (slot) {
      const m = carModel(slot.model); const ci = this.dealerColor.get(m.id) ?? 0;
      out.push({ id: 'car:buy', label: `Buy ${m.name} ${naira(m.price)}`, key: 'F' });
      out.push({ id: 'car:color', label: `Colour ${ci + 1}/${m.colors.length}`, key: 'G' });
    }
    if (this.wanted > 0 && this.nearPoliceStation()) out.push({ id: 'police:surrender', label: `Hand yourself in — pay ${naira(SURRENDER_PER_STAR * this.wanted)} fine`, key: 'F' });
    if (!this.inCar) for (const m of ['bus', 'flight'] as TravelMode[]) {
      const t = TRAVEL[m], c = this.city, d = t.desk[c];
      if (Math.hypot(p.x - d.x, p.z - d.z) < TRAVEL_DESK_RADIUS - 0.4) out.push({ id: `travel:${m}`, label: `${m === 'bus' ? '🚌 Bus' : '✈ Fly'} to ${c === 'benin' ? 'Lagos' : 'Benin City'} — ${naira(t.price)} (${t.hours})`, key: 'F' });
    }
    if (!this.inCar && Math.hypot(this.pos.x - GUN_SHOP.door.x, this.pos.y - GUN_SHOP.door.z) < GUN_SHOP.radius - 0.5) out.push({ id: 'shop:guns', label: `Gun counter — ${GUN_SHOP.name}`, key: 'F' });
    if (this.nearClothingStore()) out.push({ id: 'shop:clothes', label: `Browse clothes — ${CLOTHING_STORE.name}`, key: 'F' });
    if (!this.inCar) {
      const inside = houseAt(p.x, p.z);
      if (inside) {
        const ex = interiorExit(inside);
        const atDoor = Math.hypot(p.x - ex.x, p.z - ex.z) < 2.6;
        if (atDoor) out.push({ id: 'house:exit', label: 'Exit house', key: 'F' });
        const st = this.houseState(inside.id);
        if (st?.ownerId === this.me.id && atDoor) out.push({ id: 'house:lock', label: st.locked ? 'Unlock door (allow visitors)' : 'Lock door', key: 'G' });
        else if (st?.ownerId === this.me.id) out.push({ id: 'house:weapons', label: st.weaponsAllowed ? 'Weapons inside: ALLOWED (G to ban)' : 'Weapons inside: banned (G to allow)', key: 'G' });
      } else {
        const def = this.nearDoor();
        if (def) {
          const st = this.houseState(def.id);
          if (st && st.ownerId === null && def.forSale) out.push({ id: 'house:buy', label: `Buy ${def.name} ${naira(def.price)}`, key: 'F' });
          else if (st && (st.ownerId === this.me.id || !st.locked)) out.push({ id: 'house:enter', label: st.ownerId === this.me.id ? `Enter ${def.kind === 'mansion' ? 'mansion' : 'your house'}` : `Visit ${st.ownerName}'s ${def.kind === 'mansion' ? 'mansion' : 'house'}`, key: 'F' });
          if (st?.ownerId === this.me.id) out.push({ id: 'house:lock', label: st.locked ? 'Unlock door (allow visitors)' : 'Lock door', key: 'G' });
        }
      }
    }
    return out;
  }

  objective(): string {
    if (this.mode === 'intro' && this.arrival) {
      const ph = this.arrival.phase;
      if (ph === 'board') return 'Find your seat: row 8, seat B (left side) — next to Mr. Osaro by the window';
      if (ph === 'deplane') return this.player.pose === 'sit' ? 'The seatbelt sign is off. Stand up and leave by the front door.' : 'Walk to the open front door (left side) to leave the plane';
      return 'Listen to your advisor';
    }
    if (this.wanted > 0 && this.mode === 'play') return `${'★'.repeat(this.wanted)} WANTED — the police are looking for you. Stay away from checkpoints for 90 s per star, or hand yourself in at the Police Station (East road).`;
    if (this.mode === 'play' && this.city === 'lagos' && !this.inside) return `${LAGOS.name} — walk the waterfront, beach and towers. Back to Benin: Eko Motor Park (bus ${naira(TRAVEL.bus.price)}) or the airport (flight ${naira(TRAVEL.flight.price)}).`;
    if (this.inside) return `Inside ${this.inside.name}. Walk to the EXIT sign by the front door to leave.`;
    const near = !this.inCar ? this.nearDoor() : undefined;
    if (near) {
      const st = this.houseState(near.id);
      if (st?.ownerId && st.ownerId !== this.me.id && st.locked) return `${near.name} — owned by ${st.ownerName}. ${near.kind === 'mansion' ? 'The guards only admit guests when BEST 𝕏 opens the gate.' : 'Locked.'}`;
      if (st && !st.ownerId) return `${near.name} — for sale at ${naira(near.price)}. Your balance: ${naira(this.balance)}.`;
    }
    const jo = this.jobs.objective(); if (jo) return jo;
    if (this.job) {
      const p = this.inCar ? { x: this.carState.x, z: this.carState.z } : { x: this.pos.x, z: this.pos.y };
      return `Deliver package to ${this.job.name} (${Math.round(Math.hypot(p.x - this.job.x, p.z - this.job.z))} m) — green marker`;
    }
    if (this.car.dirt > 0.6) return 'Your car is dirty — Ring Road Car Wash (blue bay, East road) or take a delivery job at the market';
    return 'Delivery job: go to the New Benin Market pickup (amber marker, South road)';
  }

  // ---------------- houses ----------------
  nearDisplay(): (typeof DISPLAY_SLOTS)[number] | undefined {
    let best: (typeof DISPLAY_SLOTS)[number] | undefined, bd = DEALER_RADIUS;
    for (const s of DISPLAY_SLOTS) { const d = Math.hypot(this.pos.x - s.x, this.pos.y - s.z); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  setVehicle(model: string, color: string): void {
    if (model === this.carModelId && color === this.carColor) return;
    this.carModelId = model; this.carColor = color;
    const m = carModel(model); const dirt = this.car.dirt;
    this.scene.remove(this.car.group);
    this.car = new Car(color, { headlightLights: true, body: m.body, scale: m.scale, model: m.id }); this.car.setDirt(dirt);
    this.shadowify(this.car.group); this.scene.add(this.car.group);
  }
  houseState(id: string): HouseState | undefined { return this.houses.find((h) => h.id === id); }
  nearDoor(): HouseDef | undefined {
    return HOUSES.find((h) => Math.hypot(this.pos.x - h.door.x, this.pos.y - h.door.z) < HOUSE_DOOR_RADIUS - 0.3);
  }
  setHouses(list: HouseState[]): void {
    this.houses = list;
    for (const st of list) {
      const def = houseById(st.id); if (!def) continue;
      const text = def.kind === 'mansion' ? (st.locked ? 'PRIVATE · LOCKED' : 'GATE OPEN · VISITORS WELCOME')
        : st.ownerId === null ? `FOR SALE · ${naira(def.price)}` : `${st.ownerId === this.me.id ? 'YOUR HOUSE' : st.ownerName} · ${st.locked ? 'LOCKED' : 'OPEN'}`;
      let sp = this.houseLabels.get(st.id);
      if (!sp) { sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true })); sp.scale.set(4, 0.75, 1); sp.position.set(def.door.x, def.kind === 'mansion' ? 5.4 : 3.4, def.door.z + (def.kind === 'mansion' ? 2.3 : 2.6)); this.scene.add(sp); this.houseLabels.set(st.id, sp); }
      const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d')!;
      g.fillStyle = st.ownerId === null ? 'rgba(20,90,40,0.85)' : 'rgba(10,10,10,0.78)'; g.beginPath(); g.roundRect(4, 8, 504, 80, 18); g.fill();
      g.fillStyle = '#f5e6c0'; g.font = '700 38px "Noto Sans", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 49, 490);
      const mat = sp.material as THREE.SpriteMaterial; mat.map?.dispose(); mat.map = new THREE.CanvasTexture(c); mat.map.colorSpace = THREE.SRGBColorSpace; mat.needsUpdate = true;
    }
  }
  private async houseAction(id: string): Promise<void> {
    const def = this.inside ?? this.nearDoor(); if (!def) return;
    if (id === 'house:buy') {
      const r = await emitAck<{ ok: boolean; error?: string; balance?: number }>(this.socket, 'house:buy', { id: def.id });
      if (r.ok) this.toast(`🏠 You bought ${def.name} for ${naira(def.price)}! Press F to enter.`, 'ok'); else this.toast(r.error ?? 'Failed', 'err');
    } else if (id === 'house:enter') {
      const r = await emitAck<{ ok: boolean; error?: string }>(this.socket, 'house:enter', { id: def.id });
      if (!r.ok) this.toast(r.error ?? 'Failed', 'err');
    } else if (id === 'house:exit') {
      const r = await emitAck<{ ok: boolean; error?: string }>(this.socket, 'house:exit');
      if (!r.ok) this.toast(r.error ?? 'Failed', 'err');
    } else if (id === 'house:lock') {
      const st = this.houseState(def.id);
      const r = await emitAck<{ ok: boolean; error?: string }>(this.socket, 'house:lock', { id: def.id, locked: !st?.locked });
      if (r.ok) this.toast(st?.locked ? '🔓 Unlocked — other players can visit' : '🔒 Locked', 'ok'); else this.toast(r.error ?? 'Failed', 'err');
    } else if (id === 'house:weapons') {
      const st = this.houseState(def.id);
      const r = await emitAck<{ ok: boolean; error?: string }>(this.socket, 'house:weapons', { id: def.id, allowed: !st?.weaponsAllowed });
      if (r.ok) this.toast(st?.weaponsAllowed ? '🛡 Weapons are now banned inside your house' : '⚠ Weapons are now allowed inside your house', 'ok'); else this.toast(r.error ?? 'Failed', 'err');
    }
  }
  private updateInside(): void {
    const now = houseAt(this.pos.x, this.pos.y);
    if (now?.id === this.inside?.id) return;
    if (this.inside) for (const l of this.world.interiorLights.get(this.inside.id) ?? []) l.visible = false;
    if (now) for (const l of this.world.interiorLights.get(now.id) ?? []) l.visible = true;
    this.inside = now;
    this.audio.door();
    this.camTarget.set(0, 0, 0); // snap camera on teleport
    this.camera.position.set(this.pos.x, 2.2, this.pos.y - 3);
  }

  // ---------------- physics ----------------
  hits(x: number, z: number, r: number): boolean {
    for (const b of this.world.colliders) {
      const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) return true;
    }
    return false;
  }
  private push(x: number, z: number, r: number): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      for (const b of this.world.colliders as AABB[]) {
        const cx = Math.max(b.minX, Math.min(x, b.maxX)), cz = Math.max(b.minZ, Math.min(z, b.maxZ));
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 > 1e-8) { const d = Math.sqrt(d2); x = cx + (dx / d) * r; z = cz + (dz / d) * r; }
          else { // inside box: push to nearest edge
            const opts = [[b.minX - r - x, 0], [b.maxX + r - x, 0], [0, b.minZ - r - z], [0, b.maxZ + r - z]];
            opts.sort((a, c) => Math.hypot(a[0], a[1]) - Math.hypot(c[0], c[1])); x += opts[0][0]; z += opts[0][1];
          }
        }
      }
    }
    return [x, z];
  }
  private carBlocked(x: number, z: number, rot: number): boolean {
    const fx = Math.sin(rot), fz = Math.cos(rot);
    return [-1.45, 0, 1.45].some((o) => this.hits(x + fx * o, z + fz * o, 0.95));
  }

  private updateOnFoot(dt: number): void {
    if (this.combat.downed) { this.speed = 0; return; }
    const a = this.controls.axes();
    if (this.combat.aiming) { a.sprint = false; let d = this.controls.camYaw + Math.PI - this.rot; d = Math.atan2(Math.sin(d), Math.cos(d)); this.rot += d * Math.min(1, dt * 16); }
    const yaw = this.controls.camYaw;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let dx = fx * a.y + rx * a.x, dz = fz * a.y + rz * a.x;
    const l = Math.hypot(dx, dz);
    const target = l > 0.05 ? (a.sprint ? 6 : this.combat.aiming ? 1.8 : 2.4) * Math.min(1, l) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 8);
    if (l > 0.05) {
      dx /= l; dz /= l;
      const want = Math.atan2(dx, dz);
      let d = want - this.rot; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (!this.combat.aiming) this.rot += d * Math.min(1, dt * 12); // aiming: strafe while facing the crosshair
      const [nx, nz] = this.push(this.pos.x + dx * this.speed * dt, this.pos.y + dz * this.speed * dt, 0.35);
      this.pos.set(nx, nz);
    }
  }

  private updateCar(dt: number): void {
    const a = this.controls.axes();
    const c = this.carState;
    const throttle = a.y, brake = this.controls.brake();
    if (throttle > 0.05) c.speed += (c.speed < -0.5 ? 16 : 7.5) * throttle * dt;
    else if (throttle < -0.05) c.speed += (c.speed > 0.5 ? -16 : -4.5) * -throttle * dt;
    else c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), 2.2 * dt);
    if (brake) c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), 20 * dt);
    c.speed -= c.speed * 0.12 * dt;
    c.speed = Math.max(-8, Math.min(36, c.speed));
    const maxSteer = 0.62 / (1 + Math.abs(c.speed) * 0.05);
    c.steer += (a.x * maxSteer - c.steer) * Math.min(1, dt * 6);
    const nrot = c.rot - (c.speed * Math.tan(c.steer) / 2.7) * dt;
    const nx = c.x + Math.sin(nrot) * c.speed * dt, nz = c.z + Math.cos(nrot) * c.speed * dt;
    // collisions: free move → slide along the wall (lose the blocked component) → turn on the spot → hard stop with a bounce.
    // If we already overlap something (spawned/teleported into a collider) let the car drive out instead of sticking.
    const stuck = this.carBlocked(c.x, c.z, c.rot);
    if (stuck || !this.carBlocked(nx, nz, nrot)) { c.x = nx; c.z = nz; c.rot = nrot; this.lastHit = 0; }
    else {
      const mx = nx - c.x, mz = nz - c.z, m = Math.hypot(mx, mz) || 1;
      const slideX = !this.carBlocked(nx, c.z, nrot), slideZ = !this.carBlocked(c.x, nz, nrot);
      if (slideX || slideZ) {
        const useX = slideX && (!slideZ || Math.abs(mx) >= Math.abs(mz));
        if (useX) c.x = nx; else c.z = nz;
        c.rot = nrot;
        c.speed *= Math.max(0.05, (useX ? Math.abs(mx) : Math.abs(mz)) / m * 0.92) ** Math.min(1, dt * 3); // scrape: bleed speed while grinding the wall
      } else {
        if (!this.carBlocked(c.x, c.z, nrot)) c.rot = nrot;
        const impact = Math.abs(c.speed);
        if (impact > 8 && performance.now() - this.lastHit > 1500) { this.toast('Crash!', 'info'); this.audio.crash(Math.min(1, impact / 25)); this.lastHit = performance.now(); }
        c.speed *= -0.2;
      }
    }
    this.pos.set(c.x, c.z); this.rot = c.rot; this.speed = Math.abs(c.speed);
  }

  // ---------------- main loop ----------------
  start(): void {
    const loop = () => { requestAnimationFrame(loop); this.frame(); };
    loop();
  }

  /** Auto quality: lower/raise the render resolution to hold ~30+ fps (tablets, phones, older laptops). Off when the
   *  player picked a fixed quality or in capture mode (screenshots). */
  private fpsAcc = 0; private fpsN = 0; private prScale = 1; resolutionScale = 1;
  private adaptResolution(rawDt: number): void {
    if (storedQualityChoice() !== 'auto' || new URLSearchParams(location.search).has('capture')) return;
    this.fpsAcc += rawDt; this.fpsN++;
    if (this.fpsAcc < 3) return;
    const fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0;
    const max = Math.min(window.devicePixelRatio || 1, QUALITY_SETTINGS[this.quality].pixelRatioMax);
    const prev = this.prScale;
    if (fps < 26 && this.prScale > 0.5) this.prScale = Math.max(0.5, this.prScale - 0.15);
    else if (fps > 50 && this.prScale < 1) this.prScale = Math.min(1, this.prScale + 0.1);
    if (prev !== this.prScale) { this.renderer.setPixelRatio(max * this.prScale); this.resolutionScale = this.prScale; this.composer?.setPixelRatio(max * this.prScale); }
  }

  private frame(): void {
    const raw = this.clock.getDelta(); this.adaptResolution(raw);
    const dt = Math.min(this.maxDt, raw);
    const t = performance.now() / 1000;
    if (this.mode === 'play') { if (this.seq || this.ride) this.speed = 0; else if (this.inCar) this.updateCar(dt); else if (!this.jobs.working) this.updateOnFoot(dt); else this.speed = 0; }
    else if (this.mode === 'intro' && this.arrival && this.player.pose === 'stand' && (this.arrival.phase === 'board' || this.arrival.phase === 'deplane')) this.updateOnFoot(dt);
    else this.speed = 0;
    if (this.arrival && this.player.pose === 'sit') { const s = this.arrival.mySeat(); this.pos.set(s.x, s.z); this.rot = Math.PI; }

    // own avatar & car
    const gy = this.world.heightAt(this.pos.x, this.pos.y);
    this.car.group.position.set(this.carState.x, this.world.heightAt(this.carState.x, this.carState.z), this.carState.z);
    this.car.group.rotation.y = this.carState.rot;
    this.car.updateWheels(this.inCar ? this.carState.speed : 0, this.inCar ? this.carState.steer : 0, dt);
    this.player.group.visible = true;
    const rideCar = this.ride || (this.seq && this.seq.target !== 'own') ? this.remotes.get((this.ride?.driver ?? this.seq!.target) as number) : undefined;
    if (this.seq) {
      this.seq.t += dt;
      const c = this.seq.target === 'own' ? { car: this.car, x: this.carState.x, z: this.carState.z, rot: this.carState.rot } : rideCar ? { car: rideCar.car, x: rideCar.cx, z: rideCar.cz, rot: rideCar.crot } : null;
      if (!c) { const d = this.seq.done; this.seq = null; d(); }
      else {
        const r = this.poseInCar(this.player, c.car, c.x, c.z, c.rot, this.seq.seat, this.seq, gy, false);
        this.pos.set(r.x, r.z);
        if (r.done) { const d = this.seq.done; this.seq = null; d(); }
      }
    } else if (this.inCar) {
      this.poseInCar(this.player, this.car, this.carState.x, this.carState.z, this.carState.rot, 0, undefined, this.world.heightAt(this.carState.x, this.carState.z), true);
      this.player.steer = this.carState.steer;
    } else if (this.ride && rideCar) {
      const r = this.poseInCar(this.player, rideCar.car, rideCar.cx, rideCar.cz, rideCar.crot, this.ride.seat, undefined, this.world.heightAt(rideCar.cx, rideCar.cz), false);
      this.pos.set(r.x, r.z); this.rot = rideCar.crot;
    } else {
      this.player.pose = this.player.pose === 'sit' && !this.arrival ? 'stand' : this.player.pose; this.player.driving = false;
      if (this.jumpV !== 0 || this.jumpY > 0) { // simple ballistic hop
        this.jumpY += this.jumpV * dt; this.jumpV -= 9.8 * dt;
        if (this.jumpY <= 0) { this.jumpY = 0; this.jumpV = 0; this.audio.step(); }
      }
      this.player.airborne = Math.min(1, this.jumpY * 3);
      this.player.yawRate = dt > 0 ? Math.atan2(Math.sin(this.rot - this.lastRot), Math.cos(this.rot - this.lastRot)) / dt : 0; this.lastRot = this.rot;
      this.player.group.position.set(this.pos.x, gy + this.jumpY, this.pos.y);
      this.player.group.rotation.y = this.rot;
      this.player.animate(dt, this.speed);
    }

    // remotes (smooth interpolation toward latest snapshot)
    const k = 1 - Math.exp(-dt * 10);
    for (const [rid, r] of this.remotes) { const p = { id: rid };
      const s = r.snap;
      if (Math.hypot(s.x - r.x, s.z - r.z) > 40) { r.x = s.x; r.z = s.z; } // teleport (house door) — snap
      const pcx = r.cx, pcz = r.cz;
      r.x += (s.x - r.x) * k; r.z += (s.z - r.z) * k; r.cx += (s.carX - r.cx) * k; r.cz += (s.carZ - r.cz) * k;
      const ocrot = r.crot;
      r.rot += Math.atan2(Math.sin(s.rot - r.rot), Math.cos(s.rot - r.rot)) * k;
      r.crot += Math.atan2(Math.sin(s.carRot - r.crot), Math.cos(s.carRot - r.crot)) * k;
      // get-in / get-out animations for other players, driven by their inCar / ride transitions
      const rideKey = s.ride ? `${s.ride.driver}:${s.ride.seat}` : '';
      if (r.wasIn !== undefined && r.wasIn !== s.inCar) r.seq = { kind: s.inCar ? 'in' : 'out', t: 0, seat: 0, from: { x: r.x, z: r.z } };
      if (r.wasRide !== undefined && r.wasRide !== rideKey) r.seq = { kind: rideKey ? 'in' : 'out', t: 0, seat: s.ride?.seat ?? Number((r.wasRide || '0:1').split(':')[1]), from: { x: r.x, z: r.z } };
      const seqCarOwner = r.seq ? (rideKey ? s.ride!.driver : r.wasRide ? Number(r.wasRide.split(':')[0]) : p.id) : 0;
      r.wasIn = s.inCar; r.wasRide = rideKey;
      const host = (id: number) => id === this.me.id ? { car: this.car, x: this.carState.x, z: this.carState.z, rot: this.carState.rot } : id === p.id ? { car: r.car, x: r.cx, z: r.cz, rot: r.crot } : (() => { const o = this.remotes.get(id); return o ? { car: o.car, x: o.cx, z: o.cz, rot: o.crot } : null; })();
      r.char.group.visible = true;
      const gyR = this.world.heightAt(r.x, r.z);
      if (r.seq) {
        if (r.seq.t === 0) { const h0 = host(seqCarOwner); h0?.car.setDoor(h0.car.doorForSeat(r.seq.seat), true); }
        r.seq.t += dt; const h = host(seqCarOwner);
        if (!h) r.seq = undefined;
        else if (this.poseInCar(r.char, h.car, h.x, h.z, h.rot, r.seq.seat, r.seq, gyR, false).done) r.seq = undefined;
      } else if (s.inCar) { this.poseInCar(r.char, r.car, r.cx, r.cz, r.crot, 0, undefined, this.world.heightAt(r.cx, r.cz), true); r.char.steer = r.csteer ?? 0; }
      else if (s.ride && host(s.ride.driver)) { const h = host(s.ride.driver)!; this.poseInCar(r.char, h.car, h.x, h.z, h.rot, s.ride.seat, undefined, this.world.heightAt(h.x, h.z), false); }
      else {
        r.char.pose = 'stand'; r.char.driving = false;
        r.char.group.position.set(r.x, gyR, r.z); r.char.group.rotation.y = (r.aimT ?? 0) > 0 && r.aimYaw !== undefined ? r.aimYaw : r.rot;
        r.char.animate(dt, s.moving);
      }
      r.car.group.position.set(r.cx, this.world.heightAt(r.cx, r.cz), r.cz); r.car.group.rotation.y = r.crot;
      // signed speed along the nose + steering inferred from the yaw rate, so remote cars spin/steer their wheels and lean too
      const vAlong = dt > 0 ? ((r.cx - pcx) * Math.sin(r.crot) + (r.cz - pcz) * Math.cos(r.crot)) / dt : 0;
      r.cspeed = (r.cspeed ?? 0) + (vAlong - (r.cspeed ?? 0)) * Math.min(1, dt * 6);
      r.csteer = (r.csteer ?? 0) + (r.car.steerFor(r.crot - ocrot, dt, r.cspeed) - (r.csteer ?? 0)) * Math.min(1, dt * 6);
      r.car.updateWheels(r.cspeed, r.csteer, dt);
      r.car.setLights(s.inCar && this.env.night > 0.5);
    }

    this.combat.update(dt);
    this.combat.updatePolice(this.policeSnap, dt, t);
    // markers
    this.jobs.update(dt);
    this.pickupMarker.visible = !this.job && !this.jobs.active && this.mode === 'play';
    this.dropMarker.visible = !!this.job;
    if (this.job) this.dropMarker.position.set(this.job.x, 0, this.job.z);
    for (const m of [this.pickupMarker, this.dropMarker]) { const b = m.getObjectByName('box')!; b.rotation.y = t; b.position.y = 1.4 + Math.sin(t * 2) * 0.15; }

    this.updateInside();
    if (this.arrival) {
      this.arrivalCam = this.arrival.update(dt, this.env.night, this.weather.overcast, this.pos);
      this.audio.cabinBoost += ((this.arrival.phase === 'landing' ? 1 : this.arrival.phase === 'taxi' ? Math.max(0, 0.8 - this.arrival.phaseT * 0.2) : 0) - this.audio.cabinBoost) * Math.min(1, dt * 1.5);
    }
    // day / night
    const hour = this.hour();
    const focus = this.arrival?.phase === 'landing' ? new THREE.Vector3(-230, 0, -322) : new THREE.Vector3(this.pos.x, 0, this.pos.y);
    const inCabin = !!this.arrival && this.arrival.phase !== 'landing';
    this.camera.getWorldDirection(this.weather.viewDir);
    this.weather.update(dt, this.camera.position, !!this.inside || inCabin);
    this.audio.update(dt, { mode: this.mode, inCar: this.inCar, speed: this.inCar ? this.carState.speed : 0, walking: this.inCar ? 0 : this.speed, indoor: !!this.inside, night: this.env.night,
      rain: this.weather.rain, marketDist: Math.hypot(this.pos.x - MARKET_PICKUP.x, this.pos.y - MARKET_PICKUP.z), intro: this.mode === 'intro', radio: this.radio,
      clock: (Date.now() + this.serverOffset) / 1000, lite: this.quality === 'low' });
    if (this.voice.on) {
      if (this.voice.mode === 'ptt') { const t = this.controls.keys.has('v') || this.pttHeld; if (t !== this.voice.talking) this.voice.setTalking(t); }
      const others = [...this.remotes.entries()].map(([id, r]) => ({ id, x: r.snap.inCar ? r.cx : r.x, z: r.snap.inCar ? r.cz : r.z, voice: !!r.snap.voice }));
      this.voice.update(dt, { x: this.pos.x, z: this.pos.y, yaw: this.controls.camYaw + Math.PI }, others);
    }
    const ins = this.inside?.interior;
    this.env.indoor = inCabin || (ins && Math.abs(this.pos.x - ins.x) < ins.w / 2 && Math.abs(this.pos.y - ins.z) < ins.d / 2) ? 1 : 0;
    this.env.overcast = this.weather.overcast; this.env.flash = this.weather.flash;
    this.world.setWet(this.weather.wet);
    this.env.update(hour, focus);
    this.world.setNight(this.env.night);
    // police: officers watch the nearest wanted player (you or another player); siren when you're wanted near a checkpoint
    if (this.mode === 'play') {
      const me = { x: this.inCar ? this.carState.x : this.pos.x, z: this.inCar ? this.carState.z : this.pos.y };
      let alert: { x: number; z: number } | null = this.wanted > 0 ? me : null;
      if (!alert) for (const r of this.remotes.values()) if ((r.snap.wanted ?? 0) > 0) { alert = { x: r.snap.inCar ? r.cx : r.x, z: r.snap.inCar ? r.cz : r.z }; break; }
      this.world.policeAlert = alert;
      const near = alert ? nearestOfficer(alert).d : Infinity;
      const myD = nearestOfficer(me).d;
      this.audio.siren(alert && near < 45 ? Math.max(0, 1 - myD / 70) : 0);
    } else this.audio.siren(0);
    this.world.animate(dt);
    if (this.mode === 'play' && !this.ambient) { this.ambient = new Ambient(this.world, this.quality); this.ambient.setEnabled(this.ambientOn); }
    if (this.ambient) {
      const obstacles: { x: number; z: number }[] = [{ x: this.carState.x, z: this.carState.z }];
      if (!this.inCar) obstacles.push({ x: this.pos.x, z: this.pos.y });
      for (const r of this.remotes.values()) { obstacles.push({ x: r.cx, z: r.cz }); if (!r.snap.inCar) obstacles.push({ x: r.x, z: r.z }); }
      const cam = this.camera.position;
      this.ambient.update(dt, { t: (Date.now() + this.serverOffset) / 1000, focus: { x: cam.x, z: cam.z }, obstacles, night: this.env.night, wet: this.weather.wet, hidden: cam.z > 560 || cam.z < -1100 });
    }
    this.car.setLights(this.inCar && this.env.night > 0.5, this.inCar && this.controls.brake());

    this.updateCamera(dt, t);
    Car.updateLods(this.camera.position, this.quality === 'low' ? 0.8 : 1);
    // enclosed spaces (house interiors z>560, plane cabin z<-1100) sit far from the city: clip the far plane so the
    // whole city isn't drawn behind the walls (big win on software / mobile GPUs)
    const cz = this.camera.position.z, far = cz > 560 || cz < -1100 ? 70 : this.camera.position.x > 1000 ? 800 : 1400; // Lagos district sits at x≈2000
    if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
    // automated multi-player tests: skip drawing on a page nobody is looking at (networking below still runs)
    if (!this.renderPaused) { if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera); }

    // network (10 Hz)
    if (this.mode === 'play' && t - this.lastSend > 0.1) {
      this.lastSend = t;
      this.socket.emit('state', { x: this.pos.x, z: this.pos.y, rot: this.rot, moving: this.speed, inCar: this.inCar, carX: this.carState.x, carZ: this.carState.z, carRot: this.carState.rot });
    }
    this.onAction(this.contextActions());
  }

  /** creator/close-up camera (also used for character close-up screenshots) */
  creatorView = { dist: 3.2, y: 1.1, spin: 0.25 };
  /** fixed camera [px,py,pz, lx,ly,lz] — used by the photo/tour tooling */
  camOverride: number[] | null = null;
  private camFov = 60;

  /** test hook: game logic keeps running but nothing is drawn (lets several software-rendered test browsers share one CPU) */
  renderPaused = false;
  private aimBlend = 0;
  private updateCamera(dt: number, t: number): void {
    const c = this.controls;
    const carSp = this.inCar ? Math.abs(this.carState.speed) : 0;
    this.aimBlend += ((this.combat?.aiming ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-dt * 10));
    this.camFov += ((this.mode === 'intro' && this.arrivalCam?.fov ? this.arrivalCam.fov : 60 + Math.min(9, carSp * 0.28) - this.aimBlend * 12) - this.camFov) * (1 - Math.exp(-dt * (this.combat?.aiming ? 10 : 3)));
    const fov = this.mode === 'intro' && this.arrivalCam?.fov ? this.arrivalCam.fov : Math.round(this.camFov * 10) / 10;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (this.mode === 'intro' && this.arrivalCam && !this.camOverride) { this.camera.position.copy(this.arrivalCam.pos); this.camera.lookAt(this.arrivalCam.look); return; }
    if (c.camYaw !== this.lastDragYaw) { this.lastDragYaw = c.camYaw; this.lastDragTime = t; }
    if (this.camOverride) { const o = this.camOverride; this.camera.position.set(o[0], o[1], o[2]); this.camera.lookAt(o[3], o[4], o[5]); return; }
    if (this.mode === 'creator') {
      c.camYaw += dt * this.creatorView.spin; this.lastDragYaw = c.camYaw;
      const p = this.player.group.position, v = this.creatorView;
      this.camera.position.set(p.x + Math.sin(c.camYaw) * v.dist, p.y + v.y + 0.4 * v.dist / 3.2, p.z + Math.cos(c.camYaw) * v.dist);
      this.camera.lookAt(p.x, p.y + v.y, p.z);
      return;
    }
    if (this.inCar && Math.abs(this.carState.speed) > 2 && t - this.lastDragTime > 1.2) {
      const want = this.carState.rot + (this.carState.speed > 0 ? Math.PI : 0);
      const d = Math.atan2(Math.sin(want - c.camYaw), Math.cos(want - c.camYaw));
      c.camYaw += d * (1 - Math.exp(-dt * 2.5)); this.lastDragYaw = c.camYaw;
    }
    const ab = this.inCar ? 0 : this.aimBlend;
    const dist = (this.inCar ? 8.2 + Math.min(2, carSp * 0.06) : this.arrival ? 2.1 : this.inside ? 3.4 : 4.6) * (1 - ab * 0.42), height = this.inCar ? 1.4 : 1.55;
    // over-the-right-shoulder framing while aiming
    const sh = ab * 0.85;
    const tgt = new THREE.Vector3(this.pos.x + Math.cos(c.camYaw) * sh, this.world.heightAt(this.pos.x, this.pos.y) + height + ab * 0.08, this.pos.y - Math.sin(c.camYaw) * sh);
    this.camTarget.lerp(tgt, this.camTarget.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * (this.inCar ? 14 : 10)));
    const cp = Math.cos(c.camPitch), sp = Math.sin(c.camPitch);
    const want = new THREE.Vector3(this.camTarget.x + Math.sin(c.camYaw) * dist * cp, this.camTarget.y + dist * sp + 0.3, this.camTarget.z + Math.cos(c.camYaw) * dist * cp);
    // keep camera out of buildings: pull in along the ray if blocked
    for (let f = 1; f > 0.25; f -= 0.08) {
      const x = this.camTarget.x + (want.x - this.camTarget.x) * f, z = this.camTarget.z + (want.z - this.camTarget.z) * f;
      if (!this.hits(x, z, 0.3) || f <= 0.3) { want.x = x; want.z = z; break; }
    }
    if (this.arrival) want.y = Math.min(want.y, 2.15);
    this.camera.position.lerp(want, 1 - Math.exp(-dt * 9));
    this.camera.lookAt(this.camTarget);
  }

  // ---------------- playable arrival (plane cabin → landing → Benin Airport) ----------------
  private arrivalCam: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number } | null = null;
  playIntro(done: () => void): void {
    const a = new Arrival(this.scene, this.quality);
    this.arrival = a; this.arrivalDone = done;
    this.world.colliders.push(...a.colliders);
    a.onLine = (l) => this.onArrivalLine(l);
    a.onPhase = (p) => { if (p === 'deplane') { this.player.pose = 'sit'; } this.onArrivalPhase(p); };
    a.onSay = (l) => { if (l.who !== 'note') this.audio.say(l.text, l.who); };
    a.onChime = () => this.audio.chime();
    a.onTouchdown = () => this.audio.landing();
    const sp = a.boardSpawn(); this.pos.set(sp.x, sp.z); this.rot = 0; this.controls.camYaw = Math.PI; this.controls.camPitch = 0.12;
    this.inCar = false; this.player.pose = 'stand'; this.player.showTag(false);
    this.mode = 'intro';
    this.camTarget.set(0, 0, 0);
    this.onArrivalPhase('board');
    this.toast('✈ Welcome aboard Ivie Air IV 214 to Benin City. Find seat 8B.', 'info');
  }
  private arrivalActions(): { id: string; label: string; key: string }[] {
    const a = this.arrival!; const out: { id: string; label: string; key: string }[] = [];
    if (a.phase === 'board') {
      const p = a.aisleAtMyRow(); if (Math.hypot(this.pos.x - p.x, this.pos.y - p.z) < 1.0) out.push({ id: 'arrival:seat', label: 'Take your seat 8B', key: 'F' });
    } else if (a.phase === 'deplane') {
      if (this.player.pose === 'sit') out.push({ id: 'arrival:stand', label: 'Stand up', key: 'F' });
      else { const d = a.doorPos(); if (Math.hypot(this.pos.x - d.x, this.pos.y - d.z) < 1.3) out.push({ id: 'arrival:exit', label: 'Exit to Benin Airport', key: 'F' }); }
    }
    return out;
  }
  private arrivalAction(id: string): void {
    const a = this.arrival; if (!a) return;
    if (id === 'arrival:seat') { this.player.pose = 'sit'; this.audio.step(); a.setPhase('seated'); }
    else if (id === 'arrival:stand') { this.player.pose = 'stand'; const p = a.aisleAtMyRow(); this.pos.set(p.x, p.z); this.rot = Math.PI; this.controls.camYaw = 0; this.camTarget.set(0, 0, 0); }
    else if (id === 'arrival:exit') { this.audio.door(); a.setPhase('exit'); setTimeout(() => this.finishArrival(), 900); }
  }
  /** skip button / end of the sequence: remove the cabin and hand over to the server (which places us in the arrivals hall) */
  skipIntro(): void { this.finishArrival(); }
  private finishArrival(): void {
    const a = this.arrival; if (!a) return;
    a.dispose(this.scene); this.audio.stopSpeech(); this.audio.cabinBoost = 0;
    const set = new Set(a.colliders); this.world.colliders = this.world.colliders.filter((c) => !set.has(c));
    this.arrival = undefined; this.arrivalCam = null; this.player.pose = 'stand'; this.player.showTag(true);
    this.camera.fov = 60; this.camera.updateProjectionMatrix();
    this.mode = 'play'; this.camTarget.set(0, 0, 0);
    this.pos.set(AIRPORT.arrival.x, AIRPORT.arrival.z); this.rot = AIRPORT.arrival.rot; this.controls.camYaw = this.rot + Math.PI;
    const d = this.arrivalDone; this.arrivalDone = undefined; d?.();
  }
}

export const DROPOFF_NAMES = DROPOFFS.map((d) => d.name);
