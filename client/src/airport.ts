// Benin Airport (landside terminal + forecourt, fenced airside apron/runway with a parked airliner).
// New players walk off the plane into the arrivals hall here; the runway is also used by the landing cutscene.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { World } from './world';
import { asphaltTexture, concreteTexture, paverTexture, roadTexture } from './textures';
import { M, canvasTex, tileTex } from './interiors';
import { airliner, AIRLINER_GEAR_H } from './airliner';

export const RUNWAY = { z: -322, x0: -520, x1: 520, w: 45 };
export const PARKED_PLANE = { x: 24, z: -268 };
const CURB_H = 0.16;
const T = { x0: -36, x1: 36, z0: -241, z1: -217, h: 10 }; // terminal box

function fenceTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (c) => {
    c.clearRect(0, 0, 128, 128); c.strokeStyle = 'rgba(170,175,178,0.95)'; c.lineWidth = 2;
    for (let i = -128; i < 256; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + 128, 128); c.stroke(); c.beginPath(); c.moveTo(i + 128, 0); c.lineTo(i, 128); c.stroke(); }
  });
}

export function buildAirport(w: World): void {
  const S = w.scene;
  const plane = (pw: number, pd: number, m: THREE.Material, x: number, y: number, z: number) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); w.add(p, false, true); return p;
  };
  const tex = (t: THREE.Texture, rx: number, ry: number, rough = 0.9, color = '#ffffff') => w.texMat(t, rx, ry, rough, color);

  // ---- access road + drop-off lane + kerb
  const road = tex(roadTexture(), 1, 21 / 12, 0.88); plane(14, 21, road, 0, 0.02, -200.5);
  const asph = tex(asphaltTexture(), 10, 2, 0.9); plane(76, 10, asph, 0, 0.021, -206);
  const line = M('#d8d5cb', 0.7);
  for (let x = -34; x < 34; x += 4) plane(2, 0.14, line, x + 1, 0.03, -206);
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(76, CURB_H, 6), [M('#a8a296'), M('#a8a296'), tex(paverTexture(), 30, 2.4, 0.9), M('#a8a296'), M('#a8a296'), M('#a8a296')]);
  kerb.position.set(0, CURB_H / 2, -214); w.add(kerb, false, true);
  w.walkRects.push({ minX: -38, maxX: 38, minZ: -217, maxZ: -211 });
  // zebra crossing to the terminal doors
  for (let x = -6; x <= 6; x += 1.2) plane(0.6, 3, M('#d8d5cb', 0.7), x - 20 + 10, 0.03, -206);

  // ---- terminal shell
  const clad = tex(concreteTexture(), 6, 2, 0.75, '#e9e6df');
  const floor = tex(tileTex(), 36, 12, 0.35, '#e8e2d6');
  plane(T.x1 - T.x0, T.z1 - T.z0, floor, 0, CURB_H + 0.01, (T.z0 + T.z1) / 2);
  w.walkRects.push({ minX: T.x0, maxX: T.x1, minZ: T.z0, maxZ: T.z1 });
  // back + side walls (solid), roof slab with a deep canopy over the kerb
  w.box(T.x1 - T.x0, T.h, 0.4, clad, 0, T.h / 2, T.z0); w.collide(0, T.z0, T.x1 - T.x0, 0.4);
  for (const x of [T.x0, T.x1]) { w.box(0.4, T.h, T.z1 - T.z0, clad, x, T.h / 2, (T.z0 + T.z1) / 2); w.collide(x, (T.z0 + T.z1) / 2, 0.4, T.z1 - T.z0); }
  w.box(T.x1 - T.x0 + 4, 0.7, T.z1 - T.z0 + 10, M('#d7d3cb', 0.6), 0, T.h + 0.35, (T.z0 + T.z1) / 2 + 4);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(T.x1 - T.x0, T.z1 - T.z0 + 8), M('#f1efe9', 0.7)); ceil.rotation.x = Math.PI / 2; ceil.position.set(0, T.h - 0.02, (T.z0 + T.z1) / 2 + 4); w.add(ceil, false, true);
  // canopy columns
  for (let x = -30; x <= 30; x += 12) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, T.h, 16), M('#cfcac0', 0.5, 0.2)); c.position.set(x, T.h / 2, -211.8); w.add(c); w.collide(x, -211.8, 0.7, 0.7); }
  // glass curtain wall on the front with two door openings
  const glass = new THREE.MeshPhysicalMaterial({ color: '#9cc3cf', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, side: THREE.DoubleSide });
  const mull = M('#3a3f44', 0.4, 0.7);
  const doors: [number, number][] = [[-12, -8], [8, 12]];
  const segs: [number, number][] = [[T.x0, -12], [-8, 8], [12, T.x1]];
  for (const [a, b] of segs) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(b - a, T.h), glass); g.position.set((a + b) / 2, T.h / 2, T.z1); S.add(g);
    w.collide((a + b) / 2, T.z1, b - a, 0.3);
    for (let x = a; x <= b + 0.01; x += 3) w.box(0.12, T.h, 0.18, mull, x, T.h / 2, T.z1);
    w.box(b - a, 0.14, 0.2, mull, (a + b) / 2, 3.2, T.z1);
  }
  for (const [a, b] of doors) {
    w.box(b - a, 0.5, 0.3, mull, (a + b) / 2, 3.0, T.z1); // door header
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, T.h - 3.25), glass); gl.position.set((a + b) / 2, 3.25 + (T.h - 3.25) / 2, T.z1); S.add(gl);
    // open sliding door leaves pushed aside
    for (const sx of [-1, 1]) { const lf = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.9), glass); lf.position.set((a + b) / 2 + sx * ((b - a) / 2 - 0.5), 1.6, T.z1 - 0.15); S.add(lf); }
  }
  // big title on the canopy edge
  w.signMesh({ text: 'BENIN AIRPORT', bg: '#ffffff', fg: '#17603f', sub: 'Benin City · Edo State' }, 22, 2.6, S, 0, T.h + 2.0, -209.2);
  w.signMesh({ text: 'ARRIVALS', bg: '#17603f', fg: '#ffffff', sub: 'Taxis · Car park · City (Ring Road) ▸ South' }, 7, 1.3, S, -10, 4.6, -210.6);
  w.signMesh({ text: 'DEPARTURES', bg: '#203a5c', fg: '#ffffff', sub: 'Check-in · Gate 1' }, 7, 1.3, S, 10, 4.6, -210.6);

  // ---- arrivals hall interior
  const hallSign = (text: string, sub: string, x: number, z: number, wd = 8, rot = 0) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; S.add(g); w.signMesh({ text, bg: '#17603f', fg: '#ffffff', sub }, wd, 1.2, g, 0, 5.2, 0);
  };
  hallSign('WELCOME TO BENIN CITY', 'Edo State · Mind your belongings · Fictional game world', -8, -240.5);
  hallSign('EXIT ▸ CITY · TAXIS', 'Walk out the front doors, then south down the road to Ring Road', 0, -224, 9, Math.PI);
  // gate door in the back wall (where you come off the jet bridge)
  w.box(3, 2.8, 0.2, M('#4b5258', 0.4, 0.6), -10, 1.4 + CURB_H, T.z0 + 0.25);
  w.signMesh({ text: 'GATE 1', bg: '#203a5c', fg: '#ffffff', sub: 'Arrivals' }, 3, 0.8, S, -10, 3.4, T.z0 + 0.32);
  // baggage carousel
  const belt = new THREE.Mesh(new RoundedBoxGeometry(12, 0.7, 3.6, 3, 1.6), M('#5a6066', 0.4, 0.6)); belt.position.set(10, 0.5, -232); w.add(belt); w.collide(10, -232, 12, 3.6);
  const top = new THREE.Mesh(new RoundedBoxGeometry(11.4, 0.06, 3.0, 3, 1.4), M('#22262a', 0.7)); top.position.set(10, 0.87, -232); w.add(top);
  const rnd = (i: number) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (let i = 0; i < 9; i++) { const bag = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.38, 0.4, 2, 0.06), M(['#2a3f66', '#7a1f1f', '#1f1f1f', '#4a6a2a', '#8a6a2a'][i % 5], 0.6)); bag.position.set(5.5 + i * 1.1, 1.08, -232 + (rnd(i) - 0.5) * 1.6); bag.rotation.y = rnd(i + 3) * 3; w.add(bag); }
  w.signMesh({ text: 'BELT 1', bg: '#22262a', fg: '#f5d77a', sub: 'IV 214 · Ivie Air' }, 3.2, 0.9, S, 10, 3.6, -234.2);
  // seating rows
  const seatM = M('#2c3e50', 0.5, 0.3), frameM = M('#9aa3a8', 0.4, 0.8);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) {
    const x = -30 + i * 0.7, z = -228 + r * 2.4;
    const s = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.08, 0.5, 2, 0.03), seatM); s.position.set(x, 0.5, z); w.add(s);
    const b = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.55, 0.06, 2, 0.03), seatM); b.position.set(x, 0.8, z + 0.25); b.rotation.x = 0.12; w.add(b);
    if (i === 0) { w.box(4.4, 0.06, 0.1, frameM, x + 1.75, 0.42, z); w.collide(x + 1.75, z, 4.4, 0.8); }
  }
  // information desk
  const desk = new THREE.Mesh(new RoundedBoxGeometry(5, 1.1, 1.2, 3, 0.25), M('#6b4426', 0.5)); desk.position.set(-22, 0.55 + CURB_H, -222); w.add(desk); w.collide(-22, -222, 5, 1.2);
  w.signMesh({ text: 'INFORMATION', bg: '#d9a93a', fg: '#1a1408', sub: 'Ask about taxis & the city' }, 4, 0.8, S, -22, 2.6, -222.7);
  // interior columns + ceiling light panels
  for (let x = -24; x <= 24; x += 12) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, T.h, 16), M('#e3ded3', 0.5)); c.position.set(x, T.h / 2, -229); w.add(c); w.collide(x, -229, 0.9, 0.9); }
  const lightM = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 1.2 });
  for (let x = -30; x <= 30; x += 6) for (const z of [-236, -229, -222]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), lightM); p.rotation.x = Math.PI / 2; p.position.set(x, T.h - 0.05, z); S.add(p); }
  if (w.quality !== 'low') for (const x of [-18, 0, 18]) { const L = new THREE.PointLight('#fff1d6', 40, 26, 1.4); L.position.set(x, 8, -230); S.add(L); }
  // potted palms
  for (const [x, z] of [[-34, -219], [34, -219], [-34, -239], [34, -239]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.8, 16), M('#7a4a2a', 0.7)); pot.position.set(x, 0.4 + CURB_H, z); w.add(pot);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), M('#3f6a2a', 0.9)); leaf.scale.set(1, 1.4, 1); leaf.position.set(x, 1.9, z); w.add(leaf); w.collide(x, z, 1, 1);
  }

  // ---- airside (fenced): apron, taxiway, runway, parked airliner + jet bridge, control tower
  const conc = tex(concreteTexture(), 40, 12, 0.92, '#bdb8ae'); plane(260, 60, conc, 0, 0.015, -272);
  const rw = tex(asphaltTexture(), 80, 4, 0.92, '#6a6a6a'); plane(RUNWAY.x1 - RUNWAY.x0, RUNWAY.w, rw, 0, 0.018, RUNWAY.z);
  plane(18, 22, tex(asphaltTexture(), 2, 3, 0.92, '#707070'), -60, 0.017, -300);
  const paint = M('#f2f2ea', 0.6);
  for (let x = RUNWAY.x0 + 40; x < RUNWAY.x1 - 40; x += 50) plane(30, 0.9, paint, x, 0.025, RUNWAY.z);
  for (const e of [-1, 1]) plane(RUNWAY.x1 - RUNWAY.x0, 0.9, paint, 0, 0.025, RUNWAY.z + e * (RUNWAY.w / 2 - 1.5));
  for (const end of [RUNWAY.x0 + 12, RUNWAY.x1 - 12]) for (let k = -8; k <= 8; k++) if (k !== 0) plane(30, 1.4, paint, end, 0.026, RUNWAY.z + k * 2.4);
  plane(0.6, 22, M('#e6c040', 0.6), -60, 0.026, -300);
  // runway edge lights (instanced)
  const nL = Math.floor((RUNWAY.x1 - RUNWAY.x0) / 30) * 2;
  const lights = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.15, 0.35, 8), new THREE.MeshStandardMaterial({ color: '#fff7d0', emissive: '#ffe8a0', emissiveIntensity: 1.5 }), nL);
  const m4 = new THREE.Matrix4(); let li = 0;
  for (let x = RUNWAY.x0; x < RUNWAY.x1 && li < nL; x += 30) for (const e of [-1, 1]) { m4.makeTranslation(x, 0.17, RUNWAY.z + e * (RUNWAY.w / 2 + 1)); lights.setMatrixAt(li++, m4); }
  S.add(lights);
  // parked airliner (nose toward the terminal) + jet bridge to its front-left door
  const ap = airliner(); ap.position.set(PARKED_PLANE.x, AIRLINER_GEAR_H, PARKED_PLANE.z); S.add(ap);
  const bridgeM = M('#cfd3d6', 0.5, 0.5);
  const doorX = PARKED_PLANE.x + 2.2, doorZ = PARKED_PLANE.z + 12.3;
  const bx0 = PARKED_PLANE.x + 9, bz0 = T.z0 - 0.4;
  const len = Math.hypot(doorX + 1.2 - bx0, doorZ - bz0);
  const br = new THREE.Mesh(new RoundedBoxGeometry(2.6, 2.8, len, 2, 0.3), bridgeM);
  br.position.set((doorX + 1.2 + bx0) / 2, 4.0, (doorZ + bz0) / 2); br.rotation.y = Math.atan2(doorX + 1.2 - bx0, doorZ - bz0); w.add(br);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 2.6, 10), M('#555', 0.5, 0.6)); leg.position.set(doorX + 3, 1.3, doorZ + 3); w.add(leg);
  // control tower
  const tw = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 26, 20), M('#e9e6df', 0.7)); tw.position.set(78, 13, -258); w.add(tw);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 3.4, 3.6, 12), new THREE.MeshPhysicalMaterial({ color: '#2a4a5a', roughness: 0.1, metalness: 0.6 })); cab.position.set(78, 27.8, -258); w.add(cab);
  const capm = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.6, 0.6, 12), M('#d7d3cb', 0.6)); capm.position.set(78, 29.9, -258); w.add(capm);
  // perimeter fence (airside is off-limits) + landside boundary
  const fm = new THREE.MeshStandardMaterial({ map: fenceTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6 });
  const fence = (x0: number, z0: number, x1: number, z1: number) => {
    const l = Math.hypot(x1 - x0, z1 - z0); const t = fm.clone(); t.map = fm.map!.clone(); t.map.needsUpdate = true; t.map.repeat.set(l / 2.5, 1);
    const f = new THREE.Mesh(new THREE.PlaneGeometry(l, 2.6), t); f.position.set((x0 + x1) / 2, 1.3, (z0 + z1) / 2); f.rotation.y = -Math.atan2(z1 - z0, x1 - x0); S.add(f);
    for (let k = 0; k <= Math.ceil(l / 5); k++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6), M('#8a8f93', 0.5, 0.7)); p.position.set(x0 + (x1 - x0) * k / Math.ceil(l / 5), 1.4, z0 + (z1 - z0) * k / Math.ceil(l / 5)); S.add(p); }
    w.collide((x0 + x1) / 2, (z0 + z1) / 2, Math.max(0.3, Math.abs(x1 - x0)), Math.max(0.3, Math.abs(z1 - z0)));
  };
  fence(-185, -243, T.x0, -243); fence(T.x1, -243, 185, -243);
  fence(-40, -186, -40, -243); fence(40, -186, 40, -243);
  w.footprints.push({ x: 0, z: (T.z0 + T.z1) / 2, w: T.x1 - T.x0, d: T.z1 - T.z0, kind: 'airport' });
}
