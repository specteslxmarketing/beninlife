// Look-dev for opening doors: put the own car on an open road, switch models client-side, open doors, frame it.
import { launch, player, enter, ev, adminPassword } from './e2e-lib.js';
const models = (process.argv[2] ?? 'glk,corolla,sienna,hilux').split(',');
const browser = await launch();
const A = await player(browser, 'bestx', { quality: process.env.Q ?? 'medium', login: true, password: adminPassword(), ambient: false });
await enter(A.page); const p = A.page;
const X = 0, Z = 30;
await ev(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: ${X + 6}, z: ${Z} }, r))`);
let n = 0;
for (const m of models) {
  await ev(p, `(() => { const g = window.__beninlife; g.setVehicle('${m}', '#7a1b1b'); g.carState.x = ${X}; g.carState.z = ${Z}; g.carState.rot = 0; g.player.group.visible = false;
    for (let i = 0; i < g.car.doorCount; i++) g.car.setDoor(i, true); })()`);
  for (const cam of [[X + 4.2, 1.7, Z + 3.2, X, 0.8, Z - 0.2], [X - 3.6, 1.5, Z - 3.8, X, 0.8, Z]]) {
    await ev(p, `window.__beninlife.camOverride = ${JSON.stringify(cam)}`); await p.waitForTimeout(3500);
    await p.screenshot({ path: `screenshots/_dev_door${n++}.png` });
  }
}
await browser.close();
