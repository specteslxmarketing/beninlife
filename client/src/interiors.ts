// Procedural house exteriors + enterable 3D interiors (placed in a separate area far from the city).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { HOUSES, interiorExit, type HouseDef } from '../../shared/constants';
import { Character, crownGeometry, goldMaterial } from './character';
import { Car } from './car';
import { plasterTexture } from './textures';
import { CROWN_GOLD_URL, crownGold } from './brand';

type AABB = { minX: number; maxX: number; minZ: number; maxZ: number };
interface Ctx { scene: THREE.Scene; colliders: AABB[]; quality: 'low' | 'medium' | 'high'; lights: THREE.PointLight[]; footprints?: { x: number; z: number; w: number; d: number; kind: string }[] }

const matCache = new Map<string, THREE.MeshStandardMaterial>();
export const M = (color: string, roughness = 0.8, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => {
  const k = color + roughness + metalness + JSON.stringify(extra);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
  return matCache.get(k)!;
};
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4; return t;
}
let _tile: THREE.CanvasTexture | null = null, _marble: THREE.CanvasTexture | null = null, _wood: THREE.CanvasTexture | null = null;
export function tileTex(): THREE.CanvasTexture {
  return _tile ??= canvasTex(512, 512, (c) => {
    c.fillStyle = '#d9d2c4'; c.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = 200 + Math.random() * 30; c.fillStyle = `rgb(${v},${v - 6},${v - 18})`; c.fillRect(x * 128 + 3, y * 128 + 3, 122, 122); }
    c.globalAlpha = 0.08; for (let i = 0; i < 400; i++) { c.fillStyle = '#6b5a40'; c.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  });
}
function marbleTex(): THREE.CanvasTexture {
  return _marble ??= canvasTex(1024, 1024, (c) => {
    c.fillStyle = '#f3efe8'; c.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 70; i++) { // veins
      c.strokeStyle = `rgba(${120 + Math.random() * 40},${110 + Math.random() * 30},${100},${0.08 + Math.random() * 0.16})`; c.lineWidth = 0.6 + Math.random() * 2.2;
      c.beginPath(); let x = Math.random() * 1024, y = Math.random() * 1024; c.moveTo(x, y);
      for (let k = 0; k < 12; k++) { x += (Math.random() - 0.3) * 90; y += (Math.random() - 0.5) * 60; c.lineTo(x, y); } c.stroke();
    }
    c.strokeStyle = 'rgba(190,150,70,0.9)'; c.lineWidth = 5; // gold inlay grid (large slabs)
    for (let k = 0; k <= 2; k++) { c.beginPath(); c.moveTo(k * 512, 0); c.lineTo(k * 512, 1024); c.stroke(); c.beginPath(); c.moveTo(0, k * 512); c.lineTo(1024, k * 512); c.stroke(); }
  });
}
function woodTex(): THREE.CanvasTexture {
  return _wood ??= canvasTex(512, 512, (c) => {
    c.fillStyle = '#6b4426'; c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 16; i++) { c.fillStyle = `rgba(${80 + Math.random() * 40},${50 + Math.random() * 20},25,0.55)`; c.fillRect(0, i * 32, 512, 30); }
    c.globalAlpha = 0.15; for (let i = 0; i < 300; i++) { c.fillStyle = '#2a170a'; c.fillRect(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 60, 1); }
  });
}
/** Original fictional Afrobeats artist "Eghosa Nova" — procedurally drawn poster (no real person's likeness). */
export function posterTexture(): THREE.CanvasTexture {
  return canvasTex(512, 768, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 768); g.addColorStop(0, '#2b0a3d'); g.addColorStop(0.55, '#c2410c'); g.addColorStop(1, '#f59e0b'); c.fillStyle = g; c.fillRect(0, 0, 512, 768);
    c.globalAlpha = 0.25; for (let i = 0; i < 14; i++) { c.fillStyle = '#ffd36b'; c.beginPath(); c.arc(256, 330, 60 + i * 26, 0, Math.PI * 2); c.lineWidth = 2; c.strokeStyle = '#ffd36b'; c.stroke(); } c.globalAlpha = 1;
    // stylised silhouette: head, durag, shoulders, mic
    c.fillStyle = '#120a08'; c.beginPath(); c.ellipse(256, 300, 62, 78, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(110, 560); c.quadraticCurveTo(140, 400, 256, 390); c.quadraticCurveTo(372, 400, 402, 560); c.lineTo(402, 600); c.lineTo(110, 600); c.fill();
    c.fillStyle = '#d4a24a'; c.beginPath(); c.ellipse(256, 262, 66, 42, 0, Math.PI, 0); c.fill(); // gold durag
    c.fillStyle = '#d4a24a'; c.fillRect(330, 360, 14, 120); c.beginPath(); c.arc(337, 352, 20, 0, Math.PI * 2); c.fill(); // mic
    c.fillStyle = '#fff'; c.textAlign = 'center';
    c.font = '900 76px "Noto Sans", Arial, sans-serif'; c.fillText('EGHOSA', 256, 110); c.fillText('NOVA', 256, 182);
    c.font = '700 30px "Noto Sans", Arial, sans-serif'; c.fillText('“RING ROAD ANTHEM”', 256, 650);
    c.font = '600 22px "Noto Sans", Arial, sans-serif'; c.fillText('LIVE IN BENIN CITY · FICTIONAL ARTIST', 256, 700);
  });
}
let _crownTex: THREE.Texture | null = null;
export function crownTexture(): THREE.Texture {
  if (_crownTex) return _crownTex;
  if (crownGold) { const t = new THREE.Texture(crownGold); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace; return (_crownTex = t); }
  const t = new THREE.TextureLoader().load(CROWN_GOLD_URL); t.colorSpace = THREE.SRGBColorSpace; return (_crownTex = t);
}

