// Realistic humans: CC0 MakeHuman (MPFB2) skinned meshes with the game_engine rig, built headlessly in Blender
// (tools/human/build.py) and driven at runtime by the same procedural gait/pose system as the fallback figure.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { OUTFIT_COLORS, SKIN_TONES, type Appearance, type OutfitStyle } from '../../shared/constants';

type Gender = 'male' | 'female';
interface BoneRest { R: THREE.Quaternion; RpInv: THREE.Quaternion; parent: string | null }
interface Src {
  scene: THREE.Object3D; rest: Map<string, BoneRest>; hipY: number; armOff: { l: THREE.Quaternion; r: THREE.Quaternion }; foreOff: { l: THREE.Quaternion; r: THREE.Quaternion };
  /** bone suffix of the side at negative x (procedural legL/armL live at x<0) */
  negSide: 'l' | 'r';
  headTop: THREE.Vector3; eye: THREE.Vector3; chest: THREE.Vector3; neckY: number; shoulderY: number; kneeY: number; shoulderHalf: number;
}
const SRC: Partial<Record<Gender, Src>> = {};
const TEX: Record<string, THREE.Texture> = {};
let loading: Promise<boolean> | null = null;
export const humansReady = () => !!SRC.male && !!SRC.female;

const TEX_FILES = ['skin_m.jpg', 'skin_f.jpg', 'eye_brown.jpg', 'brows.png', 'lashes.png', 'hair_m.png', 'hair_f.png', 'shoes.jpg', 'shoes_n.jpg',
  'tee_m.jpg', 'tee_m_n.jpg', 'shirt_m.jpg', 'shirt_m_gray.jpg', 'shirt_m_n.jpg', 'suit_m.jpg', 'suit_m_white.jpg', 'blouse_f_gray.jpg', 'blouse_f_n.jpg'];

/** Load both bodies + textures once (skipped on Low quality → procedural figures). Resolves false on failure (fallback). */
export function preloadHumans(): Promise<boolean> {
  if (loading) return loading;
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const tl = new THREE.TextureLoader();
  const texP = Promise.all(TEX_FILES.map((f) => tl.loadAsync('/models/tex/' + f).then((t) => {
    t.flipY = false; // glTF UV convention
    if (!f.includes('_n.')) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4; TEX[f] = t;
  })));
  loading = Promise.all([texP, ...(['male', 'female'] as Gender[]).map((g) => loader.loadAsync(`/models/${g}.glb`).then((gl) => { SRC[g] = analyse(gl.scene); }))])
    .then(() => true).catch((e) => { console.warn('realistic humans unavailable, using procedural figures', e); return false; });
  return loading;
}

const V = () => new THREE.Vector3();
function analyse(scene: THREE.Object3D): Src {
  scene.updateMatrixWorld(true);
  const rest = new Map<string, BoneRest>();
  const pos = (n: string) => { const b = scene.getObjectByName(n)!; return b.getWorldPosition(V()); };
  scene.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    const R = o.getWorldQuaternion(new THREE.Quaternion());
    const p = o.parent && (o.parent as THREE.Bone).isBone ? o.parent : null;
    const Rp = p ? p.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    rest.set(o.name, { R, RpInv: Rp.invert(), parent: p ? p.name : null });
  });
  const DOWN = new THREE.Vector3(0, -1, 0);
  const armOff = (s: 'l' | 'r') => new THREE.Quaternion().setFromUnitVectors(pos(`lowerarm_${s}`).sub(pos(`upperarm_${s}`)).normalize(), DOWN);
  // forearm: after the upper-arm correction, also straighten the forearm so the whole arm hangs down
  const foreOff = (s: 'l' | 'r') => {
    const up = armOff(s);
    const d = pos(`hand_${s}`).sub(pos(`lowerarm_${s}`)).normalize().applyQuaternion(up);
    return new THREE.Quaternion().setFromUnitVectors(d, DOWN).multiply(up);
  };
  // landmarks from the body mesh at bind pose
  const body = scene.getObjectByName('Body_tee') ?? scene.getObjectByName('Body_blouse');
  const eyes = scene.getObjectByName('Eyes') as THREE.Mesh | undefined;
  const top = V().set(0, 0, 0), chest = V().set(0, 0, 0);
  const neckY = pos('neck_01').y;
  scene.updateMatrixWorld(true);
  if (body) {
    const m = body as THREE.Mesh; const a = m.geometry.getAttribute('position'); const v = V();
    for (let i = 0; i < a.count; i++) {
      ((m as THREE.SkinnedMesh).isSkinnedMesh ? m.getVertexPosition(i, v) : v.fromBufferAttribute(a, i)).applyMatrix4(m.matrixWorld);
      if (v.y > top.y) top.copy(v);
      if (Math.abs(v.x) < 0.04 && v.y > neckY - 0.2 && v.y < neckY - 0.1 && v.z > chest.z) chest.copy(v);
    }
  }
  const eye = V();
  if (eyes) { // skinned + quantized: average the posed vertices rather than the raw bbox
    const a = eyes.geometry.getAttribute('position'); const v = V();
    for (let i = 0; i < a.count; i++) eye.add(eyes.getVertexPosition(i, v).applyMatrix4(eyes.matrixWorld));
    eye.multiplyScalar(1 / Math.max(1, a.count));
  }
  const ul = pos('upperarm_l'), ur = pos('upperarm_r');
  return { scene, rest, negSide: ul.x < 0 ? 'l' : 'r', hipY: pos('thigh_l').y, armOff: { l: armOff('l'), r: armOff('r') }, foreOff: { l: foreOff('l'), r: foreOff('r') }, headTop: top, eye, chest, neckY,
    shoulderY: ul.y, kneeY: pos('calf_l').y, shoulderHalf: Math.abs(ul.x - ur.x) / 2 };
}

