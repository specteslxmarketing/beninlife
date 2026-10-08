// Focused e2e run: delivery job loop, night view, phone DMs, presence and mobile joystick.
// Uses the real client controls via scripts/autopilot.js; all money changes are server-validated.
import fs from 'node:fs';
import { chromium, type Page, type BrowserContext } from 'playwright';

const base = process.env.BASE ?? 'http://localhost:3000';
const OUT = 'screenshots';
const autopilot = fs.readFileSync('scripts/autopilot.js', 'utf8');
const tag = Math.random().toString(36).slice(2, 6);
const results: string[] = [];
const log = (s: string) => { console.log(s); results.push(s); };
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function player(name: string, quality: string, viewport: { width: number; height: number }, mobile = false): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' : undefined });
  await ctx.addInitScript(`localStorage.setItem('bl_quality', '${quality}');`);
  await ctx.addInitScript(autopilot);
  await ctx.request.post(`${base}/api/register`, { data: { username: name, password: 'password-' + tag, ageConfirmed: true } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}/?capture=1&hour=10`);
  await page.waitForFunction('!!window.__beninlife', null, { timeout: 240000 });
  await page.waitForSelector('#creator:not(.hidden)');
  return { ctx, page };
}
async function enter(p: Page, skin: number, outfit: number, body = 'male') {
  await p.click(`#cr-body button[data-b="${body}"]`); await p.click(`#cr-skin button[data-i="${skin}"]`); await p.click(`#cr-outfit button[data-i="${outfit}"]`);
  await p.click('#cr-save'); await p.waitForSelector('#intro-skip'); await p.click('#intro-skip'); await p.waitForSelector('#hud:not(.hidden)');
}
const ev = <T = unknown>(p: Page, js: string) => p.evaluate(js) as Promise<T>;
const shot = async (p: Page, name: string) => { await p.screenshot({ path: `${OUT}/${name}` }); log(`saved ${OUT}/${name}`); };
const bal = (p: Page) => p.textContent('#hud-balance');
const has = (p: Page, id: string) => ev<boolean>(p, `window.__beninlife.contextActions().some(a => a.id === '${id}')`);
async function stopAndExit(p: Page) {
  await ev(p, `window.__auto.setKeys(' ')`); await p.waitForTimeout(2500); await ev(p, `window.__auto.setKeys()`);
  if (await ev<boolean>(p, 'window.__beninlife.inCar')) { await p.keyboard.press('e'); await p.waitForTimeout(800); }
}
async function driveTo(p: Page, x: number, z: number): Promise<boolean> {
  const rt = await ev<number[][]>(p, `window.__auto.route(window.__beninlife.carState.x, window.__beninlife.carState.z, ${x}, ${z})`);
  const r = await ev<{ ok: boolean }>(p, `window.__auto.drive(${JSON.stringify(rt)}, 12, 200000)`);
  return r.ok;
}

// ---------- Player 1: delivery job ----------
const P1 = `Efe_${tag}`;
const a = await player(P1, 'high', { width: 1280, height: 720 });
await enter(a.page, 0, 1, 'male');
const car = await ev<{ x: number; z: number }>(a.page, `({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })`);
await ev(a.page, `window.__auto.walkTo(${car.x}, ${car.z}, 2.6)`);
await a.page.keyboard.press('e'); await a.page.waitForTimeout(600);
log(`Entered car: ${(await ev<boolean>(a.page, 'window.__beninlife.inCar')) ? 'PASS' : 'FAIL'}`);
log(`Drove to market: ${(await driveTo(a.page, 10, 58)) ? 'PASS' : 'FAIL (timeout)'}`);
if (!(await has(a.page, 'pickup'))) { log('  pulled up short — walking to the marker'); await stopAndExit(a.page); await ev(a.page, `window.__auto.walkTo(10, 58, 3)`); }
const b0 = await bal(a.page);
await a.page.keyboard.press('f'); await a.page.waitForTimeout(1500);
const job = await ev<{ name: string; x: number; z: number } | null>(a.page, 'window.__beninlife.job');
log(`Pickup accepted by server: ${job ? 'PASS → deliver to ' + job.name : 'FAIL'}`);
await ev(a.page, `window.__beninlife.controls.camYaw = window.__beninlife.rot + Math.PI - 0.9`); await a.page.waitForTimeout(2500);
await shot(a.page, '08a_delivery_pickup_market.png');
if (job) {
  if (!(await ev<boolean>(a.page, 'window.__beninlife.inCar'))) {
    const c = await ev<{ x: number; z: number }>(a.page, `({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })`);
    await ev(a.page, `window.__auto.walkTo(${c.x}, ${c.z}, 2.6)`); await a.page.keyboard.press('e'); await a.page.waitForTimeout(600);
  }
  log(`Drove to drop-off: ${(await driveTo(a.page, job.x, job.z)) ? 'PASS' : 'FAIL (timeout)'}`);
  if (!(await has(a.page, 'deliver'))) { log('  walking the last metres to the drop-off'); await stopAndExit(a.page); await ev(a.page, `window.__auto.walkTo(${job.x}, ${job.z}, 3)`); }
  await a.page.keyboard.press('f'); await a.page.waitForTimeout(1200);
  await shot(a.page, '04_delivery_job_paid.png');
  const b1 = await bal(a.page);
  log(`Delivery payout ${b0} -> ${b1}: ${b0 === '₦5,000' && b1 === '₦6,500' ? 'PASS' : 'FAIL'}`);
}

