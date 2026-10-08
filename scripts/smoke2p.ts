// 2-player smoke test against a RUNNING server (default http://localhost:3000).
// Creates two fresh accounts, connects both, checks mutual ONLINE presence, sends a DM,
// disconnects one and checks the other sees OFFLINE.
import { io, type Socket } from 'socket.io-client';
const base = process.env.BASE ?? 'http://localhost:3000';
const tag = Math.random().toString(36).slice(2, 7);
const ack = <T>(s: Socket, ev: string, p: unknown = null) => new Promise<T>((r) => s.emit(ev, p, r));
let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failures++; };

async function account(name: string) {
  const r = await fetch(`${base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, password: 'smoke-pass-123', ageConfirmed: true }) });
  const j = await r.json() as { ok: boolean; user: { id: number; balance: number } };
  check(`register ${name}`, j.ok);
  return { id: j.user.id, balance: j.user.balance, cookie: r.headers.get('set-cookie')!.split(';')[0] };
}
function join(cookie: string) {
  return new Promise<{ s: Socket; init: any }>((res, rej) => {
    const s = io(base, { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true, reconnection: false });
    s.once('init', (init) => res({ s, init })); s.once('connect_error', rej);
  });
}

const A = await account(`smokeA_${tag}`), B = await account(`smokeB_${tag}`);
check('new account starts with ₦5,000', A.balance === 5000);
const a = await join(A.cookie); const b = await join(B.cookie);
await new Promise((r) => setTimeout(r, 300));
const la = await ack<{ players: { id: number; online: boolean }[] }>(a.s, 'players');
const lb = await ack<{ players: { id: number; online: boolean }[] }>(b.s, 'players');
check('A sees B ONLINE', !!la.players.find((p) => p.id === B.id)?.online);
check('B sees A ONLINE', !!lb.players.find((p) => p.id === A.id)?.online);
// new players start on the plane (hidden from the world) until the intro ends — finish it like the client does
check('both players get off the plane (intro:seen)', (await ack<{ ok: boolean }>(a.s, 'intro:seen')).ok && (await ack<{ ok: boolean }>(b.s, 'intro:seen')).ok);
const snap = await new Promise<{ players: { id: number }[] }>((r) => { const f = (m: { players: { id: number }[] }) => { if (m.players.some((p) => p.id === B.id)) { a.s.off('snap', f); r(m); } }; a.s.on('snap', f); setTimeout(() => { a.s.off('snap', f); r({ players: [] }); }, 3000); });
check('A receives world snapshot containing B (position sync)', snap.players.some((p) => p.id === B.id));
const got = new Promise<{ body: string }>((r) => b.s.once('dm:new', r));
const sent = await ack<{ ok: boolean }>(a.s, 'dm:send', { to: B.id, body: `Smoke test DM ${tag}` });
check('A sends DM', sent.ok);
check('B receives DM live', (await got).body === `Smoke test DM ${tag}`);
const unread = await ack<{ unread: Record<number, number> }>(b.s, 'dm:unread');
check('B has 1 unread from A (stored in DB)', unread.unread[A.id] === 1);
const offline = new Promise<boolean>((r) => { a.s.on('presence', (p: { id: number; online: boolean }) => { if (p.id === B.id && !p.online) r(true); }); setTimeout(() => r(false), 5000); });
b.s.close();
check('A gets OFFLINE presence event for B', await offline);
const la2 = await ack<{ players: { id: number; online: boolean; lastSeen: number }[] }>(a.s, 'players');
const row = la2.players.find((p) => p.id === B.id)!;
check('B listed OFFLINE with last_seen', !row.online && row.lastSeen > 0);
a.s.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL SMOKE CHECKS PASSED');
process.exit(failures ? 1 : 0);
