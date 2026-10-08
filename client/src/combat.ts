// Client side of combat: weapon selection, aiming, firing (the server decides hits), reload, recoil,
// muzzle flash / tracers / impacts, police response units, knockdown state and the HUD numbers.
import * as THREE from 'three';
import type { Socket } from 'socket.io-client';
import { emitAck } from './net';
import { Character } from './character';
import { Car } from './car';
import type { AudioEngine } from './audio';
import {
  WEAPONS, WEAPON_IDS, EYE_HEIGHT, HEALTH_MAX, lineOfSight, normalize, rayBody, safeZoneAt, type WeaponId, type Box2, type V3,
} from '../../shared/combat';
import type { GangInfo } from '../../server/src/gangs';

export interface CombatState { health: number; armour: number; licence: boolean; weapons: Partial<Record<WeaponId, { mag: number; reserve: number }>>; equipped: WeaponId | null; downedUntil: number; gang: GangInfo | null }
interface Host {
  socket: Socket; scene: THREE.Scene; camera: THREE.PerspectiveCamera; player: Character; pos: THREE.Vector2; rot: number; audio: AudioEngine;
  inCar: boolean; ride: unknown; seq: unknown; mode: string; inside: unknown; quality: string; me: { id: number };
  remotes: Map<number, { char: Character; x: number; z: number; cx: number; cz: number; snap: { inCar: boolean; ride?: unknown; down?: boolean }; aimT?: number; aimYaw?: number }>;
  world: { colliders: Box2[]; heightAt(x: number, z: number): number };
  controls: { camYaw: number; camPitch: number };
  toast: (m: string, k?: 'ok' | 'err' | 'info') => void;
  houseWeaponsAllowed(): boolean;
}
interface Fx { obj: THREE.Object3D; t: number; life: number; kind: 'tracer' | 'flash' | 'puff' }
interface Unit { char: Character; car: Car; x: number; z: number; rot: number; cx: number; cz: number; crot: number; mode: string; lights: THREE.Mesh[] }

const ZERO: CombatState = { health: HEALTH_MAX, armour: 0, licence: false, weapons: {}, equipped: null, downedUntil: 0, gang: null };
export class CombatClient {
  s: CombatState = { ...ZERO };
  aiming = false; firing = false;
  reloadUntil = 0; private lastFire = 0; private pending = false;
  bloom = 0; hitMark = 0; hitHead = false;
  aimMode: 'hold' | 'toggle' = (localStorage.getItem('bl_aim_mode') as 'hold' | 'toggle') ?? 'hold';
  crosshair = localStorage.getItem('bl_crosshair') !== '0';
  autoReload = localStorage.getItem('bl_auto_reload') !== '0';
  private fx: Fx[] = [];
  private flashLight?: THREE.PointLight;
  private units = new Map<number, Unit>();
  private tmp = new THREE.Vector3();
  onChange: () => void = () => {};
  /** last zone name that blocks weapons, for the HUD chip */
  zone: string | null = null;

