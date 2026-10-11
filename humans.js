// Echte 3D-Menschen: geskinnte Modelle (Mixamo-Skelett) mit Animationen, einfärbbarer Kleidung und Lippenbewegung.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/SkeletonUtils.js';

const T = { male: null, female: null, clips: { male: {}, female: {} } };
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const GUN_G = new THREE.BoxGeometry(0.05, 0.1, 0.28).translate(0, 0, 0.06);
const GUN_M = new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.85, roughness: 0.3 });
const HAIR_G = (() => { const g = new THREE.SphereGeometry(0.105, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.45); g.rotateX(-0.32); g.scale(0.95, 1.05, 1.08); return g; })();

export async function loadHumans(base, onProgress) {
  const loader = new GLTFLoader(), files = ['avatar.glb', 'michelle.glb', 'xbot.glb', 'soldier.glb'];
  let done = 0;
  // Fallback: Hosts, die keine .glb ausliefern, bekommen das Modell als Base64-Text (<name>.glb.txt)
  const loadOne = async f => {
    try { return await loader.loadAsync(base + f); }
    catch (e) {
      const r = await fetch(base + f + '.txt'); if (!r.ok) throw e;
      const bin = Uint8Array.from(atob((await r.text()).trim()), c => c.charCodeAt(0));
      return await loader.parseAsync(bin.buffer, base);
    }
  };
  const res = await Promise.all(files.map(f => loadOne(f).then(g => { onProgress?.(++done / files.length); return g; })));
  const [rpm, mich, xbot, sold] = res;
  T.male = prep(rpm.scene, 1.82); T.female = prep(mich.scene, 1.7);
  const find = (g, n) => g.animations.find(a => a.name === n);
  const src = { idle: find(sold, 'Idle'), walk: find(sold, 'Walk'), run: find(sold, 'Run'), sneak: find(xbot, 'sneak_pose'), agree: find(xbot, 'agree'), shake: find(xbot, 'headShake') };
  for (const [k, c] of Object.entries(src)) {
    const only = ['agree', 'shake', 'sneak'].includes(k) ? /(Neck|Head)\./ : null;
    T.clips.female[k] = clean(c, false, only); T.clips.male[k] = clean(c, true, only);
  }
}
function clean(clip, strip, only = null) {
  const tracks = clip.tracks.filter(t => t.name.endsWith('.quaternion') && !/Hips\.|Eye\./.test(t.name) && (!only || only.test(t.name))).map(t => { const c = t.clone(); if (strip) c.name = c.name.replace(/^mixamorig/, ''); return c; });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
function prep(scene, height) {
  scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene), s = height / (box.max.y - box.min.y);
  scene.scale.multiplyScalar(s); scene.position.y = -box.min.y * s;
  return scene;
}
const tintOf = c => new THREE.Color(c);
function tint(mesh, L, fem) {
  const m = mesh.material;
  if (fem) { if (L.tint) m.color.copy(tintOf(L.tint)); return; }
  switch (m.name) {
    case 'Wolf3D_Skin': case 'Wolf3D_Body': m.color.copy(tintOf(L.skin)); break;
    case 'Wolf3D_Outfit_Top': m.color.copy(tintOf(L.shirt)); break;
    case 'Wolf3D_Outfit_Bottom': m.color.copy(tintOf(L.pants)); break;
    case 'Wolf3D_Outfit_Footwear': m.color.copy(tintOf(L.shoes)); break;
    case 'Wolf3D_Beard': mesh.visible = L.beard > 0.3; m.color.copy(tintOf(L.hair)).multiplyScalar(2.2); break;
    case 'Wolf3D_Headwear': mesh.visible = !!L.hat; if (L.hat) m.color.copy(tintOf(L.hat)); break;
  }
}
export function makeHuman(L) {
  const fem = L.gender === 'f', tpl = fem ? T.female : T.male;
  const inner = SkeletonUtils.clone(tpl);
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body); body.add(inner);
  const meshes = [], mats = [], mouth = [], B = {};
  inner.traverse(o => {
    if (o.isBone) B[o.name.replace(/^mixamorig/, '')] = o;
    if (o.isMesh) {
      o.material = o.material.clone(); mats.push(o.material); meshes.push(o); tint(o, L, fem);
      if (o.morphTargetDictionary && o.morphTargetDictionary.mouthOpen !== undefined) mouth.push(o);
    }
  });
  inner.updateMatrixWorld(true);
  const ws = B.Head.getWorldScale(_v).x;
  if (!fem && !L.hat && L.hairStyle !== 'bald') {
    const hair = new THREE.Mesh(HAIR_G, new THREE.MeshStandardMaterial({ color: L.hair, roughness: 0.75 }));
    hair.scale.setScalar((L.hairStyle === 'slick' ? 1.06 : 1.0) / ws); hair.position.set(0, 0.075 / ws, -0.005 / ws); hair.castShadow = true;
    B.Head.add(hair); mats.push(hair.material); meshes.push(hair);
  }
  const gun = new THREE.Mesh(GUN_G, GUN_M); gun.scale.setScalar(1 / ws); gun.position.set(0, 0.08 / ws, 0.03 / ws); gun.rotation.set(Math.PI / 2, 0, 0); gun.visible = false; B.RightHand.add(gun);
  const mixer = new THREE.AnimationMixer(inner), C = fem ? T.clips.female : T.clips.male, A = {};
  for (const k in C) { A[k] = mixer.clipAction(C[k]); A[k].play(); A[k].setEffectiveWeight(k === 'idle' ? 1 : 0); }
  mixer.update(Math.random() * 3);
  return { group, body, inner, B, A, mixer, meshes, mats, mouth, gun, fem, t: Math.random() * 9, cast: true, talk: 0, w: { idle: 1, walk: 0, run: 0, sneak: 0, agree: 0, shake: 0 } };
}
export function disposeHuman(h) { for (const m of h.mats) m.dispose(); h.mixer.stopAllAction(); }
export function setHumanShadow(h, on) { if (h.cast === on) return; h.cast = on; for (const m of h.meshes) m.castShadow = on; }