function add(ctx: Ctx, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast && ctx.quality !== 'low'; m.receiveShadow = true; (parent ?? ctx.scene).add(m); return m;
}
const box = (ctx: Ctx, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D) => add(ctx, new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);
const rbox = (ctx: Ctx, w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent?: THREE.Object3D, r = 0.06) => add(ctx, new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2, h / 2, d / 2)), mat, x, y, z, parent);
const collide = (ctx: Ctx, x: number, z: number, w: number, d: number) => ctx.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
function light(ctx: Ctx, x: number, y: number, z: number, color = '#ffd9a0', intensity = 6, dist = 12): void {
  if (ctx.quality === 'low' && ctx.lights.length > 6) return;
  const l = new THREE.PointLight(color, intensity, dist, 1.6); l.position.set(x, y, z); ctx.scene.add(l); ctx.lights.push(l);
}

// ---------------- furniture ----------------
function sofa(ctx: Ctx, x: number, z: number, rot: number, color: string, len = 2.2): void {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; ctx.scene.add(g);
  const fab = M(color, 0.95);
  rbox(ctx, len, 0.42, 0.9, fab, 0, 0.25, 0, g, 0.1); rbox(ctx, len, 0.55, 0.22, fab, 0, 0.62, -0.36, g, 0.1);
  for (const sx of [-1, 1]) rbox(ctx, 0.2, 0.5, 0.9, fab, sx * (len / 2 - 0.1), 0.45, 0, g, 0.08);
  for (let i = 0; i < Math.round(len / 0.7); i++) rbox(ctx, 0.62, 0.14, 0.7, M(color, 0.9, 0, { emissive: color, emissiveIntensity: 0.03 }), -len / 2 + 0.45 + i * 0.66, 0.52, 0.05, g, 0.06);
  const c = Math.cos(rot), s = Math.sin(rot);
  collide(ctx, x, z, Math.abs(c) * len + Math.abs(s) * 0.9, Math.abs(s) * len + Math.abs(c) * 0.9);
}
function table(ctx: Ctx, x: number, z: number, w: number, d: number, h = 0.76, top: THREE.Material = M('#5a3a22', 0.5)): void {
  rbox(ctx, w, 0.05, d, top, x, h, z, undefined, 0.02);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(ctx, new THREE.CylinderGeometry(0.03, 0.025, h, 8), M('#2a1a10', 0.6), x + sx * (w / 2 - 0.08), h / 2, z + sz * (d / 2 - 0.08));
  collide(ctx, x, z, w, d);
}
function chair(ctx: Ctx, x: number, z: number, rot: number, mat: THREE.Material = M('#4a2e1a', 0.6)): void {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; ctx.scene.add(g);
  rbox(ctx, 0.44, 0.06, 0.44, mat, 0, 0.46, 0, g, 0.02); rbox(ctx, 0.44, 0.5, 0.05, mat, 0, 0.74, -0.2, g, 0.02);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(ctx, new THREE.CylinderGeometry(0.02, 0.02, 0.46, 6), mat, sx * 0.19, 0.23, sz * 0.19, g);
}
function bed(ctx: Ctx, x: number, z: number, rot: number, w = 1.6, sheet = '#e8e2d6', frame: THREE.Material = M('#3b2616', 0.6)): void {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; ctx.scene.add(g);
  rbox(ctx, w + 0.1, 0.35, 2.1, frame, 0, 0.2, 0, g, 0.04); rbox(ctx, w, 0.25, 2.0, M(sheet, 0.95), 0, 0.48, 0.02, g, 0.08);
  rbox(ctx, w + 0.1, 1.1, 0.1, frame, 0, 0.6, -1.05, g, 0.04);
  for (const sx of [-1, 1]) rbox(ctx, w / 2 - 0.12, 0.14, 0.4, M('#ffffff', 0.95), sx * w / 4, 0.67, -0.75, g, 0.06);
  rbox(ctx, w, 0.06, 1.0, M('#7a1f2b', 0.9), 0, 0.62, 0.45, g, 0.03);
  const c = Math.abs(Math.cos(rot)); collide(ctx, x, z, c * (w + 0.1) + (1 - c) * 2.1, c * 2.1 + (1 - c) * (w + 0.1));
}
function tv(ctx: Ctx, x: number, z: number, rot: number, size = 1.3): void {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; ctx.scene.add(g);
  rbox(ctx, size + 0.4, 0.5, 0.42, M('#2b2b2e', 0.5), 0, 0.25, 0, g, 0.03);
  const scr = canvasTex(256, 144, (c) => { const gr = c.createLinearGradient(0, 0, 256, 144); gr.addColorStop(0, '#0b3d2e'); gr.addColorStop(1, '#1e6b4a'); c.fillStyle = gr; c.fillRect(0, 0, 256, 144); c.fillStyle = '#fff'; c.font = '700 20px Arial'; c.fillText('EDO NEWS 24', 14, 30); c.fillStyle = '#ffcc33'; c.fillRect(0, 118, 256, 26); c.fillStyle = '#111'; c.font = '600 14px Arial'; c.fillText('Weather: Benin City — check your phone', 8, 136); });
  rbox(ctx, size, size * 0.58, 0.05, M('#0a0a0a', 0.2, 0.3), 0, 0.5 + size * 0.32, 0, g, 0.02);
  add(ctx, new THREE.PlaneGeometry(size * 0.96, size * 0.54), new THREE.MeshStandardMaterial({ map: scr, emissiveMap: scr, emissive: '#ffffff', emissiveIntensity: 0.6, roughness: 0.2 }), 0, 0.5 + size * 0.32, 0.03, g, false);
}
function kitchen(ctx: Ctx, x: number, z: number, len: number, rot: number): void {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; ctx.scene.add(g);
  rbox(ctx, len, 0.88, 0.62, M('#f4f1ea', 0.55), 0, 0.44, 0, g, 0.02);
  box(ctx, len + 0.04, 0.04, 0.66, M('#2d2d30', 0.25, 0.1), 0, 0.9, 0, g);
  for (let i = 0; i < Math.floor(len / 0.6); i++) box(ctx, 0.56, 0.7, 0.02, M('#e8e3d8', 0.5), -len / 2 + 0.3 + i * 0.6, 0.45, 0.32, g);
  rbox(ctx, len, 0.6, 0.36, M('#f4f1ea', 0.55), 0, 1.85, -0.13, g, 0.02); // wall cabinets
  rbox(ctx, 0.62, 0.06, 0.5, M('#111', 0.3, 0.6), len / 2 - 0.5, 0.94, 0, g, 0.01); // hob
  for (const [a, b] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.12], [0.14, 0.12]]) add(ctx, new THREE.TorusGeometry(0.07, 0.012, 6, 16), M('#444', 0.4, 0.8), len / 2 - 0.5 + a, 0.98, b, g).rotation.x = Math.PI / 2;
  add(ctx, new THREE.BoxGeometry(0.5, 0.12, 0.38), M('#c8ccd0', 0.2, 0.9), -len / 2 + 0.8, 0.88, 0, g); // sink
  rbox(ctx, 0.75, 1.85, 0.7, M('#d9dcdf', 0.3, 0.6), -len / 2 - 0.45, 0.93, 0, g, 0.05); // fridge
  const c = Math.abs(Math.cos(rot)); collide(ctx, x, z, c * (len + 1) + (1 - c) * 0.7, c * 0.7 + (1 - c) * (len + 1));
}
function toilet(ctx: Ctx, x: number, z: number, rot: number): void {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; ctx.scene.add(g);
  const por = M('#fbfbf8', 0.15);
  const bowl = add(ctx, new THREE.LatheGeometry([new THREE.Vector2(0.12, 0), new THREE.Vector2(0.16, 0.2), new THREE.Vector2(0.21, 0.4), new THREE.Vector2(0.2, 0.42)], 18), por, 0, 0, 0.05, g); bowl.scale.set(1, 1, 1.3);
  rbox(ctx, 0.42, 0.4, 0.18, por, 0, 0.62, -0.22, g, 0.04);
  collide(ctx, x, z, 0.5, 0.6);
}
function basin(ctx: Ctx, x: number, z: number, rot: number, gold = false): void {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; ctx.scene.add(g);
  rbox(ctx, 0.7, 0.8, 0.45, gold ? M('#1b1b1d', 0.3) : M('#e9e4da', 0.5), 0, 0.4, 0, g, 0.03);
  add(ctx, new THREE.CylinderGeometry(0.2, 0.15, 0.12, 20), M('#fbfbf8', 0.12), 0, 0.86, 0, g);
  add(ctx, new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8), gold ? goldMaterial() : M('#c0c4c8', 0.2, 1), 0, 0.98, -0.15, g);
  box(ctx, 0.6, 0.8, 0.02, M('#aac4d0', 0.02, 1), 0, 1.6, -0.22, g); // mirror
}
function shower(ctx: Ctx, x: number, z: number): void {
  box(ctx, 1.0, 0.06, 1.0, M('#e9e4da', 0.4), x, 0.03, z);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#cfe6ee', roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.35 });
  box(ctx, 1.0, 2.0, 0.02, glass, x, 1.0, z + 0.5); box(ctx, 0.02, 2.0, 1.0, glass, x + 0.5, 1.0, z);
  add(ctx, new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), M('#c0c4c8', 0.2, 1), x - 0.3, 2.05, z - 0.3);
  collide(ctx, x, z, 1, 1);
}
function wardrobe(ctx: Ctx, x: number, z: number, rot: number, w = 1.6): void {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; ctx.scene.add(g);
  rbox(ctx, w, 2.1, 0.6, M('#5b3b22', 0.55), 0, 1.05, 0, g, 0.02);
  for (const sx of [-0.04, 0.04]) add(ctx, new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), M('#c9a54a', 0.3, 1), sx, 1.1, 0.31, g);
  const c = Math.abs(Math.cos(rot)); collide(ctx, x, z, c * w + (1 - c) * 0.6, c * 0.6 + (1 - c) * w);
}
function plant(ctx: Ctx, x: number, z: number, h = 1.2): void {
  add(ctx, new THREE.CylinderGeometry(0.22, 0.17, 0.4, 14), M('#7a4a2a', 0.8), x, 0.2, z);
  for (let i = 0; i < 7; i++) { const l = add(ctx, new THREE.SphereGeometry(0.28, 8, 6), M('#2f6b2a', 0.8), x + Math.cos(i) * 0.15, 0.5 + h * (0.3 + (i % 3) * 0.25), z + Math.sin(i) * 0.15); l.scale.set(0.6, 1.3, 0.6); }
  collide(ctx, x, z, 0.45, 0.45);
}
function rug(ctx: Ctx, x: number, z: number, w: number, d: number, color: string): void {
  const t = canvasTex(256, 256, (c) => { c.fillStyle = color; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#e8d29a'; c.lineWidth = 10; c.strokeRect(14, 14, 228, 228); c.lineWidth = 3; c.strokeRect(34, 34, 188, 188); c.fillStyle = '#e8d29a'; c.beginPath(); c.moveTo(128, 70); c.lineTo(186, 128); c.lineTo(128, 186); c.lineTo(70, 128); c.fill(); });
  const m = add(ctx, new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }), x, 0.012, z, undefined, false); m.rotation.x = -Math.PI / 2;
}
function frame(ctx: Ctx, tex: THREE.Texture, x: number, y: number, z: number, rotY: number, w: number, h: number, gold = true): void {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; ctx.scene.add(g);
  box(ctx, w + 0.12, h + 0.12, 0.04, gold ? goldMaterial() : M('#222', 0.5), 0, 0, 0, g);
  add(ctx, new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.12 }), 0, 0, 0.025, g, false);
}
function windowPanel(ctx: Ctx, x: number, y: number, z: number, rotY: number, w: number, h: number): void {
  const t = canvasTex(128, 128, (c) => { const g = c.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#bfe3ff'); g.addColorStop(1, '#f7f2df'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); c.fillStyle = '#55642f'; c.fillRect(0, 96, 128, 32); });
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = rotY; ctx.scene.add(g);
  add(ctx, new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.7 }), 0, 0, 0, g, false);
  for (const [fw, fh, fx, fy] of [[w + 0.1, 0.08, 0, h / 2], [w + 0.1, 0.08, 0, -h / 2], [0.08, h, -w / 2, 0], [0.08, h, w / 2, 0], [0.05, h, 0, 0]]) box(ctx, fw, fh, 0.06, M('#f2f2f2', 0.5), fx, fy, 0.02, g);
}
function chandelier(ctx: Ctx, x: number, y: number, z: number, scale = 1): void {
  const gold = goldMaterial();
  add(ctx, new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6), gold, x, y + 0.4, z, undefined, false);
  for (let tier = 0; tier < 2; tier++) {
    const r = (0.75 - tier * 0.3) * scale, yy = y - tier * 0.35 * scale;
    add(ctx, new THREE.TorusGeometry(r, 0.025, 6, 32), gold, x, yy, z, undefined, false).rotation.x = Math.PI / 2;
    const n = 10 - tier * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      add(ctx, new THREE.SphereGeometry(0.05 * scale, 8, 6), new THREE.MeshStandardMaterial({ color: '#fff3d6', emissive: '#ffd890', emissiveIntensity: 2.2 }), cx, yy + 0.06, cz, undefined, false);
      add(ctx, new THREE.OctahedronGeometry(0.045 * scale), new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0, metalness: 0, transmission: 0.8, ior: 2, transparent: true, opacity: 0.85 }), cx, yy - 0.12, cz, undefined, false).scale.y = 2;
    }
  }
  light(ctx, x, y - 0.3, z, '#ffd9a0', 14 * scale, 16 * scale);
}

