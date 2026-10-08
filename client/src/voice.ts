// Proximity voice chat (WebRTC mesh between nearby players; the server only relays signalling).
// Mic permission is requested only when the player switches voice on (user gesture). Push-to-talk (hold V / the mic
// button) or open mic. Each remote voice runs through Web Audio with a distance fade + stereo panning, and an
// analyser drives the "speaking" indicator. Works in Safari (playsinline audio element + webkit prefixes handled).
import type { Socket } from 'socket.io-client';
import { ICE_SERVERS, iceReady } from './calls';

export const VOICE_RANGE = 30;
export const voiceGain = (d: number): number => { const k = Math.max(0, Math.min(1, 1 - (d - 3) / (VOICE_RANGE - 3))); return k * k; };

interface Peer { pc: RTCPeerConnection; el?: HTMLAudioElement; src?: MediaStreamAudioSourceNode; gain?: GainNode; pan?: StereoPannerNode; an?: AnalyserNode; level: number; makingOffer: boolean }
export interface VoiceTarget { id: number; x: number; z: number; voice: boolean }

export class VoiceChat {
  on = false; mode: 'ptt' | 'open' = (localStorage.getItem('bl_voice_mode') as 'ptt' | 'open') || 'ptt';
  talking = false; deafened = false; error = '';
  private stream: MediaStream | null = null; private peers = new Map<number, Peer>(); private acc = 0;
  private buf = new Uint8Array(256);
  constructor(private socket: Socket, private myId: () => number, private ctx: () => AudioContext | null, private out: () => AudioNode | null = () => null) {
    socket.on('voice:signal', (m: { from: number; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => { void this.onSignal(m.from, m.data); });
  }
  get peerCount(): number { return this.peers.size; }
  speaking(id: number): boolean { return (this.peers.get(id)?.level ?? 0) > 0.04; }

  async enable(): Promise<boolean> {
    if (this.on) return true;
    this.error = '';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no microphone access (needs HTTPS)');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { this.error = e instanceof Error ? e.message : String(e); return false; }
    this.on = true; this.setTalking(this.mode === 'open');
    this.socket.emit('voice:set', { on: true });
    await iceReady;
    return true;
  }
  disable(): void {
    if (!this.on) return;
    this.on = false; this.socket.emit('voice:set', { on: false });
    for (const id of [...this.peers.keys()]) this.close(id);
    this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; this.talking = false;
  }
  setMode(m: 'ptt' | 'open'): void { this.mode = m; localStorage.setItem('bl_voice_mode', m); this.setTalking(m === 'open'); }
  /** mic track on/off (push-to-talk) */
  setTalking(t: boolean): void { this.talking = t && this.on; this.stream?.getAudioTracks().forEach((tr) => { tr.enabled = this.talking; }); }

  /** call every frame with my position + yaw and the nearby players */
  update(dt: number, me: { x: number; z: number; yaw: number }, others: VoiceTarget[]): void {
    if (!this.on) return;
    this.acc += dt;
    if (this.acc > 0.5) { // connect / disconnect by distance twice a second
      this.acc = 0;
      for (const o of others) {
        const d = Math.hypot(o.x - me.x, o.z - me.z);
        if (o.voice && d < VOICE_RANGE + 4 && !this.peers.has(o.id) && this.myId() < o.id) void this.call(o.id);
        if ((!o.voice || d > VOICE_RANGE + 12) && this.peers.has(o.id)) this.close(o.id);
      }
      for (const id of this.peers.keys()) if (!others.some((o) => o.id === id)) this.close(id);
    }
    const ac = this.ctx();
    for (const o of others) {
      const p = this.peers.get(o.id); if (!p) continue;
      const d = Math.hypot(o.x - me.x, o.z - me.z), g = this.deafened ? 0 : voiceGain(d);
      if (p.gain && ac) p.gain.gain.setTargetAtTime(g, ac.currentTime, 0.1); else if (p.el) p.el.volume = g;
      if (p.pan) { const ang = Math.atan2(o.x - me.x, o.z - me.z) - me.yaw; p.pan.pan.value = Math.max(-1, Math.min(1, -Math.sin(ang) * 0.8)); }
      if (p.an) { p.an.getByteTimeDomainData(this.buf); let sum = 0; for (const v of this.buf) { const x = (v - 128) / 128; sum += x * x; } p.level = Math.sqrt(sum / this.buf.length) * (g > 0 ? 1 : 0); }
    }
  }

  private newPeer(id: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peer: Peer = { pc, level: 0, makingOffer: false };
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream!));
    pc.onicecandidate = (e) => { if (e.candidate) this.socket.emit('voice:signal', { to: id, data: { candidate: e.candidate.toJSON() } }); };
    pc.ontrack = (e) => this.attach(peer, e.streams[0] ?? new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.close(id); };
    this.peers.set(id, peer); return peer;
  }
  private attach(p: Peer, stream: MediaStream): void {
    if (p.el) return;
    const el = document.createElement('audio'); el.autoplay = true; el.setAttribute('playsinline', ''); el.srcObject = stream; p.el = el;
    const ac = this.ctx();
    if (ac) {
      // Chrome only feeds remote WebRTC audio into Web Audio while a media element plays it, so keep it muted
      el.muted = true;
      p.src = ac.createMediaStreamSource(stream); p.gain = ac.createGain(); p.gain.gain.value = 0;
      p.an = ac.createAnalyser(); p.an.fftSize = 256; p.src.connect(p.an);
      const dest = this.out() ?? ac.destination; // through the game's master volume / mute
      if ('createStereoPanner' in ac) { p.pan = ac.createStereoPanner(); p.src.connect(p.gain).connect(p.pan).connect(dest); }
      else p.src.connect(p.gain).connect(dest);
    }
    document.body.appendChild(el); el.style.display = 'none'; void el.play().catch(() => undefined);
  }
  private async call(id: number): Promise<void> {
    const p = this.newPeer(id);
    try { p.makingOffer = true; const o = await p.pc.createOffer(); await p.pc.setLocalDescription(o); this.socket.emit('voice:signal', { to: id, data: { sdp: p.pc.localDescription!.toJSON() } }); }
    catch { this.close(id); } finally { p.makingOffer = false; }
  }
  private async onSignal(from: number, data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }): Promise<void> {
    if (!this.on) return;
    try {
      if (data.sdp) {
        let p = this.peers.get(from);
        if (data.sdp.type === 'offer') {
          if (p && p.makingOffer) return; // glare: the lower id is the offerer by rule, ignore the other offer
          p = p ?? this.newPeer(from);
          await p.pc.setRemoteDescription(data.sdp);
          const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a);
          this.socket.emit('voice:signal', { to: from, data: { sdp: p.pc.localDescription!.toJSON() } });
        } else if (p) await p.pc.setRemoteDescription(data.sdp);
      } else if (data.candidate) { const p = this.peers.get(from); if (p) await p.pc.addIceCandidate(data.candidate).catch(() => undefined); }
    } catch { this.close(from); }
  }
  /** negotiation state for tests/HUD */
  states(): Record<number, string> { const o: Record<number, string> = {}; for (const [id, p] of this.peers) o[id] = `${p.pc.signalingState}/${p.pc.connectionState}`; return o; }
  private close(id: number): void {
    const p = this.peers.get(id); if (!p) return;
    this.peers.delete(id);
    try { p.pc.close(); } catch { /* ignore */ }
    p.src?.disconnect(); p.gain?.disconnect(); p.pan?.disconnect(); p.el?.remove();
  }
}
