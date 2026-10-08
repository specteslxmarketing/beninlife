// End-to-end visual run with headless Chrome (SwiftShader WebGL) against the running server.
// Two real players sign up, play, see each other, drive, wash the car, do a delivery and DM each other.
import fs from 'node:fs';
import { chromium, type Page, type BrowserContext } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:3000';
const OUT = 'screenshots';
fs.mkdirSync(OUT, { recursive: true });
const autopilot = fs.readFileSync('scripts/autopilot.js', 'utf8');
const tag = Math.random().toString(36).slice(2, 6);
const results: string[] = [];
const log = (s: string) => { console.log(s); results.push(s); };

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function newPlayer(quality: string, viewport: { width: number; height: number }, mobile = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' : undefined });
  await ctx.addInitScript(`localStorage.setItem('bl_quality', '${quality}');`);
  await ctx.addInitScript(autopilot);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return { ctx, page };
}
const ev = <T = unknown>(p: Page, js: string) => p.evaluate(js) as Promise<T>;
const shot = async (p: Page, name: string) => { await p.screenshot({ path: `${OUT}/${name}` }); log(`saved ${OUT}/${name}`); };
const ready = (p: Page) => p.waitForFunction('!!window.__beninlife', null, { timeout: 240000 });
const hudBalance = (p: Page) => p.textContent('#hud-balance');

// ---------- Player 1: sign up through the real UI ----------
const p1 = await newPlayer('high', { width: 1280, height: 720 });
const P1 = `Ada_${tag}`;
await p1.page.goto(`${base}/?capture=1&hour=9.5`);
await p1.page.click('#tab-signup');
await p1.page.fill('#au-user', P1);
await p1.page.fill('#au-pass', 'ada-password-1');
await p1.page.click('#au-submit');
const ageErr = await p1.page.textContent('#au-err');
log(`18+ checkbox enforced in UI: ${/18/.test(ageErr ?? '') ? 'PASS' : 'FAIL'}`);
await p1.page.check('#au-age');
await p1.page.click('#au-submit');
await ready(p1.page);
await p1.page.waitForSelector('#creator:not(.hidden)');
await p1.page.click('#cr-body button[data-b="female"]');
await p1.page.click('#cr-skin button[data-i="1"]');
await p1.page.click('#cr-outfit button[data-i="0"]');
await p1.page.waitForTimeout(2500);
await shot(p1.page, '00_character_creator.png');
await p1.page.click('#cr-save');
await p1.page.waitForSelector('#intro:not(.hidden)');
await p1.page.waitForTimeout(5000);
await shot(p1.page, '01_intro_plane_landing.png');
await p1.page.waitForTimeout(6000);
await shot(p1.page, '01b_intro_dialogue.png');
await p1.page.click('#intro-skip');
await p1.page.waitForSelector('#hud:not(.hidden)');

// ---------- Player 2 (API signup, low quality to save CPU) ----------
const p2 = await newPlayer('low', { width: 800, height: 450 });
const P2 = `Osaze_${tag}`;
await p2.ctx.request.post(`${base}/api/register`, { data: { username: P2, password: 'osaze-password-1', ageConfirmed: true } });
await p2.page.goto(`${base}/?capture=1&hour=9.5`);
await ready(p2.page);
await p2.page.waitForSelector('#creator:not(.hidden)');
await p2.page.click('#cr-skin button[data-i="4"]');
await p2.page.click('#cr-outfit button[data-i="3"]');
await p2.page.click('#cr-save');
await p2.page.waitForSelector('#intro-skip');
await p2.page.click('#intro-skip');
await p2.page.waitForSelector('#hud:not(.hidden)');
// P2 walks a few metres north along the sidewalk so P1 can see them
await ev(p2.page, `window.__auto.walkTo(-41, 9.2, 0.8)`);
await ev(p1.page, `window.__beninlife.controls.camYaw = -2.1; window.__beninlife.controls.camPitch = 0.22`);
await p1.page.waitForTimeout(4000);
const seesP2 = await ev<boolean>(p1.page, `[...window.__beninlife.remotes.values()].some(r => r.snap.name === '${P2}')`);
log(`P1 sees P2 in world: ${seesP2 ? 'PASS' : 'FAIL'}`);
await shot(p1.page, '05_two_players_visible.png');
await ev(p2.page, `window.__beninlife.controls.camYaw = 1.0`);
await p2.page.waitForTimeout(3000);
await shot(p2.page, '05b_two_players_from_player2.png');

