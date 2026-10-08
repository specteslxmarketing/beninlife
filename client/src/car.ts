import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { dirtOverlayTexture } from './textures';
import type { BodyType } from '../../shared/constants';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bodyGeos, SPECS, type Spec } from './carshape';

const DUST = new THREE.Color('#8a6a4c');

const plateTex: THREE.CanvasTexture[] = [];
function plateTexture(): THREE.CanvasTexture {
  if (plateTex.length >= 6) return plateTex[Math.floor(Math.random() * plateTex.length)];
  const c = document.createElement('canvas'); c.width = 256; c.height = 80; const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4ef'; g.fillRect(0, 0, 256, 80); g.strokeStyle = '#1b5e20'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 74);
  g.fillStyle = '#1b5e20'; g.font = '700 14px Arial'; g.textAlign = 'center'; g.fillText('BENIN CITY', 128, 20);
  g.fillStyle = '#111'; g.font = '800 38px Arial'; g.fillText(`BEN ${100 + Math.floor(Math.random() * 899)} ${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`, 128, 62);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; plateTex.push(t); return t;
}

export class Car {
  /** every live car, for distance-based level of detail (see updateLods) */
  static all = new Set<Car>();
  group = new THREE.Group();
  private lod = 0; private lodParts: { interior: THREE.Object3D[]; detail: THREE.Object3D[]; tyres: THREE.Mesh[] } = { interior: [], detail: [], tyres: [] };
  /** set while the builder adds cabin parts (seats, dash, lining) so they can be hidden at distance */
  _tagInterior = false;
  private paint: THREE.MeshPhysicalMaterial;
  private baseColor: THREE.Color;
  private dirtMat: THREE.MeshStandardMaterial;
  private headMat: THREE.MeshStandardMaterial;
  private tailMat: THREE.MeshStandardMaterial;
  private wheels: THREE.Object3D[] = [];
  private frontWheels: THREE.Object3D[] = [];
  private spots: THREE.SpotLight[] = [];
  private wheelSpin = 0;
  private wheelR!: number;
  /** sprung body: shell pivots at axle height so it can roll/pitch over the (unsprung) wheels */
  private shell = new THREE.Group(); private inner = new THREE.Group();
  private roll = 0; private rollV = 0; private pitch = 0; private pitchV = 0; private lastSpeed = 0; private wb = 2.7;
  /** opening parts: 0 FL (driver — Nigeria drives on the right, so the driver sits on the left = +x), 1 FR, 2 RL, 3 RR */
  doors: { pivot: THREE.Object3D; kind: 'hinge' | 'slide'; side: number; len: number; open: number; target: number }[] = [];
  /** interior seat anchors (car-local): 0 driver, 1 front passenger, 2 rear left, 3 rear right */
  seats: THREE.Vector3[] = [];
  setDoor(i: number, open: boolean): void { const d = this.doors[i]; if (d) d.target = open ? 1 : 0; }
  get doorCount(): number { return this.doors.length; }
  /** which door serves a seat (falls back to the nearest existing door) */
  doorForSeat(seat: number): number { return Math.min(seat, Math.max(0, this.doors.length - 1)); }
  _door(pivot: THREE.Object3D, kind: 'hinge' | 'slide', side: number, len: number): void { this.inner.add(pivot); this.doors.push({ pivot, kind, side, len, open: 0, target: 0 }); }
  get _inner(): THREE.Group { return this.inner; }
  private animateDoors(dt: number): void {
    for (const d of this.doors) {
      if (d.open === d.target) continue;
      const sp = d.target > d.open ? 2.6 : 2.2; // ≈0.4 s to open, a little slower to swing shut
      d.open = d.target > d.open ? Math.min(d.target, d.open + dt * sp) : Math.max(d.target, d.open - dt * sp);
      const e = d.open * d.open * (3 - 2 * d.open); // smoothstep
      if (d.kind === 'hinge') d.pivot.rotation.y = -d.side * 1.08 * e;
      else { const a = Math.min(1, e * 4), b = Math.max(0, (e - 0.25) / 0.75); d.pivot.position.x = d.side * 0.13 * a; d.pivot.position.z = -d.len * 0.92 * b; }
    }
  }
  /** current body roll / pitch in radians (exposed for tests and the driving e2e) */
  get suspension(): { roll: number; pitch: number } { return { roll: this.roll, pitch: this.pitch }; }
  dirt = 0;
  readonly length!: number;
  readonly body: BodyType;

  constructor(color: string, opts: { suv?: boolean; headlightLights?: boolean; body?: BodyType; scale?: number; model?: string } = {}) {
    const body: BodyType = opts.body ?? (opts.suv ? 'suv' : 'sedan'); this.body = body;
    this.baseColor = new THREE.Color(color);
    this.paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.headMat = new THREE.MeshStandardMaterial({ color: '#f2f6f8', emissive: '#fff4dd', emissiveIntensity: 0, roughness: 0.05, metalness: 0.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: '#5a0808', emissive: '#ff2010', emissiveIntensity: 0.15, roughness: 0.15 });
    this.dirtMat = new THREE.MeshStandardMaterial({ map: dirtOverlayTexture(), transparent: true, opacity: 0, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    this.shell.add(this.inner); this.group.add(this.shell);
    if (body === 'keke' || body === 'okada') { const r = buildSmall(this, body); this.length = r.L; this.wheelR = r.wheelR; this.wb = r.L * 0.6; }
    else {
      const key = opts.model && SPECS[opts.model] ? opts.model : body;
      const S = SPECS[key] ?? SPECS.sedan;
      this.length = S.L; this.wheelR = S.wheelR; this.wb = S.wheelbase;
      buildCar(this, key, S, opts.headlightLights ?? false);
    }
    this.shell.position.y = this.wheelR; this.inner.position.y = -this.wheelR;
    if (opts.scale) this.group.scale.setScalar(opts.scale);
    mergeStatic(this, `${opts.model && SPECS[opts.model] ? opts.model : body}|${opts.headlightLights ? 1 : 0}`, { [this.paint.uuid]: 'paint', [this.headMat.uuid]: 'head', [this.tailMat.uuid]: 'tail', [this.dirtMat.uuid]: 'dirt' });
    this.classifyLod(); Car.all.add(this);
  }
  /** sort meshes into LOD buckets once the car is built */
  private classifyLod(): void {
    const L = this.lodParts;
    this.group.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      if (m.userData.interior || m.userData.lining) { L.interior.push(m); return; }
      if (m.userData.tyre) { L.tyres.push(m); return; }
      const g = m.geometry; const tris = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
      if (m.userData.rim || (tris < 700 && m.material !== this.paint && !m.userData.keep)) L.detail.push(m);
    });
  }
  /** 0 = full detail, 1 = no cabin (beyond ~25 m), 2 = no small parts + low-poly tyres (beyond ~55 m) */
  setLod(level: number): void {
    if (level === this.lod) return; this.lod = level;
    for (const m of this.lodParts.interior) m.visible = level === 0 || this.doors.some((d) => d.open > 0);
    for (const m of this.lodParts.detail) m.visible = level < 2;
    for (const t of this.lodParts.tyres) { const u = t.userData as { hi?: THREE.BufferGeometry; lo?: THREE.BufferGeometry }; if (u.hi && u.lo) t.geometry = level < 2 ? u.hi : u.lo; }
  }
  private static lodTick = 0; private static tmpV = new THREE.Vector3();
  /** call every frame; re-evaluates a slice of the cars each time */
  static updateLods(cam: THREE.Vector3, scale = 1): void {
    const n = Car.all.size; if (!n) return;
    const per = Math.max(4, Math.ceil(n / 6)); let i = 0; const start = Car.lodTick % n; Car.lodTick += per;
    for (const c of Car.all) {
      const k = (i++ - start + n) % n; if (k >= per) continue;
      if (!c.group.parent) { Car.all.delete(c); continue; }
      const d = c.group.getWorldPosition(Car.tmpV).distanceTo(cam) / scale;
      const busy = c.doors.some((x) => x.open > 0 || x.target > 0);
      c.setLod(busy ? 0 : d < 22 ? 0 : d < (c.lod === 2 ? 50 : 56) ? 1 : 2);
    }
  }

