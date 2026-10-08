// "Ikate Waterside", a Lekki-style Lagos district (fictional): coastal expressway, glass towers, beach + Atlantic ocean,
// Eko Motor Park (buses to/from Benin) and a small domestic airport. Reached only by bus or plane (server-authoritative).
// Also builds Benin Motor Park (South road) and the Ivie Air check-in counter in the Benin terminal.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { World } from './world';
import { Car } from './car';
import { asphaltTexture, paverTexture, roadTexture } from './textures';
import { M, canvasTex, posterTexture } from './interiors';
import { airliner, AIRLINER_GEAR_H } from './airliner';
import { BENIN_MOTOR_PARK, LAGOS, LAGOS_AIRPORT, LAGOS_MOTOR_PARK, TRAVEL } from '../../shared/constants';

const X = (x: number) => LAGOS.x + x;

function sandTexture(): THREE.CanvasTexture {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = '#d9c49a'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) { const v = 170 + Math.random() * 60; c.fillStyle = `rgba(${v},${v * 0.9},${v * 0.7},0.35)`; c.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); }
  }, 30);
}
function waterNormal(): THREE.CanvasTexture {
  return canvasTex(256, 256, (c) => {
    const img = c.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const h = (u: number, v: number) => Math.sin(u * 0.098 + Math.sin(v * 0.05) * 2) * 0.5 + Math.sin(v * 0.147 + u * 0.03) * 0.35 + Math.sin((u + v) * 0.21) * 0.15;
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1);
      const i = (y * 256 + x) * 4; img.data[i] = 128 + dx * 90; img.data[i + 1] = 128 + dy * 90; img.data[i + 2] = 255; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }, 40);
}

export class LagosDistrict {
  private water!: THREE.MeshStandardMaterial;
  private foam!: THREE.Mesh;
  private t = 0;
  constructor(private w: World) {
    this.lagos();
    this.beninMotorPark();
    this.beninCheckIn();
  }

  animate(dt: number): void {
    this.t += dt;
    if (this.water.normalMap) { this.water.normalMap.offset.x = this.t * 0.004; this.water.normalMap.offset.y = this.t * 0.011; }
    this.foam.position.z = 95 + Math.sin(this.t * 0.6) * 1.4; (this.foam.material as THREE.MeshStandardMaterial).opacity = 0.45 + Math.sin(this.t * 0.6 + 1) * 0.2;
  }