// ---------- Daytime street view ----------
await ev(p1.page, `window.__beninlife.controls.camYaw = 1.25; window.__beninlife.controls.camPitch = 0.18`);
await p1.page.waitForTimeout(3000);
await shot(p1.page, '02_day_street_view.png');

// ---------- Enter car and drive to the car wash ----------
const car = await ev<{ x: number; z: number }>(p1.page, `({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })`);
await ev(p1.page, `window.__auto.walkTo(${car.x}, ${car.z}, 2.6)`);
await p1.page.keyboard.press('e');
await p1.page.waitForTimeout(800);
log(`Entered car: ${(await ev<boolean>(p1.page, 'window.__beninlife.inCar')) ? 'PASS' : 'FAIL'}`);
const dirt0 = await ev<number>(p1.page, 'window.__beninlife.car.dirt');
let rt = await ev<number[][]>(p1.page, `window.__auto.route(window.__beninlife.carState.x, window.__beninlife.carState.z, 47, 4)`);
const half = Math.max(3, Math.floor(rt.length / 2));
let res = await ev<{ ok: boolean }>(p1.page, `window.__auto.drive(${JSON.stringify(rt.slice(0, half))}, 11)`);
log(`Drove onto the roundabout: ${res.ok ? 'PASS' : 'FAIL'}`);
await p1.page.waitForTimeout(300);
await shot(p1.page, '03_player_in_car_roundabout.png');
res = await ev(p1.page, `window.__auto.drive(${JSON.stringify(rt.slice(half))}, 11)`);
log(`Drove to car wash approach: ${res.ok ? 'PASS' : 'FAIL'}`);
res = await ev(p1.page, `window.__auto.drive([[47, 12], [47, 20.5]], 5)`);
log(`Drove into car wash bay: ${res.ok ? 'PASS' : 'FAIL'}`);
const dirt1 = await ev<number>(p1.page, 'window.__beninlife.car.dirt');
log(`Dirt increased by driving: ${dirt1 > dirt0 ? 'PASS' : 'FAIL'} (${dirt0.toFixed(2)} -> ${dirt1.toFixed(2)})`);
await ev(p1.page, `window.__beninlife.controls.camYaw = window.__beninlife.carState.rot + Math.PI + 0.7`);
await p1.page.waitForTimeout(2500);
await shot(p1.page, '06_carwash_before_dirty.png');
const balBefore = await hudBalance(p1.page);
await p1.page.keyboard.press('f');
await p1.page.waitForTimeout(2500);
const balAfter = await hudBalance(p1.page);
const dirt2 = await ev<number>(p1.page, 'window.__beninlife.car.dirt');
log(`Car wash: balance ${balBefore} -> ${balAfter}, dirt -> ${dirt2}: ${dirt2 === 0 && balBefore !== balAfter ? 'PASS' : 'FAIL'}`);
await shot(p1.page, '07_carwash_after_clean.png');

// ---------- BEST X mansion drive-by ----------
await ev(p1.page, `window.__auto.reverseFor(2600)`);
res = await ev(p1.page, `window.__auto.drive([[60, 3.5], [104, 3.5], [111, 6.5]], 11)`);
log(`Drove to BEST X mansion: ${res.ok ? 'PASS' : 'FAIL'}`);
await ev(p1.page, `window.__beninlife.controls.camYaw = window.__beninlife.carState.rot + Math.PI - 1.2; window.__beninlife.controls.camPitch = 0.15`);
await p1.page.waitForTimeout(3000);
await shot(p1.page, '02b_best_x_mansion_gate_guards.png');