/** Room shell: floor, ceiling, walls with door gaps; returns nothing (colliders added). */
function shell(ctx: Ctx, def: HouseDef, floor: THREE.Material, wallMat: THREE.Material, H: number, backGap?: { cx: number; w: number }): void {
  const { x, z, w, d } = def.interior;
  const f = add(ctx, new THREE.PlaneGeometry(w, d), floor, x, 0.005, z, undefined, false); f.rotation.x = -Math.PI / 2;
  const c = add(ctx, new THREE.PlaneGeometry(w, d), M('#f6f3ec', 0.9), x, H, z, undefined, false); c.rotation.x = Math.PI / 2;
  const T = 0.2, doorW = 1.6;
  // front wall with entrance gap
  const half = (w - doorW) / 2;
  for (const sx of [-1, 1]) { box(ctx, half, H, T, wallMat, x + sx * (doorW / 2 + half / 2), H / 2, z - d / 2); collide(ctx, x + sx * (doorW / 2 + half / 2), z - d / 2, half, T); }
  box(ctx, doorW, H - 2.3, T, wallMat, x, 2.3 + (H - 2.3) / 2, z - d / 2);
  // the entrance door itself (closed panel behind the gap → you exit via the EXIT action)
  box(ctx, doorW, 2.3, 0.08, M('#4a2c18', 0.5), x, 1.15, z - d / 2 - 0.12); collide(ctx, x, z - d / 2 - 0.2, doorW, 0.2);
  const mat = add(ctx, new THREE.PlaneGeometry(1.6, 0.9), M('#7a1f1f', 1), x, 0.01, z - d / 2 + 0.6, undefined, false); mat.rotation.x = -Math.PI / 2;
  if (!backGap) { box(ctx, w, H, T, wallMat, x, H / 2, z + d / 2); collide(ctx, x, z + d / 2, w, T); }
  else {
    const a0 = x - w / 2, a1 = backGap.cx - backGap.w / 2, b0 = backGap.cx + backGap.w / 2, b1 = x + w / 2;
    for (const [p, q] of [[a0, a1], [b0, b1]]) if (q - p > 0.05) { box(ctx, q - p, H, T, wallMat, (p + q) / 2, H / 2, z + d / 2); collide(ctx, (p + q) / 2, z + d / 2, q - p, T); }
    box(ctx, backGap.w, H - 3, T, wallMat, backGap.cx, 3 + (H - 3) / 2, z + d / 2);
  }
  for (const sx of [-1, 1]) { box(ctx, T, H, d, wallMat, x + sx * w / 2, H / 2, z); collide(ctx, x + sx * w / 2, z, T, d); }
  // skirting
  for (const sx of [-1, 1]) box(ctx, 0.04, 0.12, d, M('#5a3a22', 0.6), x + sx * (w / 2 - 0.12), 0.06, z);
}
/** Interior partition along x at local z, with door gaps at the given local x centres. */
function partitionX(ctx: Ctx, def: HouseDef, lz: number, x0: number, x1: number, gaps: number[], wallMat: THREE.Material, H: number): void {
  const { x, z } = def.interior; const gw = 1.2;
  const cuts = [x0, ...gaps.flatMap((g) => [g - gw / 2, g + gw / 2]), x1];
  for (let i = 0; i < cuts.length; i += 2) { const a = cuts[i], b = cuts[i + 1]; if (b - a < 0.05) continue; box(ctx, b - a, H, 0.14, wallMat, x + (a + b) / 2, H / 2, z + lz); collide(ctx, x + (a + b) / 2, z + lz, b - a, 0.14); }
}
function partitionZ(ctx: Ctx, def: HouseDef, lx: number, z0: number, z1: number, gaps: number[], wallMat: THREE.Material, H: number): void {
  const { x, z } = def.interior; const gw = 1.2;
  const cuts = [z0, ...gaps.flatMap((g) => [g - gw / 2, g + gw / 2]), z1];
  for (let i = 0; i < cuts.length; i += 2) { const a = cuts[i], b = cuts[i + 1]; if (b - a < 0.05) continue; box(ctx, 0.14, H, b - a, wallMat, x + lx, H / 2, z + (a + b) / 2); collide(ctx, x + lx, z + (a + b) / 2, 0.14, b - a); }
}
function exitSign(ctx: Ctx, def: HouseDef, H: number): void {
  const ex = interiorExit(def);
  const t = canvasTex(256, 96, (c) => { c.fillStyle = '#0d5c2e'; c.fillRect(0, 0, 256, 96); c.fillStyle = '#fff'; c.font = '800 54px Arial'; c.textAlign = 'center'; c.fillText('EXIT', 128, 66); });
  add(ctx, new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: '#ffffff', emissiveIntensity: 0.9 }), ex.x, Math.min(2.55, H - 0.2), def.interior.z - def.interior.d / 2 + 0.12, undefined, false);
}

