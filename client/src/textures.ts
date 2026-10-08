import * as THREE from 'three';
import { crownGold, drawCrown } from './brand';

// Deterministic PRNG so the city looks the same for every player.
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

let maxAniso = 4;
export function setMaxAnisotropy(n: number): void { maxAniso = n; }

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}

function tex(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = maxAniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, base: [number, number, number], amp: number, r: () => number, density = 1): void {
  ctx.fillStyle = `rgb(${base.join(',')})`; ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (r() > density) continue;
    const n = (r() - 0.5) * amp;
    d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, color: string, maxR: number, alpha: number, r: () => number): void {
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h, rad = maxR * (0.3 + r());
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, color.replace('A', String(alpha * (0.4 + r() * 0.6)))); g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
}

const cache = new Map<string, THREE.Texture>();
function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

export function asphaltTexture(): THREE.CanvasTexture {
  return cached('asphalt', () => {
    const [c, ctx] = canvas(512, 512); const r = rng(11);
    noise(ctx, 512, 512, [58, 58, 60], 38, r);
    blotches(ctx, 512, 512, 40, 'rgba(20,20,22,A)', 60, 0.35, r);
    blotches(ctx, 512, 512, 25, 'rgba(110,100,90,A)', 50, 0.12, r);
    ctx.strokeStyle = 'rgba(15,15,15,0.5)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) { ctx.beginPath(); let x = r() * 512, y = r() * 512; ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; ctx.lineTo(x, y); } ctx.stroke(); }
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

/** Road texture across the full 14 m width, tiling every 12 m along its length. */
export function roadTexture(): THREE.CanvasTexture {
  return cached('road', () => {
    const W = 512, H = 440; const [c, ctx] = canvas(W, H); const r = rng(12);
    noise(ctx, W, H, [56, 56, 58], 36, r);
    blotches(ctx, W, H, 30, 'rgba(18,18,20,A)', 50, 0.35, r);
    // tyre wear darker tracks in each lane
    const px = W / 14;
    for (const lx of [-5.25, -1.75, 1.75, 5.25]) for (const off of [-0.8, 0.8]) {
      ctx.fillStyle = 'rgba(25,25,27,0.22)'; ctx.fillRect((7 + lx + off - 0.35) * px, 0, 0.7 * px, H);
    }
    const paint = (x: number, w: number, color: string, dash = 0, gap = 0) => {
      ctx.fillStyle = color;
      if (!dash) { ctx.fillRect((7 + x - w / 2) * px, 0, w * px, H); return; }
      const ppm = H / 12;
      for (let y = 0; y < H; y += (dash + gap) * ppm) ctx.fillRect((7 + x - w / 2) * px, y, w * px, dash * ppm);
    };
    paint(-6.6, 0.15, 'rgba(225,222,210,0.85)'); paint(6.6, 0.15, 'rgba(225,222,210,0.85)');
    paint(-0.12, 0.1, 'rgba(214,170,40,0.85)'); paint(0.12, 0.1, 'rgba(214,170,40,0.85)');
    paint(-3.5, 0.12, 'rgba(225,222,210,0.8)', 3, 3); paint(3.5, 0.12, 'rgba(225,222,210,0.8)', 3, 3);
    // worn paint speckle
    const img = ctx.getImageData(0, 0, W, H); const d = img.data;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && r() < 0.18) { d[i] -= 90; d[i + 1] -= 90; d[i + 2] -= 90; }
    ctx.putImageData(img, 0, 0);
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

export function paverTexture(): THREE.CanvasTexture {
  return cached('paver', () => {
    const [c, ctx] = canvas(256, 256); const r = rng(13);
    noise(ctx, 256, 256, [150, 142, 132], 22, r);
    ctx.strokeStyle = 'rgba(70,64,58,0.7)'; ctx.lineWidth = 2;
    // interlocking "zig-zag" paving stones, very common on Nigerian walkways
    const s = 32;
    for (let y = 0; y < 256; y += s) for (let x = 0; x < 256; x += s * 2) {
      const ox = (y / s) % 2 ? s : 0;
      ctx.strokeRect(x + ox, y, s * 2, s);
      ctx.fillStyle = `rgba(${100 + r() * 60},${80 + r() * 40},${70 + r() * 30},0.12)`; ctx.fillRect(x + ox, y, s * 2, s);
    }
    blotches(ctx, 256, 256, 12, 'rgba(60,50,40,A)', 30, 0.25, r);
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

export function groundTexture(): THREE.CanvasTexture {
  return cached('ground', () => {
    const [c, ctx] = canvas(512, 512); const r = rng(14);
    // red-brown laterite soil with patches of dry grass, typical of Edo State verges
    noise(ctx, 512, 512, [128, 76, 50], 30, r);
    blotches(ctx, 512, 512, 70, 'rgba(78,92,48,A)', 70, 0.75, r);
    blotches(ctx, 512, 512, 40, 'rgba(110,104,60,A)', 50, 0.5, r);
    blotches(ctx, 512, 512, 30, 'rgba(90,50,32,A)', 40, 0.4, r);
    for (let i = 0; i < 4000; i++) { ctx.fillStyle = `rgba(${60 + r() * 50},${80 + r() * 40},${30 + r() * 20},0.5)`; ctx.fillRect(r() * 512, r() * 512, 1, 2 + r() * 3); }
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

export function grassTexture(): THREE.CanvasTexture {
  return cached('grass', () => {
    const [c, ctx] = canvas(256, 256); const r = rng(15);
    noise(ctx, 256, 256, [70, 88, 44], 30, r);
    blotches(ctx, 256, 256, 20, 'rgba(100,96,50,A)', 30, 0.4, r);
    for (let i = 0; i < 3000; i++) { ctx.fillStyle = `rgba(${40 + r() * 50},${70 + r() * 50},${25 + r() * 20},0.6)`; ctx.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3); }
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

/** Painted plaster with damp/mould streaks below the roof line (classic tropical weathering). */
export function plasterTexture(hex: string, seed = 1): THREE.CanvasTexture {
  return cached('plaster' + hex + seed, () => {
    const [c, ctx] = canvas(256, 256); const r = rng(100 + seed);
    const col = new THREE.Color(hex);
    noise(ctx, 256, 256, [col.r * 255, col.g * 255, col.b * 255].map(Math.round) as [number, number, number], 18, r);
    blotches(ctx, 256, 256, 14, 'rgba(90,80,60,A)', 40, 0.12, r);
    for (let i = 0; i < 18; i++) {
      const x = r() * 256, w = 3 + r() * 10, h = 30 + r() * 120;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(50,48,40,0.35)'); g.addColorStop(1, 'rgba(50,48,40,0)');
      ctx.fillStyle = g; ctx.fillRect(x, 0, w, h);
    }
    const g2 = ctx.createLinearGradient(0, 200, 0, 256); g2.addColorStop(0, 'rgba(120,70,45,0)'); g2.addColorStop(1, 'rgba(120,70,45,0.35)');
    ctx.fillStyle = g2; ctx.fillRect(0, 200, 256, 56); // red dust splash at the base
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

export function concreteTexture(): THREE.CanvasTexture {
  return cached('concrete', () => {
    const [c, ctx] = canvas(256, 256); const r = rng(16);
    noise(ctx, 256, 256, [140, 138, 132], 26, r);
    blotches(ctx, 256, 256, 20, 'rgba(60,60,55,A)', 40, 0.25, r);
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

export function corrugatedTexture(): THREE.CanvasTexture {
  return cached('corrugated', () => {
    const [c, ctx] = canvas(256, 256); const r = rng(17);
    for (let x = 0; x < 256; x++) { const v = 120 + Math.sin(x / 256 * Math.PI * 32) * 30; ctx.fillStyle = `rgb(${v},${v - 5},${v - 10})`; ctx.fillRect(x, 0, 1, 256); }
    blotches(ctx, 256, 256, 40, 'rgba(130,60,25,A)', 40, 0.6, r); // rust
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

export interface WindowTex { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture }
/** A facade window grid: map = glass + frames, emissive = randomly lit rooms (warm & cool). */
export function windowTexture(cols: number, rows: number, seed: number, style: 'res' | 'glass' = 'res'): WindowTex {
  const key = `win${cols}x${rows}s${seed}${style}`;
  const W = 64 * cols, H = 64 * rows; const r = rng(200 + seed);
  const [c, ctx] = canvas(W, H); const [e, ectx] = canvas(W, H);
  ctx.clearRect(0, 0, W, H); ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = i * 64, y = j * 64;
    if (style === 'glass') {
      ctx.fillStyle = `rgb(${40 + r() * 15},${58 + r() * 15},${70 + r() * 15})`; ctx.fillRect(x, y, 64, 64);
      ctx.fillStyle = 'rgba(200,210,220,0.15)'; ctx.fillRect(x, y, 64, 24);
      ctx.strokeStyle = '#555a5e'; ctx.lineWidth = 3; ctx.strokeRect(x, y, 64, 64);
    } else {
      ctx.fillStyle = '#d8d2c4'; ctx.fillRect(x + 12, y + 14, 40, 38); // frame
      ctx.fillStyle = `rgb(${30 + r() * 20},${38 + r() * 20},${44 + r() * 20})`; ctx.fillRect(x + 15, y + 17, 34, 32);
      ctx.fillStyle = 'rgba(190,200,210,0.18)'; ctx.fillRect(x + 15, y + 17, 34, 10);
      ctx.fillStyle = '#d8d2c4'; ctx.fillRect(x + 31, y + 17, 2, 32);
      if (r() < 0.35) { ctx.fillStyle = `rgba(${120 + r() * 100},${80 + r() * 60},${60 + r() * 60},0.85)`; ctx.fillRect(x + 15, y + 17, 16, 32); } // curtain
      ctx.fillStyle = 'rgba(60,60,60,0.5)'; ctx.fillRect(x + 10, y + 52, 44, 3); // sill
    }
    if (r() < 0.55) {
      const warm = r() < 0.75;
      ectx.fillStyle = warm ? `rgb(${230 + r() * 25},${170 + r() * 40},${90 + r() * 40})` : `rgb(${170 + r() * 30},${200 + r() * 30},${235})`;
      if (style === 'glass') ectx.fillRect(x + 3, y + 3, 58, 58); else ectx.fillRect(x + 15, y + 17, 34, 32);
    }
  }
  const map = cached(key + 'm', () => tex(c, 1, 1)) as THREE.CanvasTexture;
  const emissive = cached(key + 'e', () => tex(e, 1, 1)) as THREE.CanvasTexture;
  return { map, emissive };
}

export function signTexture(text: string, bg: string, fg: string, sub = '', w = 1024, h = 256, logo = false): THREE.CanvasTexture {
  return cached(`sign${text}${bg}${fg}${sub}${w}${logo}`, () => {
    const [c, ctx] = canvas(w, h); const r = rng(text.length * 7);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    blotches(ctx, w, h, 10, 'rgba(0,0,0,A)', 80, 0.15, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lw = logo && crownGold ? h * 0.95 : 0; // crown emblem on the left
    if (lw) drawCrown(ctx, 18, h * 0.1, lw, h * 0.8);
    const cx = (w + lw) / 2, avail = (w - lw) * 0.9;
    let size = sub ? h * 0.42 : h * 0.55;
    ctx.font = `800 ${size}px "Noto Sans", "DejaVu Sans", Arial, sans-serif`;
    while (ctx.measureText(text).width > avail && size > 10) { size -= 4; ctx.font = `800 ${size}px "Noto Sans", "DejaVu Sans", Arial, sans-serif`; }
    ctx.fillText(text, cx, sub ? h * 0.38 : h / 2);
    if (sub) { ctx.font = `600 ${h * 0.18}px "Noto Sans", Arial, sans-serif`; ctx.fillText(sub, cx, h * 0.76); }
    return tex(c, 1, 1);
  }) as THREE.CanvasTexture;
}

export function radialGlowTexture(): THREE.CanvasTexture {
  return cached('glow', () => {
    const [c, ctx] = canvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,220,160,1)'); g.addColorStop(0.4, 'rgba(255,200,130,0.45)'); g.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    const t = tex(c, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  }) as THREE.CanvasTexture;
}

export function dirtOverlayTexture(): THREE.CanvasTexture {
  return cached('dirt', () => {
    const [c, ctx] = canvas(256, 256); const r = rng(18);
    ctx.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const y = 256 - Math.pow(r(), 1.8) * 256; const x = r() * 256; const rad = 1 + r() * 5;
      ctx.fillStyle = `rgba(${105 + r() * 30},${70 + r() * 20},${45 + r() * 15},${0.25 + r() * 0.5})`;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    const g = ctx.createLinearGradient(0, 120, 0, 256); g.addColorStop(0, 'rgba(110,75,50,0)'); g.addColorStop(1, 'rgba(110,75,50,0.85)');
    ctx.fillStyle = g; ctx.fillRect(0, 120, 256, 136);
    const t = tex(c, 1, 1); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  }) as THREE.CanvasTexture;
}

export function nameTagTexture(name: string, admin: boolean, gang?: { tag: string; color: string; emblem: string }): THREE.CanvasTexture {
  const [c, ctx] = canvas(512, 96);
  ctx.font = '700 44px "Noto Sans", Arial, sans-serif';
  const badge = admin && crownGold ? 62 : 0; // BEST 𝕏 crown badge
  const gtag = gang ? `${gang.emblem} ${gang.tag}` : '';
  const gw = gang ? ctx.measureText(gtag).width + 22 : 0;
  const w = Math.min(500, ctx.measureText(name).width + 40 + badge + gw);
  ctx.fillStyle = admin ? 'rgba(12,10,6,0.82)' : 'rgba(0,0,0,0.55)';
  const x = (512 - w) / 2; ctx.beginPath(); ctx.roundRect(x, 14, w, 68, 18); ctx.fill();
  if (admin) { ctx.strokeStyle = 'rgba(217,180,90,0.9)'; ctx.lineWidth = 3; ctx.stroke(); }
  if (badge) drawCrown(ctx, x + 14, 24, 52, 48);
  ctx.fillStyle = admin ? '#e9c46a' : '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (gang) { ctx.fillStyle = gang.color; ctx.textAlign = 'left'; ctx.fillText(gtag, x + 18 + badge, 49); ctx.textAlign = 'center'; ctx.fillStyle = admin ? '#e9c46a' : '#ffffff'; }
  ctx.fillText(name, 256 + badge / 2 + gw / 2, 49);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
