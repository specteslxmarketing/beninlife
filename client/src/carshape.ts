// Procedural car body generator: smooth lofted bodies (superellipse cross-sections swept along the car, with real
// wheel-arch cut-outs in the side profile), a tapered tumblehome glasshouse, painted roof skin, blacked-out pillars,
// chrome window surrounds. Every proportion comes from a per-model Spec, so a boxy GLK-style SUV, a curvy RX-style SUV,
// Corolla/Camry sedans, a Sienna minivan, a Hilux pickup and a HiAce bus are genuinely different shapes. No logos.
import * as THREE from 'three';

export interface Spec {
  L: number; W: number; wheelR: number; wheelbase: number; wheelZ: number; tyreW: number;
  sill: number;                // underbody height between the wheels
  top: [number, number][];     // lower-body top line (z, y) from tail to nose: deck, beltline, cowl, hood
  roof: [number, number][];    // glasshouse top line (z, y) from rear window base to windshield base
  n: number; nG: number;       // squareness of the body / glasshouse sections (2 = round, 8 = boxy)
  tumble: number;              // glasshouse top width / base width
  noseP: number; tailP: number; // plan-view corner sharpness at the nose / tail (higher = squarer)
  pillars: number[];           // z of B/C/D pillars
  spokes: number; rimStyle: 'alloy' | 'multi' | 'steel';
  grille: { w: number; h: number; y: number; chrome?: boolean };
  lampY: number; tailY: number; tailBar?: boolean;
  bed?: [number, number];      // pickup bed z-range
  rails?: boolean;             // roof rails
  /** model-specific front/rear details: GLK-style upright twin-louvre grille + rectangular lamps + corner tail lamps;
   *  RX-style spindle (hourglass) grille + long swept headlamps + wedge tail lamps joined by a chrome tailgate strip */
  style?: 'glk' | 'rx';
}