/** Standard house interior (flat / bungalow / duplex): living room, dining, kitchen, bedroom, bathroom. */
function homeInterior(ctx: Ctx, def: HouseDef): void {
  const { x, z, w, d } = def.interior; const H = 3;
  const wallCol = def.kind === 'duplex' ? '#efe6d6' : def.kind === 'bungalow' ? '#e9efe6' : '#efe9dc';
  const wall = new THREE.MeshStandardMaterial({ map: plasterTexture(wallCol, 70 + w), roughness: 0.92 });
  const floor = new THREE.MeshStandardMaterial({ map: def.kind === 'duplex' ? marbleTex() : tileTex(), roughness: def.kind === 'duplex' ? 0.25 : 0.5 });
  (floor.map as THREE.Texture).repeat.set(w / 4, d / 4);
  shell(ctx, def, floor, wall, H);
  const hw = w / 2, hd = d / 2, mid = 0.6; // back rooms start at local z = mid
  partitionX(ctx, def, mid, -hw, hw, [-hw / 2, hw * 0.35], wall, H);
  partitionZ(ctx, def, -0.1 * w, mid, hd, [], wall, H);       // bedroom | kitchen
  partitionZ(ctx, def, hw * 0.6, mid, hd, [mid + 1.2], wall, H); // kitchen | bathroom (door from kitchen side)
  partitionX(ctx, def, mid + 2.6, hw * 0.6, hw, [], wall, H);    // bathroom back wall
  // LIVING ROOM (front-left)
  rug(ctx, x - hw / 2, z - hd / 2 + 0.6, 2.6, 2, '#7a2430');
  sofa(ctx, x - hw / 2, z - 0.6, Math.PI, '#5a4636', Math.min(2.4, hw - 1));
  table(ctx, x - hw / 2, z - hd / 2 + 0.7, 1.0, 0.55, 0.42, M('#2d1f14', 0.3));
  tv(ctx, x - hw + 0.4, z - hd / 2 + 0.9, Math.PI / 2, 1.2);
  plant(ctx, x - hw + 0.45, z - hd + 0.6);
  frame(ctx, posterTexture(), x - hw / 2, 1.7, z + mid - 0.09, Math.PI, 0.7, 1.05, false);
  // DINING (front-right)
  table(ctx, x + hw / 2, z - hd / 2 + 0.4, 1.6, 0.9);
  for (const sx of [-0.45, 0.45]) for (const sz of [-1, 1]) chair(ctx, x + hw / 2 + sx, z - hd / 2 + 0.4 + sz * 0.7, sz > 0 ? Math.PI : 0);
  add(ctx, new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16), M('#c79a3a', 0.4, 0.6), x + hw / 2, 0.86, z - hd / 2 + 0.4);
  windowPanel(ctx, x + hw - 0.11, 1.6, z - hd / 2 + 0.4, -Math.PI / 2, 1.6, 1.2);
  windowPanel(ctx, x - hw / 2, 1.6, z - hd + 0.11, 0, 1.4, 1.1);
  // BEDROOM (back-left)
  const bx = x + (-hw + (-0.1 * w)) / 2;
  bed(ctx, bx, z + hd - 1.2, Math.PI, def.kind === 'flat' ? 1.4 : 1.8);
  wardrobe(ctx, x - hw + 0.4, z + mid + 1.4, Math.PI / 2, 1.4);
  windowPanel(ctx, x - hw + 0.11, 1.6, z + hd - 1.4, Math.PI / 2, 1.2, 1.1);
  // KITCHEN (back-middle)
  const kx = x + (-0.1 * w + hw * 0.6) / 2;
  kitchen(ctx, kx + 0.3, z + hd - 0.45, Math.max(1.6, (hw * 0.6 + 0.1 * w) - 2.0), Math.PI);
  // BATHROOM (back-right)
  const tx = x + (hw * 0.6 + hw) / 2;
  toilet(ctx, tx + 0.3, z + hd - 0.5, Math.PI); basin(ctx, tx - 0.4, z + mid + 0.4, 0); shower(ctx, x + hw - 0.65, z + mid + 3.4 <= z + hd ? z + mid + 0.7 : z + mid + 0.7);
  // lights
  light(ctx, x - hw / 2, H - 0.4, z - hd / 2, '#ffe2b0', 5, 9); light(ctx, x + hw / 2, H - 0.4, z - hd / 2, '#ffe2b0', 4, 8);
  light(ctx, bx, H - 0.4, z + hd / 2 + 0.4, '#ffd59a', 3.5, 7); light(ctx, kx, H - 0.4, z + hd / 2 + 0.4, '#fff2d8', 3.5, 7);
  for (const [lx, lz] of [[x - hw / 2, z - hd / 2], [x + hw / 2, z - hd / 2], [bx, z + hd / 2 + 0.3], [kx, z + hd / 2 + 0.3]]) add(ctx, new THREE.CylinderGeometry(0.25, 0.3, 0.06, 20), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#ffe7c0', emissiveIntensity: 1.5 }), lx, H - 0.03, lz, undefined, false);
  exitSign(ctx, def, H);
}