  /** internal: used by the builders */
  _add(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; this.inner.add(m);
    if (this._tagInterior) m.userData.interior = true;
    return m;
  }
  get _paint(): THREE.MeshPhysicalMaterial { return this.paint; }
  get _head(): THREE.MeshStandardMaterial { return this.headMat; }
  get _tail(): THREE.MeshStandardMaterial { return this.tailMat; }
  get _dirt(): THREE.MeshStandardMaterial { return this.dirtMat; }
  _wheel(w: THREE.Object3D, pivot: THREE.Object3D, front: boolean): void { this.wheels.push(w); if (front) this.frontWheels.push(pivot); }
  _spot(s: THREE.SpotLight): void { this.spots.push(s); }
  /** steering angle that explains an observed yaw rate (for cars we don't drive ourselves: remotes, ambient) */
  steerFor(dRot: number, dt: number, speed: number): number {
    if (dt <= 0 || Math.abs(speed) < 0.5) return 0;
    const yaw = Math.atan2(Math.sin(dRot), Math.cos(dRot)) / dt;
    return Math.max(-0.6, Math.min(0.6, Math.atan((-yaw * this.wb) / speed)));
  }
  /** attach something that should ride on the sprung body (driver, rider, cargo) */
  mount(o: THREE.Object3D): void { this.inner.add(o); }

  recolor(c: string): void { this.baseColor.set(c); this.setDirt(this.dirt); }

  setDirt(d: number): void {
    this.dirt = Math.max(0, Math.min(1, d));
    this.paint.color.copy(this.baseColor).lerp(DUST, this.dirt * 0.55);
    this.paint.roughness = 0.3 + this.dirt * 0.6;
    this.paint.clearcoat = 1 - this.dirt;
    this.dirtMat.opacity = Math.min(0.95, this.dirt * 1.1);
  }

  setLights(on: boolean, braking = false): void {
    this.headMat.emissiveIntensity = on ? 3 : 0;
    this.tailMat.emissiveIntensity = braking ? 3 : on ? 1.2 : 0.15;
    for (const s of this.spots) s.intensity = on ? 60 : 0;
  }

  /**
   * speed in m/s along the nose (+z), steer in radians (positive = turning right, i.e. towards -x).
   * Spins and steers the wheels and runs a damped spring for body roll (outwards in a turn; an okada leans in)
   * and pitch (squat when accelerating, nose-dive when braking).
   */
  updateWheels(speed: number, steer: number, dt: number): void {
    this.wheelSpin += speed * dt / this.wheelR;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;
    for (const f of this.frontWheels) f.rotation.y = -steer; // +rotation.y would point the wheels left
    if (dt <= 0) return;
    this.animateDoors(dt);
    const acc = (speed - this.lastSpeed) / dt; this.lastSpeed = speed;
    const lat = (speed * speed * Math.tan(steer)) / this.wb; // m/s², positive when turning right
    const bike = this.body === 'okada';
    const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    const tRoll = bike ? clamp(lat * 0.03, 0.4) : clamp(-lat * 0.0075, this.body === 'keke' ? 0.05 : 0.075);
    const tPitch = clamp(-acc * 0.0065, 0.045);
    for (let left = Math.min(dt, 0.25); left > 1e-6; left -= 1 / 60) { // fixed sub-steps keep the spring stable at low fps
      const h = Math.min(left, 1 / 60);
      this.rollV += ((tRoll - this.roll) * 90 - this.rollV * 11) * h; this.roll += this.rollV * h;
      this.pitchV += ((tPitch - this.pitch) * 110 - this.pitchV * 12) * h; this.pitch += this.pitchV * h;
    }
    this.shell.rotation.set(this.pitch, 0, this.roll);
  }
}

