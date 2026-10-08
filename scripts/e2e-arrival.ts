// E2E: playable arrival — board the cabin, walk to seat 8B, sit by the advisor (intro dialogue), landing cutscene,
// taxi, stand up, walk off through the front door, appear in the Benin Airport arrivals hall (server-placed).
import { launch, player, ev, shot, check, log, tag, saveResults } from './e2e-lib.js';
import type { Page } from 'playwright';

const browser = await launch();
const q = process.env.Q ?? 'high';
const A = await player(browser, `Arrival_${tag}`, { quality: q });
const p = A.page;
await p.waitForSelector('#creator:not(.hidden)', { timeout: 120000 });
await p.click('#cr-body button[data-b="male"]'); await p.click('#cr-skin button[data-i="4"]'); await p.click('#cr-outfit button[data-i="3"]');
await p.click('#cr-save');
await p.waitForSelector('#intro:not(.hidden)', { timeout: 60000 });
const phase = (pg: Page) => ev<string>(pg, 'window.__beninlife.arrival ? window.__beninlife.arrival.phase : "none"');
const waitPhase = async (ph: string, ms = 240000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((await phase(p)) === ph) return true; await p.waitForTimeout(300); } return false; };
const waitLine = async (sub: string, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await p.textContent('#intro-text'); if (t && t.includes(sub)) return true; await p.waitForTimeout(250); } return false; };
const actions = () => ev<string[]>(p, 'window.__beninlife.contextActions().map(a => a.id)');

check('ARRIVAL: starts boarding the plane cabin', (await phase(p)) === 'board');
await p.waitForTimeout(2500);
await shot(p, 'arrival_01_boarding_cabin.png');
const cabinCam = async (c: number[], name: string) => { await ev(p, `window.__beninlife.camOverride = ${JSON.stringify(c)}`); await p.waitForTimeout(1800); await shot(p, name); await ev(p, 'window.__beninlife.camOverride = null'); };
// wide cabin views (cabin origin 0,-1200)
await cabinCam([0.0, 1.75, -1209.2, 0, 1.2, -1195], 'arrival_02_cabin_aisle_wide.png');
await cabinCam([-0.2, 1.6, -1195, -1.6, 1.0, -1203], 'arrival_03_cabin_rows_windows.png');
// walk down the aisle to row 8
const ok = await ev<boolean>(p, `window.__auto.walkTo(0, -1200 + (-8.4 + 7 * 0.81), 0.5, 240000)`);
check('ARRIVAL: walked down the aisle to row 8 (real movement + cabin collisions)', ok);
log('  actions at row 8: ' + (await actions()).join(','));
await shot(p, 'arrival_04_at_row_8.png');
await p.keyboard.press('f');
check('ARRIVAL: took seat 8B next to the advisor', await waitPhase('seated', 5000));
check('ARRIVAL: advisor speaks "This is Benin City. You should be very careful."', await waitLine('You should be very careful'));
await p.waitForTimeout(1200); await shot(p, 'arrival_05_advisor_careful.png');
check('ARRIVAL: advisor speaks the BEST 𝕏 line', await waitLine('most respected man in Edo State'));
await p.waitForTimeout(1200); await shot(p, 'arrival_06_advisor_bestx_line.png');
check('ARRIVAL: "You need to work to earn money."', await waitLine('You need to work to earn money'));
check('ARRIVAL: "... don\'t join cults."', await waitLine("don't join cults"));
await p.waitForTimeout(1000); await shot(p, 'arrival_07_advisor_cults.png');
check('ARRIVAL: fictional-world note shown', await waitLine('Fictional game world'));
await p.waitForTimeout(800); await shot(p, 'arrival_08_window_fictional_note.png');
check('ARRIVAL: landing cutscene at Benin Airport runway', await waitPhase('landing'));
await p.waitForTimeout(3500); await shot(p, 'arrival_09_landing_approach.png');
await p.waitForFunction('window.__beninlife.arrival && window.__beninlife.arrival.phaseT > 7.6', null, { timeout: 120000 }).catch(() => {});
await shot(p, 'arrival_10_touchdown.png');
check('ARRIVAL: taxi to the gate', await waitPhase('taxi'));
await p.waitForTimeout(1500); await shot(p, 'arrival_11_taxi_window.png');
check('ARRIVAL: seatbelt sign off, ready to deplane', await waitPhase('deplane'));
log('  actions after landing: ' + (await actions()).join(','));
await p.keyboard.press('f'); await p.waitForTimeout(800);
check('ARRIVAL: stood up into the aisle', await ev<boolean>(p, `window.__beninlife.player.pose === 'stand'`));
const ok2 = await ev<boolean>(p, `(async () => { await window.__auto.walkTo(0, -1210.5, 0.5, 240000); return window.__auto.walkTo(-1.5, -1211.6, 0.4, 30000); })()`);
check('ARRIVAL: walked to the open front door', ok2);
await shot(p, 'arrival_12_front_door_open.png');
log('  actions at door: ' + (await actions()).join(','));
await p.keyboard.press('f');
await p.waitForSelector('#intro.hidden', { state: 'attached', timeout: 20000 }).catch(() => {});
await p.waitForTimeout(2500);
const pos = await ev<{ x: number; z: number; mode: string }>(p, '({ x: window.__beninlife.pos.x, z: window.__beninlife.pos.y, mode: window.__beninlife.mode })');
check('ARRIVAL: walked off into the Benin Airport arrivals hall (server-placed)', pos.mode === 'play' && pos.z < -230 && pos.z > -241, JSON.stringify(pos));
await ev(p, 'window.__beninlife.controls.camYaw = Math.PI + 0.3');
await p.waitForTimeout(1500); await shot(p, 'arrival_13_arrivals_hall.png');
await cabinCam([-6, 3.2, -219, 6, 1.4, -234], 'arrival_14_arrivals_hall_wide.png');
await cabinCam([14, 6, -190, -2, 5, -226], 'arrival_15_benin_airport_terminal.png');
await cabinCam([60, 12, -246, 24, 3, -268], 'arrival_16_apron_parked_airliner.png');
// walk out of the terminal toward the city
const out = await ev<boolean>(p, `(async () => { for (const [x, z] of [[-10, -219], [-10, -212], [-4, -200]]) if (!(await window.__auto.walkTo(x, z, 1.6, 240000))) return false; return true; })()`);
check('ARRIVAL: walked out the front doors onto the airport road', out);
await ev(p, 'window.__beninlife.controls.camYaw = 0.2'); await p.waitForTimeout(1500);
await shot(p, 'arrival_17_leaving_airport_road.png');
saveResults('e2e_arrival.txt');
await browser.close();
