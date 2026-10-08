// Procedural, generic firearm models (no real-world designs or markings). Built in the hand's frame:
// barrel along -y (the forearm direction), top of the weapon along +z, grip at the origin.
import * as THREE from 'three';
import type { WeaponId } from '../../shared/combat';

const metal = new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.42, metalness: 0.75 });
const polymer = new THREE.MeshStandardMaterial({ color: '#26272a', roughness: 0.78, metalness: 0.05 });
const wood = new THREE.MeshStandardMaterial({ color: '#5a3a22', roughness: 0.62 });
const steel = new THREE.MeshStandardMaterial({ color: '#4b4f55', roughness: 0.3, metalness: 0.9 });

function box(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = true; g.add(b); return b;
}
function cyl(g: THREE.Group, r: number, len: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), m); c.position.set(x, y, z); c.castShadow = true; g.add(c); return c;
}
/** returns the gun group and the muzzle position (hand frame) */
export function makeGun(id: WeaponId): { group: THREE.Group; muzzle: THREE.Vector3 } {
  const g = new THREE.Group(); g.scale.setScalar(1.12); // a touch larger than life so it reads at third-person distance
  if (id === 'pistol') {
    box(g, 0.03, 0.19, 0.036, metal, 0, -0.07, 0.05);           // slide
    box(g, 0.028, 0.15, 0.022, polymer, 0, -0.055, 0.022);       // frame
    box(g, 0.028, 0.045, 0.11, polymer, 0, 0.0, -0.025, -0.25);  // grip
    box(g, 0.006, 0.035, 0.02, metal, 0, -0.04, 0.0);            // trigger guard (simplified)
    cyl(g, 0.007, 0.012, steel, 0, -0.17, 0.052);                // muzzle crown
    return { group: g, muzzle: new THREE.Vector3(0, -0.18, 0.052) };
  }
  if (id === 'smg') {
    box(g, 0.04, 0.3, 0.06, polymer, 0, -0.1, 0.045);            // receiver
    box(g, 0.03, 0.05, 0.12, polymer, 0, 0.0, -0.03, -0.2);      // grip
    box(g, 0.026, 0.045, 0.16, metal, 0, -0.12, -0.05, 0.1);     // magazine
    cyl(g, 0.012, 0.09, metal, 0, -0.29, 0.055);                 // barrel shroud
    box(g, 0.012, 0.16, 0.012, metal, 0, 0.11, 0.05);            // folded stock rail
    box(g, 0.01, 0.04, 0.025, metal, 0, -0.04, 0.085);           // rear sight
    return { group: g, muzzle: new THREE.Vector3(0, -0.34, 0.055) };
  }
  // shotgun
  cyl(g, 0.014, 0.62, metal, 0, -0.33, 0.06);                    // barrel
  cyl(g, 0.012, 0.44, metal, 0, -0.26, 0.032);                   // magazine tube
  cyl(g, 0.022, 0.16, wood, 0, -0.34, 0.034);                    // pump
  box(g, 0.042, 0.2, 0.06, metal, 0, -0.02, 0.05);               // receiver
  box(g, 0.032, 0.05, 0.11, wood, 0, 0.04, -0.02, -0.35);        // grip
  box(g, 0.04, 0.3, 0.07, wood, 0, 0.2, 0.02, 0.18);             // stock
  return { group: g, muzzle: new THREE.Vector3(0, -0.65, 0.06) };
}
