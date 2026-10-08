// Intercity travel cutscene: a 2D canvas animation shown while the server moves the player between cities.
// Bus: coach on the Benin–Lagos expressway (parallax bush, palms, towns). Flight: Ivie Air jet above the clouds.
import type { City, TravelMode } from '../../shared/constants';

const STOPS: Record<TravelMode, string[]> = { bus: ['Benin City', 'Okada', 'Ore', 'Ijebu-Ode', 'Lagos'], flight: ['Benin Airport', 'cruising 24,000 ft', 'Lagos Domestic'] };

export function playTravelCutscene(mode: TravelMode, to: City, ms: number): Promise<void> {
  const root = document.createElement('div'); root.id = 'travel-fx';
  const cv = document.createElement('canvas'); root.appendChild(cv);
  const cap = document.createElement('div'); cap.className = 'tv-cap'; root.appendChild(cap);
  document.body.appendChild(root);
  const ctx = cv.getContext('2d')!;
  const from = to === 'lagos' ? 'Benin City' : 'Lagos', dest = to === 'lagos' ? 'Lagos' : 'Benin City';
  const stops = to === 'lagos' ? STOPS[mode] : [...STOPS[mode]].reverse();
  const t0 = performance.now();
  const rnd = (i: number) => { const x = Math.sin(i * 127.1) * 43758.5; return x - Math.floor(x); };
  return new Promise((resolve) => {
    const frame = () => {
      const W = cv.width = root.clientWidth, H = cv.height = root.clientHeight;
      const el = performance.now() - t0, k = Math.min(1, el / ms), t = el / 1000;
      if (mode === 'bus') drawBus(ctx, W, H, t, k, rnd); else drawFlight(ctx, W, H, t, k, rnd);
      // route progress
      const y = H - 46, x0 = W * 0.12, x1 = W * 0.88;
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.strokeStyle = '#d9b45a'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + (x1 - x0) * k, y); ctx.stroke();
      ctx.font = `${Math.max(10, W / 90)}px sans-serif`; ctx.textAlign = 'center';
      stops.forEach((s, i) => { const sx = x0 + (x1 - x0) * (i / (stops.length - 1)); ctx.fillStyle = k >= i / (stops.length - 1) ? '#d9b45a' : '#bbb'; ctx.beginPath(); ctx.arc(sx, y, 5, 0, 7); ctx.fill(); ctx.fillText(s, sx, y + 20); });
      const hours = mode === 'bus' ? 5 : 0.75, left = (1 - k) * hours;
      cap.innerHTML = `<b>${mode === 'bus' ? '🚌 Edo Line Motors' : '✈ Ivie Air IV 215'}</b> · ${from} → ${dest}<br><small>${k < 1 ? `${left >= 1 ? Math.ceil(left) + ' h' : Math.ceil(left * 60) + ' min'} remaining (journey shortened)` : 'Arriving…'}</small>`;
      root.style.opacity = String(Math.min(1, el / 400, (ms - el) / 500 + 0.0001));
      if (el < ms) requestAnimationFrame(frame); else { root.remove(); resolve(); }
    };
    requestAnimationFrame(frame);
  });
}

function drawBus(c: CanvasRenderingContext2D, W: number, H: number, t: number, k: number, rnd: (i: number) => number): void {
  // sky moves from late afternoon to dusk over the journey
  const g = c.createLinearGradient(0, 0, 0, H * 0.6);
  g.addColorStop(0, `hsl(${205 - k * 175}, ${55 + k * 10}%, ${62 - k * 22}%)`); g.addColorStop(1, `hsl(${35 - k * 10}, 75%, ${78 - k * 18}%)`);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = `rgba(255,220,150,${0.8 - k * 0.3})`; c.beginPath(); c.arc(W * 0.78, H * (0.2 + k * 0.25), H * 0.06, 0, 7); c.fill();
  const hz = H * 0.58;
  // far hills, bush line, palms (parallax)
  c.fillStyle = '#5f7a52'; c.beginPath(); c.moveTo(0, hz);
  for (let x = 0; x <= W; x += 20) c.lineTo(x, hz - 30 - Math.sin((x + t * 15) * 0.008) * 18 - Math.sin((x + t * 15) * 0.021) * 8); c.lineTo(W, hz); c.fill();
  c.fillStyle = '#3f5e34'; c.beginPath(); c.moveTo(0, hz + 6);
  for (let x = 0; x <= W; x += 10) c.lineTo(x, hz - 8 - Math.abs(Math.sin((x + t * 60) * 0.05)) * 14); c.lineTo(W, hz + 6); c.fill();
  const span = W + 200;
  for (let i = 0; i < 9; i++) {
    const x = ((rnd(i) * span - t * 220) % span + span) % span - 100, h = H * (0.16 + rnd(i + 9) * 0.08);
    c.strokeStyle = '#5b4632'; c.lineWidth = 5; c.beginPath(); c.moveTo(x, hz + 20); c.quadraticCurveTo(x + 8, hz + 20 - h / 2, x + 4, hz + 20 - h); c.stroke();
    c.fillStyle = '#2f5a2a'; for (let f = 0; f < 6; f++) { const a = f / 6 * Math.PI * 2; c.beginPath(); c.ellipse(x + 4 + Math.cos(a) * 18, hz + 20 - h + Math.sin(a) * 6, 22, 5, a, 0, 7); c.fill(); }
  }
  // road
  c.fillStyle = '#7d6a4f'; c.fillRect(0, hz + 6, W, 18); c.fillStyle = '#3a3a3c'; c.fillRect(0, hz + 22, W, H * 0.22);
  c.fillStyle = '#e8e2c8'; for (let x = -((t * 600) % 120); x < W; x += 120) c.fillRect(x, hz + 22 + H * 0.11, 60, 4);
  c.fillStyle = '#6a5a42'; c.fillRect(0, hz + 22 + H * 0.22, W, H);
  // the coach (with a little bounce)
  const bw = Math.min(W * 0.42, 520), bh = bw * 0.3, bx = W * 0.3, by = hz + 22 + H * 0.1 - bh + Math.sin(t * 9) * 1.5;
  c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(bx + bw / 2, by + bh + 6, bw * 0.52, 8, 0, 0, 7); c.fill();
  c.fillStyle = '#f2f0ea'; roundRect(c, bx, by, bw, bh, bh * 0.18); c.fill();
  c.fillStyle = '#7a1022'; c.fillRect(bx, by + bh * 0.62, bw, bh * 0.12);
  c.fillStyle = '#26323a'; for (let i = 0; i < 7; i++) { roundRect(c, bx + bw * 0.04 + i * bw * 0.125, by + bh * 0.14, bw * 0.11, bh * 0.36, 4); c.fill(); }
  c.fillStyle = '#1b2228'; roundRect(c, bx + bw * 0.9, by + bh * 0.1, bw * 0.09, bh * 0.5, 6); c.fill();
  c.fillStyle = '#7a1022'; c.font = `bold ${bh * 0.13}px sans-serif`; c.textAlign = 'left'; c.fillText('EDO LINE MOTORS', bx + bw * 0.05, by + bh * 0.88);
  for (const wx of [0.18, 0.78]) { const cx = bx + bw * wx, cy = by + bh; c.fillStyle = '#111'; c.beginPath(); c.arc(cx, cy, bh * 0.17, 0, 7); c.fill(); c.strokeStyle = '#aaa'; c.lineWidth = 2; for (let s = 0; s < 5; s++) { const a = t * 18 + s * 1.256; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * bh * 0.1, cy + Math.sin(a) * bh * 0.1); c.stroke(); } }
  if (k > 0.55) { c.fillStyle = `rgba(255,230,160,${Math.min(1, (k - 0.55) * 4)})`; c.beginPath(); c.arc(bx + bw, by + bh * 0.72, 5, 0, 7); c.fill(); }
}

