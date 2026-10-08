// BENINLIFE car radio: four stations of ORIGINAL music composed procedurally in the browser (Web Audio synthesis,
// no samples, no third-party recordings). Afrobeats / Amapiano / Highlife / Afro-pop *styles* — every melody,
// chord progression and groove here is generated from seeds, so nothing is copied from a real song.
// Like real radio, a station is a function of the (server-synced) clock: everyone tuned to the same station hears
// the same song at the same moment.

type Ctx = BaseAudioContext;
type Genre = 'afrobeats' | 'amapiano' | 'highlife' | 'afropop';
type ChordQ = 'm7' | 'maj7' | '7' | 'm9' | 'maj' | 'm' | 'add9';
interface Track { title: string; artist: string; key: number; prog: [number, ChordQ][]; seed: number }
export interface Station { id: string; name: string; freq: string; genre: Genre; bpm: number; swing: number; tracks: Track[] }

const CHORD: Record<ChordQ, number[]> = { m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], '7': [0, 4, 7, 10], m9: [0, 3, 7, 10, 14], maj: [0, 4, 7, 12], m: [0, 3, 7, 12], add9: [0, 4, 7, 14] };
const P = {
  minA: [[0, 'm7'], [8, 'maj7'], [3, 'maj7'], [10, '7']], minB: [[0, 'm9'], [0, 'm9'], [5, 'm7'], [5, 'm7']], minC: [[0, 'm7'], [5, 'm7'], [10, '7'], [3, 'maj7']],
  minD: [[0, 'm9'], [10, 'add9'], [8, 'maj7'], [7, 'm7']], majA: [[0, 'maj'], [5, 'maj'], [7, 'maj'], [0, 'maj']], majB: [[0, 'maj7'], [9, 'm7'], [2, 'm7'], [7, '7']],
  majC: [[5, 'maj7'], [7, '7'], [4, 'm7'], [9, 'm7']], majD: [[0, 'add9'], [7, 'maj'], [9, 'm7'], [5, 'maj7']],
} as Record<string, [number, ChordQ][]>;

export const STATIONS: Station[] = [
  { id: 'benin', name: 'Benin FM', freq: '101.1', genre: 'afrobeats', bpm: 108, swing: 0.16, tracks: [
    { title: 'Ring Road Sunset', artist: 'Eghosa Nova', key: 45, prog: P.minA, seed: 11 },
    { title: 'Oba Market Shuffle', artist: 'Osaze & the Uselu Band', key: 50, prog: P.majC, seed: 23 },
    { title: 'Ugbowo Nights', artist: 'Eghosa Nova', key: 47, prog: P.minC, seed: 37 },
    { title: 'Sapele Road Groove', artist: 'Idia Queens', key: 43, prog: P.majB, seed: 41 } ] },
  { id: 'piano', name: 'Oba Amapiano', freq: '95.7', genre: 'amapiano', bpm: 112, swing: 0.22, tracks: [
    { title: 'Log Drum Palace', artist: 'DJ Igun Street', key: 45, prog: P.minB, seed: 53 },
    { title: 'GRA After Hours', artist: 'Ivie Keys', key: 48, prog: P.minD, seed: 67 },
    { title: 'Ekenwan Bounce', artist: 'DJ Igun Street', key: 46, prog: P.majB, seed: 71 },
    { title: 'Midnight at Airport Road', artist: 'Ivie Keys', key: 44, prog: P.minA, seed: 89 } ] },
  { id: 'highlife', name: 'Highlife Gold', freq: '88.3', genre: 'highlife', bpm: 124, swing: 0.08, tracks: [
    { title: 'Palm-Wine Evening', artist: 'Chief Osayande & his Guitar Band', key: 52, prog: P.majA, seed: 97 },
    { title: 'Ogba River', artist: 'The New Bini Stars', key: 50, prog: P.majD, seed: 101 },
    { title: 'Igun Bronze', artist: 'Chief Osayande & his Guitar Band', key: 55, prog: P.majB, seed: 113 } ] },
  { id: 'eko', name: 'Eko Street', freq: '99.9', genre: 'afropop', bpm: 100, swing: 0.06, tracks: [
    { title: 'Lekki Lights', artist: 'Tobi Wave', key: 46, prog: P.majC, seed: 127 },
    { title: 'Danfo Dreams', artist: 'Ada Sunshine', key: 49, prog: P.minD, seed: 131 },
    { title: 'Third Mainland Cruise', artist: 'Tobi Wave', key: 44, prog: P.majD, seed: 149 } ] },
];

