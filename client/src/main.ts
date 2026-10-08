import { safeCapture } from './controls';
import { Game, DEFAULT_APP, type Me, type HouseState } from './game';
import { connect, emitAck, esc, naira } from './net';
import { CallClient, type CallView } from './calls';
import { preloadBrand } from './brand';
import { preloadHumans } from './human';
import { Character } from './character';
import { effectiveQuality, recommendedQuality, setQualityChoice, storedQualityChoice, isTouchDevice, isIPad } from './quality';
import { playTravelCutscene } from './travelfx';
import { STATIONS, renderStation, wavBase64 } from './radio';
import type { CombatState } from './combat';
interface RichRow { rank: number; id: number; name: string; balance: number; admin: boolean }
let richRows: RichRow[] | null = null;
import { setupCombatHud, arsenalHtml, wireArsenal, gangsHtml, wireGangs, refreshGang, gangView } from './combatui';
import { carModel, LAGOS, TRAVEL, cityAt, type TravelMode, type City, CLOTHES, CLOTHING_STORE, STATION_JOBS, TAXI_BASE, TAXI_CLEAN_TIP, TAXI_PER_M, WEATHER_KINDS, WEATHER_LABEL, WEATHER_PARAMS, type WeatherKind, OUTFIT_COLORS, SKIN_TONES, MARKET_PICKUP, CARWASH_ZONE, type Appearance } from '../../shared/constants';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, on = true) => $(id).classList.toggle('hidden', !on);

const isTouch = isTouchDevice();
if (isTouch) document.body.classList.add('touch');
if (isIPad()) document.body.classList.add('ipad');
// iOS Safari: stop pinch-zoom / double-tap zoom / long-press callouts from hijacking the game
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('#game, #hud')) e.preventDefault(); }, { passive: false });
const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight / 100}px`);
setVh(); window.addEventListener('resize', setVh); window.addEventListener('orientationchange', () => setTimeout(setVh, 300));

interface PlayerRow { id: number; name: string; admin: boolean; online: boolean; lastSeen: number | null }
interface Msg { id: number; channel: string; from: number; to: number | null; fromName?: string; body: string; at: number; read: boolean }
interface Contact { id: number; name: string }
interface CallRow { id: number; caller_id: number; callee_id: number; status: string; reason: string | null; created_at: number; answered_at: number | null; ended_at: number | null; caller_name: string; callee_name: string }
interface Tx { id: number; amount: number; balance_after: number; kind: string; note: string; created_at: number }

// ---------------- AUTH ----------------
let signup = false;
function setTab(s: boolean): void {
  signup = s;
  $('tab-login').classList.toggle('active', !s); $('tab-signup').classList.toggle('active', s);
  show('age-row', s); $('au-submit').textContent = s ? 'Create account' : 'Log in';
  $<HTMLInputElement>('au-pass').autocomplete = s ? 'new-password' : 'current-password';
  $('au-err').textContent = '';
}
$('tab-login').onclick = () => setTab(false);
$('tab-signup').onclick = () => setTab(true);
$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $<HTMLInputElement>('au-user').value.trim(), password = $<HTMLInputElement>('au-pass').value;
  if (signup && !$<HTMLInputElement>('au-age').checked) { $('au-err').textContent = 'You must confirm you are 18 or older.'; return; }
  $('au-submit').setAttribute('disabled', '');
  try {
    const r = await fetch(signup ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ username, password, ageConfirmed: signup ? true : undefined }) });
    const j = await r.json();
    if (!j.ok) { $('au-err').textContent = j.error ?? 'Failed'; return; }
    show('auth', false); boot();
  } catch { $('au-err').textContent = 'Network error'; } finally { $('au-submit').removeAttribute('disabled'); }
});

async function init(): Promise<void> {
  await preloadBrand();
  const r = await fetch('/api/me', { credentials: 'same-origin' });
  if (r.ok) boot(); else { show('auth'); setTab(false); }
}

// ---------------- GAME BOOT ----------------
let game: Game;
let booting = false;
if (effectiveQuality() !== 'low') void preloadHumans();
let players: PlayerRow[] = [];
let unread: Record<number, number> = {};
let tx: Tx[] = [];
let openThread: number | null = null;
let phoneApp: string = 'home';
let contacts: Contact[] = [];
let callLog: CallRow[] = [];
let calls: CallClient;
let ringing = false;
const ADMIN_PLACES: [string, number, number][] = [
  ['BEST 𝕏 Mansion gate', 117, 9], ['Car park (spawn)', -44, 10.5], ['New Benin Market', 10, 50], ['Ring Road Car Wash', 47, 9], ['BEST 𝕏 Car Stands', 10.5, 91], ['Osaze Mechanic Workshop', -111.5, -12], ['Benin Airport', -10, -208], ['Benin Motor Park', -14.5, 158], ['Ikate Waterside (Lagos)', LAGOS.x - 6, 20.5], ['Lagos airport kerb', LAGOS.x + 116, -92],
  ['Uselu Mini Flat', -165, 12.5], ['GRA Bungalow', -80, 12.5], ['Ugbowo Duplex', -120, 12.5],
];
let missedSince = Number(localStorage.getItem('bl_missed_seen') ?? '0');

function boot(): void {
  show('loading');
  const socket = connect();
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') { location.reload(); return; }
    $('loading-text').textContent = 'Connecting to server…';
  });
  socket.on('disconnect', () => toast('Disconnected — reconnecting…', 'err'));
  socket.on('init', async (d: { me: Me; serverTime: number; tx: Tx[]; global: Msg[]; unread: Record<number, number>; players: PlayerRow[]; contacts: Contact[]; houses: HouseState[]; weather?: WeatherKind; combat?: CombatState }) => {
    contacts = d.contacts ?? [];
    if (game) game.setHouses(d.houses ?? []);
    if (game) { // reconnect: just resync
      game.applyServerState(d.me); game.balance = d.me.balance; players = d.players; unread = d.unread; renderHud(); return;
    }
    if (booting) return;
    booting = true;
    const q0 = effectiveQuality();
    if (q0 !== 'low') { Character.realistic = await preloadHumans(); Character.shadows = q0 === 'high'; }
    players = d.players; unread = d.unread; tx = d.tx;
    $('chat-log').innerHTML = '';
    for (const m of d.global) addChat(m);
    sysChat('Welcome to Benin City. Be respectful in chat.');
    const q = effectiveQuality();
    game = new Game($('game'), q, socket, d.me, $('joystick'), $('joy-knob'));
    game.wanted = d.me.wanted ?? 0;
    (window as unknown as { __beninlife: Game }).__beninlife = game;
    (window as unknown as { __radio: unknown }).__radio = { renderStation, wavBase64, STATIONS };
    game.serverOffset = d.serverTime - Date.now();
    game.setHouses(d.houses ?? []);
    if (d.weather) { game.weather.set(d.weather); game.weather.overcast = WEATHER_PARAMS[d.weather].overcast; game.weather.rain = WEATHER_PARAMS[d.weather].rain; game.weather.wet = WEATHER_PARAMS[d.weather].wet; }
    game.toast = toast;
    game.onHud = renderHud;
    game.onAction = (a) => { renderActions(a); updateTouchAndRadio(a); };
    game.onTravel = (mode: TravelMode, to: City, ms: number) => { closePhone(); game.audio.journey(mode, ms / 1000); void playTravelCutscene(mode, to, ms); };
    game.onShop = (shop) => { if (shop === 'guns') openPhone('arsenal'); else { openPhone('wardrobe'); void refreshWardrobe(); } };
    if (d.combat) game.combat.set(d.combat);
    setupCombatHud(game);
    game.jobs.onProgress = (p, label) => {
      const el = $('work-progress'); el.classList.toggle('hidden', p === null);
      if (p !== null) { el.querySelector('i')!.setAttribute('style', `width:${Math.round(Math.min(1, p) * 100)}%`); el.querySelector('span')!.textContent = label ?? ''; }
    };
    setupHud(); setupTouchAndRadio();
    setupCalls(socket);
    show('loading', false);
    game.start();
    if (!d.me.app) startCreator(d.me.app ?? DEFAULT_APP, () => afterCreator(d.me));
    else afterCreator(d.me);
  });
  socket.on('presence', (p: { id: number; name: string; online: boolean; lastSeen: number }) => {
    const row = players.find((x) => x.id === p.id);
    if (row) { row.online = p.online; row.lastSeen = p.lastSeen; } else players.push({ id: p.id, name: p.name, admin: false, online: p.online, lastSeen: p.lastSeen });
    players.sort((a, b) => Number(b.online) - Number(a.online));
    if (game && p.id !== game.me.id) sysChat(`${p.name} is now ${p.online ? 'online' : 'offline'}`);
    renderPhone();
  });
  socket.on('chat:global', (m: Msg) => addChat(m));
  socket.on('gang:chat', (m: { from: number; fromName: string; body: string }) => {
    const g = game?.combat.s.gang; const d = document.createElement('div'); d.className = 'm chat-gang'; d.style.setProperty('--gc', g?.color ?? '#e9c46a');
    d.innerHTML = `<b>[${esc(g?.tag ?? 'GANG')}] ${esc(m.fromName)}:</b> ${esc(m.body)}`; const log = $('chat-log'); log.appendChild(d); log.scrollTop = log.scrollHeight;
    if (phoneApp === 'gangs') void refreshGang(game).then(renderPhone);
  });
  socket.on('gang:invited', (e: { gang: { name: string }; fromName: string }) => { toast(`${e.fromName} invited you to join “${e.gang.name}” — open 📱 Gangs`, 'info'); if (phoneApp === 'gangs') void refreshGang(game).then(renderPhone); });
  socket.on('gang:event', (e: { text: string }) => { toast(e.text, 'info'); if (phoneApp === 'gangs') void refreshGang(game).then(renderPhone); });
  socket.on('dm:new', (m: Msg) => {
    if (openThread === m.from && phoneApp === 'thread') { void loadThread(m.from); }
    else toast(`📱 New message from ${m.fromName}`, 'info');
    game?.audio.message();
  });
  socket.on('dm:unread', (u: Record<number, number>) => { unread = u; renderBadge(); renderPhone(); });
  socket.on('wanted', (w: { wanted: number; reason?: string; arrested?: boolean; fine?: number; crime?: boolean }) => {
    if (!game) return; game.wanted = w.wanted;
    if (w.arrested) toast(`🚔 ${w.reason ?? 'Arrested'}. Fine: ${naira(w.fine ?? 0)}.`, 'err');
    else if (w.crime) toast(`🚨 ${w.reason} — wanted ${'★'.repeat(w.wanted)}`, 'err');
    else if (w.reason) toast(`${w.reason}${w.wanted ? ` — wanted ${'★'.repeat(w.wanted)}` : ' — no longer wanted'}`, 'info');
    renderHud();
  });
  socket.on('police:hit', (p: { by: string }) => toast(`🚑 You were knocked down by ${p.by}'s car. The police have been told.`, 'err'));
  socket.on('wallet', (w: { balance: number; tx: Tx[] }) => { tx = w.tx; renderHud(); if (phoneApp === 'wallet') renderPhone(); });
}

