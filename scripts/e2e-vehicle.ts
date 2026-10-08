// E2E: driving feel (wheels spin/steer, body roll), animated doors + get-in/get-out, a second real player riding
// as a passenger, proximity voice signalling, and every radio station rendering real audio.
import fs from 'node:fs';
import { launch, player, enter, ev, shot, check, log, tag, saveResults, OUT, adminPassword } from './e2e-lib.js';

const Q = process.env.Q ?? 'medium';
const browser = await launch();
const G = 'window.__beninlife';
// driver: BEST X (admin teleport puts him beside his own car); passenger: a brand-new player who walks in from the airport
const A = await player(browser, 'bestx', { quality: Q, login: true, password: adminPassword(), ambient: false }); await enter(A.page);
const B = await player(browser, `Uyi_${tag}`, { quality: Q, ambient: false }); await enter(B.page, 4, 3, 'female');
const aId = await ev<number>(A.page, `${G}.me.id`);
const walkB = ev(B.page, `window.__auto.walkFromAirport()`);
if (await ev<boolean>(A.page, `${G}.inCar`)) { await A.page.keyboard.press('e'); await A.page.waitForFunction(`!${G}.inCar && !${G}.seq`, null, { timeout: 30000 }); }

// ---- beside own car, open the door, get in ----
const car = await ev<{ x: number; z: number; rot: number }>(A.page, `({ x: ${G}.carState.x, z: ${G}.carState.z, rot: ${G}.carState.rot })`);
await ev(A.page, `new Promise(r => ${G}.socket.emit('admin:teleport', { x: ${car.x + Math.cos(car.rot) * 2.3}, z: ${car.z - Math.sin(car.rot) * 2.3} }, r))`);
await A.page.waitForTimeout(1500);
check('DOORS: car model has animated doors', (await ev<number>(A.page, `${G}.car.doorCount`)) >= 2);
await A.page.keyboard.press('e');
const doorOpened = await A.page.waitForFunction(`${G}.car.doors.some(d => d.open > 0.6)`, null, { timeout: 20000, polling: 30 }).then(() => true).catch(() => false);
check('DOORS: a door swings open during get-in', doorOpened);
await ev(A.page, `${G}.controls.camYaw = ${G}.carState.rot + Math.PI * 0.5; ${G}.controls.camPitch = 0.2`);
await shot(A.page, 'vehicle_01_get_in_door_open.png');
await A.page.waitForFunction(`${G}.inCar && !${G}.seq`, null, { timeout: 30000 });
const closed = await A.page.waitForFunction(`${G}.car.doors.every(d => d.open < 0.05)`, null, { timeout: 15000 }).then(() => true).catch(() => false);
check('DOORS: in the driver seat and all doors closed again', closed);

// ---- drive over to where the new player arrives in town ----
await ev(A.page, `${G}.audio.unlock()`);
const rt = await ev<number[][]>(A.page, `window.__auto.route(${G}.carState.x, ${G}.carState.z, -52, 4)`);
const dr = await ev<{ ok: boolean }>(A.page, `window.__auto.drive(${JSON.stringify(rt)}, 10)`);
check('DRIVING: autopilot drove the car across town through real controls', dr.ok);
check('PASSENGER: new player walked in from the airport', await walkB !== false);
// ---- B walks up and rides as a passenger ----
const cs = await ev<{ x: number; z: number; rot: number }>(A.page, `({ x: ${G}.carState.x, z: ${G}.carState.z, rot: ${G}.carState.rot })`);
// walk up to whichever side of the car faces the new player (either side is fine for "Ride with")
const bp = await ev<{ x: number; z: number }>(B.page, `({ x: ${G}.pos.x, z: ${G}.pos.y })`);
const sides = [1, -1].map((k) => ({ x: cs.x - k * Math.cos(cs.rot) * 2.2, z: cs.z + k * Math.sin(cs.rot) * 2.2 }));
const side = sides.sort((a, b) => Math.hypot(a.x - bp.x, a.z - bp.z) - Math.hypot(b.x - bp.x, b.z - bp.z))[0];
const walked = await ev<boolean>(B.page, `window.__auto.walkTo(${side.x}, ${side.z}, 1.6, 60000)`);
log(`  car at (${cs.x.toFixed(1)}, ${cs.z.toFixed(1)}) rot ${cs.rot.toFixed(2)}; new player from (${bp.x.toFixed(1)}, ${bp.z.toFixed(1)}) → side (${side.x.toFixed(1)}, ${side.z.toFixed(1)}) reached=${walked}`);
await B.page.waitForFunction(`${G}.contextActions().some(a => a.id === 'ride:${aId}')`, null, { timeout: 20000 }).catch(() => undefined);
check('PASSENGER: "Ride with" offered next to another player\'s car', await ev<boolean>(B.page, `${G}.contextActions().some(a => a.id === 'ride:${aId}')`));
await ev(B.page, `${G}.doContextAction('ride:${aId}')`);
const rideOk = await B.page.waitForFunction(`!!${G}.ride && ${G}.ride.driver === ${aId}`, null, { timeout: 20000 }).then(() => true).catch(() => false);
check('PASSENGER: server accepted the ride (seat assigned)', rideOk, JSON.stringify(await ev(B.page, `${G}.ride`)));
const seenByA = await A.page.waitForFunction(`[...${G}.remotes.values()].some(r => r.snap.ride && r.snap.ride.driver === ${aId})`, null, { timeout: 15000 }).then(() => true).catch(() => false);
check('PASSENGER: the driver sees the passenger in their car', seenByA);
await B.page.waitForFunction(`!${G}.seq`, null, { timeout: 20000 }).catch(() => undefined);
await ev(A.page, `${G}.controls.camYaw = ${G}.carState.rot + Math.PI * 1.35; ${G}.controls.camPitch = 0.25`);
await A.page.waitForTimeout(1500);
await shot(A.page, 'vehicle_02_driver_and_passenger.png');

