import { makeGun } from './guns';
import type { WeaponId } from '../../shared/combat';
import * as THREE from 'three';
import { OUTFIT_COLORS, SKIN_TONES, type Appearance, type OutfitStyle } from '../../shared/constants';
import { nameTagTexture } from './textures';
import { HumanRig, humansReady, setAnkaraTexture } from './human';

/** suit: true/'black' = dark suit, 'white' = BEST 𝕏 white suit. crown = gold crown-emblem pendant on a chain. */
export interface CharacterOpts { suit?: boolean | 'white' | 'black'; sunglasses?: boolean; crown?: boolean; style?: OutfitStyle; procedural?: boolean }

let ankaraTex: THREE.CanvasTexture | null = null;
/** original wax-print style pattern (concentric circles + leaf motifs), drawn procedurally */
function ankaraTexture(): THREE.CanvasTexture {
  if (ankaraTex) return ankaraTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#e0631c'; g.fillRect(0, 0, 256, 256);
  const cols = ['#1d3f8a', '#f2c230', '#12784a', '#7a1c4a'];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const cx = x * 64 + (y % 2) * 32 + 16, cy = y * 64 + 32;
    for (let r = 26, i = 0; r > 4; r -= 6, i++) { g.fillStyle = cols[(i + x + y) % 4]; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#f7ecd2'; g.beginPath(); g.ellipse(cx + 32, cy - 32, 10, 4, 0.8, 0, Math.PI * 2); g.fill();
  }
  ankaraTex = new THREE.CanvasTexture(c); ankaraTex.colorSpace = THREE.SRGBColorSpace;
  ankaraTex.wrapS = ankaraTex.wrapT = THREE.RepeatWrapping; ankaraTex.repeat.set(2, 1.5); return ankaraTex;
}
let agbadaTex: THREE.CanvasTexture | null = null;
/** cream damask with gold embroidery at the neckline (texture v=1 is the top of the robe) */
function agbadaTexture(): THREE.CanvasTexture {
  if (agbadaTex) return agbadaTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#e9dfc6'; g.fillRect(0, 0, 512, 256);
  g.globalAlpha = 0.12; g.fillStyle = '#b8a77e';
  for (let y = 0; y < 256; y += 16) for (let x = (y / 16) % 2 * 8; x < 512; x += 16) g.fillRect(x, y, 6, 6);
  g.globalAlpha = 1; g.strokeStyle = '#b8892c'; g.lineWidth = 3;
  for (const cx of [128, 384]) { // front + back embroidery panels below the collar
    for (let r = 14; r < 70; r += 12) { g.beginPath(); g.arc(cx, 0, r, 0, Math.PI); g.stroke(); }
    for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(cx - 40 + i * 10, 70); g.lineTo(cx - 40 + i * 10, 110 + (i % 2) * 14); g.stroke(); }
  }
  agbadaTex = new THREE.CanvasTexture(c); agbadaTex.colorSpace = THREE.SRGBColorSpace; agbadaTex.flipY = false; return agbadaTex;
}

const V = (x: number, y: number) => new THREE.Vector2(x, y);
/** Smooth surface of revolution through (radius, y) control points (Catmull-Rom resampled). */
function lathe(profile: [number, number][], seg = 22, samples = 28): THREE.LatheGeometry {
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => V(Math.max(0.0005, r), y)));
  const pts = curve.getPoints(samples);
  pts[0].x = 0.0005; pts[pts.length - 1].x = 0.0005; // closed caps
  const g = new THREE.LatheGeometry(pts, seg); g.computeVertexNormals(); return g;
}
/** Limb segment: from y=0 down to y=-len, radius rTop → rBot with a soft muscle bulge. */
function limb(rTop: number, rBot: number, len: number, bulge = 0.12, seg = 16): THREE.LatheGeometry {
  // hemispherical caps so joints overlap smoothly (no pinched seams)
  const p: [number, number][] = [[0, rTop * 0.95], [rTop * 0.6, rTop * 0.78], [rTop * 0.92, rTop * 0.38]];
  for (let i = 0; i <= 6; i++) { const t = i / 6; p.push([THREE.MathUtils.lerp(rTop, rBot, t) * (1 + bulge * Math.sin(Math.PI * Math.min(1, t * 1.4))), -t * len]); }
  p.push([rBot * 0.92, -len - rBot * 0.38], [rBot * 0.6, -len - rBot * 0.78], [0, -len - rBot * 0.95]);
  return lathe(p, seg, 20);
}

/** Crown emblem (three gold points) as an extruded shape — matches the BEST 𝕏 logo silhouette. */
export function crownGeometry(size = 1): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  const P = (x: number, y: number) => [x * size, y * size] as const;
  s.moveTo(...P(-0.5, 0.42)); s.lineTo(...P(-0.27, -0.18)); s.lineTo(...P(-0.17, -0.06)); s.lineTo(...P(0, -0.42));
  s.lineTo(...P(0.17, -0.06)); s.lineTo(...P(0.27, -0.18)); s.lineTo(...P(0.5, 0.42)); s.lineTo(...P(0.24, 0.0));
  s.lineTo(...P(0, 0.62)); s.lineTo(...P(-0.24, 0.0)); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.08 * size, bevelEnabled: true, bevelThickness: 0.02 * size, bevelSize: 0.02 * size, bevelSegments: 2 });
  g.center(); return g;
}
export const goldMaterial = () => new THREE.MeshStandardMaterial({ color: '#d4a24a', metalness: 1, roughness: 0.28, emissive: '#3a2608', emissiveIntensity: 0.25 });