  constructor(private g: Host) {
    if (g.quality !== 'low') { this.flashLight = new THREE.PointLight('#ffcf7a', 0, 9, 2); g.scene.add(this.flashLight); }
    const s = g.socket;
    s.on('combat:state', (st: CombatState) => { this.set(st); });
    s.on('combat:hurt', (e: { health: number; armour: number; dmg: number; head: boolean; fromName: string; fx: number; fz: number }) => {
      this.s.health = e.health; this.s.armour = e.armour; this.g.audio.hurt(); this.hurtFlash = 1; this.hurtFrom = Math.atan2(e.fx - this.g.pos.x, e.fz - this.g.pos.y); this.onChange();
    });
    s.on('combat:down', (e: { by: string | null; until: number; ms: number }) => {
      this.s.downedUntil = Date.now() + e.ms; this.s.health = 0; this.s.equipped = null; this.aiming = false; this.firing = false; this.g.player.setWeapon(null);
      this.g.toast(e.by ? `You were knocked down by ${e.by}. An ambulance is coming…` : 'You were knocked down', 'err'); this.onChange();
    });
    s.on('combat:downed-other', (e: { name: string }) => this.g.toast(`You knocked down ${e.name}`, 'info'));
    s.on('combat:respawn', (e: { fee: number; hospital: string }) => {
      this.s.downedUntil = 0; this.s.health = HEALTH_MAX; this.g.toast(`Treated at ${e.hospital}${e.fee ? ` — ₦${e.fee.toLocaleString()} hospital bill` : ''}`, 'info'); this.onChange();
    });
    s.on('combat:holster', (e: { zone: string }) => { this.s.equipped = null; this.aiming = false; this.g.player.setWeapon(null); this.g.toast(`🛡 ${e.zone} — weapons holstered`, 'info'); this.onChange(); });
    s.on('gun:shot', (e: { from: number; w: WeaponId; x: number; z: number; hits: { x: number; y: number; z: number; id: number | null }[] }) => this.remoteShot(e));
  }
  hurtFlash = 0; hurtFrom = 0;
  set(st: CombatState): void { this.s = { ...ZERO, ...st }; this.g.player.setWeapon(this.s.equipped); this.onChange(); }
  get downed(): boolean { return this.s.downedUntil > Date.now(); }
  get weapon(): WeaponId | null { return this.s.equipped; }
  get ammo(): { mag: number; reserve: number } | null { return this.s.equipped ? this.s.weapons[this.s.equipped] ?? null : null; }
  get reloading(): boolean { return performance.now() < this.reloadUntil; }
  owned(): WeaponId[] { return WEAPON_IDS.filter((w) => this.s.weapons[w]); }
  /** why weapons can't be used right now (null = they can) */
  blocked(): string | null {
    const g = this.g;
    if (g.mode !== 'play') return 'Not available yet';
    if (this.downed) return 'Wounded';
    if (g.inCar || g.ride || g.seq) return 'In a vehicle';
    if (g.inside && !g.houseWeaponsAllowed()) return 'Inside a house (owner has not allowed weapons)';
    return safeZoneAt(g.pos.x, g.pos.y);
  }
  async equip(id: WeaponId | null): Promise<void> {
    if (id && !this.s.weapons[id]) { this.g.toast('You don\'t own that weapon — visit Ekehuan Arms & Licensing', 'err'); return; }
    if (id) { const b = this.blocked(); if (b) { this.g.toast(`🛡 Weapons are disabled here — ${b}`, 'err'); return; } }
    const r = await emitAck<{ ok: boolean; error?: string; equipped?: WeaponId | null }>(this.g.socket, 'gun:equip', { id });
    if (!r.ok) { this.g.toast(r.error ?? 'Failed', 'err'); return; }
    this.s.equipped = r.equipped ?? null; if (!this.s.equipped) this.aiming = false;
    this.g.player.setWeapon(this.s.equipped); this.onChange();
  }
  cycle(): void {
    const list: (WeaponId | null)[] = [null, ...this.owned()];
    const i = list.indexOf(this.s.equipped); void this.equip(list[(i + 1) % list.length]!);
  }
  setAim(on: boolean): void {
    if (on && (!this.s.equipped || this.blocked())) return;
    this.aiming = on; if (!on) this.firing = false; this.onChange();
  }
  async reload(): Promise<void> {
    const w = this.s.equipped; const a = this.ammo; if (!w || !a || this.reloading) return;
    if (a.mag >= WEAPONS[w].mag) return;
    if (a.reserve <= 0) { this.g.toast('No spare ammunition — buy more at the gun shop', 'err'); this.g.audio.dryFire(); return; }
    const r = await emitAck<{ ok: boolean; error?: string; ms?: number; mag?: number; reserve?: number }>(this.g.socket, 'gun:reload');
    if (!r.ok) return;
    this.reloadUntil = performance.now() + (r.ms ?? 1500); this.g.audio.reloadSound(w, r.ms ?? 1500);
    setTimeout(() => { if (this.s.weapons[w]) this.s.weapons[w] = { mag: r.mag!, reserve: r.reserve! }; this.onChange(); }, r.ms ?? 1500);
    this.onChange();
  }

