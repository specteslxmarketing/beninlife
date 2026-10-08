// E2E: police — speed past the East road checkpoint (server clocks you → wanted), officers react (wave, light bar, siren),
// get arrested next to an officer (server fine + taken to the station), then commit again and hand yourself in.
// BEST 𝕏 admin teleport is used only to position quickly; all police rules are the same for everyone.
import { launch, player, enter, ev, shot, check, log, adminPassword, saveResults } from './e2e-lib.js';
import { POLICE_CHECKPOINTS, POLICE_OFFICERS, POLICE_STATION, FINE_PER_STAR, SURRENDER_PER_STAR } from '../shared/constants.js';
import type { Page } from 'playwright';

const browser = await launch();
const A = await player(browser, 'bestx', { ambient: false, quality: process.env.Q ?? 'medium', login: true, password: adminPassword() });
await enter(A.page);
const p = A.page;
const tp = async (x: number, z: number) => { const r = await ev<{ ok: boolean }>(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: ${x}, z: ${z} }, r))`); await p.waitForTimeout(1500); return r.ok; };
const balance = () => ev<number>(p, 'window.__beninlife.balance');
const wanted = () => ev<number>(p, 'window.__beninlife.wanted');
const waitFor = async (js: string, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev<boolean>(p, js)) return true; await p.waitForTimeout(300); } return false; };
const cp = POLICE_CHECKPOINTS[0];
const drive = async (pg: Page, pts: number[][], v: number) => (await ev<{ ok: boolean }>(pg, `window.__auto.drive(${JSON.stringify(pts)}, ${v}, 300000)`)).ok;

// overview of the checkpoint (calm)
await ev(p, `window.__beninlife.camOverride = [${cp.x - 14}, 4.2, ${cp.z + 12}, ${cp.x + 2}, 1.2, ${cp.z - 2}]`);
await p.waitForTimeout(3000); await shot(p, 'police_01_checkpoint_calm.png');
await ev(p, 'window.__beninlife.camOverride = null');
check('POLICE: start not wanted', (await wanted()) === 0, String(await wanted()));

// get in the car and put it on the East road, east of the checkpoint, heading west
const car = await ev<{ x: number; z: number }>(p, '({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })');
await tp(car.x - 2.5, car.z); await p.keyboard.press('e'); await p.waitForTimeout(1500);
check('POLICE: in the car', await ev<boolean>(p, 'window.__beninlife.inCar'));
const rt = await ev<number[][]>(p, `window.__auto.route(window.__beninlife.carState.x, window.__beninlife.carState.z, 175, 3.5)`);
log('  to start line: ' + await drive(p, rt, 12));
log('  speeding run: ' + await drive(p, [[165, 3.5], [60, 3.5], [40, 3.5]], 26));
const w1 = await waitFor('window.__beninlife.wanted > 0', 15000);
check('POLICE: speeding past the checkpoint → server sets wanted', w1, `wanted=${await wanted()}`);
// officers react: view the checkpoint again from the road
await ev(p, `window.__beninlife.camOverride = [${cp.x - 12}, 3.4, ${cp.z + 10}, ${cp.x + 2}, 1.4, ${cp.z - 2}]`);
await p.waitForTimeout(3500); await shot(p, 'police_02_officers_react_lights.png');
await ev(p, 'window.__beninlife.camOverride = null');
await shot(p, 'police_03_wanted_hud.png');

// arrest: stop and walk up to an officer
await p.keyboard.down('Space'); await p.waitForTimeout(2500); await p.keyboard.up('Space');
await p.keyboard.press('e'); await p.waitForTimeout(1200);
const stars = await wanted(); const before = await balance();
const o = POLICE_OFFICERS[0];
await tp(o.x - 2, o.z + 1.5);
const arrested = await waitFor('window.__beninlife.wanted === 0', 10000);
await p.waitForTimeout(1500);
const after = await balance();
check('POLICE: arrested next to the officer — wanted cleared', arrested);
check(`POLICE: server fine ${FINE_PER_STAR}/star taken`, before - after === Math.min(before, FINE_PER_STAR * stars), `${stars}★ ${before} → ${after}`);
const pos = await ev<{ x: number; z: number }>(p, '({ x: window.__beninlife.pos.x, z: window.__beninlife.pos.y })');
check('POLICE: taken to the police station', Math.hypot(pos.x - POLICE_STATION.release.x, pos.z - POLICE_STATION.release.z) < 3, JSON.stringify(pos));
await shot(p, 'police_04_arrested_at_station.png');

// hand yourself in: commit again, then walk into the station
const car2 = await ev<{ x: number; z: number }>(p, '({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })');
await tp(car2.x - 2.5, car2.z); await p.keyboard.press('e'); await p.waitForTimeout(1500);
const rt2 = await ev<number[][]>(p, `window.__auto.route(window.__beninlife.carState.x, window.__beninlife.carState.z, 20, 4)`);
log('  back to west of checkpoint: ' + await drive(p, rt2, 12));
log('  speeding run east: ' + await drive(p, [[30, 4], [150, 4], [170, 4]], 26));
check('POLICE: wanted again', await waitFor('window.__beninlife.wanted > 0', 15000));
await p.keyboard.down('Space'); await p.waitForTimeout(2500); await p.keyboard.up('Space'); await p.keyboard.press('e'); await p.waitForTimeout(1200);
const s2 = await wanted(); const b2 = await balance();
await tp(POLICE_STATION.door.x, POLICE_STATION.door.z + 0.8);
const acts = await ev<string[]>(p, 'window.__beninlife.contextActions().map(a => a.id)');
check('POLICE: "Hand yourself in" offered at the station', acts.includes('police:surrender'), acts.join(','));
await shot(p, 'police_05_hand_yourself_in.png');
await p.keyboard.press('f'); await p.waitForTimeout(2000);
check(`POLICE: handed in — ${SURRENDER_PER_STAR}/star fine, wanted cleared`, (await wanted()) === 0 && b2 - (await balance()) === Math.min(b2, SURRENDER_PER_STAR * s2), `${s2}★`);
saveResults('e2e_police.txt');
await browser.close();
