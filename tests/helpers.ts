import type { AddressInfo } from 'node:net';
import { io as ioc, type Socket } from 'socket.io-client';
import { openDb, type DB } from '../server/src/db.js';
import { createServer, seedAdmin } from '../server/src/app.js';

export interface Harness {
  db: DB; srv: ReturnType<typeof createServer>; base: string;
  /** fresh = brand-new player still on the arrival plane; otherwise the player has already arrived (intro seen) */
  register(username: string, fresh?: boolean): Promise<{ cookie: string; id: number }>;
  connect(cookie: string): Promise<{ s: Socket; init: Record<string, unknown> }>;
  login(username: string, password: string): Promise<string>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const db = openDb(':memory:');
  await seedAdmin(db);
  const srv = createServer({ db, secret: 'test-secret' });
  await new Promise<void>((r) => srv.httpServer.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.httpServer.address() as AddressInfo).port}`;
  const sockets: Socket[] = [];
  return {
    db, srv, base,
    async register(username, fresh = false) {
      const r = await fetch(base + '/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'password123', ageConfirmed: true }) });
      const j = await r.json() as { ok: boolean; user: { id: number }; error?: string };
      if (!j.ok) throw new Error('register failed: ' + j.error);
      if (!fresh) db.prepare('UPDATE users SET intro_seen = 1 WHERE id = ?').run(j.user.id);
      return { cookie: r.headers.get('set-cookie')!.split(';')[0], id: j.user.id };
    },
    async login(username, password) {
      const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      return r.headers.get('set-cookie')!.split(';')[0];
    },
    connect(cookie) {
      return new Promise((res, rej) => {
        const s = ioc(base, { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true, reconnection: false });
        sockets.push(s);
        s.once('init', (init) => res({ s, init }));
        s.once('connect_error', rej);
      });
    },
    async close() { for (const s of sockets) s.close(); await srv.close(); },
  };
}
export const ack = <T = Record<string, unknown>>(s: Socket, ev: string, p: unknown = null) => new Promise<T>((r) => s.emit(ev, p, r));
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const once = <T = unknown>(s: Socket, ev: string, ms = 3000) => new Promise<T>((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms);
  s.once(ev, (d: T) => { clearTimeout(t); res(d); });
});
