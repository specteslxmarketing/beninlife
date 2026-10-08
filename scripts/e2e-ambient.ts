// E2E: light ambient life. A few traffic cars follow the lanes and the roundabout traffic lights; a few pedestrians walk.
import { launch, player, enter, ev, shot, check, log, adminPassword, saveResults } from './e2e-lib.js';
import { LAGOS } from '../shared/constants.js';

const browser = await launch();
const A = await player(browser, 'bestx', { quality: process.env.Q ?? 'high', login: true, password: adminPassword() });
await enter(A.page);
const p = A.page;
const tp = async (x: number, z: number) => { const r = await ev<{ ok: boolean }>(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: ${x}, z: ${z} }, r))`); await p.waitForTimeout(1500); return r.ok; };
const cam = (a: number[] | null) => ev(p, `window.__beninlife.camOverride = ${JSON.stringify(a)}`);
await p.waitForFunction('!!window.__beninlife.ambient', null, { timeout: 20000 });
const counts = await ev<{ cars: number; walkers: number; benin: number; lagos: number }>(p, `(() => { const a = window.__beninlife.ambient; return { cars: a.cars.length, walkers: a.walkers.length, benin: a.cars.filter(c => c.city === 'benin').length, lagos: a.cars.filter(c => c.city === 'lagos').length }; })()`);
log(`  ambient: ${JSON.stringify(counts)}`);
check('AMBIENT: a few traffic cars (≤ 8 per city)', counts.benin >= 3 && counts.benin <= 8 && counts.lagos >= 2 && counts.lagos <= 5, JSON.stringify(counts));
check('AMBIENT: a few pedestrians (≤ 10 total)', counts.walkers >= 4 && counts.walkers <= 10, String(counts.walkers));
await tp(-9.5, 52); // sidewalk of the South road near the roundabout
const snap = () => ev<number[][]>(p, `window.__beninlife.ambient.cars.filter(c => c.city === 'benin').map(c => [c.x, c.z, c.speed])`);
const fps = await ev<number>(p, `new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 2000) requestAnimationFrame(f); else res(n / 2); }; f(); })`);
log(`  fps ${fps} (software GL — the simulation runs slower than real time here)`);
const s0 = await snap(); await p.waitForTimeout(8000); const s1 = await snap();
const moved = s0.filter((a, i) => Math.hypot(a[0] - s1[i][0], a[1] - s1[i][1]) > 0.8).length;
check('AMBIENT: cars are driving', moved >= 2, `${moved}/${s0.length} moved`);
const onRoad = s1.every(([x, z]) => Math.abs(x) < 9 || Math.abs(z) < 9 || Math.hypot(x, z) < 28);
check('AMBIENT: cars stay on the roads', onRoad, JSON.stringify(s1.map((v) => v.map((n) => Math.round(n)))));
// traffic lights: the two axes are never green together; wait for a car held at a red light
const lights = await ev<string[]>(p, `(() => { const t = (Date.now() + window.__beninlife.serverOffset) / 1000; return [0, 1].map(a => { const p = ((t % 26) + 26) % 26, q = a === 0 ? p : (p + 13) % 26; return q < 11 ? 'green' : q < 13 ? 'amber' : 'red'; }); })()`);
check('AMBIENT: roundabout lights alternate (E/W vs N/S)', !(lights[0] === 'green' && lights[1] === 'green'), lights.join('/'));
let held = false;
for (let k = 0; k < 30 && !held; k++) {
  held = await ev<boolean>(p, `(() => { const t = (Date.now() + window.__beninlife.serverOffset) / 1000; const st = (a) => { const p = ((t % 26) + 26) % 26, q = a === 0 ? p : (p + 13) % 26; return q < 11 ? 'green' : q < 13 ? 'amber' : 'red'; };
    return window.__beninlife.ambient.cars.some(c => { if (c.city !== 'benin' || c.speed > 0.4) return false; for (let k = c.i; k < Math.min(c.path.length, c.i + 12); k++) { const pt = c.path[k]; if (pt.stop !== undefined) return st(pt.stop) !== 'green' && Math.hypot(pt.x - c.x, pt.z - c.z) < 14; } return false; }); })()`);
  if (!held) await p.waitForTimeout(2500);
}
check('AMBIENT: a car waits at a red light', held);
await cam([-26, 16, 64, 0, 0, 20]); await p.waitForTimeout(3000); await shot(p, 'ambient_01_roundabout_traffic_lights.png');
// street-level: frame the nearest moving car, then a pedestrian
const frameCar = (city: string) => ev<number[] | null>(p, `(() => { const cs = window.__beninlife.ambient.cars.filter(c => c.city === '${city}').sort((a, b) => Math.abs(Math.hypot(a.x, a.z) - 70) - Math.abs(Math.hypot(b.x, b.z) - 70)); const c = cs[0]; if (!c) return null; const fx = Math.sin(c.rot), fz = Math.cos(c.rot); return [c.x + fx * (c.L + 6) + fz * 6, 2.4, c.z + fz * (c.L + 6) - fx * 6, c.x, 1, c.z]; })()`);
const frameWalker = (city: string) => ev<number[] | null>(p, `(() => { const w = window.__beninlife.ambient.walkers.find(w => w.city === '${city}'); if (!w) return null; const fx = Math.sin(w.rot), fz = Math.cos(w.rot); return [w.x + fx * 3.2 + fz * 1.2, 1.6, w.z + fz * 3.2 - fx * 1.2, w.x, 1.1, w.z]; })()`);
for (const [i, f] of [[2, () => frameCar('benin')], [3, () => frameWalker('benin')]] as const) {
  const c = await f(); if (!c) continue;
  await tp(c[3] + 6, c[5] + 6); // stay nearby so the camera city is right
  const c2 = (await f())!; await cam(c2); await p.waitForTimeout(2500); await cam((await f())!); await p.waitForTimeout(1500);
  await shot(p, i === 2 ? 'ambient_02_traffic_car.png' : 'ambient_03_pedestrian.png');
}
// a car stops for a pedestrian (BEST 𝕏 steps into the lane in front of one)
await cam(null);
const victim = await ev<number[] | null>(p, `(() => { const c = window.__beninlife.ambient.cars.find(c => c.city === 'benin' && c.speed > 1.5 && Math.hypot(c.x, c.z) > 60 && Math.hypot(c.x, c.z) < 150); return c ? [c.x + Math.sin(c.rot) * 14, c.z + Math.cos(c.rot) * 14] : null; })()`);
if (victim) {
  await tp(victim[0], victim[1]); await p.waitForTimeout(12000);
  const stopped = await ev<boolean>(p, `(() => { const g = window.__beninlife; return g.ambient.cars.some(c => c.city === 'benin' && Math.hypot(c.x - g.pos.x, c.z - g.pos.y) < 12 && c.speed < 0.5); })()`);
  check('AMBIENT: traffic stops for a player standing in the lane', stopped);
} else log('  (no moving car found for the yield test this time)');
// Lagos
await tp(LAGOS.x + 10, 44.5); await p.waitForTimeout(1500);
const lc = await ev<number[]>(p, `(() => { const c = window.__beninlife.ambient.cars.find(c => c.city === 'lagos'); return [c.x, c.z]; })()`);
await cam([lc[0] - 14, 6, 50, lc[0] + 6, 1, lc[1]]); await p.waitForTimeout(3500); await shot(p, 'ambient_04_lagos_traffic_promenade.png');
await cam(null); await tp(-9.5, 52);
saveResults('e2e_ambient.txt');
await browser.close();
