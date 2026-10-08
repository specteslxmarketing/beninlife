// Proximity voice chat: the server only relays WebRTC signalling (SDP/ICE) between two players who both have voice
// switched on, are in the same city and are within VOICE_RELAY_RANGE. Audio itself is peer-to-peer.
import { dist, type Vec2 } from '../../shared/constants.js';

export const VOICE_RANGE = 30;        // clients fade voices to silence at this distance
export const VOICE_RELAY_RANGE = 45;  // signalling allowed up to here (hysteresis for walking in/out)
export const VOICE_SIGNALS_PER_SEC = 40;

export function voiceRelayAllowed(a: { voice: boolean; pos: Vec2; city: string }, b: { voice: boolean; pos: Vec2; city: string } | undefined): boolean {
  return !!b && a.voice && b.voice && a.city === b.city && dist(a.pos, b.pos) <= VOICE_RELAY_RANGE;
}

/** token bucket per socket */
export class RateLimit {
  private tokens: number; private last: number;
  constructor(private perSec: number, now = Date.now()) { this.tokens = perSec; this.last = now; }
  take(now = Date.now()): boolean {
    this.tokens = Math.min(this.perSec, this.tokens + ((now - this.last) / 1000) * this.perSec); this.last = now;
    if (this.tokens < 1) return false; this.tokens -= 1; return true;
  }
}

/** loudness of a voice at distance d (shared with the client): full within 3 m, silent at VOICE_RANGE */
export function voiceGain(d: number): number { const k = Math.max(0, Math.min(1, 1 - (d - 3) / (VOICE_RANGE - 3))); return k * k; }
