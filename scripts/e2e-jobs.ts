// E2E: jobs — car-wash attendant shift, mechanic shift, taxi fare (real driving with the autopilot keyboard driver).
// Uses the BEST 𝕏 admin account only for the admin teleport to reach each job site quickly; all job rules are the same for everyone.
import { launch, player, enter, ev, shot, check, log, adminPassword, saveResults } from './e2e-lib.js';
import { STATION_JOBS, stationSpot } from '../shared/constants.js';
import type { Page } from 'playwright';

const browser = await launch();
const A = await player(browser, 'bestx', { quality: process.env.Q ?? 'high', login: true, password: adminPassword() });
await enter(A.page);
const p = A.page;
const tp = async (x: number, z: number) => { const r = await ev<{ ok: boolean }>(p, `new Promise(r => window.__beninlife.socket.emit('admin:teleport', { x: ${x}, z: ${z} }, r))`); await p.waitForTimeout(1500); return r.ok; };
const actions = () => ev<string[]>(p, 'window.__beninlife.contextActions().map(a => a.id)');
const balance = () => ev<number>(p, 'window.__beninlife.balance');
const press = async (k: string, ms = 1200) => { await p.keyboard.press(k); await p.waitForTimeout(ms); };
const waitFor = async (js: string, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev<boolean>(p, `(() => { try { return !!(${js}); } catch { return false; } })()`)) return true; await p.waitForTimeout(300); } return false; };

async function shift(id: 'carwash' | 'mechanic', n: number) {
  const j = STATION_JOBS[id];
  check(`JOBS: teleport to ${j.place}`, await tp(j.start.x, j.start.z + 0.5));
  log('  actions at the JOBS board: ' + (await actions()).join(','));
  await press('f', 1000);
  check(`JOBS: ${j.name} shift started`, await waitFor(`!!window.__beninlife.jobs.station && window.__beninlife.jobs.station.id === '${id}'`, 30000));
  await waitFor('!!window.__beninlife.jobs.actions && window.__beninlife.contextActions().length >= 0 && performance.now() > window.__beninlife.jobs.station.readyAt');
  await ev(p, `window.__beninlife.camOverride = [${j.car.x + 6}, 3.6, ${j.car.z + 7}, ${j.car.x}, 0.8, ${j.car.z}]`); await p.waitForTimeout(2000);
  await shot(p, `jobs_0${n}_${id}_customer_car.png`); await ev(p, 'window.__beninlife.camOverride = null');
  const before = await balance();
  for (let i = 0; i < j.spots.length; i++) {
    const sp = stationSpot(j, i);
    // switching sides of the customer's car: go round the bonnet instead of walking into the car
    if (i > 0 && Math.sign(j.spots[i].dx) !== Math.sign(j.spots[i - 1].dx) && j.spots[i].dx !== 0 && j.spots[i - 1].dx !== 0) {
      const c = Math.cos(j.car.rot), n = Math.sin(j.car.rot), bz = 3.6;
      for (const dx of [Math.sign(j.spots[i - 1].dx) * 1.2, Math.sign(j.spots[i].dx) * 1.2]) await ev(p, `window.__auto.walkTo(${j.car.x + dx * c + bz * n}, ${j.car.z - dx * n + bz * c}, 0.6, 60000)`);
    }
    const ok = await ev<boolean>(p, `window.__auto.walkTo(${sp.x}, ${sp.z}, 0.6, 120000)`);
    if (!ok) log(`  could not reach spot ${i}`);
    const acts = await actions();
    for (let tries = 0; tries < 3; tries++) { // a key press can be missed while the page is busy: retry until the server marks the step done
      if (tries) { log(`  retrying step ${i + 1}`); await ev(p, `window.__auto.walkTo(${sp.x}, ${sp.z}, 0.6, 30000)`); }
      await press('f', 400);
      if (i === 1 && !tries) { await p.waitForTimeout(900); await shot(p, `jobs_0${n + 1}_${id}_working.png`); }
      await waitFor('!window.__beninlife.jobs.working', 60000); await p.waitForTimeout(1200);
      if ((await balance()) > before || await ev<boolean>(p, `!window.__beninlife.jobs.station || !!window.__beninlife.jobs.station.done[${i}]`)) break; // paid = car finished
    }
    log(`  step ${i + 1} (${j.spots[i].label}) actions=[${acts.join(',')}] done=${JSON.stringify(await ev(p, 'window.__beninlife.jobs.station && window.__beninlife.jobs.station.done'))}`);
  }
  await p.waitForTimeout(1500);
  const after = await balance();
  check(`JOBS: ${j.name} — server paid ${j.pay} for a finished car`, after - before === j.pay, `${before} → ${after}`);
  await shot(p, `jobs_0${n + 2}_${id}_paid.png`);
  await tp(j.start.x, j.start.z + 0.5); await press('g', 1500);
  check(`JOBS: ${j.name} shift ended`, await ev<boolean>(p, '!window.__beninlife.jobs.station'));
}
await shift('carwash', 1);
await shift('mechanic', 4);

