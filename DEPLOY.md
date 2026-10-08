# Putting BENINLIFE online

The game is one Node 20 process (Express + Socket.IO + SQLite) that also serves the built client. Anything that can run
a Docker container with a **persistent disk** and **WebSockets** works. HTTPS is required in production (microphone for
calls/voice chat and Secure cookies only work over HTTPS).

## 1. Configuration
Copy `.env.example` → `.env` and adjust. Important variables:

| Variable | Purpose |
|---|---|
| `PORT` | listen port (Render/Railway/Fly inject it; default 3000) |
| `HOST` | bind address (default `0.0.0.0`) |
| `NODE_ENV=production` | Secure cookies, production mode |
| `DATA_DIR=/data` (alias `BL_DATA_DIR`) | SQLite DB + `secret.key` (+ `ADMIN_CREDENTIALS.txt` when no `ADMIN_PASSWORD`). Mount a persistent disk here |
| `SESSION_SECRET` (alias `BL_SECRET`) | session/JWT signing secret. If unset, one is generated into the data dir |
| `ADMIN_PASSWORD` | password for the BEST 𝕏 admin `bestx` (at least 12 characters). It is re-applied on every start, so changing it in the dashboard rotates it |
| `BL_ICE_SERVERS` | JSON list of extra ICE servers. Put your **TURN** server here (placeholder in `.env.example`) |
| `BL_TRUST_PROXY` | `1` (default) when behind a TLS-terminating proxy |
| `BL_SECURE_COOKIES` | force the Secure cookie flag on (`1`) or off (`0`). Default: on when `NODE_ENV=production` |

Admin account **bestx**:
- If `ADMIN_PASSWORD` is set, that password is used.
- Otherwise a random strong password is generated on first start:
  - on a VPS it is written to `$DATA_DIR/ADMIN_CREDENTIALS.txt` (mode 600);
  - on Render (`RENDER=true`) or with `BL_ADMIN_LOG=1` it is printed **once** to the service log.
- A weak `ADMIN_PASSWORD` (under 12 characters) is refused, and a generated one is used instead.

`GET /api/health` returns `{"ok":true,"online":N}` (used by the Docker HEALTHCHECK and Render).

## 2. Docker (any VPS)
```bash
docker build -t beninlife .
docker run -d --name beninlife --restart unless-stopped -p 3000:3000 \
  -v beninlife-data:/data --env-file .env beninlife
```
Put a TLS proxy in front, e.g. Caddy (automatic Let's Encrypt; WebSockets just work):
```
play.example.com {
  reverse_proxy localhost:3000
}
```
TURN (recommended for voice/calls behind mobile/corporate NATs): run coturn on the same VPS
(`docker run -d --network host coturn/coturn -n --lt-cred-mech --user beninlife:STRONGPASS --realm play.example.com`)
and set `BL_ICE_SERVERS=[{"urls":"turn:play.example.com:3478","username":"beninlife","credential":"STRONGPASS"}]`.

## 3. Render (free tier, blueprint included)
`render.yaml` describes a free Docker web service.

1. Push the repo to GitHub (see "Public repo" below).
2. In Render, go to **New → Blueprint** and pick the repo. Render reads `render.yaml`, builds the `Dockerfile` and
   generates `SESSION_SECRET`.
3. When asked, enter **ADMIN_PASSWORD** (`sync: false`, so it is never stored in the repo).
4. Open `https://<service>.onrender.com`. HTTPS and WebSockets work out of the box.

**Free-plan limits:**
- **No persistent disk.** The SQLite database in `DATA_DIR` is wiped on every redeploy, restart and spin-down. All
  accounts, money, houses, cars, gangs and messages reset. BEST 𝕏 is re-seeded each start, with his ₦5bn balance,
  white GLK and mansion, using `ADMIN_PASSWORD`.
- **Sleeps after about 15 min without traffic.** The next visit wakes it in about a minute, and that is also a restart,
  so the data is lost again.
- 512 MB RAM and a shared CPU are fine for a handful of players. SQLite means one instance.

**To keep data later:** either upgrade the service to a paid instance and add a **Render Disk** mounted at `/data`
(no code change needed), or move storage to a hosted database (Render Postgres or Turso/libSQL, both have free tiers).
The second option needs the DB layer (`server/src/db.ts` + better-sqlite3 calls) ported to the new client. That is
not done yet.

## 4. Railway
New project → Deploy from repo (Dockerfile). Add a **Volume** mounted at `/data`; set the variables; Railway provides HTTPS.

## 5. Fly.io
```bash
fly launch --no-deploy            # uses the Dockerfile
fly volumes create beninlife_data --size 1
# in fly.toml:  [mounts] source="beninlife_data" destination="/data"   and  internal_port = 3000
fly secrets set BL_ICE_SERVERS='[...]'
fly deploy
```

## Notes
- SQLite means **one instance** (don't scale horizontally); back up `/data/beninlife.sqlite` regularly.
- Socket.IO uses WebSockets with polling fallback; no sticky-session setup is needed for a single instance.
- This sandbox cannot expose a public URL; everything above has to be done by the owner on their hosting account.
- Docker could not be run in the build sandbox. The image steps were checked with a clean `npm ci && npm run build &&
  npm prune --omit=dev` and a production run (see FINAL_REPORT.md). The first real `docker build` happens on Render.

## Public repo
These are git-ignored and were never committed (whole history checked): `ADMIN_CREDENTIALS.txt`, `data/` (SQLite DB +
`secret.key`), `.env`, `*.sqlite*`. Bulk e2e screenshots and audio renders are also ignored to keep the repo small;
a few highlight screenshots live in `docs/screenshots/`.