// ---------------------------------------------------------------- shared materials + wheel parts
let M_: Record<string, THREE.Material> | null = null;
function mats(): Record<string, THREE.Material> {
  if (M_) return M_;
  M_ = {
    glass: new THREE.MeshPhysicalMaterial({ color: '#0a1013', metalness: 0.2, roughness: 0.03, transparent: true, opacity: 0.82, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
    black: new THREE.MeshPhysicalMaterial({ color: '#07080a', roughness: 0.12, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    trim: new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.62 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e4e7ea', metalness: 1, roughness: 0.1 }),
    alloy: new THREE.MeshStandardMaterial({ color: '#c3c7cc', metalness: 1, roughness: 0.22 }),
    darkAlloy: new THREE.MeshStandardMaterial({ color: '#5e636a', metalness: 1, roughness: 0.28 }),
    steel: new THREE.MeshStandardMaterial({ color: '#b9bcc0', metalness: 0.6, roughness: 0.4 }),
    tyre: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 }),
    disc: new THREE.MeshStandardMaterial({ color: '#6d6f72', metalness: 0.9, roughness: 0.45 }),
    caliper: new THREE.MeshStandardMaterial({ color: '#8a1414', roughness: 0.4 }),
    lens: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0, metalness: 0, transparent: true, opacity: 0.25, clearcoat: 1 }),
    reflector: new THREE.MeshStandardMaterial({ color: '#d8dde2', metalness: 1, roughness: 0.15 }),
    seam: new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.8 }),
    under: new THREE.MeshStandardMaterial({ color: '#0c0c0d', roughness: 1 }),
    canvas: new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.85, side: THREE.DoubleSide }),
    seat: new THREE.MeshStandardMaterial({ color: '#2a1d16', roughness: 0.7 }),
  };
  return M_;
}
const wheelCache = new Map<string, { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry; disc: THREE.BufferGeometry; barrel: THREE.BufferGeometry }>();
function wheelGeos(r: number, tw: number, spokes: number, style: string) {
  const k = `${r}|${tw}|${spokes}|${style}`; const hit = wheelCache.get(k); if (hit) return hit;
  // tyre: rounded-rectangle profile lathed around the axle (sidewall bulge + tread)
  const rimR = r * 0.66, prof: THREE.Vector2[] = [];
  const hw = tw / 2, steps = 8;
  prof.push(new THREE.Vector2(rimR, -hw * 0.86));
  for (let i = 0; i <= steps; i++) { const a = -Math.PI / 2 + (i / steps) * Math.PI / 2; prof.push(new THREE.Vector2(r - 0.05 + Math.cos(a) * 0.05, -hw + 0.05 + Math.sin(a) * 0.05 + 0.05 * 0)); }
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI / 2; prof.push(new THREE.Vector2(r - 0.05 + Math.cos(a) * 0.05, hw - 0.05 + Math.sin(a) * 0.05)); }
  prof.push(new THREE.Vector2(rimR, hw * 0.86));
  const tyre = new THREE.LatheGeometry(prof.map((p) => new THREE.Vector2(p.x, p.y)), 36); tyre.rotateZ(Math.PI / 2);
  // rim face: disc with spoke windows cut out, bevelled extrusion
  const sh = new THREE.Shape(); sh.absarc(0, 0, rimR, 0, Math.PI * 2, false);
  const n = style === 'steel' ? 8 : spokes, rin = rimR * (style === 'steel' ? 0.5 : 0.34), rout = rimR * (style === 'steel' ? 0.68 : 0.88);
  const gap = style === 'steel' ? 0.55 : style === 'multi' ? 0.42 : 0.62; // fraction of each sector that is open
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + 0.02, span = (Math.PI * 2 / n) * gap, a1 = a0 + span;
    const h = new THREE.Path();
    if (style === 'steel') { const am = (a0 + a1) / 2, rr = (rout - rin) / 2, rc = (rin + rout) / 2; h.absarc(Math.cos(am) * rc, Math.sin(am) * rc, rr * 0.75, 0, Math.PI * 2, true); }
    else { h.absarc(0, 0, rout, a0, a1, false); h.absarc(0, 0, rin, a1 - span * 0.25, a0 + span * 0.25, true); h.closePath(); }
    sh.holes.push(h);
  }
  const rim = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 28 });
  rim.rotateY(Math.PI / 2); rim.computeVertexNormals();
  const disc = new THREE.CylinderGeometry(rimR * 0.78, rimR * 0.78, 0.025, 24); disc.rotateZ(Math.PI / 2);
  const barrel = new THREE.CylinderGeometry(rimR, rimR, tw * 0.8, 24, 1, true); barrel.rotateZ(Math.PI / 2);
  const res = { tyre, rim, disc, barrel }; wheelCache.set(k, res); return res;
}

function addWheels(car: Car, S: { W: number; wheelR: number; wheelbase: number; wheelZ: number; tyreW: number; spokes: number; rimStyle: string }, track: number, sporty: boolean): void {
  const M = mats(), r = S.wheelR, tw = S.tyreW, g = wheelGeos(r, tw, Math.max(5, S.spokes), S.rimStyle);
  const rimMat = S.rimStyle === 'steel' ? M.steel : S.rimStyle === 'multi' && sporty ? M.darkAlloy : M.alloy;
  for (const [sx, sz] of [[-1, S.wheelZ + S.wheelbase / 2], [1, S.wheelZ + S.wheelbase / 2], [-1, S.wheelZ - S.wheelbase / 2], [1, S.wheelZ - S.wheelbase / 2]] as const) {
    const pivot = new THREE.Group(); pivot.position.set(sx * track, r, sz); car.group.add(pivot);
    const wheel = new THREE.Group(); pivot.add(wheel);
    const t = new THREE.Mesh(g.tyre, M.tyre); t.castShadow = true; wheel.add(t); t.userData.tyre = true; t.userData.hi = g.tyre; t.userData.lo = lowTyre(r, tw);
    wheel.add(new THREE.Mesh(g.barrel, M.trim));
    const face = new THREE.Mesh(g.rim, rimMat); face.userData.rim = true; face.position.x = sx * (tw * 0.36) - (sx > 0 ? 0.03 : 0); wheel.add(face);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.1, r * 0.1, 0.02, 14).rotateZ(Math.PI / 2), M.chrome); cap.position.x = sx * (tw * 0.36 + 0.03); wheel.add(cap);
    // brake disc + caliper stay still (attached to the pivot, not the spinning wheel)
    const d = new THREE.Mesh(g.disc, M.disc); d.position.x = sx * (tw * 0.12); pivot.add(d);
    const cal = new THREE.Mesh(new RoundedBoxGeometry(0.05, r * 0.32, r * 0.22, 2, 0.015), sporty ? M.caliper : M.trim); cal.position.set(sx * (tw * 0.2), r * 0.3, -r * 0.3); pivot.add(cal);
    car._wheel(wheel, pivot, sz > 0);
  }
}