// ---------- Delivery job ----------
rt = await ev<number[][]>(p1.page, `window.__auto.route(window.__beninlife.carState.x, window.__beninlife.carState.z, 10, 58)`);
res = await ev(p1.page, `window.__auto.drive(${JSON.stringify(rt)}, 12)`);
log(`Drove to market pickup: ${res.ok ? 'PASS' : 'FAIL'}`);
if (!(await ev<boolean>(p1.page, `window.__beninlife.contextActions().some(a => a.id === 'pickup')`))) {
  log('  (not close enough in car — getting out and walking to the marker)');
  await p1.page.keyboard.press('e'); await p1.page.waitForTimeout(600);
  await ev(p1.page, `window.__auto.walkTo(10, 58, 3)`);
}
await p1.page.keyboard.press('f');
await p1.page.waitForTimeout(1500);
const job = await ev<{ name: string; x: number; z: number } | null>(p1.page, 'window.__beninlife.job');
log(`Package picked up (server-validated): ${job ? 'PASS → ' + job.name : 'FAIL'}`);
await ev(p1.page, `window.__beninlife.controls.camYaw = window.__beninlife.carState.rot + Math.PI - 0.9`);
await p1.page.waitForTimeout(2500);
await shot(p1.page, '08_job_market_pickup.png');
if (job) {
  rt = await ev<number[][]>(p1.page, `window.__auto.route(window.__beninlife.carState.x, window.__beninlife.carState.z, ${job.x}, ${job.z})`);
  res = await ev(p1.page, `window.__auto.drive(${JSON.stringify(rt)}, 12)`);
  log(`Drove to drop-off: ${res.ok ? 'PASS' : 'FAIL'}`);
  if (!(await ev<boolean>(p1.page, `window.__beninlife.contextActions().some(a => a.id === 'deliver')`))) {
    log('  (walking the last metres to the drop-off)');
    await p1.page.keyboard.press('e'); await p1.page.waitForTimeout(600);
    await ev(p1.page, `window.__auto.walkTo(${job.x}, ${job.z}, 3)`);
  }
  const b0 = await hudBalance(p1.page);
  await p1.page.keyboard.press('f');
  await p1.page.waitForTimeout(1200);
  await shot(p1.page, '09_job_delivered_paid.png');
  const b1 = await hudBalance(p1.page);
  log(`Delivery payout: ${b0} -> ${b1}: ${b0 !== b1 ? 'PASS' : 'FAIL'}`);
}

// ---------- Night ----------
await ev(p1.page, `window.__beninlife.hourOverride = 21.5`);
if (!(await ev<boolean>(p1.page, 'window.__beninlife.inCar'))) {
  const cp = await ev<{ x: number; z: number }>(p1.page, `({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })`);
  await ev(p1.page, `window.__auto.walkTo(${cp.x}, ${cp.z}, 2.6)`);
  await p1.page.keyboard.press('e'); await p1.page.waitForTimeout(600);
}
rt = await ev<number[][]>(p1.page, `window.__auto.route(window.__beninlife.carState.x, window.__beninlife.carState.z, -60, 4)`);
res = await ev(p1.page, `window.__auto.drive(${JSON.stringify(rt.slice(0, Math.max(3, rt.length - 3)))}, 12)`);
log(`Night drive: ${res.ok ? 'PASS' : 'FAIL'}`);
await ev(p1.page, `window.__beninlife.controls.camYaw = window.__beninlife.carState.rot + Math.PI`);
await p1.page.waitForTimeout(2500);
await shot(p1.page, '10_night_driving_headlights.png');
await p1.page.keyboard.press('e');
await p1.page.waitForTimeout(800);
await ev(p1.page, `window.__beninlife.controls.camYaw = window.__beninlife.controls.camYaw + 2.2; window.__beninlife.controls.camPitch = 0.2`);
await p1.page.waitForTimeout(2500);
await shot(p1.page, '04_night_streetlights.png');