function drawFlight(c: CanvasRenderingContext2D, W: number, H: number, t: number, k: number, rnd: (i: number) => number): void {
  const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a5d9a'); g.addColorStop(0.6, '#8fbde0'); g.addColorStop(1, '#e8f2f8');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const cloud = (x: number, y: number, s: number, a: number) => { c.fillStyle = `rgba(255,255,255,${a})`; for (let i = 0; i < 5; i++) { c.beginPath(); c.ellipse(x + i * s * 0.5, y - Math.sin(i * 1.3) * s * 0.18, s * 0.45, s * 0.25, 0, 0, 7); c.fill(); } };
  const span = W + 600;
  for (let i = 0; i < 10; i++) cloud(((rnd(i) * span - t * 40) % span + span) % span - 300, H * (0.55 + rnd(i + 3) * 0.35), 120 + rnd(i + 7) * 80, 0.75);
  // jet (climb, cruise, descend)
  const pw = Math.min(W * 0.5, 600), px = W * 0.25, py = H * (0.42 - Math.sin(Math.min(1, k) * Math.PI) * 0.1) + Math.sin(t * 1.4) * 3;
  const pitch = Math.cos(k * Math.PI) * 0.06;
  c.save(); c.translate(px + pw / 2, py); c.rotate(-pitch); c.translate(-pw / 2, 0);
  c.fillStyle = '#c9ced3'; c.beginPath(); c.moveTo(pw * 0.42, 0); c.lineTo(pw * 0.6, -pw * 0.03); c.lineTo(pw * 0.32, pw * 0.16); c.lineTo(pw * 0.26, pw * 0.16); c.closePath(); c.fill(); // wing
  c.fillStyle = '#f4f5f6'; roundRect(c, 0, -pw * 0.05, pw, pw * 0.1, pw * 0.05); c.fill();
  c.fillStyle = '#7a1022'; c.beginPath(); c.moveTo(pw * 0.02, -pw * 0.03); c.lineTo(pw * 0.1, -pw * 0.2); c.lineTo(pw * 0.2, -pw * 0.2); c.lineTo(pw * 0.2, -pw * 0.04); c.fill(); // tail
  c.fillStyle = '#d9b45a'; c.fillRect(pw * 0.05, pw * 0.02, pw * 0.9, pw * 0.012);
  c.fillStyle = '#26323a'; for (let i = 0; i < 18; i++) c.fillRect(pw * 0.25 + i * pw * 0.035, -pw * 0.02, pw * 0.015, pw * 0.018);
  c.fillStyle = '#7a1022'; c.font = `bold ${pw * 0.045}px sans-serif`; c.textAlign = 'left'; c.fillText('IVIE AIR', pw * 0.3, pw * 0.045);
  c.fillStyle = '#9aa1a8'; roundRect(c, pw * 0.34, pw * 0.07, pw * 0.12, pw * 0.05, pw * 0.025); c.fill(); // engine
  c.restore();
  for (let i = 0; i < 6; i++) cloud(((rnd(i + 40) * span - t * 160) % span + span) % span - 300, H * (0.75 + rnd(i + 44) * 0.2), 200, 0.9);
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
