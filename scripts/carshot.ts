// Look-dev: frame display cars at BEST 𝕏 Car Stands. Usage: tsx scripts/carshot.ts glk,rx350,corolla [hour]
import { launch, player, enter, ev, adminPassword } from './e2e-lib.js';
import { DISPLAY_SLOTS } from '../shared/constants.js';
const ids = (process.argv[2] ?? 'glk,rx350,corolla,hilux').split(',');
const browser = await launch();
const A = await player(browser, 'bestx', { quality: process.env.Q ?? 'high', login: true, password: adminPassword(), query: `hour=${process.argv[3] ?? '10'}`, ambient: false });
await enter(A.page);
const p = A.page;
await ev(p, 'window.__beninlife.renderPaused = false'); // e2e-lib pauses drawing by default
await ev(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: 12, z: 91 }, r))`);
await ev(p, `window.__beninlife.player.group.visible = false`).catch(() => {});
let n = 0;
if (process.env.DOORS) await ev(p, `(() => { for (const c of window.__beninlife.world.displayCars.values()) { for (let i = 0; i < c.doorCount; i++) c.setDoor(i, true); for (let k = 0; k < 30; k++) c.updateWheels(0, 0, 0.05); } })()`);
for (const id of ids) {
  if (id.startsWith('@')) { // @x/y/z/lx/ly/lz raw camera
    await ev(p, `window.__beninlife.camOverride = [${id.slice(1).split('/').join(',')}]`); await p.waitForTimeout(3000); await p.screenshot({ path: `screenshots/_dev_car${n++}.png` }); continue;
  }
  const [m, view] = id.split(':'); const s = DISPLAY_SLOTS.find((d) => d.model === m)!;
  const f = s.rot === 0 ? 1 : -1; // nose direction (+z for rot 0)
  const cams: Record<string, number[]> = { q: [s.x + 2.7, 1.45, s.z + f * 4.1, s.x, 0.75, s.z], r: [s.x - 2.3, 1.45, s.z - f * 5.6, s.x, 0.85, s.z], s: [s.x + 1.7, 1.0, s.z + f * 0.4, s.x - 3, 0.8, s.z], c: [s.x + 1.2, 1.0, s.z + f * 3.6, s.x, 0.75, s.z + f * 1.8] };
  await ev(p, `window.__beninlife.camOverride = ${JSON.stringify(cams[view ?? 'q'])}`);
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `screenshots/_dev_car${n++}.png` });
}
await browser.close();
