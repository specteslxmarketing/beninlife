import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Physically based sky + sun/moon + ambient that follow the in-game hour. */
export class Environment {
  sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private zenith = new THREE.Color(); private horizon = new THREE.Color();
  sun = new THREE.DirectionalLight('#fff3e0', 3);
  hemi = new THREE.HemisphereLight('#bcd0e0', '#6b5040', 0.9);
  private stars: THREE.Points;
  private sunDir = new THREE.Vector3();
  night = 0;
  /** 0 clear … 1 storm clouds; set by the weather system */
  overcast = 0;
  /** lightning flash 0..1 */
  flash = 0;
  /** 1 when under a roof (house interiors): daylight only leaks in through windows */
  indoor = 0;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer, shadows: boolean, shadowSize: number) {
    // Controllable gradient sky dome (zenith -> hazy horizon) with a soft sun glow.
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { zenith: { value: this.zenith }, horizon: { value: this.horizon }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color('#fff2d8') }, sunAmt: { value: 1 } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }',
      fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunAmt; varying vec3 vDir;
        void main(){ float h = max(vDir.y, 0.0); vec3 col = mix(horizon, zenith, pow(h, 0.4));
          if (vDir.y < 0.0) col = horizon;
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * sunAmt;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.sky.renderOrder = -1; this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(shadowSize, shadowSize);
      const c = this.sun.shadow.camera; c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 300;
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    }
    scene.add(this.sun, this.sun.target, this.hemi);
    const g = new THREE.BufferGeometry(); const pts: number[] = [];
    for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3().randomDirection(); if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05; v.multiplyScalar(1800); pts.push(v.x, v.y, v.z); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
    scene.fog = new THREE.Fog('#b9b4a6', 60, 330);
    // image-based lighting so PBR metals/paint/glass have something to reflect
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
  }

  /** hour 0..24, focus = point the shadow camera should follow (player) */
  update(hour: number, focus: THREE.Vector3): void {
    // sun travels east->west, highest at 12:00 (Benin City ~6°N so nearly overhead)
    const t = (hour - 6) / 12; // 0 at sunrise, 1 at sunset
    const elev = Math.sin(t * Math.PI) * 78 * Math.PI / 180;
    const az = Math.PI * (0.5 + t) ; // east (+x) to west
    this.sunDir.set(Math.cos(az) * -Math.cos(elev), Math.sin(elev), 0.25 * Math.cos(elev)).normalize();
    if (t < 0 || t > 1) { // night: sun below horizon
      const nt = ((hour + 24 - 18) % 24) / 12; this.sunDir.set(Math.cos(Math.PI * nt), -Math.sin(nt * Math.PI) * 0.6 - 0.05, 0.2).normalize();
    }
    const sunH = this.sunDir.y; // -1..1
    const day = THREE.MathUtils.smoothstep(sunH, -0.08, 0.18); // 0 night, 1 day
    this.night = 1 - day;
    const golden = (1 - THREE.MathUtils.smoothstep(sunH, 0.02, 0.35)) * day; // warm near horizon

    const light = new THREE.Vector3();
    if (sunH > -0.02) {
      light.copy(this.sunDir);
      this.sun.color.setRGB(1, 0.96 - golden * 0.28, 0.9 - golden * 0.5);
      this.sun.intensity = (0.2 + 3.0 * day) * (1 - this.overcast * 0.78) * (1 - this.indoor * 0.88);
    } else { // moonlight
      light.set(-0.3, 0.8, 0.4).normalize();
      this.sun.color.set('#8fa6d6');
      this.sun.intensity = 0.5;
    }
    this.sun.position.copy(focus).addScaledVector(light, 120);
    this.sun.target.position.copy(focus);
    this.hemi.intensity = ((0.55 + 0.55 * day) * (1 - this.overcast * 0.25) + this.flash * 4) * (1 - this.indoor * 0.55);
    this.hemi.color.setRGB(0.45 + 0.3 * day, 0.5 + 0.32 * day, 0.68 + 0.2 * day);
    this.hemi.groundColor.setRGB(0.18 + 0.25 * day, 0.14 + 0.17 * day, 0.12 + 0.11 * day);
    const fog = this.scene.fog as THREE.Fog;
    const dayFog = new THREE.Color('#c9d0d2'), duskFog = new THREE.Color('#c09474'), nightFog = new THREE.Color('#0e1524');
    fog.color.copy(nightFog).lerp(dayFog, day).lerp(duskFog, golden * 0.6);
    const grey = new THREE.Color('#8e959a').multiplyScalar(0.25 + 0.75 * day);
    fog.color.lerp(grey, this.overcast * 0.85);
    this.horizon.copy(fog.color);
    this.zenith.copy(new THREE.Color('#03060d')).lerp(new THREE.Color('#2c5fae'), day).lerp(new THREE.Color('#465a86'), golden * 0.5);
    this.zenith.lerp(new THREE.Color('#5d6670').multiplyScalar(0.2 + 0.8 * day), this.overcast * 0.9);
    if (this.flash > 0) { this.zenith.lerp(new THREE.Color('#dfe6ff'), this.flash); this.horizon.lerp(new THREE.Color('#c8d0ff'), this.flash * 0.8); }
    const su = this.sky.material.uniforms; su.sunDir.value.copy(this.sunDir); su.sunAmt.value = day * (1 - this.overcast * 0.95);
    su.sunColor.value.setRGB(1, 0.9 - golden * 0.3, 0.75 - golden * 0.4);
    this.sky.position.copy(focus);
    fog.near = (30 + day * 30) * (1 - this.overcast * 0.6); fog.far = (200 + day * 90) * (1 - this.overcast * 0.45);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, this.night - 0.4) * 1.4;
    this.sky.visible = true;
    this.renderer.toneMappingExposure = 0.55 + 0.25 * day + this.night * 0.25;
    this.stars.position.copy(focus);
    this.scene.environmentIntensity = (0.06 + 0.34 * day) * (1 - this.indoor * 0.4) + this.indoor * 0.08;
    if (this.indoor) this.renderer.toneMappingExposure = 0.72;
  }
}
