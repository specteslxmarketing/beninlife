# BENINLIFE — Final QA report (8 Oct 2026)

Code under test: `main` at the commit that adds this report. The server runs detached on `:3000` (`/api/health` → `{"ok":true}`).
E2E browsers: Playwright Chromium on desktop (software GL, Low quality) and WebKit with the iPad Pro 11 profile (touch).
Every e2e script ends with a **console gate**: any browser console error, uncaught exception or unhandled rejection
counts as a FAIL. Per-script results are in `screenshots/phase2/e2e_*.txt`.

## Gate counts (one run each)

| Gate | Result |
|---|---|
| `npm run build` (Vite client + tsc server) | PASS |
| `npm run typecheck` (server + client + tests) | PASS (fixed 2 test-import extensions in this pass) |
| `npm run lint` (eslint) | PASS, 0 problems |
| `npx vitest run` | **73 / 73** tests, 17 files |
| `npm run smoke` (2 real socket clients) | **12 / 12**, plus 12 / 12 against a clean production build on :4000 |
| E2E total | **197 PASS / 0 FAIL / 2 N/A**, 14 scripts, console gate PASS in all 14 |

| E2E script | PASS | FAIL | N/A | Notes |
|---|---|---|---|---|
| arrival | 16 | 0 | 0 | plane cabin, advisor, landing, deplane |
| calls | 9 | 0 | 1 | N/A: ICE audio path (sandbox has no network interfaces) |
| houses | 14 | 0 | 0 | mansion + bungalow, lock/unlock, visitor |
| characters | 2 | 0 | 0 | close-ups |
| travel | 17 | 0 | 0 | flight + bus, fares charged to a funded test account |
| carstands | 5 | 0 | 0 | |
| weather | 7 | 0 | 0 | |
| ambient | 8 | 0 | 0 | |
| jobs | 13 | 0 | 0 | car wash, mechanic, taxi |
| police | 10 | 0 | 0 | |
| combat | 35 | 0 | 0 | gun shop, aim/fire, hits, hospital, police response, gangs, touch fire |
| ipad (WebKit) | 21 | 0 | 0 | landscape + portrait, touch driving, R-key split |
| clothes | 12 | 0 | 0 | buy, Wardrobe change, persistence, seen by a 2nd player |
| vehicle | 28 | 0 | 1 | N/A: voice audio flow (signalling verified) |

Fixed during this QA pass:
- **Real bug:** render-paused pages stopped sending their position, which broke the passenger and voice tests.
- Smoke now completes the plane intro first.
- Travel uses a funded test account. It was failing because BEST 𝕏 was wanted and his crown top-up hid the fare debits.
- The jobs autopilot now weaves through the East checkpoint drums and walks round the bonnet.
- Calls answers inside the 30 s ring window.
- iPad: the brake check now waits for the car to stop, and the car is re-delivered home first.
- Tail lamps no longer slide along the body side.

## Areas