// ---- taxi: get into the active car (delivered at the mansion), start a shift, drive to the passenger, then to the destination
// re-deliver the active car home first (a previous run may have left it anywhere in town)
const cl = await ev<{ active: { id: number | null } }>(p, `new Promise(r => window.__beninlife.socket.emit('car:list', {}, r))`);
if (cl.active?.id) { await ev(p, `new Promise(r => window.__beninlife.socket.emit('car:use', { id: ${cl.active.id} }, r))`); await p.waitForTimeout(2000); }
const car = await ev<{ x: number; z: number }>(p, '({ x: window.__beninlife.carState.x, z: window.__beninlife.carState.z })');
await tp(car.x - 2.5, car.z);
await press('e', 1500);
check('TAXI: in the car', await ev<boolean>(p, 'window.__beninlife.inCar'));
await ev(p, 'window.__beninlife.jobs.startTaxi()'); await p.waitForTimeout(1500);
const t = await ev<{ passenger: string; pickup: { name: string; x: number; z: number } } | null>(p, 'window.__beninlife.jobs.taxi');
check('TAXI: server assigned a passenger', !!t, t ? `${t.passenger} at ${t.pickup.name}` : '');
const driveTo = async (pg: Page, x: number, z: number) => {
  const rt = await ev<number[][]>(pg, `window.__auto.route(window.__beninlife.carState.x, window.__beninlife.carState.z, ${x}, ${z})`);
  return (await ev<{ ok: boolean }>(pg, `window.__auto.drive(${JSON.stringify(rt)}, 12, 400000)`)).ok;
};
if (t) {
  log('  driving to pickup: ' + (await driveTo(p, t.pickup.x, t.pickup.z)) + ` (from the mansion to ${t.pickup.name})`);
  await p.waitForTimeout(800);
  await ev(p, `window.__beninlife.controls.camYaw = Math.atan2(window.__beninlife.carState.x - ${t.pickup.x}, window.__beninlife.carState.z - ${t.pickup.z})`); await p.waitForTimeout(1500);
  await shot(p, 'jobs_07_taxi_passenger_waving.png');
  log('  actions at pickup: ' + (await actions()).join(','));
  await press('f', 1500);
  const r = await ev<{ stage: string; dest?: { name: string; x: number; z: number }; fare?: number } | null>(p, 'window.__beninlife.jobs.taxi');
  check('TAXI: passenger picked up, destination + fare from the server', r?.stage === 'riding', r ? `${r.dest?.name} fare ${r.fare}` : '');
  if (r?.dest) {
    const before = await balance();
    log('  driving to destination: ' + (await driveTo(p, r.dest.x, r.dest.z)));
    log('  actions at destination: ' + (await actions()).join(','));
    await press('f', 2000);
    const after = await balance();
    check('TAXI: fare paid by the server on drop-off', after - before >= (r.fare ?? 1), `${before} → ${after}`);
    await shot(p, 'jobs_08_taxi_fare_paid.png');
  }
  await ev(p, 'window.__beninlife.jobs.taxi ? window.__beninlife.jobs.stopTaxi() : null');
}
saveResults('e2e_jobs.txt');
await browser.close();
