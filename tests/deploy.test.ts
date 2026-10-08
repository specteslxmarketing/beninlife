import { describe, it, expect } from 'vitest';
import { openDb } from '../server/src/db.js';
import { seedAdmin } from '../server/src/app.js';
import { loginUser } from '../server/src/auth.js';

describe('admin seeding for hosted deploys (ADMIN_PASSWORD)', () => {
  it('uses ADMIN_PASSWORD from the environment and keeps it in sync', async () => {
    const db = openDb(':memory:');
    expect(await seedAdmin(db, undefined, 'correct-horse-battery-1')).toBeNull(); // nothing generated / logged
    expect((await loginUser(db, 'bestx', 'correct-horse-battery-1')).username).toBe('bestx');
    await seedAdmin(db, undefined, 'another-strong-pass-2'); // changed env → password updated on next start
    expect((await loginUser(db, 'bestx', 'another-strong-pass-2')).username).toBe('bestx');
    await expect(loginUser(db, 'bestx', 'correct-horse-battery-1')).rejects.toThrow();
  });
  it('refuses a weak ADMIN_PASSWORD and generates a strong one instead', async () => {
    const db = openDb(':memory:');
    const pw = await seedAdmin(db, undefined, 'short');
    expect(pw && pw.length).toBeGreaterThanOrEqual(16);
    await expect(loginUser(db, 'bestx', 'short')).rejects.toThrow();
  });
});
