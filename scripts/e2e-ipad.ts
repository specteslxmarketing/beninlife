// E2E: iPad / Safari (WebKit) — Playwright WebKit with iPad Pro 11 device emulation (touch, Safari UA, DPR 2),
// landscape + portrait. Checks touch controls, auto quality, joystick walking, entering the car with the touch
// button, the radio HUD, and fails on any console error. New account per run.
import fs from 'node:fs';
import { webkit, devices, type Page } from 'playwright';
import { base, OUT, tag, check, log, consoleErrors, saveResults, adminPassword, adminSocket } from './e2e-lib.js';

const browser = await webkit.launch();
const ua = devices['iPad Pro 11'];
async function open(orientation: 'landscape' | 'portrait'): Promise<Page> {
  const vp = orientation === 'landscape' ? { width: 1194, height: 834 } : { width: 834, height: 1194 };
  const ctx = await browser.newContext({ ...ua, viewport: vp, screen: vp });
  // iPadOS Safari "desktop mode" UA reports Macintosh — emulate that too so the iPad detection path is exercised
  await ctx.addInitScript(`localStorage.removeItem('bl_quality');
    window.addEventListener('unhandledrejection', (e) => console.error('[unhandledrejection]', (e.reason && (e.reason.stack || e.reason.message)) || String(e.reason)));`);
  // landscape: brand-new account (creator + arrival); portrait: the admin account, so it can be teleported beside its car
  const admin = orientation === 'portrait';
  const name = admin ? 'bestx' : `iPad_${tag}_${orientation[0]}`, password = admin ? adminPassword() : 'password-' + tag;
  if (admin) await ctx.request.post(`${base}/api/login`, { data: { username: name, password } });
  else await ctx.request.post(`${base}/api/register`, { data: { username: name, password, ageConfirmed: true } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { consoleErrors.push(`[pageerror ${name}] ${e.message}`); console.log('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { consoleErrors.push(`[console ${name}] ${m.text()}`); console.log('[console.error]', m.text().slice(0, 300)); } });
  await page.goto(`${base}/?capture=1&hour=10`);
  await page.waitForFunction('!!window.__beninlife', null, { timeout: 300000 });
  return page;
}
const ev = <T,>(p: Page, js: string) => p.evaluate(js) as Promise<T>;
const shot = async (p: Page, n: string) => { await p.screenshot({ path: `${OUT}/${n}`, timeout: 180000 }); log(`  saved ${OUT}/${n}`); };

for (const orientation of ['landscape', 'portrait'] as const) {
  const p = await open(orientation);
  const info = await ev<{ webgl2: boolean; touch: boolean; ipadClass: boolean; quality: string; ua: string }>(p, `({ webgl2: !!document.createElement('canvas').getContext('webgl2'), touch: document.body.classList.contains('touch'), ipadClass: document.body.classList.contains('ipad'), quality: window.__beninlife.quality, ua: navigator.userAgent })`);
  log(`  ${orientation}: ${JSON.stringify(info)}`);
  check(`IPAD ${orientation}: WebGL2 available in WebKit`, info.webgl2);
  check(`IPAD ${orientation}: touch UI enabled`, info.touch);
  check(`IPAD ${orientation}: iPad detected → auto quality ${info.quality}`, info.ipadClass && (info.quality === 'medium' || info.quality === 'low'));
  // creator → save → intro skip
  await p.waitForFunction("!document.querySelector('#creator').classList.contains('hidden') || !document.querySelector('#intro').classList.contains('hidden') || !document.querySelector('#hud').classList.contains('hidden')", null, { timeout: 120000 });
  if (await p.isVisible('#creator')) { await shot(p, `ipad_${orientation}_01_creator.png`); await p.tap('#cr-save'); }
  await p.waitForFunction("!document.querySelector('#intro').classList.contains('hidden') || !document.querySelector('#hud').classList.contains('hidden')", null, { timeout: 120000 });
  if (await p.isVisible('#intro-skip')) await p.tap('#intro-skip');
  await p.waitForSelector('#hud:not(.hidden)', { timeout: 180000 });
  check(`IPAD ${orientation}: joystick + touch pad visible`, await p.isVisible('#joystick') && await p.isVisible('#touchpad') && await p.isVisible('#tb-car'));
  // walk with the on-screen joystick (real touch events through Playwright's touchscreen is tap-only, so drive pointer events)
  const before = await ev<{ x: number; y: number }>(p, '({ x: window.__beninlife.pos.x, y: window.__beninlife.pos.y })');
  const box = (await p.locator('#joystick').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await p.dispatchEvent('#joystick', 'pointerdown', { pointerId: 7, clientX: cx, clientY: cy, pointerType: 'touch', isPrimary: true, bubbles: true });
  await p.dispatchEvent('#joystick', 'pointermove', { pointerId: 7, clientX: cx, clientY: cy - box.height * 0.45, pointerType: 'touch', isPrimary: true, bubbles: true });
  await p.waitForTimeout(6000);
  await shot(p, `ipad_${orientation}_02_walking_touch.png`);
  await p.dispatchEvent('#joystick', 'pointerup', { pointerId: 7, clientX: cx, clientY: cy, pointerType: 'touch', isPrimary: true, bubbles: true });
  const after = await ev<{ x: number; y: number }>(p, '({ x: window.__beninlife.pos.x, y: window.__beninlife.pos.y })');
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  check(`IPAD ${orientation}: joystick moves the player`, moved > 0.5, `${moved.toFixed(1)} m`);
  // get to the own car and enter it with the touch button
  if (await ev<boolean>(p, 'window.__beninlife.inCar')) { await p.dispatchEvent('#tb-car', 'pointerdown', { pointerId: 8, pointerType: 'touch', isPrimary: true, bubbles: true }); await p.waitForFunction('!window.__beninlife.inCar && !window.__beninlife.seq', null, { timeout: 60000 }); }
  // stand beside the driver door: the new (landscape) player is walked over by the admin summon tool (they start at the
  // airport, far from their car); BEST 𝕏 (portrait) uses his own admin teleport
  if (orientation === 'portrait') { // BEST 𝕏's car back at the mansion (another run may have left it anywhere in town)
    await ev(p, `new Promise(r => window.__beninlife.socket.emit('car:list', {}, l => l.active && l.active.id ? window.__beninlife.socket.emit('car:use', { id: l.active.id }, r) : r(null)))`);
    await p.waitForTimeout(2000);
  }
  const c = await ev<{ x: number; z: number; rot: number; id: number }>(p, '({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z, rot: window.__beninlife.carState.rot, id: window.__beninlife.me.id })');
  const door = { x: c.x + Math.cos(c.rot) * 2.3, z: c.z - Math.sin(c.rot) * 2.3 };
  if (orientation === 'landscape') { const adm = await adminSocket(); await adm.emit('admin:teleport', { id: c.id, ...door }); adm.close(); }
  else await ev(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: ${door.x}, z: ${door.z} }, r))`);
  await p.waitForFunction(`Math.hypot(window.__beninlife.pos.x - ${door.x}, window.__beninlife.pos.y - ${door.z}) < 1.5`, null, { timeout: 20000 }).catch(() => undefined);
  await p.waitForTimeout(1500);
  await p.dispatchEvent('#tb-car', 'pointerdown', { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true });
  await p.waitForFunction('window.__beninlife.inCar', null, { timeout: 60000 }).catch(() => undefined);
  check(`IPAD ${orientation}: touch "Car" button enters the car`, await ev<boolean>(p, 'window.__beninlife.inCar'));
  await p.waitForFunction('!window.__beninlife.seq', null, { timeout: 30000 }).catch(() => undefined);
  check(`IPAD ${orientation}: in the car, R-key actions are split — radio button shown, reload button hidden`, await p.isVisible('#tb-radio') && !(await p.isVisible('#tb-reload')) && !(await p.isVisible('#tb-fire')));
  // touch driving: push the joystick forward (throttle) and a little right (steer)
  const c0 = await ev<{ x: number; z: number }>(p, '({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })');
  const jb = (await p.locator('#joystick').boundingBox())!; const jx = jb.x + jb.width / 2, jy = jb.y + jb.height / 2;
  await p.dispatchEvent('#joystick', 'pointerdown', { pointerId: 11, clientX: jx, clientY: jy, pointerType: 'touch', isPrimary: true, bubbles: true });
  await p.dispatchEvent('#joystick', 'pointermove', { pointerId: 11, clientX: jx + jb.width * 0.12, clientY: jy - jb.height * 0.45, pointerType: 'touch', isPrimary: true, bubbles: true });
  let vmax = 0; for (let i = 0; i < 12; i++) { await p.waitForTimeout(500); vmax = Math.max(vmax, await ev<number>(p, 'Math.abs(window.__beninlife.carState.speed)')); }
  await shot(p, `ipad_${orientation}_03_in_car_touch.png`);
  await p.dispatchEvent('#joystick', 'pointerup', { pointerId: 11, clientX: jx, clientY: jy, pointerType: 'touch', isPrimary: true, bubbles: true });
  const c1 = await ev<{ x: number; z: number }>(p, '({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })');
  check(`IPAD ${orientation}: touch joystick drives the car`, vmax > 1.5 && Math.hypot(c1.x - c0.x, c1.z - c0.z) > 2, `top speed ${vmax.toFixed(1)} m/s, moved ${Math.hypot(c1.x - c0.x, c1.z - c0.z).toFixed(1)} m`);
  await p.dispatchEvent('#tb-brake', 'pointerdown', { pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true });
  const stopped = await p.waitForFunction('Math.abs(window.__beninlife.carState.speed) < 1', null, { timeout: 12000, polling: 200 }).then(() => true).catch(() => false);
  const vStop = await ev<number>(p, 'Math.abs(window.__beninlife.carState.speed)');
  await p.dispatchEvent('#tb-brake', 'pointerup', { pointerId: 12, pointerType: 'touch', isPrimary: true, bubbles: true });
  check(`IPAD ${orientation}: touch brake stops the car`, stopped, `${vStop.toFixed(2)} m/s`);
  await p.dispatchEvent('#tb-radio', 'pointerdown', { pointerId: 10, pointerType: 'touch', isPrimary: true, bubbles: true });
  await p.waitForTimeout(1500);
  check(`IPAD ${orientation}: radio HUD shows a station`, /FM|Amapiano|Highlife|Eko|Radio off/.test(await p.textContent('#rd-station') ?? ''), (await p.textContent('#rd-station')) ?? '');
  await shot(p, `ipad_${orientation}_04_radio_touch.png`);
  await p.context().close();
}
saveResults('e2e_ipad.txt');
fs.existsSync(OUT);
await browser.close();
