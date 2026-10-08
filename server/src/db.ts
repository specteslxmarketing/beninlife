import Database from 'better-sqlite3';

export type DB = Database.Database;

export function openDb(file: string): DB {
  const db = new Database(file);
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
      age_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_seen INTEGER,
      intro_seen INTEGER NOT NULL DEFAULT 0,
      appearance TEXT,
      pos_x REAL, pos_z REAL, rot REAL,
      car_x REAL, car_z REAL, car_rot REAL,
      car_dirt REAL NOT NULL DEFAULT 0.45
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      kind TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,           -- 'global' or 'dm'
      from_id INTEGER NOT NULL REFERENCES users(id),
      to_id INTEGER REFERENCES users(id),
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_msg_dm ON messages(channel, to_id, from_id, id);
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_id INTEGER NOT NULL REFERENCES users(id),
      callee_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,            -- ringing | answered | ended | rejected | missed
      reason TEXT,
      created_at INTEGER NOT NULL, answered_at INTEGER, ended_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_calls ON calls(caller_id, callee_id, id);
    CREATE TABLE IF NOT EXISTS contacts (
      owner_id INTEGER NOT NULL REFERENCES users(id),
      contact_id INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, contact_id)
    );
    CREATE TABLE IF NOT EXISTS houses (
      id TEXT PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id),
      locked INTEGER NOT NULL DEFAULT 1,
      bought_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      model TEXT NOT NULL,
      color TEXT NOT NULL,
      bought_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      owner_id INTEGER NOT NULL REFERENCES users(id),
      item TEXT NOT NULL,
      bought_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, item)
    );
  `);
  // additive migrations for databases created by phase 1
  for (const col of ['outfit TEXT', 'active_vehicle INTEGER', 'wanted INTEGER NOT NULL DEFAULT 0']) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* already exists */ }
  }
  return db;
}

export interface UserRow {
  id: number; username: string; display_name: string; password_hash: string;
  is_admin: number; balance: number; created_at: number; last_seen: number | null;
  intro_seen: number; appearance: string | null;
  pos_x: number | null; pos_z: number | null; rot: number | null;
  car_x: number | null; car_z: number | null; car_rot: number | null; car_dirt: number;
  outfit: string | null; active_vehicle: number | null; wanted: number;
}

export function getUser(db: DB, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}
export function getUserByName(db: DB, username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
}
