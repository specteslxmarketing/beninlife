// E2E: weather screenshots. BEST 𝕏 uses the admin weather override (server-synced to every player): light rain by day,
// heavy rain at night on a wet road, and a thunderstorm with lightning. Road wetness normally builds up over a minute
// or two and rain/clouds fade in over ~8 s of game time; on this software-GL box (~1–3 fps, so game time crawls) the
// script checks the client received the server's weather and then fast-forwards those transitions for the shots.
import { launch, player, enter, ev, shot, check, adminPassword, saveResults } from './e2e-lib.js';

const browser = await launch();
const setWx = (p: import('playwright').Page, kind: string) => ev<{ ok: boolean; weather?: string }>(p, `new Promise(r => window.__beninlife.socket.emit('admin:weather', { kind: '${kind}' }, r))`);
const open = async (hour: number) => {
  const A = await player(browser, 'bestx', { quality: process.env.Q ?? 'high', login: true, password: adminPassword(), query: `hour=${hour}` });
  await enter(A.page); return A;
};
const tp = async (p: import('playwright').Page, x: number, z: number, rot = 0) => { await ev(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: ${x}, z: ${z}, rot: ${rot} }, r))`); await p.waitForTimeout(1500); };
const cam = (p: import('playwright').Page, a: number[] | null) => ev(p, `window.__beninlife.camOverride = ${JSON.stringify(a)}`);

// 1) light rain, mid-morning, South road by the market
let A = await open(10); let p = A.page;
check('WEATHER: admin sets light rain (server)', (await setWx(p, 'light_rain')).weather === 'light_rain');
await tp(p, -9.4, 70); await p.waitForTimeout(4000);
check('WEATHER: client received light rain from the server', await ev<boolean>(p, "window.__beninlife.weather.kind === 'light_rain'"));
await ev(p, 'Object.assign(window.__beninlife.weather, { rain: 0.35, overcast: 0.7, wet: 0.5 })');
await cam(p, [-4, 1.8, 82, 2, 1.2, 40]); await p.waitForTimeout(3500); await shot(p, 'weather_01_light_rain_day.png');
await A.ctx.close();

// 2) heavy rain at night on the wet Ring Road
A = await open(21); p = A.page;
check('WEATHER: heavy rain', (await setWx(p, 'heavy_rain')).weather === 'heavy_rain');
await tp(p, 9.4, -60); await p.waitForTimeout(4000);
check('WEATHER: night + heavy rain on the client', await ev<boolean>(p, "window.__beninlife.env.night > 0.5 && window.__beninlife.weather.kind === 'heavy_rain'"));
await ev(p, 'Object.assign(window.__beninlife.weather, { rain: 0.85, overcast: 0.88, wet: 1 })');
await cam(p, [3, 1.6, -78, -1, 1.0, -30]); await p.waitForTimeout(4000); await shot(p, 'weather_02_heavy_rain_night_wet_road.png');
await cam(p, [-22, 9, 46, 0, 0, 10]); await p.waitForTimeout(3500); await shot(p, 'weather_03_heavy_rain_night_roundabout.png');

// 3) thunderstorm with lightning (dusk)
check('WEATHER: storm', (await setWx(p, 'storm')).weather === 'storm');
await p.waitForFunction("window.__beninlife.weather.kind === 'storm'", null, { timeout: 10000 });
await cam(p, [20, 3, 60, 0, 14, -60]); await p.waitForTimeout(3000);
let flashed = false;
for (let k = 0; k < 40 && !flashed; k++) {
  await ev(p, 'window.__beninlife.weather.nextBolt = Math.min(window.__beninlife.weather.nextBolt, 0.01)');
  flashed = await p.waitForFunction('window.__beninlife.weather.flash > 0.25', null, { timeout: 4000, polling: 16 }).then(() => true).catch(() => false);
}
if (flashed) await shot(p, 'weather_04_storm_lightning.png');
check('WEATHER: lightning strike visible (flash + bolt)', flashed);
await p.waitForTimeout(1500); await shot(p, 'weather_05_storm_after_flash.png');
await setWx(p, 'auto'); // back to the server's natural weather cycle
await cam(p, null);
saveResults('e2e_weather.txt');
await browser.close();
