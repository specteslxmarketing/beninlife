// Owner-review highlight screenshots (High quality): BEST 𝕏's mansion with his white GLK-style + pearl RX-style SUVs,
// BEST 𝕏 in the white suit, the city by day, at night and in heavy rain, the Rich List. Uses only free actions
// (teleport, wearing an owned outfit, choosing his own car) — nothing is bought.
import { launch, player, enter, ev, log, adminPassword } from './e2e-lib.js';
const OUT = 'screenshots/highlights';
import fs from 'node:fs'; fs.mkdirSync(OUT, { recursive: true });
const browser = await launch(); const G = 'window.__beninlife';
const A = await player(browser, 'bestx', { quality: process.env.Q ?? 'high', login: true, password: adminPassword(), ambient: true });
await enter(A.page); const p = A.page;
await ev(p, `${G}.renderPaused = false`);
const snap = async (n: string, wait = 3500) => { await p.waitForTimeout(wait); await p.screenshot({ path: `${OUT}/${n}`, timeout: 240000 }); log(`  saved ${OUT}/${n}`); };
// weather visuals ease in over several seconds of frames; software GL draws ~1 fps, so step the easing to the target
const settleWeather = () => ev(p, `(() => { const g = ${G}; for (let i = 0; i < 600; i++) g.weather.update(0.1, g.camera.position, false); })()`);
await p.addStyleTag({ content: '#help { display: none !important; }' }); // keyboard-hint bar off for photos
const cam = (c: number[]) => ev(p, `${G}.camOverride = ${JSON.stringify(c)}`);
if (await ev<boolean>(p, `${G}.inCar`)) { await p.keyboard.press('e'); await p.waitForFunction(`!${G}.inCar && !${G}.seq`, null, { timeout: 60000 }); }
// main car: the white GLK-style SUV, delivered to the mansion
const cars = await ev<{ vehicles: { id: number; model: string; color: string }[] }>(p, `new Promise(r => ${G}.socket.emit('car:list', {}, r))`);
const glk = cars.vehicles.find((v) => v.model === 'glk' && v.color === '#e9e9e4');
if (glk) await ev(p, `new Promise(r => ${G}.socket.emit('car:use', { id: ${glk.id} }, r))`);
await ev(p, `new Promise(r => ${G}.socket.emit('clothes:wear', { id: 'white_suit' }, r))`);
await ev(p, `new Promise(r => ${G}.socket.emit('admin:weather', { kind: 'sunny' }, r))`);
await ev(p, `${G}.hourOverride = 10`);
await ev(p, `new Promise(r => ${G}.socket.emit('admin:teleport', { x: 121, z: 8.6 }, r))`);
// wanted stars left over from the police e2e decay for real while he waits at home (90 s per star, no checkpoint in sight)
const w0 = await ev<number>(p, `${G}.wanted`);
if (w0 > 0) { log(`  waiting for ★${w0} to decay`); await p.waitForFunction(`${G}.wanted === 0`, null, { timeout: 600000, polling: 2000 }).catch(() => log('  (wanted did not clear in time)')); }
await settleWeather();
await p.waitForTimeout(2500);
await ev(p, `${G}.controls.camYaw = Math.PI * 0.5`);
await cam([108, 2.4, 1.5, 128, 1.4, 13]); await snap('01_mansion_white_glk_and_rx_day.png', 6000);
await cam([120.8, 1.35, 4.4, 126, 0.85, 10.2]); await snap('02_white_glk_front_quarter.png');
await cam([128.5, 1.3, 5.2, 134, 0.9, 10.2]); await snap('03_pearl_rx_front_quarter.png');
// he faces -x (camYaw π/2 → facing yaw 3π/2): shoot from the front, ambient walkers paused so nobody steps in
await ev(p, `${G}.ambient && ${G}.ambient.setEnabled(false)`);
await cam([118.2, 1.55, 7.6, 121, 1.25, 8.6]); await snap('04_bestx_white_suit_crown.png');
await ev(p, `${G}.ambient && ${G}.ambient.setEnabled(true)`);
// the city by day / night / heavy rain
await ev(p, `new Promise(r => ${G}.socket.emit('admin:teleport', { x: -6, z: 30 }, r))`); await p.waitForTimeout(2000);
await cam([14, 9, 40, -6, 3, -30]); await snap('05_city_day.png', 5000);
await ev(p, `${G}.hourOverride = 21`); await settleWeather(); await snap('06_city_night.png', 6000);
await ev(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: 121, z: 8.6 }, r))`); await p.waitForTimeout(1500);
await cam([108, 2.4, 1.5, 128, 1.4, 13]); await snap('07_mansion_night.png', 5000);
await ev(p, `${G}.hourOverride = 16`);
await ev(p, `new Promise(r => ${G}.socket.emit('admin:weather', { kind: 'heavy_rain' }, r))`);
await ev(p, `new Promise(r => ${G}.socket.emit('admin:teleport', { x: -6, z: 30 }, r))`);
await cam([14, 9, 40, -6, 3, -30]); await p.waitForTimeout(3000); await settleWeather(); await snap('08_city_heavy_rain.png', 3000);
await ev(p, `new Promise(r => ${G}.socket.emit('admin:weather', { kind: 'reset' }, r))`); // back to the natural cycle
await ev(p, `${G}.camOverride = null; ${G}.hourOverride = 10`);
// Rich List phone app (BEST 𝕏 #1)
await p.click('#btn-phone'); await p.click('#phone-home'); await p.click('#phone-screen [data-nav="rich"]');
await p.waitForSelector('.rich-row', { timeout: 15000 });
const first = await p.textContent('.rich-row');
log(`  rich list #1: ${first}`);
await snap('09_rich_list_bestx_first.png', 1500);
await browser.close();
