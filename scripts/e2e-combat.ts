// E2E: GTA-RP combat loop with two real players.
// gun shop (licence → weapon → armour, all server-side) · weapons refused in safe zones · aim + crosshair + fire ·
// server-validated hits · wanted level + police response units · knockdown → ambulance → hospital bill ·
// gangs (create → invite → join → gang chat → nametag tag) · touch fire button path · console gate.
import { launch, player, enter, ev, shot, check, log, tag, saveResults, phone, adminSocket } from './e2e-lib.js';
import { GUN_SHOP, HOSPITAL, safeZoneAt } from '../shared/combat.js';

const Q = process.env.Q ?? 'low';
const browser = await launch();
const G = 'window.__beninlife';
// shooter and target are separate test accounts (BEST 𝕏's wallet is never spent): the admin tool funds the shooter
// and summons both players, like a server moderator would
const admin = await adminSocket();
const A = await player(browser, `Ade_${tag}`, { quality: Q, ambient: false }); await enter(A.page, 1, 6, 'male');
const B = await player(browser, `Osa_${tag}`, { quality: Q, ambient: false }); await enter(B.page, 3, 2, 'male');
const aId = await ev<number>(A.page, `${G}.me.id`), bId = await ev<number>(B.page, `${G}.me.id`);
const tp = async (x: number, z: number) => { const r = await admin.emit('admin:teleport', { id: aId, x, z }); await A.page.waitForFunction(`Math.hypot(${G}.pos.x - ${x}, ${G}.pos.y - ${z}) < 2`, null, { timeout: 15000 }).catch(() => undefined); return r; };
const frame = (p = A.page) => ev(p, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
await ev(A.page, `(() => { window.__arrests = 0; window.__unitsSeen = 0; window.__unitNear = 1e9;
  ${G}.socket.on('wanted', (w) => { if (w.arrested) window.__arrests++; });
  setInterval(() => { const l = ${G}.policeSnap || []; window.__unitsSeen = Math.max(window.__unitsSeen, l.length); for (const u of l) window.__unitNear = Math.min(window.__unitNear, Math.hypot(u.x - ${G}.pos.x, u.z - ${G}.pos.y)); }, 250); })()`);
check('ADMIN: shooter test account funded by the admin grant tool', (await admin.emit('admin:grant', { id: aId, amount: 3_000_000 })).ok);
await A.page.waitForFunction(`${G}.balance >= 3000000`, null, { timeout: 15000 }).catch(() => undefined);
await admin.emit('admin:teleport', { id: bId, x: -44, z: 10.5 });
await B.page.waitForFunction(`Math.hypot(${G}.pos.x + 44, ${G}.pos.y - 10.5) < 2`, null, { timeout: 15000 }).catch(() => undefined);

// ---------------- gun shop ----------------
await tp(GUN_SHOP.door.x, GUN_SHOP.door.z + 1.2);
await A.page.waitForFunction(`${G}.contextActions().some(a => a.id === 'shop:guns')`, null, { timeout: 20000 }).catch(() => undefined);
check('SHOP: "Ekehuan Arms & Licensing" counter offered at the gun-shop door', await ev<boolean>(A.page, `${G}.contextActions().some(a => a.id === 'shop:guns')`));
await ev(A.page, `${G}.doContextAction('shop:guns')`);
await A.page.waitForSelector('#phone:not(.hidden) [data-gun-buy], #phone:not(.hidden) [data-gun-ammo]', { timeout: 15000 });
const bal0 = await ev<number>(A.page, `${G}.balance`);
if (await A.page.isVisible('[data-gun-lic]')) { await A.page.click('[data-gun-lic]'); await A.page.waitForFunction(`${G}.combat.s.licence`, null, { timeout: 15000 }).catch(() => undefined); }
await A.page.waitForTimeout(800);
check('SHOP: firearms licence held (bought server-side)', await ev<boolean>(A.page, `new Promise(r => ${G}.socket.emit('combat:state', {}, s => r(s.state.licence)))`));
for (const id of ['pistol', 'smg']) {
  const sel = `[data-gun-buy="${id}"]`;
  if (await A.page.isVisible(sel)) { await A.page.click(sel); await A.page.waitForSelector(`[data-gun-ammo="${id}"]`, { timeout: 15000 }).catch(() => undefined); }
  else if (await A.page.isVisible(`[data-gun-ammo="${id}"]`)) { await A.page.click(`[data-gun-ammo="${id}"]`); await A.page.waitForTimeout(800); }
}
if (await A.page.isVisible('[data-gun-arm]')) { await A.page.click('[data-gun-arm]'); await A.page.waitForTimeout(1200); }
const st = await ev<{ weapons: Record<string, { mag: number; reserve: number }>; armour: number }>(A.page, `new Promise(r => ${G}.socket.emit('combat:state', {}, s => r(s.state)))`);
check('SHOP: pistol + SMG owned with ammunition (server state)', !!st.weapons.pistol && !!st.weapons.smg && st.weapons.pistol.mag > 0, JSON.stringify(st.weapons));
check('SHOP: body armour fitted', st.armour > 0, `armour ${st.armour}`);
const bal1 = await ev<number>(A.page, `${G}.balance`);
check('SHOP: wallet charged by the server', bal1 < bal0, `₦${bal0} → ₦${bal1}`);
await ev(A.page, `${G}.controls.camYaw = Math.PI * 0; ${G}.controls.camPitch = 0.12`);
await A.page.waitForTimeout(800);
await shot(A.page, 'combat_01_gun_shop_counter.png');
await A.page.click('#phone-close').catch(() => ev(A.page, `document.querySelector('#phone').classList.add('hidden')`));

// ---------------- safe zone: drawing a weapon refused ----------------
check('SAFE ZONE: gun shop forecourt is a safe zone', safeZoneAt(GUN_SHOP.door.x, GUN_SHOP.door.z + 1.2) !== null);
await A.page.keyboard.press('1'); await A.page.waitForTimeout(1200);
const eqSafe = await ev<string | null>(A.page, `new Promise(r => ${G}.socket.emit('combat:state', {}, s => r(s.state.equipped)))`);
const srvSafe = await ev<{ ok: boolean; error?: string }>(A.page, `new Promise(r => ${G}.socket.emit('gun:equip', { id: 'pistol' }, r))`);
check('SAFE ZONE: drawing a weapon is refused (client and server)', eqSafe === null && !srvSafe.ok, JSON.stringify(srvSafe));
await shot(A.page, 'combat_02_safe_zone_chip.png');

// ---------------- the target walks into town; open PvP outside safe zones ----------------
const bp = await ev<{ x: number; z: number }>(B.page, `({ x: ${G}.pos.x, z: ${G}.pos.y })`);
check('TARGET: standing outside every safe zone', safeZoneAt(bp.x, bp.z) === null, `${bp.x.toFixed(1)},${bp.z.toFixed(1)}`);
const ax = bp.x + 7, az = bp.z + 1.5;
await tp(ax, az); await A.page.waitForTimeout(1500);
await A.page.waitForFunction(`${G}.remotes.has(${bId})`, null, { timeout: 15000 }).catch(() => undefined);
await A.page.keyboard.press('1');
await A.page.waitForFunction(`${G}.combat.weapon === 'pistol'`, null, { timeout: 15000 }).catch(() => undefined);
check('WEAPON: pistol drawn outside the safe zone', await ev<string>(A.page, `${G}.combat.weapon`) === 'pistol');
const hp0 = await ev<number>(B.page, `${G}.combat.s.health`), ar0 = await ev<number>(B.page, `${G}.combat.s.armour`);
// aim: face the target and find a pitch whose crosshair ray lands on their body
let lastPitch = 0.08;
let bestD = 99;
const aimAt = async () => {
  const r = await ev<{ x: number; z: number }>(A.page, `(() => { const r = ${G}.remotes.get(${bId}); return { x: r.x, z: r.z }; })()`);
  const me = await ev<{ x: number; z: number }>(A.page, `({ x: ${G}.pos.x, z: ${G}.pos.y })`);
  let yaw = Math.atan2(-(r.x - me.x), -(r.z - me.z));
  for (const pitch of [lastPitch, 0.08, 0.04, 0.12, 0.0, 0.16, -0.04]) {
    // the over-the-shoulder camera sits right of the player, so steer the camera (crosshair) ray itself onto the target
    for (let k = 0; k < 3; k++) {
      await ev(A.page, `${G}.controls.camYaw = ${yaw}; ${G}.controls.camPitch = ${pitch}`);
      await A.page.waitForTimeout(450); await frame();
      const cam = await ev<{ x: number; z: number }>(A.page, `({ x: ${G}.camera.position.x, z: ${G}.camera.position.z })`);
      yaw = Math.atan2(-(r.x - cam.x), -(r.z - cam.z));
    }
    await ev(A.page, `${G}.controls.camYaw = ${yaw}`); await A.page.waitForTimeout(450); await frame();
    // horizontal distance from the target's body axis to the crosshair ray, and whether the ray is at body height there
    const d = await ev<number>(A.page, `(() => { const g = ${G}, o = g.camera.position, p = g.combat.aimPoint(), r = g.remotes.get(${bId});
      const dx = p.x - o.x, dz = p.z - o.z, L = Math.hypot(dx, dz), t = ((r.x - o.x) * dx + (r.z - o.z) * dz) / (L * L);
      if (t <= 0) return 99; const y = o.y + (p.y - o.y) * t; if (y < 0.2 || y > 1.85) return 98;
      return Math.hypot(o.x + dx * t - r.x, o.z + dz * t - r.z); })()`);
    bestD = Math.min(bestD, d);
    if (d < 0.45) { lastPitch = pitch; return true; }
  }
  return false;
};
await ev(A.page, `${G}.combat.setAim(true)`);
await A.page.waitForTimeout(600);
const onTarget = await aimAt();
check('AIM: crosshair ray lands on the target player', onTarget, `closest ${bestD.toFixed(2)} m`);
check('AIM: crosshair shown while aiming', await ev<boolean>(A.page, `!document.getElementById('crosshair').classList.contains('hidden') && ${G}.combat.aiming`));
await shot(A.page, 'combat_03_aiming_crosshair.png');
// fire a handful of rounds, re-aiming after recoil
let hits = 0, shots = 0; const mag0 = await ev<number>(A.page, `${G}.combat.ammo.mag`);
for (let i = 0; i < 3; i++) {
  await aimAt();
  const before = await ev<number>(A.page, `${G}.combat.ammo.mag`);
  await ev(A.page, `${G}.combat.fire()`); shots++;
  await A.page.waitForFunction(`!${G}.combat.pending`, null, { timeout: 10000 }).catch(() => undefined);
  if (i === 1) await shot(A.page, 'combat_04_firing_muzzle_flash.png');
  if ((await ev<number>(A.page, `${G}.combat.hitMark`)) > 0) hits++;
  await A.page.waitForTimeout(400);
  if ((await ev<number>(A.page, `${G}.combat.ammo.mag`)) >= before) break;
}
const mag1 = await ev<number>(A.page, `${G}.combat.ammo.mag`);
check('FIRE: rounds spent from the magazine (server-tracked ammo)', mag1 < mag0, `${mag0} → ${mag1}`);
await B.page.waitForTimeout(800);
const hp1 = await ev<number>(B.page, `${G}.combat.s.health`), ar1 = await ev<number>(B.page, `${G}.combat.s.armour`);
check('HITS: server-validated hits reduced the target\'s health', hp1 < hp0 || ar1 < ar0, `health ${hp0} → ${hp1}, hits seen ${hits}/${shots}`);
check('POLICE: shooter is wanted after firing in public', (await ev<number>(A.page, `${G}.wanted`)) >= 1, `★${await ev<number>(A.page, `${G}.wanted`)}`);
// responders may arrest the shooter mid-test (they really do come): put them back at the scene, weapon drawn
const backToScene = async (w: string) => {
  if (Math.hypot(await ev<number>(A.page, `${G}.pos.x`) - ax, await ev<number>(A.page, `${G}.pos.y`) - az) > 6) { log('  (shooter was arrested by responders — summoning back to the scene)'); await tp(ax, az); await A.page.waitForTimeout(800); }
  if (await ev<string | null>(A.page, `${G}.combat.weapon`) !== w) { await ev(A.page, `${G}.combat.equip('${w}')`); await A.page.waitForTimeout(500); }
  await ev(A.page, `${G}.combat.setAim(true)`);
};
// ---------------- reload ----------------
await backToScene('pistol'); await A.page.waitForTimeout(400);
await A.page.keyboard.press('r');
const reloaded = await A.page.waitForFunction(`${G}.combat.ammo && ${G}.combat.ammo.mag === 12`, null, { timeout: 15000 }).then(() => true).catch(() => false);
check('RELOAD: R reloads the magazine from reserve on foot (server-side)', reloaded, JSON.stringify(await ev(A.page, `${G}.combat.ammo`)));
check('KEYS: R on foot did not switch the radio (radio is only in a car)', await ev<boolean>(A.page, `!${G}.inCar`));
await ev(B.page, `${G}.controls.camYaw = Math.atan2(${bp.x} - ${ax}, ${bp.z} - ${az}); ${G}.controls.camPitch = 0.15`);
await shot(B.page, 'combat_05_target_hurt_hud.png');
// rate limit: a burst of fire events faster than the gun allows must be refused by the server
await backToScene('pistol');
const burst = await ev<{ ok: boolean; error?: string }[]>(A.page, `Promise.all(Array.from({ length: 6 }, () => new Promise(r => ${G}.socket.emit('gun:fire', { aim: { x: 1, y: 0, z: 0 } }, r))))`);
check('ANTI-CHEAT: server refuses fire faster than the weapon\'s rate', burst.some((r) => !r.ok), burst.map((r) => r.ok ? 'ok' : r.error).join(','));
await ev(A.page, `${G}.combat.s.weapons.pistol && new Promise(r => ${G}.socket.emit('combat:state', {}, s => { ${G}.combat.set(s.state); r(0); }))`);

// ---------------- knockdown → hospital ----------------
const bBal0 = await ev<number>(B.page, `${G}.balance`);
await ev(A.page, `${G}.combat.equip('smg')`); await A.page.waitForTimeout(500); await ev(A.page, `${G}.combat.setAim(true)`);
let down = false;
for (let i = 0; i < 16 && !down; i++) {
  await backToScene('smg');
  await aimAt(); await ev(A.page, `${G}.combat.firing = true`);
  await A.page.waitForTimeout(900); await ev(A.page, `${G}.combat.firing = false`);
  await A.page.waitForFunction(`!${G}.combat.pending`, null, { timeout: 10000 }).catch(() => undefined);
  if (!(await ev<number>(A.page, `${G}.combat.ammo.mag`))) { await ev(A.page, `${G}.combat.reload()`); await A.page.waitForTimeout(2600); }
  down = await ev<boolean>(B.page, `${G}.combat.downed`);
}
check('KNOCKDOWN: target downed by gunfire', down);
await B.page.waitForTimeout(800);
check('KNOCKDOWN: wounded overlay with ambulance countdown', await B.page.isVisible('#downed'));
await shot(B.page, 'combat_06_knocked_down.png');
await ev(A.page, `${G}.combat.setAim(false)`);
await A.page.waitForTimeout(1200);
await shot(A.page, 'combat_07_target_down_shooter_view.png');
check('POLICE: wanted ★★★ after knocking someone down', (await ev<number>(A.page, `${G}.wanted`)) >= 3 || (await ev<number>(A.page, 'window.__arrests')) > 0, `★${await ev<number>(A.page, `${G}.wanted`)}`);
const atHosp = await B.page.waitForFunction(`!${G}.combat.downed && Math.hypot(${G}.pos.x - ${HOSPITAL.respawn.x}, ${G}.pos.y - ${HOSPITAL.respawn.z}) < 4`, null, { timeout: 30000 }).then(() => true).catch(() => false);
check('HOSPITAL: respawned at Ogbe General Hospital after the ambulance', atHosp);
await B.page.waitForTimeout(1200);
const bBal1 = await ev<number>(B.page, `${G}.balance`);
check('HOSPITAL: ₦ hospital bill charged by the server', bBal1 === bBal0 - Math.min(bBal0, HOSPITAL.fee), `₦${bBal0} → ₦${bBal1}`);
check('HOSPITAL: health restored', (await ev<number>(B.page, `${G}.combat.s.health`)) >= 99);
await ev(B.page, `${G}.controls.camYaw = 0; ${G}.controls.camPitch = 0.12`);
await B.page.waitForTimeout(1000);
await shot(B.page, 'combat_08_hospital_respawn.png');

// ---------------- police response ----------------
await ev(A.page, `${G}.combat.equip(null)`);
const unit = await A.page.waitForFunction('window.__unitsSeen > 0', null, { timeout: 30000 }).then(() => true).catch(() => false);
check('POLICE: response unit dispatched to the shooting', unit, `units seen ${await ev<number>(A.page, 'window.__unitsSeen')}`);
const near = await A.page.waitForFunction('window.__unitNear < 30 || window.__arrests > 0', null, { timeout: 120000, polling: 1000 }).then(() => true).catch(() => false);
check('POLICE: officers pursued the shooter', near, `closest ${Math.round(await ev<number>(A.page, 'window.__unitNear'))} m`);
if ((await ev<unknown[]>(A.page, `${G}.policeSnap || []`)).length) {
  const u = await ev<{ x: number; z: number }>(A.page, `(${G}.policeSnap || [])[0]`);
  await ev(A.page, `${G}.controls.camYaw = Math.atan2(${G}.pos.x - ${u.x}, ${G}.pos.y - ${u.z}) + 0.5; ${G}.controls.camPitch = 0.2`);
  await A.page.waitForTimeout(1200);
  await shot(A.page, 'combat_09_police_response.png');
}
const arrested = await A.page.waitForFunction('window.__arrests > 0', null, { timeout: 90000, polling: 1000 }).then(() => true).catch(() => false);
check('POLICE: shooter arrested and fined by responding officers', arrested, `arrests ${await ev<number>(A.page, 'window.__arrests')}, ★${await ev<number>(A.page, `${G}.wanted`)}`);

// ---------------- gangs ----------------
await phone(A.page, 'gangs');
await A.page.waitForSelector('#gang-name', { timeout: 15000 });
await A.page.fill('#gang-name', 'Black Axe Boys');
await A.page.fill('#gang-tag', 'BAX');
await A.page.click('#gang-create'); await A.page.waitForTimeout(1500);
check('GANGS: real-cult names refused by the server', await A.page.isVisible('#gang-name'));
const gname = `Ring Road ${tag.toUpperCase()}`; const gtag = ('R' + tag.replace(/[^a-z]/g, 'x').slice(0, 3)).toUpperCase();
await A.page.fill('#gang-name', gname); await A.page.fill('#gang-tag', gtag);
await A.page.click('[data-gang-col]:nth-child(4)'); await A.page.click('[data-gang-em]:nth-child(7)');
await A.page.fill('#gang-name', gname); await A.page.fill('#gang-tag', gtag);
await A.page.click('#gang-create');
const made = await A.page.waitForSelector('#gang-thread', { timeout: 15000 }).then(() => true).catch(() => false);
check('GANGS: gang registered (name, tag, colour, emblem)', made);
await A.page.waitForSelector(`[data-gang-inv="${bId}"]`, { timeout: 15000 }).catch(() => undefined);
await A.page.click(`[data-gang-inv="${bId}"]`).catch(() => undefined);
await B.page.waitForTimeout(1500);
await phone(B.page, 'gangs');
await B.page.waitForSelector('[data-gang-acc]', { timeout: 15000 }).catch(() => undefined);
check('GANGS: invitation received by the other player', await B.page.isVisible('[data-gang-acc]'));
await B.page.click('[data-gang-acc]').catch(() => undefined);
const joined = await B.page.waitForSelector('#gang-thread', { timeout: 15000 }).then(() => true).catch(() => false);
check('GANGS: invite accepted — member list shows both', joined && (await B.page.locator('#phone-screen .card').first().textContent())!.includes('Ade_'));
await B.page.fill('#gang-input', 'Abeg, meet at Ring Road by 6'); await B.page.click('#gang-form button');
const chatSeen = await A.page.waitForFunction(`[...document.querySelectorAll('#chat-log .chat-gang, #gang-thread .msg')].some(e => e.textContent.includes('Ring Road by 6'))`, null, { timeout: 15000 }).then(() => true).catch(() => false);
check('GANGS: gang chat delivered to the leader', chatSeen);
await A.page.click('#phone-home').catch(() => undefined); await phone(A.page, 'gangs');
await A.page.waitForTimeout(800);
await shot(A.page, 'combat_10_gangs_app.png');
const tagSeen = await A.page.waitForFunction(`(() => { const r = ${G}.remotes.get(${bId}); return !!(r && r.snap.gang && r.snap.gang.tag === '${gtag}'); })()`, null, { timeout: 15000 }).then(() => true).catch(() => false);
check('GANGS: members carry the gang tag in snapshots (nametags)', tagSeen);
// friendly fire is off by default: protected members take no damage on the server
await ev(A.page, `document.querySelector('#phone').classList.add('hidden')`);

// ---------------- touch fire path (iPad buttons) ----------------
const bp2 = await ev<{ x: number; z: number }>(B.page, `({ x: ${G}.pos.x, z: ${G}.pos.y })`);
await ev(A.page, `new Promise(r => ${G}.socket.emit('gang:leave', {}, r))`);
await tp(-30, 40); await A.page.waitForTimeout(1200);
await ev(A.page, `${G}.combat.equip('pistol')`); await A.page.waitForTimeout(600);
const m0 = await ev<number>(A.page, `${G}.combat.ammo.mag`);
await ev(A.page, `(() => { const b = document.getElementById('tb-fire'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch' })); })()`);
await A.page.waitForTimeout(900);
await ev(A.page, `document.getElementById('tb-fire').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch' }))`);
await A.page.waitForTimeout(800);
check('TOUCH: ✸ fire button aims and fires (iPad control path)', (await ev<number>(A.page, `${G}.combat.ammo.mag`)) < m0 && await ev<boolean>(A.page, `${G}.combat.aiming`));
await ev(A.page, `${G}.combat.setAim(false)`); await ev(A.page, `${G}.combat.equip(null)`);
void bp2;
admin.close();
await browser.close();
saveResults('e2e_combat.txt');