/** BEST 𝕏 mansion interior: marble + gold, chandeliers, living/dining/office/bedroom/2 bathrooms, pool terrace, garage, guards. */
function mansionInterior(ctx: Ctx, def: HouseDef, guards: Character[]): void {
  const { x, z, w, d } = def.interior; const H = 5.2;
  const wall = new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.6 });
  const floor = new THREE.MeshStandardMaterial({ map: marbleTex(), roughness: 0.12, metalness: 0.05 });
  (floor.map as THREE.Texture).repeat.set(w / 6, d / 6);
  const hw = w / 2, hd = d / 2;
  const hx = x + (3 + hw) / 2; // back hall centre (opens to the pool terrace)
  shell(ctx, def, floor, wall, H, { cx: hx, w: 4 });
  const gold = goldMaterial();
  // gold cornice + skirting
  for (const sx of [-1, 1]) { box(ctx, 0.08, 0.18, d, gold, x + sx * (hw - 0.12), H - 0.1, z); box(ctx, 0.06, 0.16, d, gold, x + sx * (hw - 0.12), 0.08, z); }
  box(ctx, w, 0.18, 0.08, gold, x, H - 0.1, z + hd - 0.12);
  // layout: front band (z < 2): office (left) | grand living (centre) | dining (right); back band: bedroom (left) | bath1, bath2 (centre) | back hall to pool (right)
  const back = 2;
  partitionZ(ctx, def, -hw / 2 - 2, -hd, back, [-hd / 2], wall, H);
  partitionZ(ctx, def, hw / 2 + 2, -hd, back, [-hd / 2], wall, H);
  partitionX(ctx, def, back, -hw, hw, [-hw / 2 - 4, 0, hw / 2 + 5], wall, H);
  partitionZ(ctx, def, -3, back, hd, [], wall, H); partitionZ(ctx, def, 3, back, hd, [], wall, H); partitionZ(ctx, def, 0, back + 3.5, hd, [], wall, H);
  partitionX(ctx, def, back + 3.5, -3, 3, [-1.5, 1.5], wall, H);
  // GRAND LIVING ROOM
  rug(ctx, x, z - hd / 2 + 1, 9, 6, '#4a1420');
  sofa(ctx, x, z - 1, Math.PI, '#f2efe6', 4.2); sofa(ctx, x - 3.4, z - hd / 2 + 1, Math.PI / 2, '#f2efe6', 3.0); sofa(ctx, x + 3.4, z - hd / 2 + 1, -Math.PI / 2, '#f2efe6', 3.0);
  table(ctx, x, z - hd / 2 + 1, 2.2, 1.1, 0.42, new THREE.MeshStandardMaterial({ color: '#f5f2ec', roughness: 0.1 }));
  const vase = add(ctx, new THREE.LatheGeometry([new THREE.Vector2(0.08, 0), new THREE.Vector2(0.16, 0.15), new THREE.Vector2(0.07, 0.38), new THREE.Vector2(0.1, 0.45)], 20), gold, x, 0.46, z - hd / 2 + 1); vase.castShadow = false;
  tv(ctx, x, z - hd + 0.6, 0, 2.2);
  chandelier(ctx, x, H - 1.1, z - hd / 2 + 1, 1.4);
  for (const sx of [-1, 1]) plant(ctx, x + sx * 6, z - hd + 0.8, 1.6);
  // crown emblem on the living-room back wall + Eghosa Nova poster
  const emblem = add(ctx, new THREE.PlaneGeometry(2.2, 1.85), new THREE.MeshStandardMaterial({ map: crownTexture(), transparent: true, metalness: 0.6, roughness: 0.3, emissive: '#3a2608', emissiveIntensity: 0.5 }), x, 3.4, z + back - 0.1, undefined, false);
  emblem.rotation.y = Math.PI;
  frame(ctx, posterTexture(), x - 4.6, 2.2, z + back - 0.1, Math.PI, 1.2, 1.8);
  for (const sx of [-1, 1]) windowPanel(ctx, x + sx * 3.2, 2.4, z - hd + 0.11, 0, 2.2, 3.2);
  // DINING (front-right)
  const dx = x + hw / 2 + 2 + (hw / 2 - 2) / 2;
  table(ctx, dx, z - hd / 2, 1.3, 4.2, 0.78, new THREE.MeshStandardMaterial({ color: '#1a1410', roughness: 0.15, metalness: 0.1 }));
  for (let i = -1.5; i <= 1.5; i += 1) for (const sx of [-1, 1]) chair(ctx, dx + sx * 0.95, z - hd / 2 + i, sx > 0 ? -Math.PI / 2 : Math.PI / 2, M('#e9e2d0', 0.7));
  for (let i = -1; i <= 1; i++) add(ctx, new THREE.CylinderGeometry(0.03, 0.05, 0.3, 10), gold, dx, 0.95, z - hd / 2 + i * 1.3);
  chandelier(ctx, dx, H - 1.2, z - hd / 2, 1);
  windowPanel(ctx, x + hw - 0.11, 2.4, z - hd / 2, -Math.PI / 2, 3, 3);
  // OFFICE (front-left): desk, leather chair, shelves, crown plaque
  const ox = x - hw / 2 - 2 - (hw / 2 - 2) / 2;
  table(ctx, ox, z - hd / 2 + 1, 2.2, 1.0, 0.78, new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.35 }));
  rbox(ctx, 0.7, 1.2, 0.7, M('#1a1210', 0.4), ox, 0.6, z - hd / 2 + 2.0, undefined, 0.12); collide(ctx, ox, z - hd / 2 + 2.0, 0.7, 0.7);
  rbox(ctx, 0.5, 0.32, 0.03, M('#0b0b0b', 0.2), ox, 1.0, z - hd / 2 + 0.75, undefined, 0.01);
  for (let i = 0; i < 3; i++) { box(ctx, 2.4, 2.6, 0.35, new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.5 }), x - hw + 0.3, 1.3, z - hd + 2 + i * 2.6).rotation.y = Math.PI / 2; collide(ctx, x - hw + 0.3, z - hd + 2 + i * 2.6, 0.4, 2.4); for (let r = 0; r < 4; r++) for (let b = 0; b < 9; b++) box(ctx, 0.2, 0.42, 0.06 + (b % 3) * 0.02, M(['#7a1f1f', '#1f3a7a', '#2a5a2a', '#c9a54a'][(b + r) % 4], 0.8), x - hw + 0.45, 0.35 + r * 0.62, z - hd + 1.1 + i * 2.6 + b * 0.22).rotation.y = Math.PI / 2; }
  const plaque = add(ctx, crownGeometry(0.9), gold, ox, 3.2, z - hd + 0.2); plaque.castShadow = false;
  light(ctx, ox, H - 0.8, z - hd / 2 + 1, '#ffd9a0', 7, 11);
  // MASTER BEDROOM (back-left)
  const bx = x - (hw + 3) / 2;
  bed(ctx, bx, z + hd - 1.6, Math.PI, 2.2, '#f7f3ea', gold);
  wardrobe(ctx, x - hw + 0.4, z + back + 2.6, Math.PI / 2, 2.4);
  rug(ctx, bx, z + hd - 3.8, 4, 2.4, '#2a1f3a');
  chandelier(ctx, bx, H - 1.2, z + back + (hd - back) / 2, 0.9);
  windowPanel(ctx, x - hw + 0.11, 2.4, z + hd - 2, Math.PI / 2, 2.4, 2.6);
  // TWO BATHROOMS (back-centre): marble with gold fittings
  for (const sx of [-1, 1]) {
    const cx = x + sx * 1.5;
    toilet(ctx, cx, z + hd - 0.5, Math.PI); basin(ctx, cx + sx * -0.6, z + back + 4.2, 0, true);
    if (sx > 0) shower(ctx, cx + 0.8, z + back + 4.4);
    else { const tub = add(ctx, new RoundedBoxGeometry(1.0, 0.6, 1.9, 4, 0.2), M('#fbfbf8', 0.1), cx - 0.6, 0.3, z + hd - 2.0); tub.castShadow = false; collide(ctx, cx - 0.6, z + hd - 2.0, 1, 1.9); }
    light(ctx, cx, H - 0.6, z + hd - 2.5, '#fff0d6', 3, 6);
  }
  // back hall (back-right) leads to the pool terrace door
  rug(ctx, hx, z + back + (hd - back) / 2, 3, 6, '#4a1420');
  for (const sx of [-1, 1]) plant(ctx, hx + sx * 3, z + hd - 0.8, 1.6);
  chandelier(ctx, hx, H - 1.2, z + back + (hd - back) / 2, 0.9);
  // TERRACE + POOL (outside the back wall)
  const tz = z + hd + 8;
  const terr = add(ctx, new THREE.PlaneGeometry(w + 28, 16), new THREE.MeshStandardMaterial({ map: tileTex(), color: '#f2ead8', roughness: 0.6 }), x, 0.004, tz, undefined, false); terr.rotation.x = -Math.PI / 2;
  (terr.material as THREE.MeshStandardMaterial).map = tileTex().clone(); (terr.material as THREE.MeshStandardMaterial).map!.repeat.set(18, 4); (terr.material as THREE.MeshStandardMaterial).map!.needsUpdate = true;
  const water = add(ctx, new THREE.PlaneGeometry(14, 6), new THREE.MeshPhysicalMaterial({ color: '#1aa6c9', roughness: 0.05, metalness: 0.1, transmission: 0.2, emissive: '#0a6c8a', emissiveIntensity: 0.35 }), hx - 4, 0.02, tz, undefined, false); water.rotation.x = -Math.PI / 2; water.name = 'pool';
  for (const [pw, pd, px, pz] of [[14.6, 0.3, 0, -3.15], [14.6, 0.3, 0, 3.15], [0.3, 6.6, -7.15, 0], [0.3, 6.6, 7.15, 0]]) box(ctx, pw, 0.12, pd, M('#f7f3ea', 0.4), hx - 4 + px, 0.06, tz + pz);
  collide(ctx, hx - 4, tz, 14, 6);
  for (let i = 0; i < 4; i++) { const lx = hx - 9 + i * 3.2; rbox(ctx, 0.7, 0.25, 1.9, M('#f5f2ec', 0.8), lx, 0.35, tz + 5, undefined, 0.08); rbox(ctx, 0.7, 0.6, 0.12, M('#f5f2ec', 0.8), lx, 0.6, tz + 5.9, undefined, 0.05); }
  for (const [px, pz] of [[x - hw - 10, tz - 5], [x + hw + 10, tz - 5], [x - 6, tz + 6], [hx + 6, tz + 6]]) { const t = add(ctx, new THREE.CylinderGeometry(0.15, 0.22, 6, 8), M('#7a6a52', 0.9), px, 3, pz); t.rotation.z = 0.05; for (let k = 0; k < 7; k++) { const lf = add(ctx, new THREE.SphereGeometry(1.4, 8, 4, 0, Math.PI * 2, 0, Math.PI / 3), M('#2f6b2a', 0.8), px + Math.cos(k) * 0.8, 6.1, pz + Math.sin(k) * 0.8); lf.scale.set(1, 0.4, 0.4); lf.rotation.y = k; } collide(ctx, px, pz, 0.5, 0.5); }
  // terrace boundary (garden wall)
  const gw = M('#e8dfcd', 0.85);
  box(ctx, w + 28, 2.4, 0.3, gw, x, 1.2, tz + 8); collide(ctx, x, tz + 8, w + 28, 0.3);
  for (const sx of [-1, 1]) { box(ctx, 0.3, 2.4, 16, gw, x + sx * (hw + 14), 1.2, tz); collide(ctx, x + sx * (hw + 14), tz, 0.3, 16); }
  light(ctx, hx - 4, 3, tz, '#bfefff', 6, 14);
  // GARAGE (left of terrace, under a roof) with BEST 𝕏's cars
  const gx = x - hw - 7;
  const roof = add(ctx, new THREE.BoxGeometry(13, 0.3, 14), M('#2a2a2c', 0.6), gx, 3.6, tz - 2); roof.castShadow = false;
  for (const [cx2, cz2] of [[-6.3, -8.8], [6.3, -8.8], [-6.3, 4.8], [6.3, 4.8]]) box(ctx, 0.35, 3.6, 0.35, gold, gx + cx2, 1.8, tz - 2 + cz2 * 0.75);
  const gfloor = add(ctx, new THREE.PlaneGeometry(13, 14), M('#3a3a3c', 0.35, 0.1), gx, 0.008, tz - 2, undefined, false); gfloor.rotation.x = -Math.PI / 2;
  const cars: [string, string, number][] = [['#f4f4f0', 'rx350', -4], ['#0d0e10', 'glk', 0], ['#7a7f86', 'es350', 4]];
  for (const [col, model, ox2] of cars) { const c = new Car(col, { model, body: model === 'es350' ? 'sedan' : 'suv' }); c.group.position.set(gx + ox2, 0, tz - 2); c.group.rotation.y = 0; c.setDirt(0); ctx.scene.add(c.group); collide(ctx, gx + ox2, tz - 2, 2.1, 4.7); }
  light(ctx, gx, 3.3, tz - 2, '#ffffff', 6, 12);
  // two guards just inside the entrance
  for (const sx of [-1, 1]) {
    const g = new Character({ body: 'male', skin: sx > 0 ? 2 : 4, outfit: 4 }, { suit: true, sunglasses: true });
    g.group.position.set(x + sx * 1.8, 0, z - hd + 1.0); g.group.rotation.y = 0; ctx.scene.add(g.group); guards.push(g); collide(ctx, x + sx * 1.8, z - hd + 1.0, 0.7, 0.7);
  }
  // warm fill lights
  for (const [lx, lz] of [[x - hw / 2, z], [x + hw / 2, z], [x, z + hd - 3]]) light(ctx, lx, H - 0.6, lz, '#ffcf8a', 4, 14);
  exitSign(ctx, def, H);
  // ambient warm hemisphere just for this area is not possible per-area; the point lights carry the warmth
}

