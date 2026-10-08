// Client side of voice calls: WebRTC peer connection, signalling over Socket.IO.
// Public STUN only — calls between players behind strict/symmetric NATs need a TURN server in production.
import type { Socket } from 'socket.io-client';
import { emitAck } from './net';

export let ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
/** fetch the server's ICE list (adds TURN in production); falls back to public STUN */
export const iceReady: Promise<void> = fetch('/api/ice').then((r) => r.json() as Promise<{ iceServers: RTCIceServer[] }>).then((j) => { if (Array.isArray(j.iceServers) && j.iceServers.length) ICE_SERVERS = j.iceServers; }).catch(() => undefined);

export type CallPhase = 'idle' | 'calling' | 'incoming' | 'connecting' | 'connected';
export interface CallView { phase: CallPhase; callId: number | null; peerId: number | null; peerName: string; since: number; micOk: boolean; muted: boolean; note: string; rtc: string; outgoing: boolean }

type Signal = { type: 'offer' | 'answer'; sdp: string } | { type: 'ice'; candidate: RTCIceCandidateInit };

export class CallClient {
  view: CallView = { phase: 'idle', callId: null, peerId: null, peerName: '', since: 0, micOk: false, muted: false, note: '', rtc: '', outgoing: false };
  onChange: (v: CallView) => void = () => {};
  onEnded: (status: string, reason: string, peerName: string, outgoing: boolean) => void = () => {};
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private audio = new Audio();
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(private socket: Socket) {
    this.audio.autoplay = true;
    socket.on('call:incoming', (p: { callId: number; from: number; fromName: string }) => {
      if (this.view.phase !== 'idle') return; // server already refuses a second call; ignore just in case
      this.set({ phase: 'incoming', callId: p.callId, peerId: p.from, peerName: p.fromName, note: '', since: Date.now(), outgoing: false });
    });
    socket.on('call:answered', (p: { callId: number }) => { if (p.callId === this.view.callId) void this.startAsCaller(); });
    socket.on('call:signal', (p: { callId: number; data: Signal }) => { if (p.callId === this.view.callId) void this.onSignal(p.data); });
    socket.on('call:ended', (p: { callId: number; status: string; reason: string }) => {
      if (p.callId !== this.view.callId) return;
      const name = this.view.peerName, out = this.view.outgoing; this.cleanup(); this.onEnded(p.status, p.reason, name, out);
    });
  }

  private set(p: Partial<CallView>): void { Object.assign(this.view, p); this.onChange(this.view); }

  async call(peerId: number, peerName: string): Promise<{ ok: boolean; error?: string }> {
    if (this.view.phase !== 'idle') return { ok: false, error: 'Already in a call' };
    this.set({ phase: 'calling', peerId, peerName, callId: null, note: 'Calling…', since: Date.now(), outgoing: true });
    void this.getMic(); // ask for mic permission while it rings
    const r = await emitAck<{ ok: boolean; callId?: number; error?: string }>(this.socket, 'call:start', { to: peerId });
    if (!r.ok) { this.cleanup(); return { ok: false, error: r.error }; }
    this.set({ callId: r.callId!, note: 'Ringing…' });
    return { ok: true };
  }

  async answer(): Promise<void> {
    if (this.view.phase !== 'incoming' || this.view.callId === null) return;
    this.set({ phase: 'connecting', note: 'Connecting…' });
    await this.getMic();
    this.makePc();
    const r = await emitAck<{ ok: boolean; error?: string }>(this.socket, 'call:answer', { callId: this.view.callId });
    if (!r.ok) { const n = this.view.peerName; this.cleanup(); this.onEnded('missed', r.error ?? 'failed', n, false); }
  }
  reject(): void { if (this.view.callId !== null) this.socket.emit('call:reject', { callId: this.view.callId }, () => {}); }
  hangup(): void {
    if (this.view.callId !== null) this.socket.emit('call:hangup', { callId: this.view.callId }, () => {});
    else if (this.view.phase === 'calling') this.cleanup();
  }
  toggleMute(): void {
    const muted = !this.view.muted;
    this.local?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.set({ muted });
  }

  private async getMic(): Promise<void> {
    if (this.local) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      this.set({ micOk: true });
    } catch {
      this.set({ micOk: false, note: window.isSecureContext ? 'Microphone blocked — you can listen only' : 'Microphone needs HTTPS — listen only' });
    }
  }

  private makePc(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    if (this.local) for (const t of this.local.getTracks()) pc.addTrack(t, this.local);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    setTimeout(() => { if (this.pc === pc && this.view.phase === 'connecting') this.set({ note: 'Still connecting… (some networks need a TURN relay)' }); }, 15000);
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ type: 'ice', candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => { this.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]); void this.audio.play().catch(() => {}); };
    pc.onconnectionstatechange = () => {
      this.set({ rtc: pc.connectionState });
      if (pc.connectionState === 'connected') this.set({ phase: 'connected', since: Date.now(), note: '' });
      if (pc.connectionState === 'failed') this.set({ note: 'Could not connect audio (network may need a TURN relay)' });
    };
    return pc;
  }

  private async startAsCaller(): Promise<void> {
    this.set({ phase: 'connecting', note: 'Connecting…' });
    await this.getMic();
    const pc = this.makePc();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: 'offer', sdp: offer.sdp ?? '' });
  }

  private async onSignal(d: Signal): Promise<void> {
    const pc = this.makePc();
    if (d.type === 'offer') {
      await pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      await this.flushIce();
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      this.send({ type: 'answer', sdp: ans.sdp ?? '' });
    } else if (d.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
      await this.flushIce();
    } else if (d.type === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(d.candidate).catch(() => {});
      else this.pendingIce.push(d.candidate);
    }
  }
  private async flushIce(): Promise<void> {
    const list = this.pendingIce; this.pendingIce = [];
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => {});
  }
  private send(data: Signal): void { if (this.view.callId !== null) this.socket.emit('call:signal', { callId: this.view.callId, data }); }

  private cleanup(): void {
    this.pc?.close(); this.pc = null;
    this.local?.getTracks().forEach((t) => t.stop()); this.local = null;
    this.audio.srcObject = null; this.pendingIce = [];
    this.set({ phase: 'idle', callId: null, peerId: null, peerName: '', micOk: false, muted: false, note: '', rtc: '' });
  }
}