  /** where the crosshair points: camera ray → first wall / player / ground beyond the shooter */
  aimPoint(): V3 {
    const cam = this.g.camera; const o = cam.position; const d = cam.getWorldDirection(this.tmp).clone();
    const me = this.g.pos; const start = Math.max(0, (me.x - o.x) * d.x + (me.y - o.z) * d.z) + 0.6;
    let T = 120; if (d.y < -1e-3) T = Math.min(T, (this.g.world.heightAt(o.x, o.z) - o.y) / d.y);
    const from = { x: o.x + d.x * start, z: o.z + d.z * start };
    const end = { x: o.x + d.x * T, z: o.z + d.z * T };
    T = start + (T - start) * lineOfSight(from, end, this.g.world.colliders);
    const ov: V3 = { x: o.x, y: o.y, z: o.z }, dv: V3 = { x: d.x, y: d.y, z: d.z };
    for (const [, r] of this.g.remotes) {
      const inCar = r.snap.inCar || !!r.snap.ride; const x = inCar ? r.cx : r.x, z = inCar ? r.cz : r.z;
      const h = inCar ? rayBody(ov, dv, T, x, z, 0.52, 0.55, 1.05) : rayBody(ov, dv, T, x, z);
      if (h && h.t > start && h.t < T) T = h.t + 0.05;
    }
    return { x: o.x + d.x * T, y: o.y + d.y * T, z: o.z + d.z * T };
  }

  private async fire(): Promise<void> {
    const w = this.s.equipped; const a = this.ammo; if (!w || !a || this.pending) return;
    const def = WEAPONS[w]; const now = performance.now();
    if (now - this.lastFire < def.intervalMs || this.reloading) return;
    if (a.mag <= 0) { this.lastFire = now; this.g.audio.dryFire(); if (this.autoReload) void this.reload(); else this.g.toast('Empty — press R to reload', 'info'); return; }
    this.lastFire = now;
    const p = this.aimPoint(); const eye = { x: this.g.pos.x, y: this.g.world.heightAt(this.g.pos.x, this.g.pos.y) + EYE_HEIGHT, z: this.g.pos.y };
    const aim = normalize({ x: p.x - eye.x, y: p.y - eye.y, z: p.z - eye.z });
    // immediate local feedback (sound, flash, recoil); the server decides what was hit
    a.mag--; this.g.audio.gunshot(w, 0, 0); this.muzzleFlash(this.g.player);
    this.g.player.kick = 1; this.g.controls.camPitch = Math.min(1.2, this.g.controls.camPitch + def.recoil * (0.6 + Math.random() * 0.5));
    this.g.controls.camYaw += (Math.random() - 0.5) * def.recoil * 0.5; this.bloom = Math.min(1, this.bloom + def.recoil * 6);
    this.pending = true;
    const r = await emitAck<{ ok: boolean; error?: string; zone?: string; mag?: number; reserve?: number; hits?: { x: number; y: number; z: number; id: number | null; dmg: number; head: boolean }[] }>(this.g.socket, 'gun:fire', { aim });
    this.pending = false;
    if (!r.ok) {
      if (typeof r.mag === 'number') this.s.weapons[w] = { mag: r.mag, reserve: r.reserve ?? a.reserve };
      if (r.error === 'safe_zone') { this.s.equipped = null; this.aiming = false; this.g.player.setWeapon(null); this.g.toast(`🛡 ${r.zone} — weapons disabled`, 'err'); }
      this.onChange(); return;
    }
    this.s.weapons[w] = { mag: r.mag!, reserve: r.reserve! };
    const m = this.g.player.muzzleWorld(new THREE.Vector3());
    for (const h of r.hits ?? []) { this.tracer(m, h); this.puff(h, h.id !== null && h.dmg > 0); if (h.id !== null && h.dmg > 0) { this.hitMark = 1; this.hitHead = h.head; this.g.audio.hitMarker(h.head); } }
    this.onChange();
  }
  private remoteShot(e: { from: number; w: WeaponId; x: number; z: number; hits: { x: number; y: number; z: number; id: number | null }[] }): void {
    const r = this.g.remotes.get(e.from); const d = Math.hypot(e.x - this.g.pos.x, e.z - this.g.pos.y);
    const yaw = this.g.controls.camYaw; const ang = Math.atan2(e.x - this.g.pos.x, e.z - this.g.pos.y);
    this.g.audio.gunshot(e.w, d, -Math.sin(ang - yaw - Math.PI) * 0.8);
    if (!r) return;
    r.aimT = 1.2; const h0 = e.hits[0]; if (h0) r.aimYaw = Math.atan2(h0.x - r.x, h0.z - r.z);
    r.char.setWeapon(e.w); r.char.kick = 1;
    if (d < 140) { const m = r.char.muzzleWorld(new THREE.Vector3()); this.muzzleFlash(r.char); for (const h of e.hits) { this.tracer(m, h); this.puff(h, h.id !== null); } }
  }