const BARS = 32; // intro 4 · groove 8 · hook 8 · break 4 · hook 8
export const trackSeconds = (s: Station): number => BARS * 4 * 60 / s.bpm + 2; // +2 s of air between songs
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
function rng(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** what is playing on a station at absolute time T (seconds) */
export function nowPlaying(s: Station, T: number): { track: Track; index: number; pos: number } {
  const len = trackSeconds(s); const n = Math.floor(T / len);
  const index = ((n % s.tracks.length) + s.tracks.length) % s.tracks.length;
  return { track: s.tracks[index]!, index, pos: T - n * len };
}

interface Song { melody: (number | null)[]; chop: (number | null)[]; logPat: number[]; bassPat: number[]; percPat: number[]; fill: number }
function compose(s: Station, t: Track): Song {
  const r = rng(t.seed * 7919);
  const penta = s.genre === 'highlife' || t.prog === P.majA || t.prog === P.majB || t.prog === P.majC || t.prog === P.majD ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  // 2-bar motif (32 sixteenths), answered with a variation: call & response like a sung hook
  const motif: (number | null)[] = [];
  let deg = Math.floor(r() * 3);
  for (let i = 0; i < 32; i++) {
    const strong = i % 4 === 0, play = strong ? r() < 0.7 : r() < (i % 2 ? 0.28 : 0.42);
    if (!play || i % 16 > 13) { motif.push(null); continue; }
    deg = Math.max(-2, Math.min(7, deg + Math.round((r() - 0.5) * 3)));
    const o = Math.floor(deg / 5), d = ((deg % 5) + 5) % 5; motif.push(penta[d]! + 12 * o);
  }
  const answer = motif.map((m, i) => (m === null ? null : i >= 16 ? m + (r() < 0.4 ? (r() < 0.5 ? -2 : 3) : 0) : m));
  const melody = [...motif, ...answer];
  const chop = Array.from({ length: 32 }, (_, i) => (i % 8 === 2 || i % 8 === 6) && r() < 0.55 ? penta[Math.floor(r() * 5)]! + 12 : null);
  const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)]!;
  const logPat = pick([[0, 3, 6, 10, 11, 14], [0, 3, 7, 10, 12, 14], [0, 2, 6, 8, 11, 13], [0, 3, 6, 9, 12, 14, 15]]);
  const bassPat = pick([[0, 6, 8, 12, 14], [0, 3, 6, 10, 12], [0, 6, 10, 12], [0, 7, 8, 11, 14]]);
  const percPat = pick([[2, 5, 7, 10, 13, 15], [3, 6, 9, 11, 14], [2, 6, 7, 11, 14, 15]]);
  return { melody, chop, logPat, bassPat, percPat, fill: Math.floor(r() * 4) };
}

/**
 * Schedules the music into any (real-time or offline) audio context. Call tick() often (≈every 50 ms) with the
 * absolute clock; it schedules ~0.35 s ahead.
 */
export class RadioEngine {
  private out: GainNode; private drums: GainNode; private music: GainNode; private rev: ConvolverNode; private revIn: GainNode;
  private dly: DelayNode; private dlyIn: GainNode; private noise: AudioBuffer; private ks = new Map<number, AudioBuffer>();
  private shaper: WaveShaperNode;
  private station = 0; private songs = new Map<string, Song>();
  private nextStep = -1; private ctxAtT0 = 0; private T0 = 0;
  onTrack: (s: Station, t: Track) => void = () => {};
  private lastTrack = '';