let drl: THREE.MeshStandardMaterial | null = null;
function drlMat(): THREE.MeshStandardMaterial { return drl ??= new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f4ff', emissiveIntensity: 1.4, roughness: 0.2 }); }
const grilles = new Map<string, THREE.MeshStandardMaterial>();
function grilleMat(kind: 'slats' | 'mesh'): THREE.MeshStandardMaterial {
  let m = grilles.get(kind); if (m) return m;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = '#050506'; g.fillRect(0, 0, 256, 128);
  if (kind === 'slats') { for (let y = 6; y < 128; y += 16) { g.fillStyle = '#9da3a8'; g.fillRect(0, y, 256, 5); g.fillStyle = '#2a2c2f'; g.fillRect(0, y + 5, 256, 2); } }
  else for (let y = 0; y < 128; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < 256; x += 12) { g.fillStyle = '#26282b'; g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + 6, y); g.lineTo(x + 12, y + 6); g.lineTo(x + 6, y + 12); g.closePath(); g.fill(); g.fillStyle = '#000'; g.fillRect(x + 4, y + 4, 4, 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: t, metalness: 0.6, roughness: 0.35 }); grilles.set(kind, m); return m;
}

function buildCar(car: Car, key: string, S: Spec, spot: boolean): void {
  const M = mats(), G = bodyGeos(key, S), sh = G.shape, W = S.W;
  const paint = car._paint;
  car._add(G.body, paint);
  const dm = car._add(G.body, car._dirt, 0, 0, 0, false); dm.scale.setScalar(1.003);
  const glass = car._add(G.glass, M.glass); glass.castShadow = true;
  car._add(G.roof, paint);
  car._add(G.black, M.black, 0, 0, 0, false);
  car._add(G.chrome, M.chrome, 0, 0, 0, false);
  // underbody between the wheels so you never see through under the sills
  car._add(new THREE.BoxGeometry(W * 0.86, 0.12, S.L * 0.8), M.under, 0, S.sill + 0.04, 0, false);
  // wheel-arch liners
  for (const wz of [S.wheelZ + S.wheelbase / 2, S.wheelZ - S.wheelbase / 2]) {
    const liner = new THREE.CylinderGeometry(S.wheelR + 0.07, S.wheelR + 0.07, W * 0.84, 20, 1, true, -Math.PI / 2, Math.PI); liner.rotateZ(Math.PI / 2);
    car._add(liner, M.under, 0, S.wheelR, wz, false).material = new THREE.MeshStandardMaterial({ color: '#0c0c0d', roughness: 1, side: THREE.BackSide });
  }
  // pickup bed: painted side walls + tailgate, black tub floor
  if (S.bed) {
    const [b0, b1] = S.bed, len = b1 - b0, floor = sh.topY((b0 + b1) / 2), hw = sh.halfW((b0 + b1) / 2);
    for (const sx of [-1, 1]) car._add(new RoundedBoxGeometry(0.08, 0.44, len, 2, 0.03), paint, sx * (hw - 0.07), floor + 0.2, (b0 + b1) / 2);
    car._add(new RoundedBoxGeometry(W * 0.86, 0.44, 0.08, 2, 0.03), paint, 0, floor + 0.2, b0 + 0.06);
    car._add(new THREE.BoxGeometry(W * 0.84, 0.03, len - 0.1), M.trim, 0, floor + 0.01, (b0 + b1) / 2, false);
    car._add(new RoundedBoxGeometry(0.06, 0.06, W * 0.8, 2, 0.02).rotateY(Math.PI / 2), M.chrome, 0, sh.roofY(-0.4) + 0.05, b1 - 0.05);
    for (const sx of [-1, 1]) car._add(new RoundedBoxGeometry(0.05, 0.42, 0.05, 2, 0.02), M.chrome, sx * (W * 0.38), floor + 0.62, b1 - 0.05);
  }
  // nose: grille (conforming patch with a slatted/mesh texture + chrome surround), swept headlight clusters, DRLs, fogs
  const gr = S.grille, nose = sh.zNose;
  const gy0 = () => gr.y - gr.h / 2, gy1 = () => gr.y + gr.h / 2;
  const chromeLoop = (x0: number, x1: number, f0: (x: number) => number, f1: (x: number) => number, r = 0.014) =>
    car._add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sh.outline(true, x0, x1, f0, f1, 0.01), true), 64, r, 6, true), M.chrome, 0, 0, 0, false);
  if (S.style === 'rx') {
    // spindle grille: upper trapezoid narrowing to a waist, lower intake flaring out again (hourglass), chrome-edged
    const top = gr.y + gr.h / 2, bot = gr.y - gr.h / 2, waist = gr.y - gr.h * 0.12, a = gr.w * 0.27, b = gr.w / 2, c = gr.w * 0.6;
    const upB = (x: number) => waist + Math.max(0, (Math.abs(x) - a) / (b - a)) * (top - waist) * 0.8, upT = (x: number) => top - Math.pow(Math.abs(x) / b, 2) * 0.03;
    const loT = (x: number) => waist - Math.max(0, (Math.abs(x) - a) / (c - a)) * (waist - bot) * 0.8, loB = () => bot;
    car._add(sh.patch(true, -b, b, upB, upT, 0.012, 16, 5), grilleMat('slats'), 0, 0, 0, false);
    car._add(sh.patch(true, -c, c, loB, loT, 0.012, 16, 4), grilleMat('mesh'), 0, 0, 0, false);
    chromeLoop(-b, b, upB, upT, 0.016); chromeLoop(-c, c, loB, loT, 0.012);
    // badge area (blank — no logos)
    const by = top - 0.1, bz = sh.endZ(true, 0, by) + 0.03;
    car._add(new THREE.TorusGeometry(0.07, 0.01, 8, 28).scale(1.3, 1, 1), M.chrome, 0, by, bz, false);
  } else if (S.style === 'glk') {
    // upright grille with two thick chrome louvres and a large central badge disc (blank — no star)
    car._add(sh.patch(true, -gr.w / 2, gr.w / 2, gy0, gy1, 0.012, 12, 4), grilleMat('mesh'), 0, 0, 0, false);
    chromeLoop(-gr.w / 2, gr.w / 2, gy0, gy1, 0.018);
    for (const f of [0.36, 0.66]) { const y = gr.y - gr.h / 2 + gr.h * f; car._add(sh.patch(true, -gr.w / 2 + 0.02, gr.w / 2 - 0.02, () => y - 0.02, () => y + 0.02, 0.024, 16, 1), M.chrome, 0, 0, 0, false); }
    const by = gr.y + 0.01, bz = sh.endZ(true, 0, by) + 0.04;
    car._add(new THREE.CircleGeometry(0.1, 32), M.black, 0, by, bz, false);
    car._add(new THREE.TorusGeometry(0.1, 0.014, 8, 32), M.chrome, 0, by, bz + 0.004, false);
  } else {
    car._add(sh.patch(true, -gr.w / 2, gr.w / 2, gy0, gy1, 0.012, 10, 4), grilleMat(gr.chrome ? 'slats' : 'mesh'), 0, 0, 0, false);
    if (gr.chrome) chromeLoop(-gr.w / 2, gr.w / 2, gy0, gy1);
  }
  const lx = S.style === 'rx' ? W / 2 - 0.33 : W / 2 - 0.3, lw = S.style === 'rx' ? 0.3 : S.style === 'glk' ? 0.25 : 0.24, ly = S.lampY;
  for (const sx of [-1, 1]) {
    const xa = sx > 0 ? lx - lw : -lx - lw * 0.9, xb = sx > 0 ? lx + lw * 0.9 : -lx + lw;
    const t = (x: number) => (Math.abs(x) - (lx - lw)) / (lw * 1.9); // 0 inner → 1 outer
    // GLK: squared rectangular units; RX: long swept lamps rising towards the wings; others: gently tapered
    const y0 = S.style === 'glk' ? () => ly - 0.07 : S.style === 'rx' ? (x: number) => ly - 0.06 + 0.07 * t(x) : (x: number) => ly - 0.065 + 0.03 * t(x);
    const y1 = S.style === 'glk' ? () => ly + 0.065 : S.style === 'rx' ? (x: number) => ly + 0.045 + 0.035 * t(x) : (x: number) => ly + 0.06 - 0.012 * t(x);
    car._add(sh.patch(true, xa, xb, y0, y1, 0.012, 12, 4), M.black, 0, 0, 0, false);              // housing
    for (const f of [0.3, 0.62]) {                                                                // twin projectors
      const x = xa + (xb - xa) * (sx > 0 ? f : 1 - f), y = (y0(x) + y1(x)) / 2, z = sh.endZ(true, x, y);
      car._add(new THREE.SphereGeometry(0.038, 14, 10), M.reflector, x, y, z + 0.006, false);
      car._add(new THREE.SphereGeometry(0.022, 10, 8), car._head, x, y, z + 0.03, false);
    }
    car._add(sh.patch(true, xa + 0.02, xb - 0.02, (x) => y0(x) + 0.006, (x) => y0(x) + 0.02, 0.02, 12, 1), drlMat(), 0, 0, 0, false); // LED strip
    car._add(sh.patch(true, xa, xb, y0, y1, 0.036, 12, 4), M.lens, 0, 0, 0, false);                 // clear lens
    const fx = sx * (W / 2 - 0.3), fy = Math.max(sh.bottomY(nose - 0.3) + 0.12, S.sill + 0.18);
    car._add(new THREE.SphereGeometry(0.045, 12, 8), car._head, fx, fy, sh.endZ(true, Math.abs(fx), fy) - 0.01, false); // fog lamp
    // tail light clusters
    // GLK: tall squared corner lamps; RX: wedge lamps, pointed towards the tailgate centre
    const ty = S.tailY, tx = S.style === 'glk' ? W / 2 - 0.23 : S.style === 'rx' ? W / 2 - 0.3 : W / 2 - 0.27;
    const tw2 = S.style === 'glk' ? 0.2 : S.style === 'rx' ? 0.3 : S.tailBar ? 0.26 : 0.2;
    // keep the outer edge on the tail corner: past this width the lamp would slide far along the body side
    const wrapX = Math.min(tx + tw2, sh.widthAt(sh.zTail + 0.3, ty) - 0.02);
    const ta = sx > 0 ? tx - tw2 : -wrapX, tb = sx > 0 ? wrapX : -tx + tw2;
    const th = S.style === 'glk' ? 0.12 : S.style === 'rx' ? 0.085 : S.tailBar ? 0.045 : 0.08;
    const tt = (x: number) => Math.min(1, Math.max(0, (Math.abs(x) - (tx - tw2)) / (tw2 * 2))); // 0 inner → 1 outer
    const t0 = S.style === 'rx' ? (x: number) => ty - th * (0.25 + 0.75 * tt(x)) : () => ty - th, t1 = S.style === 'rx' ? (x: number) => ty + th * (0.35 + 0.65 * tt(x)) : () => ty + th;
    car._add(sh.patch(false, ta, tb, t0, t1, 0.012, 10, 3), car._tail, 0, 0, 0, false);
    car._add(sh.patch(false, ta + 0.03, tb - 0.03, (x) => t0(x) + (t1(x) - t0(x)) * 0.35, (x) => t0(x) + (t1(x) - t0(x)) * 0.55, 0.02, 10, 1), M.reflector, 0, 0, 0, false);
    // mirrors at the base of the A-pillar
    const mz = sh.zWs - 0.32, mx = sh.halfW(mz) * 0.9 + 0.13, my = sh.topY(mz) + 0.13;
    const mi = car._add(new RoundedBoxGeometry(0.2, 0.12, 0.1, 3, 0.045), car._paint, sx * mx, my, mz); mi.rotation.y = sx * 0.1;
    car._add(new THREE.BoxGeometry(0.06, 0.03, 0.04), M.black, sx * (mx - 0.1), my - 0.03, mz, false);
    // door seams, handles, side skirt
    const fw = S.wheelZ + S.wheelbase / 2, rw = S.wheelZ - S.wheelbase / 2;
    const bP = S.pillars[0] ?? 0;
    const seams = key === 'bus' ? [sh.zWs - 0.2, sh.zWs - 1.0, -0.6] : S.bed ? [fw - S.wheelR - 0.1, bP, sh.zRw + 0.06] : [fw - S.wheelR - 0.12, bP, Math.max(rw + S.wheelR + 0.1, sh.zRw + 0.12)];
    for (const dz of seams) {
      if (Math.abs(dz) > S.L / 2 - 0.2) continue;
      const y0s = sh.bottomY(dz) + 0.05, y1s = sh.topY(dz) - 0.04;
      for (let k = 0; k < 6; k++) { // follow the body curvature with short segments
        const ya = y0s + (y1s - y0s) * (k / 6), yb2 = y0s + (y1s - y0s) * ((k + 1) / 6), xm = sh.widthAt(dz, (ya + yb2) / 2) + 0.0015;
        car._add(new THREE.BoxGeometry(0.003, yb2 - ya + 0.004, 0.007), M.seam, sx * xm, (ya + yb2) / 2, dz, false);
      }
    }
    for (const hz of key === 'rio' ? [bP + 0.18] : [bP + 0.18, seams[2] + 0.16]) {
      if (Math.abs(hz) > S.L / 2 - 0.4 || key === 'bus') continue;
      const hy = sh.topY(hz) - 0.11; car._add(new RoundedBoxGeometry(0.03, 0.032, 0.15, 2, 0.012), M.chrome, sx * (sh.widthAt(hz, hy) + 0.008), hy, hz, false);
    }
    const fz = fw - S.wheelR - 0.1, rz = rw + S.wheelR + 0.1;
    car._add(new RoundedBoxGeometry(0.05, 0.08, fz - rz, 2, 0.02), M.trim, sx * (sh.widthAt(0, S.sill + 0.1) - 0.005), S.sill + 0.08, (fz + rz) / 2, false).userData.fixed = true; // side skirt stays on the body
  }
  if (S.tailBar) car._add(sh.patch(false, -W * 0.3, W * 0.3, () => S.tailY - 0.012, () => S.tailY + 0.018, 0.014, 14, 1), car._tail, 0, 0, 0, false);
  if (S.style === 'rx') car._add(sh.patch(false, -(W / 2 - 0.6), W / 2 - 0.6, () => S.tailY - 0.018, () => S.tailY + 0.004, 0.016, 14, 1), M.chrome, 0, 0, 0, false); // chrome tailgate strip
  // bumper lips + plates
  const lipF = sh.bottomY(nose - 0.25) + 0.05, lipR = sh.bottomY(sh.zTail + 0.25) + 0.05;
  car._add(new RoundedBoxGeometry(W * 0.8, 0.07, 0.12, 2, 0.03), M.trim, 0, lipF, sh.endZ(true, W * 0.3, lipF) - 0.03, false);
  car._add(new RoundedBoxGeometry(W * 0.8, 0.07, 0.12, 2, 0.03), M.trim, 0, lipR, sh.endZ(false, W * 0.3, lipR) + 0.03, false);
  const plate = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.4 });
  const pfy = Math.max(lipF + 0.13, gr.y - gr.h / 2 - 0.1), pry = S.tailY - 0.24;
  car._add(new THREE.PlaneGeometry(0.42, 0.13), plate, 0, pfy, Math.max(sh.endZ(true, 0.21, pfy + 0.06), sh.endZ(true, 0.21, pfy - 0.06)) + 0.004, false);
  const pl = car._add(new THREE.PlaneGeometry(0.42, 0.13), plate, 0, pry, Math.min(sh.endZ(false, 0.21, pry + 0.06), sh.endZ(false, 0.21, pry - 0.06)) - 0.004, false); pl.rotation.y = Math.PI;
  addInterior(car, key, S, sh);
  setupDoors(car, key, S, sh);
  const sporty = key === 'c300' || key === 'rx350' || key === 'es350';
  addWheels(car, S, W / 2 - S.tyreW / 2 - 0.05, sporty);
  if (spot) for (const sx of [-1, 1]) {
    const sp = new THREE.SpotLight('#fff1d6', 0, 45, 0.5, 0.55, 1.4);
    sp.position.set(sx * lx, S.lampY, nose); sp.target.position.set(sx * 0.8, 0, nose + 14);
    car.group.add(sp, sp.target); car._spot(sp);
  }
}

