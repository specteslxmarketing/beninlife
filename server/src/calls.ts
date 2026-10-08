// Server side of player-to-player voice calls: WebRTC signalling relay + call state + call log.
// Media never touches the server; only SDP/ICE messages are relayed between the two participants.
import type { Server } from 'socket.io';
import type { DB } from './db.js';

export interface ActiveCall { id: number; caller: number; callee: number; state: 'ringing' | 'active'; timer?: NodeJS.Timeout }
export type CallResult = { ok: true; callId: number } | { ok: false; error: string; callId?: number };

export class CallManager {
  active = new Map<number, ActiveCall>();
  private byUser = new Map<number, number>();

  constructor(private db: DB, private io: Server, private isOnline: (uid: number) => boolean, public ringTimeoutMs = 30_000) {}

  private insert(caller: number, callee: number, status: string, reason: string | null): number {
    const now = Date.now();
    const info = this.db.prepare('INSERT INTO calls (caller_id, callee_id, status, reason, created_at, ended_at) VALUES (?,?,?,?,?,?)')
      .run(caller, callee, status, reason, now, status === 'ringing' ? null : now);
    return Number(info.lastInsertRowid);
  }
  private finish(c: ActiveCall, status: string, reason: string): void {
    if (c.timer) clearTimeout(c.timer);
    this.active.delete(c.id); this.byUser.delete(c.caller); this.byUser.delete(c.callee);
    this.db.prepare('UPDATE calls SET status = ?, reason = ?, ended_at = ? WHERE id = ?').run(status, reason, Date.now(), c.id);
    for (const u of [c.caller, c.callee]) this.io.to(`u:${u}`).emit('call:ended', { callId: c.id, status, reason });
  }

  start(caller: number, callee: number): CallResult {
    if (caller === callee) return { ok: false, error: 'You cannot call yourself' };
    const exists = this.db.prepare('SELECT id FROM users WHERE id = ?').get(callee);
    if (!exists) return { ok: false, error: 'No such player' };
    if (!this.isOnline(callee)) return { ok: false, error: 'offline', callId: this.insert(caller, callee, 'missed', 'offline') };
    if (this.byUser.has(caller)) return { ok: false, error: 'You are already in a call' };
    if (this.byUser.has(callee)) return { ok: false, error: 'busy', callId: this.insert(caller, callee, 'missed', 'busy') };
    const id = this.insert(caller, callee, 'ringing', null);
    const c: ActiveCall = { id, caller, callee, state: 'ringing' };
    c.timer = setTimeout(() => this.finish(c, 'missed', 'no-answer'), this.ringTimeoutMs);
    this.active.set(id, c); this.byUser.set(caller, id); this.byUser.set(callee, id);
    const name = (this.db.prepare('SELECT display_name FROM users WHERE id = ?').get(caller) as { display_name: string }).display_name;
    this.io.to(`u:${callee}`).emit('call:incoming', { callId: id, from: caller, fromName: name });
    return { ok: true, callId: id };
  }

  answer(uid: number, callId: number): CallResult {
    const c = this.active.get(callId);
    if (!c || c.callee !== uid || c.state !== 'ringing') return { ok: false, error: 'No such ringing call' };
    if (c.timer) clearTimeout(c.timer);
    c.state = 'active';
    this.db.prepare("UPDATE calls SET status = 'answered', answered_at = ? WHERE id = ?").run(Date.now(), callId);
    this.io.to(`u:${c.caller}`).emit('call:answered', { callId });
    return { ok: true, callId };
  }

  reject(uid: number, callId: number): CallResult {
    const c = this.active.get(callId);
    if (!c || c.callee !== uid || c.state !== 'ringing') return { ok: false, error: 'No such ringing call' };
    this.finish(c, 'rejected', 'declined');
    return { ok: true, callId };
  }

  hangup(uid: number, callId: number): CallResult {
    const c = this.active.get(callId);
    if (!c || (c.caller !== uid && c.callee !== uid)) return { ok: false, error: 'Not in this call' };
    if (c.state === 'ringing') this.finish(c, 'missed', 'cancelled'); else this.finish(c, 'ended', 'hangup');
    return { ok: true, callId };
  }

  /** Relay an SDP offer/answer or ICE candidate to the other participant of an ACTIVE call only. */
  signal(uid: number, callId: number, data: unknown): boolean {
    const c = this.active.get(callId);
    if (!c || c.state !== 'active' || (c.caller !== uid && c.callee !== uid)) return false;
    if (JSON.stringify(data ?? null).length > 20_000) return false;
    const other = c.caller === uid ? c.callee : c.caller;
    this.io.to(`u:${other}`).emit('call:signal', { callId, data });
    return true;
  }

  userDisconnected(uid: number): void {
    const id = this.byUser.get(uid);
    const c = id !== undefined ? this.active.get(id) : undefined;
    if (c) this.finish(c, c.state === 'ringing' ? 'missed' : 'ended', 'disconnected');
  }

  log(uid: number, limit = 30) {
    return this.db.prepare(`SELECT c.id, c.caller_id, c.callee_id, c.status, c.reason, c.created_at, c.answered_at, c.ended_at,
        a.display_name AS caller_name, b.display_name AS callee_name
      FROM calls c JOIN users a ON a.id = c.caller_id JOIN users b ON b.id = c.callee_id
      WHERE c.caller_id = ? OR c.callee_id = ? ORDER BY c.id DESC LIMIT ?`).all(uid, uid, limit) as {
        id: number; caller_id: number; callee_id: number; status: string; reason: string | null; created_at: number; answered_at: number | null; ended_at: number | null; caller_name: string; callee_name: string }[];
  }
}

export function addContact(db: DB, owner: number, contact: number): boolean {
  if (owner === contact || !db.prepare('SELECT id FROM users WHERE id = ?').get(contact)) return false;
  db.prepare('INSERT OR IGNORE INTO contacts (owner_id, contact_id, created_at) VALUES (?,?,?)').run(owner, contact, Date.now());
  return true;
}
export function removeContact(db: DB, owner: number, contact: number): void {
  db.prepare('DELETE FROM contacts WHERE owner_id = ? AND contact_id = ?').run(owner, contact);
}
export function listContacts(db: DB, owner: number): { id: number; name: string }[] {
  return db.prepare('SELECT u.id, u.display_name AS name FROM contacts c JOIN users u ON u.id = c.contact_id WHERE c.owner_id = ? ORDER BY u.display_name').all(owner) as { id: number; name: string }[];
}