/**
 * Procedural human (≈1.78 m male / 1.68 m female) with smooth lathed anatomy — no boxes.
 * Head ≈ 1/7.5 of height, elliptical torso cross-section, tapered limbs, face with eyes/brows/nose/lips, hair,
 * PBR skin (physical material with sheen for a soft subsurface-like rim). Pivots at hips/knees/shoulders/elbows.
 */
export class Character {
  /** set once the CC0 MakeHuman bodies are loaded (Medium/High quality); Low keeps the procedural figure */
  static realistic = false;
  static shadows = true;
  group = new THREE.Group();
  private rig: HumanRig | null = null;
  private skinMat = new THREE.MeshPhysicalMaterial({ roughness: 0.52, metalness: 0, sheen: 0.45, sheenRoughness: 0.6, sheenColor: new THREE.Color('#7a3b26'), clearcoat: 0.08, clearcoatRoughness: 0.6 });
  private topMat = new THREE.MeshStandardMaterial({ roughness: 0.82 });
  private bottomMat = new THREE.MeshStandardMaterial({ roughness: 0.88, color: '#23262b' });
  private hairMat = new THREE.MeshStandardMaterial({ roughness: 0.92, color: '#0b0807' });
  private shoeMat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.05, color: '#1a1410' });
  private body = new THREE.Group();
  private legL = new THREE.Group(); private legR = new THREE.Group();
  private kneeL = new THREE.Group(); private kneeR = new THREE.Group();
  private armL = new THREE.Group(); private armR = new THREE.Group();
  private elbowL = new THREE.Group(); private elbowR = new THREE.Group();
  private head = new THREE.Group();
  private handR = new THREE.Group();
  private gun: { id: WeaponId; group: THREE.Group; muzzle: THREE.Vector3 } | null = null;
  private phase = 0;
  private tag?: THREE.Sprite;
  app: Appearance;

  constructor(app: Appearance, private opts: CharacterOpts = {}) {
    this.app = app;
    this.group.add(this.body);
    this.build();
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  }

  private build(): void {
    this.body.clear();
    const f = this.app.body === 'female';
    const s = f ? 0.955 : 1;
    const skin = new THREE.Color(SKIN_TONES[this.app.skin]);
    this.skinMat.color.copy(skin);
    this.skinMat.sheenColor.copy(skin).lerp(new THREE.Color('#b0583a'), 0.5);
    const st: OutfitStyle = this.opts.style ?? (this.opts.suit === 'white' ? 'white_suit' : this.opts.suit ? 'black_suit' : 'casual');
    const suit = st === 'white_suit' ? 'white' : st === 'black_suit' ? 'black' : undefined;
    const police = st === 'police';
    const native = st === 'senator' || st === 'edo_coral' || st === 'agbada'; // long top + matching trousers (both sexes)
    const nativeCol = st === 'senator' ? '#1f2a44' : st === 'agbada' ? '#e6dcc2' : '#f3f1ea';
    const outfit = police ? '#16181d' : suit === 'white' ? '#f2f0ea' : suit === 'black' ? '#17181b' : native ? nativeCol : st === 'ankara' ? '#ffffff' : OUTFIT_COLORS[this.app.outfit];
    this.topMat.color.set(outfit); this.topMat.roughness = suit === 'white' || st === 'edo_coral' ? 0.6 : 0.82;
    this.topMat.map = st === 'ankara' ? ankaraTexture() : null; this.topMat.needsUpdate = true;
    this.bottomMat.color.set(police ? '#121317' : suit === 'white' ? '#efede6' : suit ? '#17181b' : native ? nativeCol : f && st !== 'ankara' ? outfit : '#262a31');
    this.shoeMat.color.set(suit === 'white' || st === 'edo_coral' ? '#e9e4da' : '#1a1410');
    const hipY = 0.95 * s;

    // ---- torso: one smooth lathed shell from crotch to neck, elliptical section
    const T: [number, number][] = f
      ? [[0, -0.06], [0.135, -0.03], [0.175, 0.06], [0.16, 0.16], [0.13, 0.26], [0.15, 0.36], [0.165, 0.43], [0.17, 0.49], [0.145, 0.54], [0.085, 0.585], [0.05, 0.605], [0, 0.61]]
      : [[0, -0.06], [0.14, -0.03], [0.16, 0.06], [0.15, 0.16], [0.145, 0.26], [0.172, 0.36], [0.195, 0.44], [0.2, 0.49], [0.17, 0.545], [0.1, 0.59], [0.055, 0.615], [0, 0.62]];
    const torso = this.mesh(lathe(T.map(([r, y]) => [r * s, y * s]), 26, 36), this.topMat, this.body, 0, hipY);
    torso.scale.set(1, 1, 0.64);
    const skirtOn = f && !native && !police;
    if (f) for (const sx of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.062, 16, 12), this.topMat, this.body, sx * 0.058, hipY + 0.39 * s, 0.07).scale.set(1, 0.9, 0.85); // bust
    if (native) { // knee-length kaftan tunic flaring from the hips, with a stand collar
      const tunic = this.mesh(lathe([[0.168, 0.06], [0.172, -0.02], [0.19, -0.16], [0.205, -0.3], [0.207, -0.31]], 26, 12), this.topMat, this.body, 0, hipY);
      tunic.scale.set(1, 1, 0.74); (tunic.material as THREE.Material).side = THREE.DoubleSide;
      const col = this.mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.035, 18, 1, true), this.topMat, this.body, 0, hipY + 0.63 * s, 0.005); col.scale.set(1, 1, 0.92);
      if (st === 'senator') for (let i = 0; i < 3; i++) this.mesh(new THREE.SphereGeometry(0.007, 6, 6), goldMaterial(), this.body, 0.035, hipY + 0.55 - i * 0.06, 0.108 - i * 0.004);
    }
    if (st === 'agbada') { // flowing outer robe from the shoulders to below the knee (arms hang inside its wide sleeves)
      const robeMat = new THREE.MeshStandardMaterial({ map: agbadaTexture(), roughness: 0.7, side: THREE.DoubleSide });
      const robe = this.mesh(lathe([[0.075, 0.63], [0.15, 0.6], [0.3, 0.53], [0.38, 0.4], [0.42, 0.1], [0.44, -0.25], [0.45, -0.45]], 32, 24), robeMat, this.body, 0, hipY * 1);
      robe.scale.set(1, 1, 0.52);
    }
    if (st === 'edo_coral') { // red coral bead necklaces (two strands)
      const coral = new THREE.MeshStandardMaterial({ color: '#c0281c', roughness: 0.35 });
      const bead = new THREE.SphereGeometry(0.0095, 8, 6);
      for (const [ry, n, rr] of [[0.06, 26, 0.085], [0.11, 34, 0.1]] as const) {
        const inst = new THREE.InstancedMesh(bead, coral, n); const m = new THREE.Matrix4();
        for (let i = 0; i < n; i++) {
          const a = (i / (n - 1)) * Math.PI * 1.7 - Math.PI * 0.85; // open at the back of the neck
          const front = Math.cos(a); // 1 at the front
          m.makeTranslation(Math.sin(a) * rr, hipY + 0.6 - ry * Math.max(0, front) ** 1.5, front * rr * 0.72 + 0.04 * Math.max(0, front));
          inst.setMatrixAt(i, m);
        }
        this.body.add(inst);
      }
    }
    if (police) {
      this.mesh(lathe([[0, 0.025], [0.168, 0.022], [0.17, -0.018], [0, -0.022]], 24, 6), new THREE.MeshStandardMaterial({ color: '#3a2a1a', roughness: 0.5 }), this.body, 0, hipY + 0.07).scale.set(1, 1, 0.68);
      this.mesh(new THREE.BoxGeometry(0.03, 0.025, 0.01), goldMaterial(), this.body, 0, hipY + 0.07, 0.118);
      this.mesh(new THREE.SphereGeometry(0.016, 10, 8), goldMaterial(), this.body, -0.07, hipY + 0.45, 0.112).scale.set(1, 1.2, 0.35);
      const nm = this.mesh(new THREE.BoxGeometry(0.05, 0.012, 0.004), new THREE.MeshStandardMaterial({ color: '#d8d8d8' }), this.body, 0.075, hipY + 0.45, 0.116); nm.rotation.y = 0.15;
    }
    if (skirtOn) {
      const skirt = this.mesh(lathe([[0.16, 0.02], [0.2, -0.2], [0.24, -0.5], [0.245, -0.52]], 24, 10), this.bottomMat, this.body, 0, hipY, 0);
      (skirt.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide; skirt.scale.set(1, 1, 0.8);
    } else if (!f || native || police) {
      this.mesh(lathe([[0, 0.03], [0.163, 0.02], [0.165, -0.02], [0, -0.03]], 24, 6), this.bottomMat, this.body, 0, hipY + 0.02).scale.set(1, 1, 0.66); // trouser waist
    }
    if (suit) { // lapels, shirt and tie
      const shirt = new THREE.MeshStandardMaterial({ color: suit === 'white' ? '#1d1d1f' : '#ececec', roughness: 0.6 });
      const v = this.mesh(new THREE.ConeGeometry(0.06, 0.2, 3, 1), shirt, this.body, 0, hipY + 0.47, 0.105); v.rotation.set(Math.PI, 0, 0); v.scale.set(1, 1, 0.25);
      if (suit === 'black') this.mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.2, 6), new THREE.MeshStandardMaterial({ color: '#5a1010' }), this.body, 0, hipY + 0.44, 0.112);
      for (const sx of [-1, 1]) { const lap = this.mesh(new THREE.CapsuleGeometry(0.012, 0.2, 3, 6), this.topMat, this.body, sx * 0.05, hipY + 0.44, 0.11); lap.rotation.z = sx * 0.35; }
      for (let i = 0; i < 2; i++) this.mesh(new THREE.SphereGeometry(0.008, 6, 6), goldMaterial(), this.body, 0.02, hipY + 0.2 + i * 0.08, 0.103);
    }
    if (this.opts.crown) { // gold chain + crown-emblem pendant (BEST 𝕏)
      const gold = goldMaterial();
      const chain = this.mesh(new THREE.TorusGeometry(0.085, 0.006, 6, 40, Math.PI), gold, this.body, 0, hipY + 0.56, 0.035);
      chain.rotation.set(Math.PI / 2 + 0.95, 0, Math.PI); chain.scale.set(1, 1.15, 1);
      const pend = this.mesh(crownGeometry(0.075), gold, this.body, 0, hipY + 0.44, 0.118);
      pend.rotation.x = -0.12;
    }

    // ---- neck + head
    this.mesh(limb(0.05, 0.056, 0.11, 0.02, 14), this.skinMat, this.body, 0, hipY + 0.68 * s);
    const head = this.head; head.clear(); head.position.set(0, hipY + 0.775 * s, 0.005); this.body.add(head);
    const skull = this.mesh(lathe([[0, -0.118], [0.035, -0.114], [0.06, -0.095], [0.075, -0.06], [0.083, -0.02], [0.09, 0.02], [0.092, 0.055], [0.08, 0.095], [0.05, 0.12], [0, 0.128]], 24, 30), this.skinMat, head);
    skull.scale.set(0.93, 1, 1.02);
    this.mesh(new THREE.SphereGeometry(0.083, 18, 14), this.skinMat, head, 0, 0.03, -0.022).scale.set(0.95, 1, 1.05); // back of cranium
    // nose: soft wide base, typical West African profile
    // nose: soft bridge + broad rounded tip and nostril wings (no pointy cone)
    const bridge = this.mesh(new THREE.CapsuleGeometry(0.0085, 0.03, 4, 10), this.skinMat, head, 0, 0.005, 0.083); bridge.rotation.x = 0.28; bridge.scale.set(1, 1, 0.8);
    this.mesh(new THREE.SphereGeometry(0.0145, 14, 10), this.skinMat, head, 0, -0.019, 0.0905).scale.set(1.05, 0.85, 0.8);
    for (const sx of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.011, 12, 8), this.skinMat, head, sx * 0.0145, -0.023, 0.083).scale.set(1, 0.8, 0.8);
    // lips
    const lipMat = new THREE.MeshPhysicalMaterial({ color: skin.clone().multiplyScalar(0.82).lerp(new THREE.Color('#7a3f3a'), 0.25), roughness: 0.42, sheen: 0.4 });
    const ul = this.mesh(new THREE.CapsuleGeometry(0.0085, 0.028, 4, 10), lipMat, head, 0, -0.05, 0.0765); ul.rotation.z = Math.PI / 2; ul.scale.set(1, 1, 0.55);
    const ll = this.mesh(new THREE.CapsuleGeometry(0.009, 0.024, 4, 10), lipMat, head, 0, -0.0615, 0.0745); ll.rotation.z = Math.PI / 2; ll.scale.set(1, 1, 0.55);
    // eyes, lids, brows, ears
    const white = new THREE.MeshStandardMaterial({ color: '#ece6dc', roughness: 0.25 });
    const iris = new THREE.MeshStandardMaterial({ color: '#2a170c', roughness: 0.15 });
    const brow = new THREE.MeshStandardMaterial({ color: '#0d0907', roughness: 0.9 });
    for (const sx of [-1, 1]) {
      if (!this.opts.sunglasses) {
        const e = this.mesh(new THREE.SphereGeometry(0.0165, 14, 10), white, head, sx * 0.033, 0.018, 0.0735); e.scale.set(1.3, 0.8, 0.6);
        this.mesh(new THREE.SphereGeometry(0.0088, 12, 8), iris, head, sx * 0.033, 0.0175, 0.0815);
        const lid = this.mesh(new THREE.SphereGeometry(0.0145, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), this.skinMat, head, sx * 0.033, 0.0205, 0.073); lid.scale.set(1.25, 0.9, 0.75); lid.rotation.x = 0.35;
      }
      const b = this.mesh(new THREE.CapsuleGeometry(0.004, 0.026, 3, 6), brow, head, sx * 0.034, 0.04, 0.081); b.rotation.z = Math.PI / 2 + sx * 0.12;
      const ear = this.mesh(new THREE.SphereGeometry(0.02, 10, 8), this.skinMat, head, sx * 0.08, 0.005, -0.008); ear.scale.set(0.45, 1.15, 0.8);
    }
    if (this.opts.sunglasses) {
      const lens = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.05, metalness: 0.7 });
      for (const sx of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.019, 12, 8), lens, head, sx * 0.032, 0.022, 0.078).scale.set(1.3, 0.85, 0.35);
      this.mesh(new THREE.CapsuleGeometry(0.003, 0.11, 2, 6), goldMaterial(), head, 0, 0.03, 0.082).rotation.z = Math.PI / 2;
    }
    // hair: low fade for men (with light beard), natural puff / braided bun for women
    if (f) {
      const hair = this.mesh(this.hairShell(0.014), this.hairMat, head, 0, 0, -0.016);
      hair.scale.set(0.97, 1.04, 1.12); hair.rotation.x = -0.42;
      this.mesh(new THREE.SphereGeometry(0.068, 16, 12), this.hairMat, head, 0, 0.1, -0.075);
      for (let i = 0; i < 7; i++) { const a = -1.2 + i * 0.4; this.mesh(new THREE.TorusGeometry(0.083, 0.006, 5, 24, Math.PI * 0.9), this.hairMat, head, 0, 0.02, -0.01).rotation.set(0, a + Math.PI / 2, Math.PI / 2 + 0.1); }
    } else {
      // close-cropped hair: a thin shell that follows the skull, hairline tilted (higher at the forehead, lower at the nape)
      const hair = this.mesh(this.hairShell(0.006), this.hairMat, head, 0, 0, -0.012);
      hair.scale.set(0.95, 1.0, 1.1); hair.rotation.x = -0.5;
    }

    if (police) { // peaked cap with gold badge, shoulder epaulettes, belt, chest badge
      const capMat = new THREE.MeshStandardMaterial({ color: '#101114', roughness: 0.6 });
      this.mesh(new THREE.CylinderGeometry(0.1, 0.092, 0.06, 24), capMat, head, 0, 0.1, -0.008);
      const brim = this.mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 20, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.2 }), head, 0, 0.072, 0.05);
      brim.rotation.x = 0.18; brim.scale.set(1, 1, 0.75);
      this.mesh(new THREE.SphereGeometry(0.013, 10, 8), goldMaterial(), head, 0, 0.105, 0.09).scale.set(1, 1, 0.4);
    }
    if (st === 'agbada' || st === 'edo_coral') { // fila cap (agbada) / red coral-bead cap (Edo traditional)
      const capMat = st === 'agbada' ? new THREE.MeshStandardMaterial({ color: '#d8ccb0', roughness: 0.8 }) : new THREE.MeshStandardMaterial({ color: '#b52418', roughness: 0.4 });
      const cap = this.mesh(lathe([[0.094, 0.0], [0.097, 0.04], [0.09, 0.075], [0.06, 0.092], [0, 0.096]], 24, 12), capMat, head, 0, 0.065, -0.012);
      cap.rotation.x = -0.18; if (st === 'agbada') cap.rotation.z = 0.12;
    }

    // ---- legs (hip → knee → ankle), tapered and smooth
    const thighLen = 0.44 * s, shinLen = 0.43 * s, hipW = f ? 0.088 : 0.085;
    const legMat = skirtOn ? this.skinMat : this.bottomMat;
    for (const [leg, knee, sx] of [[this.legL, this.kneeL, -1], [this.legR, this.kneeR, 1]] as const) {
      leg.clear(); knee.clear(); leg.position.set(sx * hipW, hipY, 0); this.body.add(leg);
      this.mesh(limb(f ? 0.078 : 0.082, f ? 0.05 : 0.056, thighLen, 0.1), f ? this.bottomMat : legMat, leg).scale.set(1, 1, 0.95);
      knee.position.set(0, -thighLen, 0); leg.add(knee);
      this.mesh(limb(f ? 0.048 : 0.054, f ? 0.03 : 0.036, shinLen - 0.04, 0.22), legMat, knee).position.y = 0.0;
      const shoe = this.mesh(lathe([[0, 0.05], [0.035, 0.045], [0.045, 0.0], [0.042, -0.08], [0.03, -0.14], [0, -0.155]], 14, 16), this.shoeMat, knee, 0, -shinLen + 0.005, 0.035);
      shoe.rotation.x = -Math.PI / 2; shoe.scale.set(1.05, 1, 0.55);
    }
    // ---- arms (shoulder → elbow → hand) with deltoid caps
    const upperLen = 0.29 * s, foreLen = 0.26 * s, shoulderW = f ? 0.155 : 0.178;
    const sleeve = !!suit || native || police || !f;
    for (const [arm, elbow, sx] of [[this.armL, this.elbowL, -1], [this.armR, this.elbowR, 1]] as const) {
      arm.clear(); elbow.clear(); arm.position.set(sx * shoulderW, hipY + 0.5 * s, 0); this.body.add(arm);
      arm.rotation.z = sx * 0.09;
      this.mesh(new THREE.SphereGeometry(f ? 0.047 : 0.055, 16, 12), this.topMat, arm, sx * -0.01, -0.025, 0).scale.set(1, 1.1, 0.9);
      this.mesh(limb(f ? 0.044 : 0.052, f ? 0.034 : 0.04, upperLen, 0.15), this.topMat, arm, 0, -0.02);
      elbow.position.set(0, -upperLen - 0.01, 0); arm.add(elbow);
      this.mesh(limb(f ? 0.034 : 0.04, f ? 0.024 : 0.028, foreLen, 0.18), sleeve && (suit || native) ? this.topMat : this.skinMat, elbow);
      if (suit) this.mesh(limb(0.026, 0.025, 0.02, 0, 10), new THREE.MeshStandardMaterial({ color: '#f4f4f4' }), elbow, 0, -foreLen + 0.005);
      // hand: palm + thumb, slightly cupped
      const hand = new THREE.Group(); hand.position.set(0, -foreLen - 0.02, 0); elbow.add(hand); if (sx === 1) this.handR = hand;
      this.mesh(lathe([[0, 0.02], [0.03, 0.012], [0.034, -0.03], [0.026, -0.07], [0, -0.085]], 12, 12), this.skinMat, hand).scale.set(1, 1, 0.48);
      const th = this.mesh(new THREE.CapsuleGeometry(0.009, 0.03, 3, 6), this.skinMat, hand, -sx * -0.024, -0.025, 0.012); th.rotation.z = sx * 0.5;
    }
    this.rig = null;
    if (Character.realistic && humansReady() && !this.opts.procedural) {
      try {
        if (st === 'ankara') setAnkaraTexture(ankaraTexture());
        const rig = new HumanRig(this.app, st, !!this.opts.crown, !!this.opts.sunglasses, Character.shadows);
        this.body.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.visible = false; });
        rig.root.position.y = hipY - rig.hipY;
        this.body.add(rig.root); this.rig = rig;
      } catch (e) { console.warn('realistic character failed, procedural fallback', e); }
    }
    if (this.rig) this.handR = this.rig.handSocket; // realistic body: the weapon rides on the skeleton's hand bone
    if (this.gun) this.handR.add(this.gun.group);
  }
  /** show a weapon in the right hand (null = holstered) */
  setWeapon(id: WeaponId | null): void {
    if ((this.gun?.id ?? null) === id) return;
    if (this.gun) { this.gun.group.removeFromParent(); this.gun = null; }
    if (id) { const g = makeGun(id); this.gun = { id, ...g }; this.handR.add(g.group); }
  }
  get weapon(): WeaponId | null { return this.gun?.id ?? null; }
  /** world position of the muzzle (for flashes and tracers) */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    if (!this.gun) return out.copy(this.group.position).setY(this.group.position.y + 1.35);
    this.group.updateMatrixWorld(true); return this.gun.group.localToWorld(out.copy(this.gun.muzzle));
  }

  showTag(on: boolean): void { if (this.tag) this.tag.visible = on; }
  /** open cap following the skull profile (offset outward by `off`), from just above the brow to the crown */
  private hairShell(off: number): THREE.LatheGeometry {
    const pts: [number, number][] = [[0.09, 0.03], [0.092, 0.055], [0.08, 0.095], [0.05, 0.12], [0, 0.128]];
    const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r + off, y + off * 0.6)));
    const g = new THREE.LatheGeometry(curve.getPoints(16), 28); g.computeVertexNormals(); return g;
  }
  setAppearance(app: Appearance): void { this.app = app; this.build(); }
  setOpts(o: CharacterOpts): void { this.opts = o; this.build(); }

  setNameTag(name: string, admin = false, gang?: { tag: string; color: string; emblem: string }): void {
    if (this.tag) { this.group.remove(this.tag); (this.tag.material as THREE.SpriteMaterial).map?.dispose(); }
    const mat = new THREE.SpriteMaterial({ map: nameTagTexture(name, admin, gang), depthTest: true, transparent: true });
    this.tag = new THREE.Sprite(mat); this.tag.scale.set(1.6, 0.3, 1); this.tag.position.y = 2.08;
    this.group.add(this.tag);
  }

  /** 'sit' = seated pose (hips at seat height ≈ 0.46 m); talking 0..1 adds speech head motion + hand gestures; headLook = extra head yaw */
  pose: 'stand' | 'sit' = 'stand';
  talking = 0;
  headLook = 0;
  /** 0..1: scrubbing / working with both hands (jobs) */
  working = 0;
  /** 0..1: waving with the right arm (taxi passenger hailing) */
  wave = 0;
  /** seated at the wheel: hands on the steering wheel, turning with `steer` (radians, + = right) */
  driving = false; steer = 0;

  /** set by the game: yaw rate (rad/s, + = turning left) for leaning into turns; airborne 0..1 while jumping */
  yawRate = 0; airborne = 0;
  /** 0..1 weapon-aim blend, aim pitch (rad, + = up), 0..1 wounded/knocked-down blend, recoil kick */
  aim = 0; aimPitch = 0; downed = 0; kick = 0;
  private sSpeed = 0; private idleT = 0;
  /**
   * Locomotion: speed in m/s blends walk → jog → sprint (stride length grows with speed so the feet don't skate),
   * with torso lean, arm pump, bounce, leaning into turns, a jump/airborne tuck and idle weight-shifts / glances.
   */
  animate(dt: number, speed: number): void {
    if (this.pose === 'sit') { this.animateSit(dt); return; }
    this.sSpeed += (speed - this.sSpeed) * Math.min(1, dt * 7);
    const v = this.sSpeed;
    this.body.rotation.x = 0; this.body.rotation.z = 0; this.body.position.x = 0; this.head.rotation.x = 0;
    this.legL.rotation.z = 0; this.legR.rotation.z = 0; this.armL.rotation.z = 0; this.armR.rotation.z = 0.09;
    const moving = v > 0.25;
    const run = Math.min(1, Math.max(0, (v - 2.6) / 2.6)); const runS = run * run * (3 - 2 * run);
    const cycle = 1.45 + 0.95 * runS; // metres per full stride cycle (two steps)
    this.phase += moving ? dt * (v / cycle) * Math.PI * 2 : dt * 1.3;
    const g = moving ? Math.min(1, v / 1.1) : 0; // fade the gait in from a standstill
    const legA = (0.42 + 0.42 * runS) * g, armA = (0.32 + 0.55 * runS) * g;
    const sw = Math.sin(this.phase), cw = Math.cos(this.phase);
    this.legL.rotation.x = sw * legA; this.legR.rotation.x = -sw * legA;
    // swing leg folds (more when running), stance leg stays nearly straight
    const kneeSwing = 0.75 + 0.95 * runS;
    this.kneeL.rotation.x = (Math.max(0, -cw) * kneeSwing + 0.06) * g;
    this.kneeR.rotation.x = (Math.max(0, cw) * kneeSwing + 0.06) * g;
    this.armL.rotation.x = -sw * armA; this.armR.rotation.x = sw * armA;
    const elbow = -0.16 - (0.22 + 1.1 * runS) * g;
    this.elbowL.rotation.x = elbow - Math.max(0, sw) * 0.25 * runS; this.elbowR.rotation.x = elbow - Math.max(0, -sw) * 0.25 * runS;
    this.body.rotation.y = sw * (0.07 + 0.05 * runS) * g; // hip/shoulder counter-rotation
    this.body.rotation.x = (0.03 + 0.15 * runS) * g; // lean into the run
    this.body.rotation.z = Math.max(-0.18, Math.min(0.18, -this.yawRate * v * 0.022)); // lean into turns
    this.body.position.y = moving ? Math.abs(cw) * (0.022 + 0.05 * runS) * g - 0.012 * runS : Math.sin(this.phase) * 0.003;
    this.head.rotation.y = (moving ? -sw * 0.05 * g : 0) + this.headLook;
    this.head.rotation.x = -this.body.rotation.x * 0.6; // keep the eyes level
    if (!moving) { // idle: breathing, slow weight shift from foot to foot, the odd glance around
      this.idleT += dt;
      const shift = Math.sin(this.idleT * 0.45);
      this.body.position.x = shift * 0.018; this.body.rotation.z = -shift * 0.025;
      this.legL.rotation.z = shift * 0.03; this.legR.rotation.z = shift * 0.03;
      this.kneeL.rotation.x = Math.max(0, -shift) * 0.08; this.kneeR.rotation.x = Math.max(0, shift) * 0.08;
      const glance = Math.sin(this.idleT * 0.21) * Math.sin(this.idleT * 0.13);
      this.head.rotation.y = glance * 0.45 + this.headLook;
      this.armL.rotation.x = Math.sin(this.idleT * 0.9) * 0.02; this.armR.rotation.x = -Math.sin(this.idleT * 0.9) * 0.02;
    } else this.idleT = 0;
    if (this.airborne > 0.01) { // jump: knees tucked, arms up for balance
      const a = Math.min(1, this.airborne);
      this.legL.rotation.x = this.legL.rotation.x * (1 - a) - 0.55 * a; this.legR.rotation.x = this.legR.rotation.x * (1 - a) - 0.25 * a;
      this.kneeL.rotation.x = this.kneeL.rotation.x * (1 - a) + 1.0 * a; this.kneeR.rotation.x = this.kneeR.rotation.x * (1 - a) + 0.6 * a;
      this.armL.rotation.x = this.armL.rotation.x * (1 - a) - 0.7 * a; this.armR.rotation.x = this.armR.rotation.x * (1 - a) - 0.7 * a;
      this.armL.rotation.z = -0.35 * a; this.armR.rotation.z = 0.09 + 0.35 * a;
    }
    if (this.working > 0.01) { const w = this.working, k = Math.sin(this.phase * 5);
      this.armL.rotation.x = -1.1 * w + k * 0.25 * w; this.armR.rotation.x = -1.1 * w - k * 0.25 * w; this.elbowL.rotation.x = -0.6 * w; this.elbowR.rotation.x = -0.6 * w;
      this.body.position.y -= 0.06 * w; this.head.rotation.x = 0.35 * w; }
    if (this.wave > 0.01) { this.armR.rotation.z = 0.09 + this.wave * (2.5 + Math.sin(this.phase * 6) * 0.25); this.elbowR.rotation.x = -0.5 * this.wave; }
    this.kick = Math.max(0, this.kick - dt * 9);
    const held = this.gun ? Math.max(this.aim, 0.25) : 0; // weapon drawn: low ready; aiming: raised to the eye line
    if (held > 0.01) {
      const a = held, two = this.gun!.id !== 'pistol', p = this.aimPitch * this.aim, kick = this.kick * 0.35;
      const mix = (cur: number, v: number) => cur * (1 - a) + v * a;
      // two-handed grips. Right (gun) hand swings in to the body's centre line; the support hand meets it.
      // Long guns: the gun hand is drawn back to the shoulder (upper arm down, forearm level) and the support hand
      // holds the fore-end further out. The gun is counter-yawed in the hand, so the barrel stays on the crosshair.
      const low = (1 - this.aim) * 0.9, aimX = -Math.PI / 2 - p - kick + low - 0.14 * this.aim; // hands up near the eye line
      this.armR.rotation.x = mix(this.armR.rotation.x, aimX + (two ? 0.55 : 0.04)); this.armR.rotation.z = mix(this.armR.rotation.z, two ? -0.3 : -0.32);
      this.elbowR.rotation.x = mix(this.elbowR.rotation.x, two ? -0.55 : -0.04);
      this.armL.rotation.x = mix(this.armL.rotation.x, aimX + (two ? 0.3 : 0.1)); this.armL.rotation.z = mix(this.armL.rotation.z, two ? 0.5 : 0.4);
      this.elbowL.rotation.x = mix(this.elbowL.rotation.x, two ? -0.3 : -0.08);
      this.head.rotation.x = mix(this.head.rotation.x, -p * 0.6); this.head.rotation.y *= 1 - a;
    }
    if (this.gun) { this.gun.group.rotation.z = -this.armR.rotation.z * held; this.gun.group.rotation.x = 0.14 * this.aim; } // barrel stays on the crosshair
    if (this.downed > 0.01) { // wounded on the ground
      const d = this.downed;
      this.body.rotation.x = this.body.rotation.x * (1 - d) - 1.45 * d; this.body.position.y = this.body.position.y * (1 - d) + 0.2 * d; this.body.position.z = -0.75 * d;
      this.legL.rotation.x = 0.1 * d; this.legR.rotation.x = -0.25 * d; this.kneeL.rotation.x = 0.3 * d; this.kneeR.rotation.x = 0.6 * d;
      this.armL.rotation.x = -0.4 * d; this.armL.rotation.z = -0.9 * d; this.armR.rotation.x = -2.6 * d; this.armR.rotation.z = 0.5 * d; this.elbowR.rotation.x = -1.2 * d;
      this.head.rotation.y = 0.6 * d;
    } else this.body.position.z = 0;
    this.applyRig();
  }
  private applyRig(): void {
    if (!this.rig) return;
    this.rig.apply({ legL: this.legL.rotation, legR: this.legR.rotation, kneeL: this.kneeL.rotation, kneeR: this.kneeR.rotation,
      armL: this.armL.rotation, armR: this.armR.rotation, elbowL: this.elbowL.rotation, elbowR: this.elbowR.rotation, head: this.head.rotation });
  }

  private animateSit(dt: number): void {
    this.phase += dt;
    const s = this.app.body === 'female' ? 0.955 : 1;
    this.body.position.y = -0.95 * s + 0.535; this.body.rotation.y = 0; this.body.rotation.x = 0;
    for (const [leg, knee, sx] of [[this.legL, this.kneeL, -1], [this.legR, this.kneeR, 1]] as const) {
      leg.rotation.x = -1.5; leg.rotation.z = sx * -0.06; knee.rotation.x = 1.42;
    }
    const k = this.talking, t = this.phase;
    // forearms resting on the thighs; the right hand gestures while talking
    this.armL.rotation.x = -0.42; this.elbowL.rotation.x = -0.95;
    this.armR.rotation.x = -0.42 - k * (0.35 + Math.sin(t * 2.3) * 0.15); this.elbowR.rotation.x = -0.95 - k * (0.45 + Math.sin(t * 3.1) * 0.2);
    this.armR.rotation.z = 0.09 + k * 0.12 * Math.sin(t * 1.7);
    this.head.rotation.y = this.headLook + Math.sin(t * 0.4) * 0.05;
    this.head.rotation.x = k * Math.sin(t * 7.5) * 0.035 + Math.sin(t * 0.9) * 0.01;
    if (this.driving) { // both hands up on the wheel at ten-to-two; the wheel turn lifts one hand and drops the other
      const st = Math.max(-0.6, Math.min(0.6, this.steer));
      this.armL.rotation.x = -1.05 - st * 0.35; this.elbowL.rotation.x = -0.75; this.armL.rotation.z = -0.25;
      this.armR.rotation.x = -1.05 + st * 0.35; this.elbowR.rotation.x = -0.75; this.armR.rotation.z = 0.25;
      this.head.rotation.y = -st * 0.25;
    } else if (!k) { this.armL.rotation.z = 0; }
    this.applyRig();
  }
}