/** keke (auto-rickshaw tricycle) and okada (motorcycle); ambient-only vehicles */
function buildSmall(car: Car, kind: 'keke' | 'okada'): { L: number; wheelR: number } {
  const M = mats(), paint = car._paint;
  if (kind === 'okada') {
    const r = 0.3;
    for (const z of [0.68, -0.62]) {
      const pivot = new THREE.Group(); pivot.position.set(0, r, z); car.group.add(pivot);
      const wheel = new THREE.Group(); pivot.add(wheel);
      const g = wheelGeos(r, 0.1, 8, 'multi'); wheel.add(new THREE.Mesh(g.tyre, M.tyre)); const rim = new THREE.Mesh(g.rim, M.alloy); wheel.add(rim);
      car._wheel(wheel, pivot, z > 0);
    }
    const tank = car._add(new THREE.CapsuleGeometry(0.15, 0.32, 6, 12).rotateX(Math.PI / 2), paint, 0, 0.78, 0.22); tank.scale.set(1, 0.85, 1);
    car._add(new RoundedBoxGeometry(0.26, 0.08, 0.62, 3, 0.035), M.seat, 0, 0.8, -0.22);
    car._add(new RoundedBoxGeometry(0.2, 0.26, 0.42, 3, 0.05), M.trim, 0, 0.5, 0.05); // engine
    car._add(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8).rotateX(Math.PI / 2 - 0.2), M.chrome, 0.12, 0.4, -0.3); // exhaust
    const fork = car._add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), M.chrome, 0, 0.7, 0.62); fork.rotation.x = -0.35;
    car._add(new THREE.CylinderGeometry(0.018, 0.018, 0.68, 8).rotateZ(Math.PI / 2), M.trim, 0, 1.02, 0.5);
    car._add(new THREE.SphereGeometry(0.08, 12, 8), car._head, 0, 0.9, 0.66);
    car._add(new RoundedBoxGeometry(0.12, 0.05, 0.04, 2, 0.015), car._tail, 0, 0.82, -0.56);
    car._add(new THREE.BoxGeometry(0.06, 0.04, 0.9), M.trim, 0, 0.42, 0);
    return { L: 1.9, wheelR: r };
  }
  // keke: yellow tub body, black canvas roof on poles, one front wheel, two rear
  const r = 0.24;
  const wheels: [number, number][] = [[0, 0.95], [-0.55, -0.62], [0.55, -0.62]];
  for (const [x, z] of wheels) {
    const pivot = new THREE.Group(); pivot.position.set(x, r, z); car.group.add(pivot);
    const wheel = new THREE.Group(); pivot.add(wheel);
    const g = wheelGeos(r, 0.13, 8, 'steel'); wheel.add(new THREE.Mesh(g.tyre, M.tyre)); wheel.add(new THREE.Mesh(g.rim, M.steel));
    car._wheel(wheel, pivot, z > 0);
  }
  const shell = new THREE.Shape(); // side profile of the tub
  shell.moveTo(-0.95, 0.32); shell.lineTo(-0.95, 0.92); shell.quadraticCurveTo(-0.95, 0.98, -0.85, 0.98); shell.lineTo(0.35, 0.98); shell.quadraticCurveTo(0.9, 0.96, 1.08, 0.6); shell.quadraticCurveTo(1.12, 0.42, 0.95, 0.36); shell.lineTo(-0.95, 0.32);
  const tub = new THREE.ExtrudeGeometry(shell, { depth: 1.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 4, curveSegments: 16 });
  tub.rotateY(-Math.PI / 2); tub.translate(0.56, 0, 0); tub.computeVertexNormals();
  car._add(tub, paint);
  const ws = car._add(new THREE.PlaneGeometry(1.0, 0.62), mats().glass, 0, 1.32, 0.62); ws.rotation.x = -0.25;
  car._add(new RoundedBoxGeometry(1.3, 0.06, 1.95, 3, 0.03), M.canvas, 0, 1.78, -0.08);
  for (const [x, z] of [[-0.6, 0.58], [0.6, 0.58], [-0.6, -0.95], [0.6, -0.95]]) car._add(new THREE.CylinderGeometry(0.025, 0.025, 0.82, 8), M.trim, x, 1.38, z);
  car._add(new RoundedBoxGeometry(1.1, 0.5, 0.06, 2, 0.02), M.canvas, 0, 1.5, -0.98);
  car._add(new RoundedBoxGeometry(1.0, 0.12, 0.42, 2, 0.04), M.seat, 0, 1.05, -0.55);
  car._add(new THREE.SphereGeometry(0.07, 10, 8), car._head, 0, 0.78, 1.08);
  for (const sx of [-1, 1]) car._add(new RoundedBoxGeometry(0.08, 0.1, 0.03, 2, 0.01), car._tail, sx * 0.5, 0.7, -1.0);
  return { L: 2.6, wheelR: r };
}

