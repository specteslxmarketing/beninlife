// E2E: BEST 𝕏 Car Stands in the browser. Showroom with the crown sign, pick a colour, buy the GLK-style SUV with real ₦
// (server-side), then try the RX 350-style SUV. BEST 𝕏 can't afford both after buying the bungalow, so the server must
// refuse the second sale. BEST 𝕏's garage is seeded with one GLK/RX 350/ES 350; if a second GLK is already owned
// (an earlier run bought it), it is not bought again.
import { launch, player, enter, ev, shot, check, log, adminPassword, saveResults } from './e2e-lib.js';
import { CAR_STANDS, DISPLAY_SLOTS, carModel } from '../shared/constants.js';

const browser = await launch();
const A = await player(browser, 'bestx', { quality: process.env.Q ?? 'high', login: true, password: adminPassword(), ambient: false });
await enter(A.page);
const p = A.page;
const tp = async (x: number, z: number) => { const r = await ev<{ ok: boolean }>(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: ${x}, z: ${z} }, r))`); await p.waitForTimeout(1500); return r.ok; };
const cam = (a: number[] | null) => ev(p, `window.__beninlife.camOverride = ${JSON.stringify(a)}`);
const balance = () => ev<number>(p, 'window.__beninlife.balance');
const list = () => ev<{ vehicles: { id: number; model: string; color: string }[] }>(p, `new Promise(r => window.__beninlife.socket.emit('car:list', {}, r))`);
const S = CAR_STANDS;

check('CARSTANDS: at the showroom entrance', await tp(S.x - S.w / 2 - 3, S.z));
await cam([S.x - S.w / 2 - 12, 4.5, S.z - 9, S.x + 4, 2.5, S.z + 1]); await p.waitForTimeout(3500); await shot(p, 'carstands_01_showroom_crown_sign.png');
await cam([S.office.x - 7, 3.2, S.office.z - 3, S.office.x, 4.2, S.office.z]); await p.waitForTimeout(3000); await shot(p, 'carstands_02_office_crown_sign.png');
await cam(null);

const standAt = async (id: string) => { const s = DISPLAY_SLOTS.find((d) => d.model === id)!; await tp(s.x, s.z + (s.z < 90 ? 3.0 : -3.0)); return s; };
// GLK-style
const glk = carModel('glk'), owned = (await list()).vehicles.filter((v) => v.model === 'glk').length;
const sg = await standAt('glk');
const acts = await ev<string[]>(p, 'window.__beninlife.contextActions().map(a => a.label)');
check('CARSTANDS: GLK-style SUV offered with its price', acts.some((l) => l.includes(glk.name)), acts.join(' | '));
await ev(p, `window.__beninlife.doContextAction('car:color')`); await p.waitForTimeout(800); // colour 2 (white)
const nose = (sl: { rot: number }) => (sl.rot === 0 ? 1 : -1);
await cam([sg.x + 2.7, 1.45, sg.z + nose(sg) * 4.1, sg.x, 0.75, sg.z]); await p.waitForTimeout(3000); await shot(p, 'carstands_03_glk_on_display.png');
await cam(null);
if (owned < 2) {
  const before = await balance();
  await ev(p, `window.__beninlife.doContextAction('car:buy')`); await p.waitForTimeout(2500);
  const after = await balance();
  check(`CARSTANDS: bought the ${glk.name} — server debited ₦${glk.price.toLocaleString()}`, before - after === glk.price, `${before} → ${after}`);
  check('CARSTANDS: GLK is in My Cars (server list)', (await list()).vehicles.some((v) => v.model === 'glk' && v.color === glk.colors[1]));
  await shot(p, 'carstands_04_glk_bought_toast.png');
} else log(`  bestx already bought a GLK in an earlier run (${owned} owned) — not buying another`);
// RX 350-style
const rx = carModel('rx350'), sr = await standAt('rx350');
await cam([sr.x - 2.7, 1.45, sr.z + nose(sr) * 4.1, sr.x, 0.75, sr.z]); await p.waitForTimeout(3000); await shot(p, 'carstands_05_rx350_front.png');
await cam([sr.x + 2.4, 1.5, sr.z - nose(sr) * 4.4, sr.x, 0.8, sr.z]); await p.waitForTimeout(3000); await shot(p, 'carstands_05b_rx350_rear.png');
await cam(null);
const bal = await balance();
log(`  at ${JSON.stringify(await ev(p, '[window.__beninlife.pos.x, window.__beninlife.pos.y]'))}, RX slot ${sr.x},${sr.z}`);
const buyRx = () => ev<{ ok: boolean; error?: string }>(p, `new Promise(r => window.__beninlife.socket.emit('car:buy', { model: 'rx350', color: '${rx.colors[0]}' }, r))`);
let r = await buyRx();
if (!r.ok && r.error?.startsWith('Walk up')) { await p.waitForTimeout(2000); r = await buyRx(); } // server position catches up after the teleport
if (bal >= rx.price) check('CARSTANDS: bought the RX 350-style SUV', r.ok && bal - (await balance()) === rx.price);
else check(`CARSTANDS: server refuses the RX 350-style (₦${rx.price.toLocaleString()}) with only ₦${bal.toLocaleString()}`, !r.ok && (await balance()) === bal, r.error);
// My Cars phone app
await p.click('#btn-phone'); await p.waitForTimeout(800); await p.click('[data-nav="cars"]'); await p.waitForTimeout(2500);
check('CARSTANDS: My Cars app lists the GLK-style', await ev<boolean>(p, `document.querySelector('#phone-screen').textContent.includes('${glk.name}')`));
await shot(p, 'carstands_06_my_cars_app.png');
saveResults('e2e_carstands.txt');
await browser.close();
