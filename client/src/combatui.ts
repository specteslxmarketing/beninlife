// Combat UI: health/armour/ammo HUD, crosshair + hit marker, wounded overlay, safe-zone chip, touch aim/fire buttons,
// the gun-shop counter (phone app) and the Gangs phone app (create / invite / members / gang chat).
import { emitAck, esc, naira } from './net';
import type { Game } from './game';
import {
  WEAPONS, WEAPON_IDS, GUN_SHOP, HOSPITAL, LICENCE_PRICE, ARMOUR_PRICE, ARMOUR_MAX, HEALTH_MAX, GANG_COLORS, GANG_EMBLEMS, GANG_CREATE_PRICE, GANG_MAX_MEMBERS, type WeaponId,
} from '../../shared/combat';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Toast = (m: string, k?: 'ok' | 'err' | 'info') => void;

// ---------------- HUD ----------------
let lastKey = '';
export function setupCombatHud(game: Game): void {
  const c = game.combat;
  const hold = (id: string, down: () => void, up: () => void) => {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* gone */ } down(); });
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
  };
  hold('tb-aim', () => c.setAim(!c.aiming), () => {});
  hold('tb-fire', () => { if (!c.aiming) c.setAim(true); c.firing = true; }, () => { c.firing = false; });
  hold('tb-reload', () => void c.reload(), () => {});
  hold('tb-wpn', () => c.cycle(), () => {});
  c.onChange = () => updateCombatHud(game);
  setInterval(() => updateCombatHud(game), 60);
}
export function updateCombatHud(game: Game): void {
  const c = game.combat; const s = c.s; const play = game.mode === 'play';
  const a = c.ammo; const w = c.weapon;
  const downMs = Math.max(0, s.downedUntil - Date.now());
  const key = [play, Math.round(s.health), Math.round(s.armour), w, a?.mag, a?.reserve, c.reloading, c.zone, Math.ceil(downMs / 1000), c.aiming, c.owned().length, game.inCar].join('|');
  if (key !== lastKey) {
    lastKey = key;
    const hurt = s.health < HEALTH_MAX || s.armour > 0 || !!w || c.owned().length > 0;
    $('combat-hud').classList.toggle('hidden', !play || !hurt);
    $('hp-bar').style.width = `${Math.max(0, s.health) / HEALTH_MAX * 100}%`;
    $('hp-bar').classList.toggle('low', s.health < 35);
    $('ar-bar').style.width = `${s.armour / ARMOUR_MAX * 100}%`;
    $('ar-row').classList.toggle('hidden', s.armour <= 0);
    $('ammo').innerHTML = w && a ? `<b>${esc(WEAPONS[w].name)}</b> <span class="mag">${a.mag}</span><span class="res">/ ${a.reserve}</span>${c.reloading ? ' <i>reloading…</i>' : ''}` : c.owned().length ? '<span class="res">Holstered · 1/2/3 to draw</span>' : '';
    $('zone-chip').classList.toggle('hidden', !play || !c.zone || !c.owned().length);
    $('zone-chip').textContent = c.zone ? `🛡 ${c.zone} — weapons disabled` : '';
    $('downed').classList.toggle('hidden', downMs <= 0);
    $('downed-t').textContent = downMs > 0 ? `Ambulance to ${HOSPITAL.name} in ${Math.ceil(downMs / 1000)} s · bill ${naira(HOSPITAL.fee)}` : '';
    document.body.classList.toggle('armed', !!w && !c.zone && !game.inCar);
    document.body.classList.toggle('has-weapons', c.owned().length > 0);
    document.body.classList.toggle('aiming', c.aiming);
    $('tb-aim').classList.toggle('on', c.aiming);
  }
  const ch = $('crosshair');
  const showCh = play && c.aiming && c.crosshair;
  ch.classList.toggle('hidden', !showCh);
  if (showCh) { const gap = 6 + c.bloom * 18 + (w ? WEAPONS[w].spread * 220 : 0); ch.style.setProperty('--gap', `${gap.toFixed(1)}px`); ch.classList.toggle('hit', c.hitMark > 0); ch.classList.toggle('head', c.hitHead && c.hitMark > 0); }
  $('hurt-vignette').style.opacity = String(Math.min(0.85, c.hurtFlash * 0.8 + (s.health < 35 && s.health > 0 ? 0.25 : 0)));
}

