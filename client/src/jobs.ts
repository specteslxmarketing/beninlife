// Client side of the taxi + station jobs (car-wash attendant, mechanic). All checks and payments happen on the server;
// this module draws the passenger / customer cars / markers and drives the "work" animation + progress.
import * as THREE from 'three';
import { CAR_MODELS, STATION_JOBS, STATION_RADIUS, TAXI_RADIUS, stationSpot, type StationJob } from '../../shared/constants';
import { Character } from './character';
import { Car } from './car';
import { emitAck, naira } from './net';
import type { Game } from './game';
import type { AABB } from './world';

type Stop = { name: string; x: number; z: number };
export interface TaxiJob { stage: 'to_pickup' | 'riding'; passenger: string; pickup: Stop; dest?: Stop; fare?: number }
export interface StationShift { id: StationJob['id']; done: boolean[]; cars: number; readyAt: number }
type Act = { id: string; label: string; key: string };

export class JobsClient {
  taxi: TaxiJob | null = null;
  station: StationShift | null = null;
  working: { i: number; t: number; dur: number } | null = null;
  private passengerNpc?: Character;
  private dropNpc?: { c: Character; t: number };
  private taxiMarker: THREE.Group;
  private spotRings: THREE.Mesh[] = [];
  private customer?: { car: Car; collider: AABB; leaving: number; smoke: THREE.Mesh[] };
  onProgress: (p: number | null, label?: string) => void = () => {};

