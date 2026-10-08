import { describe, expect, it } from 'vitest';
import { lightState, LIGHT_CYCLE } from '../shared/constants.js';

describe('roundabout traffic lights', () => {
  it('never shows green to both axes, and each axis gets green + amber + red every cycle', () => {
    const seen = [new Set<string>(), new Set<string>()];
    for (let t = 0; t < LIGHT_CYCLE * 2; t += 0.25) {
      const a = lightState(0, t), b = lightState(1, t);
      expect(a === 'green' && b === 'green').toBe(false);
      expect(a !== 'red' && b !== 'red').toBe(false); // one axis is always held at red
      seen[0].add(a); seen[1].add(b);
    }
    for (const s of seen) expect([...s].sort()).toEqual(['amber', 'green', 'red']);
  });
  it('is periodic and works for negative / large clock values', () => {
    expect(lightState(0, 5)).toBe(lightState(0, 5 + LIGHT_CYCLE * 1000));
    expect(lightState(1, -3)).toBe(lightState(1, LIGHT_CYCLE - 3));
  });
});