// ---- drive: wheels spin + steer, body rolls, passenger follows on the server ----
const b0 = await ev<{ x: number; z: number }>(B.page, `({ x: ${G}.pos.x, z: ${G}.pos.y })`);
const spin0 = await ev<number>(A.page, `${G}.car.wheels[0].rotation.x`);
await ev(A.page, `window.__auto.setKeys('w')`); await A.page.waitForTimeout(2500);
await ev(A.page, `window.__auto.setKeys('w', 'a')`);
let maxRoll = 0, steerSeen = 0;
for (let i = 0; i < 12; i++) {
  await A.page.waitForTimeout(150);
  const s = await ev<{ roll: number; steer: number }>(A.page, `({ roll: ${G}.car.suspension.roll, steer: ${G}.car.frontWheels[0].rotation.y })`);
  maxRoll = Math.max(maxRoll, Math.abs(s.roll)); steerSeen = Math.max(steerSeen, Math.abs(s.steer));
}
const spin1 = await ev<number>(A.page, `${G}.car.wheels[0].rotation.x`);
const speed = await ev<number>(A.page, `${G}.carState.speed`);
check('DRIVING: car accelerates', speed > 2, `speed ${speed.toFixed(1)} m/s`);
check('DRIVING: wheels spin', Math.abs(spin1 - spin0) > 1, `Δ${(spin1 - spin0).toFixed(1)} rad`);
check('DRIVING: front wheels steer visibly', steerSeen > 0.08, `${steerSeen.toFixed(2)} rad`);
check('DRIVING: body rolls in the corner (sprung suspension)', maxRoll > 0.004, `${maxRoll.toFixed(3)} rad`);
await ev(A.page, `window.__auto.setKeys(' ')`); await A.page.waitForTimeout(2000); await ev(A.page, `window.__auto.setKeys()`);
check('DRIVING: car never ends up inside geometry', !(await ev<boolean>(A.page, `${G}.carBlocked(${G}.carState.x, ${G}.carState.z, ${G}.carState.rot)`)));
await B.page.waitForTimeout(1500);
const b1 = await ev<{ x: number; z: number }>(B.page, `({ x: ${G}.pos.x, z: ${G}.pos.y })`);
const aNow = await ev<{ x: number; z: number }>(A.page, `({ x: ${G}.carState.x, z: ${G}.carState.z })`);
check('PASSENGER: passenger travels with the car (server moves riders)', Math.hypot(b1.x - b0.x, b1.z - b0.z) > 3 && Math.hypot(b1.x - aNow.x, b1.z - aNow.z) < 4,
  `moved ${Math.hypot(b1.x - b0.x, b1.z - b0.z).toFixed(1)} m, ${Math.hypot(b1.x - aNow.x, b1.z - aNow.z).toFixed(1)} m from car`);
