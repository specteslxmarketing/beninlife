// Road routing for Benin City's cross-shaped layout (four arms meeting at the central roundabout).
// Used by server police responders (and mirrors scripts/autopilot.js used by the e2e drivers).
export type Pt = [number, number];
type Arm = 'E' | 'W' | 'S' | 'N';
const U: Record<Arm, Pt> = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
const ANG: Record<Arm, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };
const armOf = (x: number, z: number): Arm => (Math.abs(x) > Math.abs(z) ? (x > 0 ? 'E' : 'W') : (z > 0 ? 'S' : 'N'));
const inPt = (a: Arm, d: number): Pt => { const [ux, uz] = U[a]; return [ux * d + uz * 3.5, uz * d - ux * 3.5]; };
const outPt = (a: Arm, d: number): Pt => { const [ux, uz] = U[a]; return [ux * d - uz * 3.5, uz * d + ux * 3.5]; };
/** waypoints along the right-hand lanes from (fx,fz) to the road beside (tx,tz) */
export function roadRoute(fx: number, fz: number, tx: number, tz: number): Pt[] {
  const A = armOf(fx, fz), B = armOf(tx, tz);
  const dA = Math.max(Math.abs(fx), Math.abs(fz)), dB = Math.max(Math.abs(tx), Math.abs(tz));
  const side = (B === 'E' || B === 'W') ? Math.sign(tz) || 1 : Math.sign(tx) || 1;
  const final: Pt = (B === 'E' || B === 'W') ? [tx, side * 5.6] : [side * 5.6, tz];
  if (A === B) return [outPt(A, Math.max(Math.min(dA, dB), 20)), final];
  const pts: Pt[] = [inPt(A, Math.max(dA - 10, 31)), inPt(A, 29)];
  const a0 = ANG[A]; let a1 = ANG[B];
  while (a1 >= a0) a1 -= Math.PI * 2;
  for (let a = a0 - 0.45; a > a1 + 0.45; a -= 0.35) pts.push([Math.cos(a) * 19.5, Math.sin(a) * 19.5]);
  pts.push(outPt(B, 30), outPt(B, dB), final);
  return pts;
}