// ---------------------------------------------------------------- interior + opening doors
type Shape = ReturnType<typeof bodyGeos>['shape'];
function doorRanges(key: string, S: Spec, sh: Shape): { front: [number, number]; rear: [number, number] | null; slide: boolean } {
  const fw = S.wheelZ + S.wheelbase / 2, rw = S.wheelZ - S.wheelbase / 2, bP = S.pillars[0] ?? 0;
  if (key === 'bus') return { front: [sh.zWs - 1.0, sh.zWs - 0.2], rear: [-0.6, sh.zWs - 1.15], slide: true };
  if (S.bed) return { front: [bP, fw - S.wheelR - 0.1], rear: [sh.zRw + 0.06, bP], slide: false };
  return { front: [bP, fw - S.wheelR - 0.12], rear: [Math.max(rw + S.wheelR + 0.1, sh.zRw + 0.12), bP], slide: key === 'minivan' };
}

/** seats, dashboard and steering wheel, plus a dark cabin lining (inside faces of the body) seen when a door is open */
const lowTyres = new Map<string, THREE.BufferGeometry>();
function lowTyre(r: number, w: number): THREE.BufferGeometry {
  const k = `${r.toFixed(3)}|${w.toFixed(3)}`; let g = lowTyres.get(k);
  if (!g) { g = new THREE.CylinderGeometry(r, r, w, 18, 1).rotateZ(Math.PI / 2); lowTyres.set(k, g); }
  return g;
}
function addInterior(car: Car, key: string, S: Spec, sh: Shape): void {
  car._tagInterior = true;
  try { addInteriorParts(car, key, S, sh); } finally { car._tagInterior = false; }
}
function addInteriorParts(car: Car, key: string, S: Spec, sh: Shape): void {
  const M = mats(); const r = doorRanges(key, S, sh);
  const lining = new THREE.MeshStandardMaterial({ color: '#17130f', roughness: 0.95, side: THREE.BackSide });
  const G = bodyGeos(key, S); const ln = car._add(G.body, lining, 0, 0, 0, false); ln.scale.setScalar(0.992); ln.userData.lining = true;
  const floorY = S.sill + 0.12, cushion = floorY + 0.24;
  const zF = (r.front[0] + r.front[1]) / 2 - 0.12, zR = r.rear ? (r.rear[0] + r.rear[1]) / 2 - 0.05 : zF - 0.85;
  const sx = sh.halfW(zF) * 0.42;
  car.seats = [new THREE.Vector3(sx, cushion, zF), new THREE.Vector3(-sx, cushion, zF), new THREE.Vector3(sx, cushion, zR), new THREE.Vector3(-sx, cushion, zR)];
  for (const [i, p] of car.seats.entries()) {
    const w = i < 2 ? 0.5 : sh.halfW(zR) * 0.8;
    if (i === 3) continue; // rear bench spans both rear seats
    const x = i === 2 ? 0 : p.x, ww = i === 2 ? w * 2 : w;
    car._add(new RoundedBoxGeometry(ww, 0.14, 0.5, 2, 0.05), M.seat, x, cushion - 0.07, p.z, false);
    const back = car._add(new RoundedBoxGeometry(ww, 0.62, 0.13, 2, 0.05), M.seat, x, cushion + 0.28, p.z - 0.28, false); back.rotation.x = -0.18;
    if (i < 2) car._add(new RoundedBoxGeometry(0.26, 0.18, 0.1, 2, 0.04), M.seat, x, cushion + 0.68, p.z - 0.34, false); // headrest
  }
  const zd = sh.zWs - 0.12, dy = sh.topY(zd) - 0.08;
  car._add(new RoundedBoxGeometry(sh.halfW(zd) * 1.7, 0.2, 0.42, 2, 0.06), M.trim, 0, dy, zd, false); // dashboard
  const wheel = car._add(new THREE.TorusGeometry(0.17, 0.022, 8, 28), M.black, car.seats[0]!.x, dy + 0.02, zd - 0.32, false);
  wheel.rotation.x = -0.45; wheel.rotation.y = 0;
}