/** monotone-in-z polyline from Catmull-Rom through control points, sampled as a function y(z) */
function curve(pts: [number, number][]): (z: number) => number {
  const c = new THREE.SplineCurve(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const s = c.getPoints(pts.length * 24);
  return (z: number) => {
    if (z <= s[0].x) return s[0].y;
    for (let i = 1; i < s.length; i++) if (s[i].x >= z) { const a = s[i - 1], b = s[i], t = (z - a.x) / Math.max(1e-6, b.x - a.x); return a.y + (b.y - a.y) * t; }
    return s[s.length - 1].y;
  };
}
const se = (c: number, n: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / n);

export class BodyShape {
  topY: (z: number) => number; roofY: (z: number) => number;
  zTail: number; zNose: number; zRw: number; zWs: number;
  constructor(public s: Spec) {
    this.topY = curve(s.top); this.roofY = curve(s.roof);
    this.zTail = -s.L / 2; this.zNose = s.L / 2; this.zRw = s.roof[0][0]; this.zWs = s.roof[s.roof.length - 1][0];
  }
  /** plan-view width factor 0..1 (rounded nose/tail corners) */
  plan(z: number): number {
    const t = z / (this.s.L / 2), p = t > 0 ? this.s.noseP : this.s.tailP;
    return Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(t)), p)), 1 / p);
  }
  halfW(z: number): number { return (this.s.W / 2) * this.plan(z); }
  bottomY(z: number): number {
    const s = this.s, ar = s.wheelR + 0.075; let y = s.sill;
    for (const wz of [s.wheelZ + s.wheelbase / 2, s.wheelZ - s.wheelbase / 2]) { const d = z - wz; if (Math.abs(d) < ar) y = Math.max(y, s.wheelR + Math.sqrt(ar * ar - d * d) * 0.98); }
    // bumpers rise towards the ends
    const t = Math.abs(z) / (s.L / 2); if (t > 0.86) y = Math.max(y, s.sill + (t - 0.86) * 1.6);
    return y;
  }
  /** lower-body section point (theta 0..2π, 0 = outer side middle, π/2 = top) at station z */
  body(z: number, th: number, out: THREE.Vector3): THREE.Vector3 {
    const f = this.plan(z), g = Math.pow(f, 0.3), yb = this.bottomY(z), yt = this.topY(z);
    const yc = (yb + yt) / 2, h = ((yt - yb) / 2) * g, w = (this.s.W / 2) * f;
    const c = Math.cos(th), sn = Math.sin(th);
    let x = se(c, this.s.n) * w; const y = yc + se(sn, this.s.n) * h;
    x *= 1 - 0.07 * Math.pow(Math.max(0, sn), 2) - 0.08 * Math.pow(Math.max(0, -sn), 3); // tumblehome + tuck-under
    return out.set(x, y, z);
  }
  /** body half-width at height y on station z (0 if the section doesn't reach that height) */
  widthAt(z: number, y: number): number {
    const f = this.plan(z), g = Math.pow(f, 0.3), yb = this.bottomY(z), yt = this.topY(z);
    const yc = (yb + yt) / 2, h = ((yt - yb) / 2) * g, w = (this.s.W / 2) * f;
    const t = (y - yc) / Math.max(1e-4, h); if (Math.abs(t) >= 1) return 0;
    const sn = Math.sign(t) * Math.pow(Math.abs(t), this.s.n / 2), c = Math.sqrt(Math.max(0, 1 - sn * sn));
    return Math.pow(c, 2 / this.s.n) * w * (1 - 0.07 * Math.pow(Math.max(0, sn), 2) - 0.08 * Math.pow(Math.max(0, -sn), 3));
  }
  /** z of the body surface at the front (or rear) for lateral offset x and height y */
  endZ(front: boolean, x: number, y: number): number {
    let z = front ? this.zNose : this.zTail; const step = front ? -0.02 : 0.02, ax = Math.abs(x);
    while (Math.abs(z) > 0.3 && this.widthAt(z, y) < ax) z += step;
    let lo = z - step, hi = z; // bisect between the last outside and first inside sample
    for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (this.widthAt(m, y) < ax) lo = m; else hi = m; }
    return hi;
  }
  /** a grid that hugs the nose (or tail) surface over x∈[x0,x1]; y range may vary with x (swept lamp shapes) */
  patch(front: boolean, x0: number, x1: number, y0: (x: number) => number, y1: (x: number) => number, off: number, nx = 14, ny = 6): THREE.BufferGeometry {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
      const x = x0 + (x1 - x0) * (i / nx), y = y0(x) + (y1(x) - y0(x)) * (j / ny);
      const z = this.endZ(front, x, y) + (front ? off : -off);
      pos.push(x, y, z); uv.push(i / nx, j / ny);
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const a = i * (ny + 1) + j, b = (i + 1) * (ny + 1) + j, c = a + 1, d = b + 1;
      if (front) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  /** points around the boundary of a patch (for chrome surrounds) */
  outline(front: boolean, x0: number, x1: number, y0: (x: number) => number, y1: (x: number) => number, off: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [], n = 16, at = (x: number, y: number) => new THREE.Vector3(x, y, this.endZ(front, x, y) + (front ? off : -off));
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * (i / n); pts.push(at(x, y0(x))); }
    for (let i = n; i >= 0; i--) { const x = x0 + (x1 - x0) * (i / n); pts.push(at(x, y1(x))); }
    return pts;
  }
  /** glasshouse section: u 0..1 runs from the right belt corner over the roof to the left belt corner */
  glass(z: number, u: number, out: THREE.Vector3, grow = 0): THREE.Vector3 {
    const yb = this.topY(z) - 0.04, yr = Math.max(yb + 0.001, this.roofY(z)), hh = yr - yb;
    const wb = this.halfW(z) * 0.9, th = u * Math.PI, c = Math.cos(th), sn = Math.sin(th);
    const fy = Math.pow(Math.abs(sn), 2 / this.s.nG), y = yb + fy * hh + grow;
    const w = (wb + (wb * this.s.tumble - wb) * fy) * (1 + grow * 0.6);
    return out.set(se(c, this.s.nG) * w, y, z);
  }
}