  constructor(private g: Game) {
    this.taxiMarker = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color: '#3fa0ff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.8, 40, 1, true), m); ring.position.y = 0.4; this.taxiMarker.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#3fa0ff', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.y = 15; this.taxiMarker.add(beam); this.taxiMarker.visible = false; g.scene.add(this.taxiMarker);
    const rm = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.8, depthWrite: false });
    for (let i = 0; i < 4; i++) { const r = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32), rm); r.rotation.x = -Math.PI / 2; r.visible = false; g.scene.add(r); this.spotRings.push(r); }
  }

  get active(): boolean { return !!(this.taxi || this.station); }

  // ---------------- taxi ----------------
  async startTaxi(): Promise<void> {
    const r = await emitAck<{ ok: boolean; error?: string; passenger: string; pickup: Stop }>(this.g.socket, 'job:taxi:start');
    if (!r.ok) { this.g.toast(r.error ?? 'Failed', 'err'); return; }
    this.taxi = { stage: 'to_pickup', passenger: r.passenger, pickup: r.pickup };
    this.g.toast(`🚕 Taxi: ${r.passenger} is waiting at ${r.pickup.name} (blue marker)`, 'ok'); this.g.audio.message();
    this.showPassenger(r.pickup);
  }
  async stopTaxi(): Promise<void> {
    await emitAck(this.g.socket, 'job:taxi:stop'); this.taxi = null; this.hidePassenger(); this.g.toast('🚕 Taxi shift ended', 'info');
  }
  private showPassenger(p: Stop): void {
    if (!this.passengerNpc) {
      const r = Math.random();
      this.passengerNpc = new Character({ body: r < 0.5 ? 'female' : 'male', skin: Math.floor(r * 7) % 6, outfit: Math.floor(r * 13) % 6 });
      this.passengerNpc.group.traverse((o) => { o.castShadow = this.g.quality !== 'low'; });
      this.g.scene.add(this.passengerNpc.group);
    }
    const n = this.passengerNpc; n.group.visible = true; n.wave = 1;
    n.setNameTag(this.taxi?.passenger ?? 'Passenger');
    n.group.position.set(p.x + Math.sign(p.x || 1) * 0.6, this.g.world.heightAt(p.x, p.z), p.z + Math.sign(p.z || 1) * 0.6);
  }
  private hidePassenger(): void { if (this.passengerNpc) this.passengerNpc.group.visible = false; }

  // ---------------- station jobs ----------------
  async startShift(id: StationJob['id']): Promise<void> {
    const r = await emitAck<{ ok: boolean; error?: string; done: boolean[] }>(this.g.socket, 'job:station:start', { id });
    if (!r.ok) { this.g.toast(r.error ?? 'Failed', 'err'); return; }
    this.station = { id, done: r.done, cars: 0, readyAt: performance.now() };
    const j = STATION_JOBS[id];
    this.g.toast(`🧰 Shift started: ${j.name}. Walk to the glowing spots around the car and press F.`, 'ok');
    this.spawnCustomer();
  }
  async stopShift(): Promise<void> {
    const r = await emitAck<{ ok: boolean; cars: number }>(this.g.socket, 'job:station:stop');
    const j = this.station ? STATION_JOBS[this.station.id] : null;
    this.station = null; this.working = null; this.onProgress(null); this.removeCustomer(true);
    if (j) this.g.toast(`Shift over — ${r.cars ?? 0} car(s) done at ${j.place}`, 'info');
  }
  private spawnCustomer(): void {
    if (!this.station) return;
    const j = STATION_JOBS[this.station.id];
    const m = CAR_MODELS[Math.floor(Math.random() * CAR_MODELS.length)];
    const car = new Car(m.colors[Math.floor(Math.random() * m.colors.length)], { body: m.body, scale: m.scale, model: m.id });
    car.group.position.set(j.car.x, 0, j.car.z); car.group.rotation.y = j.car.rot;
    car.setDirt(j.id === 'carwash' ? 0.95 : 0.35);
    car.group.traverse((o) => { o.castShadow = this.g.quality !== 'low'; });
    this.g.scene.add(car.group);
    const ew = Math.abs(Math.sin(j.car.rot)) > 0.7; const L = car.length * 0.5 + 0.1, W = 1.0;
    const collider: AABB = { minX: j.car.x - (ew ? L : W), maxX: j.car.x + (ew ? L : W), minZ: j.car.z - (ew ? W : L), maxZ: j.car.z + (ew ? W : L) };
    this.g.world.colliders.push(collider);
    const smoke: THREE.Mesh[] = [];
    if (j.id === 'mechanic') { // engine trouble: grey smoke from under the bonnet until fixed
      const sm = new THREE.MeshBasicMaterial({ color: '#bbbbbb', transparent: true, opacity: 0.35, depthWrite: false });
      for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), sm); s.userData.k = k; this.g.scene.add(s); smoke.push(s); }
    }
    this.customer = { car, collider, leaving: 0, smoke };
  }
  private removeCustomer(now = false): void {
    const c = this.customer; if (!c) return;
    this.g.world.colliders = this.g.world.colliders.filter((x) => x !== c.collider);
    if (now) { this.g.scene.remove(c.car.group); for (const s of c.smoke) this.g.scene.remove(s); this.customer = undefined; }
    else c.leaving = 0.001;
  }
  private async finishWork(i: number): Promise<void> {
    const r = await emitAck<{ ok: boolean; error?: string; done: boolean[]; finished: boolean; paid: number; cars: number }>(this.g.socket, 'job:station:work', { i });
    if (!this.station) return;
    if (!r.ok) { this.g.toast(r.error ?? 'Failed', 'err'); return; }
    this.station.done = r.done; this.station.cars = r.cars;
    const j = STATION_JOBS[this.station.id];
    if (j.id === 'carwash' && this.customer) this.customer.car.setDirt(Math.max(0, 0.95 - 0.24 * r.done.filter(Boolean).length - (r.finished ? 1 : 0)));
    if (j.id === 'mechanic' && i === 0 && this.customer) for (const s of this.customer.smoke) s.visible = false;
    if (r.finished) {
      this.g.toast(`✅ Customer happy — paid ${naira(r.paid)} (${r.cars} car${r.cars > 1 ? 's' : ''} this shift)`, 'ok');
      this.removeCustomer(); this.station.readyAt = performance.now() + 4000;
    } else this.g.toast(`✔ ${j.spots[i].label}`, 'info');
  }

  // ---------------- per-frame ----------------
  actions(): Act[] {
    const out: Act[] = []; const g = this.g;
    const p = g.inCar ? { x: g.carState.x, z: g.carState.z } : { x: g.pos.x, z: g.pos.y };
    if (this.taxi && g.inCar) {
      const t = this.taxi;
      if (t.stage === 'to_pickup' && Math.hypot(p.x - t.pickup.x, p.z - t.pickup.z) < TAXI_RADIUS - 0.5) out.push({ id: 'taxi:pickup', label: `Pick up ${t.passenger}`, key: 'F' });
      if (t.stage === 'riding' && t.dest && Math.hypot(p.x - t.dest.x, p.z - t.dest.z) < TAXI_RADIUS - 0.5) out.push({ id: 'taxi:dropoff', label: `Drop off ${t.passenger} · ${naira(t.fare ?? 0)}`, key: 'F' });
    }
    if (!g.inCar && !this.taxi && !g.job) {
      if (!this.station) {
        for (const j of Object.values(STATION_JOBS)) if (Math.hypot(p.x - j.start.x, p.z - j.start.z) < j.startRadius - 0.3) out.push({ id: `station:start:${j.id}`, label: `Start shift: ${j.name} (${naira(j.pay)}/car)`, key: 'F' });
      } else {
        const j = STATION_JOBS[this.station.id];
        if (!this.working && performance.now() >= this.station.readyAt && this.customer && !this.customer.leaving) {
          j.spots.forEach((s, i) => { const sp = stationSpot(j, i); if (!this.station!.done[i] && Math.hypot(p.x - sp.x, p.z - sp.z) < STATION_RADIUS - 0.2) out.push({ id: `station:work:${i}`, label: s.label, key: 'F' }); });
        }
        if (Math.hypot(p.x - j.start.x, p.z - j.start.z) < j.startRadius) out.push({ id: 'station:stop', label: 'End shift', key: 'G' });
      }
    }
    return out;
  }
  async action(id: string): Promise<void> {
    const g = this.g;
    if (id === 'taxi:pickup') {
      const r = await emitAck<{ ok: boolean; error?: string; dest: Stop; fare: number }>(g.socket, 'job:taxi:pickup');
      if (!r.ok || !this.taxi) { g.toast(r.error ?? 'Failed', 'err'); return; }
      this.taxi = { ...this.taxi, stage: 'riding', dest: r.dest, fare: r.fare }; this.hidePassenger(); g.audio.carDoor();
      g.toast(`🚕 ${this.taxi.passenger}: "Take me to ${r.dest.name}, abeg." Fare ${naira(r.fare)}`, 'ok');
    } else if (id === 'taxi:dropoff') {
      const r = await emitAck<{ ok: boolean; error?: string; fare: number; tip: number }>(g.socket, 'job:taxi:dropoff');
      if (!r.ok || !this.taxi) { g.toast(r.error ?? 'Failed', 'err'); return; }
      g.audio.carDoor();
      const who = this.taxi.passenger, at = this.taxi.dest!;
      g.toast(`💵 ${who} paid ${naira(r.fare)}${r.tip ? ` + ${naira(r.tip)} tip for the clean car` : ''}. Next fare coming…`, 'ok');
      this.taxi = null;
      if (this.passengerNpc) { const n = this.passengerNpc; n.wave = 0; n.group.visible = true; n.group.position.set(at.x + Math.sign(at.x || 1) * 1.2, g.world.heightAt(at.x, at.z), at.z + Math.sign(at.z || 1) * 1.2); this.dropNpc = { c: n, t: 4 }; }
      setTimeout(() => { if (g.inCar && !this.active) void this.startTaxi(); }, 3500); // keep the shift going while in the car
    } else if (id.startsWith('station:start:')) {
      await this.startShift(id.split(':')[2] as StationJob['id']);
    } else if (id === 'station:stop') {
      await this.stopShift();
    } else if (id.startsWith('station:work:') && this.station) {
      const i = Number(id.split(':')[2]); const j = STATION_JOBS[this.station.id];
      this.working = { i, t: 0, dur: j.workMs / 1000 };
      const sp = stationSpot(j, i); g.rot = Math.atan2(j.car.x - sp.x, j.car.z - sp.z); // face the car
    }
  }
  update(dt: number): void {
    const g = this.g, t = performance.now() / 1000;
    // taxi marker + passenger idle
    const tgt = this.taxi ? (this.taxi.stage === 'to_pickup' ? this.taxi.pickup : this.taxi.dest) : null;
    this.taxiMarker.visible = !!tgt && g.mode === 'play';
    if (tgt) this.taxiMarker.position.set(tgt.x, 0, tgt.z);
    if (this.passengerNpc?.group.visible) {
      const n = this.passengerNpc; n.headLook = Math.sin(t * 0.7) * 0.4; n.animate(dt, 0);
      if (this.dropNpc) { this.dropNpc.t -= dt; n.group.position.x += Math.sign(n.group.position.x || 1) * dt * 1.2; n.animate(dt, 1.4); if (this.dropNpc.t <= 0) { n.group.visible = false; this.dropNpc = undefined; } }
      else { const dx = g.pos.x - n.group.position.x, dz = g.pos.y - n.group.position.z; n.group.rotation.y = Math.atan2(dx, dz); }
    }
    // station: spot rings, customer car comes/goes, smoke
    const st = this.station; const j = st ? STATION_JOBS[st.id] : null;
    this.spotRings.forEach((r, i) => {
      const show = !!(st && j && this.customer && !this.customer.leaving && !st.done[i] && performance.now() >= st.readyAt);
      r.visible = show; if (show) { const sp = stationSpot(j!, i); r.position.set(sp.x, 0.06, sp.z); r.scale.setScalar(1 + Math.sin(t * 4 + i) * 0.08); }
    });
    if (this.customer) {
      const c = this.customer;
      if (c.leaving > 0 && j) { c.leaving += dt; const f = Math.sin(j.car.rot), k = Math.cos(j.car.rot), d = c.leaving * c.leaving * 2.2;
        c.car.group.position.set(j.car.x + f * d, 0, j.car.z + k * d); c.car.updateWheels(c.leaving * 4.4, 0, dt);
        if (c.leaving > 3.2) { this.removeCustomer(true); } }
      c.smoke.forEach((s) => { if (!j || !s.visible) return; const k = s.userData.k as number; const ph = (t * 0.6 + k / 6) % 1;
        s.position.set(j.car.x + Math.sin(j.car.rot) * 1.6 + Math.sin(k * 2) * 0.2, 1.0 + ph * 1.6, j.car.z + Math.cos(j.car.rot) * 1.6); s.scale.setScalar(0.6 + ph * 1.6); (s.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - ph); });
    }
    if (st && !this.customer && performance.now() >= st.readyAt - 1500) this.spawnCustomer();
    // working animation + progress
    if (this.working && st && j) {
      this.working.t += dt; g.player.working = Math.min(1, g.player.working + dt * 4);
      this.onProgress(this.working.t / this.working.dur, j.spots[this.working.i].label);
      const sp = stationSpot(j, this.working.i);
      if (Math.hypot(g.pos.x - sp.x, g.pos.y - sp.z) > STATION_RADIUS) { this.working = null; this.onProgress(null); g.toast('Stay at the spot to finish the task', 'err'); }
      else if (this.working.t >= this.working.dur) { const i = this.working.i; this.working = null; this.onProgress(null); void this.finishWork(i); }
    } else g.player.working = Math.max(0, g.player.working - dt * 4);
  }
  objective(): string | null {
    const g = this.g; const p = g.inCar ? { x: g.carState.x, z: g.carState.z } : { x: g.pos.x, z: g.pos.y };
    const m = (s: Stop) => Math.round(Math.hypot(p.x - s.x, p.z - s.z));
    if (this.taxi) {
      if (!g.inCar) return `🚕 Taxi: get back in your car — ${this.taxi.passenger} is waiting`;
      return this.taxi.stage === 'to_pickup' ? `🚕 Pick up ${this.taxi.passenger} at ${this.taxi.pickup.name} (${m(this.taxi.pickup)} m) — blue marker`
        : `🚕 Take ${this.taxi.passenger} to ${this.taxi.dest!.name} (${m(this.taxi.dest!)} m) — fare ${naira(this.taxi.fare ?? 0)}`;
    }
    if (this.station) {
      const j = STATION_JOBS[this.station.id]; const left = j.spots.filter((_, i) => !this.station!.done[i]);
      if (!this.customer || this.customer.leaving || performance.now() < this.station.readyAt) return `🧰 ${j.name}: next customer pulling in… (${this.station.cars} done)`;
      return `🧰 ${j.name}: ${left.map((s) => s.label).join(' · ')} — ${this.station.cars} car(s) done · ${naira(j.pay)}/car`;
    }
    return null;
  }
}
