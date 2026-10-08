// BENINLIFE sound: everything is synthesised live with the Web Audio API (no third-party sound files).
import { RadioEngine, STATIONS, type Station } from './radio';
// Starts only after the first user gesture (browser autoplay rules). Volume/mute persisted in localStorage.

export interface AudioState {
  mode: string; inCar: boolean; speed: number; walking: number; indoor: boolean; night: number;
  rain: number; marketDist: number; intro: boolean; radio: boolean;
  /** server-synced clock in seconds (radio stations are a function of it, like real broadcast radio) */
  clock?: number; lite?: boolean;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses: Record<'amb' | 'wx' | 'veh' | 'ui' | 'radio', GainNode> = {} as never;
  private noise!: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer };
  private loops: Record<string, { src: AudioScheduledSourceNode[]; gain: GainNode; filter?: BiquadFilterNode }> = {};
  private engine?: { o1: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode };
  volume = Number(localStorage.getItem('bl_volume') ?? '0.7');
  muted = localStorage.getItem('bl_muted') === '1';
  radioOn = localStorage.getItem('bl_radio') !== '0';
  private nextHorn = 4; private nextBird = 1; private nextCricket = 0; private nextStep = 0; private t = 0;
  private ring?: { stop: () => void };
  private radioTimer?: number; private radioEngine?: RadioEngine; private radioBus?: GainNode; private clock = 0; private clockAt = 0;
  station = Math.max(0, Math.min(STATIONS.length - 1, Number(localStorage.getItem('bl_station') ?? '0') || 0));
  radioVolume = Number(localStorage.getItem('bl_radio_vol') ?? '0.8');
  nowTrack: { station: Station; title: string; artist: string } | null = null;
  onTrack: (station: Station, title: string, artist: string) => void = () => {};
  unlocked = false;

  /** call from a user-gesture handler */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC(); this.ctx = ctx;
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.connect(this.master);
    for (const k of ['amb', 'wx', 'veh', 'ui', 'radio'] as const) { const g = ctx.createGain(); g.connect(comp); this.buses[k] = g; }
    this.buses.radio.gain.value = 0.55;
    this.noise = { white: this.makeNoise('white'), pink: this.makeNoise('pink'), brown: this.makeNoise('brown') };
    this.applyVolume();
    // continuous beds
    this.loop('traffic', 'brown', 'amb', 'lowpass', 380);
    this.loop('generator', null, 'amb');
    this.loop('market', 'pink', 'amb', 'bandpass', 900, 0.8);
    this.loop('rain', 'pink', 'wx', 'highpass', 900);
    this.loop('rainLow', 'brown', 'wx', 'lowpass', 600);
    this.loop('cabin', 'brown', 'veh', 'lowpass', 260);
    this.unlocked = true;
  }
  /** where proximity-voice audio goes (respects master volume + mute) */
  voiceOut(): AudioNode | null { return this.ctx ? this.buses.ui : null; }
  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1, v)); localStorage.setItem('bl_volume', String(this.volume)); this.applyVolume(); }
  setMuted(m: boolean): void { this.muted = m; localStorage.setItem('bl_muted', m ? '1' : '0'); this.applyVolume(); }
  setRadio(on: boolean): void { this.radioOn = on; localStorage.setItem('bl_radio', on ? '1' : '0'); }
  setRadioVolume(v: number): void { this.radioVolume = Math.max(0, Math.min(1, v)); localStorage.setItem('bl_radio_vol', String(this.radioVolume)); this.radioEngine?.setLevel(this.radioVolume); }
  /** R key: next station; after the last station the radio switches off, then back to the first */
  nextStation(dir = 1): void {
    if (!this.radioOn) { this.setRadio(true); this.station = dir > 0 ? 0 : STATIONS.length - 1; }
    else if ((dir > 0 && this.station === STATIONS.length - 1) || (dir < 0 && this.station === 0)) { this.setRadio(false); return; }
    else this.station += dir;
    localStorage.setItem('bl_station', String(this.station)); this.nowTrack = null;
    this.radioEngine?.tune(this.station, this.nowClock());
  }
  private nowClock(): number { return this.clock + (performance.now() / 1000 - this.clockAt); }
  private applyVolume(): void { if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05); }

  private makeNoise(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const ctx = this.ctx!; const len = ctx.sampleRate * 3; const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return b;
  }
  private loop(name: string, noise: 'white' | 'pink' | 'brown' | null, bus: keyof AudioEngine['buses'], ftype?: BiquadFilterType, freq = 1000, q = 0.7): void {
    const ctx = this.ctx!; const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(this.buses[bus]);
    const srcs: AudioScheduledSourceNode[] = [];
    let out: AudioNode = gain; let filter: BiquadFilterNode | undefined;
    if (ftype) { filter = ctx.createBiquadFilter(); filter.type = ftype; filter.frequency.value = freq; filter.Q.value = q; filter.connect(gain); out = filter; }
    if (noise) { const s = ctx.createBufferSource(); s.buffer = this.noise[noise]; s.loop = true; s.playbackRate.value = 0.9 + Math.random() * 0.2; s.connect(out); s.start(); srcs.push(s); }
    else { // distant diesel generator: 50 Hz hum with harmonics + slow wobble
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220; lp.connect(gain);
      for (const [f, a] of [[50, 0.5], [100, 0.3], [150, 0.18]] as const) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f + Math.random(); const g = ctx.createGain(); g.gain.value = a; o.connect(g).connect(lp); o.start(); srcs.push(o); }
      const lfo = ctx.createOscillator(); lfo.frequency.value = 3.1; const lg = ctx.createGain(); lg.gain.value = 0.25; lfo.connect(lg).connect(gain.gain); lfo.start(); srcs.push(lfo);
    }
    this.loops[name] = { src: srcs, gain, filter };
  }
  private level(name: string, v: number, tc = 0.4): void { const l = this.loops[name]; if (l && this.ctx) l.gain.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }

  // ---------------- one-shots ----------------
  private env(g: GainNode, t: number, a: number, peak: number, d: number): void { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, bus: keyof AudioEngine['buses'] = 'ui', when = 0, glideTo?: number): void {
    if (!this.ctx) return; const ctx = this.ctx; const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain(); this.env(g, t, 0.01, vol, dur); o.connect(g).connect(this.buses[bus]); o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(noise: 'white' | 'pink' | 'brown', dur: number, vol: number, ftype: BiquadFilterType, freq: number, bus: keyof AudioEngine['buses'] = 'amb', when = 0, freqEnd?: number): void {
    if (!this.ctx) return; const ctx = this.ctx; const t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise[noise]; const f = ctx.createBiquadFilter(); f.type = ftype; f.frequency.setValueAtTime(freq, t); if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain(); this.env(g, t, Math.min(0.02, dur / 4), vol, dur); s.connect(f).connect(g).connect(this.buses[bus]); s.start(t, Math.random() * 2); s.stop(t + dur + 0.1);
  }
  horn(near = true): void { // two detuned square tones like a Nigerian car horn
    const v = near ? 0.16 : 0.03 + Math.random() * 0.03; const d = 0.18 + Math.random() * 0.4;
    for (const f of [415, 520]) this.tone(f * (near ? 1 : 0.97 + Math.random() * 0.06), d, 'square', v, near ? 'veh' : 'amb');
    if (!near && Math.random() < 0.5) for (const f of [415, 520]) this.tone(f, 0.15, 'square', v, 'amb', d + 0.12);
  }
  private sirenGain: GainNode | null = null;
  /** police siren (wail), 0 = off … 1 = right next to the patrol car */
  siren(level: number): void {
    if (!this.ctx) return; const ctx = this.ctx;
    if (!this.sirenGain) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 820;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.42; const lg = ctx.createGain(); lg.gain.value = 330; lfo.connect(lg).connect(o.frequency);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
      this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0; o.connect(f).connect(this.sirenGain).connect(this.buses.veh); o.start(); lfo.start();
    }
    this.sirenGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.07, ctx.currentTime, 0.3);
  }
  /** collision thud + crunch, 0..1 */
  crash(k: number): void { this.burst('brown', 0.5, 0.5 * k + 0.15, 'lowpass', 400, 'veh', 0, 80); this.burst('white', 0.25, 0.25 * k + 0.05, 'bandpass', 2600, 'veh', 0.02, 900); this.tone(70, 0.3, 'sine', 0.4 * k + 0.1, 'veh', 0, 40); }
  /** procedural gunshot: supersonic crack + muzzle blast body + low thump, then a slap-back echo off the buildings. dist in metres, pan -1..1 */
  gunshot(kind: 'pistol' | 'smg' | 'shotgun', dist = 0, pan = 0): void {
    if (!this.ctx) return; const ctx = this.ctx; const t = ctx.currentTime;
    const near = Math.max(0.03, 1 / (1 + dist * 0.06)); const cut = Math.max(900, 9000 / (1 + dist * 0.05));
    const P = ctx.createStereoPanner(); P.pan.value = Math.max(-1, Math.min(1, pan)); P.connect(this.buses.veh);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; lp.connect(P);
    const k = kind === 'shotgun' ? 1.35 : kind === 'smg' ? 0.8 : 1;
    const noise = (buf: AudioBuffer, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, when = 0) => {
      const src = ctx.createBufferSource(); src.buffer = buf; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t + when); f.frequency.exponentialRampToValueAtTime(f1, t + when + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t + when); g.gain.linearRampToValueAtTime(vol, t + when + 0.002); g.gain.exponentialRampToValueAtTime(0.0008, t + when + dur);
      src.connect(f).connect(g).connect(lp); src.start(t + when, Math.random() * 1.5); src.stop(t + when + dur + 0.05);
    };
    noise(this.noise.white, 0.035, 0.9 * near, 'highpass', 3000, 1800);                 // crack
    noise(this.noise.white, 0.16 * k, 0.75 * near * k, 'bandpass', 1400, 300);           // blast
    noise(this.noise.brown, 0.28 * k, 0.9 * near * k, 'lowpass', 500, 90);               // body
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(95 * (kind === 'shotgun' ? 0.75 : 1), t); o.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.7 * near * k, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.16); o.connect(og).connect(lp); o.start(t); o.stop(t + 0.2);
    // urban slap-back echoes
    for (const [d, v] of [[0.09 + dist * 0.002, 0.28], [0.21 + dist * 0.003, 0.14], [0.42, 0.06]]) noise(this.noise.pink, 0.22 * k, v * Math.max(0.15, near) * k, 'bandpass', 900, 260, d);
  }
  reloadSound(kind: 'pistol' | 'smg' | 'shotgun', ms: number): void {
    const s = ms / 1000;
    this.burst('white', 0.03, 0.22, 'bandpass', 3200, 'veh', 0.05); this.tone(900, 0.03, 'square', 0.05, 'veh', 0.06);
    if (kind === 'shotgun') for (let i = 0; i < 4; i++) this.burst('white', 0.04, 0.2, 'bandpass', 2400, 'veh', 0.3 + i * (s - 0.8) / 4);
    this.burst('white', 0.04, 0.28, 'bandpass', 2600, 'veh', s * 0.55); this.burst('brown', 0.05, 0.3, 'lowpass', 900, 'veh', s * 0.55);
    this.burst('white', 0.03, 0.3, 'bandpass', 3800, 'veh', s - 0.15); this.tone(1400, 0.02, 'square', 0.05, 'veh', s - 0.14);
  }
  dryFire(): void { this.burst('white', 0.02, 0.2, 'bandpass', 4200, 'veh'); }
  hitMarker(head = false): void { this.tone(head ? 1900 : 1500, 0.05, 'triangle', 0.12, 'ui'); }
  hurt(): void { this.burst('brown', 0.18, 0.5, 'lowpass', 300, 'ui'); this.tone(60, 0.25, 'sine', 0.35, 'ui', 0, 35); }
  door(): void { this.tone(140, 0.18, 'sine', 0.35, 'ui', 0, 60); this.burst('brown', 0.12, 0.4, 'lowpass', 500, 'ui'); }
  carDoor(): void { this.tone(110, 0.12, 'sine', 0.3, 'veh', 0, 55); this.burst('white', 0.06, 0.15, 'bandpass', 2400, 'veh'); }
  step(): void { this.burst('pink', 0.07, 0.12 + Math.random() * 0.05, 'bandpass', 700 + Math.random() * 500, 'amb'); }
  message(): void { this.tone(880, 0.12, 'sine', 0.22); this.tone(1320, 0.18, 'sine', 0.2, 'ui', 0.12); }
  cash(): void { for (const [f, w] of [[1046, 0], [1318, 0.07], [1568, 0.14]]) this.tone(f, 0.16, 'triangle', 0.18, 'ui', w); }
  thunder(distance: number): void {
    const delay = Math.min(2.5, distance / 340); const v = Math.max(0.15, 0.7 - distance / 1200);
    this.burst('brown', 3.5, v, 'lowpass', 900, 'wx', delay, 60); this.burst('white', 0.4, v * 0.5, 'lowpass', 2500, 'wx', delay, 200);
  }
  /** cabin PA "bing-bong" */
  chime(): void { this.tone(988, 0.9, 'sine', 0.16, 'ui'); this.tone(784, 1.2, 'sine', 0.16, 'ui', 0.55); }
  /** extra engine roar in the cabin during approach/reverse thrust (0..1) */
  cabinBoost = 0;
  /** advisor / PA voice via the browser's built-in speech synthesis (if available); subtitles are always shown */
  say(text: string, who: 'advisor' | 'pa' | 'crew'): void {
    const ss = window.speechSynthesis; if (!ss || this.muted || !this.unlocked) return;
    try {
      ss.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/𝕏/g, 'X'));
      u.volume = Math.min(1, this.volume * (who === 'pa' ? 0.7 : 0.95)); u.rate = who === 'advisor' ? 0.92 : 1.0; u.pitch = who === 'advisor' ? 0.75 : who === 'crew' ? 1.25 : 0.9;
      const en = ss.getVoices().filter((v) => v.lang.startsWith('en'));
      const pick = en.find((v) => /NG|Nigeria/i.test(v.lang + v.name)) ?? en.find((v) => (who === 'crew') === /female|woman|zira|samantha/i.test(v.name)) ?? en[0];
      if (pick) u.voice = pick;
      ss.speak(u);
    } catch { /* speech is optional */ }
  }
  stopSpeech(): void { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } }
  /** intercity travel bed: road rumble (bus) or cabin hum (plane) for the cutscene */
  journey(mode: 'bus' | 'flight', sec: number): void {
    if (mode === 'bus') { this.burst('brown', sec, 0.4, 'lowpass', 180, 'veh'); this.burst('pink', sec, 0.12, 'bandpass', 900, 'veh'); this.horn(false); }
    else { this.burst('brown', sec, 0.35, 'lowpass', 260, 'veh'); this.burst('white', sec, 0.08, 'highpass', 4000, 'veh'); this.chime(); }
  }
  landing(): void { this.burst('brown', 0.6, 0.6, 'lowpass', 300, 'veh'); this.burst('pink', 5, 0.45, 'bandpass', 600, 'veh', 0.4, 2400); }
  /** incoming = phone ringtone; outgoing = ring-back tone. Returns when stopped. */
  startRing(incoming: boolean): void {
    this.stopRing(); if (!this.ctx) return;
    let alive = true; const play = () => {
      if (!alive || !this.ctx) return;
      if (incoming) { [659, 784, 988, 784, 659, 988].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.22, 'ui', i * 0.17)); }
      else { this.tone(425, 1.0, 'sine', 0.08); this.tone(450, 1.0, 'sine', 0.06); }
      timer = window.setTimeout(play, incoming ? 2200 : 3000);
    };
    let timer = 0; play();
    this.ring = { stop: () => { alive = false; clearTimeout(timer); } };
  }
  stopRing(): void { this.ring?.stop(); this.ring = undefined; }

  // ---------------- per-frame mixing ----------------
  update(dt: number, s: AudioState): void {
    if (s.clock !== undefined) { this.clock = s.clock; this.clockAt = performance.now() / 1000; }
    if (!this.ctx) return; this.t += dt;
    const out = !s.indoor && !s.intro; const day = 1 - s.night;
    this.level('traffic', out ? 0.22 + day * 0.18 : s.indoor ? 0.04 : 0);
    this.level('generator', out ? 0.012 + s.night * 0.02 : 0);
    this.level('market', out && s.marketDist < 60 ? 0.22 * (1 - s.marketDist / 60) * day : 0);
    this.level('rain', s.rain * (s.indoor ? 0.05 : s.inCar ? 0.35 : 0.5));
    this.level('rainLow', s.rain * (s.indoor ? 0.18 : 0.25));
    const rl = this.loops.rain?.filter; if (rl) rl.frequency.setTargetAtTime(s.indoor ? 300 : 900, this.ctx.currentTime, 0.3);
    this.level('cabin', s.intro ? 0.45 + this.cabinBoost * 0.5 : 0, 0.8);
    const cf = this.loops.cabin?.filter; if (cf) cf.frequency.setTargetAtTime(260 + this.cabinBoost * 500, this.ctx.currentTime, 0.4);
    if (out) {
      this.nextHorn -= dt; if (this.nextHorn < 0) { this.nextHorn = 5 + Math.random() * 14; this.horn(false); }
      if (day > 0.5) { this.nextBird -= dt; if (this.nextBird < 0) { this.nextBird = 1.5 + Math.random() * 5; const f = 2400 + Math.random() * 2400; for (let i = 0; i < 2 + Math.floor(Math.random() * 4); i++) this.tone(f * (1 + Math.random() * 0.15), 0.07, 'sine', 0.03, 'amb', i * 0.11, f * 1.4); } }
      if (s.night > 0.5 && s.rain < 0.3) { this.nextCricket -= dt; if (this.nextCricket < 0) { this.nextCricket = 0.35 + Math.random() * 0.5; for (let i = 0; i < 3; i++) this.tone(4500 + Math.random() * 300, 0.03, 'sine', 0.025, 'amb', i * 0.045); } }
    }
    // footsteps
    if ((s.mode === 'play' || s.mode === 'intro') && !s.inCar && s.walking > 0.5) { this.nextStep -= dt; if (this.nextStep < 0) { this.nextStep = Math.max(0.26, 0.62 - s.walking * 0.05); this.step(); } }
    // engine
    if (s.inCar && !this.engine) {
      const ctx = this.ctx; const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square';
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; const g = ctx.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g).connect(this.buses.veh); o1.start(); o2.start(); this.engine = { o1, o2, g, f };
    }
    if (this.engine) {
      const sp = Math.abs(s.speed), gearPos = (sp % 9) / 9, rpm = 32 + sp * 1.1 + gearPos * 26;
      const now = this.ctx.currentTime;
      this.engine.o1.frequency.setTargetAtTime(rpm, now, 0.08); this.engine.o2.frequency.setTargetAtTime(rpm * 0.5, now, 0.08);
      this.engine.f.frequency.setTargetAtTime(300 + sp * 40, now, 0.1);
      this.engine.g.gain.setTargetAtTime(s.inCar ? 0.09 + Math.min(0.12, sp * 0.004) : 0, now, 0.15);
      if (!s.inCar && this.engine.g.gain.value < 0.002) { this.engine.o1.stop(); this.engine.o2.stop(); this.engine = undefined; }
    }
    // radio in cars: procedural stations, muffled a little when the windows are "up" in heavy rain
    const radio = s.inCar && this.radioOn && s.radio;
    if (radio && !this.radioEngine) {
      this.radioBus = this.ctx.createGain(); this.radioBus.connect(this.buses.radio);
      this.radioEngine = new RadioEngine(this.ctx, this.radioBus, !!s.lite); this.radioEngine.setLevel(this.radioVolume);
      this.radioEngine.onTrack = (st, tr) => { this.nowTrack = { station: st, title: tr.title, artist: tr.artist }; this.onTrack(st, tr.title, tr.artist); };
      this.radioEngine.tune(this.station, this.nowClock());
      this.radioTimer = window.setInterval(() => this.radioEngine?.tick(), 50);
    }
    if (!radio && this.radioEngine) {
      clearInterval(this.radioTimer); this.radioTimer = undefined;
      const bus = this.radioBus!, eng = this.radioEngine; bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      window.setTimeout(() => { eng.dispose(); bus.disconnect(); }, 1500);
      this.radioEngine = undefined; this.radioBus = undefined; this.nowTrack = null;
    }
  }
}