  // ---- effects ----
  private muzzleFlash(ch: Character): void {
    const p = ch.muzzleWorld(new THREE.Vector3());
    const sp = new THREE.Sprite(flashMat()); sp.position.copy(p); sp.scale.setScalar(0.35 + Math.random() * 0.15); this.g.scene.add(sp);
    this.fx.push({ obj: sp, t: 0, life: 0.05, kind: 'flash' });
    if (this.flashLight) { this.flashLight.position.copy(p); this.flashLight.intensity = 6; }
  }
  private tracer(from: THREE.Vector3, to: V3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), new THREE.Vector3(to.x, to.y, to.z)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0.85 }));
    this.g.scene.add(line); this.fx.push({ obj: line, t: 0, life: 0.07, kind: 'tracer' });
  }
  private puff(p: V3, body: boolean): void {
    const sp = new THREE.Sprite(puffMat(body)); sp.position.set(p.x, Math.max(0.05, p.y), p.z); sp.scale.setScalar(body ? 0.25 : 0.32); this.g.scene.add(sp);
    this.fx.push({ obj: sp, t: 0, life: body ? 0.25 : 0.45, kind: 'puff' });
  }

  update(dt: number): void {
    const g = this.g;
    this.zone = this.s.equipped || this.owned().length ? this.blocked() : null;
    if (this.aiming && (!this.s.equipped || this.blocked())) this.setAim(false);
    if (this.firing && this.aiming) void this.fire();
    this.bloom = Math.max(0, this.bloom - dt * 2.2); this.hitMark = Math.max(0, this.hitMark - dt * 4); this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    if (this.flashLight) this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 120);
    // own avatar pose
    const p = g.player; p.aim += ((this.aiming ? 1 : 0) - p.aim) * (1 - Math.exp(-dt * 14));
    p.aimPitch = -g.controls.camPitch + 0.18;
    p.downed += ((this.downed ? 1 : 0) - p.downed) * (1 - Math.exp(-dt * 5));
    // remote poses
    for (const [, r] of g.remotes) {
      r.aimT = Math.max(0, (r.aimT ?? 0) - dt);
      r.char.aim += ((r.aimT > 0 ? 1 : 0) - r.char.aim) * (1 - Math.exp(-dt * 10));
      r.char.downed += ((r.snap.down ? 1 : 0) - r.char.downed) * (1 - Math.exp(-dt * 5));
    }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!; f.t += dt; const k = 1 - f.t / f.life;
      if (k <= 0) { g.scene.remove(f.obj); disposeFx(f.obj); this.fx.splice(i, 1); continue; }
      const m = (f.obj as THREE.Sprite | THREE.Line).material as THREE.Material & { opacity: number };
      m.opacity = f.kind === 'puff' ? k * 0.8 : k; if (f.kind === 'puff') f.obj.scale.multiplyScalar(1 + dt * 2.5);
    }
  }

  /** police response units from the server snapshot */
  updatePolice(list: { id: number; x: number; z: number; rot: number; mode: string; cx: number; cz: number; crot: number }[], dt: number, t: number): void {
    const seen = new Set<number>();
    for (const u of list) {
      seen.add(u.id); let v = this.units.get(u.id);
      if (!v) {
        const char = new Character({ body: 'male', skin: (u.id * 3) % 5 + 1, outfit: 4 }, { style: 'police' }); char.setNameTag('POLICE');
        const car = new Car('#141c2e', { body: 'pickup' });
        const lights: THREE.Mesh[] = [];
        for (const [c, x] of [['#ff2a2a', -0.35], ['#2a5bff', 0.35]] as const) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1 })); m.position.set(x, 1.95, -0.2); car.group.add(m); lights.push(m); }
        this.g.scene.add(char.group, car.group);
        v = { char, car, x: u.x, z: u.z, rot: u.rot, cx: u.cx, cz: u.cz, crot: u.crot, mode: u.mode, lights }; this.units.set(u.id, v);
      }
      const k = 1 - Math.exp(-dt * 8), px = v.x, pz = v.z;
      v.x += (u.x - v.x) * k; v.z += (u.z - v.z) * k; v.cx += (u.cx - v.cx) * k; v.cz += (u.cz - v.cz) * k;
      v.rot += Math.atan2(Math.sin(u.rot - v.rot), Math.cos(u.rot - v.rot)) * k; v.crot += Math.atan2(Math.sin(u.crot - v.crot), Math.cos(u.crot - v.crot)) * k; v.mode = u.mode;
      const sp = dt > 0 ? Math.hypot(v.x - px, v.z - pz) / dt : 0;
      v.car.group.position.set(v.cx, this.g.world.heightAt(v.cx, v.cz), v.cz); v.car.group.rotation.y = v.crot;
      v.car.updateWheels(v.mode === 'car' ? sp : 0, 0, dt);
      v.char.group.visible = v.mode === 'foot';
      if (v.mode === 'foot') { v.char.group.position.set(v.x, this.g.world.heightAt(v.x, v.z), v.z); v.char.group.rotation.y = v.rot; v.char.animate(dt, sp); }
      const on = Math.floor(t * 6) % 2 === 0; v.lights[0]!.visible = on; v.lights[1]!.visible = !on;
    }
    for (const [id, v] of this.units) if (!seen.has(id)) { this.g.scene.remove(v.char.group, v.car.group); this.units.delete(id); }
  }
  get unitCount(): number { return this.units.size; }
}

let _flash: THREE.SpriteMaterial | null = null; const _puff: Record<string, THREE.SpriteMaterial> = {};
function radial(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!;
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(1, outer); x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function flashMat(): THREE.SpriteMaterial { _flash ??= new THREE.SpriteMaterial({ map: radial('rgba(255,240,200,1)', 'rgba(255,140,30,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }); return _flash.clone(); }
function puffMat(body: boolean): THREE.SpriteMaterial {
  const k = body ? 'b' : 'd';
  _puff[k] ??= new THREE.SpriteMaterial({ map: radial(body ? 'rgba(120,10,10,0.9)' : 'rgba(170,160,145,0.9)', 'rgba(120,110,100,0)'), depthWrite: false, transparent: true });
  return _puff[k]!.clone();
}
function disposeFx(o: THREE.Object3D): void {
  const m = o as THREE.Line; if (m.geometry && !(o instanceof THREE.Sprite)) m.geometry.dispose();
  (m.material as THREE.Material).dispose();
}
