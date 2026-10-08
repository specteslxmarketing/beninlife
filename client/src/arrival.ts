// Playable arrival: board a walkable airliner cabin, sit next to the advisor (who speaks the intro), watch the landing at
// Benin Airport, then stand up and walk off the plane. Client-side only (no money / no server state) until the end, when
// the server places the player in the arrivals hall.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import { Character } from './character';
import { M, canvasTex } from './interiors';
import { airliner, AIRLINER_GEAR_H } from './airliner';
import { RUNWAY } from './airport';
import type { AABB } from './world';

export const CABIN = { x: 0, z: -1200 };
const PITCH = 0.81, ROW1 = -8.4, ROWS = 20;
const rowZ = (r: number) => ROW1 + (r - 1) * PITCH;
const SEAT_X = { A: -1.75, B: -1.23, C: -0.71, D: 0.71, E: 1.23, F: 1.75 } as const;
type SeatL = keyof typeof SEAT_X;
export const MY_ROW = 8;
const SEAT_H = 0.46;

export type ArrivalPhase = 'board' | 'seated' | 'landing' | 'taxi' | 'deplane' | 'exit' | 'done';
export interface Line { who: 'advisor' | 'pa' | 'crew' | 'note'; name: string; text: string; dur: number }

/** The intro text required by the brief, spoken by the advisor (plus captain / crew lines around it). */
export const ADVISOR_NAME = 'Mr. Osaro (advisor)';
export const SEATED_LINES: Line[] = [
  { who: 'pa', name: 'Captain', text: 'Ladies and gentlemen, this is your captain. We have started our descent into Benin City. Please fasten your seatbelts.', dur: 6.5 },
  { who: 'advisor', name: ADVISOR_NAME, text: 'Ah, you made it. Sit down, sit down. First time in Benin City?', dur: 4.5 },
  { who: 'advisor', name: ADVISOR_NAME, text: 'This is Benin City. You should be very careful.', dur: 4.5 },
  { who: 'advisor', name: ADVISOR_NAME, text: 'In this game, BEST 𝕏 is the respected leader of Benin City and the most respected man in Edo State.', dur: 7 },
  { who: 'advisor', name: ADVISOR_NAME, text: 'You need to work to earn money.', dur: 4 },
  { who: 'advisor', name: ADVISOR_NAME, text: "Be careful, stay out of trouble, and don't join cults.", dur: 5.5 },
  { who: 'note', name: 'Note', text: 'Fictional game world: BEST 𝕏, the people, businesses and events in BENINLIFE are invented for this game.', dur: 6 },
  { who: 'pa', name: 'Captain', text: 'Cabin crew, please take your seats for landing.', dur: 4 },
];
export const TAXI_LINES: Line[] = [
  { who: 'pa', name: 'Captain', text: 'Welcome to Benin City. Please remain seated until the seatbelt sign is switched off.', dur: 5.5 },
  { who: 'advisor', name: ADVISOR_NAME, text: 'Welcome home. Find honest work — delivery, taxi, the car wash. And remember what I told you.', dur: 6.5 },
];