function loft(rows: number, cols: number, at: (i: number, j: number, v: THREE.Vector3) => void, closed: boolean, caps: boolean): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], v = new THREE.Vector3();
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { at(i, j, v); pos.push(v.x, v.y, v.z); uv.push(i / (rows - 1), j / (cols - (closed ? 0 : 1))); }
  const cc = closed ? cols : cols - 1;
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cc; j++) {
    const a = i * cols + j, b = i * cols + ((j + 1) % cols), c = (i + 1) * cols + j, d = (i + 1) * cols + ((j + 1) % cols);
    idx.push(a, b, c, b, d, c); // outward-facing (rows run +z, columns run anticlockwise seen from the front)
  }
  if (caps) for (const i of [0, rows - 1]) {
    let cx = 0, cy = 0, cz = 0; for (let j = 0; j < cols; j++) { cx += pos[(i * cols + j) * 3]; cy += pos[(i * cols + j) * 3 + 1]; cz += pos[(i * cols + j) * 3 + 2]; }
    const ci = pos.length / 3; pos.push(cx / cols, cy / cols, cz / cols); uv.push(i ? 1 : 0, 0.5);
    for (let j = 0; j < cols; j++) { const a = i * cols + j, b = i * cols + ((j + 1) % cols); if (i) idx.push(ci, b, a); else idx.push(ci, a, b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals(); return g;
}

export interface BodyGeos { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; roof: THREE.BufferGeometry; black: THREE.BufferGeometry; chrome: THREE.BufferGeometry; shape: BodyShape }
const cache = new Map<string, BodyGeos>();
export function bodyGeos(key: string, s: Spec): BodyGeos {
  const hit = cache.get(key); if (hit) return hit;
  const sh = new BodyShape(s);
  const R = 120, C = 40;
  const z0 = sh.zTail + 0.004, z1 = sh.zNose - 0.004;
  // lower body: the pickup bed is a separate tub, so the body top drops to the bed floor there
  const body = loft(R, C, (i, j, v) => { const z = z0 + (z1 - z0) * (i / (R - 1)); sh.body(z, (j / C) * Math.PI * 2, v); }, true, true);
  const GR = 56, GC = 26, gz0 = sh.zRw, gz1 = sh.zWs;
  const glass = loft(GR, GC, (i, j, v) => sh.glass(gz0 + (gz1 - gz0) * (i / (GR - 1)), j / (GC - 1), v), false, false);
  // painted roof skin: the upper band of the glasshouse between the roof's front and rear edges
  const roofPts = s.roof.slice(1, -1), rz0 = roofPts[0][0] - 0.02, rz1 = roofPts[roofPts.length - 1][0] + 0.05;
  const roof = loft(30, 18, (i, j, v) => sh.glass(rz0 + (rz1 - rz0) * (i / 29), 0.2 + 0.6 * (j / 17), v, 0.012), false, false);
  // pillars (gloss black) + A-pillars along the windshield edges
  const parts: THREE.BufferGeometry[] = [];
  for (const pz of s.pillars) for (const side of [0, 1]) {
    parts.push(loft(6, 8, (i, j, v) => { const z = pz - 0.05 + 0.1 * (i / 5), u = side ? 0.8 + 0.2 * (j / 7) : 0.2 * (j / 7); sh.glass(z, u, v, 0.008); }, false, false));
  }
  for (const u of [0.13, 0.87]) {
    const pts: THREE.Vector3[] = []; const za = roofPts[roofPts.length - 1][0];
    for (let k = 0; k <= 12; k++) pts.push(sh.glass(za + (gz1 - za) * (k / 12), u, new THREE.Vector3(), 0.01));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.04, 6));
    const rp: THREE.Vector3[] = []; const zr = roofPts[0][0];
    for (let k = 0; k <= 8; k++) rp.push(sh.glass(gz0 + (zr - gz0) * (k / 8), u, new THREE.Vector3(), 0.01));
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp), 10, 0.035, 6));
  }
  const black = mergeGeos(parts);
  // chrome belt-line window surrounds
  const ch: THREE.BufferGeometry[] = [];
  for (const u of [0.004, 0.996]) {
    const pts: THREE.Vector3[] = []; for (let k = 0; k <= 20; k++) pts.push(sh.glass(gz0 + 0.05 + (gz1 - gz0 - 0.1) * (k / 20), u, new THREE.Vector3(), 0.012));
    ch.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 30, 0.012, 5));
  }
  if (s.rails) for (const u of [0.24, 0.76]) {
    const pts: THREE.Vector3[] = []; for (let k = 0; k <= 10; k++) pts.push(sh.glass(rz0 + 0.1 + (rz1 - rz0 - 0.25) * (k / 10), u, new THREE.Vector3(), 0.06));
    ch.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.022, 6));
  }
  const res = { body, glass, roof, black, chrome: mergeGeos(ch), shape: sh };
  cache.set(key, res); return res;
}