function afterCreator(me: Me): void {
  if (!me.introSeen) {
    // playable arrival: walk the cabin, sit by the advisor, landing, walk off into Benin Airport
    show('intro'); show('hud'); document.body.classList.add('cabin');
    const el = $('intro-text');
    game.onArrivalLine = (l) => {
      el.innerHTML = l ? `<span class="who ${l.who}">${esc(l.name)}</span>${esc(l.text)}` : '';
      el.classList.toggle('note', !!l && l.who === 'note');
    };
    game.onArrivalPhase = (p) => {
      $('intro').classList.toggle('cine', p === 'seated' || p === 'landing' || p === 'taxi');
      renderHud();
    };
    game.playIntro(() => {
      show('intro', false); document.body.classList.remove('cabin');
      game.socket.emit('intro:seen', {}, () => { toast('Welcome to Benin City! Head out the front doors — the city is south down the road.', 'ok'); });
      enterPlay();
    });
    $('intro-skip').onclick = () => game.skipIntro();
  } else enterPlay();
}

function enterPlay(): void {
  game.mode = 'play';
  show('hud');
  renderHud();
}

// ---------------- CHARACTER CREATOR ----------------
function startCreator(initial: Appearance, done: () => void): void {
  game.mode = 'creator';
  game.controls.camYaw = game.rot - 0.5; // start facing the character
  const app: Appearance = { ...initial };
  show('creator');
  const render = () => {
    $('cr-body').innerHTML = (['male', 'female'] as const).map((b) => `<button data-b="${b}" class="${app.body === b ? 'on' : ''}">${b === 'male' ? 'Male' : 'Female'}</button>`).join('');
    $('cr-skin').innerHTML = SKIN_TONES.map((c, i) => `<button data-i="${i}" title="Skin tone ${i + 1}" style="background:${c}" class="${app.skin === i ? 'on' : ''}"></button>`).join('');
    $('cr-outfit').innerHTML = OUTFIT_COLORS.map((c, i) => `<button data-i="${i}" title="Outfit ${i + 1}" style="background:${c}" class="${app.outfit === i ? 'on' : ''}"></button>`).join('');
    game.player.setAppearance(app);
  };
  $('cr-body').onclick = (e) => { const b = (e.target as HTMLElement).dataset.b; if (b) { app.body = b as Appearance['body']; render(); } };
  $('cr-skin').onclick = (e) => { const i = (e.target as HTMLElement).dataset.i; if (i) { app.skin = Number(i); render(); } };
  $('cr-outfit').onclick = (e) => { const i = (e.target as HTMLElement).dataset.i; if (i) { app.outfit = Number(i); render(); } };
  $('cr-save').onclick = async () => {
    const r = await emitAck(game.socket, 'appearance', app);
    if (!r.ok) { toast('Could not save character', 'err'); return; }
    game.me.app = app; show('creator', false); game.controls.camYaw = game.rot + Math.PI; done();
  };
  render();
}