// ---------- Phone & DMs ----------
await p2.page.click('#btn-online');
await p2.page.waitForTimeout(800);
await p2.page.click(`#phone-screen .item:has-text("${P1}")`);
await p2.page.waitForSelector('#dm-input');
await p2.page.fill('#dm-input', 'How far Ada! You don finish that delivery?');
await p2.page.click('#dm-form button');
await p2.page.waitForTimeout(1200);
await shot(p2.page, '12_phone_dm_sent_player2.png');
await ev(p1.page, `window.__beninlife.hourOverride = 13`);
await p1.page.waitForTimeout(1500);
await p1.page.click('#btn-phone');
await p1.page.waitForTimeout(1500);
const badge = await p1.page.textContent('#phone-badge');
log(`P1 unread badge shows DM: ${badge === '1' ? 'PASS' : 'FAIL (' + badge + ')'}`);
await shot(p1.page, '11_hud_phone_home_unread.png');
await p1.page.click('#phone-screen [data-nav="messages"]');
await p1.page.waitForTimeout(800);
await p1.page.click(`#phone-screen .item:has-text("${P2}")`);
await p1.page.waitForSelector('#dm-input');
await p1.page.fill('#dm-input', 'Yes o! ₦1,500 entered. See you at the market.');
await p1.page.click('#dm-form button');
await p1.page.waitForTimeout(1200);
await shot(p1.page, '13_phone_messages_thread.png');
await p1.page.click('#phone-screen [data-nav="home"]');
await p1.page.click('#phone-screen [data-nav="wallet"]');
await p1.page.waitForTimeout(800);
await shot(p1.page, '14_phone_wallet.png');

// ---------- Presence: P2 leaves ----------
await p2.ctx.close();
await p1.page.waitForTimeout(1500);
await p1.page.click('#phone-screen [data-nav="home"]');
await p1.page.click('#phone-screen [data-nav="players"]');
await p1.page.waitForTimeout(1500);
const p2Status = await p1.page.textContent(`#phone-screen .item:has-text("${P2}") .st`);
log(`P2 shows OFFLINE after disconnect: ${p2Status === 'OFFLINE' ? 'PASS' : 'FAIL (' + p2Status + ')'}`);
await shot(p1.page, '15_phone_players_online_offline.png');
await p1.page.click('#phone-close');

await p1.ctx.close();
// ---------- Mobile: joystick moves the player ----------
const m = await newPlayer('auto', { width: 390, height: 844 }, true);
await m.ctx.request.post(`${base}/api/register`, { data: { username: `Mobile_${tag}`, password: 'mobile-password-1', ageConfirmed: true } });
await m.page.goto(`${base}/?capture=1&hour=16.5`);
await ready(m.page);
await m.page.waitForSelector('#creator:not(.hidden)');
await m.page.waitForTimeout(1500);
await shot(m.page, '16_mobile_character_creator.png');
await m.page.click('#cr-save');
await m.page.click('#intro-skip');
await m.page.waitForSelector('#hud:not(.hidden)');
const q = await ev<string>(m.page, 'window.__beninlife.quality');
log(`Mobile auto quality recommendation: ${q} (${q === 'low' ? 'PASS' : 'CHECK'})`);
const before = await ev<{ x: number; y: number }>(m.page, '({ x: window.__beninlife.pos.x, y: window.__beninlife.pos.y })');
const jb = (await m.page.locator('#joystick').boundingBox())!;
await m.page.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2);
await m.page.mouse.down();
await m.page.mouse.move(jb.x + jb.width / 2 + 10, jb.y + jb.height / 2 - 45, { steps: 4 });
await m.page.waitForTimeout(3500);
await shot(m.page, '17_mobile_joystick_hud.png');
await m.page.mouse.up();
const after = await ev<{ x: number; y: number }>(m.page, '({ x: window.__beninlife.pos.x, y: window.__beninlife.pos.y })');
const moved = Math.hypot(after.x - before.x, after.y - before.y);
log(`Mobile joystick moved player ${moved.toFixed(1)} m: ${moved > 1 ? 'PASS' : 'FAIL'}`);
await m.ctx.close();

await browser.close();
fs.writeFileSync(`${OUT}/e2e_results.txt`, results.join('\n') + '\n');
console.log('\nDONE');
