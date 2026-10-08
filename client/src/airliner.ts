import * as THREE from 'three';

/**
 * Procedural twin-engine narrow-body airliner (≈37 m long, 34 m span) for the fictional "Ivie Air".
 * Smooth lathed fuselage with an upswept tail cone, swept extruded wings, lathed engine nacelles, painted livery
 * (windows, doors, cheatline, titles) drawn onto a canvas. Nose points to local +z; origin at fuselage centre, wheels at y≈-3.1.
 */
const L = 37, R = 2.0;

function liveryTexture(): THREE.CanvasTexture {
  const W = 2048, H = 2048; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d')!;
  // u (x) = angle around: 0 belly, 0.25 right side, 0.5 top, 0.75 left side. v (y): canvas top = nose, bottom = tail.
  const yOf = (len: number) => (1 - len / L) * H; // len measured from the tail
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#b9bec4'); grad.addColorStop(0.17, '#d9dde0'); grad.addColorStop(0.25, '#f4f5f6'); grad.addColorStop(0.5, '#ffffff');
  grad.addColorStop(0.75, '#f4f5f6'); grad.addColorStop(0.83, '#d9dde0'); grad.addColorStop(1, '#b9bec4');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  for (const side of [0.25, 0.75]) {
    const sx = side * W, dir = side < 0.5 ? 1 : -1;
    // green + gold cheatlines below the windows
    g.fillStyle = '#17603f'; g.fillRect(sx - dir * 34 - 22, yOf(33), 44, yOf(4) - yOf(33));
    g.fillStyle = '#d9a93a'; g.fillRect(sx - dir * 70 - 6, yOf(32), 12, yOf(5) - yOf(32));
    // passenger windows
    const wu = side + (side < 0.5 ? 0.04 : -0.04);
    g.fillStyle = '#1a2128';
    for (let len = 8.6; len < 30.5; len += 0.82) { if (Math.abs(len - 20) < 0.5) continue; g.beginPath(); g.roundRect(wu * W - 26, yOf(len) - 9, 52, 18, 9); g.fill(); }
    // doors
    g.strokeStyle = '#8f969c'; g.lineWidth = 4;
    for (const len of [31.6, 6.8, 20]) { g.beginPath(); g.roundRect(wu * W - 70, yOf(len) - (len === 20 ? 22 : 36), 140, len === 20 ? 44 : 72, 14); g.stroke(); }
    // titles
    g.save(); g.translate(side * W + (side < 0.5 ? 180 : -180), yOf(19)); g.rotate(side < 0.5 ? Math.PI / 2 : -Math.PI / 2); if (side > 0.5) g.scale(-1, -1);
    g.fillStyle = '#17603f'; g.font = '900 120px "Noto Sans", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('IVIE AIR', 0, 0);
    g.restore();
    // cockpit windows
    g.fillStyle = '#12181e'; g.beginPath(); g.roundRect(side * W + (side < 0.5 ? 120 : -260), yOf(35.9), 140, 34, 10); g.fill();
  }
  g.fillStyle = '#12181e'; g.beginPath(); g.roundRect(W * 0.5 - 150, yOf(35.95), 300, 38, 10); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function tailTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d')!;
  g.fillStyle = '#17603f'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#d9a93a'; g.lineWidth = 26; g.beginPath(); g.arc(256, 300, 150, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
  g.fillStyle = '#ffffff'; g.font = '900 96px "Noto Sans", Arial'; g.textAlign = 'center'; g.fillText('IVIE', 256, 330);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

let shared: { liv: THREE.CanvasTexture; tail: THREE.CanvasTexture } | null = null;

export function airliner(): THREE.Group {
  if (!shared) shared = { liv: liveryTexture(), tail: tailTexture() };
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f4f5f6', metalness: 0.25, roughness: 0.35 });
  const grey = new THREE.MeshStandardMaterial({ color: '#c3c8cc', metalness: 0.5, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1c1f22', metalness: 0.4, roughness: 0.5 });
  const green = new THREE.MeshStandardMaterial({ map: shared.tail, metalness: 0.2, roughness: 0.4 });

  // fuselage (profile: radius vs distance from tail)
  const prof: [number, number][] = [[0.15, 0], [0.55, 1.2], [1.05, 3], [1.55, 5.2], [1.88, 7.3], [R, 9]];
  for (let y = 10; y <= 30; y += 1) prof.push([R, y]);
  prof.push([1.97, 31.2], [1.88, 32.6], [1.68, 34], [1.38, 35.2], [0.98, 36.2], [0.52, 36.85], [0.05, 37.15]);
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setY(i, pos.getY(i) / L);
  geo.rotateX(Math.PI / 2); // axis y → z (tail at z=0, nose at z=L)
  for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); if (z < 9) pos.setY(i, pos.getY(i) + ((9 - z) / 9) ** 1.6 * 1.25); }
  geo.translate(0, 0, -L / 2); geo.computeVertexNormals();
  const fus = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: shared.liv, metalness: 0.25, roughness: 0.32 })); g.add(fus);

  // wings: swept planform in (x, z), extruded thin; root at fuselage, low-mounted
  const wingShape = (span: number, root: number, tip: number, sweep: number) => {
    const s = new THREE.Shape(); s.moveTo(0, root * 0.35); s.lineTo(span, -sweep + tip * 0.35); s.lineTo(span, -sweep - tip * 0.65); s.lineTo(0, -root * 0.65); s.closePath(); return s;
  };
  for (const sx of [-1, 1]) {
    const wg = new THREE.ExtrudeGeometry(wingShape(15.5, 6.2, 1.5, 6.4), { depth: 0.32, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3 });
    wg.rotateX(Math.PI / 2); // shape (x,y) → (x, z) plane
    const w = new THREE.Mesh(wg, white); w.scale.x = sx; w.position.set(sx * 1.2, -1.15, 1.6); w.rotation.z = sx * 0.085; g.add(w);
    // winglet
    const wl = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape(2.2, 1.4, 0.6, 1.2), { depth: 0.12, bevelEnabled: false }), green);
    wl.rotation.set(0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI / 2); wl.position.set(sx * 16.6, 0.25, -4.7); g.add(wl);
    // engine nacelle + pylon
    const nac = new THREE.Mesh(new THREE.LatheGeometry([[0.0, -2.3], [0.62, -2.25], [0.86, -1.6], [0.98, -0.4], [1.0, 0.6], [0.92, 1.5], [0.84, 1.9], [0.8, 2.0]].map(([r, y]) => new THREE.Vector2(r, y)), 28), grey);
    nac.rotation.x = Math.PI / 2; nac.position.set(sx * 5.9, -2.25, 4.2); g.add(nac);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.07, 8, 28), new THREE.MeshStandardMaterial({ color: '#d9dde0', metalness: 0.9, roughness: 0.2 })); lip.position.set(sx * 5.9, -2.25, 6.2); g.add(lip);
    const fan = new THREE.Mesh(new THREE.CircleGeometry(0.78, 28), dark); fan.position.set(sx * 5.9, -2.25, 6.05); g.add(fan);
    const spin = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 16), grey); spin.rotation.x = Math.PI / 2; spin.position.set(sx * 5.9, -2.25, 6.15); g.add(spin);
    const py = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 3.2), white); py.position.set(sx * 5.9, -1.45, 3.4); g.add(py);
    // main gear
    const mg = new THREE.Group(); mg.position.set(sx * 3.0, -1.6, 0.2); g.add(mg);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 8), grey); strut.position.y = -0.65; mg.add(strut);
    for (const dz of [-0.45, 0.45]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.38, 20), dark); wh.rotation.z = Math.PI / 2; wh.position.set(0, -1.0 - 0.0, dz); wh.name = 'wheel'; mg.add(wh); }
  }
  // nose gear
  const ng = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8), grey); ng.position.set(0, -2.4, 13.8); g.add(ng);
  for (const dx of [-0.2, 0.2]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.22, 16), dark); wh.rotation.z = Math.PI / 2; wh.position.set(dx, -2.75, 13.8); g.add(wh); }
  // wing-to-body fairing (belly)
  const fair = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), white); fair.scale.set(2.1, 0.9, 6.5); fair.position.set(0, -1.25, 0.6); g.add(fair);
  // vertical stabiliser
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.lineTo(-5.2, 0); fin.lineTo(-7.6, 6.2); fin.lineTo(-5.6, 6.4); fin.closePath();
  const fg = new THREE.ExtrudeGeometry(fin, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  // UVs for the tail paint
  const fuv = fg.attributes.uv, fp = fg.attributes.position; for (let i = 0; i < fuv.count; i++) { const u = (fp.getX(i) + 7.6) / 7.6; fuv.setXY(i, fp.getZ(i) > 0.15 ? u : 1 - u, fp.getY(i) / 6.4); }
  const finM = new THREE.Mesh(fg, green); finM.rotation.y = -Math.PI / 2; finM.position.set(0.15, 1.6, -L / 2 + 8.3); g.add(finM);
  // horizontal stabilisers
  for (const sx of [-1, 1]) {
    const hg = new THREE.ExtrudeGeometry(wingShape(5.8, 3.2, 1.2, 2.6), { depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2 });
    hg.rotateX(Math.PI / 2);
    const h = new THREE.Mesh(hg, white); h.scale.x = sx; h.position.set(sx * 0.5, 0.95, -L / 2 + 4.6); h.rotation.z = sx * 0.1; g.add(h);
  }
  // beacon + nav lights
  const red = new THREE.MeshBasicMaterial({ color: '#ff3030' }), grn = new THREE.MeshBasicMaterial({ color: '#30ff60' });
  const nl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), red); nl.position.set(-16.7, -0.2, -4.6); g.add(nl);
  const nr = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), grn); nr.position.set(16.7, -0.2, -4.6); g.add(nr);
  const bc = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), red); bc.position.set(0, 2.05, 2); bc.name = 'beacon'; g.add(bc);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
/** distance from fuselage centre to the ground when the gear is down */
export const AIRLINER_GEAR_H = 3.15;