// ---------------- gun shop (phone app 'arsenal') ----------------
export function arsenalHtml(game: Game, header: (t: string) => string): string {
  const c = game.combat; const s = c.s;
  const at = !game.inCar && Math.hypot(game.pos.x - GUN_SHOP.door.x, game.pos.y - GUN_SHOP.door.z) < GUN_SHOP.radius + 0.5;
  const wanted = game.wanted > 0;
  const dis = (cond: boolean) => (cond ? '' : 'disabled');
  const rows = WEAPON_IDS.map((id) => {
    const d = WEAPONS[id]; const own = s.weapons[id];
    return `<div class="item"><div><div class="nm">${esc(d.name)}</div><div class="sub">${esc(d.desc)}<br>Damage ${d.damage}${d.pellets > 1 ? `×${d.pellets}` : ''} · ${Math.round(60000 / d.intervalMs)} rpm · range ${d.range} m · ${naira(d.price)}${own ? ` · <span class="st on">OWNED ${own.mag}/${own.reserve}</span>` : ''}</div></div>
      <div class="acts">${own ? `<button data-gun-ammo="${id}" ${dis(at && !wanted)} title="${d.ammoPack} rounds">Ammo ${naira(d.ammoPrice)}</button><button data-gun-eq="${id}">${s.equipped === id ? 'Holster' : 'Draw'}</button>` : `<button data-gun-buy="${id}" ${dis(at && s.licence && !wanted)}>Buy</button>`}</div></div>`;
  }).join('');
  return header(at ? GUN_SHOP.name : 'Arsenal') + `<div class="sub" style="color:#999;font-size:.75rem;margin-bottom:8px">${at
    ? 'Licensed dealer. Purchases are made by the server from your wallet. The dealer will not sell to anyone the police are looking for.'
    : `Weapons you own. To buy, visit <b>${GUN_SHOP.name}</b> (East road, between Uyi Fashion House and the Police Station).`}</div>
    <div class="card">🪪 Firearms licence: ${s.licence ? '<b style="color:#3fdf7f">HELD</b>' : `<button class="pill" data-gun-lic ${dis(at && !wanted)}>Apply — ${naira(LICENCE_PRICE)}</button>`}
      <br>🦺 Body armour: <b>${Math.round(s.armour)}/${ARMOUR_MAX}</b> ${s.armour < ARMOUR_MAX ? `<button class="pill" data-gun-arm ${dis(at && !wanted)}>Buy vest — ${naira(ARMOUR_PRICE)}</button>` : ''}
      ${wanted ? '<br><b style="color:#ff6b6b">You are wanted — the dealer refuses to serve you.</b>' : ''}</div>
    <div class="list">${rows}</div>
    <div class="card" style="font-size:.75rem;color:#aaa">Weapons are disabled in safe zones: airport, hospital, police station, Uyi Fashion House, Car Stands, this shop, and inside houses unless the owner allows it. Shooting in public brings the police; knocking someone down gets you up to ★★★. Wounded players are taken to ${HOSPITAL.name} (${naira(HOSPITAL.fee)} bill).</div>`;
}
export function wireArsenal(sc: HTMLElement, game: Game, toast: Toast, rerender: () => void): void {
  const done = (r: { ok: boolean; error?: string }, msg: string) => { if (r.ok) { toast(msg, 'ok'); game.audio.cash(); } else toast(r.error ?? 'Failed', 'err'); rerender(); };
  sc.querySelectorAll<HTMLElement>('[data-gun-lic]').forEach((b) => { b.onclick = async () => done(await emitAck(game.socket, 'gun:licence'), '🪪 Firearms licence issued'); });
  sc.querySelectorAll<HTMLElement>('[data-gun-arm]').forEach((b) => { b.onclick = async () => done(await emitAck(game.socket, 'gun:armour'), '🦺 Vest fitted — 100 armour'); });
  sc.querySelectorAll<HTMLElement>('[data-gun-buy]').forEach((b) => { b.onclick = async () => { const id = b.dataset.gunBuy as WeaponId; done(await emitAck(game.socket, 'gun:buy', { id }), `Bought ${WEAPONS[id].name} — press ${WEAPON_IDS.indexOf(id) + 1} to draw it (outside safe zones)`); }; });
  sc.querySelectorAll<HTMLElement>('[data-gun-ammo]').forEach((b) => { b.onclick = async () => { const id = b.dataset.gunAmmo as WeaponId; done(await emitAck(game.socket, 'gun:ammo', { id }), `+${WEAPONS[id].ammoPack} rounds`); }; });
  sc.querySelectorAll<HTMLElement>('[data-gun-eq]').forEach((b) => { b.onclick = async () => { const id = b.dataset.gunEq as WeaponId; await game.combat.equip(game.combat.weapon === id ? null : id); rerender(); }; });
}