function carpetTex(): THREE.CanvasTexture {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = '#2b3442'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { const v = 30 + Math.random() * 40; c.fillStyle = `rgba(${v},${v + 8},${v + 22},0.6)`; c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    c.strokeStyle = 'rgba(200,170,90,0.10)'; c.lineWidth = 1.5; for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(64 + (k % 2) * 128, 64 + Math.floor(k / 2) * 128, 22, 0, Math.PI * 2); c.stroke(); }
  });
}
function fabricTex(): THREE.CanvasTexture {
  return canvasTex(128, 128, (c) => {
    c.fillStyle = '#1d4a44'; c.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 2) { c.fillStyle = y % 4 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.05)'; c.fillRect(0, y, 128, 1); }
    for (let i = 0; i < 500; i++) { c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); }
  });
}
function jetBridgeTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 256); bg.addColorStop(0, '#e9ecef'); bg.addColorStop(1, '#bfc5ca'); g.fillStyle = bg; g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#fffef6'; g.fillRect(44, 70, 40, 110); // daylight at the far end of the jet bridge
  g.strokeStyle = 'rgba(80,90,100,0.5)'; g.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[0, 0, 44, 70], [128, 0, 84, 70], [0, 256, 44, 180], [128, 256, 84, 180]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  g.fillStyle = '#6a7178'; g.beginPath(); g.moveTo(0, 256); g.lineTo(44, 180); g.lineTo(84, 180); g.lineTo(128, 256); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function roundRectAlpha(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 96); g.fillStyle = '#fff'; g.beginPath(); g.roundRect(4, 4, 56, 88, 26); g.fill();
  return new THREE.CanvasTexture(c);
}
function frameTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 96; c.height = 128; const g = c.getContext('2d')!;
  g.fillStyle = '#e4e2dc'; g.beginPath(); g.roundRect(0, 0, 96, 128, 40); g.fill();
  g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.roundRect(18, 18, 60, 92, 26); g.fill();
  g.globalCompositeOperation = 'source-over'; g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 3; g.beginPath(); g.roundRect(17, 17, 62, 94, 27); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function iconTex(kind: 'belt' | 'exit' | 'vacant'): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = kind === 'exit' ? '#0f7a3a' : '#1a1a1a'; g.fillRect(0, 0, 256, 96);
  g.fillStyle = kind === 'belt' ? '#ffd27a' : '#ffffff'; g.font = '800 46px "Noto Sans", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(kind === 'exit' ? 'EXIT' : kind === 'vacant' ? 'VACANT' : '⛓ FASTEN', 128, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** What the passengers see through the windows (drawn every frame onto one shared canvas). */
