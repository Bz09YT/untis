// Echte Assets: Fotopanorama (HDR), PBR-Fototexturen und detaillierte glTF-Modelle
// Quellen: three.js-Beispielassets und Khronos glTF-Sample-Assets (Lizenzen siehe README)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { RGBELoader } from 'three/addons/RGBELoader.js';
import { MeshoptDecoder } from 'three/addons/meshopt_decoder.module.js';

export const ASSETS = { models: {}, img: {}, hdr: null };

// Binärdatei laden; Hosts ohne .glb/.hdr-Auslieferung bekommen sie als Base64-Text (<name>.txt)
async function fetchBin(url) {
  try { const r = await fetch(url); if (r.ok) return await r.arrayBuffer(); } catch (e) { /* weiter mit Fallback */ }
  const r2 = await fetch(url + '.txt'); if (!r2.ok) throw new Error('fehlt: ' + url);
  const b = atob((await r2.text()).trim()), u = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
  return u.buffer;
}
const loadImg = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

const MODELS = ['ferrari', 'CarConcept', 'CommercialRefrigerator', 'TrafficCone', 'SheenChair', 'SheenWoodLeatherSofa', 'DiffuseTransmissionPlant', 'WaterBottle', 'WaterBottleLow', 'Avocado', 'MandarinOrange', 'BarramundiFish'];
const IMAGES = ['brick_diffuse', 'brick_bump', 'brick_roughness', 'hardwood2_diffuse', 'hardwood2_bump', 'hardwood2_roughness', 'Water_1_M_Normal'];

export async function loadAssets(base, onProgress) {
  const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
  let done = 0; const total = MODELS.length + IMAGES.length + 1, tick = () => onProgress?.(++done / total);
  await Promise.all([
    ...MODELS.map(async m => {
      try { const g = await gl.parseAsync(await fetchBin(base + m + '.glb'), base); prepModel(m, g.scene); ASSETS.models[m] = g.scene; }
      catch (e) { console.warn('Modell nicht geladen', m, e); }
      tick();
    }),
    ...IMAGES.map(async n => { ASSETS.img[n] = await loadImg(base + n + '.jpg'); tick(); }),
    (async () => {
      try { const d = new RGBELoader().parse(await fetchBin(base + 'san_giuseppe_bridge_2k.hdr')); const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type); t.mapping = THREE.EquirectangularReflectionMapping; t.flipY = true; t.colorSpace = THREE.LinearSRGBColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; ASSETS.hdr = t; }
      catch (e) { console.warn('HDR nicht geladen', e); }
      tick();
    })(),
  ]);
  return ASSETS;
}
// Maße und Schatten vorbereiten; Modelle stehen auf y=0 und sind zentriert
function prepModel(name, root) {
  // Streu-Objekte aus den Khronos-Szenen (Bodenplatte, Glühbirne, Glühwürmchen) entfernen, bevor die Maße berechnet werden
  const stray = []; root.traverse(o => { if (o !== root && /^(GroundPlane|Plane|Bulb|BulbMesh|firefly\d*|pointlight_|chase_)/i.test(o.name || '')) stray.push(o); });
  for (const o of stray) o.removeFromParent();
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root), c = bb.getCenter(new THREE.Vector3());
  root.userData.size = bb.getSize(new THREE.Vector3());
  root.userData.offset = new THREE.Vector3(-c.x, -bb.min.y, -c.z);
  // Teure Physical-Erweiterungen (Transmission, Sheen, Iridescence …) ersetzen: sie rendern die Szene pro Frame erneut und lassen das Bild beim Einsteigen hängen
  let tris = 0;
  root.traverse(o => {
    if (o.isCamera || o.isLight) o.visible = false;
    if (!o.isMesh) return;
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    o.receiveShadow = true;
    o.material = Array.isArray(o.material) ? o.material.map(lightMat) : lightMat(o.material);
  });
  // Sehr detaillierte Modelle werfen den Schatten über einen unsichtbaren Quader statt über jedes Dreieck
  root.userData.heavy = tris > 40000;
  root.traverse(o => { if (o.isMesh) o.castShadow = !root.userData.heavy; });
}
const lightCache = new Map();
function lightMat(m) {
  if (!m?.isMeshPhysicalMaterial || !(m.transmission > 0 || m.sheen > 0 || m.iridescence > 0 || m.thickness > 0 || m.dispersion > 0 || m.clearcoat > 0)) return m;
  if (lightCache.has(m)) return lightCache.get(m);
  const glass = m.transmission > 0;
  const n = new THREE.MeshStandardMaterial({ name: m.name, color: m.color, map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap, aoMap: m.aoMap, emissive: m.emissive, emissiveMap: m.emissiveMap, alphaMap: m.alphaMap,
    roughness: glass ? 0.05 : m.roughness, metalness: glass ? 0 : m.metalness, side: m.side, vertexColors: m.vertexColors, alphaTest: m.alphaTest,
    transparent: glass || m.transparent, opacity: glass ? Math.min(m.opacity, 0.3) : m.opacity, depthWrite: glass ? false : m.depthWrite });
  if (m.normalScale) n.normalScale.copy(m.normalScale);
  lightCache.set(m, n); return n;
}
// Kopie eines Modells, auf Zielgröße skaliert (fit: 'x' Breite, 'y' Höhe, 'z' Länge)
export function modelInstance(name, size, fit = 'y') {
  const src = ASSETS.models[name]; if (!src) return null;
  const s = size / src.userData.size[fit], wrap = new THREE.Group(), inner = src.clone(true);
  inner.position.copy(src.userData.offset); wrap.add(inner); wrap.scale.setScalar(s); wrap.userData.scale = s;
  if (src.userData.heavy) {
    const z = src.userData.size, box = new THREE.Mesh(new THREE.BoxGeometry(z.x * 0.92, z.y * 0.75, z.z * 0.95), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    box.position.y = z.y * 0.4; box.castShadow = true; wrap.add(box);
  }
  return wrap;
}
// Textur aus geladenem Foto
export function photoTex(name, repeat = 1, srgb = true) {
  const img = ASSETS.img[name]; if (!img) return null;
  const t = new THREE.Texture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t;
}