  constructor(private ctx: Ctx, dest: AudioNode, private lite = false) {
    this.out = ctx.createGain(); this.out.connect(dest);
    // gentle "FM broadcast" tone: high-pass the sub rumble, soft-clip a touch, shelf the top
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 32; hp.connect(this.out);
    const glue = ctx.createDynamicsCompressor(); glue.threshold.value = -16; glue.ratio.value = 3; glue.attack.value = 0.01; glue.release.value = 0.2; glue.connect(hp);
    this.drums = ctx.createGain(); this.drums.gain.value = 0.9; this.drums.connect(glue);
    this.music = ctx.createGain(); this.music.connect(glue);
    // reverb (generated stereo impulse) + tempo delay sends
    this.rev = ctx.createConvolver(); this.rev.buffer = this.impulse(lite ? 1.2 : 2.2); this.revIn = ctx.createGain(); this.revIn.gain.value = 0.5;
    const revOut = ctx.createGain(); revOut.gain.value = 0.35; this.revIn.connect(this.rev).connect(revOut).connect(glue);
    this.dly = ctx.createDelay(1.5); const fb = ctx.createGain(); fb.gain.value = 0.32; const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
    this.dlyIn = ctx.createGain(); this.dlyIn.gain.value = 0.3; this.dlyIn.connect(this.dly); this.dly.connect(dlp).connect(fb).connect(this.dly); dlp.connect(glue);
    this.shaper = ctx.createWaveShaper(); const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * 2.6) / Math.tanh(2.6); } this.shaper.curve = c;
    const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noise = n;
  }
  get stationIndex(): number { return this.station; }
  /** tune to a station; T is the current absolute clock (seconds) */
  tune(i: number, T: number): void { this.station = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length; this.sync(T); this.lastTrack = ''; }
  sync(T: number): void { this.T0 = T; this.ctxAtT0 = this.ctx.currentTime; this.nextStep = -1; }
  setLevel(v: number, at = this.ctx.currentTime): void { this.out.gain.setTargetAtTime(v, at, 0.05); }
  dispose(): void { this.out.disconnect(); }

  tick(ahead = 0.35): void {
    const s = STATIONS[this.station]!; const step = 60 / s.bpm / 4; const len = trackSeconds(s);
    const Tnow = this.T0 + (this.ctx.currentTime - this.ctxAtT0);
    if (this.nextStep < 0) this.nextStep = Math.ceil(Tnow / step);
    while (this.nextStep * step < Tnow + ahead) {
      const T = this.nextStep * step; this.nextStep++;
      const np = nowPlaying(s, T); const k = Math.round(np.pos / step);
      if (np.pos > len - 2) continue; // gap between songs
      if (np.track.title !== this.lastTrack) { this.lastTrack = np.track.title; this.onTrack(s, np.track); }
      const swing = k % 2 === 1 ? s.swing * step : 0;
      const when = this.ctxAtT0 + (T - this.T0) + swing;
      if (when < this.ctx.currentTime - 0.01) continue;
      this.step(s, np.track, k, Math.max(this.ctx.currentTime, when), step);
    }
  }

  // ------------------------------------------------------------------ arrangement
  private song(s: Station, t: Track): Song { const key = s.id + t.title; let g = this.songs.get(key); if (!g) { g = compose(s, t); this.songs.set(key, g); } return g; }
  private step(s: Station, t: Track, k: number, w: number, step: number): void {
    const bar = Math.floor(k / 16), i = k % 16, bar4 = bar % 4;
    const sec = bar < 4 ? 'intro' : bar < 12 ? 'groove' : bar < 20 ? 'hook' : bar < 24 ? 'break' : 'hook';
    const g = this.song(s, t); const [cr, cq] = t.prog[bar4]!; const root = t.key + cr; const tones = CHORD[cq];
    const lastBarOfPhrase = bar % 8 === 7 || bar === 3 || bar === 23;
    const hv = () => 0.88 + Math.random() * 0.24; // humanised velocity
    const drumsOn = sec !== 'intro' && sec !== 'break';
    const fill = lastBarOfPhrase && i >= 12;
    if (s.genre === 'afrobeats') {
      if (drumsOn && [0, 7, 8, 14].includes(i) && !(fill && i === 14)) this.kick(w, 0.9 * hv());
      if (drumsOn && (i === 4 || i === 12)) this.snare(w, 0.42 * hv());
      if (drumsOn || sec === 'break') this.shaker(w, (i % 4 === 2 ? 0.16 : i % 2 ? 0.07 : 0.11) * hv());
      if ([0, 3, 6, 10, 12].includes(i)) this.rim(w, 0.2 * hv());
      if (sec !== 'intro' && g.percPat.includes(i)) this.conga(w, mtof(t.key + 31 + (i % 3 === 0 ? 5 : 0)), 0.22 * hv());
      if (fill) this.talkingDrum(w, mtof(t.key + 24 + (i - 12) * 2), 0.3);
      if (drumsOn && g.bassPat.includes(i)) this.bass(w, mtof(root - 12 + (i === 14 ? 7 : 0)), step * 2.4, 0.5);
      if (i === 0 && sec !== 'break') this.keys(w, tones.map((x) => mtof(root + 12 + x)), step * 6, 0.11);
      if ((i === 6 || i === 10) && sec !== 'intro') this.keys(w, tones.slice(1).map((x) => mtof(root + 12 + x)), step * 1.5, 0.07);
      if (sec === 'hook') this.leadNote(g.melody[(bar % 4) * 16 + i] ?? null, t.key + 12, w, step, 0.12, 'a');
      if (sec === 'break' && i === 0) this.pad(w, tones.map((x) => mtof(root + x)), step * 16, 0.05);
      if (sec === 'break' && g.chop[(bar % 2) * 16 + i] !== null) this.vox(w, mtof(t.key + 12 + g.chop[(bar % 2) * 16 + i]!), step * 2, 0.07, 'o');
    } else if (s.genre === 'amapiano') {
      if (drumsOn && i % 4 === 0) this.kick(w, 0.62 * hv(), true);
      if (drumsOn && (i === 4 || i === 12)) this.clap(w, 0.34 * hv());
      if (sec !== 'intro') this.shaker(w, (i % 2 ? 0.06 : 0.12) * hv());
      if (drumsOn && i % 4 === 2) this.hat(w, 0.09, true);
      if ([3, 7, 11, 15].includes(i) && Math.random() < 0.5) this.rim(w, 0.12);
      if (sec !== 'intro' && sec !== 'break' && g.logPat.includes(i)) {
        const intv = i === 0 ? 0 : g.logPat.indexOf(i) % 3 === 1 ? 7 : g.logPat.indexOf(i) % 3 === 2 ? 12 : 0;
        this.logDrum(w, mtof(root - 12 + intv), i === 0 ? step * 4 : step * 2.2, 0.55);
      }
      if (i === 0) this.pad(w, tones.map((x) => mtof(root + x)), step * 16, sec === 'break' ? 0.07 : 0.035);
      if ([0, 3, 6, 10, 13].includes(i) && sec !== 'intro') this.keys(w, tones.map((x) => mtof(root + 12 + x)), step * (i === 0 ? 3 : 1.2), 0.08);
      if (sec === 'intro' && i % 4 === 0) this.keys(w, tones.map((x) => mtof(root + 12 + x)), step * 3.5, 0.08);
      if (sec === 'hook' && g.chop[(bar % 2) * 16 + i] !== null) this.vox(w, mtof(t.key + 12 + g.chop[(bar % 2) * 16 + i]!), step * 1.6, 0.08, bar % 2 ? 'e' : 'o');
      if (sec === 'hook' && bar % 4 >= 2) this.leadNote(g.melody[(bar % 4) * 16 + i] ?? null, t.key + 24, w, step, 0.05, 'bell');
    } else if (s.genre === 'highlife') {
      if (drumsOn && (i === 0 || i === 8 || (i === 10 && bar % 2))) this.kick(w, 0.6 * hv());
      if (drumsOn && (i === 4 || i === 12)) this.snare(w, 0.24 * hv());
      if ([0, 2, 4, 5, 7, 9, 11, 12, 14].includes(i)) this.bell(w, mtof(t.key + 36 + (i === 0 ? 0 : 7)), i === 0 ? 0.08 : 0.045);
      if (sec !== 'intro' && i % 2 === 0) this.shaker(w, 0.06 * hv());
      if (sec !== 'intro' && g.percPat.includes(i)) this.conga(w, mtof(t.key + 31), 0.16 * hv());
      // two interlocking palm-wine guitars
      const arp = [0, 2, 1, 3, 2, 1, 3, 2]; this.pluck(w, mtof(root + 12 + tones[arp[i % 8]! % tones.length]!), i % 2 ? 0.16 : 0.22);
      if (sec !== 'intro' && [3, 6, 11, 14].includes(i)) this.pluck(w, mtof(root + 24 + tones[(i >> 1) % tones.length]!), 0.12);
      if (drumsOn && [0, 6, 8, 12].includes(i)) this.bass(w, mtof(root - 12 + (i === 12 ? 7 : 0)), step * 2, 0.42);
      if (sec === 'hook') this.leadNote(g.melody[(bar % 4) * 16 + i] ?? null, t.key + 24, w, step, 0.07, 'horn');
      if (sec === 'break' && i === 0) this.pad(w, tones.map((x) => mtof(root + x)), step * 16, 0.05);
    } else { // afropop
      if (drumsOn && [0, 6, 10].includes(i)) this.kick(w, 0.85 * hv());
      if (drumsOn && i === 8) this.clap(w, 0.4 * hv());
      if (drumsOn) this.hat(w, (i % 2 ? 0.04 : 0.07) * hv(), false);
      if (fill && i % 1 === 0) this.hat(w + step / 2, 0.04, false);
      if (sec !== 'intro' && [3, 7, 11].includes(i)) this.rim(w, 0.12);
      if (drumsOn && [0, 6, 10].includes(i)) this.sub(w, mtof(root - 12), mtof(root - 12 + (i === 10 ? 12 : 0)), step * 3.5, 0.5);
      if (i % 4 === 0 || i % 8 === 6) this.pluck(w, mtof(root + 12 + tones[(i / 2 | 0) % tones.length]!), 0.12);
      if (i === 0) this.pad(w, tones.map((x) => mtof(root + x)), step * 16, sec === 'intro' || sec === 'break' ? 0.06 : 0.035);
      if (sec === 'hook') this.leadNote(g.melody[(bar % 4) * 16 + i] ?? null, t.key + 12, w, step, 0.11, 'a');
      if (sec === 'groove' && g.chop[(bar % 2) * 16 + i] !== null) this.vox(w, mtof(t.key + 12 + g.chop[(bar % 2) * 16 + i]!), step * 1.4, 0.05, 'e');
    }
  }
  private leadNote(m: number | null, base: number, w: number, step: number, v: number, kind: 'a' | 'bell' | 'horn'): void {
    if (m === null) return;
    const f = mtof(base + m);
    if (kind === 'bell') this.bell(w, f, v); else if (kind === 'horn') this.horn(w, f, step * 1.8, v); else this.vox(w, f, step * 1.8, v, 'a', true);
  }

  // ------------------------------------------------------------------ instruments
  private env(g: GainNode, w: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), w + a); g.gain.exponentialRampToValueAtTime(0.0001, w + a + d);
  }
  private osc(type: OscillatorType, f: number, w: number, dur: number): OscillatorNode { const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, w); o.start(w); o.stop(w + dur + 0.05); return o; }
  private gain(v = 1): GainNode { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  private pan(p: number, to: AudioNode): AudioNode {
    if (!('createStereoPanner' in this.ctx)) return to;
    const n = this.ctx.createStereoPanner(); n.pan.value = p; n.connect(to); return n;
  }
  private noiseSrc(w: number, dur: number): AudioBufferSourceNode { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.start(w, Math.random() * 1.5); s.stop(w + dur + 0.05); return s; }
  private filt(type: BiquadFilterType, f: number, q = 0.7): BiquadFilterNode { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  private duck(w: number, depth: number): void { const g = this.music.gain; g.cancelScheduledValues(w); g.setValueAtTime(1 - depth, w); g.linearRampToValueAtTime(1, w + 0.22); }

  private kick(w: number, v: number, soft = false): void {
    const o = this.osc('sine', soft ? 120 : 165, w, 0.45); o.frequency.exponentialRampToValueAtTime(soft ? 46 : 44, w + (soft ? 0.09 : 0.11));
    const g = this.gain(); this.env(g, w, 0.002, v, soft ? 0.32 : 0.42); o.connect(g).connect(this.drums);
    const c = this.noiseSrc(w, 0.02); const cg = this.gain(); this.env(cg, w, 0.001, v * 0.18, 0.012); c.connect(this.filt('highpass', 3000)).connect(cg).connect(this.drums);
    this.duck(w, soft ? 0.25 : 0.4);
  }
  private snare(w: number, v: number): void {
    const n = this.noiseSrc(w, 0.2); const g = this.gain(); this.env(g, w, 0.002, v, 0.16); n.connect(this.filt('bandpass', 1800, 0.8)).connect(g).connect(this.pan(0.05, this.drums)); g.connect(this.revIn);
    const o = this.osc('triangle', 210, w, 0.1); o.frequency.exponentialRampToValueAtTime(160, w + 0.08); const og = this.gain(); this.env(og, w, 0.002, v * 0.7, 0.08); o.connect(og).connect(this.drums);
  }
  private clap(w: number, v: number): void {
    const out = this.pan(-0.05, this.drums);
    for (const [dt, vv] of [[0, 0.6], [0.011, 0.7], [0.022, 1]] as const) { const n = this.noiseSrc(w + dt, 0.18); const g = this.gain(); this.env(g, w + dt, 0.001, v * vv, dt === 0.022 ? 0.15 : 0.012); n.connect(this.filt('bandpass', 1300, 1.1)).connect(g).connect(out); g.connect(this.revIn); }
  }
  private rim(w: number, v: number): void {
    const o = this.osc('sine', 1650, w, 0.04); const g = this.gain(); this.env(g, w, 0.001, v, 0.03); o.connect(g).connect(this.pan(0.35, this.drums));
    const n = this.noiseSrc(w, 0.03); const ng = this.gain(); this.env(ng, w, 0.001, v * 0.6, 0.02); n.connect(this.filt('bandpass', 3200, 5)).connect(ng).connect(this.pan(0.35, this.drums));
  }
  private hat(w: number, v: number, open: boolean): void {
    const n = this.noiseSrc(w, open ? 0.3 : 0.05); const g = this.gain(); this.env(g, w, 0.001, v, open ? 0.22 : 0.035); n.connect(this.filt('highpass', open ? 7000 : 8500)).connect(g).connect(this.pan(-0.25, this.drums));
  }
  private shaker(w: number, v: number): void {
    const n = this.noiseSrc(w, 0.08); const g = this.gain(); this.env(g, w, 0.012, v, 0.05); n.connect(this.filt('bandpass', 6200, 1.3)).connect(g).connect(this.pan(0.3, this.drums));
  }
  private conga(w: number, f: number, v: number): void {
    const o = this.osc('sine', f * 1.25, w, 0.25); o.frequency.exponentialRampToValueAtTime(f, w + 0.03);
    const g = this.gain(); this.env(g, w, 0.002, v, 0.2); o.connect(g).connect(this.pan(-0.4, this.drums)); g.connect(this.revIn);
  }
  private talkingDrum(w: number, f: number, v: number): void { // pitch bends up, like a squeezed dùndún
    const o = this.osc('sine', f, w, 0.35); o.frequency.exponentialRampToValueAtTime(f * 1.55, w + 0.14);
    const o2 = this.osc('triangle', f * 2, w, 0.3); o2.frequency.exponentialRampToValueAtTime(f * 3.1, w + 0.14);
    const g = this.gain(); this.env(g, w, 0.003, v, 0.28); o.connect(g); const g2 = this.gain(0.15); o2.connect(g2).connect(g); g.connect(this.pan(0.45, this.drums)); g.connect(this.revIn);
  }
  private bell(w: number, f: number, v: number): void { // FM agogo/bell
    const c = this.osc('sine', f, w, 0.6), m = this.osc('sine', f * 3.5, w, 0.6); const mg = this.gain(); mg.gain.setValueAtTime(f * 2.2, w); mg.gain.exponentialRampToValueAtTime(f * 0.05, w + 0.4);
    m.connect(mg).connect(c.frequency); const g = this.gain(); this.env(g, w, 0.002, v, 0.45); c.connect(g).connect(this.pan(0.5, this.music)); g.connect(this.revIn);
  }
  private bass(w: number, f: number, dur: number, v: number): void {
    const o = this.osc('sine', f, w, dur), o2 = this.osc('square', f, w, dur); const lp = this.filt('lowpass', 380);
    const g = this.gain(); this.env(g, w, 0.006, v, dur); const g2 = this.gain(0.18); o.connect(g); o2.connect(g2).connect(lp).connect(g); g.connect(this.music);
  }
  private sub(w: number, f: number, f2: number, dur: number, v: number): void { // sliding 808-style sub
    const o = this.osc('sine', f, w, dur); if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, w + dur * 0.5);
    const g = this.gain(); this.env(g, w, 0.005, v, dur); o.connect(this.shaper).connect(g).connect(this.music);
  }
  private logDrum(w: number, f: number, dur: number, v: number): void { // the Amapiano "log drum": bouncy, saturated, pitch-dropping
    const o = this.osc('sine', f * 1.6, w, dur); o.frequency.exponentialRampToValueAtTime(f, w + 0.05);
    const o2 = this.osc('triangle', f * 2, w, dur); o2.frequency.exponentialRampToValueAtTime(f * 2, w + 0.05);
    const pre = this.gain(1.6); o.connect(pre); const g2 = this.gain(0.25); o2.connect(g2).connect(pre);
    const sh = this.ctx.createWaveShaper(); sh.curve = this.shaper.curve; const lp = this.filt('lowpass', 1100, 1.2);
    const g = this.gain(); this.env(g, w, 0.004, v, dur); pre.connect(sh).connect(lp).connect(g).connect(this.music);
  }
  private keys(w: number, fs: number[], dur: number, v: number): void { // FM electric piano
    fs.forEach((f, idx) => {
      const c = this.osc('sine', f, w, dur + 0.4), m = this.osc('sine', f, w, dur + 0.4); const mg = this.gain(); mg.gain.setValueAtTime(f * 1.4, w); mg.gain.exponentialRampToValueAtTime(f * 0.12, w + 0.5);
      m.connect(mg).connect(c.frequency);
      const g = this.gain(); g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(v, w + 0.006); g.gain.exponentialRampToValueAtTime(v * 0.35, w + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, w + dur + 0.35);
      c.connect(g).connect(this.pan((idx / Math.max(1, fs.length - 1) - 0.5) * 0.6, this.music)); g.connect(this.revIn);
    });
  }
  private pad(w: number, fs: number[], dur: number, v: number): void {
    const lp = this.filt('lowpass', 900, 0.5); lp.frequency.setValueAtTime(500, w); lp.frequency.linearRampToValueAtTime(1500, w + dur * 0.6);
    const g = this.gain(); g.gain.setValueAtTime(0.0001, w); g.gain.linearRampToValueAtTime(v, w + Math.min(1.2, dur * 0.3)); g.gain.setValueAtTime(v, w + dur * 0.8); g.gain.linearRampToValueAtTime(0.0001, w + dur + 0.6);
    lp.connect(g).connect(this.music); g.connect(this.revIn);
    for (const f of fs) for (const det of this.lite ? [0] : [-7, 7]) { const o = this.osc('sawtooth', f, w, dur + 0.7); o.detune.value = det; o.connect(lp); }
  }
  private pluck(w: number, f: number, v: number): void { // Karplus-Strong guitar, buffers cached per pitch
    const key = Math.round(f * 4); let b = this.ks.get(key);
    if (!b) {
      const sr = this.ctx.sampleRate, len = Math.floor(sr * 1.1); b = this.ctx.createBuffer(1, len, sr); const d = b.getChannelData(0);
      const N = Math.max(2, Math.round(sr / f)); for (let i = 0; i < N; i++) d[i] = (Math.random() * 2 - 1) * 0.8;
      for (let i = N; i < len; i++) d[i] = 0.4985 * (d[i - N]! + d[i - N + 1 < i ? i - N + 1 : i - N]!);
      this.ks.set(key, b);
    }
    const s = this.ctx.createBufferSource(); s.buffer = b; const g = this.gain(v); const hp = this.filt('highpass', 120);
    s.connect(hp).connect(g).connect(this.pan(-0.3, this.music)); g.connect(this.dlyIn); s.start(w); s.stop(w + 1.1);
  }
  private vox(w: number, f: number, dur: number, v: number, vowel: 'a' | 'o' | 'e', legato = false): void { // formant "vocal" synth
    const F: Record<string, number[]> = { a: [800, 1150, 2900], o: [450, 800, 2830], e: [400, 1700, 2600] };
    const o = this.osc('sawtooth', f, w, dur + 0.2); const vib = this.osc('sine', 5.2, w, dur + 0.2); const vg = this.gain(f * 0.012); vib.connect(vg).connect(o.frequency);
    if (legato) { o.frequency.setValueAtTime(f * 0.97, w); o.frequency.exponentialRampToValueAtTime(f, w + 0.05); }
    const g = this.gain(); g.gain.setValueAtTime(0.0001, w); g.gain.exponentialRampToValueAtTime(v, w + 0.03); g.gain.setValueAtTime(v, w + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, w + dur + 0.15);
    F[vowel]!.forEach((ff, idx) => { const bp = this.filt('bandpass', ff, idx === 0 ? 6 : 9); const fg = this.gain([1, 0.5, 0.25][idx]); o.connect(bp).connect(fg).connect(g); });
    g.connect(this.pan(0.1, this.music)); g.connect(this.revIn); g.connect(this.dlyIn);
  }
  private horn(w: number, f: number, dur: number, v: number): void { // brass stab (highlife horn line)
    const lp = this.filt('lowpass', 600, 2); lp.frequency.setValueAtTime(500, w); lp.frequency.exponentialRampToValueAtTime(2600, w + 0.06); lp.frequency.exponentialRampToValueAtTime(1200, w + dur);
    const g = this.gain(); this.env(g, w, 0.025, v, dur); lp.connect(g).connect(this.pan(0.2, this.music)); g.connect(this.revIn);
    for (const det of [-6, 6]) { const o = this.osc('sawtooth', f, w, dur + 0.1); o.detune.value = det; o.connect(lp); }
  }
  private impulse(sec: number): AudioBuffer {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * sec), b = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    return b;
  }
}

/** render a station offline (used by the e2e to verify every station makes sound and to export listening samples) */
export async function renderStation(stationIdx: number, startT: number, seconds: number, sampleRate = 32000): Promise<AudioBuffer> {
  const OAC = (window as unknown as { OfflineAudioContext: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext });
  const C = OAC.OfflineAudioContext ?? OAC.webkitOfflineAudioContext!;
  const ctx = new C(2, Math.ceil(seconds * sampleRate), sampleRate);
  const e = new RadioEngine(ctx, ctx.destination); e.tune(stationIdx, startT);
  e.tick(seconds + 0.5); // schedule everything up front
  return ctx.startRendering();
}

export function wavBase64(buf: AudioBuffer): string {
  const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, bytes = 44 + n * ch * 2; const dv = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  let peak = 1e-6; for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]!)); }
  const norm = Math.min(4, 0.89 / peak); const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c)); let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { dv.setInt16(o, Math.max(-1, Math.min(1, chans[c]![i]! * norm)) * 32767, true); o += 2; }
  let bin = ''; const u8 = new Uint8Array(dv.buffer); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
