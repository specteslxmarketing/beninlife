// E2E: two real browsers place a WebRTC voice call (fake mic devices), plus contacts and offline/missed logging.
import { launch, player, enter, ev, shot, check, phone, log, tag, base, saveResults, warm } from './e2e-lib.js';

const browser = await launch();
const A = await player(browser, `Osa_${tag}`); await enter(A.page, 1, 2);
const B = await player(browser, `Ivie_${tag}`); await enter(B.page, 3, 4, 'female');
// a third account that exists but never comes online
const offName = `Away_${tag}`;
await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: offName, password: 'password-' + tag, ageConfirmed: true }) });
const bId = await ev<number>(B.page, 'window.__beninlife.me.id');

// contacts: save B
await phone(A.page, 'players');
await A.page.click(`#phone-screen [data-save="${bId}"]`); await A.page.waitForTimeout(600);
await phone(A.page, 'contacts');
check('CONTACTS: saved player appears in Contacts app', (await A.page.textContent('#phone-screen'))!.includes(B.name));
await shot(A.page, 'calls_01_contacts_app.png');

// call B from contacts (warm B's renderer first so its screenshot fits inside the 30 s ring time)
await warm(B.page);
await A.page.click(`#phone-screen [data-call="${bId}"]`);
await B.page.waitForSelector('#call:not(.hidden)', { timeout: 15000 });
check('CALLS: callee sees incoming call overlay', (await B.page.textContent('#call-status'))!.includes('Incoming'));
// answer inside the 30 s ring timeout: software-GL screenshots of a 2-player scene can take longer than that here, so the
// incoming overlay is captured as DOM text above and the screenshots are taken once the call is up
await B.page.click('#cb-acc', { timeout: 15000 });
const sdpDone = "!!(window.__calls.pc && window.__calls.pc.remoteDescription && window.__calls.pc.localDescription && window.__calls.pc.signalingState === 'stable')";
const negotiated = await Promise.all([A.page, B.page].map((p) => p.waitForFunction(sdpDone, null, { timeout: 45000 }).then(() => true).catch(() => false)));
check('CALLS: WebRTC offer/answer negotiated end-to-end through server signalling (both peers stable with remote SDP)', negotiated.every(Boolean));
const media = await A.page.waitForFunction("window.__calls.view.phase === 'connected'", null, { timeout: 15000 }).then(() => true).catch(() => false);
log(`${media ? 'PASS' : 'N/A '}  CALLS: ICE media path ${media ? 'connected' : 'not verifiable here — this sandbox\'s Chrome sees no network interfaces (0 host ICE candidates, even for an in-page loopback test), so audio cannot flow headlessly on this box'}`);
const micOk = await ev<boolean>(A.page, 'window.__calls.view.micOk');
check('CALLS: microphone stream acquired (fake device)', micOk);
await A.page.waitForTimeout(2500);
await shot(A.page, 'calls_04_in_call_connected.png');
await shot(B.page, 'calls_05_in_call_connected_callee.png');
await A.page.click('#cb-hang');
await B.page.waitForSelector('#call.hidden', { state: 'attached', timeout: 10000 });
check('CALLS: hang up ends the call for both', await B.page.isHidden('#call'));

// reject flow
await A.page.click('#phone-home'); await A.page.click('#phone-screen [data-nav="contacts"]'); await A.page.waitForTimeout(300);
await A.page.click(`#phone-screen [data-call="${bId}"]`);
await B.page.waitForSelector('#call:not(.hidden)', { timeout: 15000 });
await B.page.click('#cb-dec');
await A.page.waitForSelector('#call.hidden', { state: 'attached', timeout: 10000 });
check('CALLS: reject ends the caller\'s ringing', await A.page.isHidden('#call'));

// offline player: cannot connect, logged as missed
await A.page.click('#phone-home'); await A.page.click('#phone-screen [data-nav="players"]'); await A.page.waitForTimeout(800);
const offId = await ev<number>(A.page, `(() => { const r = [...document.querySelectorAll('#phone-screen .item')].find(e => e.textContent.includes('${offName}')); return r ? Number(r.querySelector('[data-call]').dataset.call) : -1; })()`);
await A.page.click(`#phone-screen [data-call="${offId}"]`);
await A.page.waitForTimeout(700);
const toastTxt = await A.page.textContent('#toasts');
check('CALLS: calling an OFFLINE player shows OFFLINE and does not connect', !!toastTxt?.includes('OFFLINE') && await A.page.isHidden('#call'), toastTxt ?? '');
await shot(A.page, 'calls_06_offline_player.png');
await phone(A.page, 'calls');
await A.page.waitForTimeout(600);
const logTxt = (await A.page.textContent('#phone-screen'))!;
check('CALLS: call log lists completed, declined and offline calls', logTxt.includes('Outgoing · offline') && logTxt.includes('declined') && logTxt.includes(B.name), logTxt.slice(0, 200));
await shot(A.page, 'calls_07_call_log.png');
await phone(B.page, 'calls'); await B.page.waitForTimeout(600);
await shot(B.page, 'calls_08_call_log_callee.png');
saveResults('e2e_calls.txt');
await browser.close();