| Area | Status | Evidence |
|---|---|---|
| BUILD | PASS | `npm run build`; clean `npm ci && npm run build` in a fresh copy |
| TYPECHECK | PASS | `npm run typecheck` |
| LINT | PASS | 0 problems |
| UNIT TESTS | PASS | 73/73 |
| SMOKE | PASS | 12/12 |
| AUTH | PASS | register/login/18+ tests, smoke; `ADMIN_PASSWORD` seeding tests (`tests/deploy.test.ts`) |
| ARRIVAL/PLANE | PASS | e2e arrival 16/16 |
| 3D WORLD | PASS | highlights; every e2e loads the full city (procedural, see limitations) |
| CHARACTERS | PASS | e2e characters, clothes, highlight 04 |
| DAY/NIGHT | PASS | weather e2e (night + rain); highlights 05/06 |
| WEATHER | PASS | e2e weather 7/7 (server-synced rain/storm/lightning) |
| MOVEMENT | PASS | walk/run/jump (vehicle e2e), touch joystick (iPad) |
| VEHICLES | PASS | vehicle e2e: driving, wheels spin/steer, body roll, no clipping |
| CAR DOORS | PASS | door opens on entry/exit, closes when seated |
| PASSENGERS | PASS | "Ride with", server seat, rides along, gets out |
| CAR STANDS | PASS | e2e carstands 5/5 |
| RADIO | PASS | 4 stations render real audio (`radio_*.wav`); touch radio on iPad |
| MONEY | PASS | server-authoritative ledger; debits/credits checked in travel, jobs, clothes, combat, police |
| JOBS | PASS | e2e jobs 13/13 |
| HOUSES | PASS | e2e houses |
| MANSION | PASS | owner enters/exits; white GLK + pearl RX parked outside (highlights 01/02) |
| CLOTHING | PASS | buy Ankara + agbada, Wardrobe change, reload persists, 2nd player sees it (before/after shots) |
| POLICE | PASS | speeding → wanted → arrest + fine, surrender; combat responders |
| TRAVEL | PASS | e2e travel 17/17 |
| PHONE MESSAGES | PASS | smoke DM live + stored unread; integration tests |
| PHONE CALLS | PASS* | ring/answer/hang-up + full SDP negotiation. *Audio media cannot flow in this sandbox |
| ONLINE/OFFLINE | PASS | smoke presence + last_seen |
| VOICE CHAT | PASS* | proximity peer negotiation, push-to-talk, close. *Audio flow not verifiable here |
| COMBAT | PASS | 35 e2e checks + 13 server tests (server-validated hits, rate limit, line of sight, safe zones) |
| GANGS | PASS | create, invite, accept, chat, nametag tag; real cult names refused |
| AMBIENT NPC/TRAFFIC | PASS | e2e ambient 8/8 |
| IPAD | PASS | WebKit iPad, both orientations, 21/21 |
| MOBILE | PARTIAL | touch layout verified on iPad WebKit; no phone-sized viewport e2e in this gate |
| DESKTOP | PASS | all Chromium e2e |
| SECURITY | PASS | server-authoritative money/hits; rate limits; bcrypt; httpOnly+Secure cookies in prod; no secrets in git history (checked) |
| DEPLOY | PASS* | `render.yaml`, Dockerfile, production run verified on :4000 (health, login, smoke). *`docker build` not run: no Docker in the sandbox |

## Highlight screenshots (`docs/screenshots/`)
1. `docs/screenshots/01_mansion_white_glk_and_rx_day.jpg`: BEST 𝕏 Mansion with his white GLK-style and the pearl RX-style
2. `docs/screenshots/02_white_glk_front_quarter.jpg`: white GLK front quarter, BEST 𝕏 in the white suit
3. `docs/screenshots/04_bestx_white_suit_crown.jpg`: BEST 𝕏, white suit + crown pendant
4. `docs/screenshots/06_city_night.jpg` (also `05_city_day.jpg` and `08_city_heavy_rain.jpg`): roundabout by day, night and in rain
5. `docs/screenshots/10_combat_pistol_aim.jpg`: over-the-shoulder aim with the pistol in hand
6. `docs/screenshots/11_clothes_before.jpg` → `12_clothes_after_wardrobe.jpg`: clothing store before/after
7. `docs/screenshots/13_ipad_touch_driving.jpg`: iPad (WebKit) touch driving with the radio on
8. `docs/screenshots/09_rich_list_bestx_first.jpg`: Rich List, BEST 𝕏 #1 with ₦5,000,000,000+

## Honest limitations
- **Visuals are procedural:** low-poly buildings, lofted cars and simple lighting. This is not GTA 5 fidelity. The
  GLK/RX are built from the real dimensions and styling cues, but they are approximations with no logos.
- **Audio in the sandbox:** voice-chat and phone-call audio cannot flow (headless Chrome here has no network
  interfaces). Signalling and SDP negotiation are verified; real audio needs real devices.
- **TURN:** production needs a TURN server (`BL_ICE_SERVERS`) for players behind strict mobile or corporate NATs.
- **No public URL from this sandbox.** Deployment is prepared (Render free blueprint) but has to be launched from your
  account.
- **Render free plan has no persistent disk:** the SQLite data resets on every redeploy, restart or spin-down (it sleeps
  after about 15 min idle). See DEPLOY.md for the upgrade path (Render Disk, or Postgres/Turso; not implemented).
- **Performance:** about 4.8k draw calls at Low (world props not merged yet). Fine on desktop GPUs and iPad; low-end
  phones may struggle.
- **Simplified systems:** police responders follow the road graph (no navmesh). No drive-bys. Animation is procedural
  (no motion capture). Ambient traffic and pedestrians are cosmetic and simulated on each client.
- **Test accounts:** combat, clothes, travel and iPad-landscape tests use funded test accounts. Houses, car stands,
  police, jobs, weather, vehicle and iPad-portrait still log in as `bestx` for admin teleport. Police fines him a few
  thousand ₦, but the crown reserve restores ₦5bn+ within 15 s, and he stays #1.
- The local test database contains many e2e test accounts. A fresh deploy starts empty except for BEST 𝕏.
