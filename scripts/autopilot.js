// Injected into the page by scripts/screenshots.ts. Drives the REAL client controls (keyboard state),
// so all movement still goes through the normal client physics and server validation.
window.__auto = (() => {
  const G = () => window.__beninlife;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const U = { E: [1, 0], W: [-1, 0], S: [0, 1], N: [0, -1] };
  const ANG = { E: 0, S: Math.PI / 2, W: Math.PI, N: -Math.PI / 2 };
  const armOf = (x, z) => (Math.abs(x) > Math.abs(z) ? (x > 0 ? 'E' : 'W') : (z > 0 ? 'S' : 'N'));
  const inPt = (a, d) => { const [ux, uz] = U[a]; return [ux * d + uz * 3.5, uz * d - ux * 3.5]; };
  const outPt = (a, d) => { const [ux, uz] = U[a]; return [ux * d - uz * 3.5, uz * d + ux * 3.5]; };
  function route(fx, fz, tx, tz) {
    const A = armOf(fx, fz), B = armOf(tx, tz);
    const dA = Math.max(Math.abs(fx), Math.abs(fz)), dB = Math.max(Math.abs(tx), Math.abs(tz));
    const side = (B === 'E' || B === 'W') ? Math.sign(tz) : Math.sign(tx);
    const final = (B === 'E' || B === 'W') ? [tx, side * 5.6] : [side * 5.6, tz];
    if (A === B && dB > dA + 5) return [outPt(A, Math.min(dB, dA + 12)), outPt(B, dB), final];
    const pts = [inPt(A, Math.max(dA - 10, 31)), inPt(A, 29)];
    // East road police checkpoint: drums at (88,-5), (90.5,-3.2), (99,-5) form a chicane in the westbound lane —
    // weave through it next to the centre line like a real driver
    if (A === 'E' && dA > 104) pts.splice(1, 0, [104, -1.1], [84, -1.1]);
    const a0 = ANG[A]; let a1 = ANG[B];
    while (a1 >= a0) a1 -= Math.PI * 2;
    for (let a = a0 - 0.45; a > a1 + 0.45; a -= 0.35) pts.push([Math.cos(a) * 19.5, Math.sin(a) * 19.5]);
    pts.push(outPt(B, 30), outPt(B, dB), final);
    return pts;
  }
  function setKeys(...ks) { const k = G().controls.keys; k.clear(); for (const x of ks) if (x) k.add(x); }
  function drive(points, vmax = 12, timeoutMs = 300000) {
    return new Promise((resolve) => {
      let i = 0; const t0 = Date.now(); let stuckSince = 0; let reverseUntil = 0; let revSteer = '';
      const iv = setInterval(() => {
        const g = G(); const c = g.carState;
        if (Date.now() - t0 > timeoutMs) { clearInterval(iv); setKeys(); resolve({ ok: false, reason: 'timeout', i }); return; }
        if (Date.now() < reverseUntil) { setKeys('s', revSteer); return; }
        const [tx, tz] = points[i]; const dx = tx - c.x, dz = tz - c.z; const d = Math.hypot(dx, dz);
        const last = i === points.length - 1;
        if (d < (last ? 2.5 : 4.5)) {
          i++;
          if (i >= points.length) {
            clearInterval(iv); setKeys(' ');
            const w = setInterval(() => { if (Math.abs(G().carState.speed) < 0.2) { clearInterval(w); setKeys(); resolve({ ok: true }); } }, 50);
            return;
          }
          return;
        }
        let e = Math.atan2(dx, dz) - c.rot; e = Math.atan2(Math.sin(e), Math.cos(e));
        const steer = Math.abs(e) < 0.04 ? '' : (e < 0 ? 'd' : 'a');
        let v = Math.abs(e) > 0.6 ? 4.5 : vmax; if (last && d < 14) v = Math.min(v, 3.5);
        const thr = c.speed < v - 0.5 ? 'w' : (c.speed > v + 2 ? ' ' : '');
        setKeys(thr, steer);
        if (thr === 'w' && Math.abs(c.speed) < 0.4) { if (!stuckSince) stuckSince = Date.now(); if (Date.now() - stuckSince > 2500) { reverseUntil = Date.now() + 1500; revSteer = steer === 'a' ? 'd' : 'a'; stuckSince = 0; } }
        else stuckSince = 0;
      }, 16);
    });
  }
  async function walkTo(x, z, r = 2.5, timeoutMs = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const g = G(); const dx = x - g.pos.x, dz = z - g.pos.y;
      if (Math.hypot(dx, dz) < r) { setKeys(); return true; }
      g.controls.camYaw = Math.atan2(-dx, -dz);
      setKeys('w', 'shift');
      await sleep(30);
    }
    setKeys(); return false;
  }
  async function reverseFor(ms, steer = '') { setKeys('s', steer); await sleep(ms); setKeys(' '); await sleep(800); setKeys(); }
  /** new players start in the Benin Airport arrivals hall: walk out of the terminal and down the north road to the car park */
  async function walkFromAirport() {
    const pts = [[-10, -219], [-10, -212], [-4, -200], [-4, -40], [-18, -27], [-32, -9.5], [-44, 10.5]];
    for (const [x, z] of pts) if (!(await walkTo(x, z, 1.6, 90000))) return false;
    return true;
  }
  return { route, drive, walkTo, walkFromAirport, reverseFor, setKeys, sleep };
})();