// Zusätzliche Drehung im lokalen Knochenraum (Grad)
function rot(b, x, y, z) { if (!b) return; _e.set(x * Math.PI / 180, y * Math.PI / 180, z * Math.PI / 180); _q.setFromEuler(_e); b.quaternion.multiply(_q); }
const POSES = {
  sit(h) { const B = h.B; rot(B.LeftUpLeg, -90, 0, 0); rot(B.RightUpLeg, -90, 0, 0); rot(B.LeftLeg, 90, 0, 0); rot(B.RightLeg, 90, 0, 0); h.body.position.y = -0.45; },
  type(h, t) { POSES.sit(h); armsForward(h, 60, 70, 80, Math.sin(t * 14) * 3); },
  drive(h) { POSES.sit(h); armsForward(h, 75, 55, 55); },
  handsup(h) { const B = h.B; rot(B.RightArm, 0, 0, -150); rot(B.LeftArm, 0, 0, 150); rot(B.RightForeArm, -40, 0, 0); rot(B.LeftForeArm, -40, 0, 0); },
  watch(h) { POSES.sit(h); rot(h.B.Spine, -8, 0, 0); },
  lie(h) { h.body.rotation.x = -Math.PI / 2; h.body.position.set(0, 0.62, 0.95); },
  phone(h) { armTo(h, 'Right', 'phone'); },
  smoke(h, t) { armTo(h, 'Right', 'smoke', (Math.sin(t * 0.8) + 1) / 2); },
  cook(h, t) { armsForward(h, 75, 60, 60, Math.sin(t * 4) * 8); rot(h.B.Head, 20, 0, 0); },
  browse(h, t) { rot(h.B.Head, 8, Math.sin(t * 0.6) * 30, 0); },
  look(h, t) { rot(h.B.Head, 0, Math.sin(t * 0.5) * 35, 0); },
  talk() {}, stand() {},
};
// Armhaltungen (im Testlauf kalibriert: Ellbogen beugt um lokale X-Achse, Oberarm hebt um Z)
function armsForward(h, up, side, elbow, wiggle = 0) {
  const B = h.B;
  rot(B.RightArm, up, 0, -side); rot(B.RightForeArm, -elbow + wiggle, 0, 0);
  rot(B.LeftArm, up, 0, side); rot(B.LeftForeArm, -elbow - wiggle, 0, 0);
}
function armTo(h, side, kind, k = 0) {
  const B = h.B, m = side === 'Right' ? -1 : 1;
  if (kind === 'phone') { rot(B[side + 'Arm'], 60, 0, m * 40); rot(B[side + 'ForeArm'], -150, 0, 0); }
  else { rot(B[side + 'Arm'], 45 + k * 15, 0, m * 40); rot(B[side + 'ForeArm'], -120 - k * 25, 0, 0); }
}
export function testRot(h, list) { for (const [b, x, y, z] of list) rot(h.B[b], x, y, z); }
export function aimPose(h, pitch) {
  const B = h.B;
  rot(B.RightArm, 80 - pitch * 45, 0, -75); rot(B.LeftArm, 70 - pitch * 45, 0, 60); rot(B.LeftForeArm, -40, 0, 0);
}
export function punchPose(h, k) { rot(h.B.RightArm, 40 + k * 45, 0, -75); rot(h.B.RightForeArm, -(90 - k * 85), 0, 0); }

// speed in m/s; pose optional (sit, type, phone, talk, …)
export function animHuman(h, speed, dt, aiming = false, pose = null, sneak = false) {
  h.t += dt;
  const W = h.w, run = speed > 4.5;
  const tw = { idle: 0, walk: 0, run: 0, sneak: 0, agree: 0, shake: 0 };
  if (speed < 0.2) tw.idle = 1; else if (run) tw.run = 1; else tw.walk = 1;
  if (sneak) { tw.sneak = 0.65; tw.idle *= 0.35; tw.walk *= 0.35; }
  if (pose === 'talk') { tw.idle = 0.5; tw[(Math.floor(h.t / 4) % 2) ? 'agree' : 'shake'] = 0.5; }
  const k = Math.min(1, dt * 8);
  for (const n in tw) { W[n] += (tw[n] - W[n]) * k; h.A[n]?.setEffectiveWeight(W[n]); }
  h.A.walk.timeScale = Math.max(0.5, speed / 1.45); h.A.run.timeScale = Math.max(0.7, speed / 5.5);
  h.mixer.update(dt);
  h.body.position.set(0, 0, 0); h.body.rotation.set(0, 0, 0);
  if (sneak) { const B = h.B; rot(B.LeftUpLeg, -40, 0, 0); rot(B.RightUpLeg, -40, 0, 0); rot(B.LeftLeg, 65, 0, 0); rot(B.RightLeg, 65, 0, 0); rot(B.Spine, 18, 0, 0); h.body.position.y = -0.14; }
  if (!aiming && pose && POSES[pose]) POSES[pose](h, h.t);
  h.gun.visible = aiming;
  // Lippenbewegung
  h.talk = Math.max(0, h.talk - dt * 2);
  for (const m of h.mouth) m.morphTargetInfluences[m.morphTargetDictionary.mouthOpen] = h.talkAmp ?? 0;
}