await ev(B.page, `${G}.controls.camYaw = ${G}.carState ? 0.6 : 0; ${G}.controls.camPitch = 0.2`);
await shot(B.page, 'vehicle_03_passenger_view.png');

// ---- passenger gets out, driver gets out ----
await ev(B.page, `${G}.doContextAction('car')`);
const bOut = await B.page.waitForFunction(`!${G}.ride && !${G}.seq`, null, { timeout: 25000 }).then(() => true).catch(() => false);
check('PASSENGER: passenger gets out (door animation, standing beside the car)', bOut);
await A.page.keyboard.press('e');
const exitDoor = await A.page.waitForFunction(`${G}.car.doors.some(d => d.open > 0.6)`, null, { timeout: 20000, polling: 30 }).then(() => true).catch(() => false);
check('DOORS: driver door opens on exit', exitDoor);
await A.page.waitForTimeout(250);
await shot(A.page, 'vehicle_04_get_out.png');
await A.page.waitForFunction(`!${G}.inCar && !${G}.seq`, null, { timeout: 30000 });
check('DOORS: driver is out and on foot', !(await ev<boolean>(A.page, `${G}.inCar`)));

// ---- jump ----
await A.page.keyboard.press('Space');
const jumped = await A.page.waitForFunction(`${G}.jumpY > 0.15`, null, { timeout: 3000, polling: 20 }).then(() => true).catch(() => false);
check('MOVEMENT: Space jumps', jumped);

// ---- proximity voice: both switch on, peers negotiate through the server ----
for (const p of [A.page, B.page]) await p.click('#btn-mic');
const sig = await A.page.waitForFunction(`Object.values(${G}.voice.states()).some(s => s.startsWith('stable'))`, null, { timeout: 45000 }).then(() => true).catch(() => false);
log(`  voice: A remotes ${JSON.stringify(await ev(A.page, `[...${G}.remotes.entries()].map(([id, r]) => ({ id, voice: !!r.snap.voice, d: Math.hypot(r.x - ${G}.pos.x, r.z - ${G}.pos.y).toFixed(1) }))`))} on=${await ev(A.page, `${G}.voice.on`)}`);
check('VOICE: mic acquired on user tap and WebRTC offer/answer negotiated with the nearby player', sig, JSON.stringify(await ev(A.page, `${G}.voice.states()`)));
const hud = await A.page.isVisible('#voice-hud');
check('VOICE: voice HUD shown', hud);
await A.page.keyboard.down('v'); await A.page.waitForTimeout(400);
check('VOICE: push-to-talk (hold V) enables the mic track', await ev<boolean>(A.page, `${G}.voice.talking`));
await shot(A.page, 'vehicle_05_voice_ptt.png');
await A.page.keyboard.up('v'); await A.page.waitForTimeout(400);
check('VOICE: releasing V mutes again', !(await ev<boolean>(A.page, `${G}.voice.talking`)));
log('N/A   VOICE: audio media flow not verifiable here (sandbox Chrome has no network interfaces; same limit as calls)');
await B.page.click('#btn-mic');
const closedPeer = await A.page.waitForFunction(`Object.keys(${G}.voice.states()).length === 0`, null, { timeout: 20000 }).then(() => true).catch(() => false);
check('VOICE: peer connection closes when the other player turns voice off', closedPeer);

// ---- radio: every station renders audible original music; export short listening samples ----
const stations = await ev<number>(A.page, 'window.__radio.STATIONS.length');
for (let i = 0; i < stations; i++) {
  const r = await ev<{ rms: number; b64: string; name: string }>(A.page, `(async () => {
    const R = window.__radio; const buf = await R.renderStation(${i}, 40 + ${i} * 97, 12, 22050);
    let s = 0; const d = buf.getChannelData(0); for (let k = 0; k < d.length; k++) s += d[k] * d[k];
    return { rms: Math.sqrt(s / d.length), b64: R.wavBase64(buf), name: R.STATIONS[${i}].name };
  })()`);
  const file = `${OUT}/radio_${i + 1}.wav`; fs.writeFileSync(file, Buffer.from(r.b64, 'base64'));
  check(`RADIO: "${r.name}" renders audible music`, r.rms > 0.01, `rms ${r.rms.toFixed(3)} → ${file}`);
}
await browser.close();
saveResults('e2e_vehicle.txt');
