// Client weather visuals: rain streaks around the camera, overcast sky, wet roads + puddles, storm lightning.
import * as THREE from 'three';
import { WEATHER_PARAMS, type WeatherKind } from '../../shared/constants';

export class Weather {
  kind: WeatherKind = 'sunny';
  overcast = 0; rain = 0; wet = 0; flash = 0;
  /** camera look direction (set by the game): most strikes land in view so players actually see them */
  viewDir = new THREE.Vector3(0, 0, -1);
  private drops: THREE.LineSegments;
  private count: number;
  private speeds: Float32Array;
  private puddles: THREE.InstancedMesh;
  private nextBolt = 5;
  private bolt: THREE.Mesh;
  onThunder: (distance: number) => void = () => {};

  constructor(private scene: THREE.Scene, quality: 'low' | 'medium' | 'high', puddleSpots: { x: number; z: number }[]) {
    this.count = quality === 'low' ? 1400 : quality === 'medium' ? 3500 : 7000;
    const pos = new Float32Array(this.count * 6); this.speeds = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60;
      pos.set([x, y, z, x + 0.05, y + 0.55, z], i * 6); this.speeds[i] = 17 + Math.random() * 8;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.drops = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#b8c4d0', transparent: true, opacity: 0, depthWrite: false, fog: true }));
    this.drops.frustumCulled = false; this.drops.visible = false; scene.add(this.drops);
    // puddles: flat dark mirror-like discs on roads, fade in with wetness
    const pm = new THREE.MeshStandardMaterial({ color: '#1b2026', roughness: 0.04, metalness: 0.9, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.puddles = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20), pm, puddleSpots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    puddleSpots.forEach((p, i) => { const sx = 0.8 + Math.random() * 1.8, sz = 0.6 + Math.random() * 1.2; m.compose(new THREE.Vector3(p.x, 0.025, p.z), q, new THREE.Vector3(sx, sz, 1)); this.puddles.setMatrixAt(i, m); });
    this.puddles.visible = false; this.puddles.receiveShadow = true; scene.add(this.puddles);
    // lightning bolt (thin jagged emissive strip far away)
    const pts: number[] = []; let x = 0, y = 120;
    while (y > 0) { const nx = x + (Math.random() - 0.5) * 14, ny = y - 8 - Math.random() * 10; pts.push(x, y, 0, nx, ny, 0); x = nx; y = ny; }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.bolt = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: '#eef2ff', transparent: true, opacity: 0, fog: false })) as unknown as THREE.Mesh;
    this.bolt.visible = false; scene.add(this.bolt);
  }

  set(kind: WeatherKind): void { this.kind = kind; }

  /** dt seconds; cam = camera position; sheltered = inside a building (no rain drawn) */
  update(dt: number, cam: THREE.Vector3, sheltered: boolean): void {
    const p = WEATHER_PARAMS[this.kind];
    const k = Math.min(1, dt * 0.25); // smooth transitions over ~4-8 s
    this.overcast += (p.overcast - this.overcast) * k;
    this.rain += (p.rain - this.rain) * k;
    this.wet += (p.wet - this.wet) * Math.min(1, dt * (p.wet > this.wet ? 0.12 : 0.03)); // roads dry slowly
    const showRain = this.rain > 0.02 && !sheltered;
    this.drops.visible = showRain;
    if (showRain) {
      const mat = this.drops.material as THREE.LineBasicMaterial; mat.opacity = 0.18 + this.rain * 0.4;
      const a = this.drops.geometry.getAttribute('position') as THREE.BufferAttribute; const arr = a.array as Float32Array;
      const active = Math.floor(this.count * Math.min(1, this.rain * 1.1)); const wind = this.rain * 3;
      for (let i = 0; i < this.count; i++) {
        const o = i * 6;
        if (i >= active) { arr[o + 1] = arr[o + 4] = -100; continue; }
        let x = arr[o], y = arr[o + 1], z = arr[o + 2];
        y -= this.speeds[i] * dt; x += wind * dt;
        if (y < 0 || y < -50) { y = 22 + Math.random() * 8; x = cam.x + (Math.random() - 0.5) * 60; z = cam.z + (Math.random() - 0.5) * 60; }
        if (Math.abs(x - cam.x) > 30) x = cam.x + (Math.random() - 0.5) * 60;
        if (Math.abs(z - cam.z) > 30) z = cam.z + (Math.random() - 0.5) * 60;
        const len = 0.45 + this.rain * 0.4;
        arr[o] = x; arr[o + 1] = y; arr[o + 2] = z; arr[o + 3] = x - wind * 0.03; arr[o + 4] = y + len; arr[o + 5] = z;
      }
      a.needsUpdate = true;
    }
    this.puddles.visible = this.wet > 0.05;
    (this.puddles.material as THREE.MeshStandardMaterial).opacity = this.wet * 0.75;
    // lightning
    this.flash = Math.max(0, this.flash - Math.min(dt, 0.05) * 3.5); // capped so the flash still shows on slow devices
    const boltMat = (this.bolt as unknown as THREE.LineSegments).material as THREE.LineBasicMaterial;
    boltMat.opacity = this.flash; this.bolt.visible = this.flash > 0.05;
    if (p.lightning && !sheltered) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 6 + Math.random() * 12; this.flash = 1;
        const ahead = Math.atan2(this.viewDir.z, this.viewDir.x);
        const a = Math.random() < 0.7 ? ahead + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2, d = 250 + Math.random() * 300;
        this.bolt.position.set(cam.x + Math.cos(a) * d, 0, cam.z + Math.sin(a) * d); this.bolt.lookAt(cam.x, 0, cam.z);
        this.onThunder(d);
      }
    } else if (p.lightning && sheltered) { this.nextBolt -= dt; if (this.nextBolt <= 0) { this.nextBolt = 8 + Math.random() * 12; this.onThunder(400); } }
  }
}
