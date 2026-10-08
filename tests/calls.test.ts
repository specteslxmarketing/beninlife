import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, ack, once, wait, type Harness } from './helpers.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); h.srv.game.calls.ringTimeoutMs = 400; });
afterAll(async () => { await h.close(); });

type R = { ok: boolean; callId?: number; error?: string };
type Log = { calls: { id: number; status: string; reason: string; caller_id: number; callee_id: number }[] };

describe('voice call signalling', () => {
  it('ring → answer → SDP/ICE relay → hang up, logged as ended', async () => {
    const a = await h.register('caller_a'); const b = await h.register('callee_b');
    const A = (await h.connect(a.cookie)).s; const B = (await h.connect(b.cookie)).s;
    const incoming = once<{ callId: number; from: number; fromName: string }>(B, 'call:incoming');
    const r = await ack<R>(A, 'call:start', { to: b.id });
    expect(r.ok).toBe(true);
    const inc = await incoming;
    expect(inc).toMatchObject({ callId: r.callId, from: a.id, fromName: 'caller_a' });
    // signalling is refused before the call is answered
    expect(h.srv.game.calls.signal(a.id, r.callId!, { type: 'offer' })).toBe(false);
    const answered = once(A, 'call:answered');
    expect((await ack<R>(B, 'call:answer', { callId: r.callId })).ok).toBe(true);
    await answered;
    const gotOffer = once<{ data: { type: string; sdp: string } }>(B, 'call:signal');
    A.emit('call:signal', { callId: r.callId, data: { type: 'offer', sdp: 'v=0 fake' } });
    expect((await gotOffer).data).toEqual({ type: 'offer', sdp: 'v=0 fake' });
    const gotAnswer = once<{ data: { type: string } }>(A, 'call:signal');
    B.emit('call:signal', { callId: r.callId, data: { type: 'answer', sdp: 'v=0 ans' } });
    expect((await gotAnswer).data.type).toBe('answer');
    const ended = once<{ status: string }>(B, 'call:ended');
    expect((await ack<R>(A, 'call:hangup', { callId: r.callId })).ok).toBe(true);
    expect((await ended).status).toBe('ended');
    const log = await ack<Log>(B, 'calls:log');
    expect(log.calls[0]).toMatchObject({ id: r.callId, status: 'ended', caller_id: a.id, callee_id: b.id });
  });

  it('a third player cannot inject signals into someone else\'s call', async () => {
    const a = await h.register('c3_a'); const b = await h.register('c3_b'); const x = await h.register('c3_x');
    const A = (await h.connect(a.cookie)).s; const B = (await h.connect(b.cookie)).s; const X = (await h.connect(x.cookie)).s;
    const r = await ack<R>(A, 'call:start', { to: b.id });
    await ack(B, 'call:answer', { callId: r.callId });
    let leaked = false; B.on('call:signal', () => { leaked = true; }); A.on('call:signal', () => { leaked = true; });
    X.emit('call:signal', { callId: r.callId, data: { type: 'offer', sdp: 'evil' } });
    expect((await ack<R>(X, 'call:hangup', { callId: r.callId })).ok).toBe(false);
    expect((await ack<R>(X, 'call:answer', { callId: r.callId })).ok).toBe(false);
    await wait(150);
    expect(leaked).toBe(false);
    // the third player calling a busy player is told "busy" and it is logged as missed
    const busy = await ack<R>(X, 'call:start', { to: b.id });
    expect(busy).toMatchObject({ ok: false, error: 'busy' });
    await ack(A, 'call:hangup', { callId: r.callId });
  });

  it('reject is logged as rejected and the caller is told', async () => {
    const a = await h.register('rj_a'); const b = await h.register('rj_b');
    const A = (await h.connect(a.cookie)).s; const B = (await h.connect(b.cookie)).s;
    const inc = once<{ callId: number }>(B, 'call:incoming');
    await ack(A, 'call:start', { to: b.id });
    const { callId } = await inc;
    const ended = once<{ status: string; reason: string }>(A, 'call:ended');
    expect((await ack<R>(B, 'call:reject', { callId })).ok).toBe(true);
    expect(await ended).toMatchObject({ status: 'rejected', reason: 'declined' });
  });

  it('calling an OFFLINE player cannot connect and is logged as missed', async () => {
    const a = await h.register('off_a'); const b = await h.register('off_b');
    const A = (await h.connect(a.cookie)).s;
    const r = await ack<R>(A, 'call:start', { to: b.id });
    expect(r).toMatchObject({ ok: false, error: 'offline' });
    expect(h.srv.game.calls.active.size).toBe(0);
    const B = (await h.connect(b.cookie)).s;
    const log = await ack<Log>(B, 'calls:log');
    expect(log.calls[0]).toMatchObject({ status: 'missed', reason: 'offline', caller_id: a.id });
  });

  it('unanswered call times out as missed; disconnect ends an active call', async () => {
    const a = await h.register('to_a'); const b = await h.register('to_b');
    const A = (await h.connect(a.cookie)).s; const B = (await h.connect(b.cookie)).s;
    const ended = once<{ status: string; reason: string }>(A, 'call:ended');
    const r = await ack<R>(A, 'call:start', { to: b.id });
    expect(await ended).toMatchObject({ status: 'missed', reason: 'no-answer' });
    expect((await ack<R>(B, 'call:answer', { callId: r.callId })).ok).toBe(false);
    const r2 = await ack<R>(A, 'call:start', { to: b.id });
    await ack(B, 'call:answer', { callId: r2.callId });
    const ended2 = once<{ status: string; reason: string }>(A, 'call:ended');
    B.close();
    expect(await ended2).toMatchObject({ status: 'ended', reason: 'disconnected' });
  });

  it('cannot call yourself or a non-existent player', async () => {
    const a = await h.register('self_a'); const A = (await h.connect(a.cookie)).s;
    expect((await ack<R>(A, 'call:start', { to: a.id })).ok).toBe(false);
    expect((await ack<R>(A, 'call:start', { to: 99999 })).ok).toBe(false);
    expect((await ack<R>(A, 'call:start', { to: 'x' })).ok).toBe(false);
  });
});

describe('contacts', () => {
  it('save, list, and remove contacts (server-side, per user)', async () => {
    const a = await h.register('ct_a'); const b = await h.register('ct_b');
    const A = (await h.connect(a.cookie)).s;
    const r = await ack<{ ok: boolean; contacts: { id: number; name: string }[] }>(A, 'contacts:add', { id: b.id });
    expect(r.ok).toBe(true); expect(r.contacts).toEqual([{ id: b.id, name: 'ct_b' }]);
    expect((await ack<{ ok: boolean }>(A, 'contacts:add', { id: a.id })).ok).toBe(false);
    expect((await ack<{ ok: boolean }>(A, 'contacts:add', { id: 424242 })).ok).toBe(false);
    const again = await h.connect(a.cookie);
    expect(again.init.contacts).toEqual([{ id: b.id, name: 'ct_b' }]);
    const rm = await ack<{ contacts: unknown[] }>(A, 'contacts:remove', { id: b.id });
    expect(rm.contacts).toEqual([]);
  });
});
