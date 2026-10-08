// Light ambient life: a handful of traffic cars and pedestrians per city (the world is meant to be filled by real players).
// Client-side and purely cosmetic: cars follow right-hand lanes, circulate the Ring Road roundabout anticlockwise,
// obey the roundabout traffic lights (synced to server time, so every player sees the same phase), slow and weave
// through police checkpoints, and stop for players, player cars and each other. Pedestrians stroll the sidewalks and
// the Lagos promenade/beach. Cars have dynamic colliders so the local player can't walk or drive through them.
import * as THREE from 'three';
import type { World } from './world';
import { Car } from './car';
import { Character } from './character';
import { lightState, LAGOS, POLICE_CHECKPOINTS, SKIN_TONES, type OutfitStyle, type Appearance, type BodyType } from '../../shared/constants';

type V = { x: number; z: number };
type AABB = { minX: number; maxX: number; minZ: number; maxZ: number };
/** a point on a car path; `stop` marks a traffic-light stop line for arm axis 0 (E/W) or 1 (N/S) */
type PathPt = V & { stop?: 0 | 1; slow?: boolean };


const LANE = 3.5, RING_R = 22.5, ARM_END = 174, STOP_D = 41;
const ARMS: { u: V; axis: 0 | 1 }[] = [{ u: { x: 1, z: 0 }, axis: 0 }, { u: { x: 0, z: -1 }, axis: 1 }, { u: { x: -1, z: 0 }, axis: 0 }, { u: { x: 0, z: 1 }, axis: 1 }];
const rnd = (() => { let s = 12345; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

/** lane offset near a checkpoint (drums narrow the road): squeeze towards the centre line */
function laneAt(p: V): number {
  for (const c of POLICE_CHECKPOINTS) if (Math.hypot(p.x - c.x, p.z - c.z) < 16) return 1.9;
  return LANE;
}
function nearCheckpoint(p: V): boolean { return POLICE_CHECKPOINTS.some((c) => Math.hypot(p.x - c.x, p.z - c.z) < 20); }

/** Benin trip: inbound on arm a → anticlockwise round the ring → outbound on arm b → U-turn at the end */
function beninTrip(a: number, b: number): PathPt[] {
  const pts: PathPt[] = [];
  const A = ARMS[a].u, B = ARMS[b].u;
  const rin = { x: A.z, z: -A.x }, rout = { x: -B.z, z: B.x };
  const dIn = Math.sqrt(RING_R ** 2 - LANE ** 2);
  for (let d = ARM_END; d > dIn; d -= 2) {
    const c = { x: A.x * d, z: A.z * d }, o = laneAt(c);
    pts.push({ x: c.x + rin.x * o, z: c.z + rin.z * o, slow: nearCheckpoint(c), ...(d <= STOP_D && d > STOP_D - 2 ? { stop: ARMS[a].axis } : {}) });
  }
  const p0 = { x: A.x * dIn + rin.x * LANE, z: A.z * dIn + rin.z * LANE }, p1 = { x: B.x * dIn + rout.x * LANE, z: B.z * dIn + rout.z * LANE };
  const a0 = Math.atan2(p0.z, p0.x); let a1 = Math.atan2(p1.z, p1.x);
  while (a1 > a0 - 0.3) a1 -= Math.PI * 2; // anticlockwise (seen from above with north up) = decreasing angle
  for (let k = 1; k < 24; k++) { const an = a0 + (a1 - a0) * (k / 24); pts.push({ x: Math.cos(an) * RING_R, z: Math.sin(an) * RING_R }); }
  for (let d = dIn; d < ARM_END; d += 2) { const c = { x: B.x * d, z: B.z * d }, o = laneAt(c); pts.push({ x: c.x + rout.x * o, z: c.z + rout.z * o, slow: nearCheckpoint(c) }); }
  // U-turn (left, across to the inbound lane)
  const cx = B.x * ARM_END, cz = B.z * ARM_END, s0 = Math.atan2(rout.z, rout.x);
  for (let k = 1; k <= 10; k++) { const an = s0 + (Math.PI * k) / 10 * -1; pts.push({ x: cx + Math.cos(an) * LANE, z: cz + Math.sin(an) * LANE, slow: true }); }
  return pts;
}
/** Lagos loop: westbound on the north carriageway, U-turn, eastbound on the south carriageway, U-turn */
function lagosLoop(): PathPt[] {
  const X = LAGOS.x, pts: PathPt[] = [], cz = 32.25, r = 6.75;
  for (let x = 170; x > -170; x -= 3) pts.push({ x: X + x, z: 25.5 });
  for (let k = 0; k <= 12; k++) { const an = -Math.PI / 2 - (Math.PI * k) / 12; pts.push({ x: X - 170 + Math.cos(an) * r, z: cz + Math.sin(an) * r, slow: true }); }
  for (let x = -170; x < 170; x += 3) pts.push({ x: X + x, z: 39 });
  for (let k = 0; k <= 12; k++) { const an = Math.PI / 2 - (Math.PI * k) / 12; pts.push({ x: X + 170 + Math.cos(an) * r, z: cz + Math.sin(an) * r, slow: true }); }
  return pts;
}

class AmbientCar {
  car: Car; path: PathPt[] = []; i = 0; f = 0; speed = 0; rot = 0; prevRot = 0; steer = 0; x = 0; z = 0; arm = 0;
  box: AABB = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  constructor(color: string, body: BodyType, public city: 'benin' | 'lagos', scale?: number, model?: string) {
    this.car = new Car(color, { body, scale, model }); this.car.setDirt(rnd() * 0.4);
    if (body === 'okada' || body === 'keke') { // visible rider / driver
      const ch = new Character({ body: 'male', skin: Math.floor(rnd() * 4), outfit: Math.floor(rnd() * 8) }, { style: rnd() < 0.5 ? 'casual' : 'ankara' });
      ch.pose = 'sit'; ch.animate(0.016, 0);
      ch.group.position.set(0, body === 'okada' ? 0.36 : 0.5, body === 'okada' ? -0.18 : 0.15);
      this.car.mount(ch.group);
    }
  }
  get L(): number { return this.car.length; }
}

interface Walker { ch: Character; a: V; b: V; t: number; dir: 1 | -1; speed: number; pause: number; city: 'benin' | 'lagos'; x: number; z: number; rot: number }

export class Ambient {
  cars: AmbientCar[] = [];
  walkers: Walker[] = [];
  private lamps: THREE.MeshStandardMaterial[][] = []; // [axis][red, amber, green]
  private group = new THREE.Group();
  enabled = true;
  constructor(private world: World, quality: 'low' | 'medium' | 'high') {
    world.scene.add(this.group);
    const n = quality === 'low' ? { bc: 3, bp: 3, lc: 2, lp: 2 } : quality === 'medium' ? { bc: 6, bp: 5, lc: 4, lp: 3 } : { bc: 8, bp: 6, lc: 5, lp: 4 };
    this.trafficLights();
    const fleet: [string, BodyType, number | undefined, string][] = [['#d9d9d4', 'sedan', undefined, 'corolla'], ['#f2c230', 'keke', undefined, 'keke'], ['#f2c230', 'sedan', undefined, 'camry_muscle'], ['#1d2e4a', 'suv', undefined, 'glk'], ['#7a1d1d', 'okada', undefined, 'okada'], ['#f4c20d', 'bus', 1.0, 'hiace'], ['#5b6770', 'minivan', undefined, 'sienna'], ['#e9e9e4', 'pickup', undefined, 'hilux'], ['#2a2a2c', 'suv', undefined, 'rx350']];
    for (let k = 0; k < n.bc; k++) {
      const [c, b, s, m] = fleet[k % fleet.length], car = new AmbientCar(c, b, 'benin', s, m);
      const exit = (k % 4 + 1 + (k % 3)) % 4; car.path = beninTrip(k % 4, exit); car.arm = exit; car.i = Math.floor((k * 37) % Math.max(1, car.path.length - 40));
      this.addCar(car);
    }
    const loop = lagosLoop();
    for (let k = 0; k < n.lc; k++) {
      const [c, b, s, m] = fleet[(k * 2 + 3) % fleet.length], car = new AmbientCar(c, b, 'lagos', s, m);
      car.path = loop; car.i = Math.floor((k / n.lc) * loop.length); this.addCar(car);
    }
    // pedestrians
    const styles: OutfitStyle[] = ['casual', 'ankara', 'casual', 'senator', 'casual', 'ankara'];
    const walkerAt = (a: V, b: V, city: 'benin' | 'lagos', k: number) => {
      const app: Appearance = { body: k % 2 ? 'female' : 'male', skin: Math.floor(rnd() * Math.min(4, SKIN_TONES.length)), outfit: Math.floor(rnd() * 8) };
      const ch = new Character(app, { style: styles[k % styles.length] });
      this.group.add(ch.group);
      this.walkers.push({ ch, a, b, t: rnd(), dir: rnd() < 0.5 ? 1 : -1, speed: 1.1 + rnd() * 0.4, pause: 0, city, x: a.x, z: a.z, rot: 0 });
    };
    const side = 9.35;
    for (let k = 0; k < n.bp; k++) {
      const A = ARMS[k % 4].u, s = k % 2 ? 1 : -1, r = { x: A.z * s * side, z: -A.x * s * side };
      walkerAt({ x: A.x * 40 + r.x, z: A.z * 40 + r.z }, { x: A.x * 172 + r.x, z: A.z * 172 + r.z }, 'benin', k);
    }
    const lag: [V, V][] = [[{ x: -150, z: 44.5 }, { x: 150, z: 44.5 }], [{ x: -160, z: 20.5 }, { x: 160, z: 20.5 }], [{ x: -120, z: 70 }, { x: 110, z: 84 }], [{ x: -80, z: 45 }, { x: 170, z: 45 }]];
    for (let k = 0; k < n.lp; k++) { const [a, b] = lag[k % lag.length]; walkerAt({ x: LAGOS.x + a.x, z: a.z }, { x: LAGOS.x + b.x, z: b.z }, 'lagos', k + 1); }
  }

  private addCar(c: AmbientCar): void {
    this.cars.push(c); this.group.add(c.car.group); this.world.colliders.push(c.box);
    const p = c.path[c.i]; c.x = p.x; c.z = p.z; this.place(c);
  }

  /** a signal head on each roundabout arm, at the stop line on the right of the incoming lane */
  private trafficLights(): void {
    const mk = (col: string) => new THREE.MeshStandardMaterial({ color: '#111', emissive: col, emissiveIntensity: 0, roughness: 0.4 });
    this.lamps = [[mk('#ff2a1a'), mk('#ffb21a'), mk('#2aff6a')], [mk('#ff2a1a'), mk('#ffb21a'), mk('#2aff6a')]];
    const pole = new THREE.MeshStandardMaterial({ color: '#2b2e31', metalness: 0.6, roughness: 0.5 });
    const housing = new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.6 });
    const lampGeo = new THREE.SphereGeometry(0.13, 12, 8);
    for (const arm of ARMS) {
      const u = arm.u, rin = { x: u.z, z: -u.x }, d = STOP_D - 2;
      const g = new THREE.Group(); g.position.set(u.x * d + rin.x * 8.4, 0, u.z * d + rin.z * 8.4); g.rotation.y = Math.atan2(u.x, u.z); // faces incoming traffic
      this.group.add(g);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 5.2, 8), pole); p.position.y = 2.6; g.add(p);
      // mast arm reaching over the lane
      const armDir = new THREE.Vector3(-rin.x, 0, -rin.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -g.rotation.y);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 5, 6), pole); m.rotation.z = Math.PI / 2; m.rotation.y = Math.atan2(-armDir.z, armDir.x); m.position.set(armDir.x * 2.5, 5.1, armDir.z * 2.5); g.add(m);
      for (const [hx, hz, hy] of [[armDir.x * 4.9, armDir.z * 4.9, 4.55], [0, 0, 2.9]]) {
        const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.2, 0.3), housing); h.position.set(hx, hy, hz); g.add(h);
        this.lamps[arm.axis].forEach((mat, li) => { const l = new THREE.Mesh(lampGeo, mat); l.position.set(hx, hy + 0.36 - li * 0.36, hz + 0.16); g.add(l); });
      }
      this.world.collide(g.position.x, g.position.z, 0.3, 0.3);
    }
  }

  private place(c: AmbientCar): void {
    c.car.group.position.set(c.x, 0, c.z); c.car.group.rotation.y = c.rot;
    const hl = c.L / 2 + 0.2, hw = c.car.body === 'okada' ? 0.45 : c.car.body === 'keke' ? 0.75 : 1.05, s = Math.abs(Math.sin(c.rot)), co = Math.abs(Math.cos(c.rot));
    const ex = s * hl + co * hw, ez = co * hl + s * hw;
    c.box.minX = c.x - ex; c.box.maxX = c.x + ex; c.box.minZ = c.z - ez; c.box.maxZ = c.z + ez;
  }

  /** obstacles: local player/car, remote players/cars, other ambient cars */
  /** settings toggle: hide everything and drop the dynamic colliders */
  setEnabled(on: boolean): void {
    this.enabled = on; this.group.visible = on;
    if (!on) for (const c of this.cars) { c.box.minX = c.box.maxX = c.box.minZ = c.box.maxZ = 1e6; }
  }

  /** t = server-synced clock in seconds (traffic-light phase is identical for every player) */
  update(dt: number, ctx: { t: number; focus: V; obstacles: V[]; night: number; wet: number; hidden: boolean }): void {
    if (!this.enabled) return;
    const t = ctx.t;
    for (const axis of [0, 1] as const) {
      const st = lightState(axis, t), on = ctx.hidden ? 0 : 2.6;
      this.lamps[axis][0].emissiveIntensity = st === 'red' ? on : 0; this.lamps[axis][1].emissiveIntensity = st === 'amber' ? on : 0; this.lamps[axis][2].emissiveIntensity = st === 'green' ? on : 0;
    }
    const city = ctx.focus.x > 1000 ? 'lagos' : 'benin';
    this.group.visible = !ctx.hidden;
    for (const c of this.cars) this.driveCar(c, dt, t, ctx, city);
    for (const w of this.walkers) this.walk(w, dt, ctx, city);
  }

  private driveCar(c: AmbientCar, dt: number, t: number, ctx: { t: number; focus: V; obstacles: V[]; night: number; wet: number; hidden: boolean }, city: string): void {
    const fx = Math.sin(c.rot), fz = Math.cos(c.rot);
    let target = (c.path[c.i]?.slow ? 4 : 10) * (ctx.wet > 0.4 ? 0.75 : 1);
    // ring section: moderate speed
    if (c.city === 'benin' && Math.hypot(c.x, c.z) < 30) target = Math.min(target, 7);
    // traffic light ahead on this path
    for (let k = c.i; k < Math.min(c.path.length, c.i + 12); k++) {
      const p = c.path[k]; if (p.stop === undefined) continue;
      const st = lightState(p.stop, t), d = Math.hypot(p.x - c.x, p.z - c.z);
      if (st === 'red' || (st === 'amber' && d > 6)) target = Math.min(target, Math.max(0, (d - 1.5) * 0.7));
      break;
    }
    // anything ahead in the lane (players, cars, other ambient cars)
    const ahead = (o: V, reach: number) => { const dx = o.x - c.x, dz = o.z - c.z, along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx); return along > 0 && along < reach && lat < 2.1 ? along : Infinity; };
    let near = Infinity;
    for (const o of ctx.obstacles) near = Math.min(near, ahead(o, 14));
    for (const o of this.cars) if (o !== c && o.city === c.city) near = Math.min(near, ahead(o, 12) - o.L / 2);
    if (near < Infinity) target = Math.min(target, Math.max(0, (near - c.L / 2 - 2.2) * 0.9));
    const acc = target > c.speed ? 2.2 : 6.5;
    c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), acc * dt);
    // advance along the path
    let move = c.speed * dt;
    while (move > 0) {
      const p = c.path[c.i], dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
      if (d <= move) {
        c.x = p.x; c.z = p.z; move -= d; c.i++;
        if (c.i >= c.path.length) {
          if (c.city === 'lagos') c.i = 0;
          else { const exit = (c.arm + 1 + Math.floor(rnd() * 3)) % 4; c.path = beninTrip(c.arm, exit); c.arm = exit; c.i = 0; }
        }
      } else { c.x += (dx / d) * move; c.z += (dz / d) * move; move = 0; }
    }
    const look = c.path[Math.min(c.path.length - 1, c.i + 1)] ?? c.path[c.i];
    const want = Math.atan2(look.x - c.x, look.z - c.z);
    if (Math.hypot(look.x - c.x, look.z - c.z) > 0.3) c.rot += Math.atan2(Math.sin(want - c.rot), Math.cos(want - c.rot)) * Math.min(1, dt * 5);
    const vis = c.city === city && !ctx.hidden;
    c.car.group.visible = vis;
    this.place(c);
    if (vis) { c.steer += (c.car.steerFor(c.rot - c.prevRot, dt, c.speed) - c.steer) * Math.min(1, dt * 8); c.car.updateWheels(c.speed, c.steer, dt); c.car.setLights(ctx.night > 0.5, target < c.speed - 0.5 || c.speed < 0.3); }
    c.prevRot = c.rot;
  }

  private walk(w: Walker, dt: number, ctx: { focus: V; obstacles: V[]; hidden: boolean }, city: string): void {
    const len = Math.hypot(w.b.x - w.a.x, w.b.z - w.a.z);
    let v = 0;
    if (w.pause > 0) w.pause -= dt;
    else {
      const nx = w.a.x + (w.b.x - w.a.x) * w.t, nz = w.a.z + (w.b.z - w.a.z) * w.t;
      const hx = (w.b.x - w.a.x) / len * w.dir, hz = (w.b.z - w.a.z) / len * w.dir;
      const blocked = ctx.obstacles.some((o) => { const dx = o.x - nx, dz = o.z - nz, al = dx * hx + dz * hz; return al > 0 && al < 1.6 && Math.abs(dx * hz - dz * hx) < 0.8; });
      if (!blocked) { v = w.speed; w.t += (v * dt / len) * w.dir; }
      if (w.t > 1 || w.t < 0) { w.t = Math.max(0, Math.min(1, w.t)); w.dir = w.dir === 1 ? -1 : 1; w.pause = 1 + rnd() * 3; }
      else if (rnd() < dt * 0.02) w.pause = 2 + rnd() * 4; // stop for a moment (phone, look around)
      w.x = nx; w.z = nz; w.rot = Math.atan2(hx, hz);
    }
    const vis = w.city === city && !ctx.hidden;
    w.ch.group.visible = vis;
    if (!vis) return;
    w.ch.group.position.set(w.x, this.world.heightAt(w.x, w.z), w.z);
    w.ch.group.rotation.y = w.rot;
    if (Math.hypot(w.x - ctx.focus.x, w.z - ctx.focus.z) < 90) w.ch.animate(dt, v);
  }
}
