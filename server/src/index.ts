import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createServer, seedAdmin } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from server/src (tsx) and dist-server/server/src (compiled)
const root = [path.resolve(here, '../..'), path.resolve(here, '../../..')].find((p) => fs.existsSync(path.join(p, 'package.json')))!;
const envDataDir = process.env.BL_DATA_DIR ?? process.env.DATA_DIR; // DATA_DIR: Render blueprint name
const dataDir = envDataDir ?? path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const secretFile = path.join(dataDir, 'secret.key');
const secret = process.env.BL_SECRET ?? process.env.SESSION_SECRET ?? (fs.existsSync(secretFile) ? fs.readFileSync(secretFile, 'utf8').trim() : (() => {
  const s = crypto.randomBytes(48).toString('hex'); fs.writeFileSync(secretFile, s, { mode: 0o600 }); return s;
})());

const db = openDb(process.env.BL_DB ?? path.join(dataDir, 'beninlife.sqlite'));
// admin: ADMIN_PASSWORD env if set; otherwise a generated password goes to ADMIN_CREDENTIALS.txt (local/VPS) or, when
// BL_ADMIN_LOG=1 / on hosts without a shell (Render sets RENDER=true), is printed once to the log
const logOnly = process.env.BL_ADMIN_LOG === '1' || process.env.RENDER === 'true';
const credFile = logOnly ? undefined : process.env.BL_ADMIN_FILE ?? path.join(envDataDir ? dataDir : root, 'ADMIN_CREDENTIALS.txt');
const created = await seedAdmin(db, credFile);
if (created && credFile) console.log('Seeded admin account "bestx" – password written to ADMIN_CREDENTIALS.txt (in the data directory when DATA_DIR/BL_DATA_DIR is set)');
else if (created) console.log(`Seeded admin account "bestx" with generated password: ${created}  (shown once; set ADMIN_PASSWORD to choose your own)`);
else if (process.env.ADMIN_PASSWORD) console.log('Admin account "bestx" uses ADMIN_PASSWORD from the environment');

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const { httpServer } = createServer({ db, secret, clientDir: path.join(root, 'client/dist') });
httpServer.listen(port, host, () => console.log(`BENINLIFE server listening on http://${host}:${port}`));
// graceful stop (Render/Docker send SIGTERM on redeploy/sleep)
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { httpServer.close(); try { db.close(); } catch { /* already closed */ } process.exit(0); });
