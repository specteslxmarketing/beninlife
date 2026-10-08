// E2E: intercity travel. A funded test player checks in at the Benin terminal, pays the Ivie Air fare (server-side), watches the flight
// cutscene, explores Ikate Waterside (Lagos), then takes the Edo Line bus home from Eko Motor Park.
// Admin teleport is used only to stand at the desks quickly; the trips themselves go through the real `travel:go` flow.
import { launch, player, enter, ev, shot, check, log, saveResults, tag, adminSocket } from './e2e-lib.js';
import { TRAVEL, LAGOS, LAGOS_MOTOR_PARK as LMP, LAGOS_AIRPORT as LA, BENIN_MOTOR_PARK as BMP } from '../shared/constants.js';

const browser = await launch();
// a separate test traveller (BEST 𝕏's account is never charged by tests); the admin socket funds and places it
const A = await player(browser, `Tolu_${tag}`, { quality: process.env.Q ?? 'high' });
await enter(A.page);
const p = A.page;
const admin = await adminSocket();
const myId = await ev<number>(p, 'window.__beninlife.me.id');
const g = await admin.emit('admin:grant', { id: myId, amount: TRAVEL.flight.price + TRAVEL.bus.price + 10_000 });
check('TRAVEL: test traveller funded (admin grant, ledger entry)', g.ok, g.error);
await p.waitForFunction(`window.__beninlife.balance >= ${TRAVEL.flight.price + TRAVEL.bus.price}`, null, { timeout: 15000 }).catch(() => undefined);
const tp = async (x: number, z: number) => { const r = await admin.emit('admin:teleport', { id: myId, x, z }); await p.waitForTimeout(1500); return r.ok; };
const balance = () => ev<number>(p, 'window.__beninlife.balance');
const city = () => ev<string>(p, 'window.__beninlife.city');
const acts = () => ev<string[]>(p, 'window.__beninlife.contextActions().map(a => a.id)');
const cam = (a: number[]) => ev(p, `window.__beninlife.camOverride = ${JSON.stringify(a)}`);

const start = await balance();
log(`  traveller balance ₦${start}`);
check('TRAVEL: enough money for both fares', start >= TRAVEL.flight.price + TRAVEL.bus.price, String(start));

// 1) Benin terminal → Ivie Air check-in
const fd = TRAVEL.flight.desk.benin;
check('TRAVEL: at the Ivie Air counter (Benin terminal)', await tp(fd.x, fd.z + 0.4));
check('TRAVEL: "Fly to Lagos" offered at the counter', (await acts()).includes('travel:flight'));
await cam([fd.x + 4, 2.4, fd.z + 5, fd.x, 1.4, fd.z - 2]); await p.waitForTimeout(2500); await shot(p, 'travel_01_benin_checkin.png');
const wrong = await ev<{ ok: boolean; error?: string }>(p, `new Promise(r => window.__beninlife.socket.emit('travel:go', { mode: 'bus' }, r))`);
check('TRAVEL: server refuses a bus ticket at the airport counter', !wrong.ok, wrong.error);
await ev(p, 'window.__beninlife.camOverride = null');
void ev(p, `window.__beninlife.doContextAction('travel:flight')`);
await p.waitForTimeout(3500);
check('TRAVEL: flight cutscene playing', await ev<boolean>(p, '!!document.querySelector("#travel-fx")'));
await shot(p, 'travel_02_flight_cutscene.png');
check('TRAVEL: fare ₦95,000 debited by the server', start - (await balance()) === TRAVEL.flight.price, `${start} → ${await balance()}`);
await p.waitForTimeout(TRAVEL.flight.cutsceneMs - 2500);
await p.waitForFunction('!document.querySelector("#travel-fx") && window.__beninlife.controls.enabled', null, { timeout: 15000 }).catch(() => {});
const after = await ev<[boolean, boolean]>(p, '[!document.querySelector("#travel-fx"), window.__beninlife.controls.enabled]');
check('TRAVEL: cutscene finished, controls back', after[0] && after[1], JSON.stringify(after));
check('TRAVEL: now in Lagos', (await city()) === 'lagos');
const pos = await ev<{ x: number; y: number }>(p, '({ x: window.__beninlife.pos.x, y: window.__beninlife.pos.y })');
check('TRAVEL: arrived at the Lagos terminal kerb', Math.hypot(pos.x - TRAVEL.flight.arrive.lagos.x, pos.y - TRAVEL.flight.arrive.lagos.z) < 3, JSON.stringify(pos));
await cam([LA.x - 34, 10, LA.z + 42, LA.x - 2, 4, LA.z]); await p.waitForTimeout(3500); await shot(p, 'travel_03_lagos_airport.png');

// 2) look around Ikate Waterside
const X = (x: number) => LAGOS.x + x;
check('TRAVEL: promenade', await tp(X(-6), 44));
await cam([X(-30), 3.2, 66, X(30), 14, 0]); await p.waitForTimeout(3500); await shot(p, 'travel_04_lagos_beach_towers.png');
await cam([X(-70), 22, 120, X(40), 8, 10]); await p.waitForTimeout(3500); await shot(p, 'travel_05_lagos_skyline_from_sea.png');
await cam([X(-46), 2.6, 32.25, X(60), 3, 30]); await p.waitForTimeout(3500); await shot(p, 'travel_06_lagos_expressway.png');

// 3) Eko Motor Park → bus back to Benin
const bd = TRAVEL.bus.desk.lagos;
check('TRAVEL: at the Eko Motor Park ticket booth', await tp(bd.x + 0.4, bd.z));
check('TRAVEL: "Bus to Benin City" offered', (await acts()).includes('travel:bus'));
await cam([LMP.x + 26, 7, LMP.z + 26, LMP.x - 2, 1.5, LMP.z - 2]); await p.waitForTimeout(3500); await shot(p, 'travel_07_eko_motor_park.png');
await ev(p, 'window.__beninlife.camOverride = null');
const mid = await balance();
void ev(p, `window.__beninlife.doContextAction('travel:bus')`);
await p.waitForTimeout(4000); await shot(p, 'travel_08_bus_cutscene.png');
check('TRAVEL: bus fare ₦18,000 debited', mid - (await balance()) === TRAVEL.bus.price, `${mid} → ${await balance()}`);
await p.waitForTimeout(TRAVEL.bus.cutsceneMs - 2500);
check('TRAVEL: back in Benin City', (await city()) === 'benin');
const pos2 = await ev<{ x: number; y: number }>(p, '({ x: window.__beninlife.pos.x, y: window.__beninlife.pos.y })');
check('TRAVEL: arrived at Benin Motor Park', Math.hypot(pos2.x - TRAVEL.bus.arrive.benin.x, pos2.y - TRAVEL.bus.arrive.benin.z) < 3, JSON.stringify(pos2));
await cam([BMP.x + 30, 8, BMP.z + 22, BMP.x, 1.5, BMP.z]); await p.waitForTimeout(3500); await shot(p, 'travel_09_benin_motor_park.png');
await ev(p, 'window.__beninlife.camOverride = null');
saveResults('e2e_travel.txt');
admin.close();
await browser.close();
