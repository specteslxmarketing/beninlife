import { describe, it, expect } from 'vitest';
import { openDb } from '../server/src/db.js';
import { seedAdmin } from '../server/src/app.js';
import { applyTransaction } from '../server/src/wallet.js';
import { seedAdminVehicles } from '../server/src/vehicles.js';
import { ensureCrown, ensureCrownCar, richList, CROWN_FLOOR, CROWN_LEAD } from '../server/src/crown.js';

describe('BEST 𝕏 is always the richest', () => {
  it('keeps a ₦5bn floor, stays ahead of everyone and tops #1 on the rich list', async () => {
    const db = openDb(':memory:'); await seedAdmin(db);
    const admin = db.prepare("SELECT id, balance FROM users WHERE username = 'bestx'").get() as { id: number; balance: number };
    expect(admin.balance).toBeGreaterThanOrEqual(CROWN_FLOOR);
    // spending dips below the floor → restored with a ledger entry
    applyTransaction(db, admin.id, -2_000_000, 'test', 'spend');
    expect(ensureCrown(db)).toBe(2_000_000);
    // a player becomes a billionaire → BEST 𝕏 stays ₦1bn ahead
    db.prepare("INSERT INTO users (username, display_name, password_hash, is_admin, balance, created_at) VALUES ('rich_guy', 'rich_guy', 'x', 0, 0, 0)").run();
    const rid = (db.prepare("SELECT id FROM users WHERE username = 'rich_guy'").get() as { id: number }).id;
    applyTransaction(db, rid, 7_000_000_000, 'test', 'windfall');
    ensureCrown(db);
    const list = richList(db, 5);
    expect(list[0]!.id).toBe(admin.id); expect(list[0]!.balance).toBe(7_000_000_000 + CROWN_LEAD); expect(list[1]!.id).toBe(rid);
    expect((db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND kind = 'crown_reserve'").get(admin.id) as { n: number }).n).toBe(2);
  });
  it('main car is a white GLK-style SUV', async () => {
    const db = openDb(':memory:'); await seedAdmin(db); seedAdminVehicles(db); ensureCrownCar(db);
    const v = db.prepare("SELECT v.model, v.color FROM users u JOIN vehicles v ON v.id = u.active_vehicle WHERE u.username = 'bestx'").get() as { model: string; color: string };
    expect(v.model).toBe('glk'); expect(v.color).toBe('#e9e9e4');
  });
});