  private plane(pw: number, pd: number, m: THREE.Material, x: number, y: number, z: number, cast = false): THREE.Mesh {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); this.w.add(p, cast, true); return p;
  }

  private lagos(): void {
    const w = this.w;
    const tex = (t: THREE.Texture, rx: number, ry: number, rough = 0.9, color = '#ffffff') => w.texMat(t, rx, ry, rough, color);
    // ground: tidy paved district on reclaimed land
    this.plane(390, 210, tex(paverTexture(), 60, 34, 0.92, '#cfc8bb'), X(0), 0.012, -85);
    // coastal expressway (dual carriageway with planted median)
    const road = tex(roadTexture(), 1, 380 / 12, 0.88);
    for (const z of [27, 37.5]) { const r = this.plane(8, 380, road, X(0), 0.02, z); r.rotation.z = Math.PI / 2; w.wetMats.push(road); }
    const median = new THREE.Mesh(new THREE.BoxGeometry(380, 0.2, 2.5), M('#4d6b33', 0.95)); median.position.set(X(0), 0.1, 32.25); w.add(median, false, true);
    for (let x = -180; x <= 180; x += 24) w.palm(X(x), 32.25, 0.9);
    // north sidewalk + south promenade
    this.plane(380, 5, tex(paverTexture(), 76, 1, 0.9, '#d8d2c4'), X(0), 0.025, 20.5);
    this.plane(380, 6.5, tex(paverTexture(), 76, 1.3, 0.9, '#e2d9c6'), X(0), 0.025, 44.75);
    for (let x = -176; x <= 176; x += 16) w.palm(X(x), 46.5, 1.05);
    // avenue north from the expressway
    const av = tex(roadTexture(), 1, 210 / 12, 0.88); this.plane(14, 210, av, X(0), 0.021, -82); w.wetMats.push(av);
    for (const sx of [-1, 1]) this.plane(4, 210, tex(paverTexture(), 1, 40, 0.9, '#d8d2c4'), X(sx * 9), 0.026, -82);
    // airport access road
    const ar = tex(roadTexture(), 1, 160 / 12, 0.88); const arm = this.plane(10, 160, ar, X(86), 0.021, -90); arm.rotation.z = Math.PI / 2;
    // beach + ocean
    this.plane(400, 50, tex(sandTexture(), 1, 1, 0.97), X(0), 0.018, 73);
    const wn = waterNormal();
    this.water = new THREE.MeshStandardMaterial({ color: '#1d5d74', roughness: 0.12, metalness: 0.2, normalMap: wn, normalScale: new THREE.Vector2(0.6, 0.6) });
    this.plane(900, 700, this.water, X(0), 0.0, 445);
    this.foam = this.plane(400, 3, new THREE.MeshStandardMaterial({ color: '#f4f2ea', transparent: true, opacity: 0.5, roughness: 0.6 }), X(0), 0.03, 95);
    w.collide(X(0), 99, 400, 4); // the sea
    for (const [x, z, wd, dp] of [[-192, -85, 2, 380], [192, -85, 2, 380], [0, -192, 384, 2]]) w.collide(X(x), z, wd, dp);
    // beach life: umbrellas, loungers, lifeguard tower, beach lounge
    const cols = ['#d94f30', '#f2c230', '#2a7ab0', '#ffffff', '#3aa65a'];
    for (let i = 0; i < 14; i++) {
      const x = -150 + i * 22 + (i % 3) * 3, z = 62 + (i % 2) * 14;
      const g = new THREE.Group(); g.position.set(X(x), 0, z); w.scene.add(g);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 8), M('#ddd', 0.5, 0.4)); pole.position.y = 1.3; w.add(pole, true, false, g);
      const can = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 12, 1, true), M(cols[i % cols.length], 0.8, 0, { side: THREE.DoubleSide })); can.position.y = 2.5; w.add(can, true, false, g);
      for (const sx of [-1, 1]) { const l = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.15, 1.9, 2, 0.05), M('#f2f0e8', 0.6)); l.position.set(sx * 0.9, 0.35, 1.2); l.rotation.x = -0.08; w.add(l, true, true, g); }
    }
    const tower = new THREE.Group(); tower.position.set(X(30), 0, 80); w.scene.add(tower);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6), M('#e8e2d5')); leg.position.set(sx * 0.8, 1.2, sz * 0.8); w.add(leg, true, false, tower); }
    w.box(2, 1.2, 2, M('#c8392b', 0.7), 0, 3, 0, tower); w.box(2.4, 0.1, 2.4, M('#f2f0e8'), 0, 3.65, 0, tower);
    // beach lounge shack
    const lounge = w.building({ x: X(-40), z: 58, front: 14, depth: 9, floors: 1, face: 's', color: '#c9a777', seed: 41, shop: { text: 'ÒKUN BEACH LOUNGE', bg: '#0f4c5c', fg: '#f6e7c1', sub: 'Grills • Chapman • Live music' }, tank: false });
    void lounge;
    // Eghosa Nova billboard on the promenade
    const pb = new THREE.Group(); pb.position.set(X(-12), 0, 15.5); w.scene.add(pb);
    w.box(0.3, 6, 0.3, M('#555', 0.5, 0.5), 0, 3, 0, pb);
    const pm = new THREE.MeshStandardMaterial({ map: posterTexture(), roughness: 0.6 }); const board = new THREE.Mesh(new THREE.PlaneGeometry(4, 6), pm); board.position.set(0, 8.5, 0.2); w.add(board, false, false, pb);
    // towers + shops (north of the expressway, along the avenue)
    const B = (x: number, z: number, front: number, depth: number, floors: number, face: 'n' | 's' | 'e' | 'w', color: string, seed: number, extra: Partial<Parameters<World['building']>[0]> = {}) =>
      w.building({ x: X(x), z, front, depth, floors, face, color, seed, tank: false, ...extra });
    B(35, -2, 20, 16, 12, 's', '#9fb4c0', 51, { glass: true, shop: { text: 'EKO HEIGHTS', bg: '#10202c', fg: '#e7f0f5', sub: 'Luxury apartments' } });
    B(72, -4, 30, 18, 3, 's', '#d8d4cc', 52, { glass: true, shop: { text: 'WATERSIDE MALL', bg: '#1d1d1f', fg: '#f2c94c', sub: 'Fashion • Cinema • Food court' } });
    B(112, -2, 18, 16, 15, 's', '#8fa7b5', 53, { glass: true, shop: { text: 'ATLANTIC TRUST BANK', bg: '#0b3954', fg: '#ffffff' } });
    B(150, -4, 22, 16, 9, 's', '#c9c2b5', 54, { balconies: true });
    B(-32, 2, 14, 12, 2, 's', '#e0c9a6', 55, { shop: { text: 'TIWA SUYA SPOT', bg: '#7a1e12', fg: '#ffe9c2', sub: 'Suya • Asun • Small chops' } });
    B(-62, -4, 20, 16, 8, 's', '#e3ddd1', 56, { balconies: true });
    B(-170, -4, 18, 14, 6, 's', '#d6cdbd', 57, { balconies: true });
    B(22, -45, 16, 16, 10, 'w', '#a7b9c4', 58, { glass: true, shop: { text: 'ADÉ TECH HUB', bg: '#141414', fg: '#6ee7b7', sub: 'Startups • Co-working' } });
    B(-22, -45, 16, 16, 7, 'e', '#e6e0d4', 59, { balconies: true });
    B(22, -140, 16, 16, 13, 'w', '#9db1bd', 60, { glass: true });
    B(-22, -80, 16, 18, 5, 'e', '#dcd3c3', 61, { balconies: true, shop: { text: 'IKATE PHARMACY', bg: '#1d5e3a', fg: '#ffffff' } });
    B(-22, -125, 16, 16, 11, 'e', '#93a9b6', 62, { glass: true });
    B(-22, -165, 16, 14, 4, 'e', '#e2d8c6', 63, { balconies: true });
    B(55, -55, 22, 18, 6, 's', '#ddd6c8', 64, { balconies: true });
    B(-70, -60, 20, 18, 9, 's', '#a9bcc6', 65, { glass: true });
    B(-150, -70, 24, 18, 5, 's', '#d9d0bf', 66, { balconies: true });
    this.motorPark(X(LAGOS_MOTOR_PARK.x - LAGOS.x), LAGOS_MOTOR_PARK.z, LAGOS_MOTOR_PARK.w, LAGOS_MOTOR_PARK.d, 'EKO MOTOR PARK', 'Benin City • Abuja • Ibadan • Port Harcourt', TRAVEL.bus.desk.lagos, true);
    // forecourt from the expressway into the motor park
    this.plane(40, 24, tex(asphaltTexture(), 8, 5, 0.9), LAGOS_MOTOR_PARK.x, 0.02, 9);
    this.airport();
  }

  private airport(): void {
    const w = this.w, A = LAGOS_AIRPORT;
    const x0 = A.x - A.w / 2, z1 = A.z + A.d / 2;
    const clad = M('#d9dde0', 0.5, 0.2), glass = M('#5d7c8c', 0.08, 0.7, { transparent: true, opacity: 0.7 });
    w.box(A.w, 9, A.d, clad, A.x, 4.5, A.z); w.collide(A.x, A.z, A.w, A.d);
    w.box(A.w - 4, 6, 0.2, glass, A.x, 4, z1 + 0.12);
    w.box(A.w + 4, 0.5, 6, M('#efefea', 0.5), A.x, 7.2, z1 + 3); // canopy
    w.signMesh({ text: 'LAGOS DOMESTIC AIRPORT', bg: '#0e2a47', fg: '#ffffff', sub: 'Ikate Terminal · Ivie Air' }, 22, 2.2, w.scene, A.x, 10.3, z1 + 0.3);
    // kerb + Ivie Air check-in kiosk under the canopy
    this.plane(A.w + 6, 7, w.texMat(paverTexture(), 12, 1.4, 0.9, '#d8d2c4'), A.x, 0.03, z1 + 3.5);
    const d = TRAVEL.flight.desk.lagos;
    const k = new THREE.Mesh(new RoundedBoxGeometry(3.2, 1.1, 1.0, 3, 0.2), M('#1d3b5a', 0.5)); k.position.set(d.x, 0.55, d.z - 1.6); w.add(k); w.collide(d.x, d.z - 1.6, 3.2, 1);
    w.signMesh({ text: 'IVIE AIR CHECK-IN', bg: '#7a1022', fg: '#ffffff', sub: 'Flights to Benin City' }, 3.4, 0.8, w.scene, d.x, 2.3, d.z - 2.15);
    for (const x of [x0 + 4, x0 + 20, x0 + 40, x0 + 56]) w.box(0.5, 7, 0.5, M('#cfcac0', 0.5, 0.2), x, 3.5, z1 + 5.6);
    // apron + airliner behind the terminal, fenced
    this.plane(140, 70, w.texMat(asphaltTexture(), 20, 10, 0.9, '#8a8f93'), A.x, 0.015, A.z - 50);
    const plane = airliner(); plane.position.set(A.x - 6, AIRLINER_GEAR_H, A.z - 48); plane.rotation.y = Math.PI / 2; w.scene.add(plane);
    w.collide(A.x, A.z - 48, 60, 50);
  }

  /** shared motor-park layout: asphalt yard, shelter canopy, ticket booth with the desk on its open side, parked coaches/danfo buses */
  private motorPark(cx: number, cz: number, wd: number, dp: number, title: string, sub: string, desk: { x: number; z: number }, lagos: boolean): void {
    const w = this.w;
    this.plane(wd, dp, w.texMat(asphaltTexture(), wd / 6, dp / 6, 0.9, '#9a9690'), cx, 0.022, cz);
    // perimeter wall (open towards the road)
    const wall = M('#cfc6b4', 0.9);
    for (const [x, z, a, b] of [[cx, cz - dp / 2, wd, 0.3], [lagos ? cx - wd / 2 : cx - wd / 2, cz, 0.3, dp]] as const) { w.box(a, 1.6, b, wall, x, 0.8, z); w.collide(x, z, a, b); }
    // shelter canopy with benches
    const can = new THREE.Group(); can.position.set(cx - wd * 0.15, 0, cz - dp / 2 + 3.5); w.scene.add(can);
    w.box(14, 0.25, 4, M('#2f6b4f', 0.6, 0.2), 0, 3.4, 0, can);
    for (const sx of [-6.5, 6.5]) for (const sz of [-1.7, 1.7]) w.box(0.18, 3.4, 0.18, M('#888', 0.5, 0.6), sx, 1.7, sz, can);
    for (const sx of [-4, 0, 4]) { w.box(3, 0.08, 0.6, M('#6b4426', 0.6), sx, 0.48, 0.6, can); w.box(3, 0.45, 0.06, M('#6b4426', 0.6), sx, 0.75, 0.9, can); }
    w.footprint(can.position.x, can.position.z, 14, 4, 's', 'motorpark', false);
    w.collide(can.position.x, can.position.z + 0.6, 13, 1.2);
    w.signMesh({ text: title, bg: '#123a2a', fg: '#ffe9a8', sub }, 9, 1.4, can, 0, 4.4, 2.05);
    // ticket booth: desk on the road side
    const booth = new THREE.Group(); booth.position.set(desk.x - 2.6, 0, desk.z); w.scene.add(booth);
    w.box(2.4, 2.6, 2.6, M('#e9e2d2', 0.8), 0, 1.3, 0, booth); w.box(2.7, 0.2, 2.9, M('#7a1022', 0.6), 0, 2.7, 0, booth);
    w.box(0.1, 0.9, 1.6, M('#3b5566', 0.1, 0.6, { transparent: true, opacity: 0.6 }), 1.22, 1.5, 0, booth);
    w.box(0.6, 0.08, 1.8, M('#6b4426', 0.6), 1.45, 1.05, 0, booth);
    w.signMesh({ text: 'TICKETS', bg: '#7a1022', fg: '#ffffff', sub: lagos ? 'Lagos → Benin City' : 'Benin City → Lagos' }, 2.2, 0.6, booth, 1.33, 2.25, 0);
    booth.children.slice(-1).forEach((o) => { o.rotation.y = Math.PI / 2; o.position.set(1.36, 2.25, 0); });
    w.collide(booth.position.x, booth.position.z, 2.6, 2.8);
    // buses: luxury coaches + a yellow danfo
    const coach = (x: number, z: number, rot: number, color: string, scale = 1.25) => {
      const c = new Car(color, { body: 'bus', scale }); c.group.position.set(x, 0, z); c.group.rotation.y = rot; c.setDirt(0.15); w.scene.add(c.group);
      const ew = Math.abs(Math.sin(rot)) > 0.7; w.collide(x, z, ew ? 6.6 * scale : 2.4 * scale, ew ? 2.4 * scale : 6.6 * scale);
    };
    coach(cx - wd / 2 + 6, cz + 2, 0, '#f2f0ea'); coach(cx - wd / 2 + 12, cz + 2, 0, '#7a1022');
    coach(cx - wd / 2 + 18, cz + 3, 0, '#f4c20d', 1.0); // danfo
    // a keke and a couple of okadas waiting for passengers at the gate
    for (const [i, kind, col] of [[0, 'keke', '#f2c230'], [1, 'keke', '#2e7d32'], [2, 'okada', '#7a1d1d'], [3, 'okada', '#1a1a1a']] as const) {
      const v = new Car(col, { body: kind }); v.group.position.set(cx + wd / 2 - 3 - i * 2.4, 0, cz + dp / 2 - 4); v.group.rotation.y = Math.PI; w.scene.add(v.group);
      w.collide(v.group.position.x, v.group.position.z, kind === 'keke' ? 1.4 : 0.8, kind === 'keke' ? 2.6 : 2);
    }
  }

  private beninMotorPark(): void {
    const P = BENIN_MOTOR_PARK;
    this.motorPark(P.x, P.z, P.w, P.d, 'BENIN MOTOR PARK', 'Edo Line Motors · Lagos • Abuja • Asaba', TRAVEL.bus.desk.benin, false);
    this.w.footprint(P.x, P.z, P.w, P.d, 's', 'motorpark', false);
  }

  private beninCheckIn(): void {
    const w = this.w, d = TRAVEL.flight.desk.benin;
    const k = new THREE.Mesh(new RoundedBoxGeometry(6, 1.1, 1.0, 3, 0.2), M('#1d3b5a', 0.5)); k.position.set(d.x, 0.55 + 0.16, d.z - 1.7); w.add(k); w.collide(d.x, d.z - 1.7, 6, 1);
    w.signMesh({ text: 'IVIE AIR CHECK-IN', bg: '#7a1022', fg: '#ffffff', sub: 'Departures · Flights to Lagos' }, 4.6, 0.9, w.scene, d.x, 3, d.z - 4.9);
  }
}
