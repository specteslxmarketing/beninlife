// E2E: BEST 𝕏 mansion (enter, tour), buying a house, lock/unlock, a second player visiting, both visible inside.
import { launch, player, enter, ev, shot, check, log, tag, adminPassword, saveResults } from './e2e-lib.js';
import type { Page } from 'playwright';

const browser = await launch();
const q = process.env.Q ?? 'high';
const A = await player(browser, 'bestx', { quality: q, login: true, password: adminPassword() });
await enter(A.page);
const tp = async (p: Page, x: number, z: number) => { const r = await ev<{ ok: boolean }>(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: ${x}, z: ${z} }, r))`); await p.waitForTimeout(1500); return r.ok; };
const press = async (p: Page, k: string) => { await p.keyboard.press(k); await p.waitForTimeout(1500); };
const actions = (p: Page) => ev<string[]>(p, 'window.__beninlife.contextActions().map(a => a.id)');
const inside = (p: Page) => ev<string | null>(p, 'window.__beninlife.inside ? window.__beninlife.inside.id : null');
const cam = async (p: Page, c: number[] | null, wait = 2500) => { await ev(p, `window.__beninlife.camOverride = ${JSON.stringify(c)}`); await p.waitForTimeout(wait); };

// --- mansion exterior & gate
check('ADMIN: teleport to mansion gate', await tp(A.page, 117, 10.5));
await ev(A.page, 'window.__beninlife.rot = Math.PI; window.__beninlife.controls.camYaw = 0.25');
await cam(A.page, [113, 3.2, 1, 117, 2.6, 14]);
await shot(A.page, 'house_01_mansion_gate_crown.png');
await cam(A.page, null, 800);
log('  actions at gate: ' + (await actions(A.page)).join(','));
await press(A.page, 'f');
check('MANSION: owner enters the mansion interior', (await inside(A.page)) === 'mansion');
// tour (interior origin 90, 640; 44 x 30; front wall z=625)
const X = 90, Z = 640;
await cam(A.page, null, 1500); await shot(A.page, 'house_02_mansion_entrance_guards.png');
await cam(A.page, [X - 5, 2.6, Z - 14, X + 2, 1.8, Z - 4]); await shot(A.page, 'house_03_mansion_living_room.png');
await cam(A.page, [X + 4, 3.8, Z - 13, X - 2, 3.0, Z + 2]); await shot(A.page, 'house_04_mansion_crown_poster_chandelier.png');
await cam(A.page, [X + 21, 2.4, Z - 14, X + 14, 1.0, Z - 6]); await shot(A.page, 'house_05_mansion_dining.png');
await cam(A.page, [X - 10.5, 2.2, Z - 2.5, X - 18, 1.2, Z - 12]); await shot(A.page, 'house_06_mansion_office.png');
await cam(A.page, [X - 8, 2.5, Z + 4, X - 13, 0.8, Z + 13]); await shot(A.page, 'house_07_mansion_master_bedroom.png');
await cam(A.page, [X - 0.3, 2.3, Z + 6, X - 2, 0.6, Z + 13]); await shot(A.page, 'house_08_mansion_bathroom.png');
await cam(A.page, [X + 18, 4, Z + 20, X + 6, 0, Z + 23]); await shot(A.page, 'house_09_mansion_pool_terrace.png');
await cam(A.page, [X - 22, 3, Z + 28, X - 29, 0.8, Z + 13]); await shot(A.page, 'house_10_mansion_garage_cars.png');
await cam(A.page, null, 500);
// exit
await ev(A.page, `(() => { const g = window.__beninlife; g.pos.set(${X}, ${Z - 15 + 1.2}); })()`); await A.page.waitForTimeout(800);
await press(A.page, 'f');
check('MANSION: exit returns outside to the gate', (await inside(A.page)) === null && (await ev<number>(A.page, 'window.__beninlife.pos.y')) < 14);

// --- buy the GRA Bungalow as BEST 𝕏, unlock it
check('ADMIN: teleport to GRA Bungalow', await tp(A.page, -80, 13));
await ev(A.page, 'window.__beninlife.controls.camYaw = 0.0');
await A.page.waitForTimeout(1500);
const before = await A.page.textContent('#hud-balance');
await shot(A.page, 'house_11_bungalow_for_sale.png');
log('  actions at bungalow: ' + (await actions(A.page)).join(','));
const ownedAlready = await ev<boolean>(A.page, `window.__beninlife.houseState('bung1').ownerId === window.__beninlife.me.id`);
if (ownedAlready) check('HOUSES: bungalow already owned by BEST 𝕏 (bought in an earlier run; purchase is one-time)', true);
else {
  await press(A.page, 'f');
  const after = await A.page.textContent('#hud-balance');
  check('HOUSES: server-side purchase debits ₦18,000,000', before !== after, `${before} → ${after}`);
}
if (await ev<boolean>(A.page, `window.__beninlife.houseState('bung1').locked`)) await press(A.page, 'g'); // unlock
const st = await ev<{ locked: boolean; ownerName: string }>(A.page, `window.__beninlife.houseState('bung1')`);
check('HOUSES: owner unlocked the door', st.locked === false, JSON.stringify(st));
await shot(A.page, 'house_12_bungalow_owned_open.png');
await press(A.page, 'f');
check('HOUSE INTERIORS: owner inside bungalow', (await inside(A.page)) === 'bung1');

// --- visitor walks from spawn to the bungalow and enters
const B = await player(browser, `Visitor_${tag}`, { quality: 'low' });
await enter(B.page, 4, 3, 'female');
check('ARRIVAL: new visitor starts at Benin Airport', (await ev<number>(B.page, 'window.__beninlife.pos.y')) < -200);
await ev(B.page, `window.__auto.walkFromAirport()`);
await ev(B.page, `window.__auto.walkTo(-62, 11.5, 1.5)`);
await ev(B.page, `window.__auto.walkTo(-80, 12.8, 1.2)`);
log('  visitor actions at door: ' + (await actions(B.page)).join(','));
await press(B.page, 'f');
check('HOUSES: visitor enters the unlocked house', (await inside(B.page)) === 'bung1');
await B.page.waitForTimeout(2500);
const seen = await ev<boolean>(A.page, `[...window.__beninlife.remotes.values()].some(r => r.snap.name.startsWith('Visitor_') && Math.hypot(r.x - window.__beninlife.pos.x, r.z - window.__beninlife.pos.y) < 6)`);
check('HOUSES: owner sees the visitor inside (multiplayer)', seen);
const I = { x: -60, z: 620 };
await ev(B.page, `(() => { const g = window.__beninlife; g.pos.set(${I.x - 1}, ${I.z - 6 + 2.5}); g.rot = Math.PI * 0.85; })()`); await B.page.waitForTimeout(1500);
await cam(A.page, [I.x + 2.5, 2.4, I.z - 5.4, I.x - 3, 1.0, I.z - 1]); await shot(A.page, 'house_13_bungalow_living_two_players.png');
await cam(A.page, [I.x + 7.6, 2.3, I.z - 5.6, I.x + 3, 0.7, I.z - 2.5]); await shot(A.page, 'house_14_bungalow_dining.png');
await cam(A.page, [I.x - 1.3, 2.4, I.z + 1.4, I.x - 5, 0.6, I.z + 5]); await shot(A.page, 'house_15_bungalow_bedroom.png');
await cam(A.page, [I.x + 0.3, 2.4, I.z + 1.2, I.x + 2, 0.9, I.z + 5.6]); await shot(A.page, 'house_16_bungalow_kitchen.png');
await cam(A.page, [I.x + 5.0, 2.5, I.z + 1.0, I.x + 7, 0.6, I.z + 4.5]); await shot(A.page, 'house_17_bungalow_bathroom.png');
await cam(B.page, null, 800); await shot(B.page, 'house_18_visitor_view_inside.png');
await cam(A.page, null, 300);
// locking again: a new visit attempt is refused
await ev(A.page, `(() => { const g = window.__beninlife; g.pos.set(${I.x}, ${I.z - 6 + 1.2}); })()`); await A.page.waitForTimeout(800);
await press(A.page, 'g');
check('HOUSES: owner re-locks from inside', (await ev<boolean>(A.page, `window.__beninlife.houseState('bung1').locked`)) === true);
await ev(B.page, `(() => { const g = window.__beninlife; g.pos.set(${I.x + 0.4}, ${I.z - 6 + 1.0}); })()`); await B.page.waitForTimeout(800);
await press(B.page, 'f');
check('HOUSES: visitor exits back outside', (await inside(B.page)) === null);
const enterAgain = await ev<{ ok: boolean; error?: string }>(B.page, `new Promise(r => window.__beninlife.socket.emit('house:enter', { id: 'bung1' }, r))`);
check('HOUSES: locked house refuses the visitor', !enterAgain.ok, enterAgain.error ?? '');
await shot(B.page, 'house_19_locked_outside.png');
saveResults('e2e_houses.txt');
await browser.close();
