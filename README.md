# BENINLIFE — first playable vertical slice

An original browser multiplayer life-sim set in a fictional district of Benin City, Edo State, Nigeria.
18+. Currency is virtual ₦ (Naira). No third-party game assets, code, logos or branding are used.
Everything is procedural: Three.js primitives plus canvas-generated textures.

## Run

```bash
npm install
npm run build      # vite client build + tsc server build
npm start          # serves game + API + Socket.IO on http://localhost:3000 (PORT env to change)
# or: npm run dev  # builds the client, then runs the server from TS source via tsx
```

Quality gate: `npm run typecheck`, `npm run lint`, `npm test` (vitest: unit + Socket.IO integration),
`npm run smoke` (2-player smoke test against the running server), and `npm run screenshots` (headless Chrome e2e run + PNGs).

Admin: on first start the server creates the `bestx` account (display name **BEST 𝕏**, ₦50,000,000) with a random
password. The password is written to `ADMIN_CREDENTIALS.txt` (mode 600).

## What's in this slice
- Sign up / log in (bcrypt, httpOnly JWT cookie, server-side validation, 18+ confirmation, basic login throttling)
- Character creator: male/female, 6 skin tones, 8 outfit colours. Saved to SQLite.
- 3D district: King's-Square-style roundabout (original layout) with an original bronze "Unity Column", 4 arterial roads with lane markings,
  open drainage gutters, interlocking-paver sidewalks, streetlights, bank, fuel station, market stalls, church, mosque,
  car wash, clothing store, police station (scenery only), BEST 𝕏 mansion with gate and two guards, parked SUVs, palms.
- Accelerated day/night cycle (1 game day = 12 real minutes), the same on every client because it's derived from server time.
  Streetlights, windows, signs and headlights switch on at night.
- Third-person movement (WASD/arrows + drag-look, or an on-screen joystick on touch) with AABB collisions.
- Each player has their own car: E to enter/exit, arcade driving, headlights at night, dirt builds up as you drive.
- Server-authoritative wallet and transactions. The client never sends a balance.
- Delivery job (₦1,500): market pickup → random drop-off. The server checks position and plausible travel time.
- Car wash (₦500): only works inside the bay while in your car. Charged on the server, and the dirt resets.
- Multiplayer: live positions (10 Hz snapshots, interpolated), name tags, ONLINE/OFFLINE list driven by socket connections, persisted last_seen.
- Global chat, plus a phone with Messages (DMs stored in SQLite, unread badges), Players, Wallet, Jobs and Settings.
- First-login intro: plane approach and flyover with the fictional welcome dialogue. Skippable, and shown only once.
- Graphics quality: Auto/Low/Medium/High (auto picks from device type, cores and memory). Low has no shadows.

## Not in this slice (and not shown as buttons)
Voice/video calls, buying property/cars, other jobs, police/crime systems, NPC traffic and pedestrians, inventory, clothing shop purchases,
an admin panel, real payments, audio.

Debug/preview only: adding `?hour=21` to the URL overrides the *displayed* time of day on that client (the HUD marks it "(preview)").
