import * as THREE from 'three';
import { BENIN_MOTOR_PARK, CAR_STANDS, DISPLAY_SLOTS, STATION_JOBS, carModel, POLICE_CHECKPOINTS, POLICE_OFFICERS, type PoliceOfficer } from '../../shared/constants';
import { buildHouseExteriors, buildInteriors, crownTexture, posterTexture } from './interiors';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  asphaltTexture, concreteTexture, corrugatedTexture, grassTexture, groundTexture, paverTexture, plasterTexture,
  radialGlowTexture, rng, roadTexture, signTexture, windowTexture,
} from './textures';
import { Character } from './character';
import { Car } from './car';
import { buildAirport } from './airport';
import { LagosDistrict } from './lagos';
import { CARWASH_ZONE, WORLD_HALF } from '../../shared/constants';

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number }
export type Face = 'n' | 's' | 'e' | 'w';
const FACE_ROT: Record<Face, number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };

const ROAD_HALF = 7, GUTTER = 0.6, WALK_OUT = 11.1, RING_IN = 13, RING_OUT = 26, ARC_OUT = 31, ROAD_END = 190;
const CURB_H = 0.16;

export interface SignInfo { logo?: boolean; text: string; bg: string; fg: string; sub?: string }
export interface BuildingOpts {
  x: number; z: number; front: number; depth: number; floors: number; face: Face; color: string; seed: number;
  balconies?: boolean; glass?: boolean; shop?: SignInfo; tank?: boolean; shutters?: boolean; simple?: boolean;
}

export class World {
  colliders: AABB[] = [];
  interiorLights = new Map<string, THREE.PointLight[]>();
  displayCars = new Map<string, Car>();
  wetMats: THREE.MeshStandardMaterial[] = [];
  private wetBase = new Map<THREE.MeshStandardMaterial, { r: number; c: THREE.Color }>();
  /** road puddle positions (used by the weather system) */
  puddleSpots: { x: number; z: number }[] = (() => {
    const out: { x: number; z: number }[] = []; const r = rng(77);
    for (let v = -175; v <= 175; v += 9) { if (Math.abs(v) < 30) continue; if (r() < 0.55) out.push({ x: (r() - 0.5) * 10, z: v }); if (r() < 0.55) out.push({ x: v, z: (r() - 0.5) * 10 }); }
    return out;
  })();
  /** wet look: darker, glossier road surfaces (0 dry … 1 soaked) */
  setWet(w: number): void {
    for (const m of this.wetMats) {
      let b = this.wetBase.get(m); if (!b) { b = { r: m.roughness, c: m.color.clone() }; this.wetBase.set(m, b); }
      m.roughness = THREE.MathUtils.lerp(b.r, 0.16, w); m.color.copy(b.c).multiplyScalar(1 - 0.38 * w);
    }
  }
  footprints: { x: number; z: number; w: number; d: number; kind: string }[] = [];
  private windowMats: THREE.MeshStandardMaterial[] = [];
  private signMats: THREE.MeshStandardMaterial[] = [];
  private lampMat = new THREE.MeshStandardMaterial({ color: '#f2efe6', emissive: '#ffd9a0', emissiveIntensity: 0, roughness: 0.3 });
  private glow!: THREE.InstancedMesh;
  private lampPoints: THREE.PointLight[] = [];
  walkRects: AABB[] = [];
  guards: Character[] = [];
  lagos!: LagosDistrict;
  /** checkpoint officers (few, fixed posts) + roof light-bar materials (flash when someone nearby is wanted) */
  police: { char: Character; o: PoliceOfficer }[] = [];
  policeLights: { red: THREE.MeshStandardMaterial; blue: THREE.MeshStandardMaterial }[] = [];
  /** set by the game: a wanted player the officers are watching (or null) */
  policeAlert: { x: number; z: number } | null = null;
  private policeT = 0;
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private r = rng(4242);

  constructor(public scene: THREE.Scene, public quality: 'low' | 'medium' | 'high') {
    this.ground();
    this.roads();
    this.streetLights();
    this.footprints.push({ x: BENIN_MOTOR_PARK.x, z: BENIN_MOTOR_PARK.z, w: BENIN_MOTOR_PARK.w + 6, d: BENIN_MOTOR_PARK.d + 6, kind: 'motorpark' }); // reserve before filler buildings
    this.district();
    this.vegetation();
    // map boundary
    const B = WORLD_HALF;
    this.colliders.push({ minX: -B - 5, maxX: -B, minZ: -B - 5, maxZ: B + 5 }, { minX: B, maxX: B + 5, minZ: -B - 5, maxZ: B + 5 },
      { minX: -B - 5, maxX: -40, minZ: -B - 5, maxZ: -B }, { minX: 40, maxX: B + 5, minZ: -B - 5, maxZ: -B }, // north edge: gap to Benin Airport
      { minX: -B - 5, maxX: B + 5, minZ: B, maxZ: B + 5 });
    buildAirport(this);
    this.lagos = new LagosDistrict(this);
  }