/** Exteriors of the purchasable houses (in the city). Must run before filler buildings are placed. */
export function buildHouseExteriors(ctx: Ctx): void {
  for (const def of HOUSES) {
    if (def.kind === 'mansion') continue;
    const { x, z, w, d } = def.lot;
    const floors = def.kind === 'duplex' ? 2 : 1;
    const colour = def.kind === 'flat' ? '#e5d9bf' : def.kind === 'bungalow' ? '#f0ece2' : '#e9e1cf';
    const wall = new THREE.MeshStandardMaterial({ map: plasterTexture(colour, 80 + w), roughness: 0.9 });
    const bw = w - 2, bd = d - 3.5, fh = 3.2, bz = z + 1.2;
    box(ctx, bw, fh * floors, bd, wall, x, fh * floors / 2, bz); collide(ctx, x, bz, bw, bd);
    if (def.kind === 'bungalow') { const roof = add(ctx, new THREE.ConeGeometry(Math.hypot(bw, bd) / 2 + 0.6, 2.4, 4, 1), M('#6b2f22', 0.75), x, fh + 1.2, bz); roof.rotation.y = Math.PI / 4; roof.scale.set(bw / bd, 1, 1); }
    else { box(ctx, bw + 0.6, 0.3, bd + 0.6, M('#5a5550', 0.7), x, fh * floors + 0.15, bz); }
    if (def.kind === 'duplex') { box(ctx, bw * 0.6, 0.15, 1.4, M('#d8d0c0', 0.7), x - bw * 0.15, fh + 0.05, bz - bd / 2 - 0.7); for (let i = 0; i < 6; i++) box(ctx, 0.05, 0.9, 0.05, M('#222', 0.4, 0.6), x - bw * 0.45 + i * bw * 0.12, fh + 0.55, bz - bd / 2 - 1.35); }
    // windows + door on the front (north) face
    const front = bz - bd / 2 - 0.01;
    for (let f = 0; f < floors; f++) for (const sx of [-1, 1]) { const wp = add(ctx, new THREE.PlaneGeometry(1.4, 1.2), new THREE.MeshStandardMaterial({ color: '#2a3b4a', roughness: 0.1, metalness: 0.5, emissive: '#ffcf8a', emissiveIntensity: 0.15 }), x + sx * bw / 3.2, 1.7 + f * fh, front, undefined, false); wp.rotation.y = Math.PI; }
    const door = add(ctx, new THREE.PlaneGeometry(1.2, 2.3), M('#4a2c18', 0.5), x, 1.15, front, undefined, false); door.rotation.y = Math.PI;
    box(ctx, 2.6, 0.12, 1.6, M('#bdb6a8', 0.8), x, 0.06, front - 0.8);
    // low fence with gate opening
    const fm = M('#d6cdb8', 0.85);
    for (const sx of [-1, 1]) { box(ctx, (w - 3) / 2, 1.1, 0.2, fm, x + sx * ((w - 3) / 4 + 1.5), 0.55, z - d / 2); collide(ctx, x + sx * ((w - 3) / 4 + 1.5), z - d / 2, (w - 3) / 2, 0.2); }
    for (const sx of [-1, 1]) { box(ctx, 0.2, 1.1, d, fm, x + sx * w / 2, 0.55, z); collide(ctx, x + sx * w / 2, z, 0.2, d); }
    ctx.footprints?.push({ x, z, w: w + 2, d: d + 2, kind: 'house' });
  }
}

/** Builds every interior. Interior point lights are returned per house and start switched off —
 *  the game enables only the lights of the house the player is in (keeps the forward renderer cheap). */
export function buildInteriors(base: Omit<Ctx, 'lights'>): { guards: Character[]; lights: Map<string, THREE.PointLight[]> } {
  const guards: Character[] = []; const lights = new Map<string, THREE.PointLight[]>();
  for (const def of HOUSES) {
    const ctx: Ctx = { ...base, lights: [] };
    if (def.kind === 'mansion') mansionInterior(ctx, def, guards); else homeInterior(ctx, def);
    for (const l of ctx.lights) l.visible = false;
    lights.set(def.id, ctx.lights);
  }
  return { guards, lights };
}