const splitCache = new Map<string, { rest: THREE.BufferGeometry; parts: (THREE.BufferGeometry | null)[] }>();
function splitGeometry(cacheKey: string, geo: THREE.BufferGeometry, region: (x: number, y: number, z: number) => number, n: number) {
  const hit = splitCache.get(cacheKey); if (hit) return hit;
  const g = geo.index ? geo.toNonIndexed() : geo;
  const names = Object.keys(g.attributes); const pos = g.getAttribute('position');
  const buckets: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3, cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const k = region(cx, cy, cz); buckets[k < 0 ? n : k]!.push(t);
  }
  const build = (tris: number[]): THREE.BufferGeometry | null => {
    if (!tris.length) return null;
    const out = new THREE.BufferGeometry();
    for (const nm of names) {
      const a = g.getAttribute(nm) as THREE.BufferAttribute; const sz = a.itemSize; const arr = new Float32Array(tris.length * 3 * sz);
      let o = 0; for (const t of tris) for (let v = 0; v < 3; v++) for (let c = 0; c < sz; c++) arr[o++] = a.array[(t + v) * sz + c]!;
      out.setAttribute(nm, new THREE.BufferAttribute(arr, sz, a.normalized));
    }
    out.computeBoundingSphere(); return out;
  };
  const res = { rest: build(buckets[n]!) ?? new THREE.BufferGeometry(), parts: buckets.slice(0, n).map(build) };
  splitCache.set(cacheKey, res); return res;
}

