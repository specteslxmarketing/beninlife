import { describe, expect, it } from 'vitest';
import { voiceRelayAllowed, RateLimit, voiceGain, VOICE_RELAY_RANGE, VOICE_RANGE } from '../server/src/voice.js';

const at = (x: number, voice = true, city = 'benin') => ({ voice, pos: { x, z: 0 }, city });
describe('proximity voice', () => {
  it('relays only between nearby players who both enabled voice, in the same city', () => {
    expect(voiceRelayAllowed(at(0), at(10))).toBe(true);
    expect(voiceRelayAllowed(at(0), at(VOICE_RELAY_RANGE + 1))).toBe(false);
    expect(voiceRelayAllowed(at(0), at(5, false))).toBe(false);
    expect(voiceRelayAllowed(at(0, false), at(5))).toBe(false);
    expect(voiceRelayAllowed(at(0), at(5, true, 'lagos'))).toBe(false);
    expect(voiceRelayAllowed(at(0), undefined)).toBe(false);
  });
  it('fades with distance', () => {
    expect(voiceGain(1)).toBe(1); expect(voiceGain(VOICE_RANGE)).toBe(0); expect(voiceGain(VOICE_RANGE + 10)).toBe(0);
    expect(voiceGain(10)).toBeGreaterThan(voiceGain(20));
  });
  it('rate-limits signalling bursts', () => {
    const r = new RateLimit(5, 0); let ok = 0; for (let i = 0; i < 20; i++) if (r.take(0)) ok++;
    expect(ok).toBe(5); expect(r.take(1000)).toBe(true);
  });
});