function mergeGeos(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // minimal merge (positions/normals/uvs, indexed) so each car keeps its draw-call count low
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const g0 of gs) {
    const g = g0.index ? g0 : g0.toNonIndexed(); const base = pos.length / 3;
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i)); else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setIndex(idx);
  return out;
}

// ---------------------------------------------------------------- specs
const sedan = (o: Partial<Spec> = {}): Spec => ({
  L: 4.72, W: 1.8, wheelR: 0.33, wheelbase: 2.76, wheelZ: 0.05, tyreW: 0.22, sill: 0.3,
  top: [[-2.36, 0.88], [-2.2, 0.98], [-1.45, 1.0], [0, 0.97], [0.9, 0.95], [1.7, 0.86], [2.3, 0.74], [2.36, 0.62]],
  roof: [[-1.45, 0.96], [-1.0, 1.3], [-0.55, 1.43], [0.2, 1.45], [0.55, 1.36], [0.92, 0.94]],
  n: 4.2, nG: 3.4, tumble: 0.8, noseP: 5, tailP: 6, pillars: [-0.12], spokes: 5, rimStyle: 'alloy',
  grille: { w: 0.62, h: 0.16, y: 0.66 }, lampY: 0.72, tailY: 0.86, ...o,
});
export const SPECS: Record<string, Spec> = {
  sedan: sedan(),
  corolla: sedan({ L: 4.62, W: 1.78, spokes: 6 }),
  starter: sedan({ L: 4.62, W: 1.78, rimStyle: 'steel' }),
  camry_muscle: sedan({ L: 4.82, W: 1.82, grille: { w: 0.7, h: 0.15, y: 0.66, chrome: true }, spokes: 5 }),
  camry_bigdaddy: sedan({ L: 4.82, W: 1.82, grille: { w: 0.72, h: 0.2, y: 0.64, chrome: true }, spokes: 10, rimStyle: 'multi',
    roof: [[-1.5, 0.96], [-1.05, 1.3], [-0.55, 1.44], [0.2, 1.46], [0.6, 1.36], [0.98, 0.94]] }),
  elantra: sedan({ n: 3.6, nG: 2.8, spokes: 10, rimStyle: 'multi', roof: [[-1.7, 0.98], [-1.1, 1.32], [-0.5, 1.43], [0.2, 1.44], [0.6, 1.33], [1.02, 0.93]] }),
  accord: sedan({ L: 4.88, W: 1.84, n: 3.8, roof: [[-1.65, 0.98], [-1.1, 1.3], [-0.55, 1.43], [0.25, 1.44], [0.65, 1.33], [1.05, 0.93]], spokes: 10, rimStyle: 'multi' }),
  es350: sedan({ L: 4.9, W: 1.83, grille: { w: 0.66, h: 0.3, y: 0.6, chrome: true }, n: 3.6, spokes: 10, rimStyle: 'multi' }),
  c300: sedan({ L: 4.7, W: 1.81, n: 3.8, grille: { w: 0.62, h: 0.24, y: 0.64, chrome: true }, spokes: 5, roof: [[-1.55, 0.98], [-1.05, 1.3], [-0.55, 1.42], [0.15, 1.43], [0.55, 1.33], [0.96, 0.93]] }),
  rio: {
    ...sedan(), L: 4.06, W: 1.73, wheelR: 0.31, wheelbase: 2.58, wheelZ: 0.02, tyreW: 0.2, sill: 0.29,
    top: [[-2.03, 0.86], [-1.95, 0.96], [-1.2, 0.98], [0.6, 0.94], [1.4, 0.84], [1.98, 0.7], [2.03, 0.6]],
    roof: [[-1.98, 0.95], [-1.86, 1.36], [-1.4, 1.46], [0.0, 1.48], [0.35, 1.38], [0.66, 0.93]], pillars: [-0.62, -1.62], tailY: 1.05,
  },
  suv: {
    L: 4.75, W: 1.9, wheelR: 0.39, wheelbase: 2.8, wheelZ: 0.05, tyreW: 0.25, sill: 0.43,
    top: [[-2.37, 1.0], [-2.3, 1.12], [-1.0, 1.15], [0.9, 1.13], [1.55, 1.07], [2.25, 0.96], [2.37, 0.84]],
    roof: [[-2.28, 1.12], [-2.18, 1.66], [-1.8, 1.74], [0.4, 1.76], [0.75, 1.62], [1.3, 1.12]],
    n: 4.6, nG: 4, tumble: 0.82, noseP: 5, tailP: 7, pillars: [-0.25, -1.55], spokes: 6, rimStyle: 'alloy',
    grille: { w: 0.8, h: 0.26, y: 0.82 }, lampY: 0.92, tailY: 1.12, rails: true,
  },
  glk: { // X204 GLK 350 proportions: 4.525 × 1.84 × 1.69 m, wheelbase 2.755, overhangs 0.81 / 0.96, 235/50 R19.
    // Boxy and upright: square sections, flat roof, near-vertical tailgate, steep windshield, thick C-pillar,
    // beltline that kicks up behind the rear door, prominent roof rails.
    L: 4.53, W: 1.84, wheelR: 0.36, wheelbase: 2.755, wheelZ: 0.072, tyreW: 0.24, sill: 0.45,
    top: [[-2.265, 1.02], [-2.22, 1.17], [-1.6, 1.2], [-1.32, 1.16], [0.9, 1.14], [1.4, 1.1], [2.17, 1.0], [2.265, 0.86]],
    roof: [[-2.22, 1.17], [-2.1, 1.6], [-1.92, 1.665], [0.38, 1.69], [0.62, 1.6], [1.14, 1.13]],
    n: 7.5, nG: 7.5, tumble: 0.9, noseP: 10, tailP: 11, pillars: [-0.2, -1.42], spokes: 5, rimStyle: 'multi',
    grille: { w: 0.8, h: 0.32, y: 0.84, chrome: true }, lampY: 0.93, tailY: 1.03, rails: true, style: 'glk',
  },
  highlander: {
    L: 4.95, W: 1.93, wheelR: 0.39, wheelbase: 2.86, wheelZ: 0.05, tyreW: 0.25, sill: 0.44,
    top: [[-2.47, 1.0], [-2.4, 1.13], [-1.0, 1.15], [0.95, 1.13], [1.6, 1.06], [2.35, 0.95], [2.47, 0.82]],
    roof: [[-2.36, 1.13], [-2.22, 1.68], [-1.8, 1.77], [0.45, 1.78], [0.82, 1.64], [1.36, 1.12]],
    n: 4.2, nG: 3.6, tumble: 0.8, noseP: 5, tailP: 6, pillars: [-0.2, -1.4, -2.0], spokes: 6, rimStyle: 'alloy',
    grille: { w: 0.86, h: 0.3, y: 0.82, chrome: true }, lampY: 0.93, tailY: 1.13, rails: true,
  },
  rx350: { // AL10 RX 350 (2010–2015) proportions: 4.77 × 1.885 × 1.69 m, wheelbase 2.74, 235/55 R19.
    // Curvy crossover: rounded sections, long raked windshield, roof falling away to a fast D-pillar and raked
    // tailgate glass, rising beltline with a narrow tapering rear quarter window, short sloping bonnet.
    L: 4.77, W: 1.885, wheelR: 0.37, wheelbase: 2.74, wheelZ: 0.065, tyreW: 0.24, sill: 0.42,
    top: [[-2.385, 0.98], [-2.28, 1.12], [-1.55, 1.17], [-0.6, 1.13], [0.9, 1.09], [1.5, 1.0], [2.3, 0.86], [2.385, 0.72]],
    roof: [[-2.16, 1.14], [-1.9, 1.46], [-1.5, 1.64], [-0.1, 1.69], [0.45, 1.6], [1.3, 1.09]],
    n: 4.3, nG: 3.3, tumble: 0.78, noseP: 4.8, tailP: 5.6, pillars: [-0.3, -1.45], spokes: 10, rimStyle: 'multi',
    grille: { w: 0.66, h: 0.44, y: 0.7, chrome: true }, lampY: 0.9, tailY: 1.1, style: 'rx',
  },
  minivan: { // Sienna-style: short sloping nose, long roof, sliding-door pillar layout
    L: 5.1, W: 1.95, wheelR: 0.36, wheelbase: 3.03, wheelZ: 0.05, tyreW: 0.23, sill: 0.34,
    top: [[-2.55, 0.92], [-2.48, 1.04], [-1.0, 1.06], [1.15, 1.03], [1.75, 0.96], [2.45, 0.82], [2.55, 0.66]],
    roof: [[-2.48, 1.04], [-2.4, 1.7], [-2.0, 1.78], [0.45, 1.8], [1.0, 1.55], [1.75, 0.98]],
    n: 4, nG: 3.8, tumble: 0.82, noseP: 4.2, tailP: 7, pillars: [0.15, -1.25, -2.05], spokes: 5, rimStyle: 'alloy',
    grille: { w: 0.7, h: 0.18, y: 0.66 }, lampY: 0.84, tailY: 1.15,
  },
  pickup: { // Hilux-style double cab with an open bed
    L: 5.32, W: 1.86, wheelR: 0.4, wheelbase: 3.08, wheelZ: -0.05, tyreW: 0.26, sill: 0.5,
    top: [[-2.66, 0.98], [-2.6, 1.02], [-0.9, 1.02], [-0.7, 1.12], [0.9, 1.14], [1.6, 1.1], [2.55, 1.0], [2.66, 0.86]],
    roof: [[-0.66, 1.12], [-0.6, 1.72], [-0.4, 1.8], [0.45, 1.82], [0.8, 1.66], [1.32, 1.14]],
    n: 5.5, nG: 5, tumble: 0.85, noseP: 6, tailP: 12, pillars: [0.2], spokes: 6, rimStyle: 'alloy',
    grille: { w: 0.92, h: 0.32, y: 0.92 }, lampY: 1.0, tailY: 0.82, bed: [-2.62, -0.72],
  },
  bus: { // HiAce-style cab-over van: almost no bonnet, tall boxy body
    L: 5.3, W: 1.9, wheelR: 0.36, wheelbase: 3.1, wheelZ: 0.25, tyreW: 0.23, sill: 0.34,
    top: [[-2.65, 1.0], [-2.6, 1.1], [1.6, 1.1], [2.35, 1.02], [2.62, 0.86], [2.65, 0.6]],
    roof: [[-2.6, 1.1], [-2.58, 2.06], [-2.35, 2.14], [1.8, 2.16], [2.2, 1.88], [2.5, 1.1]],
    n: 6.5, nG: 7, tumble: 0.9, noseP: 6, tailP: 14, pillars: [1.25, 0.2, -0.9, -1.9], spokes: 0, rimStyle: 'steel',
    grille: { w: 0.85, h: 0.2, y: 0.72 }, lampY: 0.9, tailY: 1.0,
  },
};
SPECS.compact = SPECS.rio; SPECS.hiace = SPECS.bus; SPECS.hilux = SPECS.pickup; SPECS.sienna = SPECS.minivan;