// ---------- Night ----------
await ev(a.page, `window.__beninlife.hourOverride = 21.5`);
await stopAndExit(a.page);
await ev(a.page, `window.__beninlife.controls.camYaw += 1.4; window.__beninlife.controls.camPitch = 0.18`);
await a.page.waitForTimeout(3000);
await shot(a.page, '04b_night_street_lights.png');
const c2 = await ev<{ x: number; z: number }>(a.page, `({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })`);
await ev(a.page, `window.__auto.walkTo(${c2.x}, ${c2.z}, 2.6)`); await a.page.keyboard.press('e'); await a.page.waitForTimeout(600);
await ev(a.page, `window.__auto.drive([[window.__beninlife.carState.x + Math.sin(window.__beninlife.carState.rot) * 25, window.__beninlife.carState.z + Math.cos(window.__beninlife.carState.rot) * 25]], 8, 40000)`);
await ev(a.page, `window.__beninlife.controls.camYaw = window.__beninlife.carState.rot + Math.PI`); await a.page.waitForTimeout(2500);
await shot(a.page, '10_night_car_headlights.png');
await ev(a.page, `window.__beninlife.hourOverride = 13`);

// ---------- Player 2: DM + presence ----------
const P2 = `Itohan_${tag}`;
const b = await player(P2, 'low', { width: 800, height: 450 });
await enter(b.page, 3, 6, 'female');
await b.page.click('#btn-online'); await b.page.waitForTimeout(1000);
await b.page.click(`#phone-screen .item:has-text("${P1}")`);
await b.page.waitForSelector('#dm-input');
await b.page.fill('#dm-input', 'Efe! How far? You don collect the ₦1,500?');
await b.page.click('#dm-form button'); await b.page.waitForTimeout(1500);
await shot(b.page, '12_phone_dm_sent_player2.png');
await a.page.waitForTimeout(1500);
log(`P1 unread badge: ${(await a.page.textContent('#phone-badge')) === '1' ? 'PASS' : 'FAIL'}`);
await a.page.click('#btn-phone'); await a.page.waitForTimeout(1200);
await shot(a.page, '11_hud_phone_home_unread.png');
await a.page.click('#phone-screen [data-nav="messages"]'); await a.page.waitForTimeout(800);
await a.page.click(`#phone-screen .item:has-text("${P2}")`); await a.page.waitForSelector('#dm-input');
await a.page.fill('#dm-input', 'Yes o! Delivery done, ₦1,500 entered. See you for Ring Road.');
await a.page.click('#dm-form button'); await a.page.waitForTimeout(1500);
await shot(a.page, '08_phone_messages.png');
await a.page.click('#phone-screen [data-nav="home"]'); await a.page.click('#phone-screen [data-nav="wallet"]'); await a.page.waitForTimeout(800);
await shot(a.page, '14_phone_wallet.png');
await a.page.click('#phone-screen [data-nav="home"]'); await a.page.click('#phone-screen [data-nav="players"]'); await a.page.waitForTimeout(1200);
log(`P2 listed ONLINE: ${(await a.page.textContent(`#phone-screen .item:has-text("${P2}") .st`)) === 'ONLINE' ? 'PASS' : 'FAIL'}`);
await b.ctx.close(); await a.page.waitForTimeout(2000);
await a.page.click('#phone-screen [data-nav="home"]'); await a.page.click('#phone-screen [data-nav="players"]'); await a.page.waitForTimeout(1500);
log(`P2 OFFLINE after disconnect: ${(await a.page.textContent(`#phone-screen .item:has-text("${P2}") .st`)) === 'OFFLINE' ? 'PASS' : 'FAIL'}`);
await shot(a.page, '15_phone_players_online_offline.png');
await a.ctx.close();

// ---------- Mobile ----------
const m = await player(`Mobile_${tag}`, 'auto', { width: 390, height: 844 }, true);
await shot(m.page, '16_mobile_character_creator.png');
await enter(m.page, 2, 2);
log(`Mobile auto quality = ${await ev<string>(m.page, 'window.__beninlife.quality')}`);
const before = await ev<{ x: number; y: number }>(m.page, '({ x: window.__beninlife.pos.x, y: window.__beninlife.pos.y })');
const jb = (await m.page.locator('#joystick').boundingBox())!;
await m.page.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2); await m.page.mouse.down();
await m.page.mouse.move(jb.x + jb.width / 2 + 8, jb.y + jb.height / 2 - 45, { steps: 4 });
await m.page.waitForTimeout(4000);
await shot(m.page, '17_mobile_joystick_hud.png');
await m.page.mouse.up();
const after = await ev<{ x: number; y: number }>(m.page, '({ x: window.__beninlife.pos.x, y: window.__beninlife.pos.y })');
const moved = Math.hypot(after.x - before.x, after.y - before.y);
log(`Mobile joystick moved player ${moved.toFixed(1)} m: ${moved > 1 ? 'PASS' : 'FAIL'}`);
await browser.close();
fs.writeFileSync(`${OUT}/e2e_results_jobs.txt`, results.join('\n') + '\n');
console.log('DONE');