// ---------------- gangs (phone app 'gangs') ----------------
interface GangView { gang: { id: number; name: string; tag: string; color: string; emblem: string; ownerId: number; friendlyFire: boolean } | null; members: { id: number; name: string; role: string; online: boolean }[]; invites: { id: number; name: string; tag: string; color: string; emblem: string; fromName: string }[]; chat: { id: number; from: number; fromName: string; body: string; at: number }[] }
export let gangView: GangView | null = null;
let draft = { name: '', tag: '', color: GANG_COLORS[0]!, emblem: GANG_EMBLEMS[0]! };
export async function refreshGang(game: Game): Promise<void> { const r = await emitAck<GangView & { ok: boolean }>(game.socket, 'gang:info'); if (r.ok) gangView = r; }
export function gangsHtml(game: Game, header: (t: string) => string, players: { id: number; name: string; online: boolean }[]): string {
  const v = gangView;
  if (!v) return header('Gangs') + '<p class="sub">Loading…</p>';
  if (!v.gang) {
    return header('Gangs') + `<div class="sub" style="color:#999;font-size:.75rem;margin-bottom:8px">Start your own crew. Gangs are player-made and fictional — names of real cults/confraternities are refused. Registration costs ${naira(GANG_CREATE_PRICE)}.</div>
      ${v.invites.length ? `<div class="card"><b>Invitations</b>${v.invites.map((i) => `<div class="item"><div><span style="color:${i.color}">${esc(i.emblem)} [${esc(i.tag)}]</span> ${esc(i.name)}<div class="sub">from ${esc(i.fromName)}</div></div><div class="acts"><button data-gang-acc="${i.id}">Join</button><button data-gang-dec="${i.id}">✕</button></div></div>`).join('')}</div>` : ''}
      <div class="card"><b>Create a gang</b>
        <input id="gang-name" maxlength="24" placeholder="Name (3–24 chars)" value="${esc(draft.name)}" style="width:100%;margin:4px 0">
        <input id="gang-tag" maxlength="4" placeholder="Tag (2–4)" value="${esc(draft.tag)}" style="width:100%;margin:4px 0;text-transform:uppercase">
        <div class="swatches">${GANG_COLORS.map((c) => `<button class="sw ${c === draft.color ? 'on' : ''}" data-gang-col="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
        <div class="emblems">${GANG_EMBLEMS.map((e) => `<button class="em ${e === draft.emblem ? 'on' : ''}" data-gang-em="${e}">${e}</button>`).join('')}</div>
        <button class="primary" id="gang-create">Register gang — ${naira(GANG_CREATE_PRICE)}</button></div>`;
  }
  const g = v.gang; const lead = g.ownerId === game.me.id;
  const memberIds = new Set(v.members.map((m) => m.id));
  const invitable = players.filter((p) => p.online && !memberIds.has(p.id) && p.id !== game.me.id).slice(0, 12);
  return header(`<span style="color:${g.color}">${esc(g.emblem)} [${esc(g.tag)}]</span> ${esc(g.name)}`) + `
    <div class="card"><b>Members (${v.members.length}/${GANG_MAX_MEMBERS})</b>${v.members.map((m) => `<div class="item"><div><span class="st ${m.online ? 'on' : 'off'}">${m.online ? '●' : '○'}</span> ${esc(m.name)} ${m.role === 'leader' ? '<b style="color:#d9b45a">LEADER</b>' : ''}</div>${lead && m.id !== game.me.id ? `<div class="acts"><button data-gang-kick="${m.id}" title="Remove">✕</button></div>` : ''}</div>`).join('')}</div>
    ${lead ? `<div class="card"><b>Invite players online</b>${invitable.map((p) => `<div class="item"><div>${esc(p.name)}</div><div class="acts"><button data-gang-inv="${p.id}">Invite</button></div></div>`).join('') || '<div class="sub">Nobody else online right now.</div>'}
      <label class="check"><input type="checkbox" id="gang-ff" ${g.friendlyFire ? 'checked' : ''}> Friendly fire (members can hurt each other)</label>
      <div class="swatches">${GANG_COLORS.map((c) => `<button class="sw ${c === g.color ? 'on' : ''}" data-gang-recol="${c}" style="background:${c}"></button>`).join('')}</div></div>` : ''}
    <div class="card"><b>Gang chat</b> <small style="color:#888">(or type <code>/g message</code> in the chat box)</small><div class="thread" id="gang-thread">${v.chat.map((m) => `<div class="msg ${m.from === game.me.id ? 'me' : ''}"><b>${esc(m.fromName)}:</b> ${esc(m.body)}</div>`).join('')}</div>
      <form class="dm-form" id="gang-form"><input id="gang-input" maxlength="300" placeholder="Message your gang" autocomplete="off"><button>Send</button></form></div>
    <button class="pill" id="gang-leave">${lead && v.members.length === 1 ? 'Disband gang' : 'Leave gang'}</button>`;
}
export function wireGangs(sc: HTMLElement, game: Game, toast: Toast, rerender: () => void): void {
  const after = async (r: { ok: boolean; error?: string }, msg?: string) => { if (r.ok) { if (msg) toast(msg, 'ok'); await refreshGang(game); } else toast(r.error ?? 'Failed', 'err'); rerender(); };
  const name = sc.querySelector<HTMLInputElement>('#gang-name'), tag = sc.querySelector<HTMLInputElement>('#gang-tag');
  if (name) name.oninput = () => { draft.name = name.value; };
  if (tag) tag.oninput = () => { draft.tag = tag.value.toUpperCase(); };
  sc.querySelectorAll<HTMLElement>('[data-gang-col]').forEach((b) => { b.onclick = () => { draft.color = b.dataset.gangCol!; rerender(); }; });
  sc.querySelectorAll<HTMLElement>('[data-gang-em]').forEach((b) => { b.onclick = () => { draft.emblem = b.dataset.gangEm!; rerender(); }; });
  const create = sc.querySelector<HTMLElement>('#gang-create');
  if (create) create.onclick = async () => { const r = await emitAck<{ ok: boolean; error?: string }>(game.socket, 'gang:create', draft); if (r.ok) draft = { name: '', tag: '', color: GANG_COLORS[0]!, emblem: GANG_EMBLEMS[0]! }; await after(r, 'Gang registered'); };
  sc.querySelectorAll<HTMLElement>('[data-gang-acc]').forEach((b) => { b.onclick = async () => after(await emitAck(game.socket, 'gang:respond', { id: Number(b.dataset.gangAcc), accept: true }), 'Welcome to the gang'); });
  sc.querySelectorAll<HTMLElement>('[data-gang-dec]').forEach((b) => { b.onclick = async () => after(await emitAck(game.socket, 'gang:respond', { id: Number(b.dataset.gangDec), accept: false })); });
  sc.querySelectorAll<HTMLElement>('[data-gang-inv]').forEach((b) => { b.onclick = async () => after(await emitAck(game.socket, 'gang:invite', { id: Number(b.dataset.gangInv) }), 'Invitation sent'); });
  sc.querySelectorAll<HTMLElement>('[data-gang-kick]').forEach((b) => { b.onclick = async () => after(await emitAck(game.socket, 'gang:kick', { id: Number(b.dataset.gangKick) }), 'Member removed'); });
  sc.querySelectorAll<HTMLElement>('[data-gang-recol]').forEach((b) => { b.onclick = async () => after(await emitAck(game.socket, 'gang:update', { color: b.dataset.gangRecol })); });
  const ff = sc.querySelector<HTMLInputElement>('#gang-ff'); if (ff) ff.onchange = async () => after(await emitAck(game.socket, 'gang:update', { friendlyFire: ff.checked }));
  const leave = sc.querySelector<HTMLElement>('#gang-leave'); if (leave) leave.onclick = async () => after(await emitAck(game.socket, 'gang:leave'), 'You left the gang');
  const form = sc.querySelector<HTMLFormElement>('#gang-form');
  if (form) form.onsubmit = async (e) => { e.preventDefault(); const inp = sc.querySelector<HTMLInputElement>('#gang-input')!; const body = inp.value.trim(); if (!body) return; const r = await emitAck<{ ok: boolean; error?: string }>(game.socket, 'gang:chat', body); if (r.ok) inp.value = ''; else toast(r.error ?? 'Failed', 'err'); };
  const th = sc.querySelector('#gang-thread'); if (th) th.scrollTop = th.scrollHeight;
}