/** cut the door skins (paint, dirt, glass, trim, lining, seams, handles) out of the body and hang them on hinges */
function setupDoors(car: Car, key: string, S: Spec, sh: Shape): void {
  const r = doorRanges(key, S, sh);
  const ranges: { z0: number; z1: number; side: number; slide: boolean }[] = [];
  for (const side of [1, -1]) ranges.push({ z0: r.front[0], z1: r.front[1], side, slide: false });
  if (r.rear) for (const side of [1, -1]) ranges.push({ z0: r.rear[0], z1: r.rear[1], side, slide: r.slide });
  const region = (x: number, y: number, z: number): number => {
    if (y < S.sill - 0.06 || y > sh.roofY(z) - 0.05) return -1;
    for (let i = 0; i < ranges.length; i++) {
      const q = ranges[i]!; if (Math.sign(x) !== q.side || z < q.z0 + 0.004 || z > q.z1 - 0.004) continue;
      if (Math.abs(x) > sh.halfW(z) * 0.55) return i;
    }
    return -1;
  };
  const pivots = ranges.map((q) => {
    const yMid = (S.sill + sh.topY(q.z1)) / 2, hx = q.side * sh.widthAt(q.z1, yMid);
    const pivot = new THREE.Group(); pivot.position.set(q.slide ? 0 : hx, 0, q.slide ? 0 : q.z1);
    const content = new THREE.Group(); content.position.set(q.slide ? 0 : -hx, 0, q.slide ? 0 : -q.z1); pivot.add(content);
    car._door(pivot, q.slide ? 'slide' : 'hinge', q.side, q.z1 - q.z0); return content;
  });
  const inner = car._inner;
  for (const o of [...inner.children]) {
    const m = o as THREE.Mesh; if (!m.isMesh || m.userData.fixed || car.doors.some((d) => d.pivot === o)) continue;
    const atOrigin = m.position.lengthSq() < 1e-9 && m.rotation.x === 0 && m.rotation.y === 0 && m.rotation.z === 0;
    if (atOrigin && m.geometry.attributes.position.count > 300) {
      const sp = splitGeometry(`${key}|${m.geometry.uuid}|${m.scale.x.toFixed(4)}`, m.geometry, (x, y, z) => region(x / m.scale.x, y / m.scale.y, z / m.scale.z), ranges.length);
      if (!sp.parts.some(Boolean)) continue;
      m.geometry = sp.rest;
      sp.parts.forEach((pg, i) => { if (!pg) return; const dm = new THREE.Mesh(pg, m.material); dm.scale.copy(m.scale); dm.castShadow = m.castShadow; dm.receiveShadow = true; pivots[i]!.add(dm); });
    } else if (!atOrigin) {
      const i = region(m.position.x, m.position.y, m.position.z);
      if (i >= 0) pivots[i]!.add(m);
    }
  }
}


// ---------- draw-call reduction: merge static meshes that share a material within the same moving part ----------
const mergeCache = new Map<string, THREE.BufferGeometry>();
function prepGeo(m: THREE.Mesh): THREE.BufferGeometry {
  const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 2), 2));
  m.updateMatrix(); g.applyMatrix4(m.matrix);
  g.morphAttributes = {}; g.clearGroups();
  return g;
}
/**
 * Bake the many small meshes of a car (badges, trim, lamps, seams, seats…) into one mesh per material per part.
 * Parts that move (doors, wheels) and LOD-swapped meshes (tyres, rims) stay separate. Results are cached per model,
 * so all cars of the same model share the merged geometry.
 */
function mergeStatic(car: Car, key: string, roles: Record<string, string>): void {
  const parents: THREE.Object3D[] = [];
  car.group.traverse((o) => { if (!(o as THREE.Mesh).isMesh) parents.push(o); });
  parents.forEach((P, pi) => {
    const groups = new Map<string, THREE.Mesh[]>();
    for (const c of P.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || m.children.length || Array.isArray(m.material) || m.userData.tyre || m.userData.rim || m.userData.keep) continue;
      const mat = m.material as THREE.Material;
      const bucket = m.userData.interior || m.userData.lining ? 'i' : 'm';
      const k = `${bucket}|${roles[mat.uuid] ?? mat.uuid}|${m.castShadow ? 1 : 0}|${m.renderOrder}`;
      let arr = groups.get(k); if (!arr) groups.set(k, arr = []); arr.push(m);
    }
    for (const [k, list] of groups) {
      if (list.length < 2) continue;
      const ck = `${key}|${pi}|${k}|${list.length}`;
      let geo = mergeCache.get(ck);
      if (!geo) {
        const merged = mergeGeometries(list.map(prepGeo), false);
        if (!merged) continue;
        merged.computeBoundingSphere(); mergeCache.set(ck, merged); geo = merged;
      }
      const first = list[0]!;
      const mm = new THREE.Mesh(geo, first.material); mm.castShadow = first.castShadow; mm.receiveShadow = first.receiveShadow; mm.renderOrder = first.renderOrder;
      if (first.userData.interior) mm.userData.interior = true; if (first.userData.lining) mm.userData.lining = true;
      mm.userData.merged = list.length;
      for (const m of list) P.remove(m);
      P.add(mm);
    }
  });
}