export interface ProcJoints {
  legL: THREE.Euler; legR: THREE.Euler; kneeL: THREE.Euler; kneeR: THREE.Euler;
  armL: THREE.Euler; armR: THREE.Euler; elbowL: THREE.Euler; elbowR: THREE.Euler; head: THREE.Euler;
}
const SKIN_REF = new THREE.Color('#4c3225');
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
const I = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
/** forearm pronation so palms face the thighs (rest pose has palms forward/down) */
export let TWIST = 1.2;
export function setTwist(v: number): void { TWIST = v; }

let ankara: THREE.CanvasTexture | null = null;
export function setAnkaraTexture(t: THREE.CanvasTexture): void { ankara = t; }

/** One realistic character instance (skinned clone + per-character materials). */
export class HumanRig {
  root: THREE.Object3D;
  private src: Src;
  private bones = new Map<string, THREE.Bone>();
  private meshes = new Map<string, THREE.SkinnedMesh>();
  readonly hipY: number;

  constructor(app: Appearance, style: OutfitStyle, crown: boolean, sunglasses: boolean, castShadow: boolean) {
    const g: Gender = app.body === 'female' ? 'female' : 'male';
    this.src = SRC[g]!;
    this.root = SkeletonUtils.clone(this.src.scene);
    this.hipY = this.src.hipY;
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) { const m = o as THREE.SkinnedMesh; this.meshes.set(m.name, m); m.castShadow = castShadow; m.receiveShadow = false; m.frustumCulled = false; }
    });
    this.dress(g, app, style);
    this.extras(g, style, crown, sunglasses);
    // weapon socket on the right (+x) hand bone, oriented like the procedural hand frame (−y along the forearm, +z forward)
    const S = this.src, side = S.negSide === 'l' ? 'r' : 'l';
    const fo = side === 'l' ? S.foreOff.l : S.foreOff.r;
    const rest = new THREE.Quaternion().setFromAxisAngle(Z, 0.03).multiply(new THREE.Quaternion().setFromAxisAngle(Y, -TWIST)).multiply(fo);
    this.handSocket.quaternion.copy(rest).invert();
    this.root.updateMatrixWorld(true);
    const hb = this.bones.get(`hand_${side}`);
    if (hb) this.attach(`hand_${side}`, this.handSocket, this.root.worldToLocal(hb.getWorldPosition(new THREE.Vector3())));
  }
  /** follows the right hand bone; weapons are parented here */
  readonly handSocket = new THREE.Group();

  private mat(map: string | null, color: THREE.ColorRepresentation = '#ffffff', o: Partial<THREE.MeshStandardMaterialParameters> = {}, normal?: string): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ map: map ? TEX[map] : null, color, roughness: 0.82, normalMap: normal ? TEX[normal] : null, ...o });
  }

  private dress(g: Gender, app: Appearance, style: OutfitStyle): void {
    const show = new Set<string>(['Eyes', 'Brows', 'Lashes', 'Hair', 'Shoes']);
    const skin = new THREE.MeshStandardMaterial({ map: TEX[g === 'male' ? 'skin_m.jpg' : 'skin_f.jpg'], roughness: 0.58, metalness: 0 });
    const tone = new THREE.Color(SKIN_TONES[app.skin] ?? SKIN_TONES[2]);
    skin.color.setRGB(Math.min(2, tone.r / SKIN_REF.r), Math.min(2, tone.g / SKIN_REF.g), Math.min(2, tone.b / SKIN_REF.b));
    const outfit = OUTFIT_COLORS[app.outfit] ?? '#7a1f1f';
    let body: string, top: THREE.Material | null = null, bottom: THREE.Material | null = null, topName = '', bottomName = '';
    const native: Partial<Record<OutfitStyle, string>> = { senator: '#1f2a44', agbada: '#e3d8bd', edo_coral: '#f1efe8', police: '#1a1c22' };
    if (g === 'male') {
      if (style === 'black_suit' || style === 'white_suit') {
        body = 'Body_suit'; show.add('Cloth_suit');
        this.meshes.get('Cloth_suit')!.material = this.mat(style === 'white_suit' ? 'suit_m_white.jpg' : 'suit_m.jpg', '#ffffff', { roughness: style === 'white_suit' ? 0.6 : 0.7 });
      } else if (style === 'casual') {
        body = 'Body_tee'; topName = 'Cloth_tee_top'; bottomName = 'Cloth_tee_bottom';
        top = this.mat('tee_m.jpg', outfit, {}, 'tee_m_n.jpg'); bottom = this.mat('tee_m.jpg', '#ffffff', { roughness: 0.9 }, 'tee_m_n.jpg');
      } else {
        body = 'Body_shirt'; topName = 'Cloth_shirt_top'; bottomName = 'Cloth_shirt_bottom';
        if (style === 'ankara' && ankara) {
          const t = ankara.clone(); t.repeat.set(7, 7); t.needsUpdate = true; top = this.mat(null, '#ffffff', { map: t }, 'shirt_m_n.jpg');
          bottom = this.mat('shirt_m.jpg', '#ffffff', { roughness: 0.9 }, 'shirt_m_n.jpg');
        } else {
          const c = native[style] ?? '#1f2a44';
          top = this.mat('shirt_m_gray.jpg', c, { roughness: style === 'edo_coral' ? 0.6 : 0.8 }, 'shirt_m_n.jpg');
          bottom = this.mat('shirt_m_gray.jpg', style === 'police' ? '#121317' : c, { roughness: 0.85 }, 'shirt_m_n.jpg');
        }
      }
    } else {
      body = 'Body_blouse'; topName = 'Cloth_blouse_top'; bottomName = 'Cloth_blouse_bottom';
      const topC = style === 'white_suit' ? '#f2f0ea' : style === 'black_suit' ? '#1a1b1e' : native[style] ?? outfit;
      const botC = style === 'white_suit' ? '#ecebe4' : style === 'black_suit' || style === 'police' ? '#16171a' : native[style] ?? '#2a2c31';
      top = style === 'ankara' && ankara ? (() => { const t = ankara!.clone(); t.repeat.set(7, 7); t.needsUpdate = true; return this.mat(null, '#ffffff', { map: t }, 'blouse_f_n.jpg'); })()
        : this.mat('blouse_f_gray.jpg', topC, {}, 'blouse_f_n.jpg');
      bottom = this.mat('blouse_f_gray.jpg', botC, { roughness: 0.85 }, 'blouse_f_n.jpg');
    }
    show.add(body);
    if (topName) { show.add(topName); this.meshes.get(topName)!.material = top!; }
    if (bottomName) { show.add(bottomName); this.meshes.get(bottomName)!.material = bottom!; }
    this.meshes.get(body)!.material = skin;
    const hair = this.mat(g === 'male' ? 'hair_m.png' : 'hair_f.png', '#2a211c', { alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
    this.meshes.get('Hair')!.material = hair;
    this.meshes.get('Brows')!.material = this.mat('brows.png', '#1a1310', { alphaTest: 0.35, transparent: false, side: THREE.DoubleSide });
    this.meshes.get('Lashes')!.material = this.mat('lashes.png', '#0d0a09', { alphaTest: 0.35, side: THREE.DoubleSide });
    this.meshes.get('Eyes')!.material = this.mat('eye_brown.jpg', '#ffffff', { roughness: 0.15 });
    this.meshes.get('Shoes')!.material = this.mat('shoes.jpg', g === 'female' ? '#5a4a42' : style === 'white_suit' || style === 'edo_coral' ? '#efe9de' : '#ffffff', { roughness: 0.45 }, 'shoes_n.jpg');
    for (const [n, m] of this.meshes) m.visible = show.has(n);
  }

  /** accessories placed in model space at rest, then parented to a bone so they follow it */
  private attach(boneName: string, obj: THREE.Object3D, modelPos: THREE.Vector3): void {
    const b = this.bones.get(boneName)!;
    this.root.updateMatrixWorld(true);
    obj.position.copy(modelPos).applyMatrix4(this.root.matrixWorld); // root is at identity during construction
    b.attach(obj);
  }

  private extras(g: Gender, style: OutfitStyle, crown: boolean, sunglasses: boolean): void {
    const S = this.src;
    const gold = new THREE.MeshStandardMaterial({ color: '#d4a24a', metalness: 1, roughness: 0.28, emissive: '#3a2608', emissiveIntensity: 0.25 });
    const front = S.chest.z;
    if (crown) {
      const pend = new THREE.Group();
      const shape = new THREE.Shape();
      const P = (x: number, y: number) => [x * 0.09, y * 0.09] as const;
      shape.moveTo(...P(-0.5, 0.42)); shape.lineTo(...P(-0.27, -0.18)); shape.lineTo(...P(-0.17, -0.06)); shape.lineTo(...P(0, -0.42));
      shape.lineTo(...P(0.17, -0.06)); shape.lineTo(...P(0.27, -0.18)); shape.lineTo(...P(0.5, 0.42)); shape.lineTo(...P(0.24, 0.0));
      shape.lineTo(...P(0, 0.62)); shape.lineTo(...P(-0.24, 0.0)); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2 }); geo.center();
      const pm = new THREE.Mesh(geo, gold); pend.add(pm); // shape is already upright (matches /brand/crown_gold.png)
      const chain = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.0035, 6, 40, Math.PI), gold);
      chain.rotation.set(Math.PI / 2 + 1.0, 0, Math.PI); chain.scale.set(1, 1.25, 1); chain.position.set(0, 0.075, -0.045); pend.add(chain);
      this.attach('spine_03', pend, new THREE.Vector3(0, S.neckY - 0.17, front + (style === 'white_suit' || style === 'black_suit' ? 0.055 : 0.02)));
    }
    if (style === 'edo_coral') {
      const coral = new THREE.MeshStandardMaterial({ color: '#c0281c', roughness: 0.35 });
      const bead = new THREE.SphereGeometry(0.0085, 8, 6);
      const grp = new THREE.Group();
      for (const [drop, n, rr] of [[0.06, 28, 0.075], [0.11, 36, 0.09]] as const) {
        const inst = new THREE.InstancedMesh(bead, coral, n); const m = new THREE.Matrix4();
        for (let i = 0; i < n; i++) {
          const a = (i / (n - 1)) * Math.PI * 1.7 - Math.PI * 0.85; const fr = Math.cos(a);
          m.makeTranslation(Math.sin(a) * rr, -drop * Math.max(0, fr) ** 1.5, fr * rr * 0.8); inst.setMatrixAt(i, m);
        }
        grp.add(inst);
      }
      this.attach('spine_03', grp, new THREE.Vector3(0, S.neckY - 0.03, (front + 0.0) * 0.5));
    }
    if (style === 'agbada' || style === 'edo_coral' || style === 'police') {
      const cap = new THREE.Group();
      if (style === 'police') {
        const cm = new THREE.MeshStandardMaterial({ color: '#101114', roughness: 0.6 });
        cap.add(new THREE.Mesh(new THREE.CylinderGeometry(0.108, 0.098, 0.07, 28), cm));
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.008, 24, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ color: '#050506', roughness: 0.2 }));
        brim.position.set(0, -0.03, 0.06); brim.rotation.x = 0.15; brim.scale.set(1, 1, 0.8); cap.add(brim);
        const badge = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), gold); badge.position.set(0, 0.0, 0.103); badge.scale.set(1, 1, 0.4); cap.add(badge);
      } else {
        const cm = new THREE.MeshStandardMaterial({ color: style === 'agbada' ? '#d8ccb0' : '#b52418', roughness: style === 'agbada' ? 0.85 : 0.4 });
        const pts = [[0.104, 0.0], [0.106, 0.045], [0.098, 0.08], [0.065, 0.1], [0.0, 0.104]].map(([r, y]) => new THREE.Vector2(r, y));
        const c = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), cm); if (style === 'agbada') c.rotation.z = 0.12; cap.add(c);
      }
      this.attach('head', cap, new THREE.Vector3(0, S.headTop.y - (style === 'police' ? 0.045 : 0.075), S.eye.z - 0.085));
    }
    if (style === 'agbada') { // flowing robe from the shoulders to below the knee, embroidered neckline
      const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d')!;
      x.fillStyle = '#e9dfc6'; x.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 512; i += 6) { x.globalAlpha = 0.05 + 0.08 * Math.abs(Math.sin(i * 0.11)); x.fillStyle = '#8a7a58'; x.fillRect(i, 0, 3, 256); } // drape folds
      x.globalAlpha = 1; x.strokeStyle = '#b8892c'; x.lineWidth = 3;
      for (const cx of [128, 384]) { for (let r = 14; r < 70; r += 12) { x.beginPath(); x.arc(cx, 0, r, 0, Math.PI); x.stroke(); } }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
      const top = S.shoulderY + 0.05, bot = S.kneeY - 0.02, L = top - bot, w = S.shoulderHalf;
      const prof = [[0.075, 0], [0.12, -0.012], [w + 0.03, -0.05], [w + 0.07, -0.14], [w + 0.07, -L * 0.55], [w + 0.1, -L]].map(([r, y]) => new THREE.Vector2(r, y));
      const robe = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, side: THREE.DoubleSide }));
      robe.scale.set(1, 1, 0.5); robe.castShadow = true;
      this.attach('spine_02', robe, new THREE.Vector3(0, top, -0.01));
    }
    if (sunglasses) {
      const lens = new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.05, metalness: 0.7 });
      const sg = new THREE.Group();
      for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), lens); l.position.set(sx * 0.032, 0, 0); l.scale.set(1.35, 0.85, 0.3); sg.add(l); }
      this.attach('head', sg, new THREE.Vector3(0, S.eye.y, S.eye.z + 0.012));
    }
  }

  /** Map the procedural joint angles (same conventions as the fallback figure) onto the skeleton. */
  apply(j: ProcJoints): void {
    const S = this.src;
    const set = (name: string, W: THREE.Quaternion, Wp: THREE.Quaternion) => {
      const r = S.rest.get(name)!; const b = this.bones.get(name)!;
      // local = Rp^-1 · Wp^-1 · W · R
      b.quaternion.copy(r.RpInv).multiply(qc.copy(Wp).invert().multiply(W)).multiply(r.R);
    };
    const dLeg = new THREE.Quaternion(), dKnee = new THREE.Quaternion(), dArm = new THREE.Quaternion(), dEl = new THREE.Quaternion();
    const neg = S.negSide, pos = neg === 'l' ? 'r' : 'l';
    for (const [s, sx, leg, knee, arm, el] of [[neg, -1, j.legL, j.kneeL, j.armL, j.elbowL], [pos, 1, j.legR, j.kneeR, j.armR, j.elbowR]] as const) {
      dLeg.setFromEuler(leg); dKnee.setFromEuler(knee);
      const wThigh = dLeg.clone(); const wCalf = dLeg.clone().multiply(dKnee);
      set(`thigh_${s}`, wThigh, I); set(`calf_${s}`, wCalf, wThigh);
      dArm.setFromEuler(arm); dEl.setFromEuler(el);
      const off = s === 'l' ? S.armOff.l : S.armOff.r;
      // procedural arms carry a base abduction of ±0.09 rad which suits the thin fallback figure; real shoulders need a bit more
      qa.setFromAxisAngle(Z, sx * 0.03);
      const fo = s === 'l' ? S.foreOff.l : S.foreOff.r;
      const twist = qb.setFromAxisAngle(Y, -sx * TWIST);
      const wUp = dArm.clone().multiply(qa).multiply(off);
      const wLow = dArm.clone().multiply(qa).multiply(dEl).multiply(twist).multiply(fo);
      set(`upperarm_${s}`, wUp, I); set(`lowerarm_${s}`, wLow, wUp);
    }
    qb.setFromEuler(j.head);
    const wNeck = new THREE.Quaternion().slerp(qb, 0.4);
    set('neck_01', wNeck, I); set('head', qb, wNeck);
  }
}