class WindowView {
  canvas = document.createElement('canvas'); tex: THREE.CanvasTexture;
  private scroll = 0; private clouds: { x: number; y: number; r: number; s: number }[] = [];
  constructor() {
    this.canvas.width = 192; this.canvas.height = 256;
    this.tex = new THREE.CanvasTexture(this.canvas); this.tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 26; i++) this.clouds.push({ x: Math.random() * 400, y: 0.2 + Math.random() * 0.8, r: 14 + Math.random() * 30, s: 0.4 + Math.random() * 0.8 });
  }
  /** alt metres, speed m/s, overcast 0..1, night 0..1, ground: 0 cloud deck … 1 city/runway close */
  draw(dt: number, alt: number, speed: number, overcast: number, night: number, bank: number): void {
    const g = this.canvas.getContext('2d')!; const W = 192, H = 256;
    this.scroll += dt * speed * (alt > 800 ? 0.12 : alt > 100 ? 0.5 : 4.5);
    const day = 1 - night;
    g.save(); g.translate(W / 2, H / 2); g.rotate(bank); g.translate(-W / 2, -H / 2);
    const sky = g.createLinearGradient(0, -60, 0, H * 0.55);
    const top = new THREE.Color('#2f6fb8').lerp(new THREE.Color('#7b8794'), overcast).multiplyScalar(0.25 + 0.75 * day);
    const hor = new THREE.Color('#cfe3f2').lerp(new THREE.Color('#b9bfc4'), overcast).multiplyScalar(0.2 + 0.8 * day);
    sky.addColorStop(0, '#' + top.getHexString()); sky.addColorStop(1, '#' + hor.getHexString());
    g.fillStyle = sky; g.fillRect(-60, -60, W + 120, H + 120);
    const horizon = H * (0.42 + Math.min(0.12, alt / 30000));
    // ground (tropical greens/browns, roads, rooftops near the city)
    const gc = new THREE.Color('#5e7a3a').lerp(new THREE.Color('#8a7a5a'), 0.3).multiplyScalar(0.25 + 0.75 * day);
    g.fillStyle = '#' + gc.getHexString(); g.fillRect(-60, horizon, W + 120, H);
    const near = THREE.MathUtils.clamp(1 - alt / 900, 0, 1);
    if (near > 0) {
      for (let i = 0; i < 40; i++) { // fields + rooftops scrolling toward the back of the plane (right → left)
        const depth = (i % 10) / 10, y = horizon + 4 + depth * depth * (H - horizon) * 1.05;
        const sp = 0.3 + depth * 2.2; const x = ((i * 53 + 400 - (this.scroll * sp) % 400) % 400) - 100;
        const sz = 4 + depth * 40;
        g.fillStyle = i % 3 === 0 ? `rgba(150,70,40,${0.55 * near})` : i % 3 === 1 ? `rgba(70,100,45,${0.6 * near})` : `rgba(180,170,150,${0.5 * near})`;
        g.fillRect(x, y, sz * 1.6, sz * 0.5);
      }
    }
    if (alt < 60) { // runway: grey band with fast dashes and edge lights
      const y0 = horizon + (H - horizon) * 0.35;
      g.fillStyle = '#5c5e60'; g.fillRect(-60, y0, W + 120, H);
      g.fillStyle = '#e8e6dc'; for (let k = 0; k < 6; k++) { const x = ((k * 90 - (this.scroll * 3) % 540) + 540) % 540 - 120; g.fillRect(x, y0 + (H - y0) * 0.55, 50, 4); }
      g.fillStyle = 'rgba(255,240,180,0.9)'; for (let k = 0; k < 10; k++) { const x = ((k * 45 - (this.scroll * 1.2) % 450) + 450) % 450 - 30; g.fillRect(x, y0 + 3, 3, 3); }
    }
    // haze at the horizon
    const hz = g.createLinearGradient(0, horizon - 30, 0, horizon + 50);
    hz.addColorStop(0, 'rgba(220,230,240,0)'); hz.addColorStop(0.5, `rgba(220,226,232,${0.55 * day})`); hz.addColorStop(1, 'rgba(220,230,240,0)');
    g.fillStyle = hz; g.fillRect(-60, horizon - 30, W + 120, 80);
    // cloud deck / passing clouds
    const deck = THREE.MathUtils.clamp((alt - 600) / 1800, 0, 1);
    for (const c of this.clouds) {
      const x = ((c.x - this.scroll * c.s * 0.8) % 400 + 400) % 400 - 100;
      const y = deck > 0 ? horizon + c.y * (H - horizon) * 0.9 : horizon - 20 - c.y * 90;
      const a = deck > 0 ? 0.75 * deck : 0.35 * (1 - near) + 0.12 * overcast;
      if (a <= 0.01) continue;
      const v = Math.round(255 * (0.3 + 0.7 * day)); g.fillStyle = `rgba(${v},${v},${v},${a})`;
      g.beginPath(); g.ellipse(x, y, c.r * 1.8, c.r * 0.55, 0, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    this.tex.needsUpdate = true;
  }
}

export class Arrival {
  group = new THREE.Group();
  colliders: AABB[] = [];
  phase: ArrivalPhase = 'board';
  advisor: Character; attendant: Character; passengers: Character[] = [];
  view = new WindowView();
  private doorPanel: THREE.Mesh; private doorLight: THREE.Mesh;
  private lights: THREE.Light[] = [];
  private seatMarker: THREE.Mesh;
  private planeExt: THREE.Group;
  t = 0; phaseT = 0; lineIdx = -1; lineT = 0; line: Line | null = null;
  alt = 3200; speed = 220; bank = 0;
  shot = 0; shake = 0;
  onLine: (l: Line | null) => void = () => {};
  onPhase: (p: ArrivalPhase) => void = () => {};
  onSay: (l: Line) => void = () => {};
  onChime: () => void = () => {};
  onTouchdown: () => void = () => {};

  constructor(scene: THREE.Scene, quality: 'low' | 'medium' | 'high') {
    const G = this.group; G.position.set(CABIN.x, 0, CABIN.z); scene.add(G);
    // ---- fuselage interior shell: smooth cross-section (sidewalls, window band, bins, ceiling) extruded along the cabin
    const R = 2.45, CY = 1.25; const sh = new THREE.Shape();
    const side: [number, number][] = [];
    for (let k = 0; k <= 10; k++) { const y = k * 0.178; side.push([Math.sqrt(R * R - (y - CY) ** 2), y]); }
    side.push([1.62, 1.84], [1.56, 1.88], [1.47, 2.2], [1.2, 2.31], [0.62, 2.41], [0, 2.44]);
    sh.moveTo(-side[0][0], 0); for (const [x, y] of side) sh.lineTo(x, y);
    for (let i = side.length - 2; i >= 0; i--) sh.lineTo(-side[i][0], side[i][1]);
    sh.closePath();
    const shellGeo = new THREE.ExtrudeGeometry(sh, { depth: 26, bevelEnabled: false, curveSegments: 4 }); shellGeo.translate(0, 0, -14);
    const shell = new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ color: '#e9e7e1', roughness: 0.55, side: THREE.BackSide }));
    shell.receiveShadow = true; G.add(shell);
    const carpet = carpetTex(); carpet.repeat.set(6, 36);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 26), new THREE.MeshStandardMaterial({ map: carpet, roughness: 0.95 })); fl.rotation.x = -Math.PI / 2; fl.position.set(0, 0.03, -1); G.add(fl);
    const aisle = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 26), M('#1c222c', 0.95)); aisle.rotation.x = -Math.PI / 2; aisle.position.set(0, 0.034, -1); G.add(aisle);
    // ceiling light strip + cove lights along the bins
    const glow = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3e0', emissiveIntensity: 1.4 });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 24), glow); strip.rotation.x = Math.PI / 2; strip.position.set(0, 2.43, -1.5); G.add(strip);
    const cove = new THREE.MeshStandardMaterial({ color: '#dfe9ff', emissive: '#cfe0ff', emissiveIntensity: 0.9 });
    for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 20), cove); c.rotation.set(Math.PI / 2, 0, 0); c.position.set(sx * 1.5, 2.2, -1.5); G.add(c); }
    // bin seams + passenger service units (reading lights + seatbelt signs)
    const seam = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.32, 0.02), M('#bfbcb5', 0.5), 2 * 13);
    const psu = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.03, 0.34), M('#d6d3cc', 0.5), 2 * ROWS);
    const m4 = new THREE.Matrix4(); let si = 0, pi = 0;
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 13; k++) { m4.makeTranslation(sx * 1.52, 2.04, -9 + k * 1.62); seam.setMatrixAt(si++, m4); }
      for (let r = 1; r <= ROWS; r++) { m4.makeTranslation(sx * 1.98, 1.795, rowZ(r) - 0.1); psu.setMatrixAt(pi++, m4); }
    }
    G.add(seam, psu);
    const beltM = new THREE.MeshStandardMaterial({ map: iconTex('belt'), emissiveMap: iconTex('belt'), emissive: '#ffffff', emissiveIntensity: 0.9 });
    this.beltMat = beltM;
    for (const r of [3, 7, 11, 15, 19]) for (const sx of [-1, 1]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.1), beltM); s.rotation.x = Math.PI / 2; s.position.set(sx * 1.85, 1.775, rowZ(r) + 0.1); G.add(s); }

    // ---- windows (one per row each side) showing the animated outside view
    const alpha = roundRectAlpha(); const fr = frameTex();
    const winM = new THREE.MeshBasicMaterial({ map: this.view.tex, alphaMap: alpha, transparent: true });
    const frM = new THREE.MeshStandardMaterial({ map: fr, transparent: true, roughness: 0.5 });
    for (const sx of [-1, 1]) for (let r = 0; r <= ROWS + 1; r++) {
      const z = rowZ(r) - 0.25; if (z > 8) continue;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.38), winM); w.position.set(sx * 2.425, 1.2, z); w.rotation.y = -sx * Math.PI / 2; G.add(w);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), frM); f.position.set(sx * 2.41, 1.2, z); f.rotation.y = -sx * Math.PI / 2; G.add(f);
    }

    // ---- seats (instanced): 20 rows × 3+3
    const fab = fabricTex(); fab.repeat.set(1, 1);
    const seatM = new THREE.MeshStandardMaterial({ map: fab, roughness: 0.92 });
    const parts = {
      cushion: new THREE.InstancedMesh(new RoundedBoxGeometry(0.48, 0.13, 0.5, 2, 0.05), seatM, ROWS * 6),
      back: new THREE.InstancedMesh(new RoundedBoxGeometry(0.48, 0.74, 0.11, 2, 0.05), seatM, ROWS * 6),
      head: new THREE.InstancedMesh(new RoundedBoxGeometry(0.4, 0.2, 0.03, 2, 0.012), M('#efede6', 0.8), ROWS * 6),
      screen: new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.13, 0.012), new THREE.MeshStandardMaterial({ color: '#0d1620', emissive: '#16324a', emissiveIntensity: 0.8, roughness: 0.2 }), ROWS * 6),
      arm: new THREE.InstancedMesh(new RoundedBoxGeometry(0.05, 0.05, 0.42, 1, 0.02), M('#5a5f66', 0.5, 0.3), ROWS * 8),
      frame: new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.05, 0.36), M('#3d4247', 0.5, 0.6), ROWS * 2),
    };
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.17), one = new THREE.Vector3(1, 1, 1), I = new THREE.Quaternion();
    const put = (im: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rot = I) => { m4.compose(new THREE.Vector3(x, y, z), rot, one); im.setMatrixAt(i, m4); };
    let n = 0, an = 0, fnn = 0;
    for (let r = 1; r <= ROWS; r++) {
      const z = rowZ(r);
      for (const L of Object.keys(SEAT_X) as SeatL[]) {
        const x = SEAT_X[L];
        put(parts.cushion, n, x, SEAT_H - 0.065, z);
        put(parts.back, n, x, 0.84, z + 0.28, q);
        put(parts.head, n, x, 1.08, z + 0.27, q);
        put(parts.screen, n, x, 0.98, z + 0.36, q);
        n++;
      }
      for (const sx of [-1, 1]) {
        for (const ax of [0.45, 0.97, 1.49, 2.0]) put(parts.arm, an++, sx * ax, 0.64, z + 0.02);
        put(parts.frame, fnn++, sx * 1.23, 0.3, z);
      }
    }
    for (const im of Object.values(parts)) { im.castShadow = quality !== 'low'; im.receiveShadow = true; G.add(im); }

    // ---- front galley, bulkheads, L1 door, cockpit door; rear lavatories
    const panel = M('#dedbd4', 0.5), steel = M('#b9bec2', 0.3, 0.8);
    for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.0, 0.08), panel); b.position.set(sx * 1.26, 1.0, -9.35); G.add(b); }
    const screenM = new THREE.MeshStandardMaterial({ color: '#0a1420', emissive: '#1f4f7a', emissiveIntensity: 0.9 });
    for (const sx of [-1, 1]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4), screenM); s.position.set(sx * 1.26, 1.55, -9.3); G.add(s); }
    const galley = new THREE.Mesh(new RoundedBoxGeometry(1.3, 2.0, 1.4, 2, 0.04), steel); galley.position.set(1.4, 1.0, -13.1); G.add(galley);
    for (let k = 0; k < 3; k++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.4), M('#8f969b', 0.3, 0.9)); d.position.set(0.74, 0.4 + k * 0.6, -13.1); G.add(d); }
    const ck = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.06), M('#9aa0a5', 0.45, 0.5)); ck.position.set(0, 1.0, -13.95); G.add(ck);
    // L1 door on the left wall (opens onto a bright jet bridge when it's time to leave)
    this.doorPanel = new THREE.Mesh(new RoundedBoxGeometry(0.12, 1.95, 0.95, 2, 0.12), M('#d3d0c9', 0.5)); this.doorPanel.position.set(-2.06, 1.0, -11.6); G.add(this.doorPanel);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.35), steel); handle.position.set(0.08, 0.1, 0); this.doorPanel.add(handle);
    this.doorLight = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.95), new THREE.MeshBasicMaterial({ map: jetBridgeTex() })); this.doorLight.position.set(-2.2, 1.0, -11.6); this.doorLight.rotation.y = Math.PI / 2; this.doorLight.visible = false; G.add(this.doorLight);
    const exitM = new THREE.MeshStandardMaterial({ map: iconTex('exit'), emissiveMap: iconTex('exit'), emissive: '#ffffff', emissiveIntensity: 1 });
    const ex = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), exitM); ex.position.set(-1.9, 2.15, -11.6); ex.rotation.y = Math.PI / 2; G.add(ex);
    const vac = new THREE.MeshStandardMaterial({ map: iconTex('vacant'), emissiveMap: iconTex('vacant'), emissive: '#ffffff', emissiveIntensity: 0.8 });
    for (const sx of [-1, 1]) {
      const lav = new THREE.Mesh(new RoundedBoxGeometry(1.5, 2.3, 1.9, 2, 0.05), panel); lav.position.set(sx * 1.25, 1.15, 9.6); G.add(lav);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), vac); s.position.set(sx * 1.0, 1.9, 8.64); G.add(s);
    }
    // ---- lights (only enabled while the arrival runs)
    const amb = new THREE.AmbientLight('#fff4e6', 0.55); G.add(amb); this.lights.push(amb);
    for (const z of [-10, -3, 4]) { const p = new THREE.PointLight('#fff1dc', 6, 9, 1.5); p.position.set(0, 2.2, z); G.add(p); this.lights.push(p); }

    // ---- colliders (world space)
    const C = (x0: number, z0: number, x1: number, z1: number) => this.colliders.push({ minX: CABIN.x + x0, maxX: CABIN.x + x1, minZ: CABIN.z + z0, maxZ: CABIN.z + z1 });
    C(-3, -15, -1.98, 13); C(1.98, -15, 3, 13); C(-3, -15, 3, -13.9); C(-3, 8.6, 3, 13);
    C(-2.05, rowZ(1) - 0.75, -0.42, rowZ(ROWS) + 0.45); C(0.42, rowZ(1) - 0.75, 2.05, rowZ(ROWS) + 0.45);
    C(0.75, -13.8, 2.05, -12.4);

    // ---- people: the advisor (8A), cabin attendant, a few seated passengers (kept deliberately few)
    this.advisor = new Character({ body: 'male', skin: 5, outfit: 2 }, { suit: 'black' });
    this.advisor.setNameTag('Mr. Osaro'); this.seat(this.advisor, MY_ROW, 'A');
    this.attendant = new Character({ body: 'female', skin: 3, outfit: 4 }, {});
    this.attendant.group.position.set(0.25, 0, -12.2); this.attendant.group.rotation.y = -Math.PI / 2; G.add(this.attendant.group);
    const pax: [number, SeatL, number, 'male' | 'female'][] = [[4, 'E', 1, 'female'], [11, 'C', 4, 'male'], [14, 'F', 6, 'female']];
    for (const [r, L, skin, body] of pax) { const p = new Character({ body, skin, outfit: (r * 3) % 6 }); this.seat(p, r, L); this.passengers.push(p); }
    for (const c of [this.advisor, this.attendant, ...this.passengers]) c.group.traverse((o) => { o.castShadow = quality !== 'low'; });

    // seat marker (glowing ring over 8B)
    this.seatMarker = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 32), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
    this.seatMarker.rotation.x = Math.PI / 2; this.seatMarker.position.set(SEAT_X.B, 1.45, rowZ(MY_ROW)); G.add(this.seatMarker);

    // exterior airliner for the landing cutscene (flies the approach onto the Benin Airport runway)
    this.planeExt = airliner(); this.planeExt.visible = false; scene.add(this.planeExt);
    this.setActive(true);
  }
  private beltMat: THREE.MeshStandardMaterial;

  seat(c: Character, row: number, L: SeatL): void {
    c.pose = 'sit'; c.group.position.set(SEAT_X[L], 0, rowZ(row) + 0.05); c.group.rotation.y = Math.PI; if (!c.group.parent) this.group.add(c.group);
  }
  /** world position of the player's seat */
  mySeat(): { x: number; z: number } { return { x: CABIN.x + SEAT_X.B, z: CABIN.z + rowZ(MY_ROW) + 0.05 }; }
  aisleAtMyRow(): { x: number; z: number } { return { x: CABIN.x, z: CABIN.z + rowZ(MY_ROW) }; }
  boardSpawn(): { x: number; z: number; rot: number } { return { x: CABIN.x - 1.0, z: CABIN.z - 11.6, rot: Math.PI / 2 }; }
  doorPos(): { x: number; z: number } { return { x: CABIN.x - 1.55, z: CABIN.z - 11.6 }; }
  setActive(on: boolean): void { for (const l of this.lights) l.visible = on; this.group.visible = on; }
  dispose(scene: THREE.Scene): void { scene.remove(this.group); scene.remove(this.planeExt); }

  setPhase(p: ArrivalPhase): void {
    this.phase = p; this.phaseT = 0; this.lineIdx = -1; this.lineT = 0; this.line = null; this.onLine(null);
    this.seatMarker.visible = p === 'board';
    if (p === 'deplane') { this.doorPanel.visible = false; this.doorLight.visible = true; this.beltMat.emissiveIntensity = 0.05; this.onChime(); }
    this.onPhase(p);
  }

  private runLines(lines: Line[], dt: number): boolean {
    this.lineT -= dt;
    if (this.lineT <= 0) {
      this.lineIdx++;
      if (this.lineIdx >= lines.length) { this.line = null; this.onLine(null); return true; }
      this.line = lines[this.lineIdx]; this.lineT = this.line.dur; this.onLine(this.line); this.onSay(this.line);
      if (this.line.who === 'pa') this.onChime();
    }
    return false;
  }

  /** per-frame update; returns the desired camera (or null = normal follow camera) */
  update(dt: number, night: number, overcast: number, playerPos: THREE.Vector2): { pos: THREE.Vector3; look: THREE.Vector3; fov?: number } | null {
    this.t += dt; this.phaseT += dt;
    const talking = this.line?.who === 'advisor' ? 1 : 0;
    this.advisor.talking += (talking - this.advisor.talking) * Math.min(1, dt * 4);
    // the advisor looks at you while speaking, otherwise out of the window now and then
    const wantLook = talking ? -0.75 : (Math.sin(this.t * 0.3) > 0.6 ? 0.5 : -0.2);
    this.advisor.headLook += (wantLook - this.advisor.headLook) * Math.min(1, dt * 3);
    this.advisor.animate(dt, 0); this.attendant.animate(dt, 0); for (const p of this.passengers) p.animate(dt, 0);
    this.seatMarker.position.y = 1.45 + Math.sin(this.t * 3) * 0.05; this.seatMarker.rotation.z += dt;
    // flight profile
    if (this.phase === 'board') { this.alt = 0; this.speed = 0; }
    else if (this.phase === 'seated') { this.alt = Math.max(700, 3200 - this.phaseT * 55); this.speed = 140; this.bank = Math.sin(this.t * 0.2) * 0.04; }
    else if (this.phase === 'taxi') { this.alt = 0; this.speed = Math.max(4, 70 - this.phaseT * 14); this.bank = 0; }
    else if (this.phase === 'deplane' || this.phase === 'exit') { this.alt = 0; this.speed = 0; }
    if (this.phase !== 'landing') this.view.draw(dt, this.alt, this.speed, overcast, night, this.bank);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const C = (x: number, y: number, z: number) => new THREE.Vector3(CABIN.x + x, y, CABIN.z + z);
    const rz = rowZ(MY_ROW);
    const jitter = () => new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.03, (Math.random() - 0.5) * this.shake * 0.03 + Math.sin(this.t * 1.3) * 0.004, 0);

    if (this.phase === 'seated') {
      const done = this.runLines(SEATED_LINES, dt);
      if (done) { this.setPhase('landing'); return null; }
      // cinematic coverage: two-shot from the aisle, over-the-shoulder on the advisor, window shot
      const shot = this.line?.who === 'advisor' ? (this.lineIdx % 2 ? 1 : 0) : this.line?.who === 'note' ? 2 : 0;
      if (shot === 0) return { pos: C(-0.05, 1.72, rz - 1.55).add(jitter()), look: C(-1.42, 1.02, rz + 0.05) };
      if (shot === 1) return { pos: C(-0.6, 1.4, rz - 0.48).add(jitter()), look: C(-1.68, 1.2, rz + 0.04), fov: 45 };
      return { pos: C(-2.12, 1.26, rz - 0.5).add(jitter()), look: C(-2.7, 1.12, rz - 0.05), fov: 55 };
    }
    if (this.phase === 'landing') {
      // exterior: the airliner flies a 3° approach and touches down on the Benin Airport runway
      const T = this.phaseT; const td = 7.0;
      const x = T < td ? -260 - (td - T) * 72 : -260 + 72 * (T - td) - 0.5 * 9 * (T - td) ** 2;
      const y = T < td ? AIRLINER_GEAR_H + (td - T) * 72 * 0.052 : AIRLINER_GEAR_H;
      const flare = T < td ? Math.min(0.06, (td - T) * 0.02) : 0;
      this.planeExt.visible = true; this.planeExt.position.set(x, y, RUNWAY.z); this.planeExt.rotation.set(0, Math.PI / 2, 0); this.planeExt.rotateX(-0.03 - flare);
      if (T >= td && T - dt < td) this.onTouchdown();
      if (T > td + 4.5) { this.planeExt.visible = false; this.shake = 1.2; this.setPhase('taxi'); return null; }
      const cam = new THREE.Vector3(-212, 1.9, RUNWAY.z + 30);
      return { pos: cam, look: new THREE.Vector3(x + 8, y - 0.6, RUNWAY.z), fov: T < td ? 24 : 34 };
    }
    if (this.phase === 'taxi') {
      const done = this.runLines(TAXI_LINES, dt);
      if (done && this.phaseT > 6) { this.setPhase('deplane'); return null; }
      return this.lineIdx % 2 ? { pos: C(-0.6, 1.4, rz - 0.48).add(jitter()), look: C(-1.68, 1.2, rz + 0.04), fov: 45 }
        : { pos: C(-2.12, 1.26, rz - 0.5).add(jitter()), look: C(-2.7, 1.12, rz - 0.05), fov: 55 };
    }
    void playerPos;
    return null;
  }
}
