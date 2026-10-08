import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { DB, UserRow } from './db.js';
import { getUserByName } from './db.js';
import { START_BALANCE } from '../../shared/constants.js';
import { applyTransaction } from './wallet.js';

export const COOKIE_NAME = 'bl_session';
const BCRYPT_ROUNDS = 10;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}
export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function validateUsername(u: unknown): string | null {
  if (typeof u !== 'string') return 'Username required';
  if (!/^[A-Za-z0-9_]{3,20}$/.test(u)) return 'Username must be 3-20 letters, numbers or _';
  return null;
}
export function validatePassword(p: unknown): string | null {
  if (typeof p !== 'string') return 'Password required';
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (p.length > 128) return 'Password too long';
  return null;
}

export class AuthError extends Error {}

export async function registerUser(db: DB, username: unknown, password: unknown, ageConfirmed: unknown,
  opts: { admin?: boolean; displayName?: string; balance?: number } = {}): Promise<UserRow> {
  const e = validateUsername(username) ?? validatePassword(password);
  if (e) throw new AuthError(e);
  if (ageConfirmed !== true) throw new AuthError('You must confirm you are 18 or older');
  if (getUserByName(db, username as string)) throw new AuthError('Username already taken');
  const hash = await hashPassword(password as string);
  const info = db.prepare(`INSERT INTO users (username, display_name, password_hash, is_admin, balance, age_confirmed, created_at)
    VALUES (?,?,?,?,0,1,?)`).run(username, opts.displayName ?? username, hash, opts.admin ? 1 : 0, Date.now());
  const id = Number(info.lastInsertRowid);
  applyTransaction(db, id, opts.balance ?? START_BALANCE, 'signup_bonus', 'Welcome to Benin City');
  return getUserByName(db, username as string)!;
}

export async function loginUser(db: DB, username: unknown, password: unknown): Promise<UserRow> {
  if (typeof username !== 'string' || typeof password !== 'string') throw new AuthError('Invalid credentials');
  const u = getUserByName(db, username);
  // Always run a compare to reduce user-enumeration timing differences
  const ok = await verifyPassword(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !ok) throw new AuthError('Invalid username or password');
  return u;
}

export function signToken(secret: string, userId: number): string {
  return jwt.sign({ uid: userId }, secret, { expiresIn: '7d' });
}
export function verifyToken(secret: string, token: string | undefined): number | null {
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret) as { uid?: number };
    return typeof p.uid === 'number' ? p.uid : null;
  } catch { return null; }
}

export function randomPassword(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
