import type { DB } from './db.js';

export class WalletError extends Error {}

export function getBalance(db: DB, userId: number): number {
  const r = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId) as { balance: number } | undefined;
  if (!r) throw new WalletError('no such user');
  return r.balance;
}

/**
 * The ONLY way balances change. Runs atomically and records a transaction row.
 * Positive amount = credit, negative = debit. Throws on insufficient funds.
 */
export function applyTransaction(db: DB, userId: number, amount: number, kind: string, note = ''): number {
  if (!Number.isSafeInteger(amount) || amount === 0) throw new WalletError('invalid amount');
  const run = db.transaction(() => {
    const bal = getBalance(db, userId);
    const next = bal + amount;
    if (next < 0) throw new WalletError('insufficient funds');
    db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(next, userId);
    db.prepare('INSERT INTO transactions (user_id, amount, balance_after, kind, note, created_at) VALUES (?,?,?,?,?,?)')
      .run(userId, amount, next, kind, note, Date.now());
    return next;
  });
  return run();
}

export interface TxRow { id: number; amount: number; balance_after: number; kind: string; note: string; created_at: number }
export function listTransactions(db: DB, userId: number, limit = 30): TxRow[] {
  return db.prepare('SELECT id, amount, balance_after, kind, note, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, limit) as TxRow[];
}
