import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';
import type { DB } from './db.js';
import { getUser, getUserByName } from './db.js';
import { AuthError, COOKIE_NAME, hashPassword, loginUser, parseCookies, randomPassword, registerUser, signToken, verifyPassword, verifyToken } from './auth.js';
import { Game } from './game.js';
import { ADMIN_BALANCE, ADMIN_DISPLAY, ADMIN_USERNAME, validAppearance } from '../../shared/constants.js';

export interface AppOptions { db: DB; secret: string; clientDir?: string }

export function createServer(opts: AppOptions) {
  const { db, secret } = opts;
  const app = express();
  if (process.env.BL_TRUST_PROXY !== '0') app.set('trust proxy', 1); // behind Render/Railway/Fly/nginx TLS terminators
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: false } });
  const game = new Game(db, io);

  const failed = new Map<string, { n: number; until: number }>();

  const setSession = (res: express.Response, uid: number) => {
    res.cookie(COOKIE_NAME, signToken(secret, uid), { httpOnly: true, sameSite: 'lax', secure: process.env.BL_SECURE_COOKIES ? process.env.BL_SECURE_COOKIES === '1' : process.env.NODE_ENV === 'production', maxAge: 7 * 864e5, path: '/' });
  };
  const authed = (req: express.Request): number | null => verifyToken(secret, req.cookies?.[COOKIE_NAME]);
  const publicUser = (id: number) => {
    const u = getUser(db, id)!;
    return { id: u.id, username: u.username, name: u.display_name, admin: !!u.is_admin, balance: u.balance,
      appearance: u.appearance ? JSON.parse(u.appearance) : null, introSeen: !!u.intro_seen };
  };

  app.get('/api/health', (_req, res) => { res.json({ ok: true, online: game.lives.size }); });
  // WebRTC ICE servers for phone calls + proximity voice. Production should add a TURN server (see DEPLOY.md):
  // BL_ICE_SERVERS='[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]'
  app.get('/api/ice', (_req, res) => {
    let extra: unknown[];
    try { extra = process.env.BL_ICE_SERVERS ? JSON.parse(process.env.BL_ICE_SERVERS) as unknown[] : []; } catch { extra = []; }
    res.json({ iceServers: [{ urls: process.env.BL_STUN_URL ?? 'stun:stun.l.google.com:19302' }, ...(Array.isArray(extra) ? extra : [])] });
  });

  app.post('/api/register', async (req, res) => {
    try {
      const { username, password, ageConfirmed } = req.body ?? {};
      const u = await registerUser(db, username, password, ageConfirmed);
      setSession(res, u.id);
      res.json({ ok: true, user: publicUser(u.id) });
    } catch (e) {
      res.status(e instanceof AuthError ? 400 : 500).json({ ok: false, error: e instanceof AuthError ? e.message : 'Server error' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    const key = String(username ?? '').toLowerCase();
    const f = failed.get(key);
    if (f && f.n >= 8 && f.until > Date.now()) { res.status(429).json({ ok: false, error: 'Too many attempts, wait a few minutes' }); return; }
    try {
      const u = await loginUser(db, username, password);
      failed.delete(key);
      setSession(res, u.id);
      res.json({ ok: true, user: publicUser(u.id) });
    } catch (e) {
      const cur = failed.get(key) ?? { n: 0, until: 0 };
      failed.set(key, { n: cur.n + 1, until: Date.now() + 5 * 60_000 });
      res.status(e instanceof AuthError ? 401 : 500).json({ ok: false, error: e instanceof AuthError ? e.message : 'Server error' });
    }
  });

  app.post('/api/logout', (_req, res) => { res.clearCookie(COOKIE_NAME, { path: '/' }); res.json({ ok: true }); });

  app.get('/api/me', (req, res) => {
    const uid = authed(req);
    if (!uid || !getUser(db, uid)) { res.status(401).json({ ok: false }); return; }
    res.json({ ok: true, user: publicUser(uid) });
  });

  app.post('/api/appearance', (req, res) => {
    const uid = authed(req);
    if (!uid) { res.status(401).json({ ok: false }); return; }
    if (!validAppearance(req.body)) { res.status(400).json({ ok: false, error: 'Invalid appearance' }); return; }
    game.setAppearance(uid, req.body);
    res.json({ ok: true });
  });

  if (opts.clientDir && fs.existsSync(opts.clientDir)) {
    const dir = opts.clientDir;
    app.use(express.static(dir, { maxAge: '1h', index: 'index.html' }));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => { res.sendFile(path.join(dir, 'index.html')); });
  }

  io.use((socket, next) => {
    const uid = verifyToken(secret, parseCookies(socket.handshake.headers.cookie)[COOKIE_NAME]);
    if (!uid || !getUser(db, uid)) return next(new Error('unauthorized'));
    socket.data.uid = uid;
    next();
  });
  io.on('connection', (socket) => game.handleConnection(socket, socket.data.uid as number));

  return { app, httpServer, io, game, close: () => new Promise<void>((r) => { game.stop(); io.close(); httpServer.close(() => r()); }) };
}

/** Creates the BEST 𝕏 admin account once with a random strong password; returns the password if newly created. */
/** Minimum length for an ADMIN_PASSWORD supplied through the environment (weak values are refused). */
export const ADMIN_PASSWORD_MIN = 12;
/**
 * Seed the BEST 𝕏 admin account ("bestx").
 * - ADMIN_PASSWORD env (≥ 12 chars): used for the account; if the account already exists its password is updated to match.
 * - otherwise a random strong password is generated once: written to credFile (mode 600) when given, else returned so
 *   the caller can log it once (hosts with no shell/persistent disk, e.g. Render free).
 * Returns the generated password, or null when nothing was generated.
 */
export async function seedAdmin(db: DB, credFile?: string, envPassword: string | undefined = process.env.ADMIN_PASSWORD): Promise<string | null> {
  const fromEnv = envPassword && envPassword.length >= ADMIN_PASSWORD_MIN ? envPassword : undefined;
  if (envPassword && !fromEnv) console.warn(`ADMIN_PASSWORD ignored: shorter than ${ADMIN_PASSWORD_MIN} characters`);
  const existing = getUserByName(db, ADMIN_USERNAME);
  if (existing) {
    if (fromEnv && !(await verifyPassword(fromEnv, existing.password_hash))) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(fromEnv), existing.id);
    return null;
  }
  const pw = fromEnv ?? randomPassword();
  await registerUser(db, ADMIN_USERNAME, pw, true, { admin: true, displayName: ADMIN_DISPLAY, balance: ADMIN_BALANCE });
  if (fromEnv) return null;
  if (credFile) {
    fs.writeFileSync(credFile, `BENINLIFE admin account (BEST 𝕏)\nusername: ${ADMIN_USERNAME}\npassword: ${pw}\n\nGenerated ${new Date().toISOString()}. Keep this private. Set ADMIN_PASSWORD to choose your own.\n`, { mode: 0o600 });
  }
  return pw;
}