// ---------------- HUD ----------------
function setupHud(): void {
  const sel = $<HTMLSelectElement>('sel-quality');
  const rec = recommendedQuality();
  const cur = storedQualityChoice();
  sel.innerHTML = [['auto', `Auto (${rec})`], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]
    .map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>⚙ ${l}</option>`).join('');
  sel.onchange = () => { setQualityChoice(sel.value as 'auto'); toast('Applying graphics quality…', 'info'); setTimeout(() => location.reload(), 300); };
  $('btn-phone').onclick = () => openPhone('home');
  $('btn-mute').onclick = () => { game.audio.unlock(); game.audio.setMuted(!game.audio.muted); renderMute(); };
  renderMute();
  $('btn-online').onclick = () => openPhone('players');
  $('phone-close').onclick = () => closePhone();
  $('phone-home').onclick = () => { phoneApp = 'home'; openThread = null; renderPhone(); };
  $('btn-chat-toggle').onclick = () => $('chat').classList.toggle('collapsed');
  if (isTouch) $('chat').classList.add('collapsed');
  $('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $<HTMLInputElement>('chat-input'); const body = inp.value.trim();
    if (!body) { inp.blur(); return; }
    if (body.startsWith('/g ')) { const r = await emitAck(game.socket, 'gang:chat', body.slice(3)); if (r.ok) inp.value = ''; else toast(String(r.error ?? 'Failed'), 'err'); return; }
    const r = await emitAck(game.socket, 'chat:global', body);
    if (r.ok) inp.value = ''; else toast(String(r.error ?? 'Failed'), 'err');
  });
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && t.tagName !== 'INPUT') { $('chat').classList.remove('collapsed'); $<HTMLInputElement>('chat-input').focus(); e.preventDefault(); }
    if (e.key === 'Escape') { if (t.tagName === 'INPUT') (t as HTMLInputElement).blur(); else closePhone(); }
    if ((e.key === 'p' || e.key === 'P') && t.tagName !== 'INPUT') { if ($('phone').classList.contains('hidden')) openPhone('home'); else closePhone(); }
  });
  setInterval(renderHud, 500);
  renderBadge();
  requestAnimationFrame(drawMinimapLoop);
}

function renderMute(): void { $('btn-mute').textContent = game.audio.muted ? '🔇' : '🔊'; }
function fmtHour(h: number): string {
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function renderHud(): void {
  if (!game) return;
  $('hud-balance').textContent = naira(game.balance);
  const h = game.hour();
  $('hud-time').textContent = fmtHour(h) + (game.hourOverride !== null ? ' (preview)' : '');
  $('phone-time').textContent = fmtHour(h);
  $('hud-daynight').textContent = (h >= 6 && h < 18.5 ? 'Day' : '🌙 Night') + ' · ' + WEATHER_LABEL[game.weather.kind];
  $('hud-objective').textContent = '🎯 ' + game.objective();
  $('hud-online').textContent = String(players.filter((p) => p.online).length);
  const w = $('hud-wanted'); w.classList.toggle('hidden', game.wanted <= 0); w.classList.toggle('flash', game.wanted > 0);
  w.innerHTML = game.wanted > 0 ? '★'.repeat(game.wanted) + `<span class="off">${'★'.repeat(5 - game.wanted)}</span>` : '';
}

// ---------------- touch pad + car radio HUD ----------------
function setupTouchAndRadio(): void {
  const c = game.controls;
  for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#touchpad .tb[data-key]'))) {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); game.audio.unlock(); b.classList.add('on'); c.press(b.dataset.key!); });
    const off = () => b.classList.remove('on'); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
  }
  const brake = $('tb-brake');
  brake.addEventListener('pointerdown', (e) => { e.preventDefault(); safeCapture(brake, e.pointerId); c.touchBrake = true; brake.classList.add('on'); });
  const rel = () => { c.touchBrake = false; brake.classList.remove('on'); };
  brake.addEventListener('pointerup', rel); brake.addEventListener('pointercancel', rel);
  const sprint = $('tb-sprint');
  sprint.addEventListener('pointerdown', (e) => { e.preventDefault(); c.sprintToggle = !c.sprintToggle; sprint.classList.toggle('on', c.sprintToggle); });
  $('tb-phone').addEventListener('pointerdown', (e) => { e.preventDefault(); openPhone('home'); });
  // proximity voice: the mic button switches voice on/off (permission prompt on first use); hold V or 🎙 Talk to speak
  $('btn-mic').onclick = async () => {
    game.audio.unlock();
    if (game.voice.on) { game.voice.disable(); toast('🎙 Voice chat off', 'info'); }
    else if (await game.voice.enable()) toast(game.voice.mode === 'ptt' ? '🎙 Voice on — hold V (or 🎙 Talk) to speak to players near you' : '🎙 Voice on — open mic, players near you can hear you', 'ok');
    else toast(`🎙 Microphone unavailable: ${game.voice.error}`, 'err');
    renderMic();
  };
  const talk = $('tb-mic');
  talk.addEventListener('pointerdown', (e) => { e.preventDefault(); safeCapture(talk, e.pointerId); if (game.voice.mode === 'ptt') game.pttHeld = true; else game.voice.setTalking(!game.voice.talking); });
  const tRel = () => { game.pttHeld = false; }; talk.addEventListener('pointerup', tRel); talk.addEventListener('pointercancel', tRel);
  $('rd-prev').onclick = () => game.radioNext(-1);
  $('rd-next').onclick = () => game.radioNext(1);
  const vol = $<HTMLInputElement>('rd-vol'); vol.value = String(Math.round(game.audio.radioVolume * 100));
  vol.oninput = () => game.audio.setRadioVolume(Number(vol.value) / 100);
}
function renderMic(): void {
  const b = $('btn-mic'), v = game.voice;
  b.textContent = !v.on ? '🎙 Voice off' : v.talking ? '🎙 Talking…' : v.mode === 'ptt' ? '🎙 Hold V' : '🎙 Open mic';
  b.classList.toggle('on', v.on); b.classList.toggle('talk', v.talking);
  document.body.classList.toggle('voice-on', v.on); $('tb-mic').classList.toggle('on', v.talking);
}
let lastVoiceKey = '';
function renderVoiceHud(): void {
  const v = game.voice; if (!v.on) { if (lastVoiceKey) { show('voice-hud', false); lastVoiceKey = ''; renderMic(); } return; }
  const near = [...game.remotes.entries()].filter(([, r]) => r.snap.voice);
  const speaking = near.filter(([id]) => v.speaking(id)).map(([, r]) => r.snap.name);
  const key = `${v.talking}|${near.length}|${speaking.join(',')}|${v.peerCount}`;
  if (key === lastVoiceKey) return; lastVoiceKey = key; renderMic();
  show('voice-hud', true);
  $('voice-hud').innerHTML = `<span>🎙 Voice · ${v.peerCount} nearby connected</span>` + speaking.map((n) => `<span class="sp">🔊 ${esc(n)}</span>`).join('');
}
let lastTouchKey = '';
function updateTouchAndRadio(actions: { id: string; label: string; key: string }[]): void {
  renderVoiceHud();
  const inCar = game.inCar;
  const a = game.audio; const st = a.radioOn ? STATIONS[a.station] : undefined;
  const radioTxt = st ? `${st.name} ${st.freq}` : 'Radio off';
  const trackTxt = st && a.nowTrack ? `“${a.nowTrack.title}” · ${a.nowTrack.artist}` : st ? (a.unlocked ? 'Tuning…' : 'Tap to start sound') : 'Press R / ⏭ to turn on';
  const f = actions.find((x) => x.key === 'F' && x.id !== 'car') ?? actions.find((x) => x.id !== 'car');
  const key = [inCar, radioTxt, trackTxt, f?.label ?? '', actions.some((x) => x.id === 'car')].join('|');
  if (key === lastTouchKey) return; lastTouchKey = key;
  document.body.classList.toggle('in-car', inCar);
  show('radio-hud', inCar && game.mode === 'play');
  $('rd-station').textContent = '📻 ' + radioTxt; $('rd-track').textContent = trackTxt;
  if (!isTouch) return;
  $('tb-car').querySelector('small')!.textContent = inCar ? 'Exit' : 'Car';
  $('tb-car').classList.toggle('dim', !inCar && !actions.some((x) => x.id === 'car'));
  $('tb-act').querySelector('small')!.textContent = f ? (f.label.length > 12 ? f.label.slice(0, 11) + '…' : f.label) : 'Action';
  $('tb-act').classList.toggle('dim', !f);
  $('tb-radio').classList.toggle('on', a.radioOn);
  const pad = $('touchpad'); document.body.style.setProperty('--tbh', `${pad.offsetHeight + 12}px`);
}

let lastActionsKey = '';
function renderActions(actions: { id: string; label: string; key: string }[]): void {
  const key = actions.map((a) => a.id + a.label).join('|');
  if (key === lastActionsKey) return;
  lastActionsKey = key;
  const el = $('actions'); el.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.innerHTML = `${isTouch ? '' : `<kbd>${a.key}</kbd>`}${esc(a.label)}`;
    b.onclick = () => { if (a.id === 'car') game.toggleCar(); else void game.doContextAction(a.id); };
    el.appendChild(b);
  }
}

function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info'): void {
  const t = document.createElement('div'); t.className = `toast ${kind}`; t.textContent = msg;
  $('toasts').appendChild(t); setTimeout(() => t.remove(), 3300);
}

function addChat(m: Msg): void {
  const d = document.createElement('div'); d.className = 'm';
  d.innerHTML = `<b>${esc(m.fromName ?? '?')}:</b> ${esc(m.body)}`;
  const log = $('chat-log'); log.appendChild(d);
  while (log.children.length > 60) log.firstChild!.remove();
  log.scrollTop = log.scrollHeight;
}
function sysChat(text: string): void {
  const d = document.createElement('div'); d.className = 'm sys'; d.textContent = text;
  const log = $('chat-log'); log.appendChild(d); log.scrollTop = log.scrollHeight;
}

function drawMinimapLoop(): void {
  requestAnimationFrame(drawMinimapLoop);
  const c = $<HTMLCanvasElement>('minimap'); const ctx = c.getContext('2d')!;
  const S = c.width, scale = S / 380, cx = S / 2, cz = S / 2;
  const lag = game.city === 'lagos', ox = lag ? LAGOS.x : 0;
  const X = (x: number) => cx + (x - ox) * scale, Z = (z: number) => cz + z * scale;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(40,34,26,0.85)'; ctx.fillRect(0, 0, S, S);
  if (lag) {
    ctx.fillStyle = '#d9c49a'; ctx.fillRect(0, Z(48), S, 50 * scale); // beach
    ctx.fillStyle = '#1d5d74'; ctx.fillRect(0, Z(97), S, S); // Atlantic
    ctx.fillStyle = '#555'; ctx.fillRect(0, Z(23), S, 18.5 * scale); ctx.fillRect(X(ox - 7), 0, 14 * scale, Z(23)); ctx.fillRect(X(ox + 6), Z(-95), 160 * scale, 10 * scale);
  } else {
    ctx.fillStyle = '#555'; ctx.fillRect(X(-7), 0, 14 * scale, S); ctx.fillRect(0, Z(-7), S, 14 * scale);
    ctx.beginPath(); ctx.arc(X(0), Z(0), 26 * scale, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a5a32'; ctx.beginPath(); ctx.arc(X(0), Z(0), 13 * scale, 0, Math.PI * 2); ctx.fill();
  }
  for (const f of game.world.footprints) {
    if (f.kind === 'island' || (cityAt(f.x, f.z) === 'lagos') !== lag) continue;
    ctx.fillStyle = f.kind === 'carstands' ? '#d9b45a' : f.kind === 'house' ? '#3f8f5f' : f.kind === 'mansion' ? '#8a6d2a' : f.kind === 'carwash' ? '#2b6cb0' : f.kind === 'market' ? '#8a4a2a' : '#9a8f7c';
    ctx.fillRect(X(f.x - f.w / 2), Z(f.z - f.d / 2), f.w * scale, f.d * scale);
  }
  const dot = (x: number, z: number, col: string, r = 3) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(x), Z(z), r, 0, Math.PI * 2); ctx.fill(); };
  if (lag) { dot(TRAVEL.bus.desk.lagos.x, TRAVEL.bus.desk.lagos.z, '#ffe9a8', 4); dot(TRAVEL.flight.desk.lagos.x, TRAVEL.flight.desk.lagos.z, '#9ad0ff', 4); } else {
    if (!game.job) dot(MARKET_PICKUP.x, MARKET_PICKUP.z, '#ffb02e', 4); else dot(game.job.x, game.job.z, '#3fdf7f', 4);
    dot(CARWASH_ZONE.x, CARWASH_ZONE.z, '#5aa9ff', 3); dot(TRAVEL.bus.desk.benin.x, TRAVEL.bus.desk.benin.z, '#ffe9a8', 3);
  }
  for (const r of game.remotes.values()) if ((cityAt(r.x, r.z) === 'lagos') === lag) dot(r.x, r.z, '#ff6b6b', 2.5);
  if (!game.inCar && !lag) dot(game.carState.x, game.carState.z, '#bbbbbb', 2);
  ctx.save(); ctx.translate(X(game.pos.x), Z(game.pos.y)); ctx.rotate(-game.rot + Math.PI);
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.fillStyle = '#ddd'; ctx.font = '10px sans-serif'; ctx.fillText('N', S / 2 - 3, 11);
}

// ---------------- PHONE ----------------
function renderBadge(): void {
  const n = Object.values(unread).reduce((a, b) => a + b, 0);
  const total = n + missedCount();
  $('phone-badge').textContent = String(total); show('phone-badge', total > 0);
}
function openPhone(app: string): void { phoneApp = app; show('phone'); game.controls.enabled = false; renderPhone(); if (app === 'players') void refreshPlayers(); }
function closePhone(): void { show('phone', false); openThread = null; phoneApp = 'home'; if (game) game.controls.enabled = true; }
async function refreshPlayers(): Promise<void> {
  const r = await emitAck<{ ok: boolean; players: PlayerRow[] }>(game.socket, 'players');
  if (r.ok) { players = r.players; renderPhone(); }
}
function ago(ts: number | null): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
function renderPhone(): void {
  if (!game || $('phone').classList.contains('hidden')) { renderBadge(); return; }
  renderBadge();
  const sc = $('phone-screen');
  const header = (title: string) => `<div class="ph-h"><button data-nav="home">‹</button><h3>${title}</h3></div>`;
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  if (phoneApp === 'home') {
    sc.innerHTML = `<div class="apps">
      <button class="app" data-nav="messages"><span class="ic" style="background:#1f7a46">💬</span>Messages${totalUnread ? `<span class="badge">${totalUnread}</span>` : ''}</button>
      <button class="app" data-nav="calls"><span class="ic" style="background:#1f9d55">📞</span>Calls${missedCount() ? `<span class="badge">${missedCount()}</span>` : ''}</button>
      <button class="app" data-nav="contacts"><span class="ic" style="background:#5a3a8a">📇</span>Contacts</button>
      <button class="app" data-nav="players"><span class="ic" style="background:#2a4a7a">👥</span>Players</button>
      <button class="app" data-nav="wallet"><span class="ic" style="background:#7a5a1f">₦</span>Wallet</button>
      <button class="app" data-nav="cars"><span class="ic" style="background:#222;border:1px solid #d9b45a">🚗</span>My Cars</button>
      <button class="app" data-nav="wardrobe"><span class="ic" style="background:#7a2a5a">👔</span>Wardrobe</button>
      <button class="app" data-nav="jobs"><span class="ic" style="background:#6a2a2a">📦</span>Jobs</button>
      <button class="app" data-nav="rich"><span class="ic" style="background:#3a2c0a">👑</span>Rich List</button>
      <button class="app" data-nav="arsenal"><span class="ic" style="background:#2b2b2b">🔫</span>Arsenal</button>
      <button class="app" data-nav="gangs"><span class="ic" style="background:${game.combat.s.gang?.color ?? '#3a2a5a'}">${game.combat.s.gang?.emblem ?? '◆'}</span>Gangs</button>
      ${game.me.admin ? '<button class="app" data-nav="admin"><span class="ic" style="background:#0b0b0b;border:1px solid #d9b45a"><img src="/brand/crown_gold.png" style="width:40px" alt=""></span>BEST 𝕏</button>' : ''}
      <button class="app" data-nav="settings"><span class="ic" style="background:#3a3a3a">⚙</span>Settings</button>
    </div>`;
  } else if (phoneApp === 'messages') {
    const others = players.filter((p) => p.id !== game.me.id).sort((a, b) => (unread[b.id] ?? 0) - (unread[a.id] ?? 0) || Number(b.online) - Number(a.online));
    sc.innerHTML = header('Messages') + `<div class="list">${others.map((p) => `<div class="item" data-thread="${p.id}"><div><div class="nm">${esc(p.name)}</div><div class="sub">${p.online ? 'Online' : 'Last seen ' + ago(p.lastSeen)}</div></div>${unread[p.id] ? `<span class="st on">${unread[p.id]} new</span>` : ''}</div>`).join('') || '<p class="sub">No other players yet.</p>'}</div>`;
  } else if (phoneApp === 'players') {
    sc.innerHTML = header('Players') + `<div class="list">${players.map((p) => `<div class="item"><div><div class="nm">${esc(p.name)}${p.id === game.me.id ? ' (you)' : ''}</div><div class="sub"><span class="st ${p.online ? 'on' : 'off'}">${p.online ? 'ONLINE' : 'OFFLINE'}</span> ${p.online ? '' : 'Last seen ' + ago(p.lastSeen)}</div></div>${p.id !== game.me.id ? personActs(p.id) : ''}</div>`).join('')}</div>`;
  } else if (phoneApp === 'contacts') {
    sc.innerHTML = header('Contacts') + (contacts.length ? `<div class="list">${contacts.map((c) => { const p = players.find((x) => x.id === c.id); return `<div class="item"><div><div class="nm">${esc(c.name)}</div><div class="sub"><span class="st ${p?.online ? 'on' : 'off'}">${p?.online ? 'ONLINE' : 'OFFLINE'}</span></div></div>${personActs(c.id)}</div>`; }).join('')}</div>`
      : '<p class="sub" style="color:#999">No contacts yet. Open <b>Players</b> and tap ☆ to save someone.</p>');
  } else if (phoneApp === 'calls') {
    sc.innerHTML = header('Calls') + `<div class="sub" style="color:#888;font-size:.72rem;margin-bottom:6px">Voice calls are peer-to-peer (WebRTC). Calls to offline players are logged as missed.</div><div class="list">${callLog.map((c) => {
      const out = c.caller_id === game.me.id; const other = out ? c.callee_id : c.caller_id; const name = out ? c.callee_name : c.caller_name;
      const missed = c.status === 'missed' || c.status === 'rejected';
      const label = out ? (c.status === 'missed' ? (c.reason === 'offline' ? 'Outgoing · offline' : c.reason === 'busy' ? 'Outgoing · busy' : 'Outgoing · no answer') : c.status === 'rejected' ? 'Outgoing · declined' : 'Outgoing')
        : (c.status === 'missed' ? 'Missed call' : c.status === 'rejected' ? 'Declined' : 'Incoming');
      const dur = c.answered_at && c.ended_at ? ` · ${fmtDur(c.ended_at - c.answered_at)}` : '';
      return `<div class="item callrow"><div><div class="nm ${missed && !out ? 'miss' : ''}">${out ? '↗' : '↙'} ${esc(name)}</div><div class="sub">${label}${dur} · ${ago(c.created_at)}</div></div><div class="acts"><button data-call="${other}" title="Call back">📞</button></div></div>`;
    }).join('') || '<p class="sub" style="color:#999">No calls yet.</p>'}</div>`;
  } else if (phoneApp === 'wallet') {
    sc.innerHTML = header('Wallet') + `<div class="big">${naira(game.balance)}</div><div class="sub" style="color:#999;font-size:.75rem;margin-bottom:8px">Balance is held on the server. Recent transactions:</div>` +
      tx.map((t) => `<div class="tx"><span>${esc(t.note || t.kind)}<br><small style="color:#777">${new Date(t.created_at).toLocaleString()}</small></span><span class="${t.amount >= 0 ? 'pos' : 'neg'}">${t.amount >= 0 ? '+' : '−'}${naira(Math.abs(t.amount))}</span></div>`).join('');
  } else if (phoneApp === 'jobs') {
    const tj = game.jobs.taxi, sj = game.jobs.station;
    sc.innerHTML = header('Jobs') + `<div class="card"><b>🚕 Taxi driver — fare ${naira(TAXI_BASE)} + ${naira(TAXI_PER_M)}/m</b><br>Drive your own car. The server sends you a passenger (blue marker); pick them up, drive them to their stop. ${naira(TAXI_CLEAN_TIP)} tip if your car is clean.<br>
        Status: <b>${tj ? (tj.stage === 'to_pickup' ? 'Going to pick up ' + esc(tj.passenger) : 'Driving ' + esc(tj.passenger) + ' → ' + esc(tj.dest?.name ?? '')) : 'Off duty'}</b><br>
        ${tj ? '<button class="pill" data-job="taxi-stop">End taxi shift</button>' : `<button class="pill" data-job="taxi-start" ${game.jobs.active || game.job ? 'disabled' : ''}>Start taxi shift${game.inCar ? '' : ' (get in your car first)'}</button>`}</div>
      <div class="card"><b>🧽 Car-wash attendant — ${naira(STATION_JOBS.carwash.pay)} per car</b><br>Go to the JOBS board at Ring Road Car Wash (East road) and press F. Soap, scrub, rinse and dry each customer's car.${sj?.id === 'carwash' ? `<br><b>On shift · ${sj.cars} car(s) done</b> <button class="pill" data-job="shift-stop">End shift</button>` : ''}</div>
      <div class="card"><b>🔧 Mechanic — ${naira(STATION_JOBS.mechanic.pay)} per car</b><br>Osaze Mechanic Workshop (West road, by Esosa Auto Spares). Check the engine, change the tyre, top up oil, test the brakes.${sj?.id === 'mechanic' ? `<br><b>On shift · ${sj.cars} car(s) done</b> <button class="pill" data-job="shift-stop">End shift</button>` : ''}</div>
      <div class="card"><b>📦 Delivery driver — ${naira(1500)} per drop</b><br>1. Go to the amber marker at New Benin Market (South road).<br>2. Pick up the package.<br>3. Take it to the green marker. You can walk or drive.<br><i>The server checks you were really at both points and didn't arrive impossibly fast.</i><br><br>Status: <b>${game.job ? 'Carrying package → ' + esc(game.job.name) : 'No active delivery'}</b></div>
      <div class="card"><b>🚿 Ring Road Car Wash — ${naira(500)}</b><br>Your car gets dusty as you drive. Drive into the blue bay on the East road and choose "Wash car".<br>Current dirt: <b>${Math.round(game.car.dirt * 100)}%</b></div>`;
  } else if (phoneApp === 'wardrobe') {
    const atStore = game.nearClothingStore(); const owned = wardrobe ?? ['casual'];
    sc.innerHTML = header(atStore ? CLOTHING_STORE.name : 'Wardrobe') + `<div class="sub" style="color:#999;font-size:.75rem;margin-bottom:8px">${atStore ? 'Buy here — payment is taken by the server and the outfit is saved to your account.' : `Change into clothes you own. To buy new clothes visit <b>${CLOTHING_STORE.name}</b> (East road, across from Ring Road Car Wash).`}</div>
      <div class="list">${CLOTHES.map((c) => { const own = owned.includes(c.id); const worn = game.style === c.id;
        return `<div class="item"><div><div class="nm">${esc(c.name)}</div><div class="sub">${esc(c.desc)} · ${c.price ? naira(c.price) : 'free'} ${worn ? '<b style="color:#3fdf7f">WEARING</b>' : own ? '<span class="st on">OWNED</span>' : ''}</div></div><div class="acts">${worn ? '' : own ? `<button data-wear="${c.id}">Wear</button>` : atStore ? `<button data-buy="${c.id}">Buy</button>` : ''}</div></div>`; }).join('')}</div>`;
  } else if (phoneApp === 'rich') {
    sc.innerHTML = header('Rich List') + `<div class="sub" style="color:#999;font-size:.75rem;margin-bottom:8px">Richest players in Benin City (wallet balances held on the server).</div>` +
      (richRows ? `<div class="list">${richRows.map((r) => `<div class="item rich-row${r.id === game.me.id ? ' me' : ''}"><div><b class="rank">#${r.rank}</b> ${r.admin ? '👑 ' : ''}${esc(r.name)}</div><div class="amt">${naira(r.balance)}</div></div>`).join('')}</div>` : '<p class="sub">Loading…</p>');
    if (!richRows) void emitAck<{ ok: boolean; list: RichRow[] }>(game.socket, 'rich:list').then((r) => { if (r.ok) { richRows = r.list; renderPhone(); } });
  } else if (phoneApp === 'arsenal') {
    sc.innerHTML = arsenalHtml(game, header);
    wireArsenal(sc, game, toast, renderPhone);
  } else if (phoneApp === 'gangs') {
    sc.innerHTML = gangsHtml(game, header, players);
    wireGangs(sc, game, toast, renderPhone);
    if (!gangView) void refreshGang(game).then(renderPhone);
  } else if (phoneApp === 'admin' && game.me.admin) {
    sc.innerHTML = header('BEST 𝕏 — Travel') + `<div class="sub" style="color:#999;font-size:.75rem;margin-bottom:8px">Admin-only: the server lets only the admin account teleport, and never into house interiors.</div><div class="list">${ADMIN_PLACES.map((p, i) => `<div class="item"><div class="nm">${esc(p[0])}</div><div class="acts"><button data-tp="${i}">Go</button></div></div>`).join('')}</div>
      <div class="card">Weather (server-wide, 10 min override): ${WEATHER_KINDS.map((k) => `<button class="pill" data-wx="${k}">${WEATHER_LABEL[k]}</button>`).join(' ')} <button class="pill" data-wx="auto">Auto</button></div>
      <div class="card">Mansion gate: ${game.houseState('mansion')?.locked ? '🔒 locked (private)' : '🔓 open to visitors'} — walk to the gate and press G to change.</div>`;
  } else if (phoneApp === 'cars') {
    sc.innerHTML = header('My Cars') + `<div class="sub" style="color:#999;font-size:.75rem;margin-bottom:8px">Ownership is stored on the server. Buy more at <b>BEST 𝕏 Car Stands</b> (South road, past the market). Your active car is delivered to ${myCars?.home && myHouse() ? 'your house' : 'the car park'}.</div>
      <div class="list">${[{ id: null as number | null, model: 'starter', color: '' }, ...(myCars?.vehicles ?? [])].map((v) => { const m = carModel(v.model); const act = (myCars?.active.id ?? null) === v.id;
        return `<div class="item"><div><div class="nm">${esc(m.name)}</div><div class="sub">${v.color ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${v.color}"></span> ` : ''}${act ? '<b style="color:#3fdf7f">ACTIVE</b>' : ''}</div></div><div class="acts">${act ? '' : `<button data-use="${v.id ?? 'null'}">Use</button>`}</div></div>`; }).join('')}</div>`;
  } else if (phoneApp === 'settings') {
    sc.innerHTML = header('Settings') + `<div class="card">Signed in as <b>${esc(game.me.name)}</b> (@${esc(game.me.username)})</div>
      <div class="card">Graphics: <b>${game.quality}</b> (recommended for this device: ${recommendedQuality()}). Change it from the ⚙ menu at the top.</div>
      <div class="card">🔊 Sound volume <input id="vol" type="range" min="0" max="100" value="${Math.round(game.audio.volume * 100)}" style="width:100%"><label class="check"><input id="mute" type="checkbox" ${game.audio.muted ? 'checked' : ''}> Mute all sound</label><label class="check"><input id="radio" type="checkbox" ${game.audio.radioOn ? 'checked' : ''}> Car radio</label>
        📻 Station <select id="radio-st" style="width:100%">${STATIONS.map((st, i) => `<option value="${i}" ${i === game.audio.station ? 'selected' : ''}>${st.name} ${st.freq} — ${st.genre === 'afropop' ? 'Afro-pop' : st.genre[0]!.toUpperCase() + st.genre.slice(1)}</option>`).join('')}</select>
        Radio volume <input id="radio-vol" type="range" min="0" max="100" value="${Math.round(game.audio.radioVolume * 100)}" style="width:100%">
        🎙 Voice chat <select id="voice-mode" style="width:100%"><option value="ptt" ${game.voice.mode === 'ptt' ? 'selected' : ''}>Push-to-talk (hold V / 🎙 Talk)</option><option value="open" ${game.voice.mode === 'open' ? 'selected' : ''}>Open mic (toggle)</option></select>
        <label class="check"><input id="voice-deaf" type="checkbox" ${game.voice.deafened ? 'checked' : ''}> Mute other players' voices</label>
        <small style="color:#888">All radio music is original and composed live by the game (no real songs or samples). Stations follow the server clock, so everyone tuned in hears the same song.</small><br><small style="color:#888">All sounds are generated live in your browser (Web Audio). ${game.audio.unlocked ? 'Audio running.' : 'Audio starts after your first tap/key press.'}</small></div>
      <div class="card"><label class="check"><input id="ambient" type="checkbox" ${game.ambientOn ? 'checked' : ''}> Ambient traffic &amp; pedestrians (a few local cars and people; switch off on slow devices)</label></div>
      <div class="card">🔫 Weapons <select id="aim-mode" style="width:100%"><option value="hold" ${game.combat.aimMode === 'hold' ? 'selected' : ''}>Aim: hold right mouse button</option><option value="toggle" ${game.combat.aimMode === 'toggle' ? 'selected' : ''}>Aim: click right mouse button to toggle</option></select>
        <label class="check"><input id="crosshair-on" type="checkbox" ${game.combat.crosshair ? 'checked' : ''}> Show crosshair</label>
        <label class="check"><input id="auto-reload" type="checkbox" ${game.combat.autoReload ? 'checked' : ''}> Reload automatically when the magazine is empty</label>
        <small style="color:#888">Touch: 🔫 draws/switches/holsters, ◎ aims, ✸ fires (hold), ⟳ reloads; drag the screen to aim.</small></div>
      <button class="primary" id="btn-logout">Log out</button>`;
    $<HTMLInputElement>('ambient').onchange = (e) => game.setAmbient((e.target as HTMLInputElement).checked);
    $<HTMLSelectElement>('aim-mode').onchange = (e) => { game.combat.aimMode = (e.target as HTMLSelectElement).value as 'hold' | 'toggle'; localStorage.setItem('bl_aim_mode', game.combat.aimMode); };
    $<HTMLInputElement>('crosshair-on').onchange = (e) => { game.combat.crosshair = (e.target as HTMLInputElement).checked; localStorage.setItem('bl_crosshair', game.combat.crosshair ? '1' : '0'); };
    $<HTMLInputElement>('auto-reload').onchange = (e) => { game.combat.autoReload = (e.target as HTMLInputElement).checked; localStorage.setItem('bl_auto_reload', game.combat.autoReload ? '1' : '0'); };
    $<HTMLInputElement>('vol').oninput = (e) => { game.audio.unlock(); game.audio.setVolume(Number((e.target as HTMLInputElement).value) / 100); };
    $<HTMLInputElement>('mute').onchange = (e) => { game.audio.setMuted((e.target as HTMLInputElement).checked); renderMute(); };
    $<HTMLInputElement>('radio').onchange = (e) => game.audio.setRadio((e.target as HTMLInputElement).checked);
    $<HTMLSelectElement>('voice-mode').onchange = (e) => { game.voice.setMode((e.target as HTMLSelectElement).value as 'ptt' | 'open'); renderMic(); };
    $<HTMLInputElement>('voice-deaf').onchange = (e) => { game.voice.deafened = (e.target as HTMLInputElement).checked; };
    $<HTMLSelectElement>('radio-st').onchange = (e) => { const i = Number((e.target as HTMLSelectElement).value); game.audio.setRadio(true); game.audio.station = (i + STATIONS.length - 1) % STATIONS.length; game.audio.nextStation(1); };
    $<HTMLInputElement>('radio-vol').oninput = (e) => { game.audio.setRadioVolume(Number((e.target as HTMLInputElement).value) / 100); const v = document.getElementById('rd-vol') as HTMLInputElement | null; if (v) v.value = (e.target as HTMLInputElement).value; };
    $('btn-logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };
  } else if (phoneApp === 'thread' && openThread !== null) {
    const other = players.find((p) => p.id === openThread);
    sc.innerHTML = header(esc(other?.name ?? 'Chat')) + `<div class="sub" style="color:#888;font-size:.72rem;margin-bottom:6px">${other?.online ? 'Online' : 'Offline — they will see it next time'}</div><div class="thread" id="thread"></div>
      <form class="dm-form" id="dm-form"><input id="dm-input" maxlength="300" placeholder="Message" autocomplete="off" /><button>Send</button></form>`;
    renderThread();
    $('dm-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const inp = $<HTMLInputElement>('dm-input'); const body = inp.value.trim(); if (!body) return;
      const r = await emitAck<{ ok: boolean; error?: string; message?: Msg }>(game.socket, 'dm:send', { to: openThread, body });
      if (r.ok && r.message) { inp.value = ''; threadMsgs.push(r.message); renderThread(); } else toast(r.error ?? 'Failed', 'err');
    });
  }
  sc.querySelectorAll<HTMLElement>('[data-nav]').forEach((b) => { b.onclick = () => { phoneApp = b.dataset.nav!; openThread = null; if (phoneApp === 'rich') richRows = null; renderPhone(); if (phoneApp === 'players' || phoneApp === 'messages' || phoneApp === 'contacts') void refreshPlayers(); if (phoneApp === 'calls') void refreshCalls(); if (phoneApp === 'cars') void refreshCars(); if (phoneApp === 'wardrobe') void refreshWardrobe(); if (phoneApp === 'gangs') { void refreshPlayers(); void refreshGang(game).then(renderPhone); } }; });
  sc.querySelectorAll<HTMLElement>('[data-thread]').forEach((b) => { b.onclick = () => { void loadThread(Number(b.dataset.thread)); }; });
  sc.querySelectorAll<HTMLElement>('[data-tp]').forEach((b) => { b.onclick = async () => {
    const p = ADMIN_PLACES[Number(b.dataset.tp)];
    const r = await emitAck<{ ok: boolean; error?: string }>(game.socket, 'admin:teleport', { x: p[1], z: p[2] });
    if (r.ok) { closePhone(); toast(`Arrived: ${p[0]}`, 'ok'); } else toast(r.error ?? 'Failed', 'err');
  }; });
  sc.querySelectorAll<HTMLElement>('[data-wx]').forEach((b) => { b.onclick = async () => {
    const r = await emitAck<{ ok: boolean; error?: string; weather?: string }>(game.socket, 'admin:weather', { kind: b.dataset.wx });
    toast(r.ok ? `Weather: ${WEATHER_LABEL[r.weather as WeatherKind]}` : r.error ?? 'Failed', r.ok ? 'ok' : 'err');
  }; });
  sc.querySelectorAll<HTMLElement>('[data-job]').forEach((b) => { b.onclick = async () => {
    const k = b.dataset.job;
    if (k === 'taxi-start') await game.jobs.startTaxi(); else if (k === 'taxi-stop') await game.jobs.stopTaxi(); else if (k === 'shift-stop') await game.jobs.stopShift();
    renderPhone(); renderHud();
  }; });
  sc.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => { b.onclick = async () => {
    const c = CLOTHES.find((x) => x.id === b.dataset.buy)!;
    const r = await emitAck<{ ok: boolean; error?: string; style?: string; owned?: string[] }>(game.socket, 'clothes:buy', { id: c.id });
    if (r.ok && r.style) { wardrobe = r.owned ?? wardrobe; game.setStyle(r.style); toast(`👔 Bought ${c.name} for ${naira(c.price)} — you're wearing it now`, 'ok'); } else toast(r.error ?? 'Failed', 'err');
    renderPhone(); renderHud();
  }; });
  sc.querySelectorAll<HTMLElement>('[data-wear]').forEach((b) => { b.onclick = async () => {
    const r = await emitAck<{ ok: boolean; error?: string; style?: string }>(game.socket, 'clothes:wear', { id: b.dataset.wear });
    if (r.ok && r.style) { game.setStyle(r.style); toast('Outfit changed', 'ok'); } else toast(r.error ?? 'Failed', 'err');
    renderPhone();
  }; });
  sc.querySelectorAll<HTMLElement>('[data-use]').forEach((b) => { b.onclick = async () => {
    const id = b.dataset.use === 'null' ? null : Number(b.dataset.use);
    const r = await emitAck<{ ok: boolean; error?: string }>(game.socket, 'car:use', { id });
    if (r.ok) { toast('Car delivered to your parking spot', 'ok'); void refreshCars(); } else toast(r.error ?? 'Failed', 'err');
  }; });
  sc.querySelectorAll<HTMLElement>('[data-call]').forEach((b) => { b.onclick = () => { void startCall(Number(b.dataset.call)); }; });
  sc.querySelectorAll<HTMLElement>('[data-save]').forEach((b) => { b.onclick = async () => {
    const id = Number(b.dataset.save); const saved = contacts.some((c) => c.id === id);
    const r = await emitAck<{ ok: boolean; contacts: Contact[] }>(game.socket, saved ? 'contacts:remove' : 'contacts:add', { id });
    if (r.ok) { contacts = r.contacts; toast(saved ? 'Removed from contacts' : 'Saved to contacts', 'ok'); renderPhone(); }
  }; });
  if (phoneApp === 'calls') { missedSince = Date.now(); localStorage.setItem('bl_missed_seen', String(missedSince)); renderBadge(); }
}
function personActs(id: number): string {
  const saved = contacts.some((c) => c.id === id);
  return `<div class="acts"><button data-call="${id}" title="Voice call">📞</button><button data-thread="${id}" title="Message">💬</button><button data-save="${id}" title="${saved ? 'Remove contact' : 'Save contact'}">${saved ? '★' : '☆'}</button></div>`;
}
function fmtDur(ms: number): string { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function missedCount(): number { return callLog.filter((c) => c.callee_id === game?.me.id && c.status === 'missed' && c.created_at > missedSince).length; }
let wardrobe: string[] | null = null;
async function refreshWardrobe(): Promise<void> {
  const r = await emitAck<{ ok: boolean; owned: string[]; style: string }>(game.socket, 'clothes:list');
  if (r.ok) { wardrobe = r.owned; if (r.style !== game.style) game.setStyle(r.style); if (phoneApp === 'wardrobe') renderPhone(); }
}
let myCars: { vehicles: { id: number; model: string; color: string }[]; active: { id: number | null }; home: { x: number; z: number } } | null = null;
function myHouse(): boolean { return game.houses.some((h) => h.ownerId === game.me.id && h.id !== 'mansion'); }
async function refreshCars(): Promise<void> {
  const r = await emitAck<{ ok: boolean; vehicles: { id: number; model: string; color: string }[]; active: { id: number | null }; home: { x: number; z: number } }>(game.socket, 'car:list');
  if (r.ok) { myCars = r; if (phoneApp === 'cars') renderPhone(); }
}
async function refreshCalls(): Promise<void> {
  const r = await emitAck<{ ok: boolean; calls: CallRow[] }>(game.socket, 'calls:log');
  if (r.ok) { callLog = r.calls; renderPhone(); }
}

// ---------------- CALLS ----------------
function setupCalls(socket: ReturnType<typeof connect>): void {
  calls = new CallClient(socket);
  (window as unknown as { __calls: CallClient }).__calls = calls;
  calls.onChange = (v) => { renderCall(v); if (v.phase === 'incoming') game.audio.startRing(true); else if (v.phase === 'calling') { if (!ringing) game.audio.startRing(false); } else game.audio.stopRing(); ringing = v.phase === 'incoming' || v.phase === 'calling'; };
  calls.onEnded = (status, reason, name, outgoing) => {
    const msg = !outgoing && status === 'missed' ? `Missed call from ${name}` : !outgoing && status === 'rejected' ? 'Call declined' : status === 'ended' ? `Call with ${name} ended` : status === 'rejected' ? `${name} declined the call` : reason === 'no-answer' ? `No answer from ${name}` : reason === 'cancelled' ? 'Call cancelled' : `Call with ${name} ended (${reason})`;
    toast('📞 ' + msg, status === 'ended' ? 'info' : 'err');
    void refreshCalls();
  };
  setInterval(() => { if (calls.view.phase === 'connected') renderCall(calls.view); }, 1000);
  void refreshCalls();
}
async function startCall(id: number): Promise<void> {
  const p = players.find((x) => x.id === id) ?? contacts.find((x) => x.id === id);
  const name = p?.name ?? 'Player';
  const r = await calls.call(id, name);
  if (!r.ok) {
    toast(r.error === 'offline' ? `📵 ${name} is OFFLINE — call could not connect (logged as missed)` : r.error === 'busy' ? `${name} is on another call` : `Call failed: ${r.error}`, 'err');
    void refreshCalls();
  }
}
function renderCall(v: CallView): void {
  const el = $('call');
  el.classList.toggle('hidden', v.phase === 'idle');
  el.classList.toggle('ringing', v.phase === 'incoming' || v.phase === 'calling');
  if (v.phase === 'idle') return;
  $('call-avatar').textContent = (v.peerName.replace(/[^A-Za-z0-9]/g, '')[0] ?? '?').toUpperCase();
  $('call-name').textContent = v.peerName;
  $('call-status').textContent = v.phase === 'incoming' ? 'Incoming voice call…' : v.phase === 'calling' ? (v.note || 'Calling…') : v.phase === 'connecting' ? 'Connecting…' : `Connected · ${fmtDur(Date.now() - v.since)}`;
  $('call-note').textContent = v.phase === 'calling' ? '' : v.note;
  const btns = $('call-btns');
  if (v.phase === 'incoming') {
    btns.innerHTML = '<button class="dec" id="cb-dec" title="Decline">✕</button><button class="acc" id="cb-acc" title="Answer">📞</button>';
    $('cb-acc').onclick = () => void calls.answer();
    $('cb-dec').onclick = () => calls.reject();
  } else {
    btns.innerHTML = `${v.phase === 'calling' ? '' : `<button class="mute ${v.muted ? 'on' : ''}" id="cb-mute" title="Mute" ${v.micOk ? '' : 'disabled'}>${v.muted ? '🔇' : '🎙'}</button>`}<button class="dec" id="cb-hang" title="Hang up">✕</button>`;
    $('cb-hang').onclick = () => calls.hangup();
    const m = document.getElementById('cb-mute'); if (m) m.onclick = () => calls.toggleMute();
  }
}
let threadMsgs: Msg[] = [];
async function loadThread(id: number): Promise<void> {
  const r = await emitAck<{ ok: boolean; messages: Msg[]; unread: Record<number, number> }>(game.socket, 'dm:thread', { with: id });
  if (!r.ok) return;
  threadMsgs = r.messages; unread = r.unread; openThread = id;
  if (phoneApp !== 'thread') { phoneApp = 'thread'; renderPhone(); } else renderThread();
  renderBadge();
}
function renderThread(): void {
  const el = document.getElementById('thread'); if (!el) return;
  el.innerHTML = threadMsgs.map((m) => `<div class="bub ${m.from === game.me.id ? 'me' : ''}">${esc(m.body)}<small>${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>`).join('') || '<p style="color:#888">No messages yet. Say hello!</p>';
  const sc = $('phone-screen'); sc.scrollTop = sc.scrollHeight;
}

// audio may only start after a user gesture (autoplay policy)
for (const ev of ['pointerdown', 'keydown', 'touchstart', 'touchend', 'click']) window.addEventListener(ev, () => { if (game) game.audio.unlock(); }, { passive: true }); // iOS needs touchend/click
void init();