  // ---------- helpers ----------
  private mat(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    if (!this.mats.has(key)) this.mats.set(key, make());
    return this.mats.get(key)!;
  }
  std(color: string, roughness = 0.85, metalness = 0): THREE.MeshStandardMaterial {
    return this.mat(`std${color}${roughness}${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }
  texMat(t: THREE.Texture, rx: number, ry: number, roughness = 0.9, color = '#ffffff'): THREE.MeshStandardMaterial {
    const tt = t.clone(); tt.needsUpdate = true; tt.repeat.set(rx, ry);
    return new THREE.MeshStandardMaterial({ map: tt, roughness, color });
  }
  add(obj: THREE.Mesh, cast = true, receive = true, parent: THREE.Object3D = this.scene): THREE.Mesh {
    obj.castShadow = cast && this.quality !== 'low'; obj.receiveShadow = receive; parent.add(obj); return obj;
  }
  box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.scene, cast = true): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); return this.add(mesh, cast, true, parent);
  }
  collide(x: number, z: number, w: number, d: number): void {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }
  /** Creates a group whose local +z points toward `face`, positioned at x,z. */
  local(x: number, z: number, face: Face): THREE.Group {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = FACE_ROT[face]; this.scene.add(g); return g;
  }
  footprint(x: number, z: number, front: number, depth: number, face: Face, kind: string, collide = true): void {
    const ew = face === 'e' || face === 'w';
    const w = ew ? depth : front, d = ew ? front : depth;
    if (collide) this.collide(x, z, w, d);
    this.footprints.push({ x, z, w, d, kind });
  }
  signMesh(s: SignInfo, w: number, h: number, parent: THREE.Object3D, x: number, y: number, z: number): void {
    const t = signTexture(s.text, s.bg, s.fg, s.sub ?? '', 1024, Math.round(1024 * h / w), !!s.logo);
    const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.6 });
    this.signMats.push(m);
    const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.12), [this.std('#2a2a2a'), this.std('#2a2a2a'), this.std('#2a2a2a'), this.std('#2a2a2a'), m, this.std('#2a2a2a')]);
    board.position.set(x, y, z); this.add(board, true, true, parent);
  }

  heightAt(x: number, z: number): number {
    for (const r of this.walkRects) if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return CURB_H;
    const rr = Math.hypot(x, z);
    if (rr > RING_OUT + GUTTER && rr < ARC_OUT && Math.abs(x) > ROAD_HALF && Math.abs(z) > ROAD_HALF) return CURB_H;
    return 0;
  }

  // ---------- ground & roads ----------
  private ground(): void {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000, 64, 64), this.texMat(groundTexture(), 500, 500, 0.97));
    g.rotation.x = -Math.PI / 2; this.add(g, false, true); // subdivided: huge 2-triangle planes lose depth precision far from the origin (Lagos at x≈2000)
  }

  private roads(): void {
    const roadMat = this.texMat(roadTexture(), 1, (ROAD_END - RING_OUT + 1) / 12, 0.88);
    const sideMat = this.texMat(paverTexture(), 2.4, (ROAD_END - ARC_OUT) / 1.75, 0.9);
    this.wetMats.push(roadMat, sideMat);
    const curbMat = this.texMat(concreteTexture(), 1, 40, 0.9);
    const drainMat = this.std('#1d1a14', 0.35);
    const lipMat = this.texMat(concreteTexture(), 1, 60, 0.95, '#a8a296');
    const len = ROAD_END - RING_OUT + 1, mid = RING_OUT - 1 + len / 2;
    const swLen = ROAD_END - ARC_OUT, swMid = ARC_OUT + swLen / 2;
    for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const g = new THREE.Group(); g.rotation.y = ang; this.scene.add(g); // local +z = outward along road
      const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, len), roadMat);
      road.rotation.x = -Math.PI / 2; road.position.set(0, 0.02, mid); this.add(road, false, true, g);
      for (const sx of [-1, 1]) {
        // open drainage gutter: dark wet channel between two concrete lips
        const drain = new THREE.Mesh(new THREE.PlaneGeometry(GUTTER, swLen), drainMat);
        drain.rotation.x = -Math.PI / 2; drain.position.set(sx * (ROAD_HALF + GUTTER / 2), 0.025, swMid); this.add(drain, false, true, g);
        this.box(0.1, 0.24, swLen, lipMat, sx * (ROAD_HALF + 0.05), 0.12, swMid, g, false);
        this.box(0.1, 0.3, swLen, lipMat, sx * (ROAD_HALF + GUTTER - 0.05), 0.15, swMid, g, false);
        // raised sidewalk with interlocking pavers
        const sw = new THREE.Mesh(new THREE.BoxGeometry(WALK_OUT - ROAD_HALF - GUTTER, CURB_H, swLen), [curbMat, curbMat, sideMat, curbMat, curbMat, curbMat]);
        sw.position.set(sx * (ROAD_HALF + GUTTER + (WALK_OUT - ROAD_HALF - GUTTER) / 2), CURB_H / 2, swMid); this.add(sw, false, true, g);
      }
      // zebra crossing near the roundabout
      const zebra = this.std('#d8d5cb', 0.7);
      for (let i = -6; i <= 6; i += 1.2) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 3), zebra); s.rotation.x = -Math.PI / 2; s.position.set(i, 0.03, 36); this.add(s, false, true, g); }
      const stop = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF, 0.35), zebra); stop.rotation.x = -Math.PI / 2; stop.position.set(ROAD_HALF / 2, 0.03, 38.5); // incoming lane (right-hand traffic) this.add(stop, false, true, g);
    }
    // walk rects for heightAt (world space)
    for (const sx of [-1, 1]) {
      const a = ROAD_HALF + GUTTER, b = WALK_OUT;
      const lo = sx > 0 ? a : -b, hi = sx > 0 ? b : -a;
      this.walkRects.push({ minX: lo, maxX: hi, minZ: ARC_OUT, maxZ: ROAD_END }, { minX: lo, maxX: hi, minZ: -ROAD_END, maxZ: -ARC_OUT },
        { minX: ARC_OUT, maxX: ROAD_END, minZ: lo, maxZ: hi }, { minX: -ROAD_END, maxX: -ARC_OUT, minZ: lo, maxZ: hi });
    }
    // roundabout ring
    const ringTex = asphaltTexture().clone(); ringTex.needsUpdate = true; ringTex.repeat.set(10, 10);
    const ring = new THREE.Mesh(new THREE.RingGeometry(RING_IN, RING_OUT, 96, 1), new THREE.MeshStandardMaterial({ map: ringTex, roughness: 0.88 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.022; this.add(ring, false, true);
    this.wetMats.push(ring.material as THREE.MeshStandardMaterial);
    // lane dashes on the ring
    const dash = this.std('#d6d3c8', 0.7);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2; const s = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 2.2), dash);
      s.rotation.set(-Math.PI / 2, 0, -a); s.position.set(Math.cos(a) * 19.5, 0.03, Math.sin(a) * 19.5); this.add(s, false, true);
    }
    // outer sidewalk arcs between the four roads
    const gapAng = Math.asin((ROAD_HALF + GUTTER) / (RING_OUT + 2));
    const arcMat = this.texMat(paverTexture(), 8, 8, 0.9);
    this.wetMats.push(arcMat);
    for (let q = 0; q < 4; q++) {
      const start = q * Math.PI / 2 + gapAng, length = Math.PI / 2 - 2 * gapAng;
      const shape = new THREE.Shape();
      shape.absarc(0, 0, ARC_OUT, start, start + length, false);
      shape.absarc(0, 0, RING_OUT + GUTTER, start + length, start, true);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: CURB_H, bevelEnabled: false, curveSegments: 24 });
      geo.rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
      const m = new THREE.Mesh(geo, arcMat); this.add(m, false, true);
    }
    // central island with original "Unity Column" monument (bronze, a nod to Benin's bronze-casting heritage)
    const curb = new THREE.Mesh(new THREE.CylinderGeometry(RING_IN, RING_IN, 0.3, 64), this.texMat(concreteTexture(), 8, 1, 0.9, '#b9b2a4'));
    curb.position.y = 0.15; this.add(curb, false, true);
    const grass = new THREE.Mesh(new THREE.CircleGeometry(RING_IN - 0.4, 64), this.texMat(grassTexture(), 8, 8, 0.95));
    grass.rotation.x = -Math.PI / 2; grass.position.y = 0.31; this.add(grass, false, true);
    const stone = this.texMat(concreteTexture(), 2, 2, 0.8, '#c8c0b0');
    const bronze = new THREE.MeshStandardMaterial({ color: '#6b4a2a', metalness: 0.85, roughness: 0.38 });
    this.box(7, 0.8, 7, stone, 0, 0.7, 0); this.box(5, 0.8, 5, stone, 0, 1.5, 0);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 9, 24), stone); col.position.y = 6.4; this.add(col);
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(1.15 - i * 0.08, 0.12, 10, 32), bronze); t.rotation.x = Math.PI / 2; t.position.y = 3.2 + i * 3; this.add(t); }
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.95, 1.8, 8), bronze); crown.position.y = 11.8; this.add(crown);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), bronze); top.position.y = 13; this.add(top);
    this.collide(0, 0, 9, 9);
    this.footprints.push({ x: 0, z: 0, w: 26, d: 26, kind: 'island' });
  }

  private streetLights(): void {
    const pts: { x: number; z: number; ang: number }[] = [];
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      for (let d = 40; d < ROAD_END - 5; d += 24) for (const side of [-1, 1]) {
        const off = side * 10.4;
        const x = dx * d + (dz !== 0 ? off : 0), z = dz * d + (dx !== 0 ? off : 0);
        const toRoad = Math.atan2(dz !== 0 ? -off : 0, dx !== 0 ? -off : 0);
        pts.push({ x, z, ang: toRoad });
      }
    }
    for (let q = 0; q < 4; q++) for (const k of [-0.32, 0, 0.32]) {
      const a = q * Math.PI / 2 + Math.PI / 4 + k; const r = 29.6;
      pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, ang: Math.atan2(-Math.sin(a), -Math.cos(a)) });
    }
    const poleGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.09, 0.14, 8, 8).translate(0, 4, 0),
      new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6).rotateZ(Math.PI / 2).translate(1.05, 7.9, 0),
      new THREE.CylinderGeometry(0.25, 0.3, 0.5, 8).translate(0, 0.25, 0),
    ]);
    const headGeo = new THREE.BoxGeometry(0.7, 0.14, 0.32).translate(2.1, 7.86, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: '#5d6266', metalness: 0.7, roughness: 0.5 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, pts.length);
    const heads = new THREE.InstancedMesh(headGeo, this.lampMat, pts.length);
    this.glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: radialGlowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffb36b' }), pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    pts.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -p.ang);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, s); poles.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      const gx = p.x + Math.cos(p.ang) * 2.1, gz = p.z + Math.sin(p.ang) * 2.1;
      m.compose(new THREE.Vector3(gx, 0.06 + (i % 7) * 0.002, gz), new THREE.Quaternion(), s); this.glow.setMatrixAt(i, m);
    });
    poles.castShadow = this.quality !== 'low'; poles.receiveShadow = true;
    this.scene.add(poles, heads, this.glow);
    this.glow.renderOrder = 2;
    // a few real point lights around the roundabout on higher settings
    const nReal = this.quality === 'high' ? 6 : this.quality === 'medium' ? 3 : 0;
    for (let i = 0; i < nReal; i++) {
      const p = pts[pts.length - 1 - i * 2];
      const L = new THREE.PointLight('#ffc988', 0, 24, 1.6);
      L.position.set(p.x + Math.cos(p.ang) * 2.1, 7.4, p.z + Math.sin(p.ang) * 2.1);
      this.scene.add(L); this.lampPoints.push(L);
    }
  }

  // ---------- buildings ----------
  building(o: BuildingOpts): THREE.Group {
    const g = this.local(o.x, o.z, o.face);
    const FH = 3.3, h = o.floors * FH + 0.4;
    const wall = this.texMat(plasterTexture(o.color, o.seed), Math.max(1, o.front / 8), Math.max(1, h / 8), 0.92);
    this.box(o.front, h, o.depth, wall, 0, h / 2, 0, g);
    this.footprint(o.x, o.z, o.front, o.depth, o.face, 'building');
    // facade windows on all four sides
    const winFloors = o.shop ? o.floors - 1 : o.floors;
    if (winFloors > 0) {
      const sides: [number, number, number, number][] = [[o.front, 0, o.depth / 2 + 0.03, 0], [o.front, 0, -o.depth / 2 - 0.03, Math.PI], [o.depth, o.front / 2 + 0.03, 0, Math.PI / 2], [o.depth, -o.front / 2 - 0.03, 0, -Math.PI / 2]];
      sides.forEach(([len, px, pz, ry], si) => {
        const cols = Math.max(1, Math.floor((len - 1) / 3.2));
        const wt = windowTexture(cols, winFloors, o.seed * 7 + si, o.glass ? 'glass' : 'res');
        const m = new THREE.MeshStandardMaterial({ map: wt.map, emissiveMap: wt.emissive, emissive: '#ffffff', emissiveIntensity: 0, transparent: !o.glass, alphaTest: o.glass ? 0 : 0.4, roughness: o.glass ? 0.12 : 0.6, metalness: o.glass ? 0.5 : 0 });
        this.windowMats.push(m);
        const wh = winFloors * FH, y0 = o.shop ? FH + wh / 2 : wh / 2 + 0.1;
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(cols * 3.2, wh), m);
        plane.position.set(px, y0, pz); plane.rotation.y = ry; this.add(plane, false, false, g);
      });
    }
    // parapet + roof slab + water tank
    const trim = this.std('#8f8a80', 0.9);
    if (o.simple) { this.box(o.front + 0.3, 0.5, o.depth + 0.3, trim, 0, h + 0.2, 0, g); return g; }
    this.box(o.front + 0.3, 0.25, o.depth + 0.3, trim, 0, h + 0.05, 0, g);
    for (const f of [1, -1]) { this.box(o.front + 0.3, 0.7, 0.2, wall, 0, h + 0.4, f * (o.depth / 2 + 0.05), g); this.box(0.2, 0.7, o.depth + 0.3, wall, f * (o.front / 2 + 0.05), h + 0.4, 0, g); }
    for (let i = 1; i < o.floors; i++) this.box(o.front + 0.12, 0.18, o.depth + 0.12, trim, 0, i * FH, 0, g); // floor bands
    if (o.tank !== false) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.6, 18), this.std('#1b1c1e', 0.6));
      tank.position.set(o.front / 2 - 1.6, h + 1.35, -o.depth / 2 + 1.6); this.add(tank, true, true, g);
      this.box(1.8, 0.5, 1.8, this.std('#6b6b68', 0.8, 0.4), o.front / 2 - 1.6, h + 0.3, -o.depth / 2 + 1.6, g);
    }
    // balconies with balustrades on the street front
    if (o.balconies && o.floors > 1) {
      const rail = this.balusterMat();
      const bw = Math.min(o.front * 0.7, 9);
      for (let i = 1; i < o.floors; i++) {
        const y = i * FH;
        this.box(bw, 0.18, 1.3, trim, 0, y, o.depth / 2 + 0.65, g);
        const rp = new THREE.Mesh(new THREE.PlaneGeometry(bw, 1.0), rail); rp.position.set(0, y + 0.58, o.depth / 2 + 1.28); this.add(rp, true, false, g);
        for (const sx of [-1, 1]) { const sp = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0), rail); sp.rotation.y = Math.PI / 2; sp.position.set(sx * bw / 2, y + 0.58, o.depth / 2 + 0.65); this.add(sp, true, false, g); }
        this.box(bw, 0.06, 0.12, this.std('#d7d2c6', 0.6), 0, y + 1.1, o.depth / 2 + 1.28, g);
      }
    }
    // shop front with sign, awning and shutters/glass
    if (o.shop) {
      const sf = this.texMat(corrugatedTexture(), o.front / 3, 1, 0.6, '#9aa0a4');
      const glass = this.mat('shopglass', () => new THREE.MeshPhysicalMaterial({ color: '#1e2a2e', roughness: 0.05, metalness: 0.3, clearcoat: 1 }));
      const n = Math.max(1, Math.floor(o.front / 4.5));
      for (let i = 0; i < n; i++) {
        const x = -o.front / 2 + (i + 0.5) * (o.front / n);
        const p = new THREE.Mesh(new THREE.PlaneGeometry(o.front / n - 0.6, 2.6), o.shutters && i % 2 === 1 ? sf : glass);
        p.position.set(x, 1.4, o.depth / 2 + 0.04); this.add(p, false, true, g);
      }
      this.signMesh(o.shop, Math.min(o.front - 0.6, 12), 1.2, g, 0, FH + 0.15, o.depth / 2 + 0.25);
      this.box(o.front, 0.1, 1.6, this.std('#4a4f4f', 0.6, 0.5), 0, FH - 0.55, o.depth / 2 + 0.8, g);
    }
    return g;
  }

  private balusterMat(): THREE.MeshStandardMaterial {
    return this.mat('baluster', () => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64; const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 256, 64); ctx.fillStyle = '#d9d4c8';
      ctx.fillRect(0, 0, 256, 8); ctx.fillRect(0, 56, 256, 8);
      for (let x = 6; x < 256; x += 16) { ctx.beginPath(); ctx.ellipse(x, 32, 4, 22, 0, 0, Math.PI * 2); ctx.fill(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1);
      return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
    });
  }

  private district(): void {
    // ---- North road, east side (face west)
    this.building({ x: 20, z: -46, front: 18, depth: 14, floors: 4, face: 'w', color: '#b9c0c4', seed: 1, glass: true, shop: { text: 'EDO HERITAGE BANK', bg: '#0f3b5c', fg: '#f1e7c9', sub: 'Banking for the people of Edo' }, tank: false });
    this.building({ x: 19, z: -71, front: 16, depth: 12, floors: 3, face: 'w', color: '#e6dcc4', seed: 2, balconies: true });
    this.church(26, -104);
    // ---- North road, west side (face east)
    this.fuelStation(-24, -48);
    this.building({ x: -19, z: -75, front: 14, depth: 12, floors: 4, face: 'e', color: '#d7e0d0', seed: 3, balconies: true });
    this.mosque(-26, -106);
    this.building({ x: -20, z: -140, front: 16, depth: 14, floors: 3, face: 'e', color: '#b7a58a', seed: 4, balconies: true });
    this.building({ x: 20, z: -140, front: 16, depth: 14, floors: 2, face: 'w', color: '#d0c3a8', seed: 5, shop: { text: 'IKPOBA PHARMACY', bg: '#1d5e3a', fg: '#ffffff' } });
    // ---- East road, north side (face south)
    this.building({ x: 42, z: -19, front: 14, depth: 12, floors: 2, face: 's', color: '#d8d0c0', seed: 6, shop: { text: 'UYI FASHION HOUSE', bg: '#2b2420', fg: '#e8c27a', sub: 'Ankara • Lace • Native wear' } });
    this.mannequins(42, -12.6);
    // licensed gun dealer (original, fictional): steel shutters, barred windows, bollards
    this.building({ x: 68, z: -20, front: 18, depth: 14, floors: 2, face: 's', color: '#8d8a84', seed: 7, shop: { text: 'EKEHUAN ARMS & LICENSING', bg: '#1d1f22', fg: '#e0b04a', sub: 'Licensed firearms dealer • 18+ • Licence & ID required' }, shutters: true, tank: false });
    this.gunShopDetails(68, -12.9);
    this.building({ x: 100, z: -20, front: 22, depth: 14, floors: 2, face: 's', color: '#d3d6d8', seed: 8, shop: { text: 'POLICE STATION', bg: '#152c5a', fg: '#ffffff', sub: 'Nigeria Police Force • Fines & reports' }, tank: false });
    this.building({ x: 128, z: -20, front: 20, depth: 14, floors: 3, face: 's', color: '#bfae95', seed: 9, shop: { text: 'SAPELE RD PLAZA', bg: '#5a1a1a', fg: '#f2e6cf', sub: 'Shops & offices' }, shutters: true });
    this.building({ x: 160, z: -20, front: 18, depth: 14, floors: 4, face: 's', color: '#c4b8a6', seed: 10, balconies: true });
    // ---- East road, south side (face north)
    this.carWash();
    this.building({ x: 72, z: 19, front: 16, depth: 12, floors: 3, face: 'n', color: '#dfe6e8', seed: 11, balconies: true });
    this.mansion();
    this.building({ x: 165, z: 20, front: 18, depth: 14, floors: 3, face: 'n', color: '#c2ad8c', seed: 12, balconies: true });
    // ---- South road, east side: market
    this.market();
    this.building({ x: 20, z: 110, front: 16, depth: 14, floors: 3, face: 'w', color: '#cbb894', seed: 13, balconies: true });
    this.building({ x: 20, z: 145, front: 18, depth: 14, floors: 2, face: 'w', color: '#d6c9ae', seed: 14, shop: { text: 'OBA MARKET STORES', bg: '#3c3c1a', fg: '#f5e9c8' }, shutters: true });
    // ---- South road, west side
    this.building({ x: -18, z: 44, front: 12, depth: 10, floors: 1, face: 'e', color: '#e0cfa9', seed: 15, shop: { text: 'MAMA EFE KITCHEN', bg: '#7a3b12', fg: '#fff2d8', sub: 'Banga soup • Starch • Rice' } });
    this.building({ x: -19, z: 68, front: 16, depth: 12, floors: 3, face: 'e', color: '#efe6d0', seed: 16, balconies: true });
    this.building({ x: -19, z: 94, front: 16, depth: 12, floors: 2, face: 'e', color: '#b9ab94', seed: 17, shop: { text: 'GODIS GREAT VENTURES', bg: '#20304a', fg: '#ffffff', sub: 'Phones • Accessories • POS' }, shutters: true });
    this.building({ x: -20, z: 122, front: 18, depth: 14, floors: 4, face: 'e', color: '#d2c5ad', seed: 18, balconies: true, shop: { text: 'UWELU APARTMENTS', bg: '#3a2f25', fg: '#f2e2c4' } });
    // ---- West road, north side (face south)
    this.building({ x: -46, z: -18, front: 12, depth: 10, floors: 2, face: 's', color: '#d6c39d', seed: 19, shop: { text: 'OSAS PROVISIONS', bg: '#8a1c1c', fg: '#ffffff', sub: 'Provisions • Drinks • Recharge cards' }, shutters: true });
    this.building({ x: -70, z: -20, front: 20, depth: 14, floors: 4, face: 's', color: '#e8d9b8', seed: 20, balconies: true, shop: { text: 'IYARE GUEST HOUSE', bg: '#2d1f3a', fg: '#f0d79a' } });
    // Ogbe General Hospital: white block, red crosses, ambulance bay (respawn point)
    this.building({ x: -100, z: -20, front: 22, depth: 14, floors: 3, face: 's', color: '#f1f1ee', seed: 21, shop: { text: 'OGBE GENERAL HOSPITAL', bg: '#ffffff', fg: '#b01e23', sub: 'Accident & Emergency • 24 hours' }, glass: true, tank: false });
    this.hospitalDetails(-100, -12.9);
    this.building({ x: -135, z: -20, front: 18, depth: 14, floors: 2, face: 's', color: '#cbbd9f', seed: 22, shop: { text: 'ESOSA AUTO SPARES', bg: '#1d1d1d', fg: '#f2c14e' }, shutters: true });
    // ---- West road, south side: car park + apartments
    this.carPark();
    this.building({ x: -53, z: 50, front: 30, depth: 12, floors: 3, face: 'n', color: '#e4dccb', seed: 23, balconies: true });
    this.building({ x: -100, z: 20, front: 18, depth: 14, floors: 3, face: 'n', color: '#d8dccd', seed: 24, balconies: true });
    this.building({ x: -140, z: 20, front: 18, depth: 14, floors: 2, face: 'n', color: '#c7b08c', seed: 25, shop: { text: 'BLESSED HANDS SALON', bg: '#5b2048', fg: '#ffffff' } });
    // ---- second row skyline
    const r = rng(77);
    for (const [x, z] of [[45, -55], [60, -80], [-45, -60], [-60, -90], [45, 60], [60, 90], [-50, 85], [-80, 60], [85, -60], [-90, -55], [95, 85], [-100, 100], [110, -100], [-120, -110], [130, 120]]) {
      this.building({ x, z, front: 14 + r() * 10, depth: 12 + r() * 6, floors: 2 + Math.floor(r() * 4), face: (['n', 's', 'e', 'w'] as Face[])[Math.floor(r() * 4)], color: ['#c9b9a0', '#b7a58a', '#d0c3a8', '#bfae95', '#a9a08f'][Math.floor(r() * 5)], seed: 30 + Math.floor(r() * 50), balconies: r() < 0.5 });
    }
    this.carStands();
    this.mechanicWorkshop();
    this.policeCheckpoints();
    this.jobBoards();
    buildHouseExteriors({ scene: this.scene, colliders: this.colliders, quality: this.quality, lights: [], footprints: this.footprints });
    const built = buildInteriors({ scene: this.scene, colliders: this.colliders, quality: this.quality });
    this.guards.push(...built.guards); this.interiorLights = built.lights;
    this.fillerBuildings();
    // city billboard for the (fictional) Afrobeats star Eghosa Nova
    const pb = this.local(60, -38, 's');
    for (const sx of [-2, 2]) this.box(0.3, 6, 0.3, this.std('#3d3f40', 0.6, 0.7), sx, 3, 0, pb);
    const pm = new THREE.MeshStandardMaterial({ map: posterTexture(), emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.6 });
    pm.emissiveMap = pm.map; this.signMats.push(pm);
    const pboard = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), pm); pboard.position.set(0, 7.5, 0.2); this.add(pboard, false, false, pb);
    // billboard (fictional ad)
    const bb = this.local(-38, -38, 's'); bb.rotation.y = Math.PI / 4;
    for (const sx of [-2.5, 2.5]) this.box(0.3, 7, 0.3, this.std('#3d3f40', 0.6, 0.7), sx, 3.5, 0, bb);
    this.signMesh({ text: 'WORK HARD. STAY SAFE.', bg: '#1d2b22', fg: '#f0e6c8', sub: 'Benin City · BENINLIFE' }, 10, 3.6, bb, 0, 8, 0.2);
    // parked SUVs
    this.parkedCar('#141518', true, 13.5, -62, 0); this.parkedCar('#e6e6e2', true, -13.5, 60, Math.PI);
  }

  /** Distant blocks so the district doesn't end in an empty plain (fewer on Low). */
  /** Osaze Mechanic Workshop (West road): open-front shed, tool wall, tyres, drums, car lift. Mechanic job site. */
  private mechanicWorkshop(): void {
    const J = STATION_JOBS.mechanic; const cx = J.car.x, z0 = -11.6, z1 = -25, x0 = cx - 8, x1 = cx + 8;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z0 - z1), this.texMat(concreteTexture(), 4, 3, 0.85, '#9a958c'));
    pad.rotation.x = -Math.PI / 2; pad.position.set(cx, 0.03, (z0 + z1) / 2); this.add(pad, false, true);
    // oil stains
    for (const [dx, dz, r] of [[0, -18.5, 1.3], [-4, -20, 0.6], [3.5, -16, 0.5]]) { const s = new THREE.Mesh(new THREE.CircleGeometry(r, 20), new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.3, transparent: true, opacity: 0.55 })); s.rotation.x = -Math.PI / 2; s.position.set(cx + dx, 0.035, dz); this.add(s, false, true); }
    const wall = this.texMat(plasterTexture('#c9bfa8', 61), 2, 1, 0.92);
    this.box(x1 - x0, 4.2, 0.3, wall, cx, 2.1, z1); this.collide(cx, z1, x1 - x0, 0.4);
    for (const x of [x0, x1]) { this.box(0.3, 4.2, 6, wall, x, 2.1, z1 + 3); this.collide(x, z1 + 3, 0.4, 6); }
    const steel = this.std('#6d7275', 0.5, 0.7);
    for (const x of [x0 + 0.3, x1 - 0.3]) { this.box(0.2, 4.4, 0.2, steel, x, 2.2, z0 - 0.4); this.collide(x, z0 - 0.4, 0.3, 0.3); }
    const roof = this.texMat(corrugatedTexture(), 4, 3, 0.6, '#8f6a4a');
    const rf = this.box(x1 - x0 + 1, 0.12, z0 - z1 + 0.6, roof, cx, 4.45, (z0 + z1) / 2, this.scene, true); rf.rotation.x = -0.05;
    this.signMesh({ text: 'OSAZE MECHANIC WORKSHOP', bg: '#1d1d1d', fg: '#f2c14e', sub: 'Repairs • Servicing • Tyres • Vulcanizer' }, 12, 1.5, this.scene, cx, 5.4, z0 - 0.3);
    // tool wall + bench
    this.box(5, 0.9, 0.8, this.std('#5a4630', 0.8), cx - 4.5, 0.45, z1 + 0.7); this.collide(cx - 4.5, z1 + 0.7, 5, 0.8);
    const board = this.box(5, 1.6, 0.05, this.std('#8a7a5a', 0.9), cx - 4.5, 2.0, z1 + 0.18);
    void board;
    for (let i = 0; i < 9; i++) this.box(0.06, 0.35 + (i % 3) * 0.12, 0.04, this.std('#9aa0a5', 0.3, 0.9), cx - 6.6 + i * 0.5, 2.1, z1 + 0.22);
    // tyre stacks + oil drums
    const tyreM = this.std('#1b1b1b', 0.9);
    for (const [dx, dz, n] of [[6.6, -23.6, 5], [6.6, -21.8, 3], [-7.0, -13.5, 4]] as [number, number, number][]) {
      for (let k = 0; k < n; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.13, 10, 20), tyreM); t.rotation.x = Math.PI / 2; t.position.set(cx + dx, 0.14 + k * 0.26, dz); this.add(t); }
      this.collide(cx + dx, dz, 1, 1);
    }
    for (const [dx, dz, c] of [[5.6, -13.4, '#1d4f8c'], [6.6, -13.4, '#8c2a1d'], [6.1, -14.4, '#2a2a2a']] as [number, number, string][]) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), this.std(c, 0.5, 0.4)); d.position.set(cx + dx, 0.45, dz); this.add(d); this.collide(cx + dx, dz, 0.6, 0.6);
    }
    // two-post lift
    for (const sx of [-1.6, 1.6]) { this.box(0.25, 3.6, 0.25, this.std('#c23a2a', 0.5, 0.5), cx + sx, 1.8, J.car.z - 0.3); }
    this.footprints.push({ x: cx, z: (z0 + z1) / 2, w: x1 - x0 + 1, d: z0 - z1 + 1, kind: 'mechanic' });
  }
  /** small "Jobs" boards where station shifts start */
  private jobBoards(): void {
    for (const j of Object.values(STATION_JOBS)) {
      const g = this.local(j.start.x, j.start.z - 1.2, 's');
      this.box(0.08, 1.4, 0.08, this.std('#444', 0.6, 0.6), 0, 0.7, 0, g);
      this.signMesh({ text: 'JOBS', bg: '#1d5e3a', fg: '#ffffff', sub: `${j.name} · start here · ₦${j.pay.toLocaleString()} per car` }, 1.8, 0.7, g, 0, 1.75, 0);
    }
  }

  private fillerBuildings(): void {
    const r = rng(91);
    const palette = ['#e2d8c3', '#d9cfae', '#cfd6c4', '#c8d0d6', '#e6dfd2', '#d8c9a6', '#bfc7b5', '#e0d2bd'];
    const step = this.quality === 'low' ? 44 : 30;
    for (let x = -175; x <= 175; x += step) for (let z = -175; z <= 175; z += step) {
      const jx = x + (r() - 0.5) * 8, jz = z + (r() - 0.5) * 8;
      const w = 12 + r() * 10, d = 10 + r() * 8;
      if (Math.abs(jx) < 16 + w / 2 || Math.abs(jz) < 16 + d / 2) continue; // keep road corridors clear
      if (Math.hypot(jx, jz) < 70) continue;
      const overlap = this.footprints.some((f) => Math.abs(f.x - jx) < (f.w + w) / 2 + 4 && Math.abs(f.z - jz) < (f.d + d) / 2 + 4);
      if (overlap) continue;
      this.building({ x: jx, z: jz, front: w, depth: d, floors: 1 + Math.floor(r() * 4), face: (['n', 's', 'e', 'w'] as Face[])[Math.floor(r() * 4)], color: palette[Math.floor(r() * palette.length)], seed: 60 + Math.floor(r() * 40), simple: true, tank: false });
    }
  }

  parkedCar(color: string, suv: boolean, x: number, z: number, rot: number, dirt = 0.1): Car {
    const c = new Car(color, { suv }); c.group.position.set(x, 0, z); c.group.rotation.y = rot; c.setDirt(dirt);
    c.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = this.quality !== 'low'; });
    this.scene.add(c.group);
    const ew = Math.abs(Math.sin(rot)) > 0.7; this.collide(x, z, ew ? 4.6 : 2, ew ? 2 : 4.6);
    return c;
  }

  private church(x: number, z: number): void {
    const g = this.local(x, z, 'w');
    const wall = this.texMat(plasterTexture('#e4ddcf', 40), 3, 2, 0.9);
    this.box(14, 9, 24, wall, 0, 4.5, -2, g);
    const roofGeo = new THREE.CylinderGeometry(0.01, 9.2, 5, 4, 1, false, Math.PI / 4); roofGeo.scale(1, 1, 1.85);
    const roof = new THREE.Mesh(roofGeo, this.std('#5e2b22', 0.7, 0.2)); roof.position.set(0, 11.5, -2); this.add(roof, true, true, g);
    const tower = this.box(5, 17, 5, wall, 0, 8.5, 10.5, g); tower.castShadow = true;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(3.3, 6, 4, 1), this.std('#5e2b22', 0.7, 0.2)); spire.rotation.y = Math.PI / 4; spire.position.set(0, 20, 10.5); this.add(spire, true, true, g);
    const gold = this.std('#b8963e', 0.4, 0.8);
    this.box(0.25, 2.2, 0.25, gold, 0, 24, 10.5, g); this.box(1.2, 0.25, 0.25, gold, 0, 24.4, 10.5, g);
    const glass = new THREE.MeshStandardMaterial({ color: '#2a3b5a', emissive: '#c9a35a', emissiveIntensity: 0, roughness: 0.2 }); this.windowMats.push(glass);
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 4), glass); w.position.set(sx * 7.03, 4.8, -11 + i * 4.4); w.rotation.y = sx * Math.PI / 2; this.add(w, false, false, g); }
    this.box(2.6, 4, 0.2, this.std('#3b2414', 0.7), 0, 2, 13.05, g);
    this.signMesh({ text: 'GRACE ASSEMBLY CHURCH', bg: '#f1ece0', fg: '#3a2a1a', sub: 'Sunday service 8am & 10am' }, 9, 1.4, g, 0, 5.2, 13.2);
    this.footprint(x, z + 0, 14, 30, 'w', 'church');
  }

  private mosque(x: number, z: number): void {
    const g = this.local(x, z, 'e');
    const wall = this.texMat(plasterTexture('#ece6d8', 41), 3, 2, 0.9);
    this.box(18, 8, 18, wall, 0, 4, 0, g);
    const green = new THREE.MeshStandardMaterial({ color: '#2f5a44', roughness: 0.45, metalness: 0.3 });
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 2, 32), wall); drum.position.y = 9; this.add(drum, true, true, g);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(5.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), green); dome.position.y = 10; this.add(dome, true, true, g);
    const gold = this.std('#b8963e', 0.4, 0.8);
    this.box(0.15, 2, 0.15, gold, 0, 16, 0, g);
    const crescent = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 20, Math.PI * 1.4), gold); crescent.position.set(0, 17.2, 0); crescent.rotation.z = Math.PI * 0.8; this.add(crescent, false, false, g);
    for (const sx of [-1, 1]) {
      const min = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 20, 16), wall); min.position.set(sx * 8, 10, 8); this.add(min, true, true, g);
      const bal = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.2, 0.6, 16), wall); bal.position.set(sx * 8, 16, 8); this.add(bal, true, true, g);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1, 2.5, 16), green); cap.position.set(sx * 8, 21.2, 8); this.add(cap, true, true, g);
    }
    const arch = this.std('#3b2f22', 0.8);
    for (let i = -2; i <= 2; i++) { const a = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3.6), arch); a.position.set(i * 3.2, 1.9, 9.03); this.add(a, false, false, g); }
    const glass = new THREE.MeshStandardMaterial({ color: '#2c3a3a', emissive: '#f0c070', emissiveIntensity: 0 }); this.windowMats.push(glass);
    for (let i = -2; i <= 2; i++) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.8), glass); w.position.set(i * 3.2, 6, 9.03); this.add(w, false, false, g); }
    this.signMesh({ text: 'CENTRAL MOSQUE', bg: '#1f4a36', fg: '#f3ead2' }, 7, 1.1, g, 0, 4.4, 9.15);
    this.footprint(x, z, 20, 20, 'e', 'mosque');
  }

  private fuelStation(x: number, z: number): void {
    const g = this.local(x, z, 'e');
    const conc = this.texMat(concreteTexture(), 6, 6, 0.85, '#b5b0a6');
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(28, 22), conc); apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.03, 0); this.add(apron, false, true, g);
    const white = this.std('#e9e7e1', 0.5, 0.2), red = this.std('#8c1d18', 0.5, 0.2);
    this.box(18, 0.9, 10, white, 0, 6, 2, g);
    this.box(18.05, 0.35, 10.05, red, 0, 5.7, 2, g);
    const under = new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: '#fff6e0', emissiveIntensity: 0 }); this.signMats.push(under);
    const ul = new THREE.Mesh(new THREE.PlaneGeometry(17, 9), under); ul.rotation.x = Math.PI / 2; ul.position.set(0, 5.54, 2); this.add(ul, false, false, g);
    for (const [px, pz] of [[-6, 0], [6, 0], [-6, 4], [6, 4]]) { this.box(0.4, 5.6, 0.4, white, px, 2.8, pz, g); }
    for (const px of [-6, 6]) for (const pz of [0, 4]) {
      this.box(1.1, 1.8, 0.6, this.std('#2b2d30', 0.5, 0.3), px, 0.9 + 0.15, pz, g);
      this.box(1.12, 0.4, 0.62, red, px, 1.75, pz, g);
      this.box(1.6, 0.25, 1.2, this.std('#9a9890', 0.9), px, 0.12, pz, g);
    }
    // collide pump islands (world space)
    const toW = (lx: number, lz: number): [number, number] => { const v = new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), g.rotation.y); return [x + v.x, z + v.z]; };
    for (const px of [-6, 6]) for (const pz of [0, 4]) { const [wx, wz] = toW(px, pz); this.collide(wx, wz, 1.4, 1.4); }
    // kiosk shop at back
    const shop = this.box(10, 3.6, 6, this.texMat(plasterTexture('#e5e2da', 42), 2, 1, 0.9), 0, 1.8, -9, g);
    shop.castShadow = true;
    const [kx, kz] = toW(0, -9); this.collide(kx, kz, 6, 10);
    this.signMesh({ text: 'NAIJA FUEL', bg: '#8c1d18', fg: '#ffffff', sub: 'PMS • AGO • Lubricants' }, 6, 1.2, g, 0, 4.2, -5.85);
    // price totem
    this.box(0.5, 6, 0.5, this.std('#333', 0.6, 0.5), 11, 3, 9, g);
    this.signMesh({ text: 'NAIJA FUEL', bg: '#8c1d18', fg: '#ffffff', sub: 'Open 24 hours' }, 3.2, 2.2, g, 11, 6.5, 9.3);
    this.footprints.push({ x, z, w: 22, d: 28, kind: 'fuel' });
  }

  private carWash(): void {
    const Z = CARWASH_ZONE;
    const g = new THREE.Group(); g.position.set(Z.x, 0, Z.z); this.scene.add(g);
    const wet = new THREE.MeshStandardMaterial({ color: '#7d7f80', roughness: 0.25, metalness: 0.0 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(Z.w + 3, Z.d + 2), wet); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.035; this.add(floor, false, true, g);
    // bay outline (blue)
    const blue = new THREE.MeshStandardMaterial({ color: '#2b6cb0', emissive: '#2b6cb0', emissiveIntensity: 0.25 });
    for (const [w, d, x, z] of [[Z.w, 0.2, 0, Z.d / 2], [Z.w, 0.2, 0, -Z.d / 2], [0.2, Z.d, Z.w / 2, 0], [0.2, Z.d, -Z.w / 2, 0]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), blue); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.045, z); this.add(s, false, false, g);
    }
    const steel = this.std('#7d8285', 0.5, 0.7);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      this.box(0.3, 4.6, 0.3, steel, sx * (Z.w / 2 + 1), 2.3, sz * (Z.d / 2 + 0.5), g);
      this.collide(Z.x + sx * (Z.w / 2 + 1), Z.z + sz * (Z.d / 2 + 0.5), 0.5, 0.5);
    }
    const roof = this.texMat(corrugatedTexture(), 3, 3, 0.5, '#9fb3c2');
    this.box(Z.w + 3, 0.15, Z.d + 2, roof, 0, 4.7, 0, g, false); // translucent-style roof: no hard shadow
    const tube = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f4ff', emissiveIntensity: 1.5 });
    for (const sx of [-2.5, 2.5]) this.box(0.15, 0.08, Z.d - 2, tube, sx, 4.58, 0, g, false);
    // back wall with hose reels
    this.box(Z.w + 3, 3, 0.3, this.texMat(plasterTexture('#cfd8dc', 43), 2, 1, 0.9), 0, 1.5, Z.d / 2 + 1.1, g);
    this.collide(Z.x, Z.z + Z.d / 2 + 1.1, Z.w + 3, 0.4);
    for (const sx of [-2, 2]) { const reel = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.08, 8, 16), this.std('#c2a12a', 0.6)); reel.position.set(sx, 1.6, Z.d / 2 + 0.9); this.add(reel, false, false, g); }
    this.signMesh({ text: 'RING ROAD CAR WASH', bg: '#0f4c81', fg: '#ffffff', sub: 'Drive in · ₦500 per wash' }, Z.w + 2, 1.4, this.local(Z.x, Z.z - Z.d / 2 - 1.1, 'n'), 0, 5.6, 0);
    this.footprints.push({ x: Z.x, z: Z.z, w: Z.w + 3, d: Z.d + 2, kind: 'carwash' });
    // attendant kiosk
    this.box(3, 2.6, 3, this.texMat(plasterTexture('#d9d2c2', 44), 1, 1, 0.9), 7.5, 1.3, 2, g);
    this.collide(Z.x + 7.5, Z.z + 2, 3, 3);
  }

  private mansion(): void {
    // BEST 𝕏 compound: perimeter wall with gate, villa, guards
    const x0 = 92, x1 = 142, z0 = 14, z1 = 60, gateW = 7, gx = 117;
    const wallMat = this.texMat(plasterTexture('#e3dccb', 45), 8, 1, 0.9);
    const H = 2.8;
    const seg = (ax: number, az: number, bx: number, bz: number) => {
      const w = Math.abs(bx - ax) || 0.4, d = Math.abs(bz - az) || 0.4, cx = (ax + bx) / 2, cz = (az + bz) / 2;
      this.box(w, H, d, wallMat, cx, H / 2, cz); this.box(w + 0.1, 0.15, d + 0.1, this.std('#8f8a80'), cx, H + 0.07, cz);
      this.collide(cx, cz, w, d);
    };
    seg(x0, z0, gx - gateW / 2, z0); seg(gx + gateW / 2, z0, x1, z0); seg(x0, z1, x1, z1); seg(x0, z0, x0, z1); seg(x1, z0, x1, z1);
    // razor wire on wall top
    const wire = this.std('#6e6e6e', 0.4, 0.9);
    for (const [ax, bx, z] of [[x0, gx - gateW / 2, z0], [gx + gateW / 2, x1, z0]]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, bx - ax, 6, 1, true), wire); c.rotation.z = Math.PI / 2; c.position.set((ax + bx) / 2, H + 0.35, z); (c.material as THREE.MeshStandardMaterial).wireframe = true; this.add(c, false, false); }
    // gate pillars & gate
    const pillar = this.texMat(plasterTexture('#cbbf9f', 46), 1, 1, 0.8);
    const gateMat = this.std('#141414', 0.45, 0.8);
    for (const sx of [-1, 1]) {
      this.box(1.1, 3.6, 1.1, pillar, gx + sx * (gateW / 2 + 0.55), 1.8, z0, this.scene);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), this.lampMat); lamp.position.set(gx + sx * (gateW / 2 + 0.55), 3.85, z0); this.add(lamp, false, false);
      this.collide(gx + sx * (gateW / 2 + 0.55), z0, 1.1, 1.1);
    }
    const gate = new THREE.Group(); gate.position.set(gx, 0, z0); this.scene.add(gate);
    this.box(gateW, 2.9, 0.12, gateMat, 0, 1.55, 0, gate);
    const gold = this.std('#a8873a', 0.35, 0.9);
    for (let i = -3; i <= 3; i++) this.box(0.08, 2.9, 0.16, gold, i * 0.95, 1.55, 0, gate);
    this.box(gateW, 0.12, 0.18, gold, 0, 2.95, 0, gate);
    this.collide(gx, z0, gateW, 0.6);
    const crownM = new THREE.MeshStandardMaterial({ map: crownTexture(), transparent: true, metalness: 0.7, roughness: 0.3, emissive: '#5a3a0a', emissiveIntensity: 0.4, side: THREE.DoubleSide });
    const cm = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.35), crownM); cm.position.set(0, 1.7, -0.1); cm.rotation.y = Math.PI; gate.add(cm);
    this.signMesh({ text: 'BEST 𝕏 MANSION', bg: '#0b0b0b', fg: '#d9b45a', sub: 'Private residence', logo: true }, 5, 1.1, this.local(gx, z0 - 0.15, 'n'), 0, 4.3, 0);
    // compound floor
    const pav = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), this.texMat(paverTexture(), 12, 10, 0.85));
    pav.rotation.x = -Math.PI / 2; pav.position.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2); this.add(pav, false, true);
    // villa
    const v = this.local(gx, 42, 'n');
    const vw = this.texMat(plasterTexture('#efe7d6', 47), 3, 1, 0.85);
    this.box(28, 7.4, 14, vw, 0, 3.7, 0, v);
    this.box(14, 3.6, 10, vw, -2, 9.2, -1, v);
    const roofM = this.std('#3f3a36', 0.7, 0.2);
    this.box(29, 0.4, 15, roofM, 0, 7.6, 0, v); this.box(15, 0.4, 11, roofM, -2, 11.2, -1, v);
    const col = this.std('#f4efe4', 0.6);
    for (let i = -2; i <= 2; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 7, 16), col); c.position.set(i * 3.4, 3.5, 8.3); this.add(c, true, true, v); }
    this.box(17, 0.4, 3, col, 0, 7.2, 8.0, v);
    const wt = windowTexture(8, 2, 99, 'glass');
    const wm = new THREE.MeshStandardMaterial({ map: wt.map, emissiveMap: wt.emissive, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.1, metalness: 0.5 }); this.windowMats.push(wm);
    const wp = new THREE.Mesh(new THREE.PlaneGeometry(24, 6), wm); wp.position.set(0, 3.6, 7.03); this.add(wp, false, false, v);
    this.collide(gx, 42, 28, 14);
    this.footprints.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, kind: 'mansion' });
    // BEST 𝕏's pearl-white RX 350-style SUV parked behind his main car (the white GLK-style, his active vehicle)
    { const c = new Car('#e9e9e4', { body: 'suv', model: 'rx350' }); c.group.position.set(134, 0, 10.2); c.group.rotation.y = -Math.PI / 2; c.setDirt(0);
      c.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = this.quality !== 'low'; });
      this.scene.add(c.group); this.collide(134, 10.2, 4.8, 2); }
    // guards in dark suits & sunglasses flanking the gate (scenery NPCs)
    for (const sx of [-1, 1]) {
      const g = new Character({ body: 'male', skin: sx > 0 ? 1 : 3, outfit: 4 }, { suit: true, sunglasses: true });
      g.group.position.set(gx + sx * 5.6, CURB_H * 0 + 0, z0 - 1.6); g.group.rotation.y = Math.PI;
      g.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = this.quality !== 'low'; });
      this.scene.add(g.group); this.guards.push(g); this.collide(g.group.position.x, g.group.position.z, 0.8, 0.8);
    }
    // SUVs in compound
    this.parkedCar('#0e0f11', true, 104, 26, Math.PI / 2, 0); this.parkedCar('#1a1c20', true, 104, 32, Math.PI / 2, 0); this.parkedCar('#e8e8e4', true, 132, 26, -Math.PI / 2, 0);
    for (const [px, pz] of [[96, 18], [138, 18], [96, 56], [138, 56], [126, 22]]) this.palm(px, pz, 1.1);
  }

  /** BEST 𝕏 Car Stands: open dealership lot with bunting, canopy, office and one display car per model. */
  private carStands(): void {
    const S = CAR_STANDS;
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(S.w, S.d), this.texMat(concreteTexture(), 6, 4, 0.75));
    lot.rotation.x = -Math.PI / 2; lot.position.set(S.x, 0.025, S.z); this.add(lot, false, true);
    // kerb + low rail on three sides (entrance faces the South road on the west side)
    const rail = this.std('#c9a54a', 0.35, 0.9), post = this.std('#1a1a1a', 0.5, 0.6);
    for (const [ax, az, bx, bz] of [[S.x - S.w / 2, S.z - S.d / 2, S.x + S.w / 2, S.z - S.d / 2], [S.x - S.w / 2, S.z + S.d / 2, S.x + S.w / 2, S.z + S.d / 2], [S.x + S.w / 2, S.z - S.d / 2, S.x + S.w / 2, S.z + S.d / 2]]) {
      const len = Math.hypot(bx - ax, bz - az), cx = (ax + bx) / 2, cz = (az + bz) / 2, alongX = Math.abs(bx - ax) > 0.1;
      this.box(alongX ? len : 0.08, 0.06, alongX ? 0.08 : len, rail, cx, 0.9, cz);
      for (let i = 0; i <= Math.floor(len / 2.5); i++) { const t = i / Math.floor(len / 2.5); this.box(0.08, 0.9, 0.08, post, ax + (bx - ax) * t, 0.45, az + (bz - az) * t); }
      this.collide(cx, cz, alongX ? len : 0.3, alongX ? 0.3 : len);
    }
    // bunting flags strung across the lot
    const flagCols = ['#1d6b3a', '#f5f5f0', '#c9a54a', '#111111'];
    for (let row = 0; row < 3; row++) {
      const z = S.z - S.d / 2 + 3 + row * 7;
      for (let i = 0; i < 26; i++) { const x = S.x - S.w / 2 + 0.6 + i * (S.w - 1.2) / 25; const f = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 3), this.std(flagCols[i % 4], 0.8)); f.rotation.x = Math.PI; f.position.set(x, 4.6 - Math.sin((i / 25) * Math.PI) * 0.5, z); this.add(f, false, false); }
    }
    for (const sx of [-1, 1]) for (const zz of [S.z - S.d / 2 + 0.2, S.z + S.d / 2 - 0.2]) this.box(0.12, 5, 0.12, post, S.x + sx * (S.w / 2 - 0.2), 2.5, zz);
    // office kiosk with crown-emblem sign
    const o = S.office;
    const wall = this.texMat(plasterTexture('#f2efe6', 52), 2, 1, 0.8);
    this.box(4.5, 3.2, 5.5, wall, o.x + 1.5, 1.6, o.z); this.collide(o.x + 1.5, o.z, 4.5, 5.5);
    this.box(5, 0.25, 6, this.std('#111', 0.5, 0.4), o.x + 1.5, 3.3, o.z);
    const glass = new THREE.MeshStandardMaterial({ color: '#203040', roughness: 0.05, metalness: 0.6, emissive: '#ffd9a0', emissiveIntensity: 0 }); this.windowMats.push(glass);
    const gw = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.2), glass); gw.position.set(o.x - 0.76, 1.5, o.z); gw.rotation.y = -Math.PI / 2; this.add(gw, false, false);
    this.signMesh({ text: 'BEST 𝕏 CAR STANDS', bg: '#0b0b0b', fg: '#d9b45a', sub: 'Tokunbo & brand-new · Ring Road, Benin', logo: true }, 9, 1.8, this.local(o.x - 1.2, o.z, 'w'), 0, 4.6, 0);
    // big roadside pylon sign facing the road
    const py = this.local(S.x - S.w / 2 - 1.5, S.z - S.d / 2 + 1.5, 'w');
    this.box(0.35, 6, 0.35, post, 0, 3, 0, py);
    this.signMesh({ text: 'BEST 𝕏 CAR STANDS', bg: '#0b0b0b', fg: '#d9b45a', sub: '₦ Cars for every pocket', logo: true }, 5, 2.2, py, 0, 6.6, 0.2);
    // display cars with price boards
    for (const slot of DISPLAY_SLOTS) {
      const m = carModel(slot.model);
      const c = new Car(m.colors[0], { body: m.body, scale: m.scale, model: m.id }); c.group.position.set(slot.x, 0, slot.z); c.group.rotation.y = slot.rot; c.setDirt(0);
      c.group.traverse((x) => { if ((x as THREE.Mesh).isMesh) (x as THREE.Mesh).castShadow = this.quality !== 'low'; });
      this.scene.add(c.group); this.displayCars.set(slot.model, c);
      this.collide(slot.x, slot.z, 2.0, 4.6);
      const t = signTexture(m.name.toUpperCase(), '#101010', '#f2e2b5', '₦' + m.price.toLocaleString('en-NG'), 512, 140);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t })); sp.scale.set(2.6, 0.72, 1); sp.position.set(slot.x, (m.body === 'bus' ? 2.9 : m.body === 'sedan' || m.body === 'compact' ? 2.2 : 2.6), slot.z + (slot.rot === 0 ? -2.7 : 2.7) * 0); this.scene.add(sp);
    }
    this.footprints.push({ x: S.x + 1.5, z: S.z, w: S.w + 3, d: S.d + 2, kind: 'carstands' });
  }

  private market(): void {
    const roof = this.texMat(corrugatedTexture(), 2, 1, 0.55);
    const wood = this.std('#5a3d25', 0.9);
    const goods = ['#9c2f1e', '#c08a2a', '#6b7a2a', '#8a5a2b', '#b5651d', '#7a2420', '#d0b070'].map((c) => this.std(c, 0.8));
    const r = rng(55);
    for (const row of [0, 1]) for (let i = 0; i < 8; i++) {
      const x = 15 + row * 9, z = 38 + i * 5.2;
      const g = this.local(x, z, 'w');
      for (const [px, pz] of [[-2.2, 1.6], [2.2, 1.6], [-2.2, -1.6], [2.2, -1.6]]) this.box(0.12, 2.7, 0.12, wood, px, 1.35, pz, g);
      const rf = this.box(5, 0.06, 4, roof, 0, 2.75, 0, g); rf.rotation.x = 0.12;
      this.box(4.2, 0.08, 1.4, wood, 0, 0.9, 0.9, g);
      for (const lx of [-1.6, -1.6 + 3.2]) this.box(0.08, 0.9, 1.4, wood, lx, 0.45, 0.9, g);
      for (let k = 0; k < 9; k++) {
        const m = new THREE.Mesh(k % 3 === 0 ? new THREE.SphereGeometry(0.16 + r() * 0.06, 10, 8) : new THREE.BoxGeometry(0.4, 0.25, 0.3), goods[Math.floor(r() * goods.length)]);
        m.position.set(-1.8 + (k % 9) * 0.45, 1.05, 0.6 + r() * 0.5); this.add(m, true, true, g);
      }
      // basin of produce
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.25, 16), this.std('#7d8a8f', 0.4, 0.8)); basin.position.set(0, 0.13, 2.4); this.add(basin, true, true, g);
      this.collide(x, z, 4.6, 4.4);
    }
    this.signMesh({ text: 'NEW BENIN MARKET', bg: '#5c3a1a', fg: '#f2dfb5', sub: 'Pickup point for deliveries' }, 8, 1.6, this.local(12.3, 34.5, 'w'), 0, 3.2, 0);
    this.footprints.push({ x: 19.5, z: 56, w: 14, d: 44, kind: 'market' });
  }

  private gunShopDetails(x: number, z: number): void {
    const steel = this.std('#3a3d42', 0.45, 0.8), yellow = this.std('#d9a520', 0.6, 0.2);
    for (const dx of [-6.5, -4.2, 4.2, 6.5]) for (let i = 0; i < 5; i++) this.box(0.05, 1.6, 0.05, steel, x + dx - 0.8 + i * 0.4, 1.9, z - 0.06, this.scene, false);
    for (const dx of [-3.2, -1.2, 1.2, 3.2]) { this.box(0.22, 0.9, 0.22, yellow, x + dx, 0.45, z - 1.6); this.collide(x + dx, z - 1.6, 0.3, 0.3); }
  }

  private hospitalDetails(x: number, z: number): void {
    const red = this.std('#c81e25', 0.5), white = this.std('#ffffff', 0.5);
    for (const dx of [-9, 9]) { const g = this.box(1.6, 1.6, 0.06, white, x + dx, 6.2, z - 0.04, this.scene, false); g.name = 'cross-bg'; this.box(1.2, 0.36, 0.08, red, x + dx, 6.2, z - 0.07, this.scene, false); this.box(0.36, 1.2, 0.08, red, x + dx, 6.2, z - 0.07, this.scene, false); }
    // ambulance bay markings
    const paint = new THREE.MeshStandardMaterial({ color: '#e8d23a', roughness: 0.8 });
    for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 6), paint); l.rotation.x = -Math.PI / 2; l.position.set(x - 6 + sx * 1.6, 0.04, z - 4); this.add(l, false, false); }
    this.signMesh({ text: 'AMBULANCE ONLY', bg: '#c81e25', fg: '#ffffff' }, 2.4, 0.6, this.local(x - 6, z - 0.1, 's'), 0, 2.6, 0);
  }

  private mannequins(x: number, z: number): void {
    for (let i = -1; i <= 1; i++) {
      const m = new Character({ body: i === 0 ? 'female' : 'male', skin: 5, outfit: [0, 7, 1][i + 1] });
      m.group.position.set(x + i * 3.5, 0, z - 0.2); this.scene.add(m.group);
    }
  }

  private carPark(): void {
    const tex = asphaltTexture().clone(); tex.needsUpdate = true; tex.repeat.set(6, 4);
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(38, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
    lot.rotation.x = -Math.PI / 2; lot.position.set(-52, 0.025, 25); this.add(lot, false, true);
    const line = this.std('#d8d5cb', 0.7);
    for (let i = 0; i <= 8; i++) for (const zc of [19, 31]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5), line); l.rotation.x = -Math.PI / 2; l.position.set(-38 - i * 4, 0.035, zc); this.add(l, false, false); }
    this.signMesh({ text: 'P  CAR PARK', bg: '#1b4e8c', fg: '#ffffff', sub: 'Your car is parked here' }, 4, 1.2, this.local(-35, 13.5, 'n'), 0, 2.6, 0);
    const post = this.std('#444', 0.6, 0.6); this.box(0.15, 2, 0.15, post, -35, 1, 13.5);
  }

  // ---------- vegetation ----------
  private palmParts?: { trunk: THREE.BufferGeometry; fronds: THREE.BufferGeometry; tm: THREE.Material; fm: THREE.Material };
  palm(x: number, z: number, scale = 1): void {
    if (!this.palmParts) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.3, 3, 0), new THREE.Vector3(0.9, 6, 0), new THREE.Vector3(1.6, 8.5, 0)]);
      const trunk = new THREE.TubeGeometry(curve, 16, 0.2, 8, false);
      const pos = trunk.attributes.position; // taper
      for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); const t = 1 - (y / 8.5) * 0.35; const c = curve.getPointAt(Math.min(1, Math.max(0, y / 8.5))); pos.setX(i, c.x + (pos.getX(i) - c.x) * t); pos.setZ(i, pos.getZ(i) * t); }
      trunk.computeVertexNormals();
      const bark = document.createElement('canvas'); bark.width = 64; bark.height = 256; const bc = bark.getContext('2d')!;
      bc.fillStyle = '#6a5a48'; bc.fillRect(0, 0, 64, 256); for (let y = 0; y < 256; y += 10) { bc.fillStyle = 'rgba(40,32,24,0.6)'; bc.fillRect(0, y, 64, 3); }
      const bt = new THREE.CanvasTexture(bark); bt.colorSpace = THREE.SRGBColorSpace; bt.wrapS = bt.wrapT = THREE.RepeatWrapping; bt.repeat.set(2, 4);
      // frond: a curved tapered strip with leaflet texture
      const leaf = document.createElement('canvas'); leaf.width = 64; leaf.height = 256; const lc = leaf.getContext('2d')!;
      lc.clearRect(0, 0, 64, 256); lc.strokeStyle = '#5b5a2c'; lc.lineWidth = 3; lc.beginPath(); lc.moveTo(32, 0); lc.lineTo(32, 256); lc.stroke();
      const lr = rng(9);
      for (let y = 4; y < 252; y += 5) for (const s of [-1, 1]) {
        const len = 30 * Math.sin((y / 256) * Math.PI) + 4; lc.strokeStyle = `rgb(${50 + lr() * 30},${78 + lr() * 30},${32 + lr() * 14})`; lc.lineWidth = 2.5;
        lc.beginPath(); lc.moveTo(32, y); lc.lineTo(32 + s * len, y + 10); lc.stroke();
      }
      const lt = new THREE.CanvasTexture(leaf); lt.colorSpace = THREE.SRGBColorSpace;
      const parts: THREE.BufferGeometry[] = [];
      const top = curve.getPoint(1);
      for (let i = 0; i < 11; i++) {
        const seg = 10, L = 4.2, w = 1.5;
        const geo = new THREE.PlaneGeometry(w, L, 1, seg);
        const p = geo.attributes.position;
        for (let k = 0; k < p.count; k++) { const t = (p.getY(k) + L / 2) / L; const droop = -Math.pow(t, 1.8) * 2.4 + t * 0.9; p.setXYZ(k, p.getX(k) * (1 - t * 0.2), droop, t * L); }
        geo.computeVertexNormals();
        geo.rotateY((i / 11) * Math.PI * 2 + (i % 2) * 0.2);
        geo.translate(top.x, top.y, top.z);
        parts.push(geo);
      }
      this.palmParts = { trunk, fronds: mergeGeometries(parts), tm: new THREE.MeshStandardMaterial({ map: bt, roughness: 0.95 }), fm: new THREE.MeshStandardMaterial({ map: lt, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 }) };
    }
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = this.r() * Math.PI * 2; g.scale.setScalar(scale * (0.85 + this.r() * 0.35));
    this.add(new THREE.Mesh(this.palmParts.trunk, this.palmParts.tm), true, false, g);
    this.add(new THREE.Mesh(this.palmParts.fronds, this.palmParts.fm), true, false, g);
    this.scene.add(g);
  }

  private bush(x: number, z: number): void {
    const m = this.std('#3f5a2a', 0.95);
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.9, 1.2, 2, 0.4), m); s.position.set(x + (this.r() - 0.5) * 1.2, 0.45, z + (this.r() - 0.5) * 1.2); s.rotation.y = this.r() * 3; this.add(s, true, true); }
  }

  private vegetation(): void {
    const n = this.quality === 'low' ? 0.5 : 1;
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; this.palm(Math.cos(a) * 9, Math.sin(a) * 9, 0.9); }
    const corner: [number, number][] = [[36, 36], [44, 32], [34, -40], [-36, 40], [-32, -34], [40, -34]];
    for (const [x, z] of corner) this.palm(x, z, 1);
    for (let d = 52; d < ROAD_END - 10; d += 48 / n) for (const s of [-1, 1]) {
      if (d > 34 && d < 82 && s > 0) continue; // market side
      this.palm(s * 12.2, d, 1); this.palm(s * 12.2, -d, 1); this.palm(d, s * 12.2, 1); this.palm(-d, s * 12.2, 1);
    }
    for (const [x, z] of [[30, -30], [-30, 30], [30, 30], [-30, -30], [36, -30], [-36, -30]]) this.bush(x, z);
  }

  // ---------- lighting state ----------
  /** night: 0 = full day, 1 = full night */
  setNight(night: number): void {
    const on = night > 0.5;
    this.lampMat.emissiveIntensity = on ? 4 : 0;
    (this.glow.material as THREE.MeshBasicMaterial).opacity = on ? 0.8 * Math.min(1, (night - 0.5) * 4) : 0;
    for (const m of this.windowMats) m.emissiveIntensity = on ? 1.1 : 0;
    for (const m of this.signMats) m.emissiveIntensity = on ? 0.55 : 0;
    for (const l of this.lampPoints) l.intensity = on ? 60 : 0;
  }

  animate(dt: number): void {
    for (const g of this.guards) g.animate(dt, 0);
    this.lagos.animate(dt);
    this.policeT += dt;
    const a = this.policeAlert;
    for (const { char, o } of this.police) {
      if (a && Math.hypot(a.x - o.x, a.z - o.z) < 45) {
        // turn the head (and when close, the body) toward the wanted player; wave them down
        const want = Math.atan2(a.x - o.x, a.z - o.z);
        let d = want - char.group.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        char.group.rotation.y += Math.sign(d) * Math.min(Math.abs(d), dt * 2.5) * (Math.abs(d) > 0.9 ? 1 : 0.4);
        char.headLook = THREE.MathUtils.clamp(d, -0.9, 0.9); char.wave += (1 - char.wave) * Math.min(1, dt * 4);
      } else {
        let d = o.rot - char.group.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
        char.group.rotation.y += d * Math.min(1, dt * 1.5); char.headLook = 0; char.wave *= Math.max(0, 1 - dt * 4);
      }
      char.animate(dt, 0);
    }
    const on = !!a; const ph = Math.floor(this.policeT * 6) % 2;
    for (const L of this.policeLights) { L.red.emissiveIntensity = on ? (ph ? 4 : 0.2) : 0.15; L.blue.emissiveIntensity = on ? (ph ? 0.2 : 4) : 0.15; }
  }

  /** Roadside police checkpoints: a few officers in uniform, a liveried patrol pickup with a light bar, striped drums. */
  private policeCheckpoints(): void {
    const drumMat = new THREE.MeshStandardMaterial({ color: '#d8661c', roughness: 0.55 });
    const bandMat = new THREE.MeshStandardMaterial({ color: '#f2f0e8', roughness: 0.4, emissive: '#555', emissiveIntensity: 0.1 });
    for (const cp of POLICE_CHECKPOINTS) {
      for (const d of cp.drums) {
        const g = new THREE.Group(); g.position.set(d.x, 0, d.z); this.scene.add(g);
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.3, 0.88, 18), drumMat); drum.position.y = 0.44; this.add(drum, true, true, g);
        for (const y of [0.3, 0.6]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.305, 0.305, 0.09, 18), bandMat); b.position.y = y; this.add(b, false, false, g); }
        this.collide(d.x, d.z, 0.7, 0.7);
      }
      // patrol pickup: dark blue-black body, POLICE side boards, red/blue light bar
      const car = new Car('#141c2e', { body: 'pickup' }); car.group.position.set(cp.car.x, 0, cp.car.z); car.group.rotation.y = cp.car.rot; car.setDirt(0.25);
      car.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = this.quality !== 'low'; });
      this.scene.add(car.group);
      const ew = Math.abs(Math.sin(cp.car.rot)) > 0.7; this.collide(cp.car.x, cp.car.z, ew ? 5.4 : 2.1, ew ? 2.1 : 5.4);
      const red = new THREE.MeshStandardMaterial({ color: '#7a0d0d', emissive: '#ff1a1a', emissiveIntensity: 0.15, roughness: 0.3 });
      const blue = new THREE.MeshStandardMaterial({ color: '#0d1f7a', emissive: '#1a4dff', emissiveIntensity: 0.15, roughness: 0.3 });
      this.policeLights.push({ red, blue });
      const bar = new THREE.Group(); bar.position.set(0, 1.9, 0); car.group.add(bar);
      bar.add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.28), this.std('#1a1a1a')));
      for (const [sx, m] of [[-0.35, red], [0.35, blue]] as const) { const l = new THREE.Mesh(new RoundedBoxGeometry(0.55, 0.12, 0.24, 2, 0.04), m); l.position.set(sx, 0.08, 0); bar.add(l); }
      for (const sx of [-1, 1]) { // POLICE text on both doors
        const t = signTexture('POLICE', '#141c2e', '#ffffff', '', 512, 128, false);
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.36), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.5 }));
        pl.position.set(sx * 0.94, 0.86, 0.3); pl.rotation.y = sx * Math.PI / 2; car.group.add(pl);
      }
    }
    for (const o of POLICE_OFFICERS) {
      const char = new Character({ body: 'male', skin: (Math.round(o.x * 7 + o.z) & 3) + 1, outfit: 4 }, { style: 'police' });
      char.group.position.set(o.x, 0, o.z); char.group.rotation.y = o.rot;
      char.group.traverse((m) => { if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).castShadow = this.quality !== 'low'; });
      this.scene.add(char.group); this.police.push({ char, o }); this.collide(o.x, o.z, 0.7, 0.7);
    }
  }
}
