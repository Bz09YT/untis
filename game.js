// GTA – Los Santos (Browser-3D, Three.js) – direkt als Franklin, keine Intro-Mission.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/pp/EffectComposer.js';
import { RenderPass } from 'three/addons/pp/RenderPass.js';
import { ShaderPass } from 'three/addons/pp/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/pp/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/pp/OutputPass.js';
import { GTAOPass } from 'three/addons/pp/GTAOPass.js';
import { SMAAPass } from 'three/addons/pp/SMAAPass.js';
import { ASSETS, loadAssets, modelInstance, photoTex } from './assets.js';
import { loadHumans, makeHuman, animHuman, disposeHuman, setHumanShadow, aimPose, punchPose } from './humans.js';

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

// ---------- World layout ----------
const B = 60, R = 16, P = B + R, N = 14;
const roadPos = k => (k - N / 2) * P;           // Straßenmittellinien, k = 0..N
const BLOCK0 = roadPos(0) + R / 2;                // Rand des ersten Blocks
const EXT = N / 2 * P + R / 2;                    // Halbe Stadtgröße
const blockCenter = i => BLOCK0 + i * P + B / 2;
const inBlock = v => { const m = v - BLOCK0; if (m < 0 || m > N * P) return false; return (m % P) < B; };
const groundH = (x, z) => (inBlock(x) && inBlock(z)) ? 0.2 : 0;
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const LANE = 4, PARK = 6.6;

// ---------- Renderer ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const ANISO = renderer.capabilities.getMaxAnisotropy();

const dpr = window.devicePixelRatio || 1;
const QUALITY = [
  ['Standard', () => dpr], ['Hoch', () => Math.max(dpr, 1.5)],
  ['Ultra HD (2x Supersampling)', () => Math.max(dpr, 2)], ['Maximum (3x Supersampling)', () => Math.max(dpr, 3)],
];
let qIdx = 1;
function applySize() {
  const w = innerWidth, h = innerHeight;
  const ratio = Math.min(QUALITY[qIdx][1](), 8192 / Math.max(w, h));
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  if (composer) { composer.setPixelRatio(ratio); composer.setSize(w, h); if (aoPass) { aoPass.enabled = qIdx >= 2; aoPass.setSize(Math.max(2, Math.round(w * ratio / 2)), Math.max(2, Math.round(h * ratio / 2))); } if (smaaPass) { smaaPass.enabled = qIdx < 2; smaaPass.setSize(Math.round(w * ratio), Math.round(h * ratio)); } }
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
// Nachbearbeitung: Bloom + Farbkorrektur (warmes Kalifornien-Licht, Sättigung, Vignette)
let composer = null, bloomPass = null, aoPass = null, smaaPass = null;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.03 }, warm: { value: new THREE.Vector3(1.0, 1.0, 1.0) }, vig: { value: 0.25 }, contrast: { value: 1.04 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, vig, contrast; uniform vec3 warm; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb * warm;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(l), col, sat);
      col *= mix(vec3(0.985, 0.995, 1.02), vec3(1.02, 1.0, 0.975), smoothstep(0.05, 0.9, l)); // dezentes Split-Toning: kühle Schatten, warme Lichter
      col = pow(max(col, 0.0), vec3(contrast)) * (1.0 + (contrast - 1.0) * 0.5);
      vec2 d = vUv - 0.5; col *= 1.0 - vig * dot(d, d) * 1.6;
      gl_FragColor = vec4(col, c.a);
    }`,
};
function setupPost() {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight); aoPass.output = GTAOPass.OUTPUT.Default; aoPass.blendIntensity = 0.8; aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1 }); composer.addPass(aoPass);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.55, 0.9);
  composer.addPass(bloomPass);
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());
  smaaPass = new SMAAPass(innerWidth, innerHeight); composer.addPass(smaaPass); // nach Tonemapping (LDR)
  applySize();
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.25, 9000);
scene.fog = new THREE.FogExp2(0xa9cdee, 0.0011);
addEventListener('resize', applySize);
applySize();

// ---------- Textures ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = ANISO; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function speckle(ctx, w, h, n, light, dark) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${Math.random() * light})` : `rgba(0,0,0,${Math.random() * dark})`;
    const s = Math.random() * 3 + 1; ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}
const TW = 21, TH = 14.4; // Weltgröße der klassischen Fassadenkachel (6 Achsen x 4 Etagen)
const FSTYLES = {
  classic: { TW: 21, TH: 14.4, bays: 6, floors: 4, tints: ['#d8d2c4', '#c9cdd3', '#b9a99a', '#a8b4c0', '#cdbba2', '#e0d9c8', '#c7b48a', '#d9c2b0'] },
  glass: { TW: 12, TH: 7.2, bays: 4, floors: 2, tints: ['#9fc4e8', '#8fb8b0', '#b8c8d8', '#c8b898', '#a0a8c0', '#d0d8e0'] },
  brick: { TW: 12, TH: 7.2, bays: 4, floors: 2, tints: ['#ffffff', '#f0e0d8', '#e6cfc0', '#d8d0c8', '#c8b8b0'] },
  stucco: { TW: 10.5, TH: 7.2, bays: 3, floors: 2, tints: ['#f4e6cc', '#f0d9c0', '#e9e2d2', '#f2cfc0', '#dfe9e0', '#f5f0e6', '#e8d0e0'] },
  concrete: { TW: 14, TH: 7.2, bays: 2, floors: 2, tints: ['#dcdcd6', '#c9cdd1', '#e2ddd2'] },
};
function makeFacade(id) {
  const st = FSTYLES[id], S = 1024, bw = S / st.bays, fh = S / st.floors;
  const lit = []; for (let i = 0; i < st.bays * st.floors; i++) lit.push(Math.random() < 0.55 ? rnd(0.5, 1) : 0);
  const win = (b, f) => ({
    classic: [b * bw + bw * 0.16, f * fh + fh * 0.18, bw * 0.68, fh * 0.6], glass: [b * bw + 5, f * fh + 5, bw - 10, fh - 46],
    brick: [b * bw + bw * 0.24, f * fh + fh * 0.2, bw * 0.52, fh * 0.56], stucco: [b * bw + bw * 0.28, f * fh + fh * 0.24, bw * 0.44, fh * 0.5],
    concrete: [b * bw, f * fh + fh * 0.24, bw, fh * 0.42],
  })[id];
  const eachWin = fn => { for (let f = 0; f < st.floors; f++) for (let b = 0; b < st.bays; b++) fn(...win(b, f), lit[f * st.bays + b]); };
  const glassFill = (c, x, y, w, h, a = '#1b2738', m = '#5b7a9e', z = '#162131') => { const g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, a); g.addColorStop(0.45, m); g.addColorStop(0.55, '#3e5878'); g.addColorStop(1, z); c.fillStyle = g; c.fillRect(x, y, w, h); };
  const color = canvasTex(S, S, c => {
    if (id === 'classic') {
      c.fillStyle = '#e4e1da'; c.fillRect(0, 0, S, S); speckle(c, S, S, 12000, 0.06, 0.07);
      for (let f = 0; f < st.floors; f++) { c.fillStyle = '#c4c0b6'; c.fillRect(0, f * fh + fh - 14, S, 14); }
      eachWin((x, y, w, h) => { c.fillStyle = '#8d8a83'; c.fillRect(x - 7, y - 7, w + 14, h + 14); glassFill(c, x, y, w, h); c.fillStyle = '#2b2b2b'; c.fillRect(x + w / 2 - 3, y, 6, h); c.fillRect(x, y + h * 0.35, w, 5); c.fillStyle = '#d2cec4'; c.fillRect(x - 10, y + h + 7, w + 20, 9); });
    } else if (id === 'glass') {
      c.fillStyle = '#26323f'; c.fillRect(0, 0, S, S);
      eachWin((x, y, w, h) => { glassFill(c, x, y, w, h, '#4f6f92', '#a8c4e0', '#35506e'); c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(x, y, w * 0.3, h); });
      c.fillStyle = '#1a2129'; for (let b = 0; b <= st.bays; b++) c.fillRect(b * bw - 3, 0, 6, S);
    } else if (id === 'brick') {
      c.fillStyle = '#c9b8a8'; c.fillRect(0, 0, S, S);
      if (ASSETS.img.brick_diffuse) { c.save(); c.scale(0.42, 0.42); c.fillStyle = c.createPattern(ASSETS.img.brick_diffuse, 'repeat'); c.fillRect(0, 0, S / 0.42, S / 0.42); c.restore(); }
      else for (let y = 0, row = 0; y < S; y += 18, row++) for (let x = (row % 2) * -22; x < S; x += 44) { c.fillStyle = `hsl(${rnd(8, 18)},${rnd(38, 55)}%,${rnd(30, 42)}%)`; c.fillRect(x + 1, y + 1, 42, 16); }
      eachWin((x, y, w, h) => { c.fillStyle = '#f2f0ea'; c.fillRect(x - 9, y - 9, w + 18, h + 18); glassFill(c, x, y, w, h); c.fillStyle = '#f2f0ea'; c.fillRect(x + w / 2 - 4, y, 8, h); c.fillRect(x, y + h * 0.5 - 4, w, 8); c.fillStyle = '#d8d0c0'; c.fillRect(x - 14, y + h + 9, w + 28, 12); });
    } else if (id === 'stucco') {
      c.fillStyle = '#f2ede4'; c.fillRect(0, 0, S, S); speckle(c, S, S, 9000, 0.05, 0.05);
      for (let f = 0; f < st.floors; f++) { c.fillStyle = 'rgba(160,110,80,.35)'; c.fillRect(0, f * fh, S, 10); }
      eachWin((x, y, w, h) => { c.fillStyle = '#3a3028'; c.fillRect(x - 6, y - 6, w + 12, h + 12); glassFill(c, x, y, w, h); c.fillStyle = '#3a3028'; c.fillRect(x + w / 2 - 3, y, 6, h); if (Math.random() < 0.5) { c.fillStyle = '#2a2a2a'; c.fillRect(x - 20, y + h - 4, w + 40, 5); for (let k = x - 20; k < x + w + 20; k += 12) c.fillRect(k, y + h * 0.6, 3, h * 0.4); } });
    } else {
      c.fillStyle = '#cfcfc9'; c.fillRect(0, 0, S, S); speckle(c, S, S, 16000, 0.06, 0.1);
      c.fillStyle = 'rgba(0,0,0,.08)'; for (let x = 0; x < S; x += 128) c.fillRect(x, 0, 2, S);
      eachWin((x, y, w, h) => { glassFill(c, x, y, w, h, '#23303e', '#4d6683', '#1c2531'); c.fillStyle = '#2a2f36'; for (let k = 0; k < w; k += 128) c.fillRect(x + k, y, 5, h); });
    }
  });
  const emis = canvasTex(S, S, c => {
    c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
    eachWin((x, y, w, h, l) => {
      if (!l) return;
      if (id === 'concrete' || id === 'glass') { for (let k = 0; k < w; k += 64) if (Math.random() < 0.6) { c.fillStyle = `rgba(${id === 'glass' ? '235,240,255' : '255,220,170'},${l})`; c.fillRect(x + k + 4, y + 4, 56, h - 8); } return; }
      const g = c.createLinearGradient(x, y, x, y + h); g.addColorStop(0, `rgba(255,214,150,${l})`); g.addColorStop(1, `rgba(255,150,70,${l * 0.8})`);
      c.fillStyle = g; c.fillRect(x, y, w, h); c.fillStyle = '#000'; c.fillRect(x + w / 2 - 3, y, 6, h);
    });
  });
  const orm = canvasTex(S, S, c => {
    c.fillStyle = id === 'glass' ? 'rgb(255,105,40)' : 'rgb(255,230,0)'; c.fillRect(0, 0, S, S);
    if (id === 'brick' && ASSETS.img.brick_roughness) { c.save(); c.scale(0.42, 0.42); c.fillStyle = c.createPattern(ASSETS.img.brick_roughness, 'repeat'); c.fillRect(0, 0, S / 0.42, S / 0.42); c.restore(); c.globalCompositeOperation = 'multiply'; c.fillStyle = 'rgb(255,255,0)'; c.fillRect(0, 0, S, S); c.globalCompositeOperation = 'source-over'; }
    eachWin((x, y, w, h) => { c.fillStyle = 'rgb(255,20,0)'; c.fillRect(x, y, w, h); }); // Fenster: Dielektrikum (metalness 0), roughness ~0.08
  }, false);
  return new THREE.MeshStandardMaterial({ map: color, emissiveMap: emis, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, vertexColors: true });
}
let TEX = {};
function makeTextures() {
  TEX.asphalt = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = '#47484b'; c.fillRect(0, 0, w, h); speckle(c, w, h, 40000, 0.06, 0.15);
    for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(0,0,0,${rnd(0.04, 0.12)})`; c.beginPath(); c.ellipse(rnd(0, w), rnd(0, h), rnd(20, 140), rnd(10, 60), rnd(0, 3), 0, 7); c.fill(); }
    c.strokeStyle = 'rgba(15,15,15,.35)'; c.lineWidth = 1.5;
    for (let i = 0; i < 16; i++) { c.beginPath(); let x = rnd(0, w), y = rnd(0, h); c.moveTo(x, y); for (let k = 0; k < 8; k++) { x += rnd(-30, 30); y += rnd(-30, 30); c.lineTo(x, y); } c.stroke(); }
  });
  TEX.concrete = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#9a9891'; c.fillRect(0, 0, w, h); speckle(c, w, h, 2500, 0.08, 0.1);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 0, w, 3); c.fillRect(0, 0, 3, h);
  });
  TEX.grass = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#4a7a36'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { c.fillStyle = `hsl(${rnd(80, 115)},${rnd(35, 55)}%,${rnd(20, 38)}%)`; c.fillRect(Math.random() * w, Math.random() * h, 1.5, rnd(2, 5)); }
  });
  TEX.fabric = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 2) { c.fillStyle = `rgba(0,0,0,${rnd(0.02, 0.06)})`; c.fillRect(0, y, w, 1); } speckle(c, w, h, 1500, 0, 0.1); });
  TEX.fabric.repeat.set(3, 3);
  TEX.glow = canvasTex(128, 128, (c, w, h) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,220,160,1)'); g.addColorStop(0.4, 'rgba(255,190,110,.35)'); g.addColorStop(1, 'rgba(255,170,90,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}

// ---------- Materials ----------
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts }));
  return matCache.get(key);
}
const paintCache = new Map();
function paint(color) {
  if (!paintCache.has(color)) paintCache.set(color, new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }));
  return paintCache.get(color);
}
const M = {};
function makeMaterials() {
  M.facades = {}; for (const id in FSTYLES) M.facades[id] = makeFacade(id);
  M.facade = M.facades.classic;
  M.facades.f3 = makeFrame3D(); M.facades.g3 = makeGlass3D(); // Rahmen/Glas der instanzierten 3D-Fenstermodule (erben Stencil-Portal und Umgebung)
  if (ASSETS.img.brick_diffuse && ASSETS.img.brick_bump) { M.facades.brick.bumpMap = photoTex('brick_bump', 1024 / (ASSETS.img.brick_diffuse.width * 0.42), false); M.facades.brick.bumpScale = 1.5; }
  M.palm = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  M.vcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  M.ivcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  for (const m of [...Object.values(M.facades), M.vcol]) Object.assign(m, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.KeepStencilOp });
  M.body = new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.fabric, roughness: 0.82 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x0b131d, metalness: 1, roughness: 0.06 });
  M.trim = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6, metalness: 0.2 });
  M.wheel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 });
  M.head = new THREE.MeshStandardMaterial({ color: 0xfff6dd, emissive: 0xfff2cc, emissiveIntensity: 0.3 });
  M.tail = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a10, emissiveIntensity: 0.4 });
  M.wreck = new THREE.MeshStandardMaterial({ color: 0x1a1918, roughness: 1 });
  M.lampHead = new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0xffd9a0, emissiveIntensity: 0 });
  M.white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  M.copRed = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0000, emissiveIntensity: 0 });
  M.copBlue = new THREE.MeshStandardMaterial({ color: 0x000040, emissive: 0x1144ff, emissiveIntensity: 0 });
}
function colorize(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}

// ---------- Collision (spatial hash of AABBs) ----------
const CELL = 24, solids = new Map();
const ckey = (cx, cz) => (cx + 1000) * 4096 + (cz + 1000);
function addSolid(minx, maxx, minz, maxz, h, y0 = -Infinity) {
  const s = { minx, maxx, minz, maxz, h, y0 };
  for (let cx = Math.floor(minx / CELL); cx <= Math.floor(maxx / CELL); cx++)
    for (let cz = Math.floor(minz / CELL); cz <= Math.floor(maxz / CELL); cz++) {
      const k = ckey(cx, cz); if (!solids.has(k)) solids.set(k, []); solids.get(k).push(s);
    }
  return s;
}
function removeSolid(s) {
  for (let cx = Math.floor(s.minx / CELL); cx <= Math.floor(s.maxx / CELL); cx++)
    for (let cz = Math.floor(s.minz / CELL); cz <= Math.floor(s.maxz / CELL); cz++) {
      const l = solids.get(ckey(cx, cz)); if (l) { const k = l.indexOf(s); if (k >= 0) l.splice(k, 1); }
    }
}
const _r = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
function resolveCircle(x, z, r, y) {
  _r.hit = false; let nx = 0, nz = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const list = solids.get(ckey(cx, cz)); if (!list) continue;
        for (const s of list) {
          if (y !== undefined && (y < s.y0 || y >= s.h)) continue;
          const px = clamp(x, s.minx, s.maxx), pz = clamp(z, s.minz, s.maxz);
          const dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          _r.hit = true;
          if (d2 > 1e-8) { const d = Math.sqrt(d2), p = r - d; x += dx / d * p; z += dz / d * p; nx += dx / d; nz += dz / d; }
          else {
            const o = [x - s.minx, s.maxx - x, z - s.minz, s.maxz - z], m = Math.min(...o);
            if (m === o[0]) { x = s.minx - r; nx -= 1; } else if (m === o[1]) { x = s.maxx + r; nx += 1; }
            else if (m === o[2]) { z = s.minz - r; nz -= 1; } else { z = s.maxz + r; nz += 1; }
          }
        }
      }
  }
  const l = Math.hypot(nx, nz) || 1;
  _r.x = x; _r.z = z; _r.nx = nx / l; _r.nz = nz / l; return _r;
}
function solidAt(x, y, z) {
  const list = solids.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL))); if (!list) return false;
  for (const s of list) if (x >= s.minx && x <= s.maxx && z >= s.minz && z <= s.maxz && y < s.h && y >= s.y0) return true;
  return false;
}
function lineOfSight(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 2);
  for (let i = 1; i < n; i++) { const t = i / n; if (solidAt(lerp(ax, bx, t), 1.2, lerp(az, bz, t))) return false; }
  return true;
}

// ---------- Sky ----------
const sky = {
  top: new THREE.Color(), hor: new THREE.Color(), sunDir: new THREE.Vector3(), sunCol: new THREE.Color(), night: 0,
};
const skyUniforms = { top: { value: sky.top }, hor: { value: sky.hor }, sunDir: { value: sky.sunDir }, sunCol: { value: sky.sunCol }, night: { value: 0 }, time: { value: 0 }, day: { value: 1 } };
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec3 top, hor, sunDir, sunCol; uniform float night, time, day; varying vec3 vDir;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main(){
      vec3 d = normalize(vDir); float y = d.y;
      vec3 col = mix(hor, top, pow(clamp(y,0.0,1.0), 0.5));
      if (y < 0.0) col = mix(hor, hor*0.6, clamp(-y*4.0,0.0,1.0));
      float s = max(dot(d, sunDir), 0.0);
      col += sunCol * (pow(s, 6.0)*0.25 + pow(s, 64.0)*0.5 + smoothstep(0.9993,0.9997,s)*12.0);
      float m = max(dot(d, -sunDir), 0.0);
      col += vec3(0.85,0.9,1.0) * smoothstep(0.9995,0.9998,m) * 2.5 * night;
      if (y > 0.0) {
        vec3 q = floor(d*220.0);
        float st = step(0.9965, fract(sin(dot(q, vec3(12.9898,78.233,37.719)))*43758.5453));
        col += vec3(st) * night * clamp(y*3.0,0.0,1.0) * 0.9;
      }
      if (y > 0.0) {
        vec2 uv = d.xz / (y + 0.12) * 1.2 + vec2(time * 0.006, time * 0.002);
        float cl = smoothstep(0.5, 0.82, fbm(uv)) * smoothstep(0.0, 0.18, y);
        vec3 lit = mix(vec3(0.92, 0.93, 0.95), vec3(1.0, 0.86, 0.7), clamp(1.0 - sunDir.y * 3.0, 0.0, 1.0));
        vec3 cc = mix(vec3(0.05, 0.06, 0.09), lit + sunCol * 0.15 * pow(s, 4.0), day);
        col = mix(col, cc, cl * 0.88);
      }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), skyMat);
skyDome.renderOrder = -1; skyDome.frustumCulled = false;
scene.add(skyDome);
const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(skyDome.geometry, skyMat));
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
let hdrEnvRT = null, skyDayF = 1, outEnvTex = null, roomEnvRT = null, lastHdrSel = null;
// Neutrale Rauminnen-Umgebung (grauer Raum mit Deckenleuchten) – verhindert, dass Innenräume das Außen-HDR spiegeln
function roomEnvTex() {
  if (!roomEnvRT) {
    const rs = new THREE.Scene(), face = (hex, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.BackSide });
    const room = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 12), [face(0x8e8d8a), face(0x8e8d8a), face(0xcfcfcc), face(0x5d5a56), face(0x8e8d8a), face(0x8e8d8a)]);
    rs.add(room);
    for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2e0).multiplyScalar(5) })); l.rotation.x = Math.PI / 2; l.position.set(x, 1.95, z); rs.add(l); }
    roomEnvRT = pmrem.fromScene(rs, 0.03);
  }
  return roomEnvRT.texture;
}
function applyEnv() {
  const t = (INT.inF ?? 0) > 0.5 ? roomEnvTex() : outEnvTex;
  if (!t || scene.environment === t) return;
  scene.environment = t;
  for (const id in M.facades) M.facades[id].envMap = t; // Fassaden-Reflexion getrennt regelbar (envMapIntensity wirkt nur bei eigener envMap)
}
function updateEnv() {
  if (ASSETS.hdr && !hdrEnvRT) hdrEnvRT = pmrem.fromEquirectangular(ASSETS.hdr);
  if (hdrEnvRT && skyDayF > 0.45) outEnvTex = hdrEnvRT.texture;
  else { const rt = pmrem.fromScene(envScene, 0, 0.1, 12000); outEnvTex = rt.texture; if (envRT) envRT.dispose(); envRT = rt; }
  applyEnv();
}

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 1, far: 500 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3a30, 0.6);
scene.add(hemi);

let gameMin = 16 * 60 + 40; // 16:40 Uhr – goldene Stunde
const C = {
  nTop: new THREE.Color('#0b1838'), nHor: new THREE.Color('#22345f'), nHemi: new THREE.Color('#7f9bd8'), nGnd: new THREE.Color('#2b3550'), dGnd: new THREE.Color('#3a3a30'), dTop: new THREE.Color('#3474c4'), dHor: new THREE.Color('#cfe0ea'),
  dusk: new THREE.Color('#ff8a4a'), sunD: new THREE.Color('#fff3e0'), sunE: new THREE.Color('#ffac66'), moon: new THREE.Color('#8ea6ff'),
};
let nightF = 0;
// Straßenlaternen: kleiner fester Pool echter Lichter, die zu den nächsten Laternen wandern (Anzahl bleibt konstant -> keine Shader-Neukompilierung)
const LAMP_POOL = [], _lampWhite = new THREE.Color(0xffffff);
let lampPoolT = 0, lampKnock = null;
function updateLampPool(night) {
  if (!LAMP_POOL.length) return;
  const now = performance.now();
  if (now - lampPoolT > 500) {
    lampPoolT = now;
    if (!lampKnock) { lampKnock = []; for (const k of KNOCK) if (k.kind === 'lamp' && k.glow !== undefined) lampKnock[k.glow] = k; }
    const cx = camera.position.x, cz = camera.position.z, best = [];
    if (night > 0.01) for (let i = 0; i < lamps.length; i++) {
      const L = lamps[i], d = (L[0] - cx) ** 2 + (L[1] - cz) ** 2; if (d > 60 * 60 || (lampKnock[i] && lampKnock[i].st !== 0)) continue;
      if (best.length < LAMP_POOL.length) { best.push([d, i]); best.sort((a, b) => a[0] - b[0]); } else if (d < best[best.length - 1][0]) { best[best.length - 1] = [d, i]; best.sort((a, b) => a[0] - b[0]); }
    }
    LAMP_POOL.forEach((l, k) => { const b = best[k]; l.userData.on = !!b; if (!b) return; const [x, z, side] = lamps[b[1]], f = DIRS[side]; l.position.set(x + f[0] * 1.3, 6.9, z + f[1] * 1.3); });
  }
  const want = night * (1 - INT.inF);
  for (const l of LAMP_POOL) l.intensity = lerp(l.intensity, l.userData.on ? 80 * want : 0, 0.15);
}
function updateSky() {
  const a = (gameMin / 60 - 6) / 24 * Math.PI * 2;
  sky.sunDir.set(Math.cos(a) * 0.85, Math.sin(a), 0.45).normalize();
  const e = sky.sunDir.y;
  const day = smooth(-0.08, 0.3, e), dusk = clamp(1 - Math.abs(e + 0.02) / 0.22, 0, 1); skyDayF = day;
  nightF = 1 - smooth(-0.06, 0.1, e);
  sky.top.copy(C.nTop).lerp(C.dTop, day);
  sky.hor.copy(C.nHor).lerp(C.dHor, day).lerp(C.dusk, dusk * 0.75);
  sky.sunCol.copy(C.sunE).lerp(C.sunD, smooth(0.05, 0.4, e)).multiplyScalar(smooth(-0.1, 0.02, e));
  skyUniforms.night.value = nightF; skyUniforms.day.value = day; skyUniforms.time.value = performance.now() / 1000;
  scene.fog.color.copy(sky.hor);
  const sunI = 3.2 * smooth(0.0, 0.18, e), moonI = 0.9 * smooth(0.0, 0.15, -e);
  sun.intensity = Math.max(sunI, moonI);
  sun.color.copy(sunI > moonI ? C.sunE.clone().lerp(C.sunD, smooth(0.05, 0.45, e)) : C.moon);
  hemi.intensity = lerp(0.35, 0.7, day);
  hemi.color.copy(sky.top).lerp(_lampWhite, 0.4).lerp(C.nHemi, 1 - day); hemi.groundColor.copy(C.nGnd).lerp(C.dGnd, day);
  scene.environmentIntensity = lerp(0.3, 0.9, day);
  const hdrSel = day > 0.45; if (hdrSel !== lastHdrSel) { lastHdrSel = hdrSel; updateEnv(); }
  for (const id in M.facades) M.facades[id].emissiveIntensity = nightF * 1.6;
  M.lampHead.emissiveIntensity = nightF * 4;
  for (const m of ADMATS) m.emissiveIntensity = 0.25 + nightF * 1.2;
  M.head.emissiveIntensity = 0.3 + nightF * 3;
  M.tail.emissiveIntensity = 0.4 + nightF * 1.5;
  if (lampGlow) lampGlow.material.opacity = nightF * 0.55;
  const inside = INT.inside;
  // Innen: Sonne/Himmel stark gedämpft (Decken werfen keine Schatten), Raumleuchten realistisch
  INT.inF = lerp(INT.inF ?? 0, inside ? 1 : 0, 0.12); const inF = INT.inF;
  sun.intensity *= lerp(1, 0.05, inF); hemi.intensity *= lerp(1, 0.1, inF); scene.environmentIntensity = lerp(scene.environmentIntensity, 0.4, inF);
  applyEnv(); for (const id in M.facades) M.facades[id].envMapIntensity = scene.environmentIntensity * 0.5;
  if (bloomPass) bloomPass.strength = lerp(0.32, 0.07, inF);
  if (INT.amb) { INT.amb.intensity = inside ? (INT.cab && !player.car && inCab() ? 0.55 : 0.25) : 0; for (const l of INT.lights) l.intensity = INT.active ? (inside ? 5 : 2) : 0; }
  updateLampPool(nightF);
  scene.fog.density = 0.00032;
  return e;
}

// ---------- City generation ----------
const palette = ['#d8d2c4', '#c9cdd3', '#b9a99a', '#a8b4c0', '#cdbba2', '#9aa5ad', '#e0d9c8', '#8d939a', '#b8705e', '#7b8794', '#c7b48a', '#d9c2b0'];
const parks = new Set();
const HOME_BLOCKS = ['7,7', '3,3', '11,10'], HOSPITAL_BLOCK = '5,8';
const INMATE_LOOK = () => ({ gender: 'm', skin: pick(SKIN_T), shirt: '#e8752a', pants: '#e8752a', shoes: '#eeeeee', hair: pick(HAIR), beard: Math.random(), hairStyle: pick(['buzz', 'bald', 'buzz']), hat: null });
const SPECIAL = { '9,6': 'police', '4,4': 'market', '10,8': 'market', '2,11': 'market', '12,3': 'market', '6,11': 'gas', '11,5': 'gas', '2,7': 'gas', '8,1': 'gas', '12,12': 'gas', '13,9': 'prison' };
const POLICE_HQ = { x: 0, z: 0, exit: null };
let PRISON = null;
const SIG = { spots: [], t: 0, acc: 0, CYC: 16 };
// Ampelphase je Kreuzung: Achse z / x abwechselnd grün, 3 s gelb, 1 s alles rot
function sigState(kx, kz, axis) {
  const t = (SIG.t + ((kx * 5 + kz * 3) % 4) * 4) % (SIG.CYC * 2), zg = t < SIG.CYC, ph = t % SIG.CYC;
  if ((axis === 'z') !== zg) return 'red';
  return ph < 1 ? 'red' : ph > SIG.CYC - 3 ? 'yellow' : 'green';
}
function updateSignals(dt) {
  SIG.t += dt; SIG.acc -= dt; if (SIG.acc > 0 || !SIG.lamp) return; SIG.acc = 0.25;
  for (const sp of SIG.spots) { const st = sigState(sp.kx, sp.kz, sp.axis); SIG.lamp.setColorAt(sp.i * 2, st === 'red' ? SIG.red : SIG.dark); SIG.lamp.setColorAt(sp.i * 2 + 1, st === 'green' ? SIG.green : st === 'yellow' ? SIG.yellow : SIG.dark); }
  SIG.lamp.instanceColor.needsUpdate = true;
}
function checkRedLight(c) {
  const kx = clamp(Math.round(c.x / P + N / 2), 0, N), kz = clamp(Math.round(c.z / P + N / 2), 0, N);
  const inBox = Math.abs(c.x - roadPos(kx)) < R / 2 - 1 && Math.abs(c.z - roadPos(kz)) < R / 2 - 1, key = kx * 100 + kz;
  if (!inBox) { player.rlKey = -1; return; }
  if (player.rlKey === key) return; player.rlKey = key;
  if (Math.hypot(c.vx, c.vz) < 4 || sigState(kx, kz, Math.abs(c.vx) > Math.abs(c.vz) ? 'x' : 'z') !== 'red') return;
  const cop = cars.some(o => o.cop && o !== c && o.mode !== 'wreck' && Math.hypot(o.x - c.x, o.z - c.z) < 70 && lineOfSight(o.x, o.z, c.x, c.z)) || officers.some(o => o.state !== 'dead' && Math.hypot(o.x - c.x, o.z - c.z) < 40 && lineOfSight(o.x, o.z, c.x, c.z));
  if (cop && wanted === 0) { addWanted(1); notice('ÜBER ROT GEFAHREN – DIE POLIZEI HAT ES GESEHEN', 2600); setTimeout(() => say(pick(LINES.redlight), { who: 'Polizeifunk', radio: true, color: '#6fa8ff', prio: true }), 900); }
  else if (!cop) notice('Über Rot gefahren', 1200);
}
const COP_LOOK = { gender: 'm', skin: '#e0bc9c', shirt: '#1f2c44', pants: '#1a2233', shoes: '#111111', hair: '#222222', beard: 0.2, hairStyle: 'buzz', hat: '#141c2c' };
function signTex(text, bg, fg, w = 1024, h = 200, font = 'bold 120px Arial Black, Impact, sans-serif') {
  return canvasTex(w, h, c => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2 + 6); });
}
function signMesh(text, bg, fg, wdt, hgt, x, y, z, rotY) {
  const t = signTex(text, bg, fg); const m = new THREE.Mesh(new THREE.PlaneGeometry(wdt, hgt), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.5 }));
  m.position.set(x, y, z); m.rotation.y = rotY; scene.add(m); ADMATS.push(m.material); return m;
}
// Sonderblöcke: Polizeiwache, Supermärkte, Tankstellen (begehbar)
function genSpecial(i, j, chunk, kind) {
  const cx = blockCenter(i), cz = blockCenter(j), y0 = 0.2;
  const reg = (bx, bz, w, d, h, floors, type, sid, col) => {
    const st = FSTYLES[sid];
    (chunk.walls[sid] ||= []).push(wallBox(w, h, d, bx, y0 + h / 2, bz, col, st));
    chunk.roofs.push(box(w + 0.4, 0.5, d + 0.4, bx, y0 + h + 0.25, bz, '#5b5f63'));
    const solid = addSolid(bx - w / 2, bx + w / 2, bz - d / 2, bz + d / 2, h + 0.7);
    mapBuildings.push([bx - w / 2, bz - d / 2, w, d]);
    const fz = bz - d / 2, b = { x: bx, z: bz, w, d, floors, seed: Math.floor(Math.random() * 1e9), type, solid, door: { x: bx, z: fz - 1.1, nx: 0, nz: -1, tx: 1, tz: 0 } };
    chunk.roofs.push(box(2.8, 3.1, 0.3, bx, y0 + 1.55, fz - 0.1, '#2a2c30'), box(2.0, 2.6, 0.12, bx, y0 + 1.3, fz - 0.22, '#3a5068'));
    BUILDINGS.push(b); return b;
  };
  const lot = (x0, x1, z0, z1) => { const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, y0 + 0.012, (z0 + z1) / 2); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: TEX.asphalt, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1 })); m.receiveShadow = true; scene.add(m);
    for (let x = x0 + 2; x < x1 - 1; x += 2.8) chunk.roofs.push(box(0.12, 0.02, 4.5, x, y0 + 0.02, z0 + 2.6, '#e8e8e8')); };
  if (kind === 'market') {
    const b = reg(cx, cz + 7, 42, 26, 7.2, 1, 'market', pick(['concrete', 'stucco']), '#e8e4dc');
    signMesh(['GUT & GÜNSTIG', 'LS FRISCHEMARKT', 'MEGAMART'][b.seed % 3], '#c4161c', '#ffffff', 16, 2.4, cx, y0 + 5.6, cz + 7 - 13 - 0.08, Math.PI);
    lot(cx - 26, cx + 26, cz - 26, cz - 6.5);
    POIS.push({ x: cx, z: cz - 6, col: '#ff6a3a', sym: 'S' });
  } else if (kind === 'gas') {
    reg(cx + 12, cz + 13, 16, 11, 4.2, 1, 'gas', 'stucco', '#f2f0ea');
    signMesh('GLOBE OIL · 24/7', '#0b4f9c', '#ffd23a', 10, 1.4, cx + 12, y0 + 3.4, cz + 13 - 5.5 - 0.08, Math.PI);
    lot(cx - 26, cx + 26, cz - 26, cz + 7);
    const canopyY = y0 + 5.2;
    chunk.roofs.push(box(18, 0.6, 11, cx - 5, canopyY, cz - 10, '#f2f2f2'), box(18.2, 0.25, 11.2, cx - 5, canopyY + 0.4, cz - 10, '#0b4f9c'));
    for (const [px, pz] of [[-12, -14.5], [2, -14.5], [-12, -5.5], [2, -5.5]]) { chunk.roofs.push(box(0.4, 5, 0.4, cx + px, y0 + 2.5, cz + pz, '#d8d8d8')); addSolid(cx + px - 0.2, cx + px + 0.2, cz + pz - 0.2, cz + pz + 0.2, 5); }
    const under = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 1.2 })); under.rotation.x = Math.PI / 2; under.position.set(cx - 5, canopyY - 0.31, cz - 10); scene.add(under);
    for (const px of [-9, -1]) { chunk.roofs.push(box(1.2, 0.25, 6, cx + px, y0 + 0.12, cz - 10, '#aaaaaa')); for (const pz of [-12, -8]) { chunk.roofs.push(box(0.7, 1.7, 0.5, cx + px, y0 + 1.1, cz + pz, '#c4161c'), box(0.5, 0.35, 0.05, cx + px, y0 + 1.5, cz + pz - 0.27, '#222')); addSolid(cx + px - 0.6, cx + px + 0.6, cz - 13, cz - 7, 2); } }
    chunk.roofs.push(box(0.35, 8, 0.35, cx - 24, y0 + 4, cz - 24, '#888'));
    signMesh('1,89 $', '#111', '#ffd23a', 3.2, 1.4, cx - 24, y0 + 7.3, cz - 24.2, Math.PI);
    POIS.push({ x: cx - 5, z: cz - 10, col: '#3aa0ff', sym: 'G' });
  } else if (kind === 'police') {
    const b = reg(cx, cz + 6, 34, 24, 3 * 3.6, 3, 'police', 'concrete', '#dfe3e8');
    chunk.roofs.push(box(34.2, 0.8, 24.2, cx, y0 + 3.4, cz + 6, '#1f3a6e'));
    signMesh('LOS SANTOS POLICE DEPARTMENT', '#0d1b33', '#e8d9b0', 18, 1.6, cx, y0 + 5.1, cz + 6 - 12 - 0.08, Math.PI);
    lot(cx - 26, cx + 26, cz - 26, cz - 6);
    POLICE_HQ.x = cx; POLICE_HQ.z = cz - 17; POLICE_HQ.exit = { x: cx, z: roadPos(j) + LANE };
    POIS.push({ x: cx, z: cz - 6, col: '#4a7dff', sym: 'P' });
  } else if (kind === 'prison') {
    const h = 4.4, x0 = cx - B / 2 + 1.5, x1 = cx + B / 2 - 1.5, z0 = cz - B / 2 + 1.5, z1 = cz + B / 2 - 1.5, gw = 8, L = x1 - x0, sw = (L - gw) / 2;
    const wall = (w, d, x, z) => { chunk.roofs.push(box(w, h, d, x, y0 + h / 2, z, '#bfb8aa')); addSolid(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h + 1); for (const o of [0.3, 0.75]) chunk.roofs.push(box(Math.max(w, 0.06), 0.05, Math.max(d, 0.06), x, y0 + h + o, z, '#9a9a9a')); for (let q = 0; q < Math.max(w, d); q += 3) chunk.roofs.push(box(0.06, 0.9, 0.06, w > d ? x - w / 2 + q : x, y0 + h + 0.45, w > d ? z : z - d / 2 + q, '#666')); };
    const gx = cx - 12.5; wall(gx - 0.45 - x0, 0.6, (x0 + gx - 0.45) / 2, z1); wall(x1 - gx - 0.45, 0.6, (x1 + gx + 0.45) / 2, z1);
    chunk.roofs.push(box(0.9, h - 1.25, 0.6, gx, y0 + 1.25 + (h - 1.25) / 2, z1, '#bfb8aa')); addSolid(gx - 0.45, gx + 0.45, z1 - 0.3, z1 + 0.3, h + 1, 1.2);
    wall(0.6, z1 - z0, x0, cz); wall(0.6, z1 - z0, x1, cz); wall(sw, 0.6, x0 + sw / 2, z0); wall(sw, 0.6, x1 - sw / 2, z0);
    for (const [tx, tz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) { chunk.roofs.push(box(1.3, 8.6, 1.3, tx, y0 + 4.3, tz, '#8a8478'), box(3.6, 2.4, 3.6, tx, y0 + 9.8, tz, '#d8d2c4'), box(3.2, 1.0, 3.7, tx, y0 + 10.0, tz, '#2a3440'), box(4.0, 0.3, 4.0, tx, y0 + 11.15, tz, '#5b5f63')); addSolid(tx - 0.7, tx + 0.7, tz - 0.7, tz + 0.7, 9); }
    for (const px of [-gw / 2 - 0.5, gw / 2 + 0.5]) { chunk.roofs.push(box(1.0, h + 2.6, 1.0, cx + px, y0 + (h + 2.6) / 2, z0, '#8a8478')); addSolid(cx + px - 0.5, cx + px + 0.5, z0 - 0.5, z0 + 0.5, h + 3); }
    reg(cx, cz + 11, 38, 18, 3 * 3.6, 3, 'prison', 'concrete', '#cfc8b8');
    const yard = new THREE.PlaneGeometry(L - 1, 20); yard.rotateX(-Math.PI / 2); yard.translate(cx, y0 + 0.015, z0 + 11); const ym = new THREE.Mesh(yard, new THREE.MeshStandardMaterial({ map: TEX.asphalt, color: 0xb8b0a0, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 })); ym.receiveShadow = true; scene.add(ym);
    for (const bx of [cx - 14, cx + 14]) chunk.roofs.push(box(0.15, 3.05, 0.15, bx, y0 + 1.5, z0 + 12, '#777'), box(1.8, 1.05, 0.08, bx, y0 + 3.0, z0 + 12, '#eee'));
    const gate = new THREE.Mesh(new THREE.BoxGeometry(gw, h - 0.3, 0.2), mat('#3c4248', { metalness: 0.8, roughness: 0.35 })); gate.position.set(cx, y0 + (h - 0.3) / 2, z0); gate.castShadow = true; scene.add(gate);
    signMesh('BOLINGBROKE STRAFVOLLZUG', '#2a2a2a', '#e8e0c8', 9, 1.2, cx, y0 + h + 1.6, z0 - 0.55, Math.PI);
    // Zellentrakt an der Nordmauer: 6 Zellen mit Gittern, Pritschen, Toiletten
    const cz0 = z1 - 3.4, cells = [];
    for (let k = 0; k <= 6; k++) { const xb = cx - 15 + k * 5; chunk.roofs.push(box(0.25, 3.0, 3.4, xb, y0 + 1.5, cz0 + 1.7, '#a8a196')); addSolid(xb - 0.13, xb + 0.13, cz0, z1, 3); }
    chunk.roofs.push(box(30.3, 0.25, 3.6, cx, y0 + 3.1, cz0 + 1.7, '#8a8478'));
    for (let k = 0; k < 6; k++) {
      const xc = cx - 12.5 + k * 5; cells.push(xc);
      for (let q = -2.35; q <= 2.36; q += 0.2) if (Math.abs(q) > 0.7 || k > 0) chunk.roofs.push(box(0.045, 2.9, 0.045, xc + q, y0 + 1.45, cz0, '#5a5f66'));
      chunk.roofs.push(box(4.8, 0.08, 0.08, xc, y0 + 2.9, cz0, '#5a5f66'), box(4.8, 0.08, 0.08, xc, y0 + 0.08, cz0, '#5a5f66'));
      if (k > 0) addSolid(xc - 2.4, xc + 2.4, cz0 - 0.1, cz0 + 0.1, 3); else { addSolid(xc - 2.4, xc - 0.7, cz0 - 0.1, cz0 + 0.1, 3); addSolid(xc + 0.7, xc + 2.4, cz0 - 0.1, cz0 + 0.1, 3); }
      chunk.roofs.push(box(0.9, 0.45, 2.0, xc + 1.6, y0 + 0.3, cz0 + 2.1, '#6a6a6a'), box(0.85, 0.12, 1.9, xc + 1.6, y0 + 0.58, cz0 + 2.1, '#d8d4c8'), box(0.45, 0.45, 0.5, xc - 1.9, y0 + 0.23, cz0 + 2.9, '#e8e8e8'));
    }
    // Zellentür (Spielerzelle) zum Aufschieben und das lockere Lüftungsgitter in der Rückwand
    const dg = []; for (let q = -0.6; q <= 0.61; q += 0.2) { const bg = new THREE.BoxGeometry(0.045, 2.9, 0.045); bg.translate(q, 1.45, 0); dg.push(bg); }
    const bg2 = new THREE.BoxGeometry(1.4, 0.08, 0.08); bg2.translate(0, 1.4, 0); dg.push(bg2);
    const cellDoor = new THREE.Mesh(mergeGeometries(dg), mat('#4a4f56', { metalness: 0.8, roughness: 0.4 })); cellDoor.position.set(cells[0], y0, cz0 - 0.06); scene.add(cellDoor);
    const vg = []; for (let q = -0.38; q <= 0.39; q += 0.095) { const b3 = new THREE.BoxGeometry(0.03, 1.0, 0.03); b3.translate(q, 0, 0); vg.push(b3); } for (const yy of [-0.48, 0.48]) { const b4 = new THREE.BoxGeometry(0.9, 0.05, 0.05); b4.translate(0, yy, 0); vg.push(b4); }
    const vent = new THREE.Mesh(mergeGeometries(vg), mat('#6a6e72', { metalness: 0.7, roughness: 0.5 })); vent.position.set(gx, y0 + 0.62, z1 - 0.32); scene.add(vent);
    PRISON = { x: cx, z: cz, x0, x1, z0, z1, gate, gw, open: 0, target: 0, solid: addSolid(cx - gw / 2, cx + gw / 2, z0 - 0.3, z0 + 0.3, h), inside: { x: cx, z: z0 + 3 }, people: [],
      cell: { x: cells[0], z: cz0 + 1.6, front: cz0, door: cellDoor, doorSolid: addSolid(cells[0] - 0.7, cells[0] + 0.7, cz0 - 0.1, cz0 + 0.1, 3), open: 0, vent, ventSolid: addSolid(gx - 0.45, gx + 0.45, z1 - 0.35, z1 + 0.35, 1.2), gx }, cells, corridorZ: cz0 - 2.6 };
    POIS.push({ x: cx, z: z0 - 3, col: '#d8a860', sym: '⛓' });
  }
}
// Gefängnis: Zelle, Kaution, Wärter, Ausbruch
function jailReset() {
  const C0 = PRISON.cell; C0.open = 0; C0.door.position.x = C0.x; if (!C0.doorSolid) C0.doorSolid = addSolid(C0.x - 0.7, C0.x + 0.7, C0.front - 0.1, C0.front + 0.1, 3);
  C0.vent.rotation.set(0, 0, 0); C0.vent.position.set(C0.gx, 0.2 + 0.62, PRISON.z1 - 0.32); if (!C0.ventSolid) C0.ventSolid = addSolid(C0.gx - 0.45, C0.gx + 0.45, PRISON.z1 - 0.35, PRISON.z1 + 0.35, 1.2);
  player.jail = { state: 'cell', vent: 0, warn: 0, k: 0 };
  PRISON.alarm = 0; PRISON.target = 0; pendingCall = null;
}
function jailUse() {
  const J = player.jail, C0 = PRISON.cell; if (!J) return false;
  if (J.state === 'cell' && Math.abs(player.x - C0.x) < 1.2 && Math.abs(player.z - (C0.front + 0.5)) < 0.9) {
    if (player.money < 200 && (player.bank || 0) < 200) { notice('Kaution: 200 $ – du hast nicht genug Geld. Versuch auszubrechen (Lüftungsgitter hinten)!', 3200); return true; }
    if (!pay(200, player.money >= 200 ? 'cash' : 'card')) return true;
    J.state = 'bail'; notice('Kaution bezahlt (200 $) – ein Wärter kommt und schließt auf', 2600);
    say(pick(LINES.bail), { who: 'Wärter', voice: 'pavoque', color: '#d8a860', prio: true }); return true;
  }
  return false;
}
function updateJail(dt) {
  const J = player.jail, P0 = PRISON, C0 = P0.cell; if (!J) return;
  wanted = 0; wantedCool = 0;
  // Zellentür gleitet auf
  const tgtOpen = J.state === 'free' ? 1 : 0;
  if (C0.open !== tgtOpen) { C0.open = clamp(C0.open + Math.sign(tgtOpen - C0.open) * dt * 0.8, 0, 1); C0.door.position.x = C0.x + C0.open * 1.4; if (C0.open > 0.7 && C0.doorSolid) { removeSolid(C0.doorSolid); C0.doorSolid = null; } }
  // Lüftungsgitter lösen (E gedrückt halten), Wärter darf es nicht sehen
  const atVent = J.state === 'cell' && Math.abs(player.x - C0.gx) < 0.9 && player.z > P0.z1 - 1.6;
  const g = P0.guard, guardSees = g && Math.abs(g.x - C0.x) < 6 && Math.abs(g.z - C0.front) < 4;
  if (atVent && keys.KeyE && !uiMenu) {
    if (guardSees) { if ((J.warn -= dt) <= 0) { J.warn = 4; J.vent = Math.max(0, J.vent - 0.35); say(pick(LINES.guardWarn), { who: 'Wärter', voice: 'pavoque', color: '#d8a860', prio: true, h: g.h }); } }
    else { J.vent += dt / 14; player.act = { pose: 'pickup', t: 0.2 }; if (Math.random() < dt * 3) sfx.click(); }
    if (J.vent >= 1 && C0.ventSolid) { removeSolid(C0.ventSolid); C0.ventSolid = null; J.state = 'escaping'; C0.vent.rotation.x = -Math.PI / 2; C0.vent.position.set(C0.gx, 0.24, P0.z1 - 0.9); sfx.hit(); notice('Das Gitter ist ab! Kriech durch die Öffnung nach draußen!', 2600); }
  }
  // draußen?
  if (J.state === 'escaping' && player.z > P0.z1 + 0.6) {
    player.jail = null; addWanted(0, 2); notice('AUSGEBROCHEN!', 2000); P0.alarm = 25;
    setTimeout(() => say(pick(LINES.breakout), { who: 'Polizeifunk', radio: true, color: '#6fa8ff', prio: true }), 800);
  }
  if (J.state === 'free' && Math.hypot(player.x - P0.x, player.z - (P0.z0 + 4)) < 9) P0.target = 1;
  if (J.state === 'free' && player.z < P0.z0 - 3) { player.jail = null; notice('Du bist frei', 1600); }
  // Aufgeben (K halten)
  if (keys.KeyK && J.state === 'cell') { J.k += dt; if (J.k > 2) { player.jail = null; notice('Du hast aufgegeben', 1500); die(); } } else J.k = 0;
}
function jailHint() {
  const J = player.jail, C0 = PRISON?.cell; if (!J || !C0) return '';
  if (J.state === 'cell' && Math.abs(player.x - C0.gx) < 0.9 && player.z > PRISON.z1 - 1.6) return `<b>E</b> gedrückt halten: Lüftungsgitter lösen (${Math.round(J.vent * 100)} %) – nicht erwischen lassen!`;
  if (J.state === 'cell' && Math.abs(player.x - C0.x) < 1.2 && Math.abs(player.z - (C0.front + 0.5)) < 0.9) return player.money + (player.bank || 0) >= 200 ? 'Drücke <b>E</b>: Kaution 200 $ zahlen' : 'Kaution 200 $ – zu wenig Geld. Ausbrechen oder <b>K</b> halten zum Aufgeben';
  if (J.state === 'cell') return 'Du sitzt in der Zelle · Kaution an der Gittertür (E) · Lüftungsgitter hinten (E halten) · <b>K</b> halten: aufgeben';
  if (J.state === 'bail') return 'Warte, bis der Wärter aufschließt';
  if (J.state === 'free') return 'Die Zelle ist offen – geh zum Tor';
  if (J.state === 'escaping') return 'Kriech durch die Öffnung in der Mauer!';
  return '';
}
// Gefängnis: Tor, Häftlinge im Hof, Wachen auf den Türmen
function updatePrison(dt) {
  const P0 = PRISON; if (!P0) return;
  updateJail(dt);
  // Wärter im Zellengang: patrouilliert, schließt nach Kaution auf
  const nearP = Math.hypot(P0.x - player.x, P0.z - player.z) < 140;
  if (nearP && !P0.guard) { const h = makeHuman(COP_LOOK); scene.add(h.group); P0.guard = { h, x: P0.x + 10, z: P0.corridorZ, tx: P0.x - 14, mode: 'patrol', t: 0 }; }
  else if (!nearP && P0.guard && Math.hypot(P0.x - player.x, P0.z - player.z) > 180) { scene.remove(P0.guard.h.group); disposeHuman(P0.guard.h); P0.guard = null; }
  const G = P0.guard;
  if (G) {
    const J = player.jail, C0 = P0.cell; let tx = G.tx, tz = P0.corridorZ, sp = 1.3, pose = null;
    if (J && J.state === 'bail') { tx = C0.x + 0.9; tz = C0.front - 0.7; sp = 1.8; if (Math.hypot(tx - G.x, tz - G.z) < 0.2) { G.t += dt; sp = 0; pose = 'cook'; if (G.t > 1.6) { J.state = 'free'; G.t = 0; sfx.door(); say(pick(LINES.prison), { who: 'Wärter', voice: 'pavoque', color: '#d8a860', prio: true, h: G.h }); } } }
    else if (Math.abs(G.x - G.tx) < 0.3) G.tx = G.tx < P0.x ? P0.x + 14 : P0.x - 14;
    const dx = tx - G.x, dz = tz - G.z, d = Math.hypot(dx, dz);
    if (d > 0.05 && sp) { const st = Math.min(d, sp * dt); G.x += dx / d * st; G.z += dz / d * st; G.h.group.rotation.y += angDiff(G.h.group.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 6); }
    else G.h.group.rotation.y += angDiff(G.h.group.rotation.y, Math.atan2(C0.x - G.x, C0.front - G.z)) * Math.min(1, dt * 6);
    G.h.group.position.set(G.x, 0.2, G.z); animHuman(G.h, sp && d > 0.05 ? sp : 0, dt, false, pose);
  }
  // Alarm nach Ausbruch: Turmwachen schießen
  if (P0.alarm > 0) { P0.alarm -= dt; if (!player.dead && !player.car && Math.hypot(player.x - P0.x, player.z - P0.z) < 60 && Math.random() < dt * 1.5) { sfx.shot(P0.x1, P0.z1, 0.8); if (Math.random() < 0.4) hurtPlayer(8); } }
  const near = Math.hypot(P0.x - player.x, P0.z - player.z) < 140;
  if (near && !P0.people.length) {
    for (let k = 0; k < 7; k++) { const h = makeHuman(INMATE_LOOK()); scene.add(h.group); P0.people.push({ h, x: rnd(P0.x0 + 4, P0.x1 - 4), z: rnd(P0.z0 + 5, P0.z0 + 19), tx: 0, tz: 0, w: rnd(0, 6), guard: false }); }
    for (const [tx, tz] of [[P0.x0, P0.z0], [P0.x1, P0.z1]]) { const h = makeHuman(COP_LOOK); scene.add(h.group); h.group.position.set(tx, 0.2 + 11.3, tz); P0.people.push({ h, x: tx, z: tz, guard: true }); }
  } else if (!near && P0.people.length && Math.hypot(P0.x - player.x, P0.z - player.z) > 180) { for (const q of P0.people) { scene.remove(q.h.group); disposeHuman(q.h); } P0.people = []; }
  for (const q of P0.people) {
    if (q.guard) { q.h.group.rotation.y = Math.atan2(player.x - q.x, player.z - q.z); animHuman(q.h, 0, dt, false, 'stand'); continue; }
    if ((q.w -= dt) <= 0) { q.tx = rnd(P0.x0 + 4, P0.x1 - 4); q.tz = rnd(P0.z0 + 5, P0.z0 + 19); q.w = rnd(6, 16); }
    const dx = q.tx - q.x, dz = q.tz - q.z, d = Math.hypot(dx, dz), sp = d > 0.3 && q.tx ? 1.1 : 0;
    if (sp) { q.x += dx / d * sp * dt; q.z += dz / d * sp * dt; q.h.group.rotation.y += angDiff(q.h.group.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 6); }
    q.h.group.position.set(q.x, 0.2, q.z); animHuman(q.h, sp, dt, false, sp ? null : 'talk');
  }
  // Tor öffnen/schließen
  if (P0.target && player.z < P0.z0 - 4 && Math.hypot(player.x - P0.x, player.z - P0.z0) > 7) P0.target = 0;
  if (P0.open !== P0.target) {
    P0.open = clamp(P0.open + Math.sign(P0.target - P0.open) * dt * 0.35, 0, 1); P0.gate.position.x = P0.x + P0.open * (P0.gw + 0.4);
    if (P0.open > 0.6 && P0.solid) { removeSolid(P0.solid); P0.solid = null; }
    if (P0.open < 0.4 && !P0.solid) P0.solid = addSolid(P0.x - P0.gw / 2, P0.x + P0.gw / 2, P0.z0 - 0.3, P0.z0 + 0.3, 4.4);
  }
}
let lampGlow = null;
// Innenraum-Stile: jedes Gebäude bekommt eine eigene Einrichtungslinie
const THEMES = [
  { id: 'modern', walls: ['#eef0f2', '#e4e7ea', '#f4f4f2'], accent: ['#2f6fdb', '#1f9d8a'], floor: ['wood2', 'tile'], lobby: ['tile', 'tile2'], desk: ['#f2f2f2', '#e6e6e6'], glass: true },
  { id: 'classic', walls: ['#d9c7a7', '#e2d4b8', '#cdbb98'], accent: ['#5a2a2a'], floor: ['carpet', 'carpet2'], lobby: ['wood', 'wood2'], desk: ['#5a3a24', '#6b4a32'], wains: '#5a3a24' },
  { id: 'startup', walls: ['#f4f1ea', '#ebe8e0'], accent: ['#ff6b5b', '#2ec4b6', '#ffd166', '#8e7dff'], floor: ['tile2', 'wood'], lobby: ['tile2'], desk: ['#d8c4a0', '#f2f2f2'], accentWalls: true },
  { id: 'loft', walls: ['#a85f48', '#9a5644', '#b46a50'], accent: ['#2a2c30'], floor: ['tile2', 'wood2'], lobby: ['tile2', 'wood2'], desk: ['#2a2c30', '#3a3d42'] },
  { id: 'corporate', walls: ['#dfe4e8', '#d6dce2'], accent: ['#0d2b52', '#3a4a5c'], floor: ['carpet2', 'carpet'], lobby: ['tile', 'tile2'], desk: ['#9aa0a6', '#c8ccd0'], glass: true, accentWalls: true },
];
// ---------- Umfahrbare Straßenmöbel (Laternen, Ampeln, Hydranten) ----------
const KNOCK = [], KGRID = new Map(), KFALL = [], VENDS = [];
const kkey = (x, z) => Math.floor(x / 16) + ',' + Math.floor(z / 16);
function addKnock(p) { p.st = 0; KNOCK.push(p); const k = kkey(p.x, p.z); if (!KGRID.has(k)) KGRID.set(k, []); KGRID.get(k).push(p); }
const _km = new THREE.Matrix4(), _kr = new THREE.Matrix4(), _kt = new THREE.Matrix4(), _kax = new THREE.Vector3();
function knockMatrix(p, off) {
  _km.makeRotationY(p.rot); _kt.makeTranslation(0, off, 0); _km.premultiply(_kt);
  if (p.ang) { _kax.set(p.dz, 0, -p.dx).normalize(); _kr.makeRotationAxis(_kax, p.ang); _km.premultiply(_kr); }
  _kt.makeTranslation(p.x + (p.sx || 0), 0.2, p.z + (p.sz || 0)); _km.premultiply(_kt); return _km;
}
function syncKnock(p) { if (p.obj) { p.obj.matrix.copy(knockMatrix(p, 0)).multiply(_kt.makeScale(p.obj.userData.scale, p.obj.userData.scale, p.obj.userData.scale)); return; } for (const [m, i, off] of p.inst) { m.setMatrixAt(i, knockMatrix(p, off)); m.instanceMatrix.needsUpdate = true; } }
function knockProp(p, c, sp) {
  if (p.so) removeSolid(p.so); p.st = 1; p.ang = 0.02; const l = Math.hypot(c.vx, c.vz) || 1;
  p.dx = c.vx / l; p.dz = c.vz / l; p.w = (p.kind === 'hyd' ? 2.5 : 0.6) + sp * 0.08; p.vx = c.vx * 0.35; p.vz = c.vz * 0.35; p.sx = p.sz = 0; p.t = 0;
  const loss = { lamp: 0.8, tl: 0.83, hyd: 0.92, cone: 0.99 }[p.kind]; c.vx *= loss; c.vz *= loss;
  sfx.crash(Math.min(0.7, sp / 35), c); damageCar(c, p.kind === 'hyd' ? 1 : 3);
  const [lx, lz] = toCarLocal(c, p.x, p.z); deformLocal(c, lx, lz, Math.min(0.22, sp * 0.012));
  for (let k = 0; k < 10; k++) emit(fire, p.x, 0.6, p.z, rnd(-3, 3), rnd(1, 4), rnd(-3, 3), rnd(0.15, 0.35), 0.15, 0, 1, 0.8, 0.4);
  if (c === player.car) shake = Math.max(shake, Math.min(0.5, sp / 40));
  if (p.glow !== undefined && lampGlow) { _km.makeScale(0, 0, 0); lampGlow.setMatrixAt(p.glow, _km); lampGlow.instanceMatrix.needsUpdate = true; }
  if (p.kind === 'hyd') p.spray = 25;
  KFALL.push(p);
}
// Vor der Bewegung prüfen: schnelle Autos reißen Masten um statt abzuprallen
function knockCheck(c, dt) {
  const sp = Math.hypot(c.vx, c.vz); if (sp < 3.5) return;
  const ox = c.vx * dt * 1.5, oz = c.vz * dt * 1.5, gx = Math.floor(c.x / 16), gz = Math.floor(c.z / 16);
  for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) {
    const l = KGRID.get(i + ',' + j); if (!l) continue;
    for (const p of l) { if (p.st) continue; for (const [cx, cz] of carCircles(c)) if (Math.hypot(cx + ox - p.x, cz + oz - p.z) < 1.2) { knockProp(p, c, sp); break; } }
  }
}
function updateKnock(dt) {
  for (let k = KFALL.length - 1; k >= 0; k--) {
    const p = KFALL[k]; p.t += dt;
    if (p.st === 1) {
      p.w += 1.5 * 9.8 / p.h * Math.sin(Math.max(p.ang, 0.05)) * dt; p.ang += p.w * dt;
      const lim = Math.PI / 2 - (p.kind === 'hyd' ? 0.0 : 0.04);
      if (p.ang >= lim) { p.ang = lim; if (p.w > 0.8) { p.w = -p.w * 0.28; if (p.kind !== 'hyd') sfx.hit(); } else { p.w = 0; p.st = 2; } }
    }
    p.sx += p.vx * dt; p.sz += p.vz * dt; const f = Math.exp(-2.5 * dt); p.vx *= f; p.vz *= f;
    syncKnock(p);
    if (p.spray > 0) { p.spray -= dt; if (Math.hypot(p.x - player.x, p.z - player.z) < 120) for (let n = 0; n < 4; n++) emit(smoke, p.x, 0.5, p.z, rnd(-0.7, 0.7), rnd(8, 11), rnd(-0.7, 0.7), rnd(0.9, 1.4), 0.3, 0.9, 0.78, 0.88, 1.0); }
    // nach einiger Zeit außer Sicht wieder aufstellen
    if (p.st === 2 && !(p.spray > 0) && p.t > 60 && Math.hypot(p.x - player.x, p.z - player.z) > 220) {
      p.st = 0; p.ang = 0; p.sx = p.sz = 0; syncKnock(p); if (p.so) p.so = addSolid(p.so.minx, p.so.maxx, p.so.minz, p.so.maxz, p.so.h);
      if (p.glow !== undefined && lampGlow) { const f2 = DIRS[[Math.PI, Math.PI / 2, 0, -Math.PI / 2].findIndex(v => Math.abs(v - p.rot) < 0.01)] || [0, 0]; _km.makeTranslation(p.x + f2[0] * 2.2, 0.06, p.z + f2[1] * 2.2); lampGlow.setMatrixAt(p.glow, _km); lampGlow.instanceMatrix.needsUpdate = true; }
      KFALL.splice(k, 1);
    }
  }
}
function vendTex(brand) {
  return canvasTex(256, 512, c => {
    const g = c.createLinearGradient(0, 0, 0, 512), cola = brand === 'eCola';
    g.addColorStop(0, cola ? '#e01c24' : '#2fbf4a'); g.addColorStop(1, cola ? '#7a0c10' : '#0f5e22'); c.fillStyle = g; c.fillRect(0, 0, 256, 512);
    c.save(); c.translate(70, 300); c.rotate(-Math.PI / 2); c.fillStyle = '#fff'; c.font = 'bold italic 92px Georgia, serif'; c.textAlign = 'center'; c.fillText(brand, 0, 30); c.restore();
    c.fillStyle = 'rgba(255,255,255,.85)'; for (let k = 0; k < 4; k++) { c.fillRect(150, 60 + k * 70, 76, 50); c.fillStyle = cola ? '#e01c24' : '#2fbf4a'; c.fillRect(158, 66 + k * 70, 60, 38); c.fillStyle = 'rgba(255,255,255,.85)'; }
    c.fillStyle = '#111'; c.fillRect(150, 360, 76, 36); c.fillStyle = '#3aff6a'; c.font = 'bold 22px monospace'; c.fillText('$1.00', 156, 386);
    c.fillStyle = '#0b0b0b'; c.fillRect(40, 430, 176, 56); c.fillStyle = '#333'; c.fillRect(48, 438, 160, 40);
  });
}
// Blechschaden: Karosserie-Vertices am Aufprallpunkt eindrücken
const toCarLocal = (c, wx, wz) => { const dx = wx - c.x, dz = wz - c.z, co = Math.cos(c.yaw), si = Math.sin(c.yaw); return [dx * co - dz * si, dx * si + dz * co]; };
function deformLocal(c, cx, cz, depth) {
  if (c.model) return;
  if (depth < 0.02 || !c.paintMesh || (c.dent || 0) > 2.2) return;
  if (!c.ownGeo) { c.paintMesh.geometry = c.paintMesh.geometry.clone(); c.ownGeo = true; c.dent = 0; }
  c.dent += depth;
  const pos = c.paintMesh.geometry.attributes.position, hw = c.T.W / 2, hl = c.T.L / 2, front = Math.abs(cz) / hl > Math.abs(cx) / hw;
  const ex = front ? clamp(cx, -hw, hw) : Math.sign(cx) * hw, ez = front ? Math.sign(cz) * hl : clamp(cz, -hl, hl), dx = front ? 0 : -Math.sign(cx), dz = front ? -Math.sign(cz) : 0, RR = 1.15;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), d = Math.hypot(x - ex, z - ez, (y - 0.75) * 0.8); if (d > RR) continue;
    const j = Math.sin(x * 12.9898 + y * 4.1 + z * 78.233) * 43758.5453, k = depth * (1 - d / RR) ** 2 * (0.7 + 0.6 * (j - Math.floor(j)));
    pos.setXYZ(i, x + dx * k, y - k * 0.3, z + dz * k);
  }
  pos.needsUpdate = true; c.paintMesh.geometry.computeBoundingSphere();
}
// ---------- 3D-Fassaden: Fenstermodule, Balkone, Gesimse, Dachaufbauten ----------
// Wiederholte Module (Fenster, Balkone, Gesimse) sind globale InstancedMeshes, die nur für Fassaden nahe der Kamera
// gefüllt werden (Distanz-LOD + Blickrichtung); ferne Gebäude behalten die gemalte Textur. Statische Details
// (Sockel, Gesimse, Brüstungen, Dachaufbauten) werden pro Chunk zu einem Mesh verschmolzen.
const lc = hex => new THREE.Color(hex).toArray();
class GB { // kleiner Geometrie-Builder (Quader, Zylinder, Bögen) mit Vertexfarben; Winkel der Quads werden automatisch ausgerichtet
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }
  quad(a, b, c, d, nrm, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    if ((uy * vz - uz * vy) * nrm[0] + (uz * vx - ux * vz) * nrm[1] + (ux * vy - uy * vx) * nrm[2] < 0) [b, d] = [d, b];
    const o = this.p.length / 3, k3 = typeof col === 'number' ? [col, col, col] : col;
    this.p.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) { this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(k3[0], k3[1], k3[2]); }
    this.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  tri(a, b, c, nrm, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    if ((uy * vz - uz * vy) * nrm[0] + (uz * vx - ux * vz) * nrm[1] + (ux * vy - uy * vx) * nrm[2] < 0) [b, c] = [c, b];
    const o = this.p.length / 3, k3 = typeof col === 'number' ? [col, col, col] : col;
    this.p.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) { this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(k3[0], k3[1], k3[2]); }
    this.i.push(o, o + 1, o + 2);
  }
  box(x0, x1, y0, y1, z0, z1, col = 1, skip = 32) { // skip-Bits: 1 +x, 2 -x, 4 +y, 8 -y, 16 +z, 32 -z
    if (!(skip & 1)) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0], col);
    if (!(skip & 2)) this.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0], col);
    if (!(skip & 4)) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], col);
    if (!(skip & 8)) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], col);
    if (!(skip & 16)) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col);
    if (!(skip & 32)) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], col);
  }
  cyl(cx, cz, y0, y1, r, seg, col, rt = r) { // stehender Zylinder/Kegel
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * 6.2832, a1 = (k + 1) / seg * 6.2832, am = (a0 + a1) / 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const q0 = [cx + c0 * rt, y1, cz + s0 * rt], q1 = [cx + c1 * rt, y1, cz + s1 * rt];
      this.quad([cx + c0 * r, y0, cz + s0 * r], [cx + c1 * r, y0, cz + s1 * r], q1, q0, [Math.cos(am), (r - rt) / (y1 - y0), Math.sin(am)], col);
      if (rt > 0) this.tri([cx, y1, cz], q1, q0, [0, 1, 0], col);
    }
  }
  arch(cx, cy, r0, r1, z0, z1, seg, col) { // Halbring (Rundbogen) in der xy-Ebene
    for (let k = 0; k < seg; k++) {
      const a0 = Math.PI * k / seg, a1 = Math.PI * (k + 1) / seg, am = (a0 + a1) / 2, P = (a, r, z) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
      this.quad(P(a0, r0, z1), P(a0, r1, z1), P(a1, r1, z1), P(a1, r0, z1), [0, 0, 1], col);
      this.quad(P(a0, r1, z0), P(a0, r1, z1), P(a1, r1, z1), P(a1, r1, z0), [Math.cos(am), Math.sin(am), 0], col);
      this.quad(P(a0, r0, z0), P(a0, r0, z1), P(a1, r0, z1), P(a1, r0, z0), [-Math.cos(am), -Math.sin(am), 0], col);
    }
  }
  halfDisc(cx, cy, r, z, seg, col) { for (let k = 0; k < seg; k++) { const a0 = Math.PI * k / seg, a1 = Math.PI * (k + 1) / seg; this.tri([cx, cy, z], [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, z], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, z], [0, 0, 1], col); } }
  hip(cx, cz, y0, w, d, hgt, ins, col) { // Walmdach (Pyramidenstumpf)
    const hw = w / 2, hd = d / 2, tw = Math.max(0.1, hw - ins), td = Math.max(0.1, hd - ins), y1 = y0 + hgt;
    const A = [[-hw, y0, -hd], [hw, y0, -hd], [hw, y0, hd], [-hw, y0, hd]].map(p => [cx + p[0], p[1], cz + p[2]]), Bq = [[-tw, y1, -td], [tw, y1, -td], [tw, y1, td], [-tw, y1, td]].map(p => [cx + p[0], p[1], cz + p[2]]);
    const nrm = [[0, ins / hgt, -1], [1, ins / hgt, 0], [0, ins / hgt, 1], [-1, ins / hgt, 0]];
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4, s = k % 2 ? 0.88 : 1; this.quad(A[k], A[k2], Bq[k2], Bq[k], nrm[k], [col[0] * s, col[1] * s, col[2] * s]); }
    this.quad(Bq[0], Bq[1], Bq[2], Bq[3], [0, 1, 0], col);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setIndex(this.i.length > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    return g;
  }
}
const bayN = (len, st) => Math.max(1, Math.round(len / (st.TW / st.bays))); // Fensterachsen je Wand (gemalte Kacheln werden darauf gestreckt)

// Modulgeometrien: lokal x = entlang der Wand, y = hoch ab Geschossboden, z = aus der Wand heraus
function buildModGeos() {
  const G = {}, mk = fn => { const g = new GB(); fn(g); return g.geo(); };
  G.wClassic = mk(g => { // Steingewände, Sturz mit Verdachung, Sohlbank, Sprossenkreuz
    g.box(-1.42, -1.19, 0.66, 3.08, 0, 0.13, 0.95); g.box(1.19, 1.42, 0.66, 3.08, 0, 0.13, 0.95);
    g.box(-1.5, 1.5, 2.94, 3.2, 0, 0.2, 1); g.box(-1.62, 1.62, 3.2, 3.34, 0, 0.3, 0.9);
    g.box(-1.55, 1.55, 0.6, 0.79, 0, 0.3, 1); g.box(-1.25, 1.25, 0.45, 0.6, 0, 0.18, 0.8);
    g.box(-0.04, 0.04, 0.79, 2.94, 0, 0.07, 0.3); g.box(-1.19, 1.19, 1.95, 2.01, 0, 0.07, 0.3);
  });
  const brickBase = g => { g.box(-1.0, -0.78, 0.7, 2.9, 0, 0.1, 0.95); g.box(1.0 - 0.22, 1.0, 0.7, 2.9, 0, 0.1, 0.95); g.box(-1.1, 1.1, 0.66, 0.86, 0, 0.27, 1); g.box(-0.03, 0.03, 0.86, 2.86, 0, 0.06, 0.3); g.box(-0.78, 0.78, 1.7, 1.75, 0, 0.06, 0.3); };
  G.wBrick = mk(g => { brickBase(g); g.box(-1.06, 1.06, 2.86, 3.1, 0, 0.15, 1); g.box(-0.13, 0.13, 2.86, 3.24, 0, 0.21, 0.92); });
  G.wArch = mk(g => { brickBase(g); g.arch(0, 2.86, 0.78, 1.0, 0, 0.14, 8, 1); g.halfDisc(0, 2.86, 0.78, 0.01, 8, 0.1); g.box(-0.12, 0.12, 3.6, 3.94, 0, 0.2, 0.92); });
  G.wStucco = mk(g => { // Fensterläden, Sohlbank mit Blumenkasten
    for (const s of [-1, 1]) {
      g.box(Math.min(s * 0.83, s * 1.45), Math.max(s * 0.83, s * 1.45), 0.9, 2.8, 0, 0.05, 0.95);
      for (const y of [1.3, 1.85]) g.box(Math.min(s * 0.87, s * 1.41), Math.max(s * 0.87, s * 1.41), y, y + 0.07, 0.05, 0.09, 0.7);
    }
    g.box(-0.9, 0.9, 0.8, 0.94, 0, 0.28, 1); g.box(-0.85, 0.85, 0.94, 1.2, 0.05, 0.3, 0.55);
    g.box(-0.85, 0.85, 2.74, 2.84, 0, 0.1, 1); g.box(-0.85, -0.77, 0.94, 2.74, 0, 0.09, 1); g.box(0.77, 0.85, 0.94, 2.74, 0, 0.09, 1); g.box(-0.03, 0.03, 0.94, 2.74, 0, 0.08, 1);
  });
  G.wConc = mk(g => { // Sichtbeton: tiefe Laibung, Brüstungsband, Fensterstege
    g.box(-1.75, 1.75, 2.73, 3.1, 0, 0.45, 1); g.box(-1.75, 1.75, 0.95, 1.22, 0, 0.35, 0.95);
    g.box(-1.75, -1.69, 1.22, 2.73, 0, 0.14, 0.9); g.box(1.69, 1.75, 1.22, 2.73, 0, 0.14, 0.9); g.box(-0.05, 0.05, 1.22, 2.73, 0, 0.1, 0.4);
  });
  G.curt = mk(g => { // Vorhangfassade: Pfosten, Brüstungspaneel, Riegel
    g.box(-1.5, -1.44, 0, 3.6, 0, 0.2, 1); g.box(1.44, 1.5, 0, 3.6, 0, 0.2, 1);
    g.box(-1.44, 1.44, 0, 0.34, 0, 0.1, 0.45); g.box(-1.44, 1.44, 3.5, 3.6, 0, 0.14, 0.9);
  });
  G.shop = mk(g => { // Schaufenster: Sockel, Pfosten, Blende
    g.box(-1.75, 1.75, 0, 0.4, 0, 0.1, 0.6); g.box(-1.75, 1.75, 2.9, 3.3, 0, 0.18, 0.9);
    g.box(-1.75, -1.62, 0.4, 2.9, 0, 0.14, 1); g.box(1.62, 1.75, 0.4, 2.9, 0, 0.14, 1); g.box(-0.04, 0.04, 0.4, 2.9, 0, 0.1, 1); g.box(-1.62, 1.62, 2.0, 2.06, 0, 0.08, 1);
  });
  G.awn = mk(g => { // gestreifte Markise (Streifen = helle/dunkle Tönung der Instanzfarbe)
    const n = 8, w = 3.4 / n;
    for (let k = 0; k < n; k++) {
      const x0 = -1.7 + k * w, x1 = x0 + w, s = k % 2 ? 0.5 : 1;
      g.quad([x0, 3.4, 0.04], [x1, 3.4, 0.04], [x1, 2.9, 1.1], [x0, 2.9, 1.1], [0, 0.9, 0.45], s); g.quad([x0, 3.4, 0.04], [x1, 3.4, 0.04], [x1, 2.9, 1.1], [x0, 2.9, 1.1], [0, -0.9, -0.45], s * 0.5);
      g.quad([x0, 2.9, 1.1], [x1, 2.9, 1.1], [x1, 2.68, 1.1], [x0, 2.68, 1.1], [0, 0, 1], s);
    }
  });
  G.balc = mk(g => { // Balkon: Platte, Geländer mit Stäben
    g.box(-1.45, 1.45, 0, 0.14, 0, 1.25, 1); g.box(-1.45, 1.45, 1.0, 1.06, 1.2, 1.27, 0.3);
    for (const s of [-1, 1]) g.box(s * 1.45 - 0.03, s * 1.45 + 0.03, 1.0, 1.06, 0, 1.27, 0.3);
    for (let k = 0; k < 8; k++) { const x = -1.42 + k * 0.405; g.box(x, x + 0.035, 0.14, 1.0, 1.22, 1.255, 0.3); }
    for (const s of [-1, 1]) for (const z of [0.45, 0.9]) g.box(s * 1.45 - 0.0175, s * 1.45 + 0.0175, 0.14, 1.0, z, z + 0.035, 0.3);
  });
  G.balcLo = mk(g => { g.box(-1.45, 1.45, 0, 0.14, 0, 1.25, 1); g.box(-1.45, 1.45, 0.14, 1.06, 1.2, 1.27, 0.35); });
  G.bar = mk(g => g.box(-0.5, 0.5, 0, 1, 0, 1, 1));
  G.ring = mk(g => { g.box(-0.5, 0.5, 0.94, 1, 0, 0.1, 1); g.box(-0.5, 0.5, 0, 0.06, 0, 0.1, 1); g.box(-0.5, -0.44, 0.06, 0.94, 0, 0.1, 1); g.box(0.44, 0.5, 0.06, 0.94, 0, 0.1, 1); });
  const gl = new THREE.PlaneGeometry(1, 1); gl.translate(0, 0.5, 0); G.glass = gl;
  return G;
}
// Glas der Fenstermodule (gw/gh/gy = Scheibe in Metern über Geschossboden, deckungsgleich mit dem gemalten Fenster, nom = Rasterbreite, pad = Rahmenzugabe LOD 1)
const K3 = {
  wClassic: { gw: 2.38, gh: 2.16, gy: 0.79, nom: 3.5, pad: 0.35, refl: 0.15 },
  wBrick: { gw: 1.56, gh: 2.0, gy: 0.86, nom: 3.0, pad: 0.3, refl: 0.15 },
  wArch: { gw: 1.56, gh: 2.0, gy: 0.86, nom: 3.0, pad: 0.3, refl: 0.15 },
  wStucco: { gw: 1.54, gh: 1.8, gy: 0.94, nom: 3.5, pad: 0.3, refl: 0.1 },
  wConc: { gw: 3.5, gh: 1.51, gy: 1.22, nom: 3.5, pad: 0.4, refl: 0.3 },
  curt: { gw: 2.88, gh: 3.27, gy: 0.3, nom: 3.0, pad: 0.05, refl: 1 },
  shop: { gw: 3.2, gh: 2.5, gy: 0.4, nom: 3.5, pad: 0.2, refl: 0.35 },
  awn: { nom: 3.5 }, balc: { nom: 1 }, bar: { nom: 1 },
};
const ST3 = { // Stil -> Modul, Module je Achse, Zierleisten, Tönungen der Rahmen
  classic: { kind: 'wClassic', mods: 1, ledge: [0.2, 0.12], pil: [0.6, 0.18], tints: ['#e8e2d4', '#d8d2c4', '#cfc8b8', '#efe9dd'] },
  glass: { kind: 'curt', mods: 1, tints: ['#2b3036', '#4a525a', '#8a9096', '#1c2025'] },
  brick: { kind: 'wBrick', mods: 1, tints: ['#e6dcc8', '#d9ccb4', '#efe6d4'] },
  stucco: { kind: 'wStucco', mods: 1, tints: ['#2f5a3a', '#2b4c6e', '#6b3f2a', '#8a2b2b', '#f0ece4', '#3d6b66'] },
  concrete: { kind: 'wConc', mods: 2, ledge: [0.5, 0.35], pil: [0.5, 0.3], tints: ['#b8b8b2', '#a8aaa8', '#c4c2ba'] },
};
const FACES = [], SIGNS = [], SIGN_ROWS = [['BÄCKEREI', '#7a2e1d', '#ffe9c0'], ['APOTHEKE', '#0c6b3a', '#ffffff'], ['CAFÉ BRASIL', '#2b1d14', '#ffd9a0'], ['LS KIOSK', '#144a8a', '#ffffff'], ['MODE & STIL', '#161616', '#f2c6d8'], ['BÜCHER', '#3a2a52', '#f2e9c8'], ['STATE BANK', '#0b2a5b', '#e8d9a0'], ['GRAND HOTEL', '#4a0f1c', '#e8c870']];
// Fassadenmodule eines Wandkörpers (r: bx,bz,w,d,y0,floors,sid,doorN,doorHalf,doorFloors,street[4],balc,shop)
function facade3D(r) {
  const st = FSTYLES[r.sid], S3 = ST3[r.sid], tint = lc(pick(S3.tints)), arch = r.sid === 'brick' && Math.random() < 0.5, kind = arch ? 'wArch' : S3.kind;
  const awn = lc(pick(AWNING)), conc = lc('#b8b8b2'), stone = lc('#dcd6c8');
  for (let side = 0; side < 4; side++) {
    const [nx, nz] = DIRS[side], tx = nz, tz = -nx, len = nx ? r.d : r.w, nb = bayN(len, st), pitch = len / nb;
    const face = { cx: r.bx + nx * r.w / 2, cz: r.bz + nz * r.d / 2, nx, nz, hl: len / 2, y0: r.y0, y1: r.y0 + r.floors * 3.6, m: {}, d: 0 };
    const add = (k, a, y, ...v) => (face.m[k] ||= []).push(face.cx + tx * a, y, face.cz + tz * a, ...v);
    const isDoor = r.doorN && r.doorN[0] === nx && r.doorN[1] === nz, mp = pitch / S3.mods, sx = mp / K3[kind].nom, street = r.street[side];
    for (let f = 0; f < r.floors; f++) {
      const y = r.y0 + f * 3.6;
      for (let k = 0; k < nb * S3.mods; k++) {
        const a = (k + 0.5) * mp - len / 2, inDoor = isDoor && Math.abs(a) < r.doorHalf + mp * 0.4;
        if (f === 0 && r.shop && street) { if (!(isDoor && Math.abs(a) < 2.9 + mp * 0.5)) { add('shop', a, y, mp / 3.5, 1, ...tint, Math.random(), Math.random() < 0.6 ? 1 : 0); if (Math.random() < 0.65) add('awn', a, y, mp / 3.5, 1, ...awn, 0, 0); } continue; }
        if (inDoor && f <= r.doorFloors) continue;
        add(kind, a, y, sx, 1, ...tint, Math.random(), Math.random() < 0.5 ? 1 : 0);
        if (r.balc && street && f >= 1 && ((k + f) & 1) === 0 && !(isDoor && f <= r.doorFloors && Math.abs(a) < r.doorHalf + 2.2)) add('balc', a, y, 1, 1, ...(r.sid === 'stucco' ? tint : conc), 0, 0);
      }
      if (S3.ledge && f >= 1) add('bar', 0, y - 0.06, len + S3.ledge[1] * 2, S3.ledge[0], ...(r.sid === 'concrete' ? conc : stone), S3.ledge[1], 0);
    }
    if (S3.pil) for (let k = 0; k <= nb; k++) { const a = k * pitch - len / 2; if (isDoor && Math.abs(a) < r.doorHalf + 0.8 && k > 0 && k < nb) continue; add('bar', a, r.y0, S3.pil[0], r.floors * 3.6, ...(r.sid === 'concrete' ? conc : stone), S3.pil[1], 0); }
    if (Object.keys(face.m).length) { FACES.push(face); }
  }
}
// Statische Details je Gebäude: Sockel, Gesimse, Brüstung bzw. Walmdach, Dachaufbauten (alles in den Chunk-Trim)
function trimBuilding(T, bx, bz, w, d, h, sid, color, hip, floors) {
  const H = 0.2 + h, col = lc(color), dk = col.map(v => v * 0.8), P = (ww, hh, dd, y, c, sk = 0) => T.box(bx - ww / 2, bx + ww / 2, y, y + hh, bz - dd / 2, bz + dd / 2, c, sk);
  const plinth = { classic: '#a8a396', brick: '#6b5a4e', stucco: '#cfc3ae', concrete: '#8d8d88', glass: '#3a3f46' }[sid];
  P(w + 0.3, 0.7, d + 0.3, 0.2, lc(plinth), 8);
  if (sid === 'brick' || sid === 'stucco') P(w + 0.2, 0.28, d + 0.2, 3.72, lc(sid === 'brick' ? '#d9ccb4' : '#cdbfa6'));
  if (sid === 'classic') { P(w + 0.9, 0.35, d + 0.9, H - 0.35, lc('#d8d2c4')); P(w + 0.6, 0.25, d + 0.6, H - 0.6, lc('#c4bdb0')); }
  else if (sid === 'brick') P(w + 0.5, 0.3, d + 0.5, H - 0.3, lc('#b8a898'));
  else if (sid === 'stucco') P(w + 0.8, 0.25, d + 0.8, H - 0.25, lc('#b5643c'));
  else if (sid === 'glass') P(w + 0.1, 0.7, d + 0.1, H - 0.7, lc('#2a2f35'));
  const Y = H + 0.5; // Oberkante der Dachplatte
  if (hip) { T.hip(bx, bz, Y - 0.1, w + 1.2, d + 1.2, 1.9, 3.0, lc('#b5643c')); if (w > 9) T.box(bx + w * 0.2 - 0.4, bx + w * 0.2 + 0.4, Y, Y + 3.1, bz - 0.4, bz + 0.4, lc('#a8704f'), 8); return; }
  const pc = dk, W = w + 0.4, D = d + 0.4, t = 0.28, ph = sid === 'glass' ? 0.5 : 0.9;
  T.box(bx - W / 2, bx + W / 2, Y, Y + ph, bz - D / 2, bz - D / 2 + t, pc, 8); T.box(bx - W / 2, bx + W / 2, Y, Y + ph, bz + D / 2 - t, bz + D / 2, pc, 8);
  T.box(bx - W / 2, bx - W / 2 + t, Y, Y + ph, bz - D / 2 + t, bz + D / 2 - t, pc, 8); T.box(bx + W / 2 - t, bx + W / 2, Y, Y + ph, bz - D / 2 + t, bz + D / 2 - t, pc, 8);
  // Dachaufbauten
  const rx = () => bx + rnd(-w / 3, w / 3), rz = () => bz + rnd(-d / 3, d / 3);
  if (floors >= 5 && w > 10 && d > 10 && Math.random() < 0.3) { // Wassertank auf Gestell
    const x = rx(), z = rz(), c = lc('#7a5a3a');
    for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) T.box(x + dx - 0.07, x + dx + 0.07, Y, Y + 1.3, z + dz - 0.07, z + dz + 0.07, lc('#4a4d50'), 8);
    T.cyl(x, z, Y + 1.3, Y + 3.7, 1.3, 10, c); T.cyl(x, z, Y + 3.7, Y + 4.6, 1.38, 10, lc('#5a4630'), 0);
    for (const yy of [1.9, 2.9]) T.cyl(x, z, Y + yy, Y + yy + 0.08, 1.34, 10, lc('#3a3d40'));
  }
  if (floors >= 5 && w > 9 && d > 9 && Math.random() < 0.45) { // Treppenhaus-/Aufzugsaufbau
    const x = rx(), z = rz(), sw = rnd(2.8, 3.8), sd = rnd(2.6, 3.4);
    T.box(x - sw / 2, x + sw / 2, Y, Y + 3.0, z - sd / 2, z + sd / 2, lc('#bfb8aa'), 8); T.box(x - sw / 2 - 0.2, x + sw / 2 + 0.2, Y + 3.0, Y + 3.25, z - sd / 2 - 0.2, z + sd / 2 + 0.2, lc('#6b6e70'), 8);
    T.box(x - 0.5, x + 0.5, Y, Y + 2.1, z - sd / 2 - 0.06, z - sd / 2, lc('#3a3f46'), 8);
  }
  for (let k = rint(1, 3); k > 0; k--) { // Klimageräte mit Lüfter
    const x = rx(), z = rz(), a = rnd(1.6, 2.6), b2 = rnd(1.0, 1.6), hh = rnd(0.9, 1.4);
    T.box(x - a / 2, x + a / 2, Y, Y + hh, z - b2 / 2, z + b2 / 2, lc('#c8cccf'), 8); T.cyl(x - a * 0.22, z, Y + hh, Y + hh + 0.07, b2 * 0.36, 8, lc('#2a2d30'));
    if (a > 2) T.cyl(x + a * 0.22, z, Y + hh, Y + hh + 0.07, b2 * 0.36, 8, lc('#2a2d30'));
  }
}
function addSign(x, z, nx, nz, y, row) { SIGNS.push([x, z, nx, nz, y, row]); }

let F3 = null;
const _f3p = new THREE.Vector3(), _f3d = new THREE.Vector3();
const F3_TA = 60, F3_TB = 130, F3_TC = 190; // LOD-Radien in Metern: volle Module / vereinfachte Rahmen / nur Glas
function makeFrame3D() { return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 }); }
function makeGlass3D() { // Fensterglas mit Innenraum-Parallaxe (Interior Mapping): Raumbox hinter der Scheibe, nachts beleuchtete Räume
  const m = new THREE.MeshStandardMaterial({ color: 0x0a1018, roughness: 0.06, metalness: 0, emissive: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPUv; varying vec3 vTS; varying vec2 vSz;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
      mat4 imw = modelMatrix * instanceMatrix; vec3 ta = imw[0].xyz, ba = imw[1].xyz, na = normalize(imw[2].xyz);
      vSz = vec2(length(ta), length(ba)); vec3 vv = cameraPosition - (imw * vec4(position, 1.0)).xyz;
      vTS = vec3(dot(vv, ta / vSz.x), dot(vv, ba / vSz.y), dot(vv, na)); vPUv = uv;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vPUv; varying vec3 vTS; varying vec2 vSz;\nfloat h11(float n) { return fract(sin(n * 12.9898 + 1.7) * 43758.5453); }')
      .replace('#include <color_fragment>', `
      vec3 vw = normalize(vTS); vec3 rdv = normalize(vec3(-vw.xy, min(-vw.z, -0.04)));
      float sd = floor(vColor.r * 1023.0 + 0.5) + 1.0, lit = step(0.5, vColor.g), refl = vColor.b;
      vec3 pp = vec3(vPUv * vSz, 0.0);
      float rw = 0.5 + 1.2 * h11(sd * 7.0), rdp = 2.8 + 2.2 * h11(sd * 3.0);
      vec3 mn = vec3(-rw, -0.85, -rdp), mx = vec3(vSz.x + rw, vSz.y + 0.55, 0.0);
      vec3 inv = 1.0 / (rdv + 1e-5);
      vec3 tf = max((mn - pp) * inv, (mx - pp) * inv);
      float tt = min(tf.x, min(tf.y, tf.z)); vec3 hp = pp + rdv * tt;
      vec3 wallC = mix(vec3(.86, .82, .72), vec3(.62, .72, .80), h11(sd * 11.0)) * (0.7 + 0.5 * h11(sd * 5.0));
      vec3 ic;
      if (tt == tf.z) {
        ic = wallC;
        float furn = step(hp.y, 0.8 + 0.7 * h11(sd * 13.0)) * step(0.45, h11(sd * 17.0));
        ic = mix(ic, wallC * 0.4, furn * (0.55 + 0.45 * step(0.5, fract(hp.x * 0.9 + sd * 5.0))));
        vec2 pc = vec2(vSz.x * (0.2 + 0.6 * h11(sd * 19.0)), vSz.y * 0.6 + 0.3);
        float pic = step(abs(hp.x - pc.x), 0.4) * step(abs(hp.y - pc.y), 0.3) * step(0.5, h11(sd * 23.0));
        ic = mix(ic, vec3(.45, .3, .2) * (0.6 + h11(sd * 29.0)), pic);
      } else if (tt == tf.y) ic = rdv.y > 0.0 ? vec3(.9) : vec3(.38, .28, .2);
      else ic = wallC * 0.7;
      ic *= 1.0 - 0.5 * clamp(-hp.z / 5.0, 0.0, 1.0);
      float cur = step(0.55, h11(sd * 31.0)) * (1.0 - smoothstep(0.1, 0.26, min(vPUv.x, 1.0 - vPUv.x)));
      float bld = step(0.8, h11(sd * 37.0)) * step(0.85 - 0.5 * h11(sd * 41.0), vPUv.y);
      ic = mix(ic, mix(vec3(.75, .7, .6), vec3(.5, .22, .2), h11(sd * 43.0)), max(cur, bld));
      vec3 intCol = ic * mix(vec3(1.0), vec3(1.25, 1.0, .7), lit);
      float nf = clamp(emissive.r / 1.6, 0.0, 1.0);
      diffuseColor.rgb = mix(vec3(.02, .03, .04), vec3(.14, .22, .3), refl);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = refl * 0.8;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = intCol * (0.2 * (1.0 - nf) * (1.0 - 0.6 * refl) + lit * nf * 1.1 * (1.0 - 0.3 * refl));');
  };
  m.customProgramCacheKey = () => 'glass3d-v1';
  return m;
}
function buildFacades3D() {
  const G = buildModGeos(), cap = { wClassic: 6000, wBrick: 5000, wArch: 5000, wStucco: 5000, wConc: 5000, curt: 9000, shop: 1500, awn: 1500, balc: 3000, balcLo: 3000, bar: 6000, ring: 15000, glass: 26000 };
  const fm = M.facades.f3, gm = M.facades.g3; F3 = { meshes: {}, pos: new THREE.Vector3(1e9, 0, 0), fwd: new THREE.Vector3(), dirty: true };
  for (const k in cap) {
    const mesh = new THREE.InstancedMesh(G[k], k === 'glass' ? gm : fm, cap[k]);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap[k] * 3), 3); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; scene.add(mesh);
    F3.meshes[k] = { mesh, arr: mesh.instanceMatrix.array, col: mesh.instanceColor.array, n: 0, cap: cap[k] };
  }
  const prevBR = scene.onBeforeRender; // Instanzen vor dem Projizieren der Szene füllen (sonst hinkt der Upload ein Bild hinterher)
  scene.onBeforeRender = function (rr, sc, cam, ...a) { if (cam === camera) updateFacades3D(cam); prevBR.call(this, rr, sc, cam, ...a); };
  for (const f of FACES) for (const k in f.m) f.m[k] = Float32Array.from(f.m[k]);
  // Ladenschilder: ein Atlas, ein Mesh
  if (SIGNS.length) {
    const R = SIGN_ROWS.length, tex = canvasTex(1024, 128 * R, (c, w, h) => {
      SIGN_ROWS.forEach(([t, bg, fg], i) => { c.fillStyle = bg; c.fillRect(0, i * 128, w, 128); c.strokeStyle = fg; c.lineWidth = 6; c.strokeRect(8, i * 128 + 8, w - 16, 112); c.fillStyle = fg; c.font = 'bold 76px Arial Black, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, w / 2, i * 128 + 68); });
    });
    const geos = SIGNS.map(([x, z, nx, nz, y, row]) => {
      const g = new THREE.PlaneGeometry(5.6, 0.7), uv = g.attributes.uv;
      for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i), 1 - (row + 1) / R + uv.getY(i) / R);
      g.rotateY(Math.atan2(nx, nz)); g.translate(x, y, z); return g;
    });
    const sm = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.5 });
    Object.assign(sm, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.KeepStencilOp });
    const m = new THREE.Mesh(mergeGeometries(geos), sm); scene.add(m); ADMATS.push(sm);
  }
}
function updateFacades3D(cam) {
  cam.getWorldPosition(_f3p); cam.getWorldDirection(_f3d);
  if (!F3.dirty && _f3p.distanceTo(F3.pos) < 6 && _f3d.dot(F3.fwd) > 0.985) return;
  F3.dirty = false; F3.pos.copy(_f3p); F3.fwd.copy(_f3d);
  const cx = _f3p.x, cy = _f3p.y, cz = _f3p.z, fx = _f3d.x, fy = _f3d.y, fz = _f3d.z, hv = Math.atan(Math.tan(cam.fov * Math.PI / 360) * Math.hypot(1, cam.aspect)) + 0.3, list = [];
  for (const f of FACES) {
    const rx = f.cx - cx, rz = f.cz - cz;
    if (rx * f.nx + rz * f.nz > 0.5) continue; // Rückseite
    const s = clamp((cx - f.cx) * f.nz - (cz - f.cz) * f.nx, -f.hl, f.hl), dd = Math.hypot(cx - (f.cx + f.nz * s), cy - clamp(cy, f.y0, f.y1), cz - (f.cz - f.nx * s));
    if (dd > F3_TC) continue;
    if (dd > 25) {
      const ry = (f.y0 + f.y1) / 2 - cy, rl = Math.hypot(rx, ry, rz), R = Math.hypot(f.hl, (f.y1 - f.y0) / 2);
      if (rl > R && Math.acos(clamp((rx * fx + ry * fy + rz * fz) / rl, -1, 1)) - Math.asin(Math.min(1, R / rl)) > hv) continue;
    }
    f.d = dd; list.push(f);
  }
  list.sort((a, b) => a.d - b.d);
  const MS = F3.meshes; for (const k in MS) MS[k].n = 0;
  const emit = (q, tx, tz, nx, nz, sw, sh, sd, px, py, pz, r, g, b) => {
    if (q.n >= q.cap) return; const a = q.arr, o = q.n * 16, c = q.col, oc = q.n * 3; q.n++;
    a[o] = tx * sw; a[o + 1] = 0; a[o + 2] = tz * sw; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = sh; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = nx * sd; a[o + 9] = 0; a[o + 10] = nz * sd; a[o + 11] = 0; a[o + 12] = px; a[o + 13] = py; a[o + 14] = pz; a[o + 15] = 1;
    c[oc] = r; c[oc + 1] = g; c[oc + 2] = b;
  };
  for (const f of list) {
    const tier = f.d < F3_TA ? 0 : f.d < F3_TB ? 1 : 2, nx = f.nx, nz = f.nz, tx = nz, tz = -nx;
    for (const kind in f.m) {
      const a = f.m[kind], sp = K3[kind];
      for (let o = 0; o < a.length; o += 10) {
        const x = a[o], y = a[o + 1], z = a[o + 2], sx = a[o + 3], sy = a[o + 4];
        if (sp.gw) {
          if (tier === 0) emit(MS[kind], tx, tz, nx, nz, sx, sy, 1, x, y, z, a[o + 5], a[o + 6], a[o + 7]);
          else if (tier === 1) emit(MS.ring, tx, tz, nx, nz, sp.gw * sx + sp.pad, sp.gh + sp.pad, 1, x, y + sp.gy - sp.pad / 2, z, a[o + 5], a[o + 6], a[o + 7]);
          emit(MS.glass, tx, tz, nx, nz, sp.gw * sx, sp.gh, 1, x + nx * 0.04, y + sp.gy, z + nz * 0.04, a[o + 8], a[o + 9], sp.refl);
        } else if (tier < 2) {
          if (kind === 'bar') emit(MS.bar, tx, tz, nx, nz, sx, sy, a[o + 8], x, y, z, a[o + 5], a[o + 6], a[o + 7]);
          else emit(tier === 0 || kind === 'awn' ? MS[kind] : MS.balcLo, tx, tz, nx, nz, sx, sy, 1, x, y, z, a[o + 5], a[o + 6], a[o + 7]);
        }
      }
    }
  }
  for (const k in MS) {
    const q = MS[k]; q.mesh.count = q.n; if (!q.n) continue;
    const im = q.mesh.instanceMatrix, ic = q.mesh.instanceColor;
    im.clearUpdateRanges(); im.addUpdateRange(0, q.n * 16); im.needsUpdate = true; ic.clearUpdateRanges(); ic.addUpdateRange(0, q.n * 3); ic.needsUpdate = true;
  }
}
// TEMP-MESSUNG (Bootzeit der 3D-Fassaden), wird nach der Messung entfernt
{ const T = (f) => (...a) => { const t = performance.now(); const r = f(...a); window.__f3Ms = (window.__f3Ms || 0) + performance.now() - t; return r; };
  facade3D = T(facade3D); trimBuilding = T(trimBuilding); buildFacades3D = T(buildFacades3D); const g0 = GB.prototype.geo; GB.prototype.geo = function () { const t = performance.now(); const r = g0.call(this); window.__f3Ms = (window.__f3Ms || 0) + performance.now() - t; return r; }; }
function wallBox(w, h, d, x, y, z, color, st = FSTYLES.classic) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, TH = st.TH;
  const ou = rint(0, st.bays - 1) / st.bays, ov = rint(0, st.floors - 1) / st.floors;
  const nbD = bayN(d, st), nbW = bayN(w, st); // ganze Fensterachsen je Wand: die 3D-Module sitzen deckungsgleich auf den gemalten Fenstern
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v; let u = uv.getX(i), vv = uv.getY(i);
    if (f < 2) { u = u * nbD / st.bays + ou; vv = vv * h / TH + ov; }
    else if (f >= 4) { u = u * nbW / st.bays + ou; vv = vv * h / TH + ov; }
    else { u = 0.005; vv = 0.005; }
    uv.setXY(i, u, vv);
  }
  g.translate(x, y, z); return colorize(g, color);
}
function box(w, h, d, x, y, z, color) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return colorize(g, color); }
function splits(n) { const a = []; let s = 0; for (let i = 0; i < n; i++) { const v = rnd(0.7, 1.3); a.push(v); s += v; } return a.map(v => v / s); }

const mapBuildings = []; // für die Minimap
function genBlock(i, j, chunk) {
  const cx = blockCenter(i), cz = blockCenter(j);
  const inner = B - 7, x0 = cx - inner / 2, z0 = cz - inner / 2;
  const dist = Math.hypot(i - (N - 1) / 2, j - (N - 1) / 2);
  const down = clamp(1 - dist / 8, 0.03, 1);
  const nx = rint(1, 3), nz = nx === 3 ? rint(1, 2) : rint(1, 3);   // kein Grundstück ganz innen: jedes Gebäude grenzt an die Straße
  const xs = splits(nx), zs = splits(nz);
  let px = x0;
  for (const fx of xs) {
    let pz = z0; const cw = inner * fx;
    for (const fz of zs) {
      const cd = inner * fz, gap = rnd(0.6, 2.2);
      const w = cw - gap, d = cd - gap, bx = px + cw / 2, bz = pz + cd / 2;
      const floors = Math.max(3, Math.round((rnd(10, 24) + down * down * rnd(10, 130) * (Math.random() < 0.7 ? 1 : 0.3)) / 3.6));
      const h = floors * 3.6;
      const sid = floors > 14 ? pick(['glass', 'glass', 'glass', 'concrete', 'classic']) : floors <= 5 ? pick(['stucco', 'stucco', 'brick', 'classic']) : pick(['brick', 'stucco', 'classic', 'concrete', 'glass']);
      const st = FSTYLES[sid], color = pick(st.tints), roofCol = pick(['#5b5f63', '#6b6e70', '#4a4d50', '#7a6a5a', '#8a8478']);
      (chunk.walls[sid] ||= []).push(wallBox(w, h, d, bx, 0.2 + h / 2, bz, color, st));
      chunk.roofs.push(box(w + 0.4, 0.5, d + 0.4, bx, 0.2 + h + 0.25, bz, roofCol));
      if (sid === 'stucco' && floors <= 5) chunk.roofs.push(box(w + 1.2, 0.18, d + 1.2, bx, 0.2 + h + 0.1, bz, '#b5643c'));
      if (floors <= 8 && Math.random() < 0.12) billboard(bx, 0.2 + h + 0.5, bz, w, d);
      let top = h, set = null;
      const hip = sid === 'stucco' && floors <= 5 && Math.random() < 0.55;
      trimBuilding(chunk.trim, bx, bz, w, d, h, sid, color, hip, floors);
      if (h > 55 && w > 12 && d > 12) {
        const h2 = Math.round(rnd(0.15, 0.4) * h / 3.6) * 3.6, w2 = w * rnd(0.55, 0.75), d2 = d * rnd(0.55, 0.75);
        chunk.walls[sid].push(wallBox(w2, h2, d2, bx, 0.2 + h + h2 / 2, bz, color, st));
        chunk.roofs.push(box(w2 + 0.4, 0.5, d2 + 0.4, bx, 0.2 + h + h2 + 0.25, bz, '#4d5155'));
        top = h + h2; set = { w: w2, d: d2, floors: h2 / 3.6, y0: 0.2 + h };
        if (Math.random() < 0.6) chunk.roofs.push(box(0.4, rnd(8, 18), 0.4, bx, 0.2 + top + 6, bz, '#888'));
      }
      for (let k = hip ? 0 : rint(0, 3); k > 0; k--) {
        const aw = rnd(1.5, 4), ad = rnd(1.5, 4), ah = rnd(1, 2.5);
        chunk.roofs.push(box(aw, ah, ad, bx + rnd(-w / 3, w / 3), 0.2 + h + 0.5 + ah / 2, bz + rnd(-d / 3, d / 3), pick(['#9a9c9e', '#7d8083', '#b0b2b4'])));
      }
      const bsol = addSolid(bx - w / 2, bx + w / 2, bz - d / 2, bz + d / 2, top + 0.7);
      mapBuildings.push([bx - w / 2, bz - d / 2, w, d]);
      addBuilding(chunk, bx, bz, w, d, Math.round(top / 3.6), cx, cz, floors <= 5, bsol, { sid, floors, set });
      pz += cd;
    }
    px += cw;
  }
}

const BUILDINGS = [];
const ADS = [['CUTLINE', 'VIDEOPRODUKTION · LOS SANTOS', '#111', '#ffd23a'], ['KOLA COLA', 'DURST? KOLA!', '#c4161c', '#fff'], ['VINEWOOD STUDIOS', 'JETZT IM KINO', '#1a1a2e', '#e8d9b0'], ['PALM BURGER', 'SEIT 1987', '#ffcc00', '#c4161c'], ['SURF & SUN', 'STRANDMODE', '#0aa3c2', '#fff'], ['LS TAXI', '555-0199', '#f2c200', '#111']];
const adGeos = ADS.map(() => []), adFrames = [];
function billboard(x, y, z, w, d) {
  const k = Math.floor(Math.random() * ADS.length), along = Math.random() < 0.5, len = Math.min(10, (along ? w : d) - 1);
  if (len < 5) return;
  const g = new THREE.PlaneGeometry(len, len * 0.4); if (!along) g.rotateY(Math.PI / 2); if (Math.random() < 0.5) g.rotateY(Math.PI);
  g.translate(x, y + 2.2 + len * 0.2, z); adGeos[k].push(g);
  adFrames.push(box(0.2, 2.4, 0.2, x - (along ? len / 3 : 0), y + 1.2, z - (along ? 0 : len / 3), '#333'), box(0.2, 2.4, 0.2, x + (along ? len / 3 : 0), y + 1.2, z + (along ? 0 : len / 3), '#333'));
}
function buildBillboards() {
  ADS.forEach(([t1, t2, bg, fg], k) => {
    if (!adGeos[k].length) return;
    const tex = canvasTex(1024, 410, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.textAlign = 'center'; c.font = 'bold 150px Impact, Arial Black, sans-serif'; c.fillText(t1, w / 2, h * 0.55); c.font = 'bold 54px Arial'; c.fillText(t2, w / 2, h * 0.85); c.strokeStyle = fg; c.lineWidth = 10; c.strokeRect(14, 14, w - 28, h - 28); });
    const m = new THREE.Mesh(mergeGeometries(adGeos[k]), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    m.castShadow = true; scene.add(m); ADMATS.push(m.material);
  });
  if (adFrames.length) scene.add(new THREE.Mesh(mergeGeometries(adFrames), M.vcol));
}
const ADMATS = [];
const AWNING = ['#2c3e50', '#8e2b2b', '#2b6e4f', '#444444', '#6b4e2e', '#1f4f6e'];
// Gebäude registrieren + Eingangstür an der Straßenseite
function addBuilding(chunk, bx, bz, w, d, floors, cx, cz, low, solid, det) {
  const fd = [(bz - d / 2) - (cz - B / 2), (cx + B / 2) - (bx + w / 2), (cz + B / 2) - (bz + d / 2), (bx - w / 2) - (cx - B / 2)];
  let side = 0; for (let k = 1; k < 4; k++) if (fd[k] < fd[side]) side = k;
  const rr0 = Math.random(), type = floors > 11 ? (Math.min(w, d) >= 19 && rr0 < 0.3 ? 'hotel' : 'office') : low && rr0 < 0.5 ? 'shop' : rr0 > 0.5 && rr0 < 0.56 ? 'bank' : Math.random() < 0.6 ? 'apartment' : 'office';
  const bld = { x: bx, z: bz, w, d, floors: Math.max(2, floors), seed: Math.floor(Math.random() * 1e9), type, door: null, solid };
  let ent3 = null;
  if (fd[side] < 6 && Math.min(w, d) > 7) {
    const [nx, nz] = DIRS[side], tx = -nz, tz = nx;
    const fx = bx + nx * w / 2, fz = bz + nz * d / 2;
    const ob = (along, h, thick, off, y, col) => chunk.roofs.push(nx ? box(thick, h, along, fx + nx * off, y, fz, col) : box(along, h, thick, fx, y, fz + nz * off, col));
    const tall = floors > 11, ent = type === 'shop' ? 'shop' : type === 'hotel' ? 'hotel' : type === 'bank' ? 'bank' : tall ? 'tower' : type === 'apartment' ? 'apt' : pick(['office', 'apt']);
    const frame = pick(['#2a2c30', '#3a3328', '#b8b2a8', '#1a2a3a', '#5a5f66']), tint = pick(['#1d2a38', '#24323e', '#2a3a30', '#30283a']);
    ent3 = ent;
    if (ent === 'tower') {
      ob(5.2, 4.2, 0.3, 0.1, 0.2 + 2.1, frame); ob(4.4, 3.8, 0.12, 0.22, 0.2 + 1.9, tint);
      ob(7.5, 0.25, 3.2, 1.6, 0.2 + 4.6, '#d0d4d8'); for (const sgn of [-1, 1]) chunk.roofs.push(nx ? box(0.18, 4.6, 0.18, fx + nx * 3.0, 0.2 + 2.3, fz + sgn * 3.4, '#9aa0a6') : box(0.18, 4.6, 0.18, fx + sgn * 3.4, 0.2 + 2.3, fz + nz * 3.0, '#9aa0a6'));
    } else if (ent === 'hotel') {
      ob(4.2, 3.4, 0.3, 0.1, 0.2 + 1.7, '#3a2a1a'); ob(3.4, 3.0, 0.12, 0.22, 0.2 + 1.5, '#2a1e14');
      ob(3.4, 0.3, 6, 3.1, 0.2 + 3.5, '#7a1020'); ob(2.0, 0.03, 6, 3.1, 0.2 + 0.02, '#a01828');
      for (const sgn of [-1, 1]) chunk.roofs.push(nx ? box(0.12, 3.5, 0.12, fx + nx * 6.0, 0.2 + 1.75, fz + sgn * 1.6, '#c8a860') : box(0.12, 3.5, 0.12, fx + sgn * 1.6, 0.2 + 1.75, fz + nz * 6.0, '#c8a860'));
    } else if (ent === 'bank') {
      ob(3.4, 3.4, 0.3, 0.1, 0.2 + 1.7, '#e8e4dc'); ob(2.4, 2.9, 0.12, 0.22, 0.2 + 1.45, '#1d2a38');
      for (const sgn of [-1, 1]) chunk.roofs.push(nx ? box(0.7, 4.2, 0.7, fx + nx * 0.8, 0.2 + 2.1, fz + sgn * 2.4, '#f0ece4') : box(0.7, 4.2, 0.7, fx + sgn * 2.4, 0.2 + 2.1, fz + nz * 0.8, '#f0ece4'));
      ob(6, 0.5, 1.6, 0.7, 0.2 + 4.4, '#e8e4dc');
    } else if (ent === 'apt') {
      ob(2.4, 2.9, 0.3, 0.1, 0.2 + 1.45, frame); ob(1.6, 2.5, 0.12, 0.22, 0.2 + 1.25, pick(['#5a3a24', '#2a3a4a', '#6a2a2a', '#2a4a3a']));
      ob(2.6, 0.12, 1.2, 0.6, 0.2 + 3.0, pick(AWNING)); ob(3.0, 0.16, 1.4, 0.7, 0.2 + 0.08, '#9a9690');
      ob(0.4, 0.3, 0.05, 0.25, 0.2 + 2.6, '#f2f2f2');
    } else {
      ob(2.8, 3.1, 0.3, 0.1, 0.2 + 1.55, frame);
      ob(2.0, 2.6, 0.12, 0.22, 0.2 + 1.3, type === 'shop' ? '#3a5068' : tint);
      ob(type === 'shop' ? 6 : 3.6, 0.14, 1.5, 0.75, 0.2 + 3.4, pick(AWNING));
    }
    if (type === 'shop') ob(5.5, 2.2, 0.1, 0.12, 0.2 + 1.7, '#5d7891');
    if (type === 'shop' || type === 'bank' || Math.random() < 0.15) { const ax = fx + nx * 0.35 + tx * 2.4, az = fz + nz * 0.35 + tz * 2.4; chunk.roofs.push(nx ? box(0.5, 1.7, 0.75, ax, 0.2 + 0.85, az, '#2a6a3a') : box(0.75, 1.7, 0.5, ax, 0.2 + 0.85, az, '#2a6a3a')); ATMS.push({ x: ax + nx * 0.7, z: az + nz * 0.7, bx: ax, bz: az }); }
    if (type === 'bank' || type === 'hotel') bld.sign = true;
    bld.door = { x: fx + nx * 1.1, z: fz + nz * 1.1, nx, nz, tx, tz };
    if (type === 'shop' || type === 'bank' || type === 'hotel') { // Schild über dem Eingang
      const row = type === 'bank' ? 6 : type === 'hotel' ? 7 : rint(0, 5), sy = type === 'bank' ? 5.5 : type === 'hotel' ? 4.5 : 4.5;
      addSign(fx + nx * 0.17, fz + nz * 0.17, nx, nz, 0.2 + sy, row); chunk.trim.box(Math.min(fx, fx + nx * 0.14) - (nx ? 0 : 2.85), Math.max(fx, fx + nx * 0.14) + (nx ? 0 : 2.85), 0.2 + sy - 0.4, 0.2 + sy + 0.4, Math.min(fz, fz + nz * 0.14) - (nz ? 0 : 2.85), Math.max(fz, fz + nz * 0.14) + (nz ? 0 : 2.85), lc('#1a1a1a'));
    }
  }
  if (det) {
    bld.sid = det.sid;
    const doorHalf = { tower: 3.0, hotel: 2.6, bank: 3.0, apt: 1.8, office: 1.9, shop: 2.9 }[ent3] ?? 2, street = fd.map(v => v < 6);
    facade3D({ bx, bz, w, d, y0: 0.2, floors: det.floors, sid: det.sid, doorN: bld.door ? [bld.door.nx, bld.door.nz] : null, doorHalf, doorFloors: ent3 === 'tower' || ent3 === 'bank' ? 1 : 0, street, shop: type === 'shop', balc: det.sid !== 'glass' && (type === 'apartment' ? Math.random() < 0.8 : det.sid === 'stucco' && Math.random() < 0.6) });
    if (det.set) facade3D({ bx, bz, w: det.set.w, d: det.set.d, y0: det.set.y0, floors: det.set.floors, sid: det.sid, doorN: null, doorHalf: 0, doorFloors: 0, street: [false, false, false, false], shop: false, balc: false });
  }
  BUILDINGS.push(bld);
}
function nearestDoor(x, z, r) {
  let best = null, bd = r;
  for (const b of BUILDINGS) { if (!b.door) continue; const d = Math.hypot(b.door.x - x, b.door.z - z); if (d < bd) { bd = d; best = b; } }
  return best;
}
function randomDoorNear(x, z, minD, maxD) {
  for (let t = 0; t < 40; t++) { const b = BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)]; if (!b.door) continue; const d = Math.hypot(b.door.x - x, b.door.z - z); if (d >= minD && d <= maxD) return b; }
  return null;
}
const trees = [], lamps = [];
async function buildCity(progress) {
  const __t0 = performance.now(); // TEMP-MESSUNG
  // Boden
  buildTerrain();
  const roadSize = EXT * 2 + 8;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(roadSize, roadSize), new THREE.MeshStandardMaterial({ map: TEX.asphalt, roughness: 0.92 }));
  TEX.asphalt.repeat.set(roadSize / 14, roadSize / 14);
  asphalt.rotation.x = -Math.PI / 2; asphalt.receiveShadow = true; scene.add(asphalt);

  // Parks auswählen (Startblock ist eine Plaza/Park)
  for (let n = 0; n < 18; n++) parks.add(rint(0, N - 1) + ',' + rint(0, N - 1));
  for (const k of HOME_BLOCKS) parks.add(k);
  parks.delete(HOSPITAL_BLOCK); for (const k in SPECIAL) parks.delete(k);

  const chunks = new Map(), sidewalk = [], parkGeo = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const ck = Math.floor(i / 4) + ',' + Math.floor(j / 4);
      if (!chunks.has(ck)) chunks.set(ck, { walls: {}, roofs: [], trim: new GB() });
      const cx = blockCenter(i), cz = blockCenter(j);
      const sw = new THREE.BoxGeometry(B, 0.2, B); const uv = sw.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * B / 3, uv.getY(k) * B / 3);
      sw.translate(cx, 0.1, cz); sidewalk.push(sw);
      if (parks.has(i + ',' + j)) {
        const pg = new THREE.PlaneGeometry(B - 8, B - 8); pg.rotateX(-Math.PI / 2); pg.translate(cx, 0.215, cz);
        const puv = pg.attributes.uv; for (let k = 0; k < puv.count; k++) puv.setXY(k, puv.getX(k) * 12, puv.getY(k) * 12);
        parkGeo.push(pg);
        for (let t = 0; t < 22; t++) {
          const tx = cx + rnd(-B / 2 + 7, B / 2 - 7), tz = cz + rnd(-B / 2 + 7, B / 2 - 7);
          if (HOME_BLOCKS.includes(i + ',' + j) && Math.hypot(tx - cx, tz - cz) < 20) continue;
          trees.push([tx, tz, rnd(0.9, 1.5), Math.random() < 0.4]);
        }
      } else if (SPECIAL[i + ',' + j]) genSpecial(i, j, chunks.get(ck), SPECIAL[i + ',' + j]);
      else if (i + ',' + j !== HOSPITAL_BLOCK) genBlock(i, j, chunks.get(ck));
      // Laternen & Straßenbäume an den Bordsteinen
      for (let side = 0; side < 4; side++) {
        for (let s = 0; s < 3; s++) {
          const t = -B / 2 + 10 + s * 20, e = B / 2 - 0.7;
          const p = [[t, -e], [e, t], [t, e], [-e, t]][side];
          lamps.push([cx + p[0], cz + p[1], side]);
          if (s < 2 && Math.random() < 0.8) {
            const tt = t + 10, e2 = B / 2 - 1.3, q = [[tt, -e2], [e2, tt], [tt, e2], [-e2, tt]][side];
            trees.push([cx + q[0], cz + q[1], rnd(0.8, 1.15), Math.random() < 0.7]);
          }
        }
      }
    }
    if (i % 2 === 1) { progress(0.25 + 0.4 * i / N, 'Los Santos wird gebaut …'); await nextFrame(); }
  }
  for (const c of chunks.values()) {
    for (const id in c.walls) { const m = new THREE.Mesh(mergeGeometries(c.walls[id]), M.facades[id]); m.castShadow = m.receiveShadow = true; scene.add(m); }
    if (c.roofs.length) { const r = new THREE.Mesh(mergeGeometries(c.roofs), M.vcol); r.castShadow = r.receiveShadow = true; scene.add(r); }
    if (c.trim.i.length) { const tm = new THREE.Mesh(c.trim.geo(), M.vcol); tm.receiveShadow = true; scene.add(tm); }
  }
  buildFacades3D();
  window.__cityMs = performance.now() - __t0; // TEMP-MESSUNG
  buildBillboards();
  const swm = new THREE.Mesh(mergeGeometries(sidewalk), new THREE.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.9 }));
  swm.receiveShadow = true; scene.add(swm);
  const pm = new THREE.Mesh(mergeGeometries(parkGeo), new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1 }));
  pm.receiveShadow = true; scene.add(pm);
  progress(0.7, 'Straßenmarkierungen …'); await nextFrame();
  buildMarkings();
  buildProps();
  // Stadtgrenze
  const W = EXT + 14;
  for (const [x, z, w, d] of [[0, -W, 2 * W + 4, 2], [0, W, 2 * W + 4, 2], [-W, 0, 2, 2 * W], [W, 0, 2, 2 * W]]) {
    addSolid(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 4);
  }
}

// ---------- Umland: Strand & Ozean (West/Süd), Vinewood-Hügel (Nord), Wüstenberge (Ost) ----------
function vnoise(x, z) { const h = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); }; const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(h(ix, iz), h(ix + 1, iz), ux), lerp(h(ix, iz + 1), h(ix + 1, iz + 1), ux), uz); }
const fbm2 = (x, z) => vnoise(x, z) * 0.5 + vnoise(x * 2.1, z * 2.1) * 0.25 + vnoise(x * 4.3, z * 4.3) * 0.125 + vnoise(x * 8.7, z * 8.7) * 0.0625;
const EDGE = EXT + 22;
function terrainH(x, z) {
  if (x < -EDGE || (z > EDGE && x < EDGE + 400)) { const d = Math.max(-x - EDGE, z - EDGE); return -0.6 - Math.min(d, 120) * 0.045 - Math.max(0, d - 120) * 0.02; }
  let h = -0.6;
  const dn = Math.max(0, -z - EDGE), de = Math.max(0, x - EDGE);
  if (dn > 0 || de > 0) {
    const d = Math.max(dn, de), n = fbm2(x / 260, z / 260);
    h += Math.pow(d / 380, 1.35) * (dn > de ? 150 : 90) * (0.55 + 0.7 * n) + fbm2(x / 60, z / 60) * Math.min(d, 60) * 0.15;
  }
  h += 620 * Math.exp(-(((x - 1900) / 650) ** 2 + ((z + 2300) / 650) ** 2));   // Mount Chiliad
  return h;
}
function buildTerrain() {
  const S = 9000, seg = 300, g = new THREE.PlaneGeometry(S, S, seg, seg); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), inCity = Math.abs(x) < EDGE - 2 && Math.abs(z) < EDGE - 2;
    const h = inCity ? -0.6 : terrainH(x, z); pos.setY(i, h);
    const n = fbm2(x / 40, z / 40);
    if (h < -0.4 && !inCity) c.set('#d8c9a0').lerp(new THREE.Color('#bba77a'), clamp(-h / 4, 0, 1));
    else if (h < 3 && (x < -EDGE + 30 || z > EDGE - 30)) c.set('#e2d4ab');
    else if (h > 220) c.set('#8a8278').lerp(new THREE.Color('#ffffff'), clamp((h - 450) / 150, 0, 1));
    else if (h > 70) c.set('#7d7448').lerp(new THREE.Color('#8f8268'), n);
    else c.set('#5e7a3a').lerp(new THREE.Color('#8f8a52'), n * 0.9);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: TEX.grass, roughness: 1 }));
  TEX.grass.repeat.set(900, 900); m.receiveShadow = true; scene.add(m);
  // Ozean mit animierten Wellen
  const wn = canvasTex(512, 512, (cx, w, h) => { const img = cx.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = Math.sin(x * 0.098) * Math.cos(y * 0.073) + Math.sin((x + y) * 0.051) * 0.6 + Math.sin(x * 0.21 - y * 0.17) * 0.3; const b = Math.cos(x * 0.083 + y * 0.041) + Math.sin(y * 0.19) * 0.4; const k = (y * w + x) * 4; img.data[k] = 128 + a * 40; img.data[k + 1] = 128 + b * 40; img.data[k + 2] = 255; img.data[k + 3] = 255; } cx.putImageData(img, 0, 0); }, false);
  const wnp = photoTex('Water_1_M_Normal', 220, false); if (wnp) { wn.dispose(); } const wnU = wnp || wn; if (!wnp) wn.repeat.set(160, 160); TEX.water = wnU;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshPhysicalMaterial({ color: 0x1b5a7e, roughness: 0.08, metalness: 0.1, normalMap: TEX.water, normalScale: new THREE.Vector2(0.45, 0.45), clearcoat: 1, clearcoatRoughness: 0.05 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -1.6; water.receiveShadow = true; scene.add(water);
  buildLandmarks();
}
function buildLandmarks() {
  const geos = [], add = (w, h, d, x, y, z, col) => geos.push(box(w, h, d, x, y, z, col));
  // Del-Perro-Pier mit Riesenrad
  const pz = -120, px0 = -EDGE - 10;
  add(260, 1.2, 22, px0 - 130, 3.2, pz, '#8a6a4a');
  for (let x = px0 - 5; x > px0 - 260; x -= 12) for (const dz of [-10, 10]) add(0.8, 9, 0.8, x, -1.5, pz + dz, '#5a4a3a');
  const wheel = new THREE.Group(), wm = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.6, roughness: 0.35 });
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(26, 0.7, 8, 64), wm));
  for (let k = 0; k < 16; k++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 52, 6), wm); sp.rotation.z = k / 16 * Math.PI; wheel.add(sp); const gd = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.4), new THREE.MeshStandardMaterial({ color: ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71'][k % 4] })); gd.position.set(Math.cos(k / 16 * Math.PI * 2) * 26, Math.sin(k / 16 * Math.PI * 2) * 26, 0); wheel.add(gd); }
  wheel.position.set(px0 - 150, 34, pz); wheel.rotation.y = Math.PI / 2; scene.add(wheel); WHEEL = wheel;
  add(3, 32, 3, px0 - 150, 18, pz - 4, '#cccccc'); add(3, 32, 3, px0 - 150, 18, pz + 4, '#cccccc');
  // Hafen im Süden: Kai, Container, Kräne
  add(420, 2, 120, 260, 0.4, EDGE + 90, '#6a6a68');
  const cc = ['#b03a2e', '#1f618d', '#239b56', '#d68910', '#7d3c98', '#cfcfcf'];
  for (let i = 0; i < 26; i++) for (let k = 0; k < rint(1, 4); k++) add(12, 2.6, 2.5, 120 + (i % 13) * 14, 2.7 + k * 2.6, EDGE + 60 + Math.floor(i / 13) * 8 + rnd(-0.3, 0.3), pick(cc));
  for (let i = 0; i < 4; i++) { const x = 140 + i * 60, z = EDGE + 130; add(2, 40, 2, x - 8, 20, z - 8, '#d35400'); add(2, 40, 2, x + 8, 20, z - 8, '#d35400'); add(2, 40, 2, x - 8, 20, z + 8, '#d35400'); add(2, 40, 2, x + 8, 20, z + 8, '#d35400'); add(20, 3, 60, x, 41, z + 14, '#e67e22'); }
  const m = new THREE.Mesh(mergeGeometries(geos), M.vcol); m.castShadow = m.receiveShadow = true; scene.add(m);
  // Vinewood-Schriftzug auf den Hügeln
  const t = canvasTex(2048, 256, c => { c.clearRect(0, 0, 2048, 256); c.fillStyle = '#ffffff'; c.font = 'bold 230px Arial Black, Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('VINEWOOD', 1024, 140); });
  const sx = -260, sz = -EDGE - 420, sy = terrainH(sx, sz) + 14;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(150, 19), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }));
  sign.position.set(sx, sy, sz); sign.rotation.x = -0.25; sign.castShadow = true; scene.add(sign);
}
let WHEEL = null;
function buildMarkings() {
  const pos = [], idx = [];
  const quad = (x, z, w, d, y = 0.03) => {
    const n = pos.length / 3;
    pos.push(x - w / 2, y, z - d / 2, x + w / 2, y, z - d / 2, x + w / 2, y, z + d / 2, x - w / 2, y, z + d / 2);
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
  };
  const yel = { pos: [], idx: [] };
  const yquad = (x, z, w, d) => {
    const n = yel.pos.length / 3;
    yel.pos.push(x - w / 2, 0.031, z - d / 2, x + w / 2, 0.031, z - d / 2, x + w / 2, 0.031, z + d / 2, x - w / 2, 0.031, z + d / 2);
    yel.idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
  };
  for (let k = 0; k <= N; k++) {
    const rp = roadPos(k);
    for (let b = 0; b < N; b++) {
      const s0 = BLOCK0 + b * P, mid = s0 + B / 2, len = B - 9;
      // Straße entlang z (x = rp) und entlang x (z = rp)
      yquad(rp - 0.18, mid, 0.14, len); yquad(rp + 0.18, mid, 0.14, len);
      yquad(mid, rp - 0.18, len, 0.14); yquad(mid, rp + 0.18, len, 0.14);
      for (const o of [-5.4, 5.4]) {
        for (let t = 0; t < len; t += 4) { quad(rp + o, s0 + 4.5 + t + 1, 0.12, 2); quad(s0 + 4.5 + t + 1, rp + o, 2, 0.12); }
      }
    }
    // Zebrastreifen
    for (let k2 = 0; k2 <= N; k2++) {
      const ix = roadPos(k), iz = roadPos(k2);
      for (let s = -7; s <= 7; s += 1.25) {
        quad(ix + s, iz - R / 2 - 2.2, 0.6, 3); quad(ix + s, iz + R / 2 + 2.2, 0.6, 3);
        quad(ix - R / 2 - 2.2, iz + s, 3, 0.6); quad(ix + R / 2 + 2.2, iz + s, 3, 0.6);
      }
    }
  }
  const mk = (p, i, color) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(i); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true; scene.add(m);
  };
  mk(pos, idx, 0xdedede); mk(yel.pos, yel.idx, 0xe0b62a);
}

function palmGeo(lean, fronds) {
  const parts = []; let x = 0, y = 0, ang = 0;
  for (let k = 0; k < 9; k++) {
    const r0 = 0.21 - k * 0.009, seg = new THREE.CylinderGeometry(r0 - 0.012, r0, 1.06, 6, 1, true);
    seg.translate(0, 0.52, 0); seg.rotateZ(-ang); seg.translate(x, y, 0); parts.push(colorize(seg, k % 2 ? '#7d6448' : '#8f7556'));
    x += Math.sin(ang); y += Math.cos(ang); ang += lean;
  }
  for (let f = 0; f < fronds; f++) {
    const fr = new THREE.PlaneGeometry(1.0, 1, 1, 5), p = fr.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) + 0.5, wd = p.getX(i) * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1.15 - t * 0.5);
      p.setXYZ(i, wd, Math.sin(t * Math.PI * 0.55) * 1.1 - t * t * 2.7, 4.2 * t);
    }
    fr.computeVertexNormals(); fr.rotateY(f / fronds * Math.PI * 2 + rnd(-0.2, 0.2)); fr.translate(x, y, 0);
    parts.push(colorize(fr, pick(['#3f6e2a', '#4a7a30', '#5a8a38', '#3a5f28', '#6a8a3a'])));
  }
  parts.push(colorize(new THREE.SphereGeometry(0.32, 6, 4).translate(x, y - 0.2, 0), '#5a4a2a'));
  return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
}
// Ampeln an allen Kreuzungen
function buildTrafficLights() {
  const dummy = new THREE.Object3D(), spots = [];
  for (let kx = 0; kx <= N; kx++) for (let kz = 0; kz <= N; kz++) {
    const x = roadPos(kx), z = roadPos(kz);
    for (const [sx, sz, rot] of [[1, 1, 0], [-1, -1, Math.PI], [1, -1, Math.PI / 2], [-1, 1, -Math.PI / 2]]) {
      const px = x + sx * (R / 2 + 0.7), pz = z + sz * (R / 2 + 0.7);
      if (Math.abs(px) > EXT || Math.abs(pz) > EXT) continue;
      spots.push([px, pz, rot, kx, kz]);
    }
  }
  const poleG = new THREE.CylinderGeometry(0.08, 0.1, 4.6, 6); poleG.translate(0, 2.3, 0);
  const headG = new THREE.BoxGeometry(0.35, 1.0, 0.3); headG.translate(0, 4.2, 0.15);
  const lampG = new THREE.SphereGeometry(0.1, 6, 4); lampG.translate(0, 4.2, 0.32);
  const pole = new THREE.InstancedMesh(poleG, mat('#2d3035', { metalness: 0.5, roughness: 0.5 }), spots.length);
  const head = new THREE.InstancedMesh(headG, mat('#1e2024'), spots.length);
  const lampM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2, toneMapped: true });
  const lamp = new THREE.InstancedMesh(lampG, lampM, spots.length * 2);
  const red = new THREE.Color(0xff2a1a), green = new THREE.Color(0x2aff6a), dark = new THREE.Color(0x111111);
  spots.forEach(([x, z, rot, kx, kz], i) => {
    dummy.position.set(x, 0.2, z); dummy.rotation.set(0, rot, 0); dummy.updateMatrix(); pole.setMatrixAt(i, dummy.matrix); head.setMatrixAt(i, dummy.matrix);
    dummy.position.y = 0.2 + 0.3; dummy.updateMatrix(); lamp.setMatrixAt(i * 2, dummy.matrix); lamp.setColorAt(i * 2, red);
    dummy.position.y = 0.2 - 0.3; dummy.updateMatrix(); lamp.setMatrixAt(i * 2 + 1, dummy.matrix); lamp.setColorAt(i * 2 + 1, dark);
    const so = addSolid(x - 0.12, x + 0.12, z - 0.12, z + 0.12, 4.6);
    addKnock({ kind: 'tl', x, z, rot, h: 4.6, so, inst: [[pole, i, 0], [head, i, 0], [lamp, i * 2, 0.3], [lamp, i * 2 + 1, -0.3]] });
    SIG.spots.push({ i, kx, kz, axis: Math.abs(Math.sin(rot)) < 0.5 ? 'z' : 'x' });
  });
  SIG.lamp = lamp; SIG.red = red; SIG.green = green; SIG.dark = dark; SIG.yellow = new THREE.Color(0xffb020);
  pole.castShadow = true; scene.add(pole, head, lamp);
}
function buildProps() {
  buildTrafficLights();
  const dummy = new THREE.Object3D();
  // Bäume
  // Palmen (zwei Varianten) – typisch Los Santos
  const palms = trees.filter(t => t[3]); const leafy = trees.filter(t => !t[3]);
  const palmVariants = [palmGeo(0.035, 11), palmGeo(0.07, 9)];
  palmVariants.forEach((pg, v) => {
    const list = palms.filter((_, k) => k % 2 === v); if (!list.length) return;
    const im = new THREE.InstancedMesh(pg, M.palm, list.length);
    list.forEach(([x, z, s], i) => { dummy.position.set(x, groundH(x, z), z); dummy.rotation.set(0, Math.random() * 6.28, 0); dummy.scale.setScalar(s * rnd(0.85, 1.2)); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); addSolid(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 9); });
    im.castShadow = true; scene.add(im);
  });
  trees.length = 0; trees.push(...leafy);
  const trunkG = new THREE.CylinderGeometry(0.16, 0.24, 3, 7); trunkG.translate(0, 1.5, 0);
  const leafG = new THREE.IcosahedronGeometry(2.1, 3); { const p = leafG.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (Math.sin(p.getX(i) * 3.1) * Math.cos(p.getZ(i) * 2.7) + Math.sin(p.getY(i) * 4.3)) * 0.07; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k); } leafG.computeVertexNormals(); } leafG.translate(0, 4.4, 0);
  const trunk = new THREE.InstancedMesh(trunkG, mat('#5a4030'), trees.length);
  const leaf = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), trees.length);
  const col = new THREE.Color();
  trees.forEach(([x, z, s], i) => {
    const y = groundH(x, z);
    dummy.position.set(x, y, z); dummy.rotation.set(0, Math.random() * 6, 0); dummy.scale.set(s, s * rnd(0.9, 1.2), s); dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix); leaf.setMatrixAt(i, dummy.matrix);
    leaf.setColorAt(i, col.setHSL(rnd(0.22, 0.33), rnd(0.35, 0.55), rnd(0.2, 0.32)));
    addSolid(x - 0.3, x + 0.3, z - 0.3, z + 0.3, 6);
  });
  trunk.castShadow = leaf.castShadow = true; leaf.receiveShadow = true;
  scene.add(trunk, leaf);
  // Laternen
  const poleG = new THREE.CylinderGeometry(0.07, 0.11, 7, 6); poleG.translate(0, 3.5, 0);
  const headG = new THREE.BoxGeometry(0.4, 0.15, 1.6); headG.translate(0, 7, 0.7);
  const pole = new THREE.InstancedMesh(poleG, mat('#3c3f44', { metalness: 0.6, roughness: 0.4 }), lamps.length);
  const head = new THREE.InstancedMesh(headG, M.lampHead, lamps.length);
  const glowG = new THREE.PlaneGeometry(13, 13); glowG.rotateX(-Math.PI / 2);
  lampGlow = new THREE.InstancedMesh(glowG, new THREE.MeshBasicMaterial({ map: TEX.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }), lamps.length);
  lamps.forEach(([x, z, side], i) => {
    const rot = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][side];
    dummy.position.set(x, 0.2, z); dummy.rotation.set(0, rot, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    pole.setMatrixAt(i, dummy.matrix); head.setMatrixAt(i, dummy.matrix);
    const f = DIRS[side];
    dummy.position.set(x + f[0] * 2.2, 0.06, z + f[1] * 2.2); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    lampGlow.setMatrixAt(i, dummy.matrix);
    const so = addSolid(x - 0.15, x + 0.15, z - 0.15, z + 0.15, 7);
    addKnock({ kind: 'lamp', x, z, rot, h: 7, so, inst: [[pole, i, 0], [head, i, 0]], glow: i });
  });
  pole.castShadow = true;
  scene.add(pole, head, lampGlow);
  // Hydranten & Getränkeautomaten am Bordstein
  const hyd = [], vend = [];
  lamps.forEach(([x, z, side], i) => {
    const f = DIRS[side], t = [Math.abs(f[1]), Math.abs(f[0])];
    if (i % 3 === 1 && Math.random() < 0.55) hyd.push([x + t[0] * 3.2, z + t[1] * 3.2]);
    if (i % 9 === 4 && Math.random() < 0.6) vend.push([x - t[0] * 2.4 - f[0] * 0.55, z - t[1] * 2.4 - f[1] * 0.55, f, Math.random() < 0.5 ? 'Sprunk' : 'eCola']);
  });
  const hG = mergeGeometries([new THREE.CylinderGeometry(0.15, 0.17, 0.62, 7).translate(0, 0.31, 0), new THREE.SphereGeometry(0.15, 7, 4).translate(0, 0.62, 0), new THREE.CylinderGeometry(0.06, 0.06, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 0.42, 0)].map(g => g.index ? g.toNonIndexed() : g));
  const hM = new THREE.InstancedMesh(hG, mat('#b8261c', { roughness: 0.5, metalness: 0.3 }), Math.max(1, hyd.length));
  hyd.forEach(([x, z], k) => { dummy.position.set(x, 0.2, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); hM.setMatrixAt(k, dummy.matrix); const so = addSolid(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 0.8); addKnock({ kind: 'hyd', x, z, rot: 0, h: 0.8, so, inst: [[hM, k, 0]] }); });
  hM.count = hyd.length; hM.castShadow = true; scene.add(hM);
  // Baustellen: Reihen echter Leitkegel am Fahrbahnrand
  for (let k = 0; k < 14; k++) {
    const alongZ = Math.random() < 0.5, kr = rint(1, N - 1), seg = rint(0, N - 1), base = roadPos(seg) + R / 2 + rnd(12, 40), lat = roadPos(kr) + (Math.random() < 0.5 ? -1 : 1) * 5.6;
    for (let q = 0; q < 6; q++) {
      const x = alongZ ? lat : base + q * 2.2, z = alongZ ? base + q * 2.2 : lat, mi = modelInstance('TrafficCone', 0.7, 'y'); if (!mi) break;
      mi.matrixAutoUpdate = false; scene.add(mi); addKnock({ kind: 'cone', x, z, rot: rnd(0, 6), h: 0.7, so: null, inst: [], obj: mi }); syncKnock(KNOCK[KNOCK.length - 1]);
    }
  }
  for (const brand of ['Sprunk', 'eCola']) {
    const list = vend.filter(v => v[3] === brand); if (!list.length) continue;
    const ft = vendTex(brand), side = mat(brand === 'Sprunk' ? '#1f8f3a' : '#b3121a', { roughness: 0.4, metalness: 0.2 });
    const front = new THREE.MeshStandardMaterial({ map: ft, emissive: 0xffffff, emissiveMap: ft, emissiveIntensity: 0.35, roughness: 0.3 }); ADMATS.push(front);
    const vg = new THREE.BoxGeometry(0.95, 1.9, 0.75); vg.translate(0, 0.95, 0);
    const im = new THREE.InstancedMesh(vg, [side, side, side, side, front, side], list.length);
    list.forEach(([x, z, f], k) => {
      dummy.position.set(x, 0.2, z); dummy.rotation.set(0, Math.atan2(f[0], f[1]), 0); dummy.updateMatrix(); im.setMatrixAt(k, dummy.matrix);
      const hw = f[0] ? 0.38 : 0.48, hd = f[0] ? 0.48 : 0.38; addSolid(x - hw, x + hw, z - hd, z + hd, 2);
      VENDS.push({ x: x + f[0] * 0.85, z: z + f[1] * 0.85, brand });
    });
    im.castShadow = true; scene.add(im);
  }
}

// ---------- Menschen (Modelle & Animationen in humans.js) ----------
const SKIN_T = ['#ffffff', '#f2dccb', '#e0bc9c', '#b8876a', '#8a5a40', '#6a4030'];
const HAIR = ['#120c08', '#2a1c12', '#4a3322', '#7a5a36', '#b8975e', '#2b2b2b', '#6a6a6a'];
const CLOTH = ['#b03a2e', '#2e86c1', '#28b463', '#f1c40f', '#7d3c98', '#e67e22', '#ecf0f1', '#17202a', '#566573', '#a04000', '#1abc9c', '#d98880', '#34495e', '#c0b283'];
const OFFICE = ['#f4f6f8', '#cfe0f2', '#e8e2d4', '#2f3a4a', '#9fb7c9', '#ffffff'];
const PANTS = ['#1f2a44', '#2b2b2b', '#5d4e3a', '#3f4a3c', '#7a7a7a', '#14213d', '#4a5d7a', '#c2b59b'];
const FEM_T = ['#ffffff', '#f0e6dc', '#e6d8ff', '#d8f0e6', '#ffe2d0', '#d0dcf0'];
const MALE_V = ['pm_young', 'pm_old', 'pm_brisk'], FEM_V = ['f_recep', 'f_young', 'f_eva'];
function pedLook(office = false) {
  if (Math.random() < 0.45) return { gender: 'f', tint: pick(FEM_T) };
  return { gender: 'm', skin: pick(SKIN_T), shirt: pick(office ? OFFICE : CLOTH), pants: pick(PANTS), shoes: pick(['#ffffff', '#3a3a3a', '#8a6a4a', '#c0c0c0']), hair: pick(HAIR), beard: Math.random(), hairStyle: pick(['buzz', 'buzz', 'slick', 'bald']), hat: Math.random() < 0.2 ? pick(['#3a2a1c', '#222222', '#c8a070']) : null };
}
const officeLook = () => pedLook(true);
const voiceFor = L => L.gender === 'f' ? [pick(FEM_V), rnd(0.96, 1.05)] : [pick(MALE_V), rnd(0.95, 1.05)];
function buildFacePool() {}

// ---------- Cars ----------
const carGeoCache = {};
// Monotone kubische Interpolation (Fritsch-Carlson) durch (x, y)-Punkte: glatte Profillinien ohne Überschwingen
function cgProfile(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return z => {
    if (z <= xs[0]) return ys[0]; if (z >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (z > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (z - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
// Gitter-Fläche aus fn(i, j) -> [x, y, z]; wrap schließt die j-Richtung (Querschnittsring) mit gemeinsamen Vertices
function cgGrid(nu, nv, fn, wrap = false) {
  const nc = wrap ? nv : nv + 1, pos = new Float32Array((nu + 1) * nc * 3), idx = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j < nc; j++) pos.set(fn(i, j), (i * nc + j) * 3);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const j1 = wrap ? (j + 1) % nv : j + 1, a = i * nc + j, b = i * nc + j1, c = (i + 1) * nc + j, d = (i + 1) * nc + j1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
// Flächenorientierung: Normalen zeigen von der Referenzachse weg (sign = 1) oder zu ihr hin (sign = -1)
function cgOrient(g, ref, sign = 1) {
  const p = g.attributes.position.array, ix = g.index.array; let s = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3, r = ref(cx, cy, cz);
    s += (uy * vz - uz * vy) * (cx - r[0]) + (uz * vx - ux * vz) * (cy - r[1]) + (ux * vy - uy * vx) * (cz - r[2]);
  }
  if (s * sign < 0) { for (let t = 0; t < ix.length; t += 3) { const q = ix[t + 1]; ix[t + 1] = ix[t + 2]; ix[t + 2] = q; } g.computeVertexNormals(); }
  return g;
}
const cgAxis = cy => (x, y, z) => [0, cy, z];
function cgOffset(g, d) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * d, p.getY(i) + n.getY(i) * d, p.getZ(i) + n.getZ(i) * d);
  return g;
}
const cgPatch = (surf, a0, a1, b0, b1, na, nb, off, cy = 0.8) => cgOffset(cgOrient(cgGrid(na, nb, (i, j) => surf(a0 + (a1 - a0) * i / na, b0 + (b1 - b0) * j / nb)), cgAxis(cy)), off);
// Band entlang einer Kurve (a, b)-Punkte auf der Fläche surf, mit Breite hw0..hw1 und Abhebung off
function cgRibbon(surf, pts, hw0, hw1, off, cy = 0.8) {
  const n = pts.length - 1, P = pts.map(([a, b]) => surf(a, b)), e = 1e-3;
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], cr = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const nz = v => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const g = cgGrid(n, 1, (i, j) => {
    const [a, b] = pts[i], p = P[i], t = sub(P[Math.min(n, i + 1)], P[Math.max(0, i - 1)]);
    let nn = nz(cr(sub(surf(a + e, b), surf(a - e, b)), sub(surf(a, b + e), surf(a, b - e))));
    if (nn[0] * p[0] + nn[1] * (p[1] - cy) < 0) nn = [-nn[0], -nn[1], -nn[2]];
    const bn = nz(cr(t, nn)), w = (hw0 + (hw1 - hw0) * i / n) * (j ? 1 : -1);
    return [p[0] + bn[0] * w + nn[0] * off, p[1] + bn[1] * w + nn[1] * off, p[2] + bn[2] * w + nn[2] * off];
  });
  return cgOrient(g, cgAxis(cy));
}
// Quader (ohne UV) mit Vertexfarbe, optional gedreht
function cgBox(w, h, d, x, y, z, col, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d); g.deleteAttribute('uv');
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z); return col ? colorize(g, col) : g;
}
// flaches Polygon (x, y) in der Ebene z; dir > 0 schaut nach +z, dir < 0 nach -z (Heckseite)
function cgPoly(pts, z, dir, col) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ShapeGeometry(s); g.deleteAttribute('uv');
  if (dir < 0) g.rotateY(Math.PI);
  g.translate(0, 0, z); return col ? colorize(g, col) : g;
}
const cgMirrorPts = pts => pts.map(([x, y]) => [-x, y]).reverse();
function cgFin(list) { const g = mergeGeometries(list.filter(Boolean)); return g; }

// Fahrzeugdaten: Dachlinie (Anteil der Länge von hinten, Höhe) und Kabine (hood = Haubenlänge, run = Länge der Frontscheibe,
// zrr = Ende des Dachs von hinten, rrun = Länge der Heckscheibe, roof = Dachhöhe, wc = Kabinenbreite)
const CG_SPEC = {
  sedan: { top: [[0, .9], [.03, .93], [.1, .96], [.22, .985], [.5, .99], [.72, .99], [.78, .985], [.86, .94], [.94, .88], [1, .82]], hood: 1.25, run: .8, zrr: 1.45, rrun: .6, roof: 1.45, wc: .86, rear: true },
  coupe: { top: [[0, .86], [.04, .9], [.12, .93], [.3, .94], [.5, .94], [.66, .935], [.74, .9], [.83, .87], [.93, .84], [1, .78]], hood: 1.3, run: .8, zrr: 1.45, rrun: .9, roof: 1.36, wc: .84, rear: true, sporty: true, cw: .11 },
  muscle: { top: [[0, .9], [.04, .94], [.12, .97], [.3, .98], [.5, .98], [.6, .975], [.7, .95], [.85, .92], [1, .84]], hood: 1.4, run: .85, zrr: 1.55, rrun: .8, roof: 1.38, wc: .84, rear: true, sporty: true, cw: .11, scoop: true },
  suv: { top: [[0, .98], [.03, 1.08], [.08, 1.12], [.3, 1.13], [.6, 1.13], [.76, 1.12], [.84, 1.06], [.93, 1.0], [1, .93]], hood: 1.1, run: .65, zrr: .5, rrun: .25, roof: 1.78, wc: .86, rear: true, rack: true, cw: .2, tail: [.66, .92] },
  compact: { top: [[0, .95], [.04, 1.0], [.1, 1.03], [.3, 1.04], [.62, 1.04], [.76, 1.02], [.86, .96], [.94, .9], [1, .85]], hood: 1.0, run: .55, zrr: .5, rrun: .3, roof: 1.52, wc: .86, rear: true, cw: .12, tail: [.7, .95] },
  limo: { top: [[0, .92], [.03, .95], [.1, .98], [.2, .99], [.62, .99], [.77, .985], [.85, .95], [.93, .9], [1, .84]], hood: 1.25, run: .8, zrr: 1.7, rrun: .6, roof: 1.45, wc: .86, rear: true },
  pickup: { top: [[0, 1.02], [.03, 1.06], [.08, 1.07], [.5, 1.07], [.62, 1.07], [.74, 1.06], [.86, 1.0], [.94, .95], [1, .9]], hood: 1.35, run: .7, zrr: 2.65, rrun: .15, roof: 1.78, wc: .86, rear: true, tail: [.78, .98],
    bed: { z0: .12, z1: 2.4, floor: .86, lip: .12 } },
  van: { top: [[0, 1.6], [.02, 1.86], [.06, 1.96], [.5, 1.97], [.54, 1.96], [.575, 1.15], [.7, 1.1], [.8, 1.06], [.9, 1.0], [.96, .95], [1, .88]], hood: .8, run: .85, zrr: 2.9, rrun: .05, roof: 1.97, wc: .92, tail: [.95, 1.45], bulk: true },
  police: { top: [[0, .9], [.03, .93], [.1, .96], [.22, .985], [.5, .99], [.72, .99], [.78, .985], [.86, .94], [.94, .88], [1, .82]], hood: 1.25, run: .8, zrr: 1.45, rrun: .6, roof: 1.45, wc: .86, rear: true, cop: true },
  convertible: { top: [[0, .88], [.04, .93], [.12, .96], [.2, .97], [.5, .96], [.7, .95], [.76, .94], [.85, .9], [.93, .86], [1, .8]], hood: 1.25, open: true, rear: true, sporty: true },
};

function carGeos(L, W, hs, kind = 'sedan') {
  const key = L + '_' + W + '_' + hs + kind; if (carGeoCache[key]) return carGeoCache[key];
  const S = CG_SPEC[kind] || CG_SPEC.sedan, hw = W / 2, K = 24, M = 12, ex = 2 / 4.5, exl = 2 / 6, tuck = 0.07;
  const top = cgProfile(S.top.map(([f, y]) => [f * L, y]));
  // ---- Kabine (Glashaus) ----
  const zf0 = L - S.hood, zfr = zf0 - (S.run || 0.5), zrr = S.zrr || 1, zr0 = zrr - (S.rrun || 0.3);
  const hasCab = !S.open, belt = hasCab ? top((zr0 + zf0) / 2) : top(zf0), B = belt - 0.06, Hh = (S.roof || 1.4) - B;
  const s1 = zrr - zr0, s2 = zf0 - zfr;
  const roofF = hasCab ? cgProfile([[zr0, 0], [zr0 + .5 * s1, .5], [zr0 + .85 * s1, .89], [zrr, 1], [(zrr + zfr) / 2, 1], [zfr, 1], [zfr + .15 * s2, .89], [zfr + .5 * s2, .5], [zf0, 0]]) : null;
  const wcz = z => hw * S.wc * (0.8 + 0.2 * Math.sqrt(Math.max(0, Math.min(1, roofF(z)))));
  const nc = 2 / 3.2;
  const cabPt = (z, th) => {
    const c = Math.cos(th), s = Math.sin(th), v = Math.pow(Math.max(s, 0), nc), u = Math.pow(Math.abs(c), nc) * Math.sign(c), H = Math.max(0, roofF(z)) * Hh;
    return [wcz(z) * u * (1 - 0.1 * v * v), B + H * v, z];
  };
  // ---- Offene Bereiche (Innenraum, Pritsche, Cockpit) ----
  const regs = [];
  if (hasCab) regs.push({ z0: zr0, z1: zf0, floor: 0.46, xin: z => wcz(z), col: '#1d1e22' });
  if (S.open) regs.push({ z0: L * 0.2, z1: zf0 - 0.02, floor: 0.46, xin: () => hw - 0.1, col: '#1d1e22' });
  if (S.bed) regs.push({ z0: S.bed.z0, z1: S.bed.z1, floor: S.bed.floor, xin: () => hw - S.bed.lip, col: '#2a2b2e' });
  // ---- Karosserie-Querschnitte ----
  const wheelZ = [0.88, L - 0.88];
  const par = z => {
    const d = Math.min(z, L - z), cap = z < L / 2 ? 0.5 : 0.55, fe = 0.78;
    let f = 1; if (d < cap) { const t = 1 - d / cap; f = fe + (1 - fe) * Math.sqrt(Math.max(0, 1 - t * t)); }
    let y0 = 0.3 + 0.09 * (1 - smooth(0, 0.7, d));
    for (const zw of wheelZ) { const dz = Math.abs(z - zw); if (dz < 0.45) y0 = Math.max(y0, 0.3 + Math.sqrt(0.2025 - dz * dz)); }
    const y1 = Math.max(top(z), y0 + 0.14); let o = 0, rg = null;
    for (const r of regs) { const q = smooth(r.z0, r.z0 + 0.1, z) * (1 - smooth(r.z1 - 0.1, r.z1, z)); if (q > o) { o = q; rg = r; } }
    return { w: hw * f, f, y0, y1, yc: (y0 + y1) / 2, hh: (y1 - y0) / 2 * f, o, rg };
  };
  const ring = z => {
    const p = par(z), pts = [];
    for (let j = 0; j < K; j++) {
      let x, y;
      if (j <= M) {
        const th = Math.PI * j / M, c = Math.cos(th), s = Math.sin(th), u = Math.pow(Math.abs(c), ex) * Math.sign(c), v = Math.pow(s, ex);
        x = p.w * u * (1 - tuck * v * v); y = p.yc + p.hh * v + 0.025 * p.f * (1 - u * u) * v;
        if (p.o > 0 && j >= 3 && j <= M - 3) {
          const jj = j <= 6 ? j : M - j, xo = p.w * 0.9, xi = Math.min(p.rg.xin(z), xo - 0.05), yt = p.y1, yf = p.rg.floor;
          const U = jj === 3 ? [xo, yt] : jj === 4 ? [xi + 0.012, yt] : jj === 5 ? [xi - 0.01, yf] : [0, yf];
          const ux = j <= 6 ? U[0] : -U[0];
          x += (ux - x) * p.o; y += (U[1] - y) * p.o;
        }
      } else {
        const th = Math.PI * (1 + (j - M) / M), c = Math.cos(th), s = Math.sin(th);
        x = p.w * Math.pow(Math.abs(c), exl) * Math.sign(c); y = p.yc - p.hh * Math.pow(-s, exl);
      }
      pts.push([x, y]);
    }
    return pts;
  };
  // x der Seitenwand in der Höhe y (für Türen, Schweller)
  const sideX = (z, y) => {
    const p = par(z), u = Math.max(-0.999, Math.min(0.999, (y - p.yc) / p.hh)), n = u >= 0 ? 4.5 : 6, v = Math.abs(u);
    return p.w * Math.pow(1 - Math.pow(v, n), 1 / n) * (u > 0 ? 1 - tuck * v * v : 1);
  };
  const bodyPt = (z, th) => {
    const p = par(z), c = Math.cos(th), s = Math.sin(th), e = s >= 0 ? ex : exl, v = Math.pow(Math.abs(s), e), u = Math.pow(Math.abs(c), e) * Math.sign(c);
    return [p.w * u * (s > 0 ? 1 - tuck * v * v : 1), p.yc + (s >= 0 ? 1 : -1) * p.hh * v, z];
  };
  // Stationen: gerundete Enden, Radhäuser, Öffnungsgrenzen, Gleichmäßiges
  const zset = [];
  for (let k = 0; k <= 6; k++) { const a = Math.PI / 2 * k / 6; zset.push(0.5 * (1 - Math.cos(a)), L - 0.55 * (1 - Math.cos(a))); }
  for (const zw of wheelZ) for (let k = -4; k <= 4; k++) zset.push(zw + 0.45 * Math.sin(Math.PI / 2 * k / 4));
  for (const r of regs) zset.push(r.z0, r.z0 + 0.05, r.z0 + 0.1, r.z1 - 0.1, r.z1 - 0.05, r.z1);
  for (let z = 0.8; z < L - 0.8; z += 0.45) zset.push(z);
  const zs = zset.filter(z => z >= 0 && z <= L).sort((a, b) => a - b).filter((z, i, a) => i === 0 || z - a[i - 1] > 0.015);
  const rings = zs.map(ring);
  const bodyG = cgGrid(zs.length - 1, K, (i, j) => [rings[i][j][0], rings[i][j][1], zs[i]], true);
  const cap = (r, z, dir) => {
    const n = r.length, pos = new Float32Array((n + 1) * 3), nor = new Float32Array((n + 1) * 3), idx = []; let cy = 0, cx = 0;
    r.forEach(([x, y], j) => { pos.set([x, y, z], j * 3); cy += y / n; cx += x / n; nor.set([0, 0, dir], j * 3); });
    pos.set([cx, cy, z], n * 3); nor.set([0, 0, dir], n * 3);
    for (let j = 0; j < n; j++) dir > 0 ? idx.push(n, j, (j + 1) % n) : idx.push(n, (j + 1) % n, j);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx); return g;
  };
  const paintParts = [bodyG, cap(rings[0], 0, -1), cap(rings[zs.length - 1], L, 1)];
  const glassParts = [], D = [], headP = [], tailP = [];

  // ---- Kabine: Glasschale + Lackteile (Dach, Säulen) ----
  if (hasCab) {
    const zl = []; for (let k = 0; k <= 7; k++) zl.push(zr0 + s1 * k / 7); for (let k = 1; k <= 3; k++) zl.push(zrr + (zfr - zrr) * k / 4); for (let k = 0; k <= 7; k++) zl.push(zfr + s2 * k / 7);
    const zc = zl.filter((z, i, a) => i === 0 || z - a[i - 1] > 0.01);
    glassParts.push(cgOrient(cgGrid(zc.length - 1, M, (i, j) => cabPt(zc[i], Math.PI * j / M)), cgAxis(0.6)));
    const roofTh = 0.95, off = 0.008;
    paintParts.push(cgPatch(cabPt, Math.max(zr0 + 0.02, zrr - 0.07), zfr + 0.07, roofTh, Math.PI - roofTh, 10, 8, off));
    const zB = zf0 - 1.1 - 0.06, pil = (pp, w0, w1) => {
      const pts = []; for (let k = 0; k < pp.length - 1; k++) for (let q = 0; q < 4; q++) pts.push([pp[k][0] + (pp[k + 1][0] - pp[k][0]) * q / 4, pp[k][1] + (pp[k + 1][1] - pp[k][1]) * q / 4]); pts.push(pp[pp.length - 1]);
      for (const m of [0, 1]) { const surf = m ? (a, b) => cabPt(a, Math.PI - b) : cabPt; paintParts.push(cgRibbon(surf, pts, w0, w1, off)); }
    };
    pil([[zf0 - 0.02, 0.1], [zf0 - s2 * 0.45, 0.4], [zfr + 0.04, roofTh + 0.05]], 0.045, 0.04);      // A-Säule
    pil([[zr0 + 0.02, 0.1], [zr0 + s1 * 0.45, 0.4], [zrr - 0.04, roofTh + 0.05]], S.cw || 0.07, (S.cw || 0.07) * 0.9);          // C-Säule
    if (zB > zrr + 0.3) pil([[zB, 0.05], [zB, 0.5], [zB, roofTh + 0.05]], 0.05, 0.045);             // B-Säule
    // Seitliche Dachkante (Regenleiste)
    pil([[zrr - 0.04, roofTh + 0.02], [(zrr + zfr) / 2, roofTh + 0.02], [zfr + 0.04, roofTh + 0.02]], 0.03, 0.03);
    if (S.rack) { for (const sx of [1, -1]) D.push(cgBox(0.045, 0.04, zfr - zrr - 0.3, sx * (hw * S.wc * 0.62), S.roof + 0.03, (zrr + zfr) / 2, '#2a2b2e')); for (const zz of [zrr + 0.45, (zrr + zfr) / 2, zfr - 0.45]) D.push(cgBox(hw * S.wc * 1.28, 0.03, 0.04, 0, S.roof + 0.06, zz, '#2a2b2e')); }
  }
  // ---- Cabrio: Frontscheibe + Rahmen ----
  let windshield = null;
  if (S.open) {
    const zb = zf0 - 0.02, zt = zb - 0.5, yb = top(zb) - 0.02, yt = yb + 0.34, wb = hw - 0.1, wt = hw - 0.17;
    const gp = [[wb, yb, zb], [wt, yt, zt], [-wt, yt, zt], [-wb, yb, zb]];
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gp.flat()), 3)); gg.setIndex([0, 1, 2, 0, 2, 3]); gg.computeVertexNormals();
    glassParts.push(cgOrient(gg, () => [0, yb - 0.5, zb - 0.8], 1));
    const bar = (a, b) => { const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), g = new THREE.BoxGeometry(0.035, 0.035, len); g.deleteAttribute('uv'); const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(0, 1, 0)); g.applyMatrix4(m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)); return colorize(g, '#c4c7cc'); };
    D.push(bar([wb, yb, zb], [wt, yt, zt]), bar([-wb, yb, zb], [-wt, yt, zt]), bar([wt, yt, zt], [-wt, yt, zt]));
  }
  // ---- Radhäuser, Schweller, Unterboden ----
  for (const zw of wheelZ) for (const sx of [1, -1]) {
    const wg = cgGrid(6, 12, (i, j) => { const a = Math.PI * j / 12, x = sx * (hw - 0.52 + 0.5 * i / 6); return [x, 0.3 + 0.43 * Math.sin(a), zw + 0.43 * Math.cos(a)]; });
    D.push(colorize(cgOrient(wg, (x, y, z) => [x, 0.3, zw], -1), '#17181a'));
  }
  D.push(cgBox(W * 0.6, 0.03, L - 1.5, 0, 0.29, L / 2, '#060607'));
  for (const sx of [1, -1]) {
    const sg = cgPatch((z, th) => { const q = bodyPt(z, th); return sx > 0 ? q : [-q[0], q[1], q[2]]; }, wheelZ[0] + 0.47, wheelZ[1] - 0.47, -1.0, -0.12, 6, 3, 0.014, 0.6);
    D.push(colorize(sg, '#1b1c1f'));
  }
  // ---- Innenraum ----
  for (const r of regs) {
    const zA = r.z0 + 0.05, zZ = r.z1 - 0.05, nz = Math.max(2, Math.round((zZ - zA) / 0.35));
    // Verkleidung: dieselbe U-Form wie die Karosserie, etwas nach innen versetzt
    const lg = cgGrid(nz, 3, (i, j) => {
      const z = zA + (zZ - zA) * i / nz, p = par(z), xo = p.w * 0.9, xi = Math.min(r.xin(z), xo - 0.05) - 0.012, yt = p.y1 - 0.004, yf = r.floor + 0.012;
      const pt = [[xi, yt], [xi - 0.005, yf], [-(xi - 0.005), yf], [-xi, yt]][j];
      return [pt[0], pt[1], z];
    });
    D.push(colorize(cgOrient(lg, (x, y, z) => [0, r.floor + 0.5, z], -1), r.col));
  }
  // Sitze, Armaturenbrett, Lenkrad
  const hz = L - 1.95, seatCol = S.sporty ? '#8a5a38' : '#3a3b41';
  const seat = (x, z, wid = 0.5) => { D.push(cgBox(wid, 0.08, 0.5, x, 0.5, z + 0.05, seatCol), cgBox(wid, 0.56, 0.11, x, 0.78, z - 0.22, seatCol, -0.16), cgBox(0.2, 0.15, 0.09, x, 1.12, z - 0.29, seatCol, -0.16)); };
  if (hasCab || S.open) {
    seat(0.4, hz); seat(-0.4, hz);
    if (S.rear) { if (kind === 'limo') { D.push(cgBox(1.5, 0.08, 0.5, 0, 0.5, hz - 1.45, seatCol), cgBox(1.5, 0.56, 0.11, 0, 0.78, hz - 1.72, seatCol, -0.12)); } else { D.push(cgBox(1.35, 0.08, 0.5, 0, 0.5, hz - 0.85, seatCol), cgBox(1.35, 0.5, 0.11, 0, 0.76, hz - 1.12, seatCol, -0.2)); } }
    const dz = zf0 - 0.17;
    D.push(cgBox(W * 0.8, 0.16, 0.34, 0, 0.8, dz, '#232428'), cgBox(0.4, 0.1, 0.16, 0.4, 0.9, dz - 0.05, '#1a1b1e'), cgBox(0.12, 0.2, 0.5, 0, 0.62, hz + 0.1, '#1d1e22'));
    const sw = new THREE.TorusGeometry(0.17, 0.018, 5, 12); sw.deleteAttribute('uv'); sw.rotateX(-1.0); sw.translate(0.4, 0.95, hz + 0.5); D.push(colorize(sw, '#17181a'));
    D.push(cgBox(0.03, 0.03, 0.3, 0.4, 0.86, hz + 0.64, '#17181a', 0.5));
    if (S.bulk) D.push(cgBox(W * 0.8, 1.0, 0.04, 0, 1.45, zr0 + 0.06, '#1d1e22'));
  }
  if (S.scoop) { const zq = zf0 + 0.55; D.push(cgBox(0.5, 0.05, 0.55, 0, top(zq) + 0.035, zq, '#141517'), cgBox(0.5, 0.035, 0.06, 0, top(zq) + 0.06, zq + 0.28, '#141517', -0.5)); }
  // ---- Front / Heck ----
  const fF = par(L), fR = par(0);
  const face = (p, rear) => {
    const zz = rear ? -0.006 : L + 0.006, place = (g, dz) => { if (rear) g.rotateY(Math.PI); g.translate(0, 0, zz + (rear ? -dz : dz)); return g; };
    return { poly: (pts, col, dz = 0) => place(cgPoly(pts, 0, 1, col), dz) };
  };
  const ff = face(fF, false), fr = face(fR, true);
  // Scheinwerfer + Rahmen
  const hy = fF.yc + fF.hh * 0.05, hl = [[0.42 * fF.w, hy], [0.9 * fF.w, hy + fF.hh * 0.12], [0.92 * fF.w, hy + fF.hh * 0.7], [0.5 * fF.w, hy + fF.hh * 0.5]];
  headP.push(ff.poly(hl, null, 0.004), ff.poly(cgMirrorPts(hl), null, 0.004));
  const bz = pts => pts.map(([x, y]) => [x * 1.04, y + (y > hy + fF.hh * 0.3 ? 0.014 : -0.014)]);
  D.push(ff.poly(bz(hl), '#222326'), ff.poly(cgMirrorPts(bz(hl)), '#222326'));
  // Kühlergrill + Lufteinlass + Kennzeichen
  const gy0 = fF.yc - fF.hh * 0.1, gy1 = fF.yc + fF.hh * 0.55, gx = 0.34 * fF.w;
  D.push(cgBox(gx * 2, gy1 - gy0, 0.025, 0, (gy0 + gy1) / 2, L + 0.012, '#141517'));
  for (let k = 0; k < 3; k++) D.push(cgBox(gx * 2, 0.012, 0.03, 0, gy0 + (gy1 - gy0) * (k + 1) / 4, L + 0.016, '#b9bcc2'));
  D.push(cgBox(gx * 2 + 0.03, 0.018, 0.03, 0, gy1 + 0.005, L + 0.014, '#c4c7cc'), cgBox(gx * 2 + 0.03, 0.018, 0.03, 0, gy0 - 0.005, L + 0.014, '#c4c7cc'));
  D.push(cgBox(fF.w * 1.5, fF.hh * 0.42, 0.03, 0, fF.yc - fF.hh * 0.62, L + 0.01, '#141517'));
  D.push(cgBox(0.54, 0.14, 0.012, 0, fF.yc - fF.hh * 0.55, L + 0.022, '#1a1a1a'), cgBox(0.5, 0.1, 0.012, 0, fF.yc - fF.hh * 0.55, L + 0.03, '#ecebe4'));
  D.push(cgBox(fF.w * 1.7, 0.05, 0.09, 0, fF.yc - fF.hh + 0.04, L - 0.01, '#141517'));
  // Rücklichter + Kennzeichen + Stoßfänger
  const ty = S.tail ? S.tail : [fR.yc + fR.hh * 0.05, fR.yc + fR.hh * 0.6];
  const tl = [[0.45 * fR.w, ty[0]], [0.93 * fR.w, ty[0] + 0.01], [0.93 * fR.w, ty[1]], [0.5 * fR.w, ty[1] - 0.03]];
  tailP.push(fr.poly(tl, null, 0.004), fr.poly(cgMirrorPts(tl), null, 0.004));
  const tz = pts => pts.map(([x, y]) => [x * 1.04, y + (y > (ty[0] + ty[1]) / 2 ? 0.014 : -0.014)]);
  D.push(fr.poly(tz(tl), '#222326'), fr.poly(cgMirrorPts(tz(tl)), '#222326'));
  const py = Math.min(fR.yc - 0.02, ty[0] - 0.12);
  D.push(cgBox(0.54, 0.14, 0.012, 0, py, -0.052, '#1a1a1a'), cgBox(0.5, 0.1, 0.012, 0, py, -0.06, '#ecebe4'));
  D.push(cgBox(fR.w * 1.7, 0.2, 0.08, 0, fR.yc - fR.hh + 0.13, 0.0, '#141517'));
  if (S.sporty) for (const sx of [1, -1]) { const e = new THREE.CylinderGeometry(0.045, 0.045, 0.14, 8); e.deleteAttribute('uv'); e.rotateX(Math.PI / 2); e.translate(sx * 0.55, 0.36, -0.06); D.push(colorize(e, '#b9bcc2')); }
  if (kind === 'pickup') D.push(cgBox(W - 0.2, 0.03, 0.05, 0, 1.0, 0.02, '#c4c7cc'));

  // ---- Türen (Lackschalen, folgen der Karosserieseite) ----
  const zH = L - 1.25, doors = {};
  for (const sd of [1, -1]) {
    const px = hw - 0.02, nz = 6, ny = 4, y0d = 0.5;
    const yT = z => { const p = par(z); return Math.min(p.yc + 0.66 * p.hh, p.y1 - 0.08); };
    const surf = (i, j, off) => { const z = zH - 1.1 + 1.1 * i / nz, yd = y0d + (yT(z) - y0d) * j / ny; return [sd * (sideX(z, yd) + off - px), yd, z - zH]; };
    const outer = cgGrid(nz, ny, (i, j) => surf(i, j, 0.012)), inner = cgGrid(nz, ny, (i, j) => surf(i, j, -0.05));
    const ref = () => [-sd * 0.5, 0.72, -0.55];
    cgOrient(outer, ref, 1); cgOrient(inner, ref, -1);
    const edge = (fn, n) => cgOrient(cgGrid(n, 1, (i, j) => fn(i, j)), ref, 1);
    const parts = [outer, inner,
      edge((i, j) => surf(0, i, j ? -0.05 : 0.012), ny), edge((i, j) => surf(nz, ny - i, j ? -0.05 : 0.012), ny),
      edge((i, j) => surf(nz - i, ny, j ? -0.05 : 0.012), nz), edge((i, j) => surf(i, 0, j ? -0.05 : 0.012), nz)];
    // Griff + Spiegel
    const hz2 = zH - 0.9 - zH, hy = yT(zH - 0.9) - 0.1, hx = sd * (sideX(zH - 0.9, hy) + 0.03 - px);
    parts.push(cgBox(0.035, 0.03, 0.17, hx, hy, hz2));
    const my = yT(zH) + 0.1, mz = -0.22, mx = sd * (sideX(zH - 0.22, yT(zH)) + 0.14 - px);
    parts.push(cgBox(0.1, 0.1, 0.17, mx, my, mz), cgBox(0.1, 0.03, 0.05, sd * (sideX(zH - 0.22, yT(zH)) + 0.04 - px), my - 0.04, mz + 0.03));
    doors[sd] = cgFin(parts);
  }
  // ---- Räder ----
  const wheels = cgWheels();
  if (S.cop) {
    for (const sx of [1, -1]) D.push(colorize(cgPatch((z, th) => { const q = bodyPt(z, th); return sx > 0 ? q : [-q[0], q[1], q[2]]; }, zH - 2.35, zH - 1.2, -0.1, 0.6, 5, 4, 0.006, 0.6), '#ececec'));
  }
  const cen = g => g && g.translate(0, 0, -L / 2);
  return carGeoCache[key] = { paint: cen(cgFin(paintParts)), glass: cen(cgFin(glassParts)), detail: cen(cgFin(D)), head: cen(cgFin(headP)), tail: cen(cgFin(tailP)), doors, wheelR: wheels.R, wheelL: wheels.L, top: S.open ? 1.32 : S.roof };
}
let cgWheelCache = null;
function cgWheels() {
  if (cgWheelCache) return cgWheelCache;
  const rs = 0.944, lathe = (pts, seg, col) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r * rs, y)), seg); g.deleteAttribute('uv'); return colorize(g, col); };
  const parts = [
    lathe([[0.225, -0.11], [0.285, -0.125], [0.345, -0.1], [0.36, -0.04], [0.36, 0.04], [0.345, 0.1], [0.285, 0.125], [0.225, 0.11]], 18, '#141414'),
    lathe([[0.215, -0.12], [0.205, -0.02], [0.215, 0.07], [0.235, 0.118]], 18, '#b9bcc2'),
    lathe([[0.215, 0.075], [0.0, 0.075]], 18, '#25272b'),
    lathe([[0.058, 0.09], [0.058, 0.11], [0, 0.115]], 8, '#c4c7cc'),
  ];
  for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5, g = new THREE.BoxGeometry(0.048, 0.026, 0.18); g.deleteAttribute('uv'); g.translate(0, 0.094, 0.125); g.rotateY(a); parts.push(colorize(g, '#c4c7cc')); }
  const base = mergeGeometries(parts), R = base.clone().rotateZ(-Math.PI / 2), Lg = base.clone().rotateZ(Math.PI / 2);
  return cgWheelCache = { R, L: Lg };
}

const CAR_TYPES = {
  sedan: { L: 4.6, W: 1.86, hs: 1, max: 38, acc: 13, kind: 'sedan' }, coupe: { L: 4.4, W: 1.92, hs: 0.86, max: 48, acc: 19, kind: 'coupe' },
  suv: { L: 4.8, W: 2.0, hs: 1.25, max: 34, acc: 11, kind: 'suv' }, compact: { L: 3.9, W: 1.75, hs: 1.05, max: 32, acc: 11, kind: 'compact' },
  police: { L: 4.7, W: 1.9, hs: 1, max: 44, acc: 17, kind: 'police' },
  pickup: { L: 5.3, W: 2.0, hs: 1.2, max: 36, acc: 12, kind: 'pickup' }, van: { L: 5.0, W: 2.0, hs: 1, max: 30, acc: 9, kind: 'van' },
  convertible: { L: 4.5, W: 1.9, hs: 0.9, max: 45, acc: 16, kind: 'convertible' },
  italia: { L: 4.55, W: 1.95, hs: 0.82, max: 60, acc: 25, kind: 'coupe', model: 'ferrari' }, concept: { L: 4.4, W: 2.0, hs: 0.86, max: 55, acc: 22, kind: 'coupe', model: 'CarConcept' }, limo: { L: 6.3, W: 2.0, hs: 1.0, max: 36, acc: 10, kind: 'limo' }, muscle: { L: 4.8, W: 1.96, hs: 0.86, max: 50, acc: 20, kind: 'muscle' },
};
const TRAFFIC_TYPES = ['sedan', 'sedan', 'coupe', 'suv', 'compact', 'compact', 'pickup', 'pickup', 'van', 'convertible', 'muscle', 'suv', 'sedan', 'coupe'];
const CAR_COLORS = ['#b8b8b8', '#1c1c1c', '#f2f2f2', '#7d0f12', '#123d6b', '#2f5233', '#c9a227', '#5c5f63', '#a34a12', '#3a2f5c', '#0f5e63', '#d35d0e', '#d7c9a3', '#9c2a2a', '#e8e0d0', '#2a4a6a', '#556b2f', '#c0392b', '#7a8a9a', '#4a3a2a'];
const cars = [];
// Gemeinsame Materialien für Autoglas (echte Spiegelung + Durchsicht auf den Innenraum) und Details mit Vertexfarben
let cgMatSet = null;
function cgMats() {
  return cgMatSet ||= {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x050a10, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.58, depthWrite: false, envMapIntensity: 1.6, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation, premultipliedAlpha: false }),
    detail: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 }),
  };
}
// Hero-Modelle: nur in Kameranähe (LOD) statt der prozeduralen Karosserie; Lack wird auf die Autofarbe umgefärbt
const CG_HERO = { coupe: 'ferrari', convertible: 'ferrari', muscle: 'ferrari', sedan: 'CarConcept' };
const CG_HERO_MAX = 6, CG_HERO_NEAR = 45, CG_HERO_FAR = 58;
let cgHeroOn = 0;
const cgPaintMats = new Map();
function cgTintModel(mi, name, color) {
  const tc = new THREE.Color(color), hex = tc.getHexString();
  mi.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const src = o.material, ck = name + src.uuid + hex; let m = cgPaintMats.get(ck);
    if (m === undefined) {
      m = null;
      if (name === 'ferrari') {
        // Das Modell hat nur ein Paletten-Material: nur die roten Palettenpixel (Lack) werden auf die Fahrzeugfarbe umgefärbt
        m = src.clone();
        m.onBeforeCompile = sh => { sh.uniforms.uPaint = { value: tc }; sh.fragmentShader = 'uniform vec3 uPaint;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          if (diffuseColor.r > 0.3 && diffuseColor.g < 0.03 && diffuseColor.b < 0.05) diffuseColor.rgb = uPaint * clamp(diffuseColor.r / 0.7, 0.7, 1.1);`); };
        m.customProgramCacheKey = () => 'ferrariPaintU';
      } else if (/^Paint 1/.test(src.name || '')) { m = src.clone(); m.color.copy(tc); }
      cgPaintMats.set(ck, m);
    }
    if (m) o.material = m;
  });
}
function cgSetProc(c, vis) { for (const o of c.procParts) o.visible = vis; for (const d of c.doors) d.pv.visible = vis; for (const w of c.wheels) w.visible = vis; }
// Pro Auto und Frame: Hero-Modell nur für ruhende Autos in Kameranähe und nur bis CG_HERO_MAX gleichzeitig
function cgLod(c, d) {
  const h = c.hero; if (!h) return;
  const calm = c.health > 0 && c.mode !== 'wreck' && !c.ownGeo && !c.taxi && c !== player.car && !c.npcSeq && Math.hypot(c.vx, c.vz) < (h.on ? 3 : 1.5) && c.doors.every(q => q.open === 0 && q.target === 0);
  const want = calm && d < (h.on ? CG_HERO_FAR : CG_HERO_NEAR) && (h.on || cgHeroOn < CG_HERO_MAX);
  if (want && !h.on) {
    if (!h.mi) { h.mi = modelInstance(h.name, c.T.L, 'z'); if (!h.mi) { c.hero = null; return; } cgTintModel(h.mi, h.name, c.color); c.body.add(h.mi); }
    h.mi.visible = true; cgSetProc(c, false); h.on = true; cgHeroOn++;
  } else if (!want && h.on) { h.mi.visible = false; cgSetProc(c, true); h.on = false; cgHeroOn--; }
  if (!h.on && h.mi && d > 120) { c.body.remove(h.mi); h.mi = null; }
}
function makeCar(type, color, x, z, yaw, mode) {
  const T = CAR_TYPES[type], G = carGeos(T.L, T.W, T.hs, T.kind), CM = cgMats();
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const pm = type === 'police' ? paint('#0d0e10') : paint(color);
  const paintMesh = new THREE.Mesh(G.paint, pm), glass = new THREE.Mesh(G.glass, CM.glass), detail = new THREE.Mesh(G.detail, CM.detail);
  paintMesh.castShadow = true; glass.renderOrder = 1;
  body.add(paintMesh, glass, detail, new THREE.Mesh(G.head, M.head), new THREE.Mesh(G.tail, M.tail));
  const procParts = body.children.slice();
  // Vordertüren mit Scharnier (links = Fahrer): Lackschale folgt der Karosserieseite, Griff und Spiegel sind Teil der Tür
  const zh = T.L / 2 - 1.25, doors = [];
  for (const side of [1, -1]) {
    const pv = new THREE.Group(); pv.position.set(side * (T.W / 2 - 0.02), 0, zh); body.add(pv);
    const pnl = new THREE.Mesh(G.doors[side], type === 'police' ? M.white : pm); pnl.castShadow = true; pv.add(pnl);
    doors.push({ pv, side, open: 0, target: 0 });
  }
  const wheels = [];
  for (const [wx, wz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pivot = new THREE.Group(); pivot.position.set(wx * (T.W / 2 - 0.15), 0.34, wz * (T.L / 2 - 0.88));
    const w = new THREE.Mesh(wx > 0 ? G.wheelR : G.wheelL, M.wheel); pivot.add(w); group.add(pivot); wheels.push(pivot);
  }
  const car = { type, T, top: G.top, group, body, doors, driver: null, pitch: 0, roll: 0, av: 0, paintMesh, wheels, x, z, y: 0, yaw, vx: 0, vz: 0, steer: 0, spin: 0, health: 100, mode, smoke: 0, color, procParts,
    ai: { dir: 0, laneC: 0, nextK: 0, decided: -99, turn: null, speed: 0, stuck: 0, rev: 0, knockX: 0, knockZ: 0 } };
  if (type === 'police') {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.3), M.trim); bar.position.set(0, G.top + 0.07, -0.2);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.26), M.copRed); red.position.set(0.28, G.top + 0.2, -0.2);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.26), M.copBlue); blue.position.set(-0.28, G.top + 0.2, -0.2);
    body.add(bar, red, blue);
  }
  if (T.model && ASSETS.models[T.model]) {
    const mi = modelInstance(T.model, T.L, 'z');
    if (mi) {
      for (const o of [paintMesh, glass]) o.visible = false;
      body.children.forEach(o => { if (o !== mi && o.isMesh) o.visible = false; });
      for (const d of doors) d.pv.children.forEach(o => o.visible = false);
      for (const w of wheels) w.children[0].visible = false;
      if (T.model === 'ferrari') cgTintModel(mi, 'ferrari', color);
      body.add(mi); car.model = mi;
    }
  } else if (CG_HERO[type] && ASSETS.models[CG_HERO[type]] && (type !== 'sedan' || Math.random() < 0.5)) car.hero = { name: CG_HERO[type], on: false, mi: null };
  scene.add(group); cars.push(car); syncCar(car);
  return car;
}
function syncCar(c) {
  c.group.position.set(c.x, c.y, c.z); c.group.rotation.y = c.yaw;
  c.body.rotation.set(c.pitch, 0, c.roll);
  for (const d of c.doors) { if (d.open !== d.target) { d.open += clamp(d.target - d.open, -0.05, 0.05); d.pv.rotation.y = -d.side * 1.15 * smooth(0, 1, d.open); } }
  for (let i = 0; i < 4; i++) { c.wheels[i].children[0].rotation.x = c.spin; if (i < 2) c.wheels[i].rotation.y = c.steer * 0.6; }
}
function removeCar(c) { if (c.hero?.on) cgHeroOn--; if (c.ownGeo) c.paintMesh.geometry.dispose(); if (c.driver && c.driver !== player.h) disposeHuman(c.driver); scene.remove(c.group); cars.splice(cars.indexOf(c), 1); }
const carLocal = (c, lx, lz) => { const s = Math.sin(c.yaw), co = Math.cos(c.yaw); return [c.x + lx * co + lz * s, c.z - lx * s + lz * co]; };
const doorPoint = (c, side = 1) => carLocal(c, side * (c.T.W / 2 + 0.7), c.T.L / 2 - 1.85);
const seatLocal = c => [0.4, 0.04, c.T.L / 2 - 1.95];
function setDriver(c, h) {
  c.driver = h; if (!h) return;
  c.body.add(h.group); const [x, y, z] = seatLocal(c); h.group.position.set(x, y, z); h.group.rotation.set(0, 0, 0); setHumanShadow(h, false);
}
function takeDriver(c) {
  const h = c.driver; if (!h) return null; c.driver = null; c.body.remove(h.group); scene.add(h.group); setHumanShadow(h, true);
  const [x, z] = doorPoint(c); h.group.position.set(x, groundH(x, z), z); h.group.rotation.set(0, c.yaw + Math.PI / 2, 0); return h;
}
const dirOfYaw = yaw => [0, 1, 2, 3].reduce((b, k) => Math.abs(angDiff(dirYaw(k), yaw)) < Math.abs(angDiff(dirYaw(b), yaw)) ? k : b, 0);
const carCircles = c => { const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), o = c.T.L / 2 - 0.95; return [[c.x + fx * o, c.z + fz * o], [c.x, c.z], [c.x - fx * o, c.z - fz * o]]; };

// Arcade-Fahrphysik (Spieler, Polizei, herrenlose Autos)
function driveCar(c, throttle, steerIn, hand, dt) {
  knockCheck(c, dt);
  const n = Math.max(1, Math.ceil(dt / 0.0125)), h = dt / n;
  for (let k = 0; k < n; k++) carStep(c, throttle, steerIn, hand, h);
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), vf = c.vx * fx + c.vz * fz;
  // Federung: Nicken/Rollen aus den tatsächlichen Beschleunigungen (Feder-Dämpfer, weich wie bei GTA 4)
  const tp = clamp(-(c.lastAx || 0) * 0.0075, -0.08, 0.08), tr = clamp(-(c.lastAy || 0) * 0.0095, -0.11, 0.11);
  c.pv = ((c.pv || 0) + ((tp - c.pitch) * 70 - (c.pv || 0) * 6.5) * dt); c.pitch += c.pv * dt;
  c.rv = ((c.rv || 0) + ((tr - c.roll) * 60 - (c.rv || 0) * 6) * dt); c.roll += c.rv * dt;
  if ((Math.abs(c.slipR || 0) > 0.14 || Math.abs(c.slipF || 0) > 0.2) && Math.hypot(c.vx, c.vz) > 5 && c === player.car) skidMark(c);
  c.spin += vf * dt / 0.36;
  carWorldCollide(c);
  c.y = lerp(c.y, groundH(c.x, c.z), Math.min(1, dt * 10));
  c.speedF = vf;
  // NaN-Schutz: ein einziger NaN-Wert in Höhe/Federung/Rad würde die Kamera (Ziel = Auto) und damit das ganze Bild schwarz machen
  if (!Number.isFinite(c.y)) c.y = Number.isFinite(c.ly) ? c.ly : 0; else c.ly = c.y;
  if (!Number.isFinite(c.speedF)) c.speedF = 0;
  for (const k of ['pitch', 'roll', 'pv', 'rv', 'spin']) if (!Number.isFinite(c[k])) c[k] = 0;
}
const CAR_MASS = { sedan: 1500, coupe: 1350, suv: 2100, compact: 1100, police: 1750, pickup: 2050, van: 2250, convertible: 1400, muscle: 1650, limo: 2600 };
// Fahrphysik: Reifenkräfte (Pacejka-ähnlich) an Vorder- und Hinterachse, Lastverlagerung, Gier-Trägheit
function carStep(c, thr, steerIn, hand, dt) {
  const T = c.T, m = CAR_MASS[c.type] || 1500, L = Math.max(2.2, T.L - 1.76), a = L * 0.47, b = L * 0.53, g = 9.81, H = 0.55, Iz = m * (T.L * T.L + T.W * T.W) / 11;
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;
  const u = c.vx * fx + c.vz * fz, v = c.vx * rx + c.vz * rz; let w = c.av || 0;
  const wreck = c.mode === 'wreck', ai = c !== player.car;
  const maxSteer = 0.56 / (1 + Math.abs(u) * 0.055);
  c.steer = lerp(c.steer, steerIn * maxSteer, Math.min(1, dt * 5.5));
  const d = c.steer;
  let Fx = 0;
  if (!wreck) {
    if (thr > 0) Fx = m * T.acc * 0.5 * thr * (u < -0.5 ? 3 : Math.max(0.05, 1 - (Math.max(0, u) / T.max) ** 1.6));
    else if (thr < 0) Fx = u > 0.6 ? -m * 9.2 * -thr : (u > -11 ? -m * 4.5 * -thr : 0);
  }
  Fx -= 0.45 * u * Math.abs(u) + m * 0.13 * Math.sign(u) * Math.min(1, Math.abs(u));
  if (thr === 0 && !hand) Fx -= m * 0.8 * Math.sign(u) * Math.min(1, Math.abs(u));
  if (hand) Fx -= Math.sign(u) * Math.min(Math.abs(u) * m * 2.5, m * 4);
  const ax = c.lastAx || 0, Nf = Math.max(0.2 * m * g, m * g * b / L - m * ax * H / L), Nr = Math.max(0.2 * m * g, m * g * a / L + m * ax * H / L);
  const mu = (wreck ? 0.55 : 1.0) * (ai ? 1.25 : 1), muR = hand ? mu * 0.36 : mu * 1.08;
  const cs = Math.cos(d), sn = Math.sin(d), vF = v - a * w, uw = u * cs - vF * sn, vw = u * sn + vF * cs;
  const af = Math.atan2(vw, Math.max(Math.abs(uw), 2.5)), ar = Math.atan2(v + b * w, Math.max(Math.abs(u), 2.5));
  const Fyf = -mu * Nf * Math.sin(1.4 * Math.atan(8.5 * af));
  let Fyr = -muR * Nr * Math.sin(1.4 * Math.atan(8.5 * ar));
  if (thr > 0 && !ai) Fyr *= Math.sqrt(Math.max(0.3, 1 - Math.min(1, Fx / (mu * Nr)) ** 2 * 0.55)); // Reibungskreis: Gas im Scheitel -> Heck kommt
  const Ff = Fx + Fyf * sn, Fr = Fyr + Fyf * cs, tau = -a * Fyf * cs + b * Fyr;
  w += tau / Iz * dt; w *= Math.exp(-0.35 * dt);
  c.vx += (fx * Ff + rx * Fr) / m * dt; c.vz += (fz * Ff + rz * Fr) / m * dt;
  c.av = w; c.yaw += w * dt;
  c.lastAx = lerp(ax, Ff / m, Math.min(1, dt * 6)); c.lastAy = lerp(c.lastAy || 0, Fr / m, Math.min(1, dt * 6));
  if (Math.hypot(c.vx, c.vz) < 0.12 && thr === 0) { c.vx *= 0.7; c.vz *= 0.7; c.av *= 0.7; }
  c.x += c.vx * dt; c.z += c.vz * dt; c.slipR = ar; c.slipF = af;
  if (![c.vx, c.vz, c.x, c.z, c.av, c.yaw].every(Number.isFinite)) {
    c.vx = 0; c.vz = 0; c.av = 0; if (!Number.isFinite(c.yaw)) c.yaw = c.lyaw || 0;
    c.x = Number.isFinite(c.lx) ? c.lx : 0; c.z = Number.isFinite(c.lz) ? c.lz : 0;
    c.steer = 0; c.lastAx = 0; c.lastAy = 0; // sonst bleibt ein NaN in der Lenkung/Beschleunigung für immer hängen
  } else { c.lx = c.x; c.lz = c.z; c.lyaw = c.yaw; }
}
function carWorldCollide(c) {
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  let tx = 0, tz = 0, n = 0, nx = 0, nz = 0;
  for (const [px, pz] of carCircles(c)) {
    const r = resolveCircle(px, pz, 0.98);
    if (r.hit) { tx += r.x - px; tz += r.z - pz; nx += r.nx; nz += r.nz; n++; }
  }
  if (!n) return;
  c.x += tx / n * 1.0; c.z += tz / n * 1.0;
  const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
  const vn = c.vx * nx + c.vz * nz;
  if (vn < 0) {
    c.vx -= 1.3 * vn * nx; c.vz -= 1.3 * vn * nz; c.vx *= 0.9; c.vz *= 0.9;
    { const side = Math.sign((Math.sin(c.yaw) * nz - Math.cos(c.yaw) * nx) || 1); c.av += clamp(side * -vn * 0.09, -2.5, 2.5); c.pv = (c.pv || 0) - vn * 0.08; }
    const imp = -vn;
    if (imp > 4) { const ldx = -nx, ldz = -nz, co = Math.cos(c.yaw), si = Math.sin(c.yaw), lx = ldx * co - ldz * si, lz = ldx * si + ldz * co, tt = Math.min(c.T.W / 2 / (Math.abs(lx) || 1e-3), c.T.L / 2 / (Math.abs(lz) || 1e-3)); deformLocal(c, lx * tt, lz * tt, Math.min(0.35, (imp - 4) * 0.03)); }
    if (imp > 7) { damageCar(c, (imp - 7) * 2.2); sfx.crash(Math.min(1, imp / 25), c); if (c === player.car) shake = Math.min(1, imp / 20); }
  }
  void fx; void fz;
}
function damageCar(c, d) {
  if (c.mode === 'wreck') return;
  c.health -= d;
  if (c.health <= 0) explodeCar(c);
}
function explodeCar(c) {
  if (c.model) c.model.traverse(o => { if (o.isMesh) o.material = M.wreck; });
  c.health = 0; c.mode = 'wreck'; c.paintMesh.material = M.wreck; c.vx *= 0.3; c.vz *= 0.3;
  explosion(c.x, 1, c.z);
  if (c.type === 'police' && c.pHit && SIG.t - c.pHit < 8) addWanted(1, 3);
}

// ---------- Particles ----------
function makeParticles(n, additive) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1)); g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { scale: { value: 500 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float scale; varying vec3 vC; varying float vA;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor = vec4(vC, vA*smoothstep(0.5,0.1,d)); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  return { pts, g, pos, col, size, alpha, n, life: new Float32Array(n), max: new Float32Array(n), vel: new Float32Array(n * 3), grow: new Float32Array(n), base: new Float32Array(n * 3), i: 0 };
}
let fire, smoke;
function emit(sys, x, y, z, vx, vy, vz, life, size, grow, r, g, b) {
  const i = sys.i; sys.i = (sys.i + 1) % sys.n;
  sys.pos.set([x, y, z], i * 3); sys.vel.set([vx, vy, vz], i * 3); sys.base.set([r, g, b], i * 3);
  sys.life[i] = sys.max[i] = life; sys.size[i] = size; sys.grow[i] = grow;
}
function updateParticles(sys, dt, buoy) {
  for (let i = 0; i < sys.n; i++) {
    if (sys.life[i] <= 0) { sys.alpha[i] = 0; continue; }
    sys.life[i] -= dt; const t = sys.life[i] / sys.max[i];
    for (let k = 0; k < 3; k++) sys.pos[i * 3 + k] += sys.vel[i * 3 + k] * dt;
    sys.vel[i * 3 + 1] += buoy * dt; sys.vel[i * 3] *= 0.98; sys.vel[i * 3 + 2] *= 0.98;
    sys.size[i] += sys.grow[i] * dt; sys.alpha[i] = Math.max(0, t);
    for (let k = 0; k < 3; k++) sys.col[i * 3 + k] = sys.base[i * 3 + k] * (buoy > 0 ? 1 : 0.4 + t * 0.6);
  }
  for (const a of ['position', 'color', 'size', 'alpha']) sys.g.attributes[a].needsUpdate = true;
  sys.pts.material.uniforms.scale.value = renderer.domElement.height * 0.5 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}
let shake = 0;
function explosion(x, y, z) {
  for (let i = 0; i < 70; i++) emit(fire, x, y, z, rnd(-7, 7), rnd(1, 10), rnd(-7, 7), rnd(0.4, 1.0), rnd(1, 2.5), 2.5, 1, rnd(0.4, 0.8), 0.15);
  for (let i = 0; i < 50; i++) emit(smoke, x, y + 1, z, rnd(-3, 3), rnd(1, 5), rnd(-3, 3), rnd(2, 4), rnd(2, 3), 2.5, 0.12, 0.12, 0.12);
  sfx.boom(x, z);
  const d = Math.hypot(player.x - x, player.z - z); if (d < 40) shake = Math.max(shake, 1 - d / 40);
  if (d < 9) { const l0 = d || 1; knockPlayer((player.x - x) / l0 * 12 * (1 - d / 9), 6 * (1 - d / 9) + 2, (player.z - z) / l0 * 12 * (1 - d / 9), 70 * (1 - d / 9)); }
  for (const p of [...peds, ...officers]) if (p.state !== 'dead' && Math.hypot(p.x - x, p.z - z) < 8) { if (p.cop) killPed(p, false); else { const d0 = Math.hypot(p.x - x, p.z - z) || 1; launchPed(p, { vx: (p.x - x) / d0 * 14, vz: (p.z - z) / d0 * 14 }); p.impact = 20; } }
  for (const c of cars) if (c.mode !== 'wreck') { const dc = Math.hypot(c.x - x, c.z - z); if (dc > 0.1 && dc < 8) damageCar(c, 45 * (1 - dc / 8)); }
}

// ---------- Pedestrians (Verhaltens-KI) ----------
const peds = [];
const RING = B - 4.4, HR = RING / 2;
const PED_COUNT = 55;
const benches = [];
// Gehweg-Graph: 4 Ecken pro Block, Kanten entlang der Blockseiten und über die Zebrastreifen
const CORNER = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const SIDE_CORNERS = [[0, 1], [1, 2], [2, 3], [3, 0]]; // N, O, S, W
const nodeId = (i, j, c) => (i * N + j) * 4 + c;
function nodePos(id) { const c = id % 4, b = (id - c) / 4, i = Math.floor(b / N), j = b % N; return [blockCenter(i) + CORNER[c][0] * HR, blockCenter(j) + CORNER[c][1] * HR]; }
function nodeNeighbors(id) {
  const c = id % 4, b = (id - c) / 4, i = Math.floor(b / N), j = b % N;
  const out = [[nodeId(i, j, (c + 1) % 4), RING, false], [nodeId(i, j, (c + 3) % 4), RING, false]];
  for (const [di, dj, nc] of [[[-1, 0, 1], [0, -1, 3]], [[1, 0, 0], [0, -1, 2]], [[1, 0, 3], [0, 1, 1]], [[-1, 0, 2], [0, 1, 0]]][c]) {
    const ni = i + di, nj = j + dj; if (ni >= 0 && ni < N && nj >= 0 && nj < N) out.push([nodeId(ni, nj, nc), R + 8, true]);
  }
  return out;
}
function ringProj(x, z) {
  const i = clamp(Math.floor((x - BLOCK0) / P), 0, N - 1), j = clamp(Math.floor((z - BLOCK0) / P), 0, N - 1);
  const u = clamp(x - blockCenter(i), -HR, HR), v = clamp(z - blockCenter(j), -HR, HR);
  const d = [v + HR, HR - u, HR - v, u + HR];
  let side = 0; for (let k = 1; k < 4; k++) if (d[k] < d[side]) side = k;
  const pu = side === 1 ? HR : side === 3 ? -HR : u, pv = side === 0 ? -HR : side === 2 ? HR : v;
  return { i, j, side, x: blockCenter(i) + pu, z: blockCenter(j) + pv };
}
// A*-Wegsuche auf dem Gehweg-Graphen
function findPath(fx, fz, tx, tz) {
  const A = ringProj(fx, fz), Z = ringProj(tx, tz);
  if (A.i === Z.i && A.j === Z.j && A.side === Z.side) return [{ x: A.x, z: A.z }, { x: Z.x, z: Z.z }, { x: tx, z: tz }];
  const goal = new Map(SIDE_CORNERS[Z.side].map(c => { const id = nodeId(Z.i, Z.j, c), [x, z] = nodePos(id); return [id, Math.hypot(x - Z.x, z - Z.z)]; }));
  const g = new Map(), prev = new Map(), open = [], closed = new Set();
  for (const c of SIDE_CORNERS[A.side]) { const id = nodeId(A.i, A.j, c), [x, z] = nodePos(id); g.set(id, Math.hypot(x - A.x, z - A.z)); open.push(id); }
  const h = id => { const [x, z] = nodePos(id); return Math.hypot(x - Z.x, z - Z.z); };
  let best = null, bestCost = Infinity, iter = 0;
  while (open.length && iter++ < 4000) {
    let bi = 0, bf = Infinity;
    for (let k = 0; k < open.length; k++) { const f = g.get(open[k]) + h(open[k]); if (f < bf) { bf = f; bi = k; } }
    const cur = open.splice(bi, 1)[0];
    if (bf >= bestCost) break;
    if (closed.has(cur)) continue; closed.add(cur);
    if (goal.has(cur)) { const tot = g.get(cur) + goal.get(cur); if (tot < bestCost) { bestCost = tot; best = cur; } }
    for (const [n, cost, cross] of nodeNeighbors(cur)) {
      const ng = g.get(cur) + cost;
      if (ng < (g.get(n) ?? Infinity)) { g.set(n, ng); prev.set(n, [cur, cross]); open.push(n); }
    }
  }
  if (best === null) return null;
  const chain = []; let n = best;
  while (n !== undefined) { const [x, z] = nodePos(n), pv = prev.get(n); chain.unshift({ x, z, cross: pv ? pv[1] : false }); n = pv ? pv[0] : undefined; }
  return [{ x: A.x, z: A.z }, ...chain, { x: Z.x, z: Z.z }, { x: tx, z: tz }];
}
function buildBenches() {
  const geos = [];
  for (const key of parks) {
    const [i, j] = key.split(',').map(Number); if (HOME_BLOCKS.includes(key)) continue;
    const cx = blockCenter(i), cz = blockCenter(j);
    for (let side = 0; side < 4; side++) for (const t of [-12, 12]) {
      const [nx, nz] = DIRS[side], tx = -nz, tz = nx, inset = HR - 2.2;
      const x = cx + nx * inset + tx * t, z = cz + nz * inset + tz * t, yaw = Math.atan2(nx, nz);
      const parts = [[1.8, 0.07, 0.5, 0, 0.47, 0, '#7a5534'], [1.8, 0.45, 0.06, 0, 0.75, -0.24, '#7a5534'], [0.08, 0.45, 0.45, -0.8, 0.22, 0, '#2b2b2b'], [0.08, 0.45, 0.45, 0.8, 0.22, 0, '#2b2b2b']];
      for (const [w, h, d, lx, ly, lz, col] of parts) { const gg = colorize(new THREE.BoxGeometry(w, h, d), col); gg.translate(lx, ly, lz); gg.rotateY(yaw); gg.translate(x, 0.2, z); geos.push(gg); }
      benches.push({ x: x + nx * 0.05, z: z + nz * 0.05, yaw, occ: null });
    }
  }
  if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos), M.vcol); m.castShadow = m.receiveShadow = true; scene.add(m); }
}
function freeBenchNear(x, z, r) {
  let best = null, bd = r;
  for (const b of benches) { if (b.occ) continue; const d = Math.hypot(b.x - x, b.z - z) * rnd(0.8, 1.2); if (d < bd) { bd = d; best = b; } }
  return best;
}
function adoptPed(h, x, z, yaw = 0) {
  const p = { x, z, yaw, state: 'walk', hp: 40, path: null, pi: 0, task: null, pose: null, t: 0, wait: 0, crossing: false, speedMul: 1, speed: rnd(1.15, 1.6), off: rnd(0.3, 0.9), traits: { jog: false, social: Math.random(), lazy: Math.random(), phone: Math.random() }, h };
  [p.voice, p.vrate] = voiceFor({ gender: h.fem ? 'f' : 'm' }); h.group.position.set(x, groundH(x, z), z); h.group.rotation.set(0, yaw, 0); scene.add(h.group); peds.push(p); return p;
}
function makePed(x, z) {
  const p = { x, z, yaw: Math.random() * 6.28, state: 'walk', hp: 40, path: null, pi: 0, task: null, pose: null, t: 0, wait: 0, crossing: false, speedMul: 1,
    speed: rnd(1.15, 1.6), off: rnd(0.3, 0.9), traits: { jog: Math.random() < 0.12, social: Math.random(), lazy: Math.random(), phone: Math.random() } };
  const L = pedLook(); p.h = makeHuman(L); [p.voice, p.vrate] = voiceFor(L); p.h.group.scale.setScalar(rnd(0.95, 1.05)); scene.add(p.h.group); peds.push(p); return p;
}
function spawnPed(minD = 25, maxD = 120) {
  if (Math.random() < 0.4) {
    const b = randomDoorNear(player.x, player.z, minD, maxD);
    if (b) { const p = makePed(b.door.x, b.door.z); p.yaw = Math.atan2(b.door.nx, b.door.nz); nextTask(p); return p; }
  }
  for (let tries = 0; tries < 15; tries++) {
    const a = Math.random() * 6.283, d = rnd(minD, maxD);
    const q = ringProj(player.x + Math.cos(a) * d, player.z + Math.sin(a) * d), dd = Math.hypot(q.x - player.x, q.z - player.z);
    if (dd < minD || dd > maxD) continue;
    const p = makePed(q.x, q.z); nextTask(p); return p;
  }
}
const goTo = (p, x, z) => { const path = findPath(p.x, p.z, x, z); if (!path) return false; p.path = path; p.pi = 0; return true; };
function idle(p, pose, dur) { p.path = null; p.pose = pose; p.wait = dur; }
// Tätigkeit nach Persönlichkeit und Tageszeit auswählen
function nextTask(p) {
  if (p.task?.bench) p.task.bench.occ = null;
  const night = nightF > 0.6, tr = p.traits;
  const w = { drive: 0.9, stroll: 3, commute: night ? 4 : 2.5, bench: night ? 0.3 : 1.6 * tr.lazy, phone: 1.2 * tr.phone, chat: 2 * tr.social, window: 1, smoke: 0.5, jog: tr.jog && !night ? 4 : 0 };
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0), type = 'stroll';
  for (const k in w) { r -= w[k]; if (r <= 0) { type = k; break; } }
  p.pose = null; p.task = { type }; p.speedMul = 1;
  switch (type) {
    case 'stroll': case 'jog': {
      const range = type === 'jog' ? 260 : 130, q = ringProj(p.x + rnd(-range, range), p.z + rnd(-range, range));
      if (!goTo(p, q.x, q.z)) return idle(p, 'look', 3);
      p.task.after = ['look', rnd(2, 6)]; if (type === 'jog') p.speedMul = 2.6; break;
    }
    case 'commute': { const b = randomDoorNear(p.x, p.z, 15, 220); if (!b || !goTo(p, b.door.x, b.door.z)) return idle(p, 'look', 3); p.task.enter = true; break; }
    case 'window': {
      const b = randomDoorNear(p.x, p.z, 5, 110); if (!b) return idle(p, 'look', 3);
      const o = rnd(-4, 4); if (!goTo(p, b.door.x + b.door.tx * o - b.door.nx * 0.4, b.door.z + b.door.tz * o - b.door.nz * 0.4)) return idle(p, 'look', 3);
      p.task.after = ['browse', rnd(4, 9)]; p.task.face = Math.atan2(-b.door.nx, -b.door.nz); break;
    }
    case 'bench': {
      const bn = freeBenchNear(p.x, p.z, 140); if (!bn || !goTo(p, bn.x, bn.z)) return idle(p, 'phone', rnd(6, 12));
      bn.occ = p; p.task.bench = bn; p.task.after = ['sit', rnd(15, 45)]; p.task.face = bn.yaw; break;
    }
    case 'drive': {
      const c = cars.find(o => o.mode === 'parked' && !o.keep && !o.driver && !o.npcSeq && o.type !== 'police' && Math.hypot(o.x - p.x, o.z - p.z) < 60);
      if (!c) return idle(p, 'look', 3);
      const [dx, dz] = doorPoint(c); if (!goTo(p, dx, dz)) return idle(p, 'look', 3);
      c.reserved = p; p.task.car = c; break;
    }
    case 'phone': return idle(p, 'phone', rnd(8, 20));
    case 'smoke': return idle(p, 'smoke', rnd(10, 20));
    case 'chat': {
      const q = peds.find(o => o !== p && o.state === 'walk' && !o.crossing && o.task && !['chat', 'waitchat', 'talking', 'bench'].includes(o.task.type) && Math.hypot(o.x - p.x, o.z - p.z) < 25);
      if (!q) return idle(p, 'phone', rnd(6, 12));
      const d = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      if (!goTo(p, q.x + (p.x - q.x) / d * 0.9, q.z + (p.z - q.z) / d * 0.9)) return idle(p, 'look', 4);
      if (q.task?.bench) q.task.bench.occ = null;
      q.path = null; q.task = { type: 'waitchat', partner: p }; q.pose = 'look'; q.wait = 40; p.task.partner = q; break;
    }
  }
}
function arrive(p) {
  p.path = null; const t = p.task || {};
  if (t.enter) { p.state = 'gone'; return; }
  if (t.car) { const c = t.car; if (c.mode === 'parked' && !c.driver && !c.npcSeq && Math.hypot(c.x - p.x, c.z - p.z) < 4) { p.state = 'entering'; p.yaw = c.yaw - Math.PI / 2; c.doors[0].target = 1; c.npcSeq = { type: 'enter', t: 0, ped: p }; return; } nextTask(p); return; }
  if (t.partner) {
    const q = t.partner;
    if (q.state === 'walk' && q.task?.partner === p) {
      const dur = rnd(10, 22); p.pose = q.pose = 'talk'; p.wait = q.wait = dur;
      p.task = { type: 'talking' }; q.task = { type: 'talking' };
      p.yaw = Math.atan2(q.x - p.x, q.z - p.z); q.yaw = p.yaw + Math.PI;
      if (Math.hypot(p.x - player.x, p.z - player.z) < 14) say(pick(LINES.chat), { who: 'Passant', voice: p.voice, rate: p.vrate, h: p.h });
    } else nextTask(p);
    return;
  }
  if (t.after) { p.pose = t.after[0]; p.wait = t.after[1]; if (t.face !== undefined) p.yaw = t.face; return; }
  nextTask(p);
}
function crossingSafe(p, tgt) {
  const mx = (p.x + tgt.x) / 2, mz = (p.z + tgt.z) / 2;
  for (const c of cars) {
    const vx = c.mode === 'ai' ? Math.sin(c.yaw) * c.ai.speed : c.vx, vz = c.mode === 'ai' ? Math.cos(c.yaw) * c.ai.speed : c.vz;
    if (vx * vx + vz * vz < 2.5) continue;
    const dx = mx - c.x, dz = mz - c.z; if (dx * dx + dz * dz > 22 * 22) continue;
    if (dx * vx + dz * vz > 0) return false;
  }
  return true;
}
function killPed(p, byPlayer = true) {
  if (p.state === 'dead') return;
  if (p.task?.bench) p.task.bench.occ = null;
  p.state = 'dead'; p.t = 15; p.path = null;
  p.h.group.rotation.x = -Math.PI / 2; p.h.group.position.y = (p.h.group.position.y || 0) + 0.25;
  sfx.pain(p.x, p.z);
  if (!p.F && Math.random() < 0.7) spawnMoney(p.x, p.z, rint(8, 90));
  if (byPlayer) { if (p.cop) addWanted(1, 3); else reportCrime('murder', p.x, p.z, 2); }
  if (p.cop) p.t = 20;
  if (p.F) iPanic();
}
// Treffer durch ein Auto: Körper fliegt, überschlägt sich, landet – stirbt bei hoher Wucht
function launchPed(p, c) {
  if (p.state === 'fly' || p.state === 'dead') return;
  const sp = Math.hypot(c.vx, c.vz);
  if (p.task?.bench) p.task.bench.occ = null;
  p.state = 'fly'; p.path = null; p.crossing = false;
  p.fv = [c.vx * 0.85 + rnd(-1, 1), 2 + sp * 0.22, c.vz * 0.85 + rnd(-1, 1)]; p.fy = groundH(p.x, p.z); p.spinX = rnd(4, 9) * (sp / 15); p.spinZ = rnd(-3, 3);
  p.impact = sp; c.vx *= 0.93; c.vz *= 0.93; shake = Math.max(shake, Math.min(0.5, sp / 40));
  if (sp > 6) reportCrime('hitrun', p.x, p.z, 1);
}
function updateFlying(p, dt) {
  p.fv[1] -= 15 * dt; p.x += p.fv[0] * dt; p.z += p.fv[2] * dt; p.fy += p.fv[1] * dt;
  const r0 = resolveCircle(p.x, p.z, 0.35); if (r0.hit) { p.fv[0] *= -0.3; p.fv[2] *= -0.3; } p.x = r0.x; p.z = r0.z;
  const g = p.h.group, gh = groundH(p.x, p.z);
  g.rotation.x += p.spinX * dt; g.rotation.z += p.spinZ * dt;
  if (p.fy <= gh && p.fv[1] < 0) {
    if (Math.abs(p.fv[1]) > 3) { p.fv[1] *= -0.25; p.fv[0] *= 0.5; p.fv[2] *= 0.5; p.spinX *= 0.4; sfx.hit(); p.fy = gh; }
    else { p.fy = gh; g.rotation.set(-Math.PI / 2, g.rotation.y, 0); p.state = 'walk';
      if (p.impact > 7) killPed(p); else { p.state = 'flee'; p.t = rnd(5, 8); g.rotation.set(0, p.yaw, 0); } return; }
  }
  g.position.set(p.x, p.fy, p.z); animHuman(p.h, 0, dt);
}
// Bremsspuren (Ringpuffer aus Decals)
let skidIM = null, skidI = 0; const _skidM = new THREE.Matrix4(), _skidQ = new THREE.Quaternion(), _skidS = new THREE.Vector3(0.28, 1, 0.5), _skidP = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function skidMark(c) {
  if (!skidIM) {
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    skidIM = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), 1200);
    skidIM.count = 0; skidIM.frustumCulled = false; scene.add(skidIM);
  }
  for (const side of [-1, 1]) {
    const [x, z] = carLocal(c, side * (c.T.W / 2 - 0.2), -(c.T.L / 2 - 0.9));
    _skidP.set(x, groundH(x, z) + 0.025, z); _skidQ.setFromAxisAngle(_up, c.yaw); _skidM.compose(_skidP, _skidQ, _skidS);
    skidIM.setMatrixAt(skidI, _skidM); skidI = (skidI + 1) % 1200; skidIM.count = Math.max(skidIM.count, skidI);
  }
  skidIM.instanceMatrix.needsUpdate = true;
}
function scarePeds(x, z, r) {
  let talker = null;
  for (const p of peds) if (p.state === 'walk' && Math.hypot(p.x - x, p.z - z) < r) {
    if (p.task?.bench) p.task.bench.occ = null;
    p.state = 'flee'; p.t = rnd(6, 10); p.path = null; p.crossing = false; if (!talker || Math.random() < 0.3) talker = p;
  }
  if (talker && Math.hypot(talker.x - player.x, talker.z - player.z) < 30) say(pick(LINES.scared), { who: 'Passant', voice: talker.voice, rate: (talker.vrate || 1) * 1.08, h: talker.h });
}
let pedTalkT = 6, bumpCd = 0;
function updatePed(p, dt, dist) {
  if (p.state === 'entering') { animHuman(p.h, 0, dt); return; }
  if (p.state === 'fly') { updateFlying(p, dt); return; }
  if (p.state === 'free') {
    p.t -= dt; const a = Math.atan2(p.x - player.x, p.z - player.z);
    p.x += Math.sin(a) * 5 * dt; p.z += Math.cos(a) * 5 * dt; const r = resolveCircle(p.x, p.z, 0.35); p.x = r.x; p.z = r.z;
    p.yaw = a; animHuman(p.h, 6, dt);
    if (p.t < 0) { p.state = 'walk'; nextTask(p); }
    return;
  }
  if (p.state === 'flee') {
    p.t -= dt;
    if (!p.path) { const d = Math.hypot(p.x - player.x, p.z - player.z) || 1, q = ringProj(p.x + (p.x - player.x) / d * 90, p.z + (p.z - player.z) / d * 90); goTo(p, q.x, q.z); p.task = { type: 'flee' }; }
    if (p.t < 0) { p.state = 'walk'; p.path = null; nextTask(p); return; }
  }
  const blocked = !player.car && dist < 1.1 && p.state === 'walk' && p.path;
  if (blocked) {
    if (bumpCd <= 0) { bumpCd = 6; say(pick(LINES.bump), { who: 'Passant', voice: p.voice, rate: p.vrate, h: p.h }); }
    p.yaw = Math.atan2(player.x - p.x, player.z - p.z); animHuman(p.h, 0, dt, false, 'look'); return;
  }
  if (p.path) {
    const tgt = p.path[p.pi];
    if (tgt.cross && !p.crossing) {
      if (p.state === 'walk' && !crossingSafe(p, tgt) && (p.waitCross = (p.waitCross || 0) + dt) < 15) { animHuman(p.h, 0, dt, false, 'look'); return; }
      p.crossing = true; p.waitCross = 0;
    }
    const sp = p.state === 'flee' ? 5.4 : p.speed * p.speedMul;
    const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.25) { p.pi++; p.crossing = false; if (p.pi >= p.path.length) { if (p.state === 'flee') p.path = null; else arrive(p); } }
    else { const st = Math.min(d, sp * dt); p.x += dx / d * st; p.z += dz / d * st; p.yaw += angDiff(p.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8); }
    animHuman(p.h, sp, dt);
    return;
  }
  p.wait -= dt;
  if (p.task?.type === 'waitchat') {
    const q = p.task.partner;
    if (q && q.state === 'walk' && q.task?.partner === p) p.yaw += angDiff(p.yaw, Math.atan2(q.x - p.x, q.z - p.z)) * Math.min(1, dt * 5);
    else nextTask(p);
  } else if (p.wait <= 0 && p.task?.type !== 'calling') nextTask(p);
  animHuman(p.h, 0, dt, false, p.pose);
  if (pedTalkT < 0 && dist < 6 && !player.car && !player.dead) {
    pedTalkT = rnd(9, 16);
    say(p.pose === 'phone' ? pick(LINES.phone) : pick(LINES.ped), { who: 'Passant', voice: p.voice, rate: p.vrate, h: p.h });
  }
}
function updatePeds(dt) {
  pedTalkT -= dt; bumpCd -= dt;
  for (let i = peds.length - 1; i >= 0; i--) {
    const p = peds[i], dist = Math.hypot(p.x - player.x, p.z - player.z);
    if (dist > 170 || p.state === 'gone' || (p.state === 'dead' && (p.t -= dt) < 0)) {
      if (p.task?.bench) p.task.bench.occ = null;
      scene.remove(p.h.group); disposeHuman(p.h); peds.splice(i, 1); continue;
    }
    setHumanShadow(p.h, dist < 25);
    p.h.group.visible = dist < 85; p.h.lod = dist > 45 ? 3 : dist > 25 ? 2 : 1;
    if (p.state === 'fly') { updatePed(p, dt, dist); continue; }
    if (p.state !== 'dead') {
      updatePed(p, dt, dist);
      // rechts gehen, damit sich Entgegenkommende nicht durchdringen
      const walking = p.path && !p.crossing && p.pi < p.path.length - 1, o = walking ? p.off : 0;
      p.ox = lerp(p.ox || 0, o, Math.min(1, dt * 3));
      const px = p.x - Math.cos(p.yaw) * p.ox, pz = p.z + Math.sin(p.yaw) * p.ox;
      p.h.group.position.set(px, groundH(px, pz), pz); p.h.group.rotation.y = p.yaw;
    }
  }
  const want = nightF > 0.6 ? 32 : PED_COUNT;
  let alive = 0; for (const p of peds) if (p.state !== 'dead') alive++;
  for (let n = 0; alive < want && n < 2; n++, alive++) if (!spawnPed(peds.length < 10 ? 8 : 70, 140)) break;
}

// ---------- Innenräume: nahtlos im echten Gebäude ----------
// Das Gebäude in Spielernähe bekommt seine Etagen an der echten Position: durch die Tür hineingehen,
// Treppenhaus mit Zwischenpodest, fahrende Aufzugskabine. Geladen sind immer nur die Etage des Spielers ±1.
const FH = 3.6, Y0 = 0.2, floorY = f => Y0 + f * FH;
const ELEV = [-3.1, -0.6, -2.95, -0.45], H1 = [-0.4, 1.25, -1.4, 1.6], H2 = [-0.4, 3.1, 1.6, 2.9];
const INT = { active: false, inside: false, b: null, root: null, floors: new Map(), cab: null, menu: null, sel: 0, amb: null, lights: [], talkCd: 0, panic: false, W: 20, D: 20, cos: 1, sin: 0, fc: 0, kind: '', company: '', portal: null, checkT: 0, npcs: [] };
const COMPANIES = ['Cutline Videoproduktion', 'Palmtree Media', 'Silverlake Finanz', 'Bayview Versicherungen', 'Neon Pixel Studios', 'Harbor & Sons Anwälte', 'Westcoast Logistik', 'Sunset Immobilien', 'Vespucci Architekten', 'Golden Coast Consulting', 'Bluewave Software', 'Canyon Kreativagentur', 'Pacific Drehbuchbüro', 'Mirror Park Marketing'];
const SHOPS = ['24/7 Markt', 'Kiosk Grove Street', 'Rob\'s Liquor', 'Taco Corner', 'Ponsonbys Mode', 'Ammu-Waffen (geschlossen)'];
function mulberry(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function companyOf(b, fl) { const r = mulberry(b.seed + Math.floor(fl / 4) * 17); return COMPANIES[Math.floor(r() * COMPANIES.length)]; }
function floorName(b, fl) {
  if (b.type === 'hospital') return fl === 0 ? 'EG · Notaufnahme' : `${fl}. OG · Station ${String.fromCharCode(64 + fl)}`;
  if (b.type === 'police') return fl === 0 ? 'EG · Polizeiwache Mission Row' : `${fl}. OG · Ermittlungen`;
  if (b.type === 'market') return 'Supermarkt · ' + ['Gut & Günstig', 'LS Frischemarkt', 'Megamart'][b.seed % 3];
  if (b.type === 'gas') return 'Tankstelle · Globe Oil';
  if (b.type === 'prison') return fl === 0 ? 'EG · Zellentrakt A' : `${fl}. OG · Zellentrakt`;
  if (b.type === 'bank') return fl === 0 ? 'EG · Fleeca Bank' : `${fl}. OG · Fleeca Verwaltung`;
  if (b.type === 'hotel') return fl === 0 ? 'EG · ' + ['Hotel Vinewood Plaza', 'Hotel Del Perro', 'The Pink Cage', 'Hotel Richman'][b.seed % 4] : `${fl}. OG · Hotelzimmer`;
  if (fl === 0) return b.type === 'shop' ? 'EG · ' + SHOPS[b.seed % SHOPS.length] : 'EG · Lobby';
  return `${fl}. OG · ${b.type === 'office' ? companyOf(b, fl) : 'Wohnungen'}`;
}
function initInteriorLights() {
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xfff1dc, 0, 0, 2); scene.add(l); INT.lights.push(l); }
  INT.amb = new THREE.AmbientLight(0xfff4e6, 0); scene.add(INT.amb);
  for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffd0a0, 0, 30, 2); l.userData.on = false; scene.add(l); LAMP_POOL.push(l); } // Laternenpool (ohne Schatten)
}
let ITEX = null;
// ==== PRODKIT BEGIN ====
// Produkt-Kit für Supermarkt/Tankstelle: Etiketten-Atlas, Produktgeometrien (Flaschen, Dosen, Kartons, Tüten, Gläser),
// Regal-Bestückung (Facings), Obst-/Fisch-Instanzen aus echten Modellen. Alles wird je Etage in wenige InstancedMeshes gebaut.
const PA = 2048, PC = 256, PSTRIP = 24, PART_V = (PC - PSTRIP) / PC; // Atlas 8x8 Zellen à 256 px; oben 24 px Farbstreifen für Seiten/Deckel
let PRODTEX = null, PRODMAT = null, PRODGEO = null;
const lathePts = a => a.map(([r, y]) => new THREE.Vector2(r, y));
// Typen: Maße in m (w,h,d), Etiketten-Fläche in mm (Umfang x Höhe bzw. Front), Profil für Drehkörper
const PTYPES = {
  can:    { w: 0.066, h: 0.12, d: 0.066, art: [207, 120], lathe: [[0, 0], [0.0285, 0], [0.033, 0.01], [0.033, 0.11], [0.0285, 0.12], [0, 0.12]], seg: 10, rows: 2 },
  tin:    { w: 0.074, h: 0.105, d: 0.074, art: [232, 105], lathe: [[0, 0], [0.0345, 0], [0.037, 0.005], [0.037, 0.1], [0.0345, 0.105], [0, 0.105]], seg: 10, rows: 2 },
  bottle: { w: 0.064, h: 0.205, d: 0.064, art: [201, 205], lathe: [[0, 0], [0.028, 0], [0.032, 0.012], [0.032, 0.125], [0.0135, 0.175], [0.0135, 0.188], [0.0158, 0.19], [0.0158, 0.205], [0, 0.205]], seg: 10, rows: 2 },
  beer:   { w: 0.071, h: 0.234, d: 0.071, art: [223, 234], lathe: [[0, 0], [0.032, 0], [0.0355, 0.008], [0.0355, 0.13], [0.0125, 0.2], [0.0125, 0.222], [0.0165, 0.223], [0.0165, 0.234], [0, 0.234]], seg: 10, rows: 2 },
  jar:    { w: 0.077, h: 0.1, d: 0.077, art: [239, 100], lathe: [[0, 0], [0.036, 0], [0.038, 0.004], [0.038, 0.08], [0.0385, 0.084], [0.0385, 0.1], [0, 0.1]], seg: 10, rows: 2 },
  box:    { w: 0.20, h: 0.30, d: 0.07, art: [200, 300], rows: 2 },
  box2:   { w: 0.12, h: 0.17, d: 0.05, art: [120, 170], rows: 2 },
  bag:    { w: 0.20, h: 0.30, d: 0.06, art: [200, 300], rows: 2 },
  carton: { w: 0.07, h: 0.242, d: 0.07, art: [70, 180], rows: 2 },
  tag:    { w: 0.06, h: 0.028, d: 0.004, art: [60, 28], rows: 1 },
};
// Produkte: [Typ, Marke, Zeile 2, Menge, Bild, Hauptfarbe, Zweitfarbe, Akzent, Textfarbe, Optionen]
const PDEFS = {
  ecola:    ['can', 'eCola', 'ZERO ZUCKER', '330 ml', 'bubbles', '#d11a24', '#8f0b14', '#ffffff', '#ffffff'],
  sprunk:   ['can', 'Sprunk', 'LEMON-LIME', '330 ml', 'bubbles', '#2fa84a', '#126b2c', '#d8ff4a', '#ffffff'],
  pisswas:  ['can', 'Pißwasser', 'PREMIUM LAGER', '500 ml', 'star', '#e8c32a', '#b8860b', '#1a1a1a', '#1a1a1a', { sc: 1.12 }],
  loggerc:  ['can', 'Logger', 'DARK BEER', '500 ml', 'leaf', '#3a2a1a', '#1c120a', '#d6a640', '#f0d9a0', { sc: 1.12 }],
  meteor:   ['can', 'Meteorite', 'ENERGY', '250 ml', 'bolt', '#14224d', '#070d24', '#ffd21f', '#ffffff'],
  ego:      ['can', 'Ego Chaser', 'ENERGY DRINK', '250 ml', 'bolt', '#151515', '#000000', '#ff7a1a', '#ffffff'],
  raineS:   ['can', 'Raine', 'SPARKLING', '330 ml', 'drop', '#7ec8f0', '#2f8fd0', '#ffffff', '#0a3c66'],
  ofizz:    ['can', 'O-Fizz', 'ORANGE', '330 ml', 'orange', '#ff9a1f', '#d96a00', '#ffffff', '#ffffff'],
  tomaten:  ['tin', 'Tomaten', 'GESCHÄLT', '400 g', 'tomato', '#d83a2a', '#a82418', '#fff3d6', '#ffffff'],
  mais:     ['tin', 'Mais', 'ZUCKERMAIS', '340 g', 'corn', '#f2c21a', '#c99a08', '#2f8f3a', '#2b2b2b'],
  bohnen:   ['tin', 'Bohnen', 'WEISSE BOHNEN', '400 g', 'bean', '#3d8f43', '#1f6a28', '#fff3d6', '#ffffff'],
  thunfisch:['tin', 'Thunfisch', 'IN OLIVENÖL', '185 g', 'fish', '#2a64b8', '#18438a', '#fff3d6', '#ffffff'],
  ecola15:  ['bottle', 'eCola', 'ORIGINAL', '1,5 L', 'bubbles', '#d11a24', '#2a0f0a', '#ffffff', '#ffffff', { sc: 1.45, cap: '#d11a24' }],
  sprunk15: ['bottle', 'Sprunk', 'LEMON-LIME', '1,5 L', 'bubbles', '#2fa84a', '#cfeab0', '#d8ff4a', '#ffffff', { sc: 1.45, cap: '#2fa84a' }],
  raine15:  ['bottle', 'Raine', 'MINERALWASSER', '1,5 L', 'drop', '#2f8fd0', '#d6ecf7', '#ffffff', '#ffffff', { sc: 1.45, cap: '#2f8fd0' }],
  raineP:   ['bottle', 'Raine', 'STILL', '0,5 L', 'drop', '#4aa8e0', '#d6ecf7', '#ffffff', '#ffffff', { cap: '#ffffff' }],
  ecolaP:   ['bottle', 'eCola', 'ORIGINAL', '0,5 L', 'bubbles', '#d11a24', '#2a0f0a', '#ffffff', '#ffffff', { cap: '#d11a24' }],
  osaft:    ['bottle', 'O-Saft', 'ORANGE 100%', '1 L', 'orange', '#ff8f1a', '#ffb13a', '#2f9a3a', '#ffffff', { sc: 1.25, cap: '#ff8f1a' }],
  eistee:   ['bottle', 'Eistee', 'PFIRSICH', '1 L', 'leaf', '#e8742a', '#c98a3a', '#2f9a3a', '#ffffff', { sc: 1.25, cap: '#e8742a' }],
  pisswasb: ['beer', 'Pißwasser', 'PREMIUM LAGER', '0,5 L', 'star', '#f2d23a', '#6b3a10', '#1a1a1a', '#1a1a1a'],
  loggerb:  ['beer', 'Logger', 'DARK BEER', '0,5 L', 'leaf', '#2c2c2c', '#2a1608', '#d6a640', '#f0d9a0'],
  egob:     ['beer', 'Ego Chaser', 'IPA', '0,5 L', 'bolt', '#ff7a1a', '#1d3a1d', '#151515', '#151515'],
  kaffee:   ['jar', 'Bean Machine', 'KAFFEE GOLD', '200 g', 'coffee', '#5a2d12', '#3a1c0a', '#d6a640', '#fff1d0', { lid: '#d6a640' }],
  erdnuss:  ['jar', 'Erdnussbutter', 'CREMIG', '350 g', 'nut', '#c9302c', '#b87a3a', '#f4e3b0', '#ffffff', { lid: '#c9302c' }],
  honig:    ['jar', 'Honig', 'BLÜTENHONIG', '500 g', 'hex', '#f6e3a0', '#e0900a', '#7a4a10', '#7a4a10', { lid: '#7a4a10' }],
  gurken:   ['jar', 'Gurken', 'SÜSS-SAUER', '720 ml', 'leaf', '#4a9a3a', '#b9c96a', '#fff3d6', '#ffffff', { lid: '#3a7a2a' }],
  marmel:   ['jar', 'Erdbeer', 'KONFITÜRE', '340 g', 'berry', '#fff3f0', '#b8142a', '#d83a4a', '#8a0f1e', { lid: '#d83a4a' }],
  ketchup:  ['jar', 'Ketchup', 'ROT & WÜRZIG', '400 g', 'tomato', '#d83a2a', '#b01a14', '#fff3d6', '#ffffff', { lid: '#2b2b2b' }],
  crunchy:  ['box', 'Crunchy Flakes', 'KNUSPER-MAIS', '500 g', 'bowl', '#f2a81a', '#e8641a', '#2a8fd0', '#ffffff'],
  choco:    ['box', 'Choco Bombs', 'KAKAO-KISSEN', '375 g', 'bowl', '#6b3a1a', '#3a1c0a', '#e8a21a', '#ffffff'],
  hafer:    ['box', 'Haferflocken', 'ZARTE FLOCKEN', '500 g', 'leaf', '#e8d8a8', '#c4a860', '#2f8f3a', '#4a3010'],
  cluckin:  ['box', 'Cluckin Bell', 'CRISPY NUGGETS', '450 g', 'drum', '#e8201a', '#a50f0a', '#ffd21f', '#ffffff'],
  pasta:    ['box', 'Pasta Bella', 'SPAGHETTI N°5', '500 g', 'noodle', '#2a8f4a', '#16652e', '#f2c21a', '#ffffff'],
  taco:     ['box', 'Taco Bomb', 'TACO KIT', '300 g', 'chip', '#8f2fd0', '#561a8a', '#ffd21f', '#ffffff'],
  kraecker: ['box2', 'Kräcker', 'MIT MEERSALZ', '200 g', 'chip', '#c8742a', '#8f4a14', '#5a2a0a', '#ffffff'],
  tee:      ['box2', 'Pfefferminz', 'TEE · 20 BEUTEL', '40 g', 'leaf', '#2a9a8a', '#16685c', '#0f4a40', '#ffffff'],
  reis:     ['box2', 'Reis Natur', 'LANGKORN', '1 kg', 'corn', '#e8e0c8', '#b8a870', '#c9302c', '#4a3010'],
  seife:    ['box2', 'Sauber+', 'SEIFE · 4 STÜCK', '4 x 90 g', 'hex', '#4aa8e0', '#2a6fb8', '#1a4a8a', '#ffffff'],
  phat:     ['bag', 'Phat Chips', 'SALZ', '175 g', 'chip', '#f2c21a', '#e8901a', '#d11a24', '#d11a24'],
  phat2:    ['bag', 'Phat Chips', 'PAPRIKA', '175 g', 'chip', '#d11a24', '#8f0b14', '#f2c21a', '#ffffff'],
  erdn:     ['bag', 'Erdnüsse', 'GESALZEN', '250 g', 'nut', '#b8742a', '#7a4a14', '#5a3a10', '#ffffff'],
  gummi:    ['bag', 'Gummibären', 'FRUCHTMIX', '200 g', 'bear', '#e8307a', '#a8145a', '#ffd21f', '#ffffff'],
  toast:    ['bag', 'Toastbrot', 'VOLLKORN', '500 g', 'bread', '#c89a5a', '#8a5a24', '#6a3a14', '#ffffff'],
  tacochip: ['bag', 'Taco Chips', 'NACHO CHEESE', '200 g', 'chip', '#ff7a1a', '#c94a0a', '#ffd21f', '#ffffff'],
  milch:    ['carton', 'Frische Milch', '3,5 % FETT', '1 L', 'milk', '#f4f8ff', '#cfe0f5', '#2a64b8', '#1f4a8f', { sc: 1.12 }],
  milch2:   ['carton', 'Milch', 'FETTARM 1,5 %', '1 L', 'milk', '#e8f4ff', '#b8dcf5', '#2fa84a', '#16652e', { sc: 1.12 }],
  osaftc:   ['carton', 'O-Saft', '100 % FRUCHT', '1 L', 'orange', '#ffb13a', '#ff8f1a', '#2f9a3a', '#ffffff', { sc: 1.12 }],
  apfel:    ['carton', 'Apfelsaft', 'NATÜRLICH TRÜB', '1 L', 'apple', '#f2e08a', '#b8c93a', '#c9302c', '#4a3010', { sc: 1.12 }],
  sahne:    ['carton', 'Sahne', '30 % FETT', '250 ml', 'milk', '#fff3e0', '#f2d8a8', '#c9302c', '#8a0f1e', { sc: 0.8 }],
};
const PKEYS = Object.keys(PDEFS), PCELL = {}; PKEYS.forEach((k, i) => { PCELL[k] = i; });
const PTAG0 = 56, PRICES = ['0,79', '0,99', '1,29', '1,49', '1,99', '2,49', '2,99', '3,49'];
const PD = k => { const a = PDEFS[k], T = PTYPES[a[0]], o = a[9] || {}, sc = o.sc || 1; return { id: k, t: a[0], brand: a[1], sub: a[2], vol: a[3], pic: a[4], c1: a[5], c2: a[6], c3: a[7], tx: a[8], cap: o.cap, lid: o.lid, sc, w: T.w * sc, h: T.h * sc, d: T.d * sc, T }; };
const PDC = {}; PKEYS.forEach(k => { PDC[k] = PD(k); });
// Regal-Kategorien: je Ebene (unten -> oben) eine Liste erlaubter Produkte
const PCATS = {
  soda:   [['ecola15', 'sprunk15', 'ecola15', 'osaft'], ['ecola', 'sprunk', 'ecolaP', 'ofizz', 'raineS'], ['meteor', 'ego', 'ecola', 'sprunk', 'ofizz'], ['eistee', 'osaft', 'ecolaP', 'raineP']],
  water:  [['raine15', 'raine15', 'sprunk15'], ['raine15', 'raineP', 'raineP'], ['raineP', 'WB', 'raineS', 'WB'], ['WB', 'raineP', 'WB']],
  beer:   [['pisswasb', 'loggerb', 'egob'], ['pisswasb', 'loggerb', 'egob', 'pisswas'], ['pisswas', 'loggerc', 'pisswasb', 'loggerc'], ['loggerc', 'pisswas', 'meteor']],
  snack:  [['phat', 'phat2', 'tacochip', 'toast'], ['phat', 'phat2', 'erdn', 'gummi'], ['gummi', 'erdn', 'kraecker', 'tacochip'], ['kraecker', 'gummi', 'erdn']],
  cereal: [['hafer', 'crunchy', 'choco', 'pasta'], ['crunchy', 'choco', 'hafer', 'cluckin'], ['choco', 'crunchy', 'taco', 'cluckin'], ['taco', 'choco', 'crunchy']],
  canned: [['tomaten', 'bohnen', 'mais', 'thunfisch'], ['mais', 'tomaten', 'thunfisch', 'bohnen'], ['gurken', 'ketchup', 'tomaten'], ['marmel', 'gurken', 'ketchup']],
  dairy:  [['milch', 'milch2', 'osaftc', 'apfel'], ['milch', 'milch2', 'sahne', 'osaftc'], ['apfel', 'osaftc', 'sahne', 'milch'], ['sahne', 'apfel', 'milch2']],
  pantry: [['reis', 'pasta', 'hafer', 'tee'], ['kaffee', 'honig', 'erdnuss', 'marmel'], ['erdnuss', 'honig', 'kaffee', 'marmel'], ['tee', 'seife', 'kraecker', 'reis']],
};
const PCOLD = ['ecola', 'sprunk', 'meteor', 'ego', 'raineS', 'ofizz', 'pisswas', 'ecolaP', 'raineP', 'osaftc', 'milch', 'apfel', 'pisswasb', 'loggerb'];

// ---------- Etiketten ----------
const gradv = (c, x0, y0, x1, y1, a, b) => { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
const ptxt = (c, s, x, y, maxW, px, col, stroke, font = '900') => {
  const f = p => `${font} ${p}px "Arial Black","Helvetica Neue",Arial,sans-serif`; c.font = f(px);
  const w = c.measureText(s).width; if (w > maxW) c.font = f(px * maxW / w);
  c.lineJoin = 'round'; if (stroke) { c.lineWidth = stroke[1]; c.strokeStyle = stroke[0]; c.strokeText(s, x, y); }
  c.fillStyle = col; c.fillText(s, x, y);
};
const pbarcode = (c, x, y, w, h) => { c.fillStyle = '#fff'; c.fillRect(x, y, w, h); c.fillStyle = '#111'; let p = x + 2; for (let i = 0; p < x + w - 2; i++) { const bw = 0.5 + ((i * 7) % 3) * 0.45; c.fillRect(p, y + 2, bw, h - 4 - (i % 9 === 0 ? 0 : 0)); p += bw + 0.5 + ((i * 5) % 2) * 0.4; } };
const pnutri = (c, x, y, w, col) => { c.fillStyle = col; for (let i = 0; i < 6; i++) c.fillRect(x, y + i * 3.2, w * (0.55 + ((i * 3) % 4) * 0.1), 1.1); };
function picon(c, n, x, y, s) { // einfache Vektor-Motive, zentriert, Kantenlänge s
  c.save(); c.translate(x, y); c.scale(s / 100, s / 100); c.lineJoin = 'round';
  const circ = (cx, cy, r, f) => { c.fillStyle = f; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.fill(); };
  const ell = (cx, cy, rx, ry, f, rot = 0) => { c.fillStyle = f; c.beginPath(); c.ellipse(cx, cy, rx, ry, rot, 0, 7); c.fill(); };
  if (n === 'bubbles') { for (const [a, b, r] of [[-20, 10, 22], [18, -14, 16], [24, 28, 11], [-30, -28, 9], [2, 40, 8], [0, -34, 7]]) { circ(a, b, r, 'rgba(255,255,255,.28)'); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 4; c.beginPath(); c.arc(a, b, r, 0, 7); c.stroke(); } }
  else if (n === 'drop') { c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -46); c.bezierCurveTo(34, -2, 40, 18, 28, 34); c.bezierCurveTo(14, 54, -14, 54, -28, 34); c.bezierCurveTo(-40, 18, -34, -2, 0, -46); c.fill(); c.fillStyle = 'rgba(90,170,230,.55)'; c.beginPath(); c.arc(-8, 22, 14, 0, 7); c.fill(); }
  else if (n === 'bolt') { c.fillStyle = '#ffd21f'; c.strokeStyle = '#000'; c.lineWidth = 4; c.beginPath(); c.moveTo(10, -50); c.lineTo(-26, 6); c.lineTo(-2, 6); c.lineTo(-12, 50); c.lineTo(28, -12); c.lineTo(4, -12); c.closePath(); c.fill(); c.stroke(); }
  else if (n === 'star') { c.fillStyle = '#c9302c'; c.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? 20 : 46; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); circ(0, 0, 12, '#fff'); }
  else if (n === 'orange') { circ(0, 4, 40, '#ff8f1a'); circ(0, 4, 33, '#ffb13a'); c.fillStyle = '#ff8f1a'; for (let i = 0; i < 8; i++) { c.save(); c.translate(0, 4); c.rotate(i * Math.PI / 4); c.fillRect(-1.5, 0, 3, 31); c.restore(); } ell(14, -40, 18, 8, '#2f9a3a', -0.5); }
  else if (n === 'tomato') { circ(0, 8, 40, '#e0301e'); circ(-12, -4, 12, 'rgba(255,255,255,.3)'); c.fillStyle = '#2f9a3a'; c.beginPath(); for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, r = i % 2 ? 6 : 22; c.lineTo(Math.cos(a) * r, -30 + Math.sin(a) * r * 0.5); } c.closePath(); c.fill(); }
  else if (n === 'corn') { ell(0, 0, 24, 46, '#f2c21a'); c.fillStyle = '#d9a208'; for (let i = -3; i <= 3; i++) for (let j = -5; j <= 5; j++) c.fillRect(i * 6.5 - 2, j * 8 - 2.5, 4, 5); ell(-22, 18, 16, 38, '#5fb04a', -0.35); ell(22, 18, 16, 38, '#4a9a3a', 0.35); }
  else if (n === 'bean') { for (const [a, b, r] of [[-22, -14, -0.6], [18, -18, 0.4], [-8, 14, 0.2], [26, 18, -0.5]]) { ell(a, b, 14, 24, '#f4ead0', r); ell(a + 3, b - 3, 4, 8, 'rgba(255,255,255,.7)', r); } }
  else if (n === 'fish') { ell(-6, 0, 38, 20, '#9fc0e0'); c.fillStyle = '#9fc0e0'; c.beginPath(); c.moveTo(28, 0); c.lineTo(52, -22); c.lineTo(52, 22); c.fill(); circ(-26, -4, 4, '#111'); c.fillStyle = '#2a64b8'; c.fillRect(-4, -20, 6, 40); }
  else if (n === 'bowl') { ell(0, 14, 44, 18, '#f4f4f4'); c.fillStyle = '#f4f4f4'; c.beginPath(); c.moveTo(-44, 14); c.quadraticCurveTo(0, 74, 44, 14); c.fill(); c.fillStyle = '#e8641a'; for (const [a, b] of [[-26, 4], [-10, -4], [10, -6], [26, 4], [0, 8], [-18, 12], [18, 12], [-30, -6], [32, -8]]) { ell(a, b, 9, 7, '#f0a830', a * 0.05); } ell(0, -26, 22, 6, 'rgba(255,255,255,.55)'); circ(-14, -28, 5, '#f4f4f4'); circ(10, -30, 4, '#f4f4f4'); }
  else if (n === 'milk') { c.fillStyle = '#fff'; c.beginPath(); c.moveTo(-44, 24); c.bezierCurveTo(-44, -8, -20, -40, -8, -6); c.bezierCurveTo(0, -46, 22, -40, 20, -4); c.bezierCurveTo(30, -26, 48, -10, 44, 24); c.bezierCurveTo(30, 44, -30, 44, -44, 24); c.fill(); circ(-18, 16, 5, 'rgba(120,170,230,.5)'); circ(10, 20, 4, 'rgba(120,170,230,.5)'); circ(26, 8, 3, 'rgba(120,170,230,.5)'); }
  else if (n === 'chip') { for (const [a, b, r] of [[-22, -14, -0.4], [20, -10, 0.5], [0, 22, 0.1]]) { c.save(); c.translate(a, b); c.rotate(r); ell(0, 0, 30, 24, '#ffd54a'); ell(-4, -3, 22, 16, '#f2b823'); circ(-8, -4, 2.5, '#d9961a'); circ(8, 6, 2.5, '#d9961a'); circ(4, -8, 2, '#d9961a'); c.restore(); } }
  else if (n === 'nut') { for (const [a, b, r] of [[-20, -10, -0.5], [18, -16, 0.6], [-4, 18, 0.1], [26, 20, -0.8]]) { ell(a, b, 22, 15, '#d8a864', r); ell(a - 2, b - 2, 18, 10, '#e8c080', r); c.strokeStyle = '#a8742a'; c.lineWidth = 2; c.beginPath(); c.moveTo(a - 12, b); c.lineTo(a + 12, b); c.stroke(); } }
  else if (n === 'bear') { for (const [a, b, col] of [[-22, 6, '#ff3a5a'], [24, 10, '#ffd21f']]) { circ(a, b, 22, col); circ(a - 16, b - 22, 9, col); circ(a + 16, b - 22, 9, col); ell(a, b + 5, 12, 9, 'rgba(255,255,255,.35)'); circ(a - 7, b - 4, 3, '#111'); circ(a + 7, b - 4, 3, '#111'); circ(a, b + 6, 3, '#111'); } circ(0, -22, 18, '#3ac04a'); circ(-13, -38, 7, '#3ac04a'); circ(13, -38, 7, '#3ac04a'); }
  else if (n === 'bread') { c.fillStyle = '#d8a458'; c.beginPath(); c.roundRect(-44, -14, 88, 56, 14); c.fill(); c.beginPath(); c.arc(-24, -14, 20, Math.PI, 0); c.arc(24, -14, 20, Math.PI, 0); c.fill(); ell(0, 14, 34, 22, '#f4dcaa'); c.strokeStyle = '#a8742a'; c.lineWidth = 3; c.beginPath(); c.moveTo(-44, -14); c.lineTo(-44, 36); c.stroke(); }
  else if (n === 'noodle') { c.strokeStyle = '#f6d878'; c.lineWidth = 6; for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(i * 9, -44); c.bezierCurveTo(i * 9 + 14, -20, i * 9 - 14, 10, i * 9, 44); c.stroke(); } circ(-30, 30, 18, '#e0301e'); circ(-34, 24, 5, 'rgba(255,255,255,.4)'); }
  else if (n === 'coffee') { ell(0, 18, 40, 14, '#fff'); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(-34, -14); c.lineTo(34, -14); c.lineTo(26, 24); c.quadraticCurveTo(0, 34, -26, 24); c.fill(); ell(0, -14, 34, 8, '#3a1c0a'); c.strokeStyle = '#fff'; c.lineWidth = 6; c.beginPath(); c.arc(38, 2, 12, -1.2, 1.2); c.stroke(); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 4; c.beginPath(); c.moveTo(-10, -26); c.bezierCurveTo(-18, -36, -2, -42, -10, -52); c.moveTo(8, -26); c.bezierCurveTo(0, -36, 16, -42, 8, -52); c.stroke(); }
  else if (n === 'leaf') { ell(-10, 4, 20, 40, '#3aa04a', 0.6); ell(16, -2, 18, 36, '#58c05a', -0.5); c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(-22, 34); c.lineTo(2, -28); c.moveTo(10, 30); c.lineTo(24, -26); c.stroke(); }
  else if (n === 'hex') { for (const [a, b] of [[0, 0], [-34, -18], [34, -18], [0, -36], [-34, 20], [34, 20], [0, 38]]) { c.fillStyle = a === 0 && b === 0 ? '#f2b01e' : '#ffd54a'; c.beginPath(); for (let i = 0; i < 6; i++) { const t = i * Math.PI / 3 + Math.PI / 6; c.lineTo(a + Math.cos(t) * 20, b + Math.sin(t) * 20); } c.closePath(); c.fill(); } }
  else if (n === 'berry') { for (const [a, b] of [[-18, 6], [18, 8], [0, -18]]) { c.fillStyle = '#d8142a'; c.beginPath(); c.moveTo(a, b + 30); c.bezierCurveTo(a - 34, b + 8, a - 24, b - 24, a, b - 18); c.bezierCurveTo(a + 24, b - 24, a + 34, b + 8, a, b + 30); c.fill(); ell(a, b - 22, 10, 5, '#2f9a3a'); circ(a - 6, b, 2, '#ffd2a0'); circ(a + 7, b + 8, 2, '#ffd2a0'); circ(a, b + 14, 2, '#ffd2a0'); } }
  else if (n === 'apple') { circ(-12, 6, 30, '#c9302c'); circ(14, 6, 30, '#c9302c'); circ(-4, -6, 10, 'rgba(255,255,255,.25)'); c.strokeStyle = '#5a3a1a'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, -18); c.lineTo(4, -38); c.stroke(); ell(18, -34, 16, 7, '#3aa04a', -0.4); }
  else if (n === 'drum') { for (const r of [-0.5, 0.5]) { c.save(); c.rotate(r); ell(0, -4, 20, 34, '#e0902a'); ell(0, 24, 8, 8, '#f4f4f4'); circ(-6, -10, 4, '#f2b050'); c.restore(); } }
  c.restore();
}
// Front-Gestaltung je Typ (Koordinaten in mm der Etikettenfläche; Wickel-Typen haben die Front bei x = W/2)
const PART = {
  can(c, d, W, H) {
    c.fillStyle = gradv(c, 0, 0, 0, H, d.c1, d.c2); c.fillRect(0, 0, W, H);
    c.fillStyle = d.c3; c.beginPath(); c.moveTo(0, H * 0.72); for (let x = 0; x <= W; x += 5) c.lineTo(x, H * 0.72 + Math.sin(x / W * Math.PI * 8) * 3.5); c.lineTo(W, H * 0.78); for (let x = W; x >= 0; x -= 5) c.lineTo(x, H * 0.78 + Math.sin(x / W * Math.PI * 8) * 3.5); c.fill();
    const cx = W / 2; c.textAlign = 'center'; c.textBaseline = 'middle';
    ptxt(c, d.brand, cx, 34, 62, 26, d.tx, [d.c2, 4]); ptxt(c, d.sub, cx, 49, 58, 8, d.tx, null, 'bold'); picon(c, d.pic, cx, 76, 32); ptxt(c, d.vol, cx, 100, 40, 9, d.tx, null, 'bold');
    for (const bx of [-18, W - 18]) { pbarcode(c, bx, 72, 36, 22); ptxt(c, 'PFAND 0,25 €', bx + 18, 60, 36, 6, d.tx, null, 'bold'); }
    pnutri(c, W * 0.25 - 12, 50, 24, 'rgba(255,255,255,.7)'); pnutri(c, W * 0.75 - 12, 50, 24, 'rgba(255,255,255,.7)');
    c.fillStyle = gradv(c, 0, 0, 0, 7, '#f4f6f8', '#aab1b8'); c.fillRect(0, 0, W, 7); c.fillStyle = gradv(c, 0, H - 7, 0, H, '#aab1b8', '#f4f6f8'); c.fillRect(0, H - 7, W, 7);
  },
  tin(c, d, W, H) {
    c.fillStyle = d.c1; c.fillRect(0, 0, W, H); c.fillStyle = gradv(c, 0, 0, 0, H, 'rgba(255,255,255,.12)', 'rgba(0,0,0,.2)'); c.fillRect(0, 0, W, H);
    const cx = W / 2; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = d.c3; c.fillRect(0, 7, W, 3); c.fillRect(0, H - 10, W, 3);
    ptxt(c, d.brand, cx, 24, 76, 20, '#fff', [d.c2, 3]); c.fillStyle = d.c3; c.beginPath(); c.arc(cx, 62, 25, 0, 7); c.fill(); c.fillStyle = d.c2; c.beginPath(); c.arc(cx, 62, 22, 0, 7); c.fill(); picon(c, d.pic, cx, 62, 38);
    ptxt(c, d.sub, cx, 93, 76, 7, '#fff', null, 'bold'); ptxt(c, d.vol, cx + 52, 62, 24, 8, '#fff', null, 'bold'); pbarcode(c, -16, 40, 32, 30); pbarcode(c, W - 16, 40, 32, 30);
    c.fillStyle = gradv(c, 0, 0, 0, 5, '#f4f6f8', '#aab1b8'); c.fillRect(0, 0, W, 5); c.fillStyle = gradv(c, 0, H - 5, 0, H, '#aab1b8', '#f4f6f8'); c.fillRect(0, H - 5, W, 5);
  },
  bottle(c, d, W, H) {
    c.fillStyle = gradv(c, 0, 0, 0, H, d.c2, d.c2); c.fillRect(0, 0, W, H); c.fillStyle = 'rgba(255,255,255,.15)'; c.fillRect(W * 0.46, 40, 7, 150); // Flüssigkeit + Glanz
    c.fillStyle = d.cap || d.c1; c.fillRect(0, 0, W, 19); c.fillStyle = 'rgba(0,0,0,.25)'; for (let x = 0; x < W; x += 4) c.fillRect(x, 3, 1.4, 12);
    const y0 = 88, y1 = 176; c.fillStyle = d.c1; c.fillRect(0, y0, W, y1 - y0); c.fillStyle = d.c3; c.fillRect(0, y0, W, 4); c.fillRect(0, y1 - 4, W, 4);
    const cx = W / 2; c.textAlign = 'center'; c.textBaseline = 'middle';
    ptxt(c, d.brand, cx, y0 + 19, 62, 21, d.tx, [d.c1 === '#ffffff' ? '#888' : 'rgba(0,0,0,.35)', 3]); ptxt(c, d.sub, cx, y0 + 33, 58, 7, d.tx, null, 'bold'); picon(c, d.pic, cx, y0 + 55, 34); ptxt(c, d.vol, cx, y1 - 8, 40, 9, d.tx, null, 'bold');
    for (const bx of [-17, W - 17]) { pbarcode(c, bx, y0 + 28, 34, 24); } pnutri(c, W * 0.25 - 12, y0 + 12, 24, 'rgba(255,255,255,.75)'); pnutri(c, W * 0.75 - 12, y0 + 12, 24, 'rgba(255,255,255,.75)');
  },
  beer(c, d, W, H) {
    c.fillStyle = gradv(c, 0, 0, 0, H, d.c2, '#000'); c.fillRect(0, 0, W, H); c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(W * 0.43, 60, 6, 120);
    c.fillStyle = '#d6a640'; c.fillRect(0, 0, W, 12); c.fillStyle = 'rgba(0,0,0,.3)'; for (let x = 0; x < W; x += 6) c.fillRect(x, 0, 2, 12);
    const cx = W / 2; c.fillStyle = d.c3 === '#1a1a1a' ? '#d6a640' : d.c3; c.fillRect(0, 36, W, 18);
    c.fillStyle = d.c1; c.beginPath(); c.roundRect(cx - 42, 78, 84, 82, 10); c.fill(); c.strokeStyle = '#d6a640'; c.lineWidth = 2; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle'; ptxt(c, d.brand, cx, 98, 74, 17, d.tx, null); ptxt(c, d.sub, cx, 112, 70, 6.5, d.tx, null, 'bold'); picon(c, d.pic, cx, 135, 28); ptxt(c, d.vol, cx, 153, 30, 7.5, d.tx, null, 'bold'); ptxt(c, d.brand, cx, 45, 80, 9, d.tx === '#1a1a1a' ? '#fff' : d.tx, null);
    pbarcode(c, -14, 100, 28, 30); pbarcode(c, W - 14, 100, 28, 30);
  },
  jar(c, d, W, H) {
    c.fillStyle = gradv(c, 0, 0, 0, H, d.c2, d.c2); c.fillRect(0, 0, W, H); c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(W * 0.47, 20, 6, 70);
    c.fillStyle = d.lid || d.c3; c.fillRect(0, 0, W, 18); c.fillStyle = 'rgba(0,0,0,.25)'; for (let x = 0; x < W; x += 4) c.fillRect(x, 2, 1.4, 14); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, 17, W, 1.5);
    c.fillStyle = d.c1; c.fillRect(0, 30, W, 56); c.fillStyle = d.c3; c.fillRect(0, 30, W, 3); c.fillRect(0, 83, W, 3);
    const cx = W / 2; c.textAlign = 'center'; c.textBaseline = 'middle'; ptxt(c, d.brand, cx, 44, 72, 17, d.tx, null); ptxt(c, d.sub, cx, 56, 66, 6.5, d.tx, null, 'bold'); picon(c, d.pic, cx - 44, 62, 28); picon(c, d.pic, cx + 44, 62, 28); ptxt(c, d.vol, cx, 76, 40, 7, d.tx, null, 'bold');
    pbarcode(c, -14, 38, 28, 40); pbarcode(c, W - 14, 38, 28, 40);
  },
  box(c, d, W, H, o = {}) {
    c.fillStyle = gradv(c, 0, 0, W, H, d.c1, d.c2); c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.arc(W / 2, H * 0.55, W * 0.36, 0, 7); c.fill();
    c.fillStyle = d.c3; c.fillRect(0, H * 0.05, W, H * 0.2); c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(0, H * 0.25, W, 3);
    c.textAlign = 'center'; c.textBaseline = 'middle'; ptxt(c, d.brand, W / 2, H * 0.15, W * 0.9, W * 0.2, '#fff', ['rgba(0,0,0,.55)', W * 0.03]);
    picon(c, d.pic, W / 2, H * 0.52, W * 0.62);
    c.fillStyle = d.c3; c.beginPath(); c.roundRect(W * 0.06, H * 0.77, W * 0.88, H * 0.1, 4); c.fill(); ptxt(c, d.sub, W / 2, H * 0.82, W * 0.82, W * 0.075, '#fff', null);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(W * 0.84, H * 0.37, W * 0.1, 0, 7); c.fill(); ptxt(c, d.vol, W * 0.84, H * 0.37, W * 0.17, W * 0.05, '#222', null, 'bold');
    ptxt(c, 'NEU', W * 0.14, H * 0.37, W * 0.18, W * 0.07, '#ffd21f', ['#000', 2]);
    if (o.crimp) { c.fillStyle = 'rgba(255,255,255,.28)'; c.fillRect(0, 0, W, H * 0.045); c.fillRect(0, H * 0.955, W, H * 0.045); c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 0.8; for (let x = 0; x < W; x += 3) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H * 0.045); c.moveTo(x, H * 0.955); c.lineTo(x, H); c.stroke(); } c.fillStyle = gradv(c, 0, 0, W, 0, 'rgba(255,255,255,.18)', 'rgba(0,0,0,.12)'); c.fillRect(0, 0, W, H); }
    pbarcode(c, W * 0.06, H * 0.9, W * 0.28, H * 0.05);
  },
  carton(c, d, W, H) {
    c.fillStyle = gradv(c, 0, 0, 0, H, d.c1, d.c2); c.fillRect(0, 0, W, H);
    c.fillStyle = d.c3; c.fillRect(0, 0, W, 22); c.fillRect(0, H - 26, W, 26);
    c.textAlign = 'center'; c.textBaseline = 'middle'; { const bw = d.brand.split(' '); if (bw.length > 1) { ptxt(c, bw[0], W / 2, 36, W * 0.92, 17, d.tx, null); ptxt(c, bw.slice(1).join(' '), W / 2, 53, W * 0.92, 17, d.tx, null); } else ptxt(c, d.brand, W / 2, 44, W * 0.92, 19, d.tx, null); } picon(c, d.pic, W / 2, 86, 44); ptxt(c, d.sub, W / 2, 120, W * 0.9, 6.5, d.tx, null, 'bold');
    c.fillStyle = '#fff'; c.beginPath(); c.arc(W * 0.5, 146, 12, 0, 7); c.fill(); ptxt(c, d.vol, W / 2, 146, 20, 7, '#222', null, 'bold'); ptxt(c, 'HALTBAR', W / 2, H - 13, 50, 7, '#fff', null, 'bold');
  },
};
PART.box2 = PART.box; PART.bag = (c, d, W, H) => PART.box(c, d, W, H, { crimp: true });
function ptag(c, i) { // Preisschild: weiß, gelb mit rotem Preis bei Angebot
  const W = 60, H = 28, sale = i % 3 === 2; c.fillStyle = sale ? '#ffe14a' : '#ffffff'; c.fillRect(0, 0, W, H);
  c.fillStyle = sale ? '#d11a24' : '#222'; c.textAlign = 'center'; c.textBaseline = 'middle'; ptxt(c, PRICES[i % 8], 22, 15, 36, 22, sale ? '#d11a24' : '#111', null); ptxt(c, '€', 49, 15, 12, 14, sale ? '#d11a24' : '#111', null, 'bold');
  c.fillStyle = sale ? '#d11a24' : '#888'; c.fillRect(3, 2, sale ? 54 : 12, 3); ptxt(c, sale ? 'ANGEBOT' : 'je Stück', 30, 26, 40, 3.5, '#444', null, 'bold');
}
function prodAtlas() {
  if (PRODTEX) return PRODTEX;
  const cv = document.createElement('canvas'); cv.width = cv.height = PA; const c = cv.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, PA, PA);
  const cell = (i, draw, brandCol, art) => {
    const x0 = (i % 8) * PC, y0 = Math.floor(i / 8) * PC; c.save(); c.beginPath(); c.rect(x0, y0, PC, PC); c.clip();
    c.fillStyle = brandCol; c.fillRect(x0, y0, PC / 2, PSTRIP); c.fillStyle = '#c9ced3'; c.fillRect(x0 + PC / 2, y0, PC / 2, PSTRIP);
    c.translate(x0, y0 + PSTRIP); c.scale(PC / art[0], (PC - PSTRIP) / art[1]); c.textAlign = 'center'; c.textBaseline = 'middle'; draw(art); c.restore();
  };
  PKEYS.forEach((k, i) => { const d = PDC[k]; cell(i, a => PART[d.t](c, d, a[0], a[1]), d.c1, d.T.art); });
  for (let i = 0; i < 8; i++) cell(PTAG0 + i, a => ptag(c, i), '#ffffff', PTYPES.tag.art);
  PRODTEX = new THREE.CanvasTexture(cv); PRODTEX.colorSpace = THREE.SRGBColorSpace; PRODTEX.anisotropy = typeof ANISO !== 'undefined' ? ANISO : 4; PRODTEX.wrapS = PRODTEX.wrapT = THREE.ClampToEdgeWrapping;
  return PRODTEX;
}
function prodMat() {
  if (PRODMAT) return PRODMAT;
  PRODMAT = new THREE.MeshStandardMaterial({ map: prodAtlas(), roughness: 0.38, metalness: 0.08 });
  PRODMAT.onBeforeCompile = sh => { // Etiketten-Zelle je Instanz (aCell) im Atlas
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aCell;').replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = uv * vec2(0.125) + aCell;\n#endif');
  };
  PRODMAT.customProgramCacheKey = () => 'prodatlas';
  return PRODMAT;
}
// ---------- Geometrien (einmal gebaut, je Etage geklont) ----------
const PIN = 2 / PC; // UV-Einzug gegen Bluten zwischen Zellen
const puvArt = (u, v) => [PIN + u * (1 - 2 * PIN), PIN + v * (PART_V - 2 * PIN)];
const puvStrip = (silver = false) => [silver ? 0.75 : 0.25, 1 - PSTRIP / PC / 2];
function pLathe(T) {
  const g = new THREE.LatheGeometry(lathePts(T.lathe), T.seg); g.rotateY(Math.PI); // u = 0.5 zeigt nach +z (Front)
  const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) { const a = puvArt(uv.getX(i), p.getY(i) / T.h); uv.setXY(i, a[0], a[1]); }
  return g.toNonIndexed();
}
function pBox(T, bag) {
  const g = bag ? new THREE.BoxGeometry(T.w, T.h, T.d, 1, 8, 1) : new THREE.BoxGeometry(T.w, T.h, T.d), p = g.attributes.position, uv = g.attributes.uv;
  if (bag) for (let i = 0; i < p.count; i++) { const t = (p.getY(i) + T.h / 2) / T.h, f = Math.max(0.1, Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.45)); p.setZ(i, p.getZ(i) * f); p.setX(i, p.getX(i) * (0.94 + 0.06 * f)); }
  const fc = bag ? [18, 18, 4, 4, 18, 18] : [4, 4, 4, 4, 4, 4]; let face = 0, lim = fc[0]; // Flächen-Reihenfolge px,nx,py,ny,pz,nz
  for (let i = 0; i < p.count; i++) { if (i >= lim) lim += fc[++face]; const a = face === 4 ? puvArt(uv.getX(i), uv.getY(i)) : puvStrip(); uv.setXY(i, a[0], a[1]); }
  if (bag) g.computeVertexNormals(); return g.toNonIndexed();
}
function pCarton(T) {
  const hw = T.w / 2, hd = T.d / 2, bh = 0.18, rh = 0.05, parts = [], body = new THREE.BoxGeometry(T.w, bh, T.d); body.translate(0, bh / 2, 0);
  { const p = body.attributes.position, uv = body.attributes.uv; for (let i = 0; i < p.count; i++) { const face = Math.floor(i / 4), a = face === 4 ? puvArt(uv.getX(i), uv.getY(i)) : puvStrip(); uv.setXY(i, a[0], a[1]); } }
  parts.push(body.toNonIndexed());
  const pos = [], tri = (a, b, c2) => { pos.push(...a, ...b, ...c2); };
  const A = [-hw, bh, hd], B = [hw, bh, hd], C = [-hw, bh + rh, 0], D = [hw, bh + rh, 0], E = [-hw, bh, -hd], F = [hw, bh, -hd];
  tri(A, B, D); tri(A, D, C); tri(F, E, C); tri(F, C, D); tri(E, A, C); tri(B, F, D);
  const roof = new THREE.BufferGeometry(); roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); roof.computeVertexNormals();
  const su = puvStrip(); roof.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0).map((_, i) => i % 2 ? su[1] : su[0]), 2)); parts.push(roof);
  const fin = new THREE.BoxGeometry(T.w, 0.012, 0.01); fin.translate(0, bh + rh + 0.006, 0); { const uv = fin.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, su[0], su[1]); } parts.push(fin.toNonIndexed());
  return mergeGeometries(parts);
}
function pGeo(t) {
  if (!PRODGEO) PRODGEO = {};
  if (PRODGEO[t]) return PRODGEO[t];
  const T = PTYPES[t]; return (PRODGEO[t] = T.lathe ? pLathe(T) : t === 'carton' ? pCarton(T) : pBox(T, t === 'bag'));
}
// ---------- Bestand (Instanzen sammeln, am Ende bauen) ----------
function newStock() { return { t: {}, m: {}, o: [], n: 0 }; }
// Ganze Orangen: einfache Kugel mit Poren-Textur (das Khronos-Mandarinenmodell ist eine geschälte Frucht und wird nur als Deko-Akzent eingestreut)
let ORGEO = null, ORMAT = null;
function orangeKit() {
  if (ORGEO) return;
  ORGEO = new THREE.SphereGeometry(0.5, 10, 8); const p = ORGEO.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + 0.025 * Math.sin(p.getX(i) * 29 + p.getY(i) * 17) * Math.cos(p.getZ(i) * 23); p.setXYZ(i, p.getX(i) * k, p.getY(i) * 0.94 * k, p.getZ(i) * k); } ORGEO.computeVertexNormals();
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const c = cv.getContext('2d');
  c.fillStyle = gradv(c, 0, 0, 0, 128, '#f58c10', '#ea7a08'); c.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 1400; i++) { c.fillStyle = i % 3 ? 'rgba(255,200,90,.35)' : 'rgba(150,60,0,.28)'; c.beginPath(); c.arc(Math.random() * 256, 10 + Math.random() * 108, 0.7 + Math.random() * 1.1, 0, 7); c.fill(); }
  c.fillStyle = '#5b6a1c'; c.fillRect(0, 0, 256, 7); c.fillStyle = '#8a5a14'; c.fillRect(0, 121, 256, 7);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; ORMAT = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0 });
}
function stockOrange(S, x, y, z, rx, ry, rz, sc) { S.o.push(x, y, z, rx, ry, rz, sc); S.n++; }
function stockAdd(S, id, x, y, z, yaw, s = 1) { // id = Produktschlüssel oder 'tag:<n>'
  const tag = id.startsWith('tag:'), t = tag ? 'tag' : PDC[id].t, cell = tag ? PTAG0 + (+id.slice(4)) : PCELL[id];
  (S.t[t] || (S.t[t] = [])).push(x, y, z, yaw, s * (tag ? 1 : PDC[id].sc), cell); S.n++;
}
// Echte Modelle (Obst, Fisch, Wasserflasche): Teile mit Knotenmatrix; Platzierung pivot 'base' (Fuß) oder 'center'
function modelParts(name) {
  const src = ASSETS.models[name]; if (!src) return null;
  if (!src.userData.parts) { src.updateMatrixWorld(true); const parts = []; src.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) parts.push({ geo: o.geometry, mat: o.material, m: o.matrixWorld.clone() }); }); src.userData.parts = parts; }
  return src.userData.parts;
}
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _E = new THREE.Euler(), _V = new THREE.Vector3(), _S = new THREE.Vector3(), _O = new THREE.Matrix4();
function stockModel(S, name, size, fit, x, y, z, rx, ry, rz, pivot = 'base', jit = 1) {
  const src = ASSETS.models[name]; if (!src || !modelParts(name)) return false;
  const sc = size / src.userData.size[fit] * jit, o = src.userData.offset;
  _E.set(rx, ry, rz, 'YXZ'); _Q.setFromEuler(_E); _V.set(x, y, z); _S.setScalar(sc);
  _M.compose(_V, _Q, _S); _O.makeTranslation(o.x, pivot === 'center' ? o.y - src.userData.size.y / 2 : o.y, o.z); _M.multiply(_O);
  const e = S.m[name] || (S.m[name] = []); e.push(_M.toArray()); S.n++; return true;
}
function stockFinish(S, g) { // Geometrie-Dispose (beim Etagen-Entladen) gibt auch die Instanz-Puffer frei
  const mm = new THREE.Matrix4(), link = (geo, mesh) => { const f = () => { geo.removeEventListener('dispose', f); mesh.dispose(); }; geo.addEventListener('dispose', f); };
  for (const t in S.t) {
    const a = S.t[t], n = a.length / 6, geo = pGeo(t).clone(), cell = new Float32Array(n * 2), mesh = new THREE.InstancedMesh(geo, prodMat(), n);
    for (let i = 0; i < n; i++) {
      const k = i * 6; _V.set(a[k], a[k + 1], a[k + 2]); _Q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, a[k + 3]); _S.setScalar(a[k + 4]); mm.compose(_V, _Q, _S); mesh.setMatrixAt(i, mm);
      const c = a[k + 5]; cell[i * 2] = (c % 8) * PC / PA; cell[i * 2 + 1] = 1 - (Math.floor(c / 8) + 1) * PC / PA;
    }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 2)); mesh.receiveShadow = true; mesh.name = 'prod_' + t; g.add(mesh); link(geo, mesh);
  }
  if (S.o.length) {
    orangeKit(); const n = S.o.length / 7, geo = ORGEO.clone(), mesh = new THREE.InstancedMesh(geo, ORMAT, n), col = new THREE.Color();
    for (let i = 0; i < n; i++) { const k = i * 7; _V.set(S.o[k], S.o[k + 1], S.o[k + 2]); _E.set(S.o[k + 3], S.o[k + 4], S.o[k + 5], 'YXZ'); _Q.setFromEuler(_E); _S.setScalar(S.o[k + 6]); mm.compose(_V, _Q, _S); mesh.setMatrixAt(i, mm); col.setRGB(1, 0.9 + 0.1 * ((i * 7) % 5) / 4, 0.8 + 0.2 * ((i * 3) % 4) / 3); mesh.setColorAt(i, col); }
    mesh.receiveShadow = true; mesh.name = 'prod_orange'; g.add(mesh); link(geo, mesh);
  }
  for (const name in S.m) {
    const arr = S.m[name], parts = modelParts(name);
    for (const p of parts) {
      const mesh = new THREE.InstancedMesh(p.geo, p.mat, arr.length);
      for (let i = 0; i < arr.length; i++) { mm.fromArray(arr[i]).multiply(p.m); mesh.setMatrixAt(i, mm); }
      mesh.receiveShadow = true; mesh.name = 'prod_' + name; g.add(mesh); link(p.geo, mesh);
    }
  }
}
// Regalfach bestücken: x0..x1 entlang des Regals, y = Brett-Oberseite, zs = Mittelachse, sg = Seite (+1/-1), lv = Ebene
function stockShelf(S, rng, x0, x1, y, zs, sg, cat, lv) {
  const list = PCATS[cat][lv], maxH = 0.385 - 0.005, yaw = sg > 0 ? 0 : Math.PI, front = 0.395; let x = x0 + 0.03, tg = 0;
  while (x < x1 - 0.06) {
    const key = list[Math.floor(rng() * list.length)], wb = key === 'WB', d = wb ? { w: 0.11, d: 0.11, h: 0.26, T: { rows: 2 } } : PDC[key];
    if (d.h > maxH) continue;
    const gap = 0.006, w = d.w + gap; let n = d.w < 0.1 ? 3 + Math.floor(rng() * 4) : d.w < 0.16 ? 2 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 2);
    n = Math.min(n, Math.floor((x1 - 0.03 - x) / w)); if (n < 1) break;
    const rows = Math.min(d.T.rows, Math.floor(0.36 / (d.d + 0.004)));
    for (let i = 0; i < n; i++) for (let r = 0; r < rows; r++) {
      const px = x + w * (i + 0.5), pz = zs + sg * (front - d.d / 2 - 0.004 - r * (d.d + 0.004));
      if (wb) stockModel(S, 'WaterBottleLow', 0.26, 'y', px, y, pz, 0, yaw + (rng() - 0.5) * 0.3, 0) || stockAdd(S, 'raineP', px, y, pz, yaw); else stockAdd(S, key, px, y, pz, yaw);
    }
    stockAdd(S, 'tag:' + ((PCELL[key] || 3) * 3 + tg++) % 8, x + 0.04, y - 0.0125, zs + sg * 0.4165, yaw, 1.1);
    x += n * w + 0.012 + (rng() < 0.05 ? 0.12 : 0);
  }
}
// Kühlschrank (Modellraum: Front +z, Böden bei y 0.415/0.725/1.085/1.445, Innenbreite x ±0.35, Tiefe z -0.16..0.29). (fx,fz,yaw) = Platz des Kühlschranks im Raum
function stockFridge(S, rng, fx, fz, yaw) {
  const ys = [0.415, 0.725, 1.085, 1.445], hs = [0.30, 0.335, 0.335, 0.35], c = Math.cos(yaw), s = Math.sin(yaw);
  for (let lv = 0; lv < 4; lv++) {
    let x = -0.34; const cand = PCOLD.filter(k => PDC[k].h <= hs[lv]);
    while (x < 0.34) {
      const d = PDC[cand[Math.floor(rng() * cand.length)]]; let n = Math.min(d.w < 0.1 ? 3 + Math.floor(rng() * 3) : 2 + Math.floor(rng() * 2), Math.floor((0.35 - x) / (d.w + 0.004))); if (n < 1) break;
      const rows = Math.min(3, Math.floor(0.45 / (d.d + 0.004)));
      for (let i = 0; i < n; i++) for (let r = 0; r < rows; r++) { const lx = x + (d.w + 0.004) * (i + 0.5), lz = 0.28 - d.d / 2 - r * (d.d + 0.004); stockAdd(S, d.id, fx + lx * c + lz * s, ys[lv], fz - lx * s + lz * c, yaw); }
      x += n * (d.w + 0.004) + 0.006;
    }
  }
}
// Obstkiste: Fläche w x d (Mitte cx,cz), Boden-Oberkante cy; Früchte im Sechseck-Raster mit Kuppel, zweite Lage teilweise
function stockCrate(S, rng, kind, cx, cy, cz, w, d, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), put = (lx, ly, lz, rx, ry, rz) => {
    const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c;
    if (kind === 'orange') { if (rng() < 0.07 && stockModel(S, 'MandarinOrange', 0.075, 'z', wx, cy + ly - 0.012, wz, 0, ry + yaw, 0, 'center')) return; stockOrange(S, wx, cy + ly, wz, rx, ry + yaw, rz, 0.068 * (0.93 + rng() * 0.14)); }
    else stockModel(S, 'Avocado', 0.09, 'y', wx, cy + ly, wz, rx, ry + yaw, rz, 'center', 0.92 + rng() * 0.16);
  };
  const pitch = kind === 'orange' ? 0.068 : 0.088, rad = kind === 'orange' ? 0.033 : 0.03;
  for (let layer = 0; layer < 2; layer++) {
    const off = layer ? pitch / 2 : 0, ny = Math.floor((d - rad * 2) / (pitch * 0.87)) + 1;
    for (let j = 0; j < ny; j++) {
      const rz = -d / 2 + rad + j * pitch * 0.87, shift = (j + layer) % 2 ? pitch / 2 : 0, nx = Math.floor((w - rad * 2 - shift) / pitch) + 1;
      for (let i = 0; i < nx; i++) {
        const lx = -w / 2 + rad + shift + i * pitch; if (layer && rng() < 0.3) continue;
        const dome = 0.012 * (1 - Math.min(1, (Math.abs(lx) / (w / 2)) ** 2 + (Math.abs(rz) / (d / 2)) ** 2)), ly = rad * (kind === 'orange' ? 0.95 : 0.4) + layer * pitch * 0.62 + dome;
        if (kind === 'orange') put(lx, ly, rz, (rng() - 0.5) * 1.2, rng() * 6.28, (rng() - 0.5) * 1.2);
        else if (layer) put(lx, ly + 0.01, rz, -Math.PI / 2, rng() * 6.28, 0); // Schnittfläche nach oben
        else put(lx, ly, rz, rng() < 0.5 ? -Math.PI / 2 : Math.PI / 2, rng() * 6.28, 0);
      }
    }
  }
}
// ==== PRODKIT END ====
function interiorTextures() {
  if (ITEX) return ITEX;
  const tile = (base, draw) => canvasTex(256, 256, (c, w, h) => { c.fillStyle = base; c.fillRect(0, 0, w, h); draw(c, w, h); });
  ITEX = {
    carpet: tile('#59626c', (c, w, h) => speckle(c, w, h, 9000, 0.06, 0.12)),
    carpet2: tile('#6b5a4c', (c, w, h) => speckle(c, w, h, 9000, 0.06, 0.12)),
    wood: tile('#9a6b43', (c, w, h) => { for (let y = 0; y < h; y += 32) { c.fillStyle = `hsl(28,${rnd(35, 50)}%,${rnd(30, 42)}%)`; c.fillRect(0, y, w, 31); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, y + 31, w, 1); c.fillRect(rnd(0, w), y, 1, 32); } speckle(c, w, h, 3000, 0.04, 0.06); }),
    wood2: tile('#c8a878', (c, w, h) => { for (let y = 0; y < h; y += 24) { c.fillStyle = `hsl(35,${rnd(30, 45)}%,${rnd(55, 66)}%)`; c.fillRect(0, y, w, 23); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, y + 23, w, 1); } }),
    tile: tile('#d9d6cf', (c, w, h) => { c.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i <= 4; i++) { c.fillRect(i * 64, 0, 2, h); c.fillRect(0, i * 64, w, 2); } speckle(c, w, h, 2000, 0.05, 0.04); }),
    tile2: tile('#e8e8e8', (c, w, h) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? '#2a2a2a' : '#efefef'; c.fillRect(i * 64, j * 64, 64, 64); } }),
  };
  const sm = (map, rough, metal = 0) => new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal });
  const realWood = (tint, rough) => ASSETS.img.hardwood2_diffuse ? new THREE.MeshStandardMaterial({ map: photoTex('hardwood2_diffuse'), bumpMap: photoTex('hardwood2_bump', 1, false), bumpScale: 0.8, roughnessMap: photoTex('hardwood2_roughness', 1, false), roughness: rough, color: tint }) : null;
  ITEX.mats = {
    carpet: sm(ITEX.carpet, 0.95), carpet2: sm(ITEX.carpet2, 0.95), wood: realWood(0xffffff, 1) || sm(ITEX.wood, 0.5), wood2: realWood(0xf0e2cc, 0.9) || sm(ITEX.wood2, 0.45), tile: sm(ITEX.tile, 0.3, 0.05), tile2: sm(ITEX.tile2, 0.25, 0.05),
    ceil: new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.9, side: THREE.DoubleSide }),
    panel: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3e2, emissiveIntensity: 0.9 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0a1020, emissive: 0x6a9cff, emissiveIntensity: 1.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fc0d0, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    door: new THREE.MeshStandardMaterial({ color: 0xa7afb7, metalness: 0.6, roughness: 0.5 }),
  };
  return ITEX;
}
// Koordinaten: lokal (Tür an lokal -z) <-> Welt
const toWorld = (lx, lz) => [INT.b.x + lx * INT.cos + lz * INT.sin, INT.b.z - lx * INT.sin + lz * INT.cos];
const toLocal = (wx, wz) => { const dx = wx - INT.b.x, dz = wz - INT.b.z; return [dx * INT.cos - dz * INT.sin, dx * INT.sin + dz * INT.cos]; };
function fSolid(F, x0, x1, z0, z1, y0, y1) {
  const [ax, az] = toWorld(x0, z0), [bx, bz] = toWorld(x1, z1);
  const s = addSolid(Math.min(ax, bx), Math.max(ax, bx), Math.min(az, bz), Math.max(az, bz), floorY(F.f) + y1, floorY(F.f) + y0);
  F.solids.push(s); return s;
}
// Ring-Korridor um den Kern: Navigation über das Rechteck x = ±4.4, z = ±4.2
const RX = 4.4, RZ = 4.2, RL = 4 * RX + 4 * RZ, RCORN = [[-RX, -RZ], [RX, -RZ], [RX, RZ], [-RX, RZ]];
function ringProjI(x, z) {
  let px = clamp(x, -RX, RX), pz = clamp(z, -RZ, RZ);
  if (Math.abs(px) < RX && Math.abs(pz) < RZ) { const d = [px + RX, RX - px, pz + RZ, RZ - pz], m = Math.min(...d); if (m === d[0]) px = -RX; else if (m === d[1]) px = RX; else if (m === d[2]) pz = -RZ; else pz = RZ; }
  return [px, pz];
}
function ringT([x, z]) {
  if (Math.abs(z + RZ) < 1e-6) return x + RX;
  if (Math.abs(x - RX) < 1e-6) return 2 * RX + z + RZ;
  if (Math.abs(z - RZ) < 1e-6) return 2 * RX + 2 * RZ + RX - x;
  return 4 * RX + 2 * RZ + RZ - z;
}
function ringWalk(a, b) {
  const ta = ringT(a), tb = ringT(b), fwd = ((tb - ta) % RL + RL) % RL, forward = fwd <= RL / 2;
  return RCORN.map(c => ({ c, d: forward ? ((ringT(c) - ta) % RL + RL) % RL : ((ta - ringT(c)) % RL + RL) % RL }))
    .filter(o => o.d > 1e-6 && o.d < (forward ? fwd : RL - fwd) - 1e-6).sort((p, q) => p.d - q.d).map(o => o.c);
}
function intPath(n, s) {
  if (n.room && n.room === s.room && !n.room.open) return [[s.x, s.z]];
  if (INT.b.small) return [[s.x, s.z]];
  const exitOf = r => (r && !r.open) ? [r.inPt, r.outPt] : [];
  const A = n.room && !n.room.open ? n.room.outPt : [n.x, n.z], Z = s.room && !s.room.open ? s.room.outPt : [s.x, s.z];
  const ra = ringProjI(...A), rb = ringProjI(...Z);
  return [...exitOf(n.room), ra, ...ringWalk(ra, rb), rb, ...exitOf(s.room).reverse(), [s.x, s.z]];
}
// Fläche mit rechteckigen Löchern (für Treppenhaus/Aufzugsschacht), als ein Mesh
function holedPlane(x0, x1, z0, z1, y, mat, tileS, holes, down = false) {
  const xs = [...new Set([x0, x1, ...holes.flatMap(h => [h[0], h[1]]).filter(v => v > x0 && v < x1)])].sort((a, b) => a - b);
  const zs = [...new Set([z0, z1, ...holes.flatMap(h => [h[2], h[3]]).filter(v => v > z0 && v < z1)])].sort((a, b) => a - b);
  const geos = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    if (holes.some(h => cx > h[0] && cx < h[1] && cz > h[2] && cz < h[3])) continue;
    const pg = new THREE.PlaneGeometry(xs[i + 1] - xs[i], zs[j + 1] - zs[j]); pg.rotateX(down ? Math.PI / 2 : -Math.PI / 2); pg.translate(cx, y, cz);
    const p = pg.attributes.position, uv = pg.attributes.uv; for (let k = 0; k < p.count; k++) uv.setXY(k, p.getX(k) / tileS, p.getZ(k) / tileS);
    geos.push(pg);
  }
  const m = new THREE.Mesh(mergeGeometries(geos), mat); m.receiveShadow = true; return m;
}
// ---------- Raumtüren + Eingangstüren: ein InstancedMesh pro Typ, Matrizen nur bei Bewegung ----------
const _dm = new THREE.Object3D(); let DOORG = null;
const dEase = u => u * u * (3 - 2 * u);
function doorGeo() {
  if (DOORG) return DOORG;
  const bx = (w, h, d, x, y, z, c) => colorize(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c), mg = l => mergeGeometries(l);
  const leaf = [bx(1.2, 2.1, 0.045, 0.6, 1.05, 0, '#ffffff')]; for (const y of [0.6, 1.55]) leaf.push(bx(0.8, 0.8, 0.052, 0.6, y, 0, '#d8d8d8'));
  const hnd = []; for (const s of [1, -1]) { hnd.push(new THREE.BoxGeometry(0.13, 0.026, 0.026).translate(1.0, 1.0, s * 0.07), new THREE.BoxGeometry(0.05, 0.05, 0.014).translate(1.07, 1.0, s * 0.03)); }
  const fr = [bx(1.18, 0.08, 0.06, 0, 1.185, 0, '#3a3f45'), bx(1.18, 0.08, 0.06, 0, -1.185, 0, '#3a3f45'), bx(0.06, 2.45, 0.06, -0.56, 0, 0, '#3a3f45'), bx(0.06, 2.45, 0.06, 0.56, 0, 0, '#3a3f45'), bx(0.03, 0.9, 0.03, 0.46, 0, 0.06, '#b8bec4'), bx(0.03, 0.9, 0.03, 0.46, 0, -0.06, '#b8bec4')];
  DOORG = { leaf: mg(leaf), hnd: mg(hnd), eFrame: mg(fr), ePane: new THREE.PlaneGeometry(1.08, 2.36),
    mLeaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), mHnd: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.3 }), mFrame: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45 }) };
  return DOORG;
}
// Raumtüren: defs = [{cx,cz,tx,tz,nx,nz,hs,col}] (lokal); hs = Scharnierseite entlang t, n = Blick ins Zimmer
function mkRoomDoors(F, g, defs, plates) {
  if (!defs.length) return;
  const G = doorGeo(), n = defs.length, leaf = new THREE.InstancedMesh(G.leaf, G.mLeaf, n), hnd = new THREE.InstancedMesh(G.hnd, G.mHnd, n), c = new THREE.Color();
  leaf.frustumCulled = hnd.frustumCulled = false;
  F.rd = { list: defs, leaf, hnd };
  defs.forEach((d, i) => {
    d.i = i; d.u = 0; d.tgt = 0; d.idle = 0; d.sgn = 1; d.hx = d.cx - d.hs * 0.6 * d.tx; d.hz = d.cz - d.hs * 0.6 * d.tz;
    const al = d.tx === 1; d.so = fSolid(F, d.cx - (al ? 0.65 : 0.1), d.cx + (al ? 0.65 : 0.1), d.cz - (al ? 0.1 : 0.65), d.cz + (al ? 0.1 : 0.65), -0.05, 2.2);
    leaf.setColorAt(i, c.set(d.col)); setRoomDoorM(F.rd, d);
  });
  g.add(leaf, hnd);
  if (plates) { // Zimmernummern (Hotel): ein Atlas, ein Mesh
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48 * n; const x = cv.getContext('2d'); x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 34px Georgia';
    const geos = defs.map((d, i) => {
      x.fillStyle = '#6b5326'; x.fillRect(0, i * 48, 128, 48); x.fillStyle = '#e8c878'; x.fillRect(4, i * 48 + 4, 120, 40); x.fillStyle = '#2a1a10'; x.fillText(String(F.f * 100 + i + 1), 64, i * 48 + 25);
      const pg = new THREE.PlaneGeometry(0.2, 0.075), uv = pg.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1) / n + uv.getY(k) / n);
      pg.rotateY(Math.atan2(-d.nx, -d.nz)); pg.translate(d.cx - d.nx * 0.09 + d.tx * 0.95, 1.6, d.cz - d.nz * 0.09 + d.tz * 0.95); return pg;
    });
    F.rd.tex = new THREE.CanvasTexture(cv); F.rd.tex.colorSpace = THREE.SRGBColorSpace; g.add(new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ map: F.rd.tex })));
  }
}
function setRoomDoorM(R, d) {
  const a = dEase(d.u) * 1.52, s = Math.sin(a), c = Math.cos(a), dx = d.hs * d.tx * c + d.sgn * d.nx * s, dz = d.hs * d.tz * c + d.sgn * d.nz * s;
  _dm.position.set(d.hx, 0, d.hz); _dm.rotation.set(0, Math.atan2(-dz, dx), 0); _dm.updateMatrix();
  R.leaf.setMatrixAt(d.i, _dm.matrix); R.hnd.setMatrixAt(d.i, _dm.matrix); R.leaf.instanceMatrix.needsUpdate = R.hnd.instanceMatrix.needsUpdate = true;
}
// Eingang (EG): Schiebe-Glastür (mode 'slide') bzw. Flügeltür (mode 'swing', Wohnhäuser), Lücke x = ±1.3 in der Außenwand bei z = -hd
function mkEntrance(F, g, hd, fb, mode) {
  const G = doorGeo(), z0 = -hd, fr = new THREE.InstancedMesh(G.eFrame, G.mFrame, 2), gl = new THREE.InstancedMesh(G.ePane, interiorTextures().mats.glass, 2);
  fr.frustumCulled = gl.frustumCulled = false;
  fb(0.12, 2.6, 0.3, -1.24, 1.3, z0, '#3a3f45'); fb(0.12, 2.6, 0.3, 1.24, 1.3, z0, '#3a3f45'); fb(2.6, 0.1, 0.3, 0, 2.55, z0, '#3a3f45');
  F.ent = { mode, z0, u: 0, tgt: 0, idle: 0, sgn: 1, fr, gl, so: fSolid(F, -1.3, 1.3, z0 - 0.15, z0 + 0.15, -0.05, 2.5) };
  setEntM(F.ent); g.add(fr, gl);
}
function setEntM(E) {
  const k = dEase(E.u);
  for (let i = 0; i < 2; i++) {
    const s = i ? 1 : -1; // links / rechts
    if (E.mode === 'slide') { _dm.position.set(s * (0.59 + 1.1 * k), 1.255, E.z0 + s * 0.08); _dm.rotation.set(0, 0, 0); }
    else { const a = k * 1.52, dx = -s * Math.cos(a), dz = E.sgn * Math.sin(a); _dm.position.set(s * 1.18 + dx * 0.59, 1.255, E.z0 + dz * 0.59); _dm.rotation.set(0, Math.atan2(-dz, dx), 0); }
    _dm.updateMatrix(); E.fr.setMatrixAt(i, _dm.matrix); E.gl.setMatrixAt(i, _dm.matrix);
  }
  E.fr.instanceMatrix.needsUpdate = E.gl.instanceMatrix.needsUpdate = true;
}
// pro Frame: Türen öffnen, wenn Spieler/laufende NPC im Bereich stehen; Schwenkrichtung weg von der Person; Kollision nur solange (fast) geschlossen
function updateDoors(F, dt, plx, plz) {
  const pOn = !player.car && !player.dead && Math.abs(player.y - floorY(F.f)) < 1.6;
  const step = (D, who, tm) => {
    if (who) { D.idle = 2.5; if (D.u < 0.05) D.sgn = who; D.tgt = 1; } else { D.idle -= dt; if (D.idle <= 0) D.tgt = 0; }
    const u0 = D.u; D.u = D.tgt > D.u ? Math.min(D.tgt, D.u + dt / tm) : Math.max(D.tgt, D.u - dt / tm); return D.u !== u0;
  };
  const solid = (D, x0, x1, z0, z1, h) => { const a = dEase(D.u) * 1.52; if (a > 0.45 && D.so) { removeSolid(D.so); const k = F.solids.indexOf(D.so); if (k >= 0) F.solids.splice(k, 1); D.so = null; } else if (a < 0.25 && !D.so) D.so = fSolid(F, x0, x1, z0, z1, -0.05, h); };
  if (F.rd) for (const d of F.rd.list) {
    let who = 0; const chk = (x, z, zd) => { const rx = x - d.cx, rz = z - d.cz, u = rx * d.nx + rz * d.nz, w = rx * d.tx + rz * d.tz; if (Math.abs(w) < 0.8 && Math.abs(u) < zd) who = u < 0 ? 1 : -1; };
    if (pOn) chk(plx, plz, 1.8);
    for (const n of F.npcs) if (n.state !== 'dead' && (n.state === 'walk' || n.role === 'cop')) chk(n.x, n.z, n.flee ? 2.6 : 1.7);
    if (step(d, who, 0.4)) setRoomDoorM(F.rd, d);
    const al = d.tx === 1; solid(d, d.cx - (al ? 0.65 : 0.1), d.cx + (al ? 0.65 : 0.1), d.cz - (al ? 0.1 : 0.65), d.cz + (al ? 0.1 : 0.65), 2.2);
  }
  const E = F.ent; if (E) {
    let who = 0; const chk = (x, z, zo) => { if (Math.abs(x) < 1.9 && z > E.z0 - zo && z < E.z0 + 2.4) who = z < E.z0 ? 1 : -1; };
    if (pOn) chk(plx, plz, 3.0);
    for (const n of F.npcs) if (n.state !== 'dead' && n.state === 'walk') chk(n.x, n.z, 2.4);
    if (step(E, who, 0.45)) setEntM(E);
    solid(E, -1.3, 1.3, E.z0 - 0.15, E.z0 + 0.15, 2.5);
  }
}
function buildFloor(f) {
  const b = INT.b, F = { f, group: new THREE.Group(), solids: [], npcs: [], spots: [], rooms: [], kind: '', respawnT: rnd(8, 20), doors: [], doorSolid: null };
  F.group.position.y = floorY(f); INT.root.add(F.group);
  const T = interiorTextures(), r = mulberry(b.seed * 31 + f * 7919 + 1), rr = (a, c) => a + r() * (c - a), rp = a => a[Math.floor(r() * a.length)];
  const W = INT.W, D = INT.D, hw = W / 2 - 0.2, hd = D / 2 - 0.2, top = f >= b.floors - 1, hole = f > 0, small = b.small;
  const kind = b.type === 'prison' ? 'flat' : small && !['market', 'gas', 'bank'].includes(b.type) ? 'shop' : b.type === 'bank' ? (f === 0 ? 'bank' : 'office') : b.type === 'hotel' ? (f === 0 ? 'hotel' : 'flat') : b.type === 'hospital' ? (f === 0 ? 'lobby' : 'ward') : b.type === 'police' ? (f === 0 ? 'police' : 'office') : b.type === 'market' ? 'market' : b.type === 'gas' ? 'gas' : f === 0 ? (b.type === 'shop' ? 'shop' : 'lobby') : b.type === 'office' ? 'office' : 'flat';
  F.kind = kind;
  const g = F.group, vc = [], scr = [], pan = [], glass = [], prods = [], spots = F.spots;
  const fb = (w, h, d, x, y, z, col, solid = false) => { vc.push(box(w, h, d, x, y, z, col)); if (solid) fSolid(F, x - w / 2, x + w / 2, z - d / 2, z + d / 2, y - h / 2 - 0.05, y + h / 2); };
  const iSolid = (x0, x1, z0, z1, h = 3.4) => fSolid(F, Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), -0.05, h);
  const rb = (w, h, d, lx, ly, lz, yaw, ox, oz, col, solid = false, list = vc) => {
    const gg = colorize(new THREE.BoxGeometry(w, h, d), col);
    gg.translate(lx, ly, lz); gg.rotateY(yaw); gg.translate(ox, 0, oz); list.push(gg);
    if (solid) {
      const c = Math.cos(yaw), s = Math.sin(yaw), cx = ox + lx * c + lz * s, cz = oz - lx * s + lz * c, sw = Math.abs(s) > 0.5;
      const ww = sw ? d : w, dd = sw ? w : d; fSolid(F, cx - ww / 2, cx + ww / 2, cz - dd / 2, cz + dd / 2, -0.05, ly + h / 2);
    }
  };
  const spot = (type, x, z, yaw, pose, room, extra = {}) => { const s = { type, x, z, yaw, pose, room, occ: null, ...extra }; spots.push(s); return s; };
  const TH = THEMES[(b.seed >>> 3) % THEMES.length], wallCol = rp(TH.walls), accent = rp(TH.accent);
  F.theme = TH.id;
  // Wandsegment: je nach Stil Glaswand mit Rahmen, Holzvertäfelung oder Akzentfarbe
  const seg = (alongX, len, mid, c, col, t) => {
    const W0 = alongX ? len : t, D0 = alongX ? t : len, X0 = alongX ? mid : c, Z0 = alongX ? c : mid;
    if (TH.glass && col === wallCol && kind === 'office') {
      fb(W0, 0.1, D0, X0, 0.05, Z0, '#2a2d31'); fb(W0, 0.14, D0, X0, 3.33, Z0, '#2a2d31');
      for (let q = -len / 2; q <= len / 2 + 0.01; q += 1.5) fb(alongX ? 0.05 : t, 3.3, alongX ? t : 0.05, alongX ? mid + Math.min(q, len / 2) : c, 1.7, alongX ? c : mid + Math.min(q, len / 2), '#2a2d31');
      const gg = new THREE.PlaneGeometry(len, 3.2); if (!alongX) gg.rotateY(Math.PI / 2); gg.translate(X0, 1.7, Z0); glass.push(gg);
      fSolid(F, X0 - W0 / 2, X0 + W0 / 2, Z0 - D0 / 2, Z0 + D0 / 2, -0.05, 3.4); return;
    }
    fb(W0, 3.4, D0, X0, 1.7, Z0, col === wallCol && TH.accentWalls && r() < 0.3 ? accent : col, true);
    if (TH.wains && col === wallCol) fb(W0 + 0.02, 1.05, D0 + 0.02, X0, 0.53, Z0, TH.wains);
  };
  const wallX = (x0, x1, z, gaps = [], col = wallCol, t = 0.16) => { let a = x0; for (const [g0, g1] of [...gaps, [x1, x1]].sort((p, q) => p[0] - q[0])) { if (g0 - a > 0.05) seg(true, g0 - a, (a + g0) / 2, z, col, t); a = Math.max(a, g1); } };
  const wallZ = (z0, z1, x, gaps = [], col = wallCol, t = 0.16) => { let a = z0; for (const [g0, g1] of [...gaps, [z1, z1]].sort((p, q) => p[0] - q[0])) { if (g0 - a > 0.05) seg(false, g0 - a, (a + g0) / 2, x, col, t); a = Math.max(a, g1); } };
  const plane = (x0, x1, z0, z1, y, m, tileS) => g.add(holedPlane(x0, x1, z0, z1, y, m, tileS, []));
  // Boden & Decke (mit Schacht- und Treppenöffnungen)
  const fm = { flat: rp([T.mats.wood, T.mats.wood2, T.mats.tile]), office: T.mats[rp(TH.floor)], lobby: T.mats[rp(TH.lobby)], ward: T.mats.tile, police: T.mats.tile2 }[kind] || rp([T.mats.tile, T.mats.tile2]);
  const core = !small;
  const holes = b.noLift ? [H1, H2] : [ELEV, H1, H2];
  g.add(holedPlane(-hw, hw, -hd, hd, 0.005, fm, 2, core && hole ? holes : []));
  g.add(holedPlane(-hw, hw, -hd, hd, 3.4, T.mats.ceil, 2, core && !top ? holes : [], true));
  for (let x = -hw + 2; x < hw - 1; x += 3.6) for (let z = -hd + 2; z < hd - 1; z += 3.6) if (!core || Math.abs(x) > 3.8 || Math.abs(z) > 3.6) pan.push(box(1.2, 0.04, 0.6, x, 3.37, z, '#fff'));
  // Außenwand mit echten Fenstern (Blick auf die Stadt)
  const ext = rp(['#c9cdd1', '#d8d2c6', '#bfc4bf', '#cfc8d6']);
  const extWall = (along, c, a0, a1, gaps) => {
    let a = a0;
    for (const [g0, g1] of [...gaps, [a1, a1]].sort((p, q) => p[0] - q[0])) {
      if (g0 - a > 0.05) {
        const len = g0 - a, mid = (a + g0) / 2, P = (u, y, h, l) => along === 'x' ? fb(l, h, 0.3, u, y, c, ext) : fb(0.3, h, l, c, y, u, ext);
        P(mid, 0.45, 0.9, len); P(mid, 3.25, 0.7, len);
        for (let m = a; m <= g0 + 0.01; m += 3.6) P(Math.min(m, g0 - 0.075), 1.9, 2.0, 0.15);
        const gg = new THREE.PlaneGeometry(len, 2.0); if (along === 'z') gg.rotateY(Math.PI / 2); gg.translate(along === 'x' ? mid : c, 1.9, along === 'x' ? c : mid); glass.push(gg);
        if (along === 'x') iSolid(a, g0, c - 0.15, c + 0.15); else iSolid(c - 0.15, c + 0.15, a, g0);
      }
      a = Math.max(a, g1);
    }
  };
  extWall('x', -hd, -hw, hw, f === 0 ? [[-1.3, 1.3]] : []); extWall('x', hd, -hw, hw, []); extWall('z', -hw, -hd, hd, []); extWall('z', hw, -hd, hd, []);
  if (f === 0) { fb(2.6, 0.75, 0.3, 0, 2.97, -hd, ext); F.exit = { x: 0, z: -hd + 0.9 }; mkEntrance(F, g, hd, fb, b.type === 'apartment' ? 'swing' : 'slide'); }
  // Kern: Aufzug + Treppenhaus mit Zwischenpodest
  const coreCol = rp(['#b9c2c9', '#c9bfb2', '#a9b4a8', '#c4c0cc', '#d0c8b8']);
  if (core) {
    wallX(-3.2, 3.2, -3, [[-2.6, -1.2], [0.1, 1.3]], coreCol, 0.2); wallX(-3.2, 3.2, 3, [], coreCol, 0.2);
    wallZ(-3, 3, -3.2, [], coreCol, 0.2); wallZ(-3, 3, 3.2, [], coreCol, 0.2); wallZ(-3, 3, -0.5, [], coreCol, 0.16); wallX(-3.2, -0.5, -0.4, [], coreCol, 0.16);
    iSolid(-3.2, -0.5, -0.4, 3);
    if (b.noLift) { fb(1.4, 3.4, 0.2, -1.9, 1.7, -3, coreCol, true); } else {
    const dl = new THREE.Mesh(new THREE.BoxGeometry(0.72, 2.3, 0.06), T.mats.door), dr = dl.clone(); dl.position.set(-2.25, 1.15, -3.13); dr.position.set(-1.55, 1.15, -3.13); g.add(dl, dr); F.doors = [dl, dr];
    F.callBtn = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.04), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffa020, emissiveIntensity: 0.15 })); F.callBtn.position.set(-0.95, 1.2, -3.16); g.add(F.callBtn);
    F.ind = liftCanvas(128, 48); const im = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshBasicMaterial({ map: F.ind.tex })); im.position.set(-1.9, 2.75, -3.16); im.rotation.y = Math.PI; g.add(im);
    if (INT.cab) drawLiftDisp(F.ind, INT.cab.floor, 0); }
    if (!b.noLift) { F.doorSolid = fSolid(F, -2.6, -1.2, -3.12, -2.98, -0.05, 3.0); fb(0.16, 0.26, 0.04, -0.95, 1.2, -3.13, '#9aa0a6'); fb(0.7, 0.26, 0.04, -1.9, 2.75, -3.13, '#111'); }
    wallZ(-1.4, 1.6, 1.3, [], coreCol, 0.1);
    if (!top) {
      for (let k = 0; k < 10; k++) { const ht = (k + 1) * 0.18; fb(1.7, ht, 0.3, 2.22, ht / 2, -1.4 + 0.15 + k * 0.3, '#8d8f92'); }
      fb(3.5, 0.15, 1.3, 1.35, 1.725, 2.25, '#8d8f92');
      for (let k = 0; k < 10; k++) fb(1.6, 0.2, 0.3, 0.42, 1.8 + (k + 1) * 0.18 - 0.1, 1.6 - 0.15 - k * 0.3, '#8d8f92');
      fb(0.05, 1.0, 3.0, 1.33, 2.4, 0.1, '#555');
    } else { iSolid(1.35, 3.1, -1.4, 1.6); fb(1.7, 1.1, 0.05, 2.22, 0.9, -1.42, '#b03030'); }
    if (!hole) iSolid(H1[0], H1[1], H1[2], H1[3], 0.3);
    scr.push(box(0.5, 0.18, 0.02, 0.7, 2.85, -3.13, '#fff'));
  }
  F.elevSpot = { type: 'elev', x: -1.9, z: -3.9, yaw: 0, pose: 'stand', room: { open: true }, multi: true };
  // Räume entlang des Rings
  // Räume entlang des Rings
  const rooms = [];
  const open = small || ['shop', 'lobby', 'police', 'market', 'gas', 'bank', 'hotel'].includes(kind) || (kind === 'office' && r() < 0.35) || W < 19 || D < 19;
  if (!open) {
    for (const [side, z0, z1, zd] of [['S', -hd, -5.4, -5.4], ['N', 5.4, hd, 5.4]]) {
      const c1 = rr(-4.2, -2.2), c2 = rr(2.2, 4.2), cuts = [-hw, c1];
      if (c2 - c1 > 7) cuts.push((c1 + c2) / 2);
      cuts.push(c2, hw);
      for (let k = 0; k < cuts.length - 1; k++) {
        const a = cuts[k], bb = cuts[k + 1], dx = k === 0 ? bb - 0.9 : k === cuts.length - 2 ? a + 0.9 : (a + bb) / 2;
        rooms.push({ x0: a, x1: bb, z0, z1, side, door: [dx, zd] }); if (k > 0) wallZ(z0, z1, a);
      }
    }
    for (const [side, x0, x1, xd] of [['W', -hw, -5.6, -5.6], ['E', 5.6, hw, 5.6]]) {
      const cuts = [-5.4]; if (r() < 0.6) cuts.push(rr(-1.5, 1.5)); cuts.push(5.4);
      for (let k = 0; k < cuts.length - 1; k++) { rooms.push({ x0, x1, z0: cuts[k], z1: cuts[k + 1], side, door: [xd, (cuts[k] + cuts[k + 1]) / 2] }); if (k > 0) wallX(x0, x1, cuts[k]); }
    }
    const gaps = side => rooms.filter(q => q.side === side).map(q => { const c = side === 'S' || side === 'N' ? q.door[0] : q.door[1]; return [c - 0.65, c + 0.65]; });
    wallX(-hw, hw, -5.4, gaps('S')); wallX(-hw, hw, 5.4, gaps('N')); wallZ(-5.4, 5.4, -5.6, gaps('W')); wallZ(-5.4, 5.4, 5.6, gaps('E'));
    const INWARD = { S: [0, -1], N: [0, 1], W: [-1, 0], E: [1, 0] };
    for (const q of rooms) { const [ix, iz] = INWARD[q.side]; q.inPt = [q.door[0] + ix * 0.9, q.door[1] + iz * 0.9]; q.outPt = [q.door[0] - ix * 0.9, q.door[1] - iz * 0.9]; q.win = q.side; }
    // Türzargen + Sturz (Blätter: mkRoomDoors, schwenken automatisch)
    const hot = b.type === 'hotel', dcol = hot ? '#4a2f1f' : b.type === 'prison' ? '#6f757b' : b.type === 'hospital' ? '#dfe8ea' : kind === 'office' ? (TH.glass ? '#303840' : '#a7794c') : ['#e9e4d8', '#d6c9ae', '#9fb4ae', '#c9b6a0'][(b.seed + f) % 4], zcol = hot ? '#2e1d12' : kind === 'office' && !TH.glass ? '#7a5434' : '#f0ede6', rdefs = [];
    rooms.forEach((q, i) => {
      const al = q.side === 'S' || q.side === 'N', [nx, nz] = INWARD[q.side], [cx, cz] = q.door, P = (len, h, th, o, y, col = zcol) => al ? fb(len, h, th, cx + o, y, cz, col) : fb(th, h, len, cx, y, cz + o, col);
      P(0.07, 2.12, 0.22, -0.665, 1.06); P(0.07, 2.12, 0.22, 0.665, 1.06); P(1.4, 0.07, 0.22, 0, 2.155); P(1.3, 1.21, 0.16, 0, 2.795, wallCol);
      rdefs.push({ cx, cz, tx: al ? 1 : 0, tz: al ? 0 : 1, nx, nz, hs: ((b.seed >>> 2) + f + i) & 1 ? 1 : -1, col: dcol });
    });
    F.rdefs = rdefs; F.rdPlates = hot;
  }
  // Möbel
  const deskCol = rp(TH.desk);
  const desk = (x, z, yaw, room, role = 'desk') => {
    const o = [x, z];
    rb(1.4, 0.05, 0.7, 0, 0.74, 0.55, yaw, ...o, deskCol, true);
    rb(0.05, 0.72, 0.6, -0.65, 0.36, 0.55, yaw, ...o, '#555'); rb(0.05, 0.72, 0.6, 0.65, 0.36, 0.55, yaw, ...o, '#555');
    rb(0.55, 0.34, 0.04, 0, 1.03, 0.8, yaw, ...o, '#111'); rb(0.5, 0.29, 0.01, 0, 1.03, 0.775, yaw, ...o, '#fff', false, scr);
    rb(0.06, 0.22, 0.06, 0, 0.86, 0.82, yaw, ...o, '#222'); rb(0.45, 0.02, 0.15, 0, 0.78, 0.45, yaw, ...o, '#222');
    if (r() < 0.5) rb(0.08, 0.1, 0.08, 0.45, 0.82, 0.5, yaw, ...o, rp(['#fff', '#c33', '#36c']));
    rb(0.48, 0.08, 0.48, 0, 0.45, 0, yaw, ...o, '#26282c'); rb(0.48, 0.55, 0.06, 0, 0.78, -0.25, yaw, ...o, '#26282c'); rb(0.06, 0.42, 0.06, 0, 0.21, 0, yaw, ...o, '#444');
    return spot(role, x, z, yaw, 'type', room);
  };
  const addModel = (name, size, fit, x, z, yaw) => { const mi = modelInstance(name, size, fit); if (!mi) return false; mi.position.set(x, 0, z); mi.rotation.y = yaw; g.add(mi); return true; };
  const chair = (x, z, yaw, room, type = 'meet') => { if (!addModel('SheenChair', 0.92, 'y', x, z, yaw + Math.PI)) { rb(0.46, 0.07, 0.46, 0, 0.45, 0, yaw, x, z, '#30343a'); rb(0.46, 0.5, 0.06, 0, 0.75, -0.24, yaw, x, z, '#30343a'); } return spot(type, x, z, yaw, 'sit', room); };
  const plant = (x, z) => { if (addModel('DiffuseTransmissionPlant', 1.3, 'y', x, z, r() * 6.28)) { fSolid(F, x - 0.3, x + 0.3, z - 0.3, z + 0.3, -0.05, 1.3); return; } fb(0.45, 0.45, 0.45, x, 0.225, z, '#6b5040', true); vc.push(colorize(new THREE.IcosahedronGeometry(0.45, 1).translate(x, 0.95, z), '#3f7a3a')); };
  const sofa = (x, z, yaw, room, col) => { if (addModel('SheenWoodLeatherSofa', 2.2, 'x', x, z, yaw)) { rb(2.0, 0.42, 0.85, 0, 0.21, 0, yaw, x, z, col, true, []); return spot('sofa', x, z, yaw, 'watch', room); } rb(2.0, 0.42, 0.85, 0, 0.21, 0, yaw, x, z, col, true); rb(2.0, 0.5, 0.2, 0, 0.65, -0.33, yaw, x, z, col); rb(0.2, 0.3, 0.85, -0.9, 0.55, 0, yaw, x, z, col); rb(0.2, 0.3, 0.85, 0.9, 0.55, 0, yaw, x, z, col); return spot('sofa', x, z, yaw, 'watch', room); };
  const yawTo = (fx, fz) => Math.atan2(fx, fz);
  const winYaw = { S: Math.PI, N: 0, W: -Math.PI / 2, E: Math.PI / 2 };
  const furnishRoom = (q, type) => {
    const x0 = q.x0 + 0.7, x1 = q.x1 - 0.7, z0 = q.z0 + 0.7, z1 = q.z1 - 0.7, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, wy = winYaw[q.win];
    const [wx, wz] = [Math.sin(wy), Math.cos(wy)]; // Richtung Fenster
    const wallPt = (t, off) => q.win === 'S' || q.win === 'N' ? [lerp(x0, x1, t), (q.win === 'S' ? z0 : z1) - wz * off] : [(q.win === 'W' ? x0 : x1) - wx * off, lerp(z0, z1, t)];
    q.type = type;
    if (type === 'office') {
      const n = Math.max(1, Math.floor(((q.win === 'S' || q.win === 'N') ? x1 - x0 : z1 - z0) / 1.8));
      for (let k = 0; k < n; k++) { const [x, z] = wallPt((k + 0.5) / n, 1.1); desk(x, z, wy, q); }
      const [px, pz] = wallPt(0.02, 0.4); plant(px, pz);
      spot('window', ...wallPt(0.5, 0.45), wy, 'look', q);
    } else if (type === 'meeting') {
      rb(Math.min(2.8, x1 - x0 - 1.6), 0.06, Math.min(1.2, z1 - z0 - 1.6), 0, 0.74, 0, 0, cx, cz, '#5b4636', true);
      rb(0.1, 0.72, 0.1, 0, 0.36, 0, 0, cx, cz, '#333');
      const tw = Math.min(2.8, x1 - x0 - 1.6) / 2, td = Math.min(1.2, z1 - z0 - 1.6) / 2;
      for (const t of [-0.6, 0.6]) { chair(cx + t * tw, cz - td - 0.45, 0, q); chair(cx + t * tw, cz + td + 0.45, Math.PI, q); }
      scr.push(box(1.6, 0.9, 0.04, cx, 1.6, (q.side === 'S' ? z0 - 0.45 : q.side === 'N' ? z1 + 0.45 : cz)));
    } else if (type === 'kitchen') {
      const [kx, kz] = wallPt(0.4, 0.3);
      rb(2.6, 0.9, 0.6, 0, 0.45, 0, wy, kx, kz, '#ddd8cf', true); rb(2.6, 0.04, 0.62, 0, 0.92, 0, wy, kx, kz, '#333');
      rb(0.8, 1.9, 0.7, 1.8, 0.95, 0, wy, kx, kz, '#e8e8e8', true);
      spot('cook', kx - wx * 0.75, kz - wz * 0.75, wy, 'cook', q);
      const [cx2, cz2] = wallPt(0.9, 0.4); rb(0.35, 1.15, 0.35, 0, 0.575, 0, 0, cx2, cz2, '#7fb8e6', true);
      spot('cooler', cx2 - wx * 0.8, cz2 - wz * 0.8, wy, 'talk', q); spot('cooler', cx2 - wx * 0.8 + wz * 0.9, cz2 - wz * 0.8 + wx * 0.9, wy, 'talk', q);
      rb(1.0, 0.05, 1.0, 0, 0.74, 0, 0, cx, cz, '#c8b89a', true); chair(cx - 0.8, cz, Math.PI / 2, q, 'table'); chair(cx + 0.8, cz, -Math.PI / 2, q, 'table');
    } else if (type === 'boss') {
      const [dx, dz] = wallPt(0.5, 1.3); desk(dx, dz, wy + Math.PI, q, 'desk');
      const [sx, sz] = wallPt(0.15, 1.2); plant(sx, sz); sofa(cx, cz + (q.win === 'S' ? 1 : -1) * 0.2, wy, q, '#3b2a24');
      spot('window', ...wallPt(0.8, 0.45), wy, 'look', q);
    } else if (type === 'flat') {
      const [bx, bz] = wallPt(0.2, 1.15);
      rb(1.6, 0.5, 2.1, 0, 0.25, 0, wy + Math.PI, bx, bz, '#efe9df', true); rb(1.6, 0.6, 0.1, 0, 0.55, -1.0, wy + Math.PI, bx, bz, '#5a4030'); rb(0.6, 0.12, 0.35, 0, 0.56, -0.8, wy + Math.PI, bx, bz, '#fff');
      spot('bed', bx, bz, wy + Math.PI, 'lie', q);
      const [tx, tz] = wallPt(0.8, 0.25); rb(1.3, 0.75, 0.06, 0, 1.2, 0, wy + Math.PI, tx, tz, '#111'); rb(1.2, 0.68, 0.01, 0, 1.2, -0.035, wy + Math.PI, tx, tz, '#fff', false, scr);
      sofa(tx - wx * 3.0, tz - wz * 3.0, wy, q, rp(['#6e4b3a', '#3c5a7a', '#777', '#5a6e3c']));
      const sideX = q.win === 'S' || q.win === 'N';
      const kx = sideX ? lerp(x0, x1, 0.5) : (q.win === 'W' ? x1 : x0) - (q.win === 'W' ? 0.35 : -0.35), kz = sideX ? (q.win === 'S' ? z1 : z0) + (q.win === 'S' ? -0.35 : 0.35) : lerp(z0, z1, 0.5);
      rb(2.0, 0.9, 0.6, 0, 0.45, 0, wy + Math.PI, kx, kz, '#cfc4b2', true); rb(2.0, 0.04, 0.62, 0, 0.92, 0, wy + Math.PI, kx, kz, '#2b2b2b');
      spot('cook', kx + wx * 0.75, kz + wz * 0.75, wy + Math.PI, 'cook', q);
      plane(x0 + 0.3, x1 - 0.3, z0 + 0.3, z1 - 0.3, 0.005, new THREE.MeshStandardMaterial({ color: rp(['#8a4b3a', '#3a5a7a', '#6a6a50', '#4a3a5a']), roughness: 1 }), 4);
      spot('window', ...wallPt(0.55, 0.45), wy, 'look', q);
    } else if (type === 'ward') {
      for (const t of [0.25, 0.75]) {
        const [bx, bz] = wallPt(t, 1.2);
        rb(1.0, 0.6, 2.0, 0, 0.3, 0, wy + Math.PI, bx, bz, '#f4f6f8', true); rb(1.0, 0.9, 0.06, 0, 0.6, -0.97, wy + Math.PI, bx, bz, '#8fa3b0');
        spot('bed', bx, bz, wy + Math.PI, 'lie', q); spot('bedside', bx + wz * 0.95, bz - wx * 0.95, wy + Math.PI / 2, 'look', q);
        rb(0.4, 1.4, 0.4, 0.8, 0.7, -0.8, wy + Math.PI, bx, bz, '#b8c0c8');
      }
    }
  };
  if (!open) {
    const types = kind === 'flat' ? null : kind === 'ward' ? null : ['office', 'office', 'meeting', 'boss', 'office'];
    rooms.forEach((q, k) => furnishRoom(q, kind === 'flat' ? 'flat' : kind === 'ward' ? 'ward' : k === 1 ? 'kitchen' : k === 4 ? 'meeting' : rp(types)));
  } else {
    const all = { open: true };
    // Hallen-Baukasten (Hotel/Lobby/Bank/Polizei): Sperrflächen + Möbelgruppen skalieren mit der Grundfläche, alles in vc/pan gemerged (wenige Draw-Calls)
    const hk = (() => {
      const res = core ? [[-4.2, 4.2, -4.2, 4.2]] : [], keep = [[-2.2, 2.2, -hd, -4.2]], pts = [], AR = 4 * hw * hd;
      const okAt = (x, z, rx, rz = rx) => Math.abs(x) + rx < hw - 0.3 && Math.abs(z) + rz < hd - 0.3 && ![...res, ...keep].some(q => x + rx > q[0] && x - rx < q[1] && z + rz > q[2] && z - rz < q[3]);
      const claim = (x, z, rx, rz = rx, pt = true) => { res.push([x - rx, x + rx, z - rz, z + rz]); if (pt) pts.push([x, z]); };
      const dist = (x, z) => { let m = 99; for (const q of res) m = Math.min(m, Math.hypot(Math.max(q[0] - x, 0, x - q[1]), Math.max(q[2] - z, 0, z - q[3]))); return m; };
      const P = (yaw, ox, oz, lx, lz) => [ox + lx * Math.cos(yaw) + lz * Math.sin(yaw), oz - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
      const dim = (c, k) => '#' + new THREE.Color(c).multiplyScalar(k).getHexString();
      const sol = (x, z, w, d, yaw, h = 1.0) => { const sw = Math.abs(Math.sin(yaw)) > 0.5, ww = sw ? d : w, dd = sw ? w : d; fSolid(F, x - ww / 2, x + ww / 2, z - dd / 2, z + dd / 2, -0.05, h); };
      const cyl = (rt, rb2, h, x, y, z, col, list = vc, seg = 10) => list.push(colorize(new THREE.CylinderGeometry(rt, rb2, h, seg).translate(x, y, z), col));
      const PAL = [['#7a2a2a', '#c8a45a'], ['#2f3a4a', '#9aa7b8'], ['#3b5a48', '#d8caa0'], ['#5a4030', '#b0803c'], ['#33403f', '#c7b7a0'], ['#4a3a5a', '#d0c0a0']];
      const rug = (x, z, w, d, yaw, c1, c2) => { rb(w, 0.02, d, 0, 0.01, 0, yaw, x, z, c2); rb(w - 0.36, 0.03, d - 0.36, 0, 0.015, 0, yaw, x, z, c1); rb(w - 0.8, 0.04, d - 0.8, 0, 0.02, 0, yaw, x, z, dim(c1, 1.12)); };
      const couch = (x, z, yaw, col, len = 2.2) => {
        rb(len, 0.42, 0.92, 0, 0.27, 0, yaw, x, z, dim(col, 0.8)); rb(len, 0.6, 0.24, 0, 0.72, -0.34, yaw, x, z, col);
        for (const s of [-1, 1]) rb(0.24, 0.34, 0.92, s * (len / 2 - 0.12), 0.59, 0, yaw, x, z, dim(col, 0.9));
        const n = len > 1.5 ? 2 : 1, cw = (len - 0.5) / n;
        for (let k = 0; k < n; k++) rb(cw - 0.03, 0.16, 0.66, -(len - 0.5) / 2 + cw * (k + 0.5), 0.54, 0.08, yaw, x, z, dim(col, 1.12));
        sol(x, z, len, 0.92, yaw, 0.9);
      };
      const sit = (x, z, yaw, lx = 0) => { const [sx, sz] = P(yaw, x, z, lx, 0.08); return spot('visit', sx, sz, yaw, 'sit', all); };
      const table = (x, z, yaw, w, d, col) => { rb(w, 0.05, d, 0, 0.42, 0, yaw, x, z, col); rb(w - 0.2, 0.34, d - 0.2, 0, 0.2, 0, yaw, x, z, dim(col, 0.6)); sol(x, z, w, d, yaw, 0.5); };
      const lamp = (x, z) => { cyl(0.2, 0.2, 0.03, x, 0.015, z, '#2a2a2a'); cyl(0.02, 0.02, 1.45, x, 0.75, z, '#d8b060', vc, 6); cyl(0.2, 0.28, 0.36, x, 1.65, z, '#fff', pan, 12); };
      const bush = (x, z, s = 1) => {
        cyl(0.3 * s, 0.22 * s, 0.55 * s, x, 0.275 * s, z, rp(['#8a7260', '#4a4f55', '#a0866a'])); cyl(0.03, 0.04, 0.5 * s, x, 0.75 * s, z, '#5a4630', vc, 5);
        for (let k = 0; k < 4; k++) vc.push(colorize(new THREE.IcosahedronGeometry((0.4 - k * 0.05) * s, 1).translate(x + rr(-0.18, 0.18) * s, (0.95 + k * 0.3) * s, z + rr(-0.18, 0.18) * s), rp(['#2f6b34', '#3c7a3a', '#2a5c33', '#4a8a40'])));
        fSolid(F, x - 0.32 * s, x + 0.32 * s, z - 0.32 * s, z + 0.32 * s, -0.05, 1.5 * s);
      };
      const pillar = (x, z, col) => { cyl(0.36, 0.38, 3.2, x, 1.7, z, col, vc, 16); fb(0.9, 0.2, 0.9, x, 0.1, z, dim(col, 0.8)); fb(0.9, 0.2, 0.9, x, 3.3, z, dim(col, 0.8)); fb(0.76, 0.08, 0.76, x, 0.24, z, dim(col, 0.9)); iSolid(x - 0.45, x + 0.45, z - 0.45, z + 0.45); };
      const pend = (x, z, y = 2.65, s = 0.22) => { pan.push(colorize(new THREE.SphereGeometry(s, 10, 8).translate(x, y, z), '#fff')); cyl(0.008, 0.008, 3.4 - y, x, (3.4 + y) / 2, z, '#222', vc, 4); };
      const chandelier = (x, z) => { vc.push(colorize(new THREE.TorusGeometry(0.7, 0.025, 6, 22).rotateX(Math.PI / 2).translate(x, 2.7, z), '#b8964a')); cyl(0.01, 0.01, 0.7, x, 3.05, z, '#b8964a', vc, 4); for (let k = 0; k < 8; k++) pan.push(colorize(new THREE.SphereGeometry(0.1, 8, 6).translate(x + Math.cos(k * 0.785) * 0.7, 2.72, z + Math.sin(k * 0.785) * 0.7), '#fff')); pan.push(colorize(new THREE.SphereGeometry(0.2, 10, 8).translate(x, 2.7, z), '#fff')); };
      const bench = (x, z, yaw, len, col) => { rb(len, 0.1, 0.5, 0, 0.45, 0, yaw, x, z, col); rb(0.08, 0.42, 0.42, -len / 2 + 0.2, 0.21, 0, yaw, x, z, '#2a2a2a'); rb(0.08, 0.42, 0.42, len / 2 - 0.2, 0.21, 0, yaw, x, z, '#2a2a2a'); sol(x, z, len, 0.5, yaw, 0.6); };
      const art = (x, y, z, yaw, w, h) => { rb(w + 0.1, h + 0.1, 0.05, 0, y, 0, yaw, x, z, '#1d1d20'); rb(w, h, 0.06, 0, y, 0, yaw, x, z, rp(['#e8e0d0', '#2a3a4a', '#d8c8a8'])); rb(w * 0.45, h * 0.55, 0.07, -w * 0.15, y + h * 0.1, 0, yaw, x, z, rp(['#c0453a', '#d89a2a', '#3a7a8a'])); rb(w * 0.25, h * 0.6, 0.075, w * 0.22, y - h * 0.05, 0, yaw, x, z, rp(['#1d1d20', '#e8e0d0', '#4a6a9a'])); };
      const seatRow = (x, z, yaw, n, col) => { // Wartebank-Reihe mit Einzelsitzen
        rb(n * 0.52, 0.04, 0.06, 0, 0.3, 0.02, yaw, x, z, '#8a9096');
        for (let k = 0; k < n; k++) { const lx = (k - (n - 1) / 2) * 0.52; rb(0.46, 0.06, 0.46, lx, 0.44, 0, yaw, x, z, col); rb(0.46, 0.42, 0.05, lx, 0.72, -0.22, yaw, x, z, col); rb(0.04, 0.4, 0.04, lx, 0.2, 0.02, yaw, x, z, '#555'); sit(x, z, yaw, lx); }
        sol(x, z, n * 0.52, 0.5, yaw, 0.8);
      };
      const lounge = (cx, cz, yaw) => {
        const [c1, c2] = rp(PAL), at = (lx, lz) => P(yaw, cx, cz, lx, lz);
        rug(cx, cz, 5.0, 3.9, yaw, dim(c1, 0.75), dim(c2, 0.85));
        for (const s of [-1, 1]) { const [x, z] = at(0, s * 1.45), yy = s < 0 ? yaw : yaw + Math.PI; couch(x, z, yy, c1, 2.3); sit(x, z, yy, -0.5); sit(x, z, yy, 0.5); }
        for (const s of [-1, 1]) { const [x, z] = at(s * 2.0, 0), yy = yaw - s * Math.PI / 2; couch(x, z, yy, dim(c1, 1.2), 1.0); sit(x, z, yy); }
        table(cx, cz, yaw, 1.3, 0.7, rp(['#3a2a20', '#2b2b2b', '#6a5a48']));
        lamp(...at(-2.45, 1.8)); if (r() < 0.7) bush(...at(2.4, -1.8), 0.9);
        pend(cx, cz, 2.55, 0.28);
      };
      const nook = (cx, cz, yaw) => {
        const [c1] = rp(PAL), at = (lx, lz) => P(yaw, cx, cz, lx, lz);
        rug(cx, cz, 2.8, 2.8, yaw, dim(c1, 0.8), dim(c1, 1.1));
        for (const s of [-1, 1]) { const [x, z] = at(s * 0.95, 0), yy = yaw - s * Math.PI / 2; couch(x, z, yy, c1, 1.0); sit(x, z, yy); }
        table(cx, cz, yaw, 0.6, 0.6, '#3a2a20'); lamp(...at(0, 1.15)); bush(...at(0, -1.15), 0.8);
      };
      const rows = (cx, cz) => { // Wartebereich: 3 Sitzreihen, Blick Richtung Empfang (-z)
        const col = rp(['#2f5a7a', '#3a6a4a', '#7a3a3a', '#5a5a64']);
        for (let k = -1; k <= 1; k++) seatRow(cx, cz + k * 1.15, Math.PI, 5, col);
        bush(cx - 1.75, cz + 1.4, 0.8); bush(cx + 1.75, cz + 1.4, 0.8);
      };
      const island = (x, z) => { // Pflanzeninsel mit Bank
        const yaw = r() < 0.5 ? 0 : Math.PI / 2, [a, b] = [P(yaw, x, z, -1.4, 0), P(yaw, x, z, 1.4, 0)];
        bench(x, z, yaw, 1.9, rp(['#6a4a30', '#4a4a50', '#8a6a48'])); bush(...a, 0.9); bush(...b, 0.9);
      };
      const columns = col => {
        const nx = Math.max(1, Math.round(2 * hw / 8)), nz = Math.max(1, Math.round(2 * hd / 8));
        for (let i = 1; i < nx; i++) for (let j = 1; j < nz; j++) { const x = -hw + 2 * hw * i / nx, z = -hd + 2 * hd * j / nz; if (okAt(x, z, 0.6)) { pillar(x, z, col); claim(x, z, 0.7); } }
      };
      // Randstücke an den Außenwänden (Bank, Konsole, Pflanzkübel)
      const walls = () => {
        for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const len = nx ? 2 * hd : 2 * hw, off = (nx ? hw : hd) - 0.55, yw = Math.atan2(-nx, -nz);
          for (let t = -len / 2 + 2.5 + rr(0, 1.5); t < len / 2 - 2; t += rr(4.4, 6.2)) {
            const x = nx ? nx * off : t, z = nx ? t : nz * off, rx = nx ? 0.6 : 1.1, rz = nx ? 1.1 : 0.6;
            if (!okAt(x, z, rx, rz)) continue;
            claim(x, z, rx, rz, false);
            const k = Math.floor(r() * 4), a = P(yw, x, z, -0.5, 0), b = P(yw, x, z, 0.5, 0);
            if (k === 0) { bench(x, z, yw, 1.8, rp(['#6a4a30', '#4a4a50'])); bush(...P(yw, x, z, 1.35, 0), 0.9); }
            else if (k === 1) { rb(1.4, 0.8, 0.4, 0, 0.4, 0, yw, x, z, rp(['#4a3426', '#2f353b']), true); rb(1.5, 0.04, 0.46, 0, 0.82, 0, yw, x, z, '#d8d0c0'); lamp(...a); vc.push(colorize(new THREE.IcosahedronGeometry(0.12, 1).translate(b[0], 0.98, b[1]), rp(['#c0453a', '#3a7a8a']))); }
            else if (k === 2) { rb(1.7, 0.5, 0.5, 0, 0.25, 0, yw, x, z, '#4a4f55', true); bush(...a, 0.75); bush(...b, 0.75); }
            else { bush(...a, 1.15); bush(...b, 1.0); }
          }
        }
      };
      // Füllen: Lounges + Nischen nach Fläche, danach Inseln überall dort, wo mehr als ~4.4 m bis zum nächsten Möbel sind
      const fill = o => {
        const sc = []; for (let x = -hw + 2; x <= hw - 2; x += 2.2) for (let z = -hd + 2; z <= hd - 2; z += 2.2) sc.push([x + rr(-0.5, 0.5), z + rr(-0.5, 0.5)]);
        for (let i = sc.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [sc[i], sc[j]] = [sc[j], sc[i]]; }
        const near = (x, z, d) => pts.some(p => Math.hypot(p[0] - x, p[1] - z) < d), qy = () => Math.floor(r() * 4) * Math.PI / 2;
        const place = (n, rad, gap, fn) => { let c = 0; for (const [x, z] of sc) { if (c >= n) break; if (okAt(x, z, rad) && !near(x, z, gap)) { fn(x, z); claim(x, z, rad); c++; } } };
        const base = Math.max(0, Math.round((AR - 150) / 120 * (o.k || 1)));
        if (o.rows) place(Math.min(o.rows * Math.max(1, base), 6), 2.0, 5.5, (x, z) => rows(x, z));
        if (o.lounge) place(Math.max(1, Math.round(base * o.lounge)), 3.0, 6.6, (x, z) => lounge(x, z, qy()));
        if (o.nook) place(Math.max(1, Math.round(base * o.nook)), 1.8, 4.2, (x, z) => nook(x, z, qy()));
        walls();
        for (const [x, z] of sc) if (okAt(x, z, 1.4) && dist(x, z) > 4.4) { island(x, z); claim(x, z, 1.4); }
      };
      // Marmor-/Granit-/Terrazzo-Bodenfeld mit optionaler Messingeinfassung
      const inlay = (name, brass) => {
        T.hall ||= {};
        const m = T.hall[name] ||= new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.04, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, map: canvasTex(512, 512, (c, w, h) => {
          c.fillStyle = { marble: '#e9e4da', granite: '#6a6f75', terrazzo: '#dedad0' }[name]; c.fillRect(0, 0, w, h);
          if (name === 'marble') for (let i = 0; i < 16; i++) { c.strokeStyle = `rgba(${90 + rnd(0, 40)},${90 + rnd(0, 40)},${100 + rnd(0, 40)},${rnd(0.06, 0.2)})`; c.lineWidth = rnd(0.6, 2.4); c.beginPath(); c.moveTo(rnd(0, w), rnd(0, h)); c.bezierCurveTo(rnd(0, w), rnd(0, h), rnd(0, w), rnd(0, h), rnd(0, w), rnd(0, h)); c.stroke(); }
          else if (name === 'granite') speckle(c, w, h, 9000, 0.25, 0.3);
          else for (let i = 0; i < 700; i++) { c.fillStyle = ['#b9b3a8', '#9aa6ac', '#c8bfa8', '#f4f1ea'][i % 4]; c.fillRect(rnd(0, w), rnd(0, h), rnd(1, 5), rnd(1, 4)); }
          c.fillStyle = 'rgba(0,0,0,.16)'; for (let i = 0; i <= 4; i++) { c.fillRect(i * 128 - 1, 0, 2, h); c.fillRect(0, i * 128 - 1, w, 2); }
        }) });
        plane(-hw + 0.8, hw - 0.8, -hd + 0.8, hd - 0.8, 0.012, m, 4);
        if (brass) for (const [w, d, x, z] of [[2 * hw - 1.6, 0.07, 0, -hd + 0.85], [2 * hw - 1.6, 0.07, 0, hd - 0.85], [0.07, 2 * hd - 1.6, -hw + 0.85, 0], [0.07, 2 * hd - 1.6, hw - 0.85, 0]]) fb(w, 0.012, d, x, 0.014, z, '#b8964a');
      };
      // Rückwand hinter dem Empfang (nur große Hallen) mit Lamellen und Durchgang; Teppichläufer zum Kern
      const backWall = (zc, half, col) => {
        for (const s of [-1, 1]) { fb(half - 0.8, 3.4, 0.2, s * (half + 0.8) / 2, 1.7, zc, col, true); for (let x = 2.7; x < half - 0.1; x += 0.28) fb(0.1, 2.3, 0.05, s * x, 1.35, zc - 0.12, dim(col, 1.35)); }
        fb(1.6, 1.2, 0.2, 0, 2.8, zc, col); claim(0, zc, half + 0.3, 1.2, false);
      };
      const runner = (z0, z1, c1, c2) => { if (z1 - z0 > 3) { rug(0, (z0 + z1) / 2, 2.2, z1 - z0, 0, c1, c2); for (let z = z0 + 1.5; z < z1 - 0.5; z += 4.5) pend(0, z, 2.7, 0.2); } };
      // Bar: Theke mit Hockern, Rückbuffet mit Flaschen und Spiegel; sucht eine freie Wandposition
      const bar = () => {
        for (const len of [5.6, 4.4]) for (const [nx, nz, t] of [[0, 1, 0.5], [0, 1, -0.5], [1, 0, 0.5], [-1, 0, -0.5], [1, 0, -0.5], [-1, 0, 0.5], [0, 1, 0.1], [0, -1, 0.7], [0, -1, -0.7]]) {
          const ox = nx ? nx * (hw - 3.0) : t * hw, oz = nz ? nz * (hd - 3.0) : t * hd, yw = Math.atan2(nx, nz), cxy = P(yw, ox, oz, 0, 0.5), al = nx ? 2.35 : len / 2 + 0.3, dp = nx ? len / 2 + 0.3 : 2.35;
          if (!okAt(cxy[0], cxy[1], al, dp)) continue;
          claim(cxy[0], cxy[1], al, dp);
          rb(len, 1.0, 0.7, 0, 0.5, 0, yw, ox, oz, '#4a3020', true); rb(len + 0.14, 0.06, 0.92, 0, 1.03, 0, yw, ox, oz, '#e8e2d6'); rb(len, 0.04, 0.04, 0, 0.2, -0.42, yw, ox, oz, '#c8a040');
          rb(len, 0.9, 0.5, 0, 0.45, 2.6, yw, ox, oz, '#3a2418', true); rb(len, 1.5, 0.04, 0, 1.75, 2.83, yw, ox, oz, '#9fb0b8'); rb(len, 0.03, 0.06, 0, 1.28, 2.58, yw, ox, oz, '#fff', false, pan);
          for (const sy of [1.12, 1.5]) { rb(len, 0.04, 0.3, 0, sy, 2.68, yw, ox, oz, '#5a3a24'); for (let q = -len / 2 + 0.2; q < len / 2 - 0.1; q += 0.22) { const [bx, bz] = P(yw, ox, oz, q, 2.68); cyl(0.045, 0.045, 0.3, bx, sy + 0.17, bz, rp(['#3a6b3a', '#8b4a2a', '#c9a14a', '#2a4a7a', '#7a2a3a', '#d8d8c8']), vc, 6); } }
          const ns = Math.floor(len / 1.1);
          for (let k = 0; k < ns; k++) { const [sx, sz] = P(yw, ox, oz, (k - (ns - 1) / 2) * 1.1, -0.95); cyl(0.24, 0.24, 0.07, sx, 0.72, sz, '#7a2a2a', vc, 12); cyl(0.03, 0.03, 0.7, sx, 0.36, sz, '#c8a040', vc, 6); cyl(0.2, 0.2, 0.03, sx, 0.015, sz, '#2a2a2a', vc, 10); }
          spot('bar', ...P(yw, ox, oz, 0, 1.55), yw + Math.PI, 'stand', all);
          for (const s of [-1, 1]) spot('visit', ...P(yw, ox, oz, s * len * 0.27 + 0.55, -1.1), yw, s < 0 ? 'talk' : 'look', all, { bar: true });
          pend(...P(yw, ox, oz, -len * 0.3, 0), 2.45, 0.2); pend(...P(yw, ox, oz, len * 0.3, 0), 2.45, 0.2);
          return true;
        }
        return false;
      };
      return { res, okAt, claim, dist, P, dim, sol, cyl, rug, couch, sit, table, lamp, bush, pillar, pend, chandelier, bench, art, seatRow, lounge, nook, rows, island, columns, walls, fill, inlay, backWall, runner, bar, AR };
    })();
    if (kind === 'office' || kind === 'flat' || kind === 'ward') {
      // Großraumbüro: Tischreihen in den Randstreifen
      for (let x = -hw + 2; x < hw - 1.5; x += 1.8) { if (Math.abs(x) < 6.5) continue; for (const z of [-hd + 2.2, hd - 2.2]) if (r() < 0.85) desk(x, z, z < 0 ? Math.PI : 0, all); }
      for (let z = -hd + 3; z < hd - 2; z += 1.8) for (const x of [-hw + 2.2, hw - 2.2]) if (Math.abs(z) < 6 && r() < 0.85) desk(x, z, x < 0 ? -Math.PI / 2 : Math.PI / 2, all);
      fb(0.35, 1.15, 0.35, -6.5, 0.575, hd - 1.0, '#7fb8e6', true); spot('cooler', -6.5, hd - 2.0, 0, 'talk', all); spot('cooler', -5.6, hd - 2.0, 0, 'talk', all);
      plant(hw - 0.8, -hd + 0.8); plant(-hw + 0.8, hd - 0.8);
    } else if (kind === 'lobby') {
      const co = b.type === 'hospital' ? 'Pillbox Krankenhaus' : b.type === 'office' ? companyOf(b, 1) : 'Wohnanlage ' + ['Vinewood', 'Rockford', 'Mirror Park', 'Alta'][b.seed % 4];
      INT.company = co;
      rb(3.4, 1.1, 0.7, 0, 0.55, 0, 0, 0, -hd + 5.5, '#3a3f45', true); rb(3.6, 0.05, 0.9, 0, 1.12, 0, 0, 0, -hd + 5.5, '#d8d0c0');
      spot('reception', 0, -hd + 6.3, Math.PI, 'stand', all); spot('visit', -0.4, -hd + 4.6, 0, 'talk', all); spot('visit', 0.6, -hd + 4.6, 0, 'look', all);
      sofa(-hw + 2.5, -hd + 4, Math.PI / 2, all, '#2f3a4a'); sofa(hw - 2.5, -hd + 4, -Math.PI / 2, all, '#2f3a4a');
      plant(-2.4, -hd + 5.5); plant(2.4, -hd + 5.5); plant(-hw + 0.8, -hd + 0.8); plant(hw - 0.8, -hd + 0.8);
      const sign = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = '#1b1e22'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8d9b0'; c.font = 'bold 70px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(co.toUpperCase(), w / 2, h / 2 + 4); });
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.7), new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.5 }));
      sm.rotation.y = 0; sm.position.set(1.1, 2.95, 3.14); g.add(sm);
      const sm2 = sm.clone(); sm2.rotation.y = 0; sm2.position.set(0, 2.4, -hd + 5.15); sm2.scale.setScalar(0.6); g.add(sm2);
      // Große Halle: Bodenfeld, Rückwand, Säulen, Wartebereich/Lounges je nach Gebäudeart
      const hos = b.type === 'hospital', off = b.type === 'office';
      hk.inlay(hos ? 'terrazzo' : off ? 'granite' : 'marble', false);
      hk.claim(0, -hd + 5.5, 2.8, 1.5); for (const s of [-1, 1]) hk.claim(s * (hw - 2.5), -hd + 4, 1.3, 1.4);
      hk.rug(0, -hd + 1.5, 2.4, 1.6, 0, '#3a3f45', '#8a8f95');
      if (hd >= 12) { hk.backWall(-hd + 7.1, 4.8, off ? '#3a3f45' : '#4a4036'); const sm3 = sm.clone(); sm3.scale.setScalar(0.88); sm3.position.set(0, 2.6, -hd + 6.97); sm3.rotation.y = Math.PI; g.add(sm3); }
      hk.runner(-hd + 8, -4.6, '#3a3f45', '#8a8f95');
      hk.columns(off ? '#c9cdd1' : '#e0d8c8');
      if (!off && !hos) { const ln = Math.min(4.8, hw - 4), cx = -(3.2 + ln / 2), mz = -hd + 0.55; if (ln >= 2.4 && hk.okAt(cx, mz, ln / 2, 0.3)) { hk.claim(cx, mz, ln / 2, 0.5); rb(ln, 1.5, 0.3, 0, 1.0, 0, 0, cx, mz, '#8a9096', true); const nc = Math.floor(ln / 0.42); for (let rw = 0; rw < 3; rw++) for (let k = 0; k < nc; k++) rb(0.36, 0.4, 0.02, (k - (nc - 1) / 2) * 0.42, 0.55 + rw * 0.5, 0.16, 0, cx, mz, (k + rw) % 3 ? '#aab0b6' : '#c4a35a'); } }
      if (hos) for (let k = 0; k < 2; k++) { const vx = hw - 0.8, vz = -hd + 9 + k * 1.0; if (hk.okAt(vx, vz, 0.6, 0.5)) { hk.claim(vx, vz, 0.6, 0.5, false); rb(0.8, 1.9, 0.9, 0, 0.95, 0, -Math.PI / 2, vx, vz, k ? '#2a6a9a' : '#9a2a2a', true); rb(0.6, 1.2, 0.02, 0, 1.15, 0.46, -Math.PI / 2, vx, vz, '#fff', false, pan); } }
      hk.fill(hos ? { rows: 1, nook: 0.6, lounge: 0.2 } : off ? { lounge: 0.8, nook: 0.8 } : { lounge: 1, nook: 0.6 });
    } else if (kind === 'shop') {
      INT.company = SHOPS[b.seed % SHOPS.length];
      rb(2.6, 1.0, 0.7, 0, 0.5, 0, 0, -hw + 3.2, -hd + 3.5, '#704a2a', true); rb(0.4, 0.3, 0.3, 0.6, 1.15, 0, 0, -hw + 3.2, -hd + 3.5, '#222');
      spot('cashier', -hw + 3.2, -hd + 4.3, Math.PI, 'stand', all); spot('pay', -hw + 3.2, -hd + 2.5, 0, 'look', all);
      const prod = ['#d43f3a', '#f0ad4e', '#5cb85c', '#5bc0de', '#ffffff', '#8e44ad', '#2c3e50', '#e67e22'];
      for (let row = 0; row < 3; row++) {
        const z = -hd + 7 + row * 3.2; if (core && z > -3.8 && z < 3.8) continue;
        for (const x of [-hw / 2 - 1, hw / 2 + 1]) {
          const len = Math.min(5, hw - 5); rb(len, 1.8, 0.6, 0, 0.9, 0, 0, x, z, '#e0e0e0', true);
          for (let k = 0; k < 18; k++) for (const sz of [-0.32, 0.32]) rb(0.22, 0.28, 0.18, -len / 2 + 0.2 + (k / 17) * (len - 0.4), 0.35 + (k % 3) * 0.55, sz, 0, x, z, prod[(k * 7 + row) % prod.length]);
          spot('shelf', x + rnd(-1.5, 1.5), z - 0.9, 0, 'browse', all); spot('shelf', x + rnd(-1.5, 1.5), z + 0.9, Math.PI, 'browse', all);
        }
      }
      for (let x = -hw + 1.5; x < hw - 1; x += 1.2) { fb(1.1, 2.0, 0.7, x, 1.0, hd - 0.6, '#d8dde2', true); scr.push(box(1.0, 1.6, 0.02, x, 1.05, hd - 0.96, '#fff')); }
    } else if (kind === 'market' || kind === 'gas') {
      INT.company = floorName(b, 0);
      const stk = newStock(), pr = mulberry(b.seed * 17 + f * 131 + 7); prods.push(stk);
      const lanes = kind === 'market' ? Math.max(2, Math.min(4, Math.floor(W / 8))) : 1;
      for (let k = 0; k < lanes; k++) {
        const x = -hw + 2.6 + k * 3.4, z = -hd + 3.4;
        rb(0.8, 0.9, 2.4, 0, 0.45, 0, 0, x, z, '#3a3f45', true); rb(0.5, 0.05, 1.6, 0, 0.92, -0.2, 0, x, z, '#222'); rb(0.35, 0.35, 0.3, 0, 1.12, 0.7, 0, x, z, '#1a1a1a');
        spot('cashier', x + 0.95, z + 0.4, -Math.PI / 2, 'stand', all); spot('pay', x - 0.95, z - 0.2, Math.PI / 2, 'look', all);
      }
      // Regale (Gondeln): Rückwand, Seitenwände, 4 Bretter mit Preisschiene; Ware in Facings (gleiches Produkt 2-6x nebeneinander, 2 Reihen tief) mit Preisschild
      const cats = kind === 'market' ? ['soda', 'snack', 'cereal', 'canned', 'dairy', 'water', 'beer', 'pantry'] : ['soda', 'snack', 'water', 'beer'];
      let unit = 0;
      for (let z = -hd + (kind === 'market' ? 7 : 5.5), row = 0; z < hd - 2.6; z += 2.8, row++) {
        for (let x = -hw + (kind === 'market' ? 4 : 2.8); x < hw - 3; x += 7, unit++) {
          const len = Math.min(5.5, hw - 1.5 - x); if (len < 2) continue;
          const cx = x + len / 2;
          fb(len, 1.8, 0.04, cx, 0.9, z, '#c9ced3'); fb(0.04, 1.8, 0.8, x + 0.02, 0.9, z, '#aeb4ba'); fb(0.04, 1.8, 0.8, x + len - 0.02, 0.9, z, '#aeb4ba');
          fb(len, 0.05, 0.8, cx, 1.825, z, '#e3e3e3'); fb(len - 0.08, 0.12, 0.76, cx, 0.06, z, '#6b7077');
          for (let lv = 0; lv < 4; lv++) { const by = 0.135 + lv * 0.42; fb(len - 0.08, 0.03, 0.8, cx, by, z, '#b7bdc3'); fb(len - 0.08, 0.034, 0.012, cx, by, z - 0.406, '#5d636a'); fb(len - 0.08, 0.034, 0.012, cx, by, z + 0.406, '#5d636a'); }
          iSolid(x, x + len, z - 0.4, z + 0.4, 1.85);
          for (const sg of [-1, 1]) { const cat = cats[(unit * 3 + (sg > 0 ? 1 : 0) + row) % cats.length]; for (let lv = 0; lv < 4; lv++) stockShelf(stk, pr, x + 0.04, x + len - 0.04, 0.15 + lv * 0.42, z, sg, cat, lv); }
          spot('shelf', x + len / 2 + rnd(-1.5, 1.5), z - 0.9, 0, 'browse', all); spot('shelf', x + len / 2 + rnd(-1.5, 1.5), z + 0.9, Math.PI, 'browse', all);
        }
      }
      // Kühlregale an der Rückwand: das Modell ohne seine Champagnerflaschen, innen Getränke als Instanzen
      for (let x = -hw + 1.2; x < hw - 0.8; x += 1.0) {
        const fr = modelInstance('CommercialRefrigerator', 2.15, 'y');
        if (fr) {
          const drop = []; fr.traverse(o => { if (o.isMesh && /^Champagne/.test(o.name)) drop.push(o); }); for (const o of drop) o.removeFromParent();
          fr.position.set(x, 0, hd - 0.55); fr.rotation.y = Math.PI; g.add(fr); stockFridge(stk, pr, x, hd - 0.55, Math.PI);
          fSolid(F, x - 0.45, x + 0.45, hd - 1.0, hd - 0.1, -0.05, 2.2); continue;
        }
        fb(1.1, 2.0, 0.7, x, 1.0, hd - 0.6, '#d8dde2', true); scr.push(box(1.0, 1.6, 0.02, x, 1.05, hd - 0.96, '#fff'));
      }
      if (kind === 'market') {
        // Obsttheke am Eingang: Holzkisten mit Mandarinen und Avocados (echte Modelle als Instanzen)
        const frt = ['orange', 'avocado', 'avocado', 'orange', 'orange', 'avocado', 'avocado', 'orange'];
        for (let k = 0; k < 4; k++) {
          const x = hw - 3 - k * 1.6, z = -hd + 3, th = 0.5;
          rb(1.3, th, 0.62, 0, th / 2, 0, 0, x, z, '#5c4128', true); rb(1.34, 0.03, 0.66, 0, th + 0.015, 0, 0, x, z, '#7a5a38');
          for (let q = 0; q < 2; q++) {
            const cx = x + (q ? 0.32 : -0.32), cw = 0.58, cd = 0.44, cy = th + 0.03, wood = q ? '#b98d55' : '#a87a46';
            rb(cw, 0.16, cd, 0, cy + 0.08, 0, 0, cx, z, '#4a2e16'); // Füllung (dunkel zwischen den Früchten)
            rb(cw, 0.2, 0.02, 0, cy + 0.1, cd / 2 - 0.01, 0, cx, z, wood); rb(cw, 0.2, 0.02, 0, cy + 0.1, -cd / 2 + 0.01, 0, cx, z, wood);
            rb(0.02, 0.2, cd, cw / 2 - 0.01, cy + 0.1, 0, 0, cx, z, wood); rb(0.02, 0.2, cd, -cw / 2 + 0.01, cy + 0.1, 0, 0, cx, z, wood);
            for (const sy of [0.04, 0.12, 0.2]) { rb(cw + 0.02, 0.012, 0.02, 0, cy + sy, cd / 2 + 0.002, 0, cx, z, '#8a5e30'); rb(cw + 0.02, 0.012, 0.02, 0, cy + sy, -cd / 2 - 0.002, 0, cx, z, '#8a5e30'); }
            const kind2 = frt[k * 2 + q]; stockCrate(stk, pr, kind2, cx, cy + 0.16, z, cw - 0.04, cd - 0.04, (pr() - 0.5) * 0.3);
            stockAdd(stk, 'tag:' + (k * 2 + q + (kind2 === 'orange' ? 2 : 5)) % 8, cx, cy + 0.105, z + cd / 2 + 0.014, 0, 2.2); stockAdd(stk, 'tag:' + (k * 2 + q + 3) % 8, cx, cy + 0.105, z - cd / 2 - 0.014, Math.PI, 2.2);
          }
        }
        // Fischtheke: weißer Korpus, leicht blau leuchtende Eisfläche mit Eisstücken, Fische (BarramundiFish) liegen darauf
        const fx = hw - 0.65, fz = -hd + 7;
        rb(0.8, 0.9, 2.4, 0, 0.45, 0, 0, fx, fz, '#f2f4f6', true); rb(0.86, 0.04, 2.46, 0, 0.92, 0, 0, fx, fz, '#d9dee3');
        for (const [w2, d2, ox, oz] of [[0.86, 0.05, 0, 1.205], [0.86, 0.05, 0, -1.205], [0.05, 2.46, 0.405, 0], [0.05, 2.46, -0.405, 0]]) rb(w2, 0.09, d2, ox, 0.97, oz, 0, fx, fz, '#d9dee3');
        const ice = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 2.34), new THREE.MeshStandardMaterial({ color: 0xc9e4f4, emissive: 0x3f86c0, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.05 })); ice.position.set(fx, 0.955, fz); g.add(ice);
        for (let q = 0; q < 70; q++) { const s2 = rr(0.025, 0.05); vc.push(colorize(new THREE.IcosahedronGeometry(s2, 0).rotateY(rr(0, 6)).translate(fx + rr(-0.33, 0.33), 0.975 + s2 * 0.4, fz + rr(-1.1, 1.1)), q % 3 ? '#e4f2fa' : '#cfe6f3')); }
        for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) stockModel(stk, 'BarramundiFish', 0.46, 'z', fx + (j - 1) * 0.235 + rr(-0.02, 0.02), 0.985 + 0.045, fz + (i - 1.5) * 0.58 + rr(-0.03, 0.03), 0, (i + j) % 2 ? 0 : Math.PI + rr(-0.15, 0.15), ((i + j) % 2 ? 1 : -1) * Math.PI / 2, 'center');
        stockAdd(stk, 'tag:3', fx - 0.412, 0.62, fz, -Math.PI / 2, 5);
        spot('shelf', fx - 1.3, fz, Math.PI / 2, 'browse', all);
      }
    } else if (kind === 'bank') {
      INT.company = 'Fleeca Bank';
      for (let k = 0; k < 3; k++) { const x = -3 + k * 3; rb(2.4, 1.1, 0.8, 0, 0.55, 0, 0, x, -hd + 5, '#2f5a3a', true); rb(2.4, 0.9, 0.05, 0, 1.55, 0.3, 0, x, -hd + 5, '#cfe0e8'); spot('cashier', x, -hd + 5.8, Math.PI, 'stand', all); spot('visit', x, -hd + 4, 0, 'look', all); }
      const v = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 32), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.25 })); v.rotation.x = Math.PI / 2; v.position.set(hw - 0.3, 1.6, 0); v.rotation.z = Math.PI / 2; g.add(v);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.8), new THREE.MeshStandardMaterial({ map: signTex('FLEECA', '#1f6b3a', '#ffffff'), emissive: 0xffffff, emissiveMap: signTex('FLEECA', '#1f6b3a', '#ffffff'), emissiveIntensity: 0.4 })); sign.position.set(0, 2.7, -hd + 6.6); sign.rotation.y = Math.PI; g.add(sign);
      plant(-hw + 0.8, -hd + 0.8); plant(hw - 0.8, -hd + 0.8); sofa(-hw + 2.2, -hd + 3, Math.PI / 2, all, '#2a3a2a');
      // Große Halle: Granitfeld, Warteschlange, Wartebereich, Berater-Tische, Geldautomaten, Säulen
      hk.inlay('granite', true);
      hk.claim(0, -hd + 4.9, 4.4, 1.9); hk.claim(-hw + 2.2, -hd + 3, 1.3, 1.4); hk.claim(hw - 1.6, 0, 1.7, 1.9);
      for (const s of [-1, 1]) for (const pz of [-hd + 1.4, -hd + 3.0]) { hk.cyl(0.03, 0.03, 0.9, s * 1.3, 0.47, pz, '#c8c8c8', vc, 6); hk.cyl(0.14, 0.14, 0.03, s * 1.3, 0.015, pz, '#2a2a2a'); }
      for (const s of [-1, 1]) rb(0.025, 0.04, 1.6, 0, 0.82, 0, 0, s * 1.3, -hd + 2.2, '#a02020');
      for (const [ax, az] of [[hw - 0.8, -hd + 2.6], [hw - 0.8, -hd + 3.7]]) if (hk.okAt(ax, az, 0.5)) { hk.claim(ax, az, 0.5, 0.5, false); rb(0.6, 1.8, 0.8, 0, 0.9, 0, -Math.PI / 2, ax, az, '#2d3a44', true); rb(0.4, 0.3, 0.02, 0.1, 1.45, 0.38, -Math.PI / 2, ax, az, '#fff', false, scr); rb(0.5, 0.03, 0.02, 0, 1.85, 0, -Math.PI / 2, ax, az, '#1f6b3a', false); }
      for (const sx of [-1, 1]) { let nd = 0; for (let z = -hd + 8; z < hd - 2.5 && nd < 3; z += 2.6) { const dx = sx * (hw - 2.2); if (hk.okAt(dx, z, 1.0, 1.1)) { hk.claim(dx, z, 1.0, 1.1, false); desk(dx, z, sx < 0 ? -Math.PI / 2 : Math.PI / 2, all); nd++; } } }
      hk.columns('#d8d6cc'); hk.fill({ rows: 1, lounge: 0.5, nook: 0.6, k: 0.9 });
    } else if (kind === 'hotel') {
      INT.company = floorName(b, 0).replace('EG · ', '');
      rb(4, 1.1, 0.8, 0, 0.55, 0, 0, 0, -hd + 5, '#5a3a24', true); rb(4.2, 0.05, 1.0, 0, 1.12, 0, 0, 0, -hd + 5, '#e8dcc0');
      spot('reception', 0, -hd + 5.9, Math.PI, 'stand', all); spot('visit', -0.6, -hd + 4, 0, 'look', all); spot('visit', 0.8, -hd + 4, 0, 'talk', all);
      sofa(-hw + 2.4, -hd + 4, Math.PI / 2, all, '#7a2a2a'); sofa(hw - 2.4, -hd + 4, -Math.PI / 2, all, '#7a2a2a'); plant(-2.6, -hd + 5); plant(2.6, -hd + 5);
      const chand = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0a0, emissiveIntensity: 2 })); chand.position.set(0, 2.9, -hd + 3); g.add(chand);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.8), new THREE.MeshStandardMaterial({ map: signTex(INT.company.toUpperCase(), '#2a1a10', '#e8c070', 1024, 160, 'bold 80px Georgia'), emissive: 0xffffff, emissiveMap: signTex(INT.company.toUpperCase(), '#2a1a10', '#e8c070', 1024, 160, 'bold 80px Georgia'), emissiveIntensity: 0.4 })); sign.position.set(0, 2.6, -hd + 6.5); sign.rotation.y = Math.PI; g.add(sign);
      // Große Halle: Marmorfeld, Rückwand mit Läufer, Bar, Säulen, Lounges, Gepäckwagen (alles gemerged)
      hk.inlay('marble', true);
      hk.claim(0, -hd + 5.2, 2.95, 1.9); for (const s of [-1, 1]) hk.claim(s * (hw - 2.4), -hd + 4, 1.3, 1.4);
      for (const s of [-1, 1]) { rb(0.42, 0.3, 0.04, s * 1.1, 1.3, 0.3, 0, 0, -hd + 5, '#111'); rb(0.38, 0.26, 0.02, s * 1.1, 1.3, 0.32, 0, 0, -hd + 5, '#fff', false, scr); }
      hk.rug(0, -hd + 1.5, 2.4, 1.6, 0, '#4a2a20', '#b8964a');
      if (hd >= 12) { hk.backWall(-hd + 6.62, 5.2, '#4a3226'); hk.chandelier(0, (-hd + 7.8 - 4.6) / 2); }
      hk.runner(-hd + 7.8, -4.6, '#6a1f24', '#b8964a');
      hk.columns('#e4dccb'); hk.bar();
      { const tx = 3.6, tz = -hd + 2.2, ty = r() < 0.5 ? 0 : Math.PI; if (hk.okAt(tx, tz, 0.8)) { hk.claim(tx, tz, 0.8); rb(1.0, 0.06, 0.6, 0, 0.14, 0, ty, tx, tz, '#b8964a'); for (const s of [-1, 1]) rb(0.04, 1.5, 0.04, s * 0.46, 0.85, 0, ty, tx, tz, '#b8964a'); rb(1.0, 0.04, 0.04, 0, 1.55, 0, ty, tx, tz, '#b8964a'); rb(0.8, 0.5, 0.45, -0.05, 0.42, 0, ty, tx, tz, rp(['#6a2a2a', '#2a3a5a'])); rb(0.6, 0.4, 0.4, 0, 0.87, 0, ty, tx, tz, rp(['#8a6a40', '#3a3a40'])); hk.sol(tx, tz, 1.0, 0.6, ty, 1.0); } }
      hk.fill({ lounge: 1, nook: 0.9 });
    } else if (kind === 'police') {
      INT.company = 'Polizeiwache Mission Row';
      rb(4.2, 1.1, 0.8, 0, 0.55, 0, 0, 0, -hd + 4.5, '#2a3344', true); rb(4.4, 0.05, 1.0, 0, 1.12, 0, 0, 0, -hd + 4.5, '#c8c0b0');
      spot('reception', 0, -hd + 5.4, Math.PI, 'stand', all); spot('visit', -0.5, -hd + 3.6, 0, 'talk', all); spot('visit', 0.7, -hd + 3.6, 0, 'look', all);
      for (const x of [-hw + 2.4, hw - 2.4]) for (let z = -hd + 7.5; z < hd - 5; z += 2.6) if (!core || Math.abs(z) > 3.8 || Math.abs(x) > 4.5) desk(x, z, x < 0 ? -Math.PI / 2 : Math.PI / 2, all);
      for (let x = -hw + 1; x < -hw + 6; x += 0.22) fb(0.05, 2.6, 0.05, x, 1.3, hd - 3, '#3a3a3a');
      iSolid(-hw + 0.8, -hw + 6, hd - 3.05, hd - 2.95); fb(1.8, 0.45, 0.7, -hw + 2, 0.22, hd - 1, '#6a6a6a', true);
      const sign = canvasTex(1024, 160, (c, w, h) => { c.fillStyle = '#0d1b33'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8d9b0'; c.font = 'bold 84px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('LOS SANTOS POLICE', w / 2, h / 2 + 4); });
      const sm = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.95), new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.4 }));
      sm.position.set(0, 2.6, -hd + 5.6); g.add(sm);
      // Große Wache: Wartebänke, zweite Schreibtischreihe, Pinnwände, Säulen
      hk.claim(0, -hd + 4.5, 2.6, 1.8); hk.claim(-hw + 3.4, hd - 1.8, 3.0, 1.9);
      for (const s of [-1, 1]) hk.claim(s * (hw - 1.9), (-hd + 6.2 + hd - 4.2) / 2, 1.7, (2 * hd - 10.4) / 2 + 0.8);
      hk.rug(0, -hd + 1.5, 2.4, 1.6, 0, '#2a3344', '#8a93a0');
      if (hw >= 12) for (const s of [-1, 1]) for (let z = -hd + 8.5; z < hd - 4.5; z += 2.8) { const dx = s * (hw - 6.2); if (hk.okAt(dx, z, 0.9, 1.2)) { hk.claim(dx, z, 0.9, 1.2, false); desk(dx, z, s < 0 ? Math.PI / 2 : -Math.PI / 2, all); } }
      for (const [bx, bz, by] of [[-5.2, -hd + 1.0, 0], [5.2, -hd + 1.0, 0]]) if (hk.okAt(bx, bz, 1.3, 0.5)) { hk.claim(bx, bz, 1.3, 0.5, false); rb(2.4, 1.4, 0.06, 0, 1.45, 0, by, bx, bz, '#8a6a40'); rb(0.06, 1.0, 0.06, -1.0, 0.5, 0, by, bx, bz, '#333'); rb(0.06, 1.0, 0.06, 1.0, 0.5, 0, by, bx, bz, '#333'); for (let k = 0; k < 6; k++) rb(0.5, 0.65, 0.02, -0.85 + (k % 3) * 0.85, 1.15 + Math.floor(k / 3) * 0.7, 0.04, by, bx, bz, rp(['#f4f0e0', '#e8d890', '#d8e0e8'])); }
      hk.columns('#cfd3d8'); hk.fill({ rows: 1, k: 1.2 });
    }
  }
  // Meshes zusammenführen
  const add = (list, m, shadow = true) => { if (!list.length) return; const mesh = new THREE.Mesh(mergeGeometries(list.map(q => q.index ? q.toNonIndexed() : q)), m); mesh.receiveShadow = shadow; g.add(mesh); };
  add(vc, M.ivcol); add(scr, T.mats.screen, false); add(pan, T.mats.panel, false);
  if (glass.length) g.add(new THREE.Mesh(mergeGeometries(glass), T.mats.glass));
  for (const s of prods) stockFinish(s, g); // Regalware, Obst, Fisch, Kühlschrank-Inhalt: wenige InstancedMeshes
  F.rooms = rooms; if (F.rdefs) mkRoomDoors(F, g, F.rdefs, F.rdPlates);
  if (myHotelFloor(F) && rooms.length) {
    const q = rooms[player.hotel.room % rooms.length], bed = spots.find(sp => sp.type === 'bed' && sp.room === q);
    if (bed) { const mk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })); mk.position.set(q.inPt[0], 0.6, q.inPt[1]); g.add(mk); F.hotelBed = { x: q.inPt[0], z: q.inPt[1] }; }
  }
  F.deferQ = []; populateFloor(F); const q0 = F.deferQ; F.deferQ = null; F.spawnQ = q0;
  return F;
}
function unloadFloor(F) {
  for (const s of F.solids) removeSolid(s);
  for (const n of F.npcs) { if (n.at && n.at.occ === n) n.at.occ = null; disposeHuman(n.h); }
  F.rd?.tex?.dispose();
  F.group.traverse(o => { if (o.geometry && !o.isSkinnedMesh && o.geometry !== F.doors[0]?.geometry) o.geometry.dispose(); });
  INT.root.remove(F.group); INT.floors.delete(F.f);
}
// ---------- Aufzug: fahrende Kabine mit Türen ----------
function liftCanvas(w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return { cv, ctx: cv.getContext('2d'), tex }; }
function drawLiftDisp(d, floor, dir) {
  const x = d.ctx, W = d.cv.width, H = d.cv.height; x.fillStyle = '#050505'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#ff8a1a'; x.font = `bold ${H * 0.8}px Courier New, monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(`${dir > 0 ? '▲' : dir < 0 ? '▼' : ' '}${floor === 0 ? 'E' : floor}`, W / 2, H / 2 + 2); d.tex.needsUpdate = true;
}
function drawLiftPanel() {
  const C = INT.cab; if (!C) return; const d = C.pd, x = d.ctx, W = d.cv.width, H = d.cv.height, n = INT.b.floors, cols = n > 20 ? 3 : 2, rows = Math.ceil(n / cols);
  const gr = x.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#c9ced3'); gr.addColorStop(1, '#8a9097'); x.fillStyle = gr; x.fillRect(0, 0, W, H);
  x.fillStyle = '#050505'; x.fillRect(16, 10, W - 32, 34); x.fillStyle = '#ff8a1a'; x.font = 'bold 26px Courier New'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(C.floor === 0 ? 'E' : String(C.floor), W / 2, 28);
  const top = 56, cell = Math.min((W - 20) / cols, (H - top - 8) / rows), r = cell * 0.36;
  for (let f = 0; f < n; f++) {
    const col = f % cols, row = rows - 1 - Math.floor(f / cols), cx = 10 + cell * (col + 0.5) + (W - 20 - cell * cols) / 2, cy = top + cell * (row + 0.5);
    const lit = C.lit.has(f), sel = INT.panelMode && INT.sel === f;
    x.beginPath(); x.arc(cx, cy, r + 3, 0, 7); x.fillStyle = sel ? '#ffd23a' : '#5d636a'; x.fill();
    const bg = x.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r); if (lit) { bg.addColorStop(0, '#fff6d0'); bg.addColorStop(1, '#ff9a10'); } else { bg.addColorStop(0, '#f4f6f8'); bg.addColorStop(1, '#a8aeb4'); }
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fillStyle = bg; x.fill();
    x.fillStyle = lit ? '#fff' : '#1a1c1f'; x.font = `bold ${Math.round(r * 1.05)}px Arial`; x.fillText(f === 0 ? 'E' : String(f), cx, cy + 1);
  }
  d.tex.needsUpdate = true;
}
function buildCab() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.6, roughness: 0.55 }), wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.6 });
  const add = (w, h, d, x, y, z, mat = m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.receiveShadow = true; g.add(o); return o; };
  add(2.45, 0.08, 2.4, 0, 0.04, 0, wood); add(2.45, 2.7, 0.06, 0, 1.35, 1.2); add(0.06, 2.7, 2.4, -1.22, 1.35, 0); add(0.06, 2.7, 2.4, 1.22, 1.35, 0); add(2.45, 0.06, 2.4, 0, 2.72, 0);
  add(1.2, 0.03, 0.8, 0, 2.68, 0, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 0.9 }));
  add(2.3, 0.05, 0.05, 0, 0.95, 1.12, m);
  // Frontblenden neben der Tür (vorher offen -> man sah im Schacht die Etagen vorbeiziehen)
  add(0.64, 2.7, 0.06, -0.92, 1.35, -1.215); add(0.64, 2.7, 0.06, 0.92, 1.35, -1.215); add(2.45, 0.22, 0.06, 0, 2.61, -1.215);
  add(2.2, 1.3, 0.02, 0, 1.6, 1.165, new THREE.MeshStandardMaterial({ color: 0xd8e0e6, metalness: 0.9, roughness: 0.14 }));
  const dl = add(0.62, 2.5, 0.05, -0.31, 1.3, -1.18), dr = add(0.62, 2.5, 0.05, 0.31, 1.3, -1.18);
  // Tastenfeld (Canvas-Textur) und Etagenanzeige in der Kabine
  const pd = liftCanvas(160, 320), panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.6), new THREE.MeshStandardMaterial({ map: pd.tex, emissive: 0xffffff, emissiveMap: pd.tex, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.3 }));
  panel.position.set(0.92, 1.3, -1.13); g.add(panel);
  const dd = liftCanvas(128, 48), disp = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshBasicMaterial({ map: dd.tex })); disp.position.set(0, 2.62, -1.14); g.add(disp);
  const b = INT.b, start = b.floors > 1 ? rint(0, b.floors - 1) : 0;
  g.position.set(-1.85, floorY(start), -1.7); INT.root.add(g);
  const C = { g, dl, dr, y: floorY(start), target: start, floor: start, v: 0, open: start === 0 ? 1 : 0, state: start === 0 ? 'open' : 'idle', wait: 6, panel, pd, disp, dd, lit: new Set(), calls: new Set(), shown: '', hold: 0 };
  return C;
}
function callCab(f) {
  const C = INT.cab; if (!C) return;
  if (C.target !== f && C.target != null) { C.lit.delete(C.target); C.calls.delete(C.target); }
  C.target = f;
  if (C.state === 'moving') return;
  if (C.floor === f && Math.abs(C.y - floorY(f)) < 0.01 && C.state !== 'moving') { C.after = null; if (C.state !== 'open') C.state = 'opening'; C.wait = 8; C.calls.delete(f); C.lit.delete(f); return; }
  C.after = null; C.state = C.state === 'idle' ? 'moving' : 'closing'; C.floor0 = C.floor; C.hold = 0.45; if (C.state === 'moving') sfx.hum(true);
}
function inCab() { const [lx, lz] = toLocal(player.x, player.z); return lx > ELEV[0] && lx < ELEV[1] && lz > ELEV[2] && lz < ELEV[3] && Math.abs(player.y - INT.cab.y) < 1.2; }
function updateCab(dt) {
  const C = INT.cab, ty = floorY(C.target);
  if (C.state === 'closing') { C.open = Math.max(0, C.open - dt * 1.1); if (C.open === 0 && (C.hold -= dt) <= 0) { if (C.after === 'idle' && Math.abs(C.y - ty) <= 0.01) { C.state = 'idle'; C.after = null; } else { C.state = Math.abs(C.y - ty) > 0.01 ? 'moving' : 'opening'; if (C.state === 'moving') sfx.hum(true); } } }
  else if (C.state === 'moving') {
    // Fahrprofil: sanft anfahren, gleichmäßig fahren, weich abbremsen (begrenzte Beschleunigung)
    const d = ty - C.y, amax = 1.15, vmax = 3.4, want = Math.sign(d) * Math.min(vmax, Math.sqrt(2 * amax * Math.abs(d)) * 0.95);
    C.v += clamp(want - C.v, -amax * dt * 1.5, amax * dt * 1.5); let step = C.v * dt;
    if (Math.abs(d) < 0.004 || (Math.sign(step) === Math.sign(d) && Math.abs(step) >= Math.abs(d))) { C.y = ty; C.v = 0; C.floor = C.target; C.state = 'opening'; C.hold = 0; sfx.hum(false); sfx.ding(); }
    else { if (Math.sign(step) !== Math.sign(d)) step = Math.sign(d) * 0.002; C.y += step; }
    C.floor = clamp(Math.round((C.y - Y0) / FH), 0, INT.b.floors - 1);
  }
  else if (C.state === 'opening') { C.open = Math.min(1, C.open + dt * 1.3); if (C.open === 1) { C.state = 'open'; C.wait = 8; } }
  else if (C.state === 'open') { C.wait -= dt; if (C.wait < 0 && !inCab()) { C.state = 'closing'; C.target = C.floor; C.after = 'idle'; } }
  else if (C.state === 'idle') { C.open = 0; }
  // Anzeigen (Kabine + alle geladenen Etagen) aktualisieren, Rufknöpfe leuchten bis die Kabine da ist
  const dir = C.state === 'moving' ? Math.sign(C.v) : 0, key = C.floor + ':' + dir;
  if (C.shown !== key) { C.shown = key; drawLiftDisp(C.dd, C.floor, dir); for (const F of INT.floors.values()) if (F.ind) drawLiftDisp(F.ind, C.floor, dir); drawLiftPanel(); }
  for (const F of INT.floors.values()) if (F.callBtn) F.callBtn.material.emissiveIntensity = C.calls.has(F.f) ? 2.5 : 0.15;
  if (C.state === 'opening' && C.open === 0 && (C.lit.has(C.floor) || C.calls.has(C.floor))) { C.lit.delete(C.floor); C.calls.delete(C.floor); drawLiftPanel(); }
  const riding = !player.car && inCab();
  C.g.position.y = C.y;
  C.dl.position.x = -0.31 - C.open * 0.6; C.dr.position.x = 0.31 + C.open * 0.6;
  for (const F of INT.floors.values()) {
    if (!F.doors.length) continue;
    const o = C.floor === F.f && C.state !== 'moving' && Math.abs(C.y - floorY(F.f)) < 0.05 ? C.open : 0;
    F.doors[0].position.x = -2.25 - o * 0.62; F.doors[1].position.x = -1.55 + o * 0.62;
    if (o > 0.85 && F.doorSolid) { removeSolid(F.doorSolid); F.solids.splice(F.solids.indexOf(F.doorSolid), 1); F.doorSolid = null; }
    else if (o < 0.6 && !F.doorSolid) F.doorSolid = fSolid(F, -2.6, -1.2, -3.12, -2.98, -0.05, 3.0);
  }
  if (riding) { player.y = C.y; player.vy = 0; player.grounded = true; player.h.group.position.y = C.y; }
  player.h.group.visible = !INT.panelMode;
}
// ---------- Etagen laden/entladen, Gebäude aktivieren ----------
const curFloorOf = y => clamp(Math.floor((y - Y0 + 0.6) / FH), 0, INT.b.floors - 1);
function syncFloors() {
  const C = INT.cab, ride = C && !player.car && inCab() && (C.state === 'moving' || C.state === 'closing');
  const fc = ride ? C.target : INT.inside ? curFloorOf(player.y) : 0; INT.fc = fc;
  const ok = f => f >= 0 && f < (INT.b.small ? 1 : INT.b.floors);
  const want = new Set((ride ? [C.floor0 ?? C.floor, C.target, C.target - 1, C.target + 1] : INT.inside ? [fc - 1, fc, fc + 1] : [0]).filter(ok));
  for (const [f, F] of [...INT.floors]) if (!want.has(f)) unloadFloor(F);
  for (const f of [fc, ...want]) if (want.has(f) && !INT.floors.has(f)) { INT.floors.set(f, buildFloor(f)); break; }
  INT.kind = INT.floors.get(fc)?.kind || '';
  const W = INT.W, D = INT.D;
  INT.lights.forEach((l, i) => { const [x, z] = toWorld((i % 2 ? 1 : -1) * W / 4, (i < 2 ? -1 : 1) * D / 4); l.position.set(x, floorY(fc) + 3.0, z); });
}
function activateBuilding(b) {
  INT.b = b; INT.active = true; INT.panic = false;
  const d = b.door, th = Math.atan2(-d.nx, -d.nz); INT.cos = Math.cos(th); INT.sin = Math.sin(th);
  const along = d.nx === 0; INT.W = along ? b.w : b.d; INT.D = along ? b.d : b.w;
  b.small = Math.min(INT.W, INT.D) < 15 || b.type === 'gas' || b.type === 'market';
  INT.root = new THREE.Group(); INT.root.position.set(b.x, 0, b.z); INT.root.rotation.y = th; scene.add(INT.root);
  if (b.solid) { removeSolid(b.solid); }
  INT.company = b.type === 'office' ? companyOf(b, 1) : '';
  b.noLift = !b.small && b.floors <= 4 && !['hospital', 'hotel'].includes(b.type);
  INT.cab = b.small || b.noLift ? null : buildCab();
  if (INT.cab) drawLiftPanel();
  // Stencil-Portal: Fassade an der Tür ausblenden, damit man hinein sieht und hineingehen kann
  const pm = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  INT.portal = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.85), pm); INT.portal.renderOrder = -5;
  const fx = d.x - d.nx * 1.1, fz = d.z - d.nz * 1.1; INT.portal.position.set(fx + d.nx * 0.45, Y0 + 1.42, fz + d.nz * 0.45); INT.portal.rotation.y = Math.atan2(d.nx, d.nz);
  scene.add(INT.portal);
  syncFloors();
}
function deactivateBuilding() {
  if (!INT.active) return;
  for (const F of [...INT.floors.values()]) unloadFloor(F);
  scene.remove(INT.root); INT.root.traverse(o => o.geometry?.dispose());
  scene.remove(INT.portal); INT.portal.geometry.dispose();
  const b = INT.b; if (b.solid) b.solid = addSolid(b.solid.minx, b.solid.maxx, b.solid.minz, b.solid.maxz, b.solid.h);
  INT.active = false; INT.inside = false; INT.b = null; INT.cab = null; INT.menu = null; INT.panelMode = false; INT.pressed = null; INT.npcs = []; closeMenu(); player.h.group.visible = true;
  sfx.hum(false);
}
function updateBuildings(dt) {
  INT.checkT -= dt;
  if (INT.active) {
    const [lx, lz] = toLocal(player.x, player.z);
    INT.inside = !player.car && Math.abs(lx) < INT.W / 2 && Math.abs(lz) < INT.D / 2;
  }
  if (INT.checkT <= 0) {
    INT.checkT = 0.25;
    if (!INT.active) { if (!player.car && !player.dead) { const b = nearestDoor(player.x, player.z, 24); if (b) activateBuilding(b); } }
    else if (!INT.inside) {
      const d = INT.b.door, dd = Math.hypot(d.x - player.x, d.z - player.z);
      const nb = !player.car && nearestDoor(player.x, player.z, 24);
      if (dd > 36 || player.car || (nb && nb !== INT.b && Math.hypot(nb.door.x - player.x, nb.door.z - player.z) < dd - 9)) deactivateBuilding();
    }
    if (INT.active) syncFloors();
  }
  if (!INT.active) return;
  if (INT.cab) updateCab(dt);
  for (const F of INT.floors.values()) if (F.spawnQ?.length) { const [role, sp, look] = F.spawnQ.shift(); if (sp.occ === 'pending') sp.occ = null; spawnINpc(F, role, sp, look); break; }
  updateInterior(dt);
}
// ---------- Innen-NPCs ----------
function spawnINpc(F, role, s, look) {
  if (F.deferQ) { F.deferQ.push([role, s, look]); s.occ = s.multi ? null : 'pending'; return null; }
  const L = look || (['worker', 'reception', 'visitor', 'cop'].includes(role) ? officeLook() : pedLook()), h = makeHuman(L);
  setHumanShadow(h, false); F.group.add(h.group);
  const [voice, vrate] = voiceFor(L);
  const n = { F, h, voice, vrate, x: s.x, z: s.z, yaw: s.yaw, role, home: s, at: s, room: s.room, path: null, pi: 0, pose: s.pose, wait: rnd(4, 25), state: 'act', hp: 40, n: 0 };
  if (!s.multi) s.occ = n; F.npcs.push(n); return n;
}
function populateFloor(F) {
  const S = F.spots, free = t => S.filter(s => s.type === t && !s.occ), kind = F.kind, seated = n => free('visit').filter(q => q.pose === 'sit').sort(() => Math.random() - 0.5).slice(0, n); // seated: zufällige Sitzplätze (Lounge/Wartebereich)
  if (kind === 'office') { const desks = free('desk'); desks.sort(() => Math.random() - 0.5); desks.slice(0, Math.min(10, Math.ceil(desks.length * 0.7))).forEach(s => spawnINpc(F, 'worker', s)); }
  else if (kind === 'flat') { for (const q of F.rooms) if (Math.random() < 0.75 && !(myHotelFloor(F) && F.rooms.indexOf(q) === player.hotel.room % F.rooms.length)) { const opts = S.filter(s => s.room === q && !s.occ && s.type !== 'window'); const s = nightF > 0.6 ? opts.find(o => o.type === 'bed') : pick(opts); if (s) spawnINpc(F, 'resident', s, INT.b.type === 'prison' ? INMATE_LOOK() : undefined); } }
  else if (kind === 'ward') { for (const s of free('bed')) if (Math.random() < 0.7) spawnINpc(F, 'patient', s); for (let k = 0; k < 2; k++) { const s = pick(free('bedside')); if (s) spawnINpc(F, 'nurse', s, { gender: 'f', tint: '#cfe8f0' }); } }
  else if (kind === 'bank') { for (const s of free('cashier')) spawnINpc(F, 'cashier', s, officeLook()); for (const v of free('visit').slice(0, 2)) spawnINpc(F, 'visitor', v); for (const v of seated(3)) spawnINpc(F, 'visitor', v); for (const d of free('desk').slice(0, 2)) spawnINpc(F, 'worker', d, officeLook()); }
  else if (kind === 'lobby' || kind === 'police' || kind === 'hotel') { const s = free('reception')[0]; if (s) spawnINpc(F, 'reception', s, kind === 'police' ? COP_LOOK : null); const v = free('visit')[0]; if (v) spawnINpc(F, 'visitor', v); if (kind === 'police') for (const d of free('desk').slice(0, 3)) spawnINpc(F, 'worker', d, COP_LOOK); for (const v of seated(kind === 'hotel' ? 4 : 3)) spawnINpc(F, 'visitor', v); const bs = free('bar')[0]; if (bs) { spawnINpc(F, 'cashier', bs); for (const v of free('visit').filter(q => q.bar).slice(0, 2)) spawnINpc(F, 'visitor', v); } }
  else if (kind === 'shop' || kind === 'market' || kind === 'gas') { const s = free('cashier')[0]; if (s) spawnINpc(F, 'cashier', s); for (let k = 0; k < (kind === 'market' ? 6 : 3); k++) { const sh = pick(free('shelf')); if (sh) spawnINpc(F, 'customer', sh); } }
}
const exitSpotOf = F => F.f === 0 ? { type: 'exit', x: F.exit.x, z: F.exit.z - 0.5, yaw: 0, pose: 'stand', multi: true, room: { open: true } } : F.elevSpot;
function iGo(n, tgt, dur) {
  if (n.at && !n.at.multi && n.at.occ === n) n.at.occ = null;
  n.target = tgt; n.dur = dur; if (!tgt.multi) tgt.occ = n;
  n.path = intPath(n, tgt); n.pi = 0; n.pose = null; n.state = 'walk';
}
function iChoose(n) {
  const F = n.F, S = F.spots, free = t => S.filter(s => s.type === t && !s.occ);
  const leave = () => { iGo(n, INT.b.small || F.f === 0 ? exitSpotOf(F) : F.elevSpot, 0); n.leaving = true; };
  switch (n.role) {
    case 'worker': {
      if (n.at !== n.home) { if (!n.home.occ || n.home.occ === n) return iGo(n, n.home, rnd(14, 40)); return leave(); }
      if (Math.random() < 0.1 && !INT.b.small) return leave();
      const t = pick([...free('cooler'), ...free('cook'), ...free('meet'), ...free('window'), ...free('table')]); if (t) return iGo(n, t, rnd(8, 22));
      n.wait = rnd(10, 30); return;
    }
    case 'resident': {
      const opts = S.filter(s => s.room === n.home.room && !s.occ && s !== n.at);
      const t = nightF > 0.6 ? opts.find(s => s.type === 'bed') || pick(opts) : pick(opts.filter(s => s.type !== 'bed')) || pick(opts);
      if (t) return iGo(n, t, rnd(15, 50)); n.wait = 20; return;
    }
    case 'reception': case 'cashier': n.pose = Math.random() < 0.35 ? 'phone' : 'stand'; n.wait = rnd(6, 15); return;
    case 'customer': { n.n++; if (n.n > 4) return leave(); const t = n.n === 4 ? free('pay')[0] : pick(free('shelf')); if (t) return iGo(n, t, rnd(4, 9)); n.wait = 3; return; }
    case 'visitor': if (n.n++ > 0) return leave(); n.wait = rnd(5, 10); return;
    case 'nurse': { const t = pick(free('bedside')); if (t) return iGo(n, t, rnd(8, 20)); n.wait = 8; return; }
    default: n.wait = rnd(20, 60);
  }
}
function iPanic() {
  if (INT.panic) return; INT.panic = true;
  for (const F of INT.floors.values()) for (const n of F.npcs) {
    if (n.state === 'dead' || n.role === 'patient' || n.role === 'cop') continue;
    n.flee = true; n.leaving = true; if (n.at && n.at.occ === n) n.at.occ = null;
    const ex = INT.b.small || F.f === 0 ? exitSpotOf(F) : F.elevSpot;
    n.target = ex; n.path = intPath(n, ex); n.pi = 0; n.pose = null; n.state = 'walk';
  }
  sfx.pain(player.x, player.z); say(pick(LINES.scared), { who: 'Angestellte', prio: true });
}
function updateInterior(dt) {
  INT.talkCd -= dt; INT.npcs = [];
  const [plx, plz] = toLocal(player.x, player.z);
  for (const F of INT.floors.values()) {
    for (let i = F.npcs.length - 1; i >= 0; i--) {
      const n = F.npcs[i];
      if (n.role === 'cop' && n.sq && n.state !== 'dead') { updateICop(n, F, dt, plx, plz); n.h.group.position.set(n.x, 0, n.z); n.h.group.rotation.y = n.yaw; [n.wx, n.wz] = toWorld(n.x, n.z); n.wy = floorY(F.f); INT.npcs.push(n); continue; }
      if (n.state !== 'dead') {
        if (n.state === 'walk' && n.path) {
          const [tx, tz] = n.path[n.pi], dx = tx - n.x, dz = tz - n.z, d = Math.hypot(dx, dz), sp = n.flee ? 4.6 : 1.3;
          if (d < 0.15) {
            n.pi++;
            if (n.pi >= n.path.length) {
              n.path = null;
              if (n.leaving) { F.group.remove(n.h.group); disposeHuman(n.h); F.npcs.splice(i, 1); continue; }
              const t = n.target; n.at = t; n.room = t.room; n.x = t.x; n.z = t.z; n.yaw = t.yaw; n.pose = t.pose; n.wait = n.dur || rnd(6, 15); n.state = 'act';
            }
          } else { const st = Math.min(d, sp * dt); n.x += dx / d * st; n.z += dz / d * st; n.yaw += angDiff(n.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 10); }
          animHuman(n.h, sp, dt);
        } else {
          n.wait -= dt; if (n.wait <= 0 && !INT.panic) iChoose(n);
          animHuman(n.h, 0, dt, false, n.pose);
        }
        n.h.group.position.set(n.x, 0, n.z); n.h.group.rotation.y = n.yaw;
      }
      [n.wx, n.wz] = toWorld(n.x, n.z); n.wy = floorY(F.f); n.x0 = n.x; INT.npcs.push(n);
    }
    // Neue Leute kommen mit dem Aufzug bzw. durch die Tür
    updateDoors(F, dt, plx, plz);
    F.respawnT -= dt;
    if (F.respawnT < 0 && !INT.panic) {
      F.respawnT = rnd(10, 25);
      const free = t => F.spots.filter(s => s.type === t && !s.occ);
      if (F.npcs.length < 14) {
        let role = null, tgt = null;
        if (F.kind === 'office') { tgt = pick(free('desk')); role = 'worker'; }
        else if (['shop', 'market', 'gas'].includes(F.kind)) { tgt = pick(free('shelf')); role = 'customer'; }
        else if (F.kind === 'lobby' || F.kind === 'police' || F.kind === 'hotel' || F.kind === 'bank') { tgt = pick(free('visit')); role = 'visitor'; }
        if (tgt) { const n = spawnINpc(F, role, F.f === 0 || INT.b.small ? exitSpotOf(F) : F.elevSpot); n.home = tgt; iGo(n, tgt, rnd(20, 60)); }
      }
    }
    // Bewohner reagieren auf Eindringlinge
    if (F.kind === 'flat' && INT.talkCd <= 0 && INT.inside && curFloorOf(player.y) === F.f) for (const n of F.npcs) {
      if (n.role !== 'resident' || n.state === 'dead') continue;
      const q = n.room;
      if (q && !q.open && plx > q.x0 && plx < q.x1 && plz > q.z0 && plz < q.z1) { INT.talkCd = 12; say(pick(LINES.intruder), { who: 'Bewohner', voice: n.voice, rate: n.vrate, h: n.h, prio: true }); if (n.pose === 'lie') n.pose = 'sit'; break; }
    }
  }
}
// Bodenhöhe im Gebäude: Etagenplatten, Treppenläufe, Podest, Aufzugskabine
function intGround(x, z, y) {
  const [lx, lz] = toLocal(x, z), b = INT.b, inR = q => lx >= q[0] && lx <= q[1] && lz >= q[2] && lz <= q[3];
  const fy = clamp(Math.floor((y - Y0 + 0.3) / FH), 0, b.floors - 1); let best = -Infinity;
  for (let f = Math.max(0, fy - 1); f <= Math.min(b.floors - 1, fy + 1); f++) {
    const base = floorY(f), c = [];
    if (b.small || f === 0 || !((!b.noLift && inR(ELEV)) || inR(H1) || inR(H2))) c.push(base);
    if (!b.small && f < b.floors - 1) {
      if (lz >= -1.4 && lz <= 1.6 && lx >= 1.35 && lx <= 3.1) c.push(base + (lz + 1.4) / 3 * 1.8);
      if (lz >= 1.6 && lz <= 2.9 && lx >= -0.4 && lx <= 3.1) c.push(base + 1.8);
      if (lz >= -1.4 && lz <= 1.6 && lx >= -0.4 && lx <= 1.25) c.push(base + 1.8 + (1.6 - lz) / 3 * 1.8);
    }
    for (const h of c) if (h <= y + 0.45 && h > best) best = h;
  }
  if (INT.cab && inR(ELEV) && INT.cab.y <= y + 0.45 && INT.cab.y > best) best = INT.cab.y;
  return best === -Infinity ? y - 5 : best;
}
const floorH = (x, z, y = 0.2) => { if (INT.active) { const [lx, lz] = toLocal(x, z); if (Math.abs(lx) < INT.W / 2 && Math.abs(lz) < INT.D / 2) return intGround(x, z, y); } return groundH(x, z); };
function nearElevCall() { const [lx, lz] = toLocal(player.x, player.z); return !!INT.cab && Math.hypot(lx + 0.95, lz + 3.6) < 1.3 || !!INT.cab && Math.hypot(lx + 1.9, lz + 3.7) < 1.0; }
function openElevator() { INT.menu = true; INT.panelMode = true; INT.sel = curFloorOf(player.y); drawLiftPanel(); sfx.click(); }
const liftLab = f => f === 0 ? 'E' : String(f);
function renderElevator() {
  const b = INT.b, n = b.floors, cf = INT.cab.floor, cols = n > 18 ? 5 : n > 9 ? 4 : 3, btn = [];
  for (let f = n - 1; f >= 0; f--) btn.push(`<i class="${f === INT.sel ? 'sel' : ''}${f === INT.pressed ? ' lit' : ''}${f === cf ? ' here' : ''}">${liftLab(f)}</i>`);
  $('elev').innerHTML = `<div class="lift"><div class="disp"><span>${INT.cab.state === 'moving' ? (INT.cab.v > 0 ? '▲' : '▼') : '•'}</span><b>${liftLab(cf)}</b></div><div class="lname">${floorName(b, INT.sel)}</div><div class="btns" style="grid-template-columns:repeat(${cols},1fr)">${btn.join('')}</div><div class="eh">W/S/A/D wählen · E drücken · F schließen</div></div>`;
}
function elevatorKey(code) {
  if (INT.pressed != null) return;
  const cols = INT.b.floors > 20 ? 3 : 2, mv = d => { INT.sel = clamp(INT.sel + d, 0, INT.b.floors - 1); sfx.click(); drawLiftPanel(); };
  if (code === 'KeyW' || code === 'ArrowUp') mv(cols); else if (code === 'KeyS' || code === 'ArrowDown') mv(-cols);
  else if (code === 'KeyD' || code === 'ArrowRight') mv(1); else if (code === 'KeyA' || code === 'ArrowLeft') mv(-1);
  else if (code === 'KeyE' || code === 'Enter') {
    // Finger drückt die Taste: sie leuchtet auf dem Panel, Piepton, dann Kamera zurück und Türen schließen
    INT.pressed = INT.sel; INT.cab.lit.add(INT.sel); sfx.liftBeep(); drawLiftPanel(); player.act = { pose: 'press', t: 0.6 };
    const b0 = INT.b; setTimeout(() => { if (INT.b !== b0 || !INT.cab || INT.pressed == null) { INT.pressed = null; INT.panelMode = false; INT.menu = null; return; } INT.menu = null; INT.panelMode = false; callCab(INT.pressed); INT.pressed = null; drawLiftPanel(); }, 700);
  }
  else if (code === 'KeyF' || code === 'Backspace' || code === 'Escape') { INT.menu = null; INT.panelMode = false; drawLiftPanel(); }
}
function nearestINpc(r) { let best = null, bd = r; for (const n of INT.npcs) { if (n.state === 'dead' || Math.abs(n.wy - player.y) > 1.5) continue; const d = Math.hypot(n.wx - player.x, n.wz - player.z); if (d < bd) { bd = d; best = n; } } return best; }
function myHotelFloor(F) { return player.hotel && INT.b && player.hotel.seed === INT.b.seed && F.f === player.hotel.floor; }
function interiorUse() {
  const Fc = INT.floors.get(curFloorOf(player.y)), [plx, plz] = toLocal(player.x, player.z);
  if (Fc?.hotelBed && Math.hypot(plx - Fc.hotelBed.x, plz - Fc.hotelBed.z) < 1.8) { fade(true); sfx.save(); setTimeout(() => { gameMin = (gameMin + 8 * 60) % 1440; player.hp = 100; const ok = saveGame(); fade(false); notice(ok ? 'Im Hotel geschlafen · Spiel gespeichert' : 'Im Hotel geschlafen', 2500); }, 900); return; }
  const near = nearestINpc(2.6);
  if (near && near.role === 'cashier' && INT.kind === 'bank') return bankMenu('Fleeca Bank · Schalter');
  if (near && near.role === 'reception' && INT.kind === 'hotel') return hotelMenu();
  if (near && near.role === 'cashier' && ['shop', 'market', 'gas'].includes(INT.kind)) { shopClerk = near; near.yaw = Math.atan2(...toLocal(player.x, player.z).map((v, i) => v - (i ? near.z : near.x))); return shopMenu(INT.kind); }
  if (INT.cab && inCab()) return openElevator();
  if (nearElevCall()) { const f = curFloorOf(player.y); INT.cab.calls.add(f); callCab(f); sfx.liftBeep(); player.act = { pose: 'press', t: 0.6 }; return; }
  const n = nearestINpc(2.3);
  if (n) {
    const L = LINES.inside[n.role] || LINES.inside.worker;
    n.yaw = Math.atan2(...toLocal(player.x, player.z).map((v, i) => v - (i ? n.z : n.x)));
    say(pick(L).replace('{co}', INT.company || 'uns'), { who: { worker: 'Angestellter', resident: 'Bewohner', reception: 'Empfang', cashier: 'Kassierer', customer: 'Kunde', nurse: 'Pflegerin', patient: 'Patient', visitor: 'Besucher' }[n.role] || 'Person', voice: n.voice, rate: n.vrate, h: n.h, prio: true });
  }
}
function interiorHint() {
  if (INT.menu) return '';
  if (INT.panelMode) return 'Tastenfeld · <b>W/A/S/D</b> Etage wählen · <b>E</b> drücken · <b>F</b> zurück';
  if (INT.cab && inCab()) return 'Drücke <b>E</b>, um am Tastenfeld eine Etage zu wählen';
  if (nearElevCall()) return 'Drücke <b>E</b>, um den Aufzug zu rufen';
  if (nearElevCall()) return 'Drücke <b>E</b>, um den Aufzug zu rufen';
  const [lx, lz] = toLocal(player.x, player.z);
  if (!INT.b.small && lx > -0.5 && lx < 3.2 && lz > -3 && lz < -1.4) return 'Treppenhaus: rechts <b>hoch</b>, links <b>runter</b>';
  const Fc = INT.floors.get(curFloorOf(player.y));
  if (Fc?.hotelBed && Math.hypot(lx - Fc.hotelBed.x, lz - Fc.hotelBed.z) < 1.8) return 'Drücke <b>E</b>, um im Hotelzimmer zu schlafen und zu speichern';
  const nn = nearestINpc(2.6);
  if (nn && nn.role === 'cashier' && INT.kind === 'bank') return 'Drücke <b>E</b> für den Bankschalter';
  if (nn && nn.role === 'cashier' && ['shop', 'market', 'gas'].includes(INT.kind)) return 'Drücke <b>E</b> zum Einkaufen · <b>I</b> Inventar';
  if (nearShelf()) return 'Regal · <b>G</b> Ware einstecken (Diebstahl!)';
  if (nn && nn.role === 'reception' && INT.kind === 'hotel') return `Drücke <b>E</b>, um ein Zimmer zu buchen (${fmt(HOTEL_PRICE)})`;
  if (nn) return 'Drücke <b>E</b>, um die Person anzusprechen';
  return '';
}
function drawInteriorMap(time) {
  const W = 520, H = 400, s = 8, F = INT.floors.get(curFloorOf(player.y)); mm.fillStyle = '#15181c'; mm.fillRect(0, 0, W, H);
  mm.save(); mm.translate(W / 2, H * 0.55); mm.rotate(camYaw - Math.PI);
  if (F) { mm.fillStyle = '#9aa3ad'; for (const q of F.solids) mm.fillRect((q.minx - player.x) * s, (q.minz - player.z) * s, Math.max(1.5, (q.maxx - q.minx) * s), Math.max(1.5, (q.maxz - q.minz) * s)); }
  for (const n of INT.npcs) { if (Math.abs(n.wy - player.y) > 2) continue; mm.fillStyle = n.state === 'dead' ? '#555' : '#e8e8e8'; mm.beginPath(); mm.arc((n.wx - player.x) * s, (n.wz - player.z) * s, 4, 0, 7); mm.fill(); }
  if (INT.cab) { const [ex, ez] = toWorld(-1.85, -1.7); mm.fillStyle = '#ffd23a'; mm.beginPath(); mm.arc((ex - player.x) * s, (ez - player.z) * s, 9, 0, 7); mm.fill(); }
  if (F && F.f === 0) { const [ex, ez] = toWorld(F.exit.x, F.exit.z - 1.2); mm.fillStyle = '#7cff63'; mm.beginPath(); mm.arc((ex - player.x) * s, (ez - player.z) * s, 7, 0, 7); mm.fill(); }
  mm.restore();
  mm.save(); mm.translate(W / 2, H * 0.55); mm.rotate(camYaw - player.yaw); mm.fillStyle = '#fff'; mm.strokeStyle = '#000'; mm.lineWidth = 3;
  mm.beginPath(); mm.moveTo(0, -14); mm.lineTo(10, 10); mm.lineTo(0, 5); mm.lineTo(-10, 10); mm.closePath(); mm.stroke(); mm.fill(); mm.restore();
  mm.fillStyle = 'rgba(0,0,0,.6)'; mm.fillRect(0, 0, W, 44); mm.fillStyle = '#fff'; mm.font = 'bold 26px Arial'; mm.textAlign = 'left'; mm.textBaseline = 'middle';
  mm.fillText(floorName(INT.b, curFloorOf(player.y)), 14, 23);
  void time;
}

// ---------- Money pickups ----------
const pickups = [];
const moneyG = new THREE.BoxGeometry(0.5, 0.06, 0.26), moneyM = new THREE.MeshStandardMaterial({ color: 0x3fa34d, emissive: 0x2a8a35, emissiveIntensity: 0.6 });
function spawnMoney(x, z, v) { const m = new THREE.Mesh(moneyG, moneyM); m.position.set(x + rnd(-0.5, 0.5), 0.6, z + rnd(-0.5, 0.5)); scene.add(m); pickups.push({ m, v, t: 30 }); }
function updatePickups(dt, time) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i]; k.t -= dt; k.m.rotation.y = time * 3; k.m.position.y = 0.6 + Math.sin(time * 4) * 0.12;
    if (Math.hypot(k.m.position.x - player.x, k.m.position.z - player.z) < 1.6) { player.money += k.v; sfx.coin(); notice(`+$${k.v}`, 900); k.t = 0; }
    if (k.t <= 0) { scene.remove(k.m); pickups.splice(i, 1); }
  }
}

// ---------- Traffic AI ----------
const dirYaw = d => Math.atan2(DIRS[d][0], DIRS[d][1]);
const rightOf = d => [-DIRS[d][1], DIRS[d][0]]; // rechts in Fahrtrichtung
function laneFor(d, kRoad) { const r = rightOf(d); return roadPos(kRoad) + (DIRS[d][0] === 0 ? r[0] : r[1]) * LANE; }
function roadPoint(minD, maxD, forCar = true) {
  for (let t = 0; t < 25; t++) {
    const a = Math.random() * Math.PI * 2, d = rnd(minD, maxD);
    const px = player.x + Math.cos(a) * d, pz = player.z + Math.sin(a) * d;
    if (Math.abs(px) > EXT - 20 || Math.abs(pz) > EXT - 20) continue;
    const alongZ = Math.random() < 0.5;
    const k = clamp(Math.round((alongZ ? px : pz) / P + N / 2), 0, N);
    const dir = alongZ ? (Math.random() < 0.5 ? 0 : 2) : (Math.random() < 0.5 ? 1 : 3);
    const lat = laneFor(dir, k);
    const x = alongZ ? lat : px, z = alongZ ? pz : lat;
    if (forCar && cars.some(c => Math.hypot(c.x - x, c.z - z) < 10)) continue;
    return { x, z, dir, k };
  }
  return null;
}
function initAI(c, dir) {
  const a = c.ai; a.dir = dir; a.turn = null; a.speed = rnd(9, 14); c.ai.cruise = a.speed;
  const D = DIRS[dir];
  if (D[0] === 0) { a.laneC = c.x; a.nextK = D[1] > 0 ? Math.ceil(c.z / P + N / 2 + 0.01) : Math.floor(c.z / P + N / 2 - 0.01); }
  else { a.laneC = c.z; a.nextK = D[0] > 0 ? Math.ceil(c.x / P + N / 2 + 0.01) : Math.floor(c.x / P + N / 2 - 0.01); }
  c.yaw = dirYaw(dir);
}
function spawnTraffic(minD, maxD) {
  const rp = roadPoint(minD, maxD); if (!rp) return;
  const type = cars.filter(o => o.model && !o.keep).length < 2 && Math.random() < 0.05 ? pick(['italia', 'concept']) : pick(TRAFFIC_TYPES);
  const taxi = Math.random() < 0.1, c = makeCar(taxi ? 'sedan' : type, taxi ? TAXI_COLOR : pick(CAR_COLORS), rp.x, rp.z, 0, 'ai'); initAI(c, rp.dir);
  if (taxi) addTaxiSign(c);
}
const TAXI_COLOR = '#f2c200';
let taxiSignMat = null;
function addTaxiSign(c) {
  taxiSignMat ||= (() => { const t = signTex('TAXI', '#111111', '#ffd23a', 256, 96, 'bold 70px Arial Black, sans-serif'); const m = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.8 }); ADMATS.push(m); return m; })();
  const sg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.26, 0.3), taxiSignMat); sg.position.set(0, c.top + 0.16, -0.25); c.body.add(sg); c.taxi = true;
}
function spawnParked(minD, maxD) {
  const rp = roadPoint(minD, maxD); if (!rp) return;
  const D = DIRS[rp.dir], r = rightOf(rp.dir);
  const x = D[0] === 0 ? roadPos(rp.k) + r[0] * PARK : rp.x, z = D[0] === 0 ? rp.z : roadPos(rp.k) + r[1] * PARK;
  if (inBlock(D[0] === 0 ? z : x) === false) return; // nicht auf Kreuzungen parken
  makeCar(pick(TRAFFIC_TYPES), pick(CAR_COLORS), x, z, dirYaw(rp.dir), 'parked');
}
// Fahrer steigt aus geparktem Auto aus / Fußgänger steigt ein
function updateNpcSeq(c, dt) {
  const q = c.npcSeq; q.t += dt;
  if (q.type === 'exit') {
    if (q.t > 0.5 && !q.done) { q.done = true; const h = takeDriver(c); if (h) { const [x, z] = doorPoint(c); const p = adoptPed(h, x, z, c.yaw + Math.PI / 2); nextTask(p); } }
    if (q.t > 0.5) c.doors[0].target = 0;
    if (q.t > 1.2) c.npcSeq = null;
  } else if (q.type === 'enter') {
    const p = q.ped;
    if (q.t > 0.45 && !q.done) {
      q.done = true; peds.splice(peds.indexOf(p), 1); scene.remove(p.h.group); setDriver(c, p.h); c.lazyDriver = true; c.dlook = null;
      const dir = dirOfYaw(c.yaw); c.mode = 'ai'; initAI(c, dir);
      const D = DIRS[dir], k = Math.round((D[0] === 0 ? c.x : c.z) / P + N / 2); c.ai.laneC = laneFor(dir, k); c.ai.speed = 2; c.ai.cruise = rnd(9, 13);
    }
    if (q.t > 0.5) c.doors[0].target = 0;
    if (q.t > 1.2) c.npcSeq = null;
  }
}
function updateAI(c, dt) {
  const a = c.ai, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  // Abstand halten
  let target = a.cruise, rx = -fz, rz = fx;
  for (const o of cars) {
    if (o === c || o.mode === 'parked') continue;
    const dx = o.x - c.x, dz = o.z - c.z, ahead = dx * fx + dz * fz;
    if (ahead <= 0 || ahead > 22) continue;
    const lat = dx * rx + dz * rz; if (Math.abs(lat) > 2.4) continue;
    if (o.mode === 'ai' && Math.abs(Math.sin(o.yaw - c.yaw)) > 0.7 && lat < 0 && a.stuck < 5) continue; // Rechts vor links
    target = Math.min(target, Math.max(0, (ahead - 7) * 1.1));
  }
  const pdx = player.x - c.x, pdz = player.z - c.z, pa = pdx * fx + pdz * fz;
  for (const p of peds) {
    if (!p.crossing) continue;
    const dx = p.x - c.x, dz = p.z - c.z, ahead = dx * fx + dz * fz;
    if (ahead > 0 && ahead < 16 && Math.abs(dx * rx + dz * rz) < 3.2) target = Math.min(target, Math.max(0, (ahead - 5) * 1.2));
  }
  const pBlock = !a.hail && pa > 0 && pa < (player.car ? 9 : 12) && Math.abs(pdx * rx + pdz * rz) < 1.8;
  if (!player.car && pBlock) target = 0;
  a.honkWait = pBlock && a.speed < 1 ? (a.honkWait || 0) + dt : 0;
  if (a.honkWait > 1.5 && a.honk === undefined) { a.honk = 0; a.honkWait = -6; }
  if (a.hail) { target = Math.min(target, a.hail.v); a.speed = target < a.speed ? Math.max(target, a.speed - 5 * dt) : lerp(a.speed, target, Math.min(1, dt * 1.2)); } // Taxi hält sanft (max 5 m/s²)
  else a.speed = lerp(a.speed, target, Math.min(1, dt * (target < a.speed ? 4 : 1.2)));
  a.stuck = a.speed < 0.5 ? a.stuck + dt : 0;
  if (a.stuck > 12) { a.stuck = 0; }
  const D = DIRS[a.dir];
  if (a.turn) {
    const t = a.turn; t.t = Math.min(1, t.t + a.speed * dt / t.len);
    const u = 1 - t.t;
    c.x = u * u * t.p0[0] + 2 * u * t.t * t.p1[0] + t.t * t.t * t.p2[0];
    c.z = u * u * t.p0[1] + 2 * u * t.t * t.p1[1] + t.t * t.t * t.p2[1];
    const dx = 2 * u * (t.p1[0] - t.p0[0]) + 2 * t.t * (t.p2[0] - t.p1[0]), dz = 2 * u * (t.p1[1] - t.p0[1]) + 2 * t.t * (t.p2[1] - t.p1[1]);
    c.yaw = Math.atan2(dx, dz); c.steer = lerp(c.steer, t.left ? 0.5 : -0.5, dt * 5);
    if (t.t >= 1) { c.x = t.p2[0]; c.z = t.p2[1]; initAI(c, t.nd); a.speed = a.speed; }
  } else {
    c.x += D[0] * a.speed * dt; c.z += D[1] * a.speed * dt;
    if (D[0] === 0) c.x = lerp(c.x, a.laneC, dt * 2); else c.z = lerp(c.z, a.laneC, dt * 2);
    if (a.park) {
      a.cruise = 3.5; const lat = D[0] === 0 ? c.x : c.z;
      if (Math.abs(lat - a.laneC) < 0.25) { a.cruise = 0; if (a.speed < 0.3) { c.mode = 'parked'; c.yaw = dirYaw(a.dir); a.park = false; c.doors[0].target = 1; c.npcSeq = { type: 'exit', t: 0 }; c.lazyDriver = false; } }
    } else if (c.driver && !a.hail && Math.random() < dt * 0.006 && Math.hypot(c.x - player.x, c.z - player.z) < 120) {
      const kc0 = roadPos(a.nextK), al = D[0] === 0 ? c.z : c.x, dist0 = (kc0 - al) * (D[0] + D[1]);
      if (dist0 > 22 && dist0 < 55) {
        const r0 = rightOf(a.dir), k = Math.round((D[0] === 0 ? c.x : c.z) / P + N / 2), curb = roadPos(k) + (D[0] === 0 ? r0[0] : r0[1]) * PARK;
        const tx = D[0] === 0 ? curb : c.x + D[0] * 10, tz = D[0] === 0 ? c.z + D[1] * 10 : curb;
        if (!cars.some(o => o !== c && Math.hypot(o.x - tx, o.z - tz) < 8)) { a.park = true; a.laneC = curb; }
      }
    }
    c.steer = lerp(c.steer, 0, dt * 5);
    const kc = roadPos(a.nextK), along = D[0] === 0 ? c.z : c.x, sgn = D[0] + D[1];
    const dist = (kc - along) * sgn;
    if (c.mode === 'ai' && dist > R / 2 + 0.5 && dist < R / 2 + 32 && a.nextK >= 0 && a.nextK <= N) {
      const kxS = D[0] === 0 ? clamp(Math.round(c.x / P + N / 2), 0, N) : a.nextK, kzS = D[0] === 0 ? a.nextK : clamp(Math.round(c.z / P + N / 2), 0, N), st = sigState(kxS, kzS, D[0] === 0 ? 'z' : 'x');
      if (st === 'red' || (st === 'yellow' && dist > R / 2 + 8)) a.speed = Math.min(a.speed, Math.max(0, (dist - (R / 2 + 2.2)) * 1.1));
    }
    if (dist < R / 2 + 2 && a.decided !== a.nextK) {
      a.decided = a.nextK;
      const kx = D[0] === 0 ? Math.round(c.x / P + N / 2) : a.nextK, kz = D[0] === 0 ? a.nextK : Math.round(c.z / P + N / 2);
      const valid = nd => { const ND = DIRS[nd]; const nx = kx + ND[0], nz = kz + ND[1]; return nx >= 0 && nx <= N && nz >= 0 && nz <= N; };
      const opts = [];
      if (valid(a.dir)) opts.push(a.dir, a.dir, a.dir);
      const rd = (a.dir + 1) % 4, ld = (a.dir + 3) % 4;
      if (valid(rd)) opts.push(rd, rd); if (valid(ld)) opts.push(ld);
      const nd = a.hail && valid(a.dir) ? a.dir : opts.length ? pick(opts) : (a.dir + 2) % 4;
      if (nd !== a.dir) {
        const ix = roadPos(kx), iz = roadPos(kz), ND = DIRS[nd];
        const exitLat = laneFor(nd, ND[0] === 0 ? kx : kz);
        const p2 = ND[0] === 0 ? [exitLat, iz + ND[1] * (R / 2 + 2)] : [ix + ND[0] * (R / 2 + 2), exitLat];
        const p0 = [c.x, c.z], p1 = ND[0] === 0 ? [exitLat, c.z] : [c.x, exitLat];
        a.turn = { p0, p1, p2, t: 0, nd, left: nd === ld, len: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) };
        a.speed = Math.min(a.speed, 7);
      }
    }
    if (dist < -1) a.nextK += sgn > 0 ? 1 : -1;
  }
  // Stöße durch den Spieler abklingen lassen
  c.x += a.knockX * dt; c.z += a.knockZ * dt; a.knockX *= Math.exp(-3 * dt); a.knockZ *= Math.exp(-3 * dt);
  c.spin += a.speed * dt / 0.36; c.y = 0;
}

// Taxi heranwinken: wer auf ein fahrendes Taxi zugeht, dem hält es sanft am Bordstein und bietet die Fahrt an (läuft dann über den normalen LS-Ride-Ablauf)
let hail = null;
function hailRelease(msg) {
  const c = hail.c, a = c.ai; hail = null; a.hail = null; c.hailCd = 25;
  if (c.mode === 'service' && ride?.car === c && ride.hailed && ride.state === 'waiting') {
    ride = null; c.keep = false; c.mode = 'ai'; c.lazyDriver = true; initAI(c, dirOfYaw(c.yaw));
    const D = DIRS[a.dir], k = Math.round((D[0] === 0 ? c.x : c.z) / P + N / 2); a.laneC = laneFor(a.dir, clamp(k, 0, N)); a.speed = 0.5; a.cruise = rnd(9, 13);
  }
  if (msg) notice(msg, 1800);
}
function updateHail(dt) {
  for (const c of cars) if (c.hailCd > 0) c.hailCd -= dt;
  const off = player.dead || player.car || player.ride || player.jail || INT.inside || switching || wanted > 0;
  if (hail) {
    const c = hail.c, a = c.ai;
    if (ride?.car === c && ride.hailed && ride.state !== 'waiting') { hail = null; return; } // Fahrt läuft -> normaler Ride-Ablauf
    if (!cars.includes(c) || c.mode === 'wreck') { hail = null; return; }
    hail.t += dt;
    if (c.mode === 'ai') {
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), d = (player.x - c.x) * fx + (player.z - c.z) * fz - 0.45, D = DIRS[a.dir], r = rightOf(a.dir);
      if (off || ride || a.turn || hail.t > 25 || Math.hypot(c.x - player.x, c.z - player.z) > 45) { hailRelease(); return; }
      const k = Math.round((D[0] === 0 ? c.x : c.z) / P + N / 2); a.laneC = roadPos(clamp(k, 0, N)) + (D[0] === 0 ? r[0] : r[1]) * PARK; // an den Bordstein
      a.hail.v = d > 0.3 ? Math.min(a.cruise, Math.sqrt(2 * 3 * d)) : 0;
      if (a.speed < 0.3 && d < 3.5 && Math.abs((D[0] === 0 ? c.x : c.z) - a.laneC) < 1.2) {
        a.hail = null; a.speed = 0; c.mode = 'service'; c.keep = true; c.lazyDriver = false; c.vx = c.vz = 0; hail.w = 0;
        ride = { kind: 'taxi', car: c, drv: c.driver, ch: null, state: 'waiting', pay: phone.pay || 'card', fare: 0, odo: 0, curb: { x: c.x, z: c.z, yaw: c.yaw }, steps: [], t: 0, uiT: 0, hailed: true };
        sfx.horn(c.x, c.z, 0.5); sfx.ding(); notice('Taxi hält an – F: Taxi nehmen', 2600);
      }
    } else {
      const [dx, dz] = doorPoint(c, -1);
      if (off || ride?.car !== c || (hail.w += dt) > 15 || Math.hypot(dx - player.x, dz - player.z) > 12) hailRelease('Das Taxi fährt weiter');
    }
    return;
  }
  if (off || ride) return;
  const pfx = Math.sin(player.yaw), pfz = Math.cos(player.yaw);
  for (const c of cars) {
    if (!c.taxi || c.mode !== 'ai' || !c.driver || c.hailCd > 0 || c.ai.turn || c.ai.park || c.ai.speed < 3) continue;
    const a = c.ai, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), dx = player.x - c.x, dz = player.z - c.z, pa = dx * fx + dz * fz, dist = Math.hypot(dx, dz);
    if (dist > 36 || pa < a.speed * a.speed / 9 + 1.5 || Math.abs(dx * -fz + dz * fx) > 16 || (pfx * -dx + pfz * -dz) / dist < 0.7) continue; // vorn, nahe, Spieler schaut zum Taxi
    const D = DIRS[a.dir], q = (roadPos(a.nextK) - (D[0] === 0 ? c.z : c.x)) * (D[0] + D[1]) - pa; // Abstand Spieler -> nächste Kreuzung
    if (q < R / 2 + 3 || q > P - R / 2 - 3) continue; // nur mitten im Block anhalten
    hail = { c, t: 0, w: 0 }; a.hail = { v: a.speed }; return;
  }
}

// ---------- Police ----------
const VIS_NEAR = 22, VIS_FAR = 75, VIS_ANG = 1.1;
const lastSeen = { x: 0, z: 0, foot: false, car: null, bld: null, sig: null };
// Fahrzeug, in dem der Spieler gerade sitzt (auch als Taxi-/Ride-Fahrgast), sonst null
const playerVeh = () => player.car || (player.rideSeat && ride?.car) || null;
const CAR_NAME = { sedan: 'Limousine', coupe: 'Coupé', suv: 'SUV', compact: 'Kleinwagen', pickup: 'Pick-up', van: 'Transporter', convertible: 'Cabrio', muscle: 'Muscle-Car', italia: 'Sportwagen', concept: 'Sportwagen', limo: 'Stretch-Limousine', police: 'Streifenwagen' };
function colName(hex) {
  const h = {}; new THREE.Color(hex).getHSL(h); const d = h.h * 360;
  if (h.l < 0.14) return 'schwarz'; if (h.l > 0.88) return 'weiß'; if (h.s < 0.18) return h.l > 0.6 ? 'silbern' : 'grau';
  return d < 15 || d >= 345 ? 'rot' : d < 40 ? (h.l < 0.4 ? 'braun' : 'orange') : d < 70 ? (h.l > 0.65 ? 'beige' : 'gelb') : d < 170 ? 'grün' : d < 200 ? 'türkis' : d < 255 ? 'blau' : 'violett';
}
// Dativ-Beschreibung für den Polizeifunk: "einem blauen Coupé"
const carDesc = c => c.taxi ? 'einem Taxi' : `${c.type === 'sedan' || c.type === 'limo' ? 'einer' : 'einem'} ${colName(c.color || '#888')}en ${CAR_NAME[c.type] || 'Wagen'}`;
// Liegt ein Punkt im Kamerabild (Frustum)? Für Spawns außer Sicht
const _fr = new THREE.Frustum(), _fm = new THREE.Matrix4(), _fs = new THREE.Sphere();
function inCamView(x, z, r = 6) { camera.updateMatrixWorld(); _fm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_fm); _fs.set(new THREE.Vector3(x, 1.5, z), r); return _fr.intersectsSphere(_fs); }
function copSees(c) {
  if (INT.inside && INT.b?.door) { const dr = INT.b.door; if (Math.hypot(player.x - dr.x, player.z - dr.z) > 7 || Math.hypot(c.x - dr.x, c.z - dr.z) > 45) return false; }
  const tgt = playerVeh() || player, dx = tgt.x - c.x, dz = tgt.z - c.z, d = Math.hypot(dx, dz);
  const sn = player.sneak && !playerVeh(), far = sn ? VIS_FAR * 0.55 : VIS_FAR, near = sn ? 10 : VIS_NEAR;
  if (d > far) return false;
  if (d > near && Math.abs(angDiff(c.yaw, Math.atan2(dx, dz))) > VIS_ANG) return false;
  return lineOfSight(c.x, c.z, tgt.x, tgt.z);
}
// Straßenraster-Navigation: nächster Kreuzungspunkt Richtung Ziel (bleibt auf der Straße)
function roadWaypoint(c, tx, tz) {
  const fx = c.x / P + N / 2, fz = c.z / P + N / 2, kx = clamp(Math.round(fx), 0, N), kz = clamp(Math.round(fz), 0, N);
  const onZ = Math.abs(c.x - roadPos(kx)) < 9, onX = Math.abs(c.z - roadPos(kz)) < 9;
  const tkx = clamp(Math.round(tx / P + N / 2), 0, N), tkz = clamp(Math.round(tz / P + N / 2), 0, N);
  if (tkx === kx && tkz === kz) return [tx, tz];
  if (onZ && onX) {
    if (tkx !== kx && (Math.abs(tkx - kx) >= Math.abs(tkz - kz) || tkz === kz)) return [roadPos(kx + Math.sign(tkx - kx)), roadPos(kz)];
    return [roadPos(kx), roadPos(kz + Math.sign(tkz - kz))];
  }
  if (onZ) { const nz = tz > c.z ? Math.ceil(fz) : Math.floor(fz); return [roadPos(kx), roadPos(clamp(nz, 0, N))]; }
  const nx = tx > c.x ? Math.ceil(fx) : Math.floor(fx); return [roadPos(clamp(nx, 0, N)), roadPos(kz)];
}
// Polizei: Rollen Verfolgen / Abfangen / Blockieren, aussteigen wenn Franklin zu Fuß ist
function updatePolice(c, dt) {
  const veh = playerVeh(), a = c.ai, tgt = veh || player, pv = veh ? [veh.vx, veh.vz] : [player.vx, player.vz];
  const pd = Math.hypot(tgt.x - c.x, tgt.z - c.z);
  if (c.deployed) { driveCar(c, 0, 0, true, dt); if (c.deployT !== undefined) deployCrew(c, dt); return; }
  let tx, tz;
  if (wanted > 0 && wantedCool < 2 && !INT.inside) {
    tx = tgt.x; tz = tgt.z; c.bldDone = null; c.footDone = false;
    if (c.role === 'intercept' && veh) { tx += pv[0] * 2.5; tz += pv[1] * 2.5; }
    if (c.role === 'block' && veh && Math.hypot(...pv) < 6 && pd < 35) { const f = [Math.sin(veh.yaw), Math.cos(veh.yaw)]; tx += f[0] * 9; tz += f[1] * 9; }
  } else if (wanted > 0) {
    if (INT.inside && wantedCool < 2) lastSeen.bld = INT.b;
    const bl = lastSeen.bld, inSearch = bl ? squad.cops.length * (squad.b === bl) + officers.filter(o => o.bld === bl).length : 0;
    if (bl && bl.door && c.bldDone !== bl && inSearch < 4) {
      const dr = bl.door; tx = dr.x + dr.nx * 6; tz = dr.z + dr.nz * 6;
      if (Math.hypot(tx - c.x, tz - c.z) < 16 && c.driver) { c.bldDone = bl; c.searchB = bl; c.deployed = true; c.deployT = 0; if (Math.random() < 0.6) say(pick(LINES.surround), { who: 'Polizeifunk', radio: true, color: '#6fa8ff' }); }
    } else if (!bl && lastSeen.foot && !c.footDone && c.driver && Math.hypot(lastSeen.x - c.x, lastSeen.z - c.z) < 22) { c.footDone = true; c.deployed = true; c.deployT = 0; }
    else {
      const ref = !bl && lastSeen.car && cars.includes(lastSeen.car) && lastSeen.car !== veh ? lastSeen.car : lastSeen;
      if (!a.search || Math.hypot(a.search[0] - c.x, a.search[1] - c.z) < 14) a.search = [ref.x + rnd(-60, 60), ref.z + rnd(-60, 60)];
      [tx, tz] = a.search;
    }
  } else { tx = c.x + Math.sin(c.yaw) * 50; tz = c.z + Math.cos(c.yaw) * 50; }
  const direct = Math.hypot(tx - c.x, tz - c.z) < 38 || (c.sees && pd < 60);
  if (!direct) [tx, tz] = roadWaypoint(c, tx, tz);
  const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
  const diff = angDiff(c.yaw, Math.atan2(dx, dz));
  let steer = clamp(diff * 2, -1, 1), thr = wanted > 0 ? (direct ? 1 : clamp(dist / 25, 0.45, 1)) : 0.35;
  const probe = (ang, d) => solidAt(c.x + Math.sin(c.yaw + ang) * d, 1, c.z + Math.cos(c.yaw + ang) * d);
  if (probe(0.35, 9)) steer -= 0.9; if (probe(-0.35, 9)) steer += 0.9;
  if (Math.abs(diff) > 2.2 && dist < 25) { thr = -1; steer = -steer; }
  if (Math.abs(c.speedF || 0) < 1.2 && thr > 0) a.stuck += dt; else a.stuck = 0;
  if (a.stuck > 1.6) { a.rev = 1.4; a.stuck = 0; }
  if (a.rev > 0) { a.rev -= dt; thr = -1; steer = -Math.sign(diff); }
  // Franklin zu Fuß in der Nähe: anhalten und aussteigen
  if (wanted > 0 && wantedCool < 2 && !veh && !INT.inside && pd < 24 && (c.sees || pd < 12)) {
    thr = Math.abs(c.speedF || 0) > 1 ? -Math.sign(c.speedF) : 0;
    if (Math.abs(c.speedF || 0) < 1.5 && c.driver) { c.deployed = true; c.deployT = 0; }
  }
  driveCar(c, clamp(thr, -1, 1), clamp(steer, -1, 1), false, dt);
  // Schüsse aus dem fahrenden Wagen (ab 3 Sternen) & Megafon
  if (wanted >= 3 && c.sees && pd < 28) {
    a.fire = (a.fire || 0) - dt;
    if (a.fire <= 0) { a.fire = rnd(0.7, 1.3); sfx.shot(c.x, c.z, 0.5); if (Math.random() < 0.35) { if (veh) damageCar(veh, 2 + wanted); else hurtPlayer(3 + wanted * 1.5); } }
  }
  a.mega = (a.mega ?? rnd(1, 4)) - dt;
  if (wanted > 0 && c.sees && a.mega <= 0 && pd < 30) { a.mega = rnd(10, 16); say(pick(LINES.mega), { who: 'Polizei (Megafon)', color: '#6fa8ff' }); }
}
// Beamte zu Fuß
const officers = [];
function deployCrew(c, dt) {
  c.deployT += dt;
  if (c.deployT < 0.05) { c.doors[0].target = 1; if (wanted >= 2) c.doors[1].target = 1; sfx.door(); }
  if (c.deployT > 0.55) {
    const h = takeDriver(c); c.crew = 0;
    if (h) { const [x, z] = doorPoint(c, 1); officers.push(makeOfficer(h, x, z, c, 1)); c.crew++; }
    if (wanted >= 2 || c.searchB) { const h2 = makeHuman(COP_LOOK), [x, z] = doorPoint(c, -1); scene.add(h2.group); officers.push(makeOfficer(h2, x, z, c, -1)); c.crew++; }
    if (c.searchB) { for (const o of officers) if (o.car === c) o.bld = c.searchB; c.searchB = null; }
    c.deployT = undefined; c.doors[0].target = 0; c.doors[1].target = 0;
    say(pick(LINES.mega), { who: 'Polizei', color: '#6fa8ff', voice: 'pavoque', rate: 1 });
  }
}
function makeOfficer(h, x, z, car, side) { h.group.position.set(x, groundH(x, z), z); setHumanShadow(h, true); return { h, x, z, yaw: car.yaw + side * Math.PI / 2, car, side, state: 'approach', hp: 70, fire: rnd(0.5, 1.5), arrest: 0, cop: true, t: 0, speed: 0 }; }
function copCarRelease(car, dec) {
  if (!car || !cars.includes(car)) return;
  if (dec) car.crew = Math.max(0, (car.crew || 1) - 1);
  if (car.crew > 0) return;
  car.deployed = false;
  if (wanted === 0 && car.mode !== 'wreck') { if (!car.driver) setDriver(car, makeHuman(COP_LOOK)); car.mode = 'ai'; initAI(car, dirOfYaw(car.yaw)); }
}
function updateOfficers(dt) {
  const veh = playerVeh(), tgt = veh || player;
  for (let i = officers.length - 1; i >= 0; i--) {
    const o = officers[i];
    if (o.state === 'dead') { if ((o.t -= dt) < 0) { scene.remove(o.h.group); disposeHuman(o.h); officers.splice(i, 1); copCarRelease(o.car, true); } continue; }
    const dx = tgt.x - o.x, dz = tgt.z - o.z, d = Math.hypot(dx, dz), gate = !INT.inside || (Math.hypot(player.x - INT.b.door.x, player.z - INT.b.door.z) < 7 && Math.hypot(o.x - INT.b.door.x, o.z - INT.b.door.z) < 30), los = gate && d < 70 && lineOfSight(o.x, o.z, tgt.x, tgt.z);
    o.sees = los && d < 55;
    const carAway = veh && d > 14; // Spieler im Fahrzeug: Beamte zurück in die Wagen
    if (wanted === 0 || (carAway && o.sees)) o.state = 'return';
    let mx = 0, mz = 0, sp = 0, aim = false;
    if (o.state === 'return') {
      if (!o.car || o.car.mode === 'wreck' || !cars.includes(o.car)) { if (d > 80) { scene.remove(o.h.group); disposeHuman(o.h); officers.splice(i, 1); continue; } o.state = 'approach'; }
      else {
        const [tx, tz] = doorPoint(o.car, o.side), ex = tx - o.x, ez = tz - o.z, e = Math.hypot(ex, ez);
        if (e < 0.5) {
          o.car.doors[o.side > 0 ? 0 : 1].target = 1; setTimeout(() => { if (o.car) o.car.doors[o.side > 0 ? 0 : 1].target = 0; }, 700);
          scene.remove(o.h.group);
          if (o.side > 0 && !o.car.driver) setDriver(o.car, o.h); else disposeHuman(o.h);
          if (--o.car.crew <= 0) { o.car.deployed = false; if (wanted === 0) { o.car.mode = 'ai'; initAI(o.car, dirOfYaw(o.car.yaw)); } }
          officers.splice(i, 1); continue;
        }
        mx = ex / e; mz = ez / e; sp = 4.2;
      }
    } else if ((!o.sees && wantedCool >= 1.5) || (INT.inside && (o.bld || lastSeen.bld || INT.b) === INT.b)) {
      // Kein Sichtkontakt bzw. Spieler im Gebäude: Gebäude durchsuchen oder Umgebung des letzten Sichtpunkts absuchen
      if (!o.bld && lastSeen.bld) o.bld = lastSeen.bld; if (!o.bld && INT.inside) o.bld = INT.b;
      let gx, gz;
      if (o.bld) {
        gx = o.bld.door.x; gz = o.bld.door.z;
        if (Math.hypot(gx - o.x, gz - o.z) < 0.9) { squadEnter(o.bld, o); scene.remove(o.h.group); disposeHuman(o.h); if (o.car) o.car.crew = Math.max(0, (o.car.crew || 1) - 1); officers.splice(i, 1); continue; }
      } else { if (!o.sp || Math.hypot(o.sp[0] - o.x, o.sp[1] - o.z) < 1.5) o.sp = [lastSeen.x + rnd(-18, 18), lastSeen.z + rnd(-18, 18)]; [gx, gz] = o.sp; }
      const ex = gx - o.x, ez = gz - o.z, e = Math.hypot(ex, ez) || 1; mx = ex / e; mz = ez / e; sp = o.bld ? 4.2 : 2.3;
    } else {
      const keep = wanted >= 2 ? (los ? 11 : 2.5) : veh ? 2.8 : 1.4;
      if (d > keep) { mx = dx / d; mz = dz / d; sp = d > 8 ? 4.6 : 2.2; }
      if (wanted >= 2 && los && d < 40) {
        aim = true; sp = Math.min(sp, 2.2); o.fire -= dt;
        if (o.fire <= 0) {
          o.fire = rnd(0.6, 1.2); sfx.shot(o.x, o.z, 0.7);
          const from = new THREE.Vector3(o.x, groundH(o.x, o.z) + 1.45, o.z), to = new THREE.Vector3(tgt.x + rnd(-0.6, 0.6), (veh ? veh.y + 0.9 : player.y + 1.2), tgt.z + rnd(-0.6, 0.6));
          const tr = new THREE.Mesh(tracerG, tracerM); tr.position.copy(from); tr.lookAt(to); tr.scale.z = from.distanceTo(to); scene.add(tr); tracers.push({ m: tr, t: 0.05 });
          if (Math.random() < clamp(0.6 - d * 0.012 - (player.sneak ? 0.15 : 0), 0.08, 0.6)) { if (veh) damageCar(veh, 3 + wanted); else hurtPlayer(4 + wanted * 1.5); }
        }
      }
      // Festnahme bei einem Stern
      if (wanted === 1 && d < (veh ? 3.4 : 2.3) && (veh ? Math.hypot(veh.vx, veh.vz) < 1 : Math.hypot(player.vx, player.vz) < 1.3)) {
        o.arrest += dt; if (o.arrest > 0.2 && o.arrest - dt <= 0.2) say(pick(LINES.arrest), { who: 'Polizei', color: '#6fa8ff', voice: 'pavoque', prio: true });
        if (o.arrest > 1.8) busted();
      } else o.arrest = Math.max(0, o.arrest - dt);
    }
    if (sp > 0) {
      o.x += mx * sp * dt; o.z += mz * sp * dt; const r0 = resolveCircle(o.x, o.z, 0.38, groundH(o.x, o.z) + 0.9); o.x = r0.x; o.z = r0.z;
      o.yaw += angDiff(o.yaw, Math.atan2(aim ? dx : mx, aim ? dz : mz)) * Math.min(1, dt * 10);
    } else o.yaw += angDiff(o.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
    animHuman(o.h, sp, dt, aim); if (aim) aimPose(o.h, 0);
    o.h.group.position.set(o.x, groundH(o.x, o.z), o.z); o.h.group.rotation.set(0, o.yaw, 0);
  }
}
// Durchsuchungstrupp im Gebäude: Etage für Etage, Raum für Raum
const squad = { b: null, cops: [], exitT: 0, outT: 0, knownFloor: null, lostT: 0 };
const OPEN_ROOM = { open: true };
const roomAt = (F, x, z) => F.rooms?.find(q => !q.open && x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1) || OPEN_ROOM;
function squadEnter(b, o) {
  if (squad.b !== b) { squadClear(); squad.b = b; squad.knownFloor = null; }
  squad.cops.push({ floor: 0, n: null, F: null, t: 0, car: o.car, side: o.side, sweep: 0, dir: 1, chase: false });
  if (squad.cops.length === 1) say(pick(LINES.enter), { who: 'Polizeifunk', radio: true, color: '#6fa8ff', prio: true });
}
function squadDrop(c) { if (c.n && c.F) { c.F.group.remove(c.n.h.group); disposeHuman(c.n.h); const k = c.F.npcs.indexOf(c.n); if (k >= 0) c.F.npcs.splice(k, 1); } c.n = null; }
function squadClear() {
  for (const c of squad.cops) { squadDrop(c); if (c.car && cars.includes(c.car) && c.car.deployed && c.car.crew <= 0) { c.car.deployed = false; if (!c.car.driver) setDriver(c.car, makeHuman(COP_LOOK)); c.car.mode = 'ai'; initAI(c.car, dirOfYaw(c.car.yaw)); } }
  squad.cops = []; squad.b = null; squad.knownFloor = null;
}
function updateSquad(dt) {
  if (!squad.cops.length) return;
  if (wanted === 0) { squadClear(); return; }
  const here = INT.active && INT.b === squad.b && INT.inside;
  if (!here) {
    // Spieler ist draußen: wurde er gesehen oder ist die Suche erfolglos, kommen die Beamten nacheinander heraus
    squad.outT += dt; squad.exitT -= dt;
    if ((wantedCool < 1.5 || squad.outT > 25) && squad.exitT <= 0) {
      squad.exitT = rnd(1.2, 3); const c = squad.cops.pop(); squadDrop(c);
      const dr = squad.b.door, h = makeHuman(COP_LOOK); scene.add(h.group);
      const o = makeOfficer(h, dr.x, dr.z, c.car || { yaw: 0 }, c.side || 1); o.car = c.car && cars.includes(c.car) ? c.car : null; if (o.car) o.car.crew = (o.car.crew || 0) + 1;
      officers.push(o); if (!squad.cops.length) squad.b = null;
    }
    return;
  }
  squad.outT = 0;
  if (squad.knownFloor != null && (squad.lostT += dt) > 20) squad.knownFloor = null;
  for (const c of [...squad.cops]) {
    if (c.n && c.n.state === 'dead') { squad.cops.splice(squad.cops.indexOf(c), 1); copCarRelease(c.car, false); addWanted(0, Math.max(3, wanted)); continue; }
    if (c.n && INT.floors.get(c.floor) !== c.F) c.n = null;
    c.t += dt;
    let goal = squad.knownFloor ?? (c.sweep >= 3 ? c.floor + c.dir : c.floor);
    if (goal < 0 || goal > INT.b.floors - 1) { c.dir *= -1; goal = c.floor + c.dir; }
    if (INT.b.small) goal = 0;
    if (goal !== c.floor && c.t > (squad.knownFloor != null ? 6 : 12) && !c.chase) { squadDrop(c); c.floor = clamp(c.floor + Math.sign(goal - c.floor), 0, INT.b.floors - 1); c.t = 0; c.sweep = 0; }
    if (!c.n && INT.floors.has(c.floor)) {
      const F = INT.floors.get(c.floor), sp = c.floor === 0 || INT.b.small ? exitSpotOf(F) : { ...F.elevSpot, multi: true };
      c.n = spawnINpc(F, 'cop', sp, COP_LOOK); c.n.sq = c; c.F = F; c.n.wait = 0.5; c.n.path = null;
    }
  }
}
function updateICop(n, F, dt, plx, plz) {
  const c = n.sq, same = INT.inside && curFloorOf(player.y) === F.f, d = Math.hypot(plx - n.x, plz - n.z);
  const pr = roomAt(F, plx, plz), nr = roomAt(F, n.x, n.z);
  const sees = same && !player.dead && (d < 5 || (d < 22 && (pr === nr || (pr.open && nr.open))));
  if (sees) {
    squad.knownFloor = F.f; squad.lostT = 0; wantedCool = 0; lastSeen.x = player.x; lastSeen.z = player.z; lastSeen.bld = INT.b; lastSeen.foot = true; c.lost = 0;
    if (!c.chase) { c.chase = true; say(pick(LINES.found), { who: 'Polizei', voice: 'pavoque', color: '#6fa8ff', h: n.h, prio: true }); }
  } else if (c.chase && (c.lost = (c.lost || 0) + dt) > 6) { c.chase = false; n.path = null; }
  let sp = 0; const aim = c.chase && sees && wanted >= 2;
  if (c.chase) {
    const keep = wanted >= 2 ? 6 : 1.3;
    if (aim) {
      c.fire = (c.fire ?? rnd(0.6, 1.2)) - dt;
      if (c.fire <= 0) { c.fire = rnd(0.7, 1.3); sfx.shot(n.wx ?? player.x, n.wz ?? player.z, 0.8); if (Math.random() < clamp(0.55 - d * 0.02, 0.15, 0.55)) hurtPlayer(4 + wanted * 1.5); }
    }
    if (d > keep) { if (!n.path || (c.repath = (c.repath || 0) - dt) < 0) { c.repath = 0.7; n.room = nr; n.path = intPath(n, { x: plx, z: plz, room: pr, multi: true }); n.pi = 0; n.target = null; } sp = d > 5 ? 4.2 : 2.2; }
    else n.path = null;
    if (wanted === 1 && sees && d < 1.9 && Math.hypot(player.vx, player.vz) < 1.3) {
      c.arrest = (c.arrest || 0) + dt; if (c.arrest > 0.2 && c.arrest - dt <= 0.2) say(pick(LINES.arrest), { who: 'Polizei', color: '#6fa8ff', voice: 'pavoque', prio: true });
      if (c.arrest > 1.8) busted();
    } else c.arrest = 0;
  } else if (!n.path && (n.wait -= dt) <= 0) {
    const opts = F.spots.filter(s => s.room !== n.at?.room && s.type !== 'window'), t = pick(opts.length ? opts : F.spots);
    if (t) { n.room = nr; n.path = intPath(n, t); n.pi = 0; n.target = t; c.sweep++; }
    n.wait = rnd(1.2, 2.5);
  }
  if (n.path) {
    sp = sp || 2.6;
    const [tx, tz] = n.path[n.pi], dx = tx - n.x, dz = tz - n.z, dd = Math.hypot(dx, dz);
    if (dd < 0.2) { n.pi++; if (n.pi >= n.path.length) { n.path = null; if (n.target) n.at = n.target; n.target = null; } }
    else { const st = Math.min(dd, sp * dt); n.x += dx / dd * st; n.z += dz / dd * st; if (!aim) n.yaw += angDiff(n.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 10); }
  }
  if (aim || (c.chase && !n.path)) n.yaw += angDiff(n.yaw, Math.atan2(plx - n.x, plz - n.z)) * Math.min(1, dt * 10);
  animHuman(n.h, n.path ? sp : 0, dt, aim, n.path ? null : 'stand'); if (aim) aimPose(n.h, 0);
}
// Zeugen rufen die Polizei: erst Anruf, dann Leitstelle über Funk, dann Sterne. Ohne Zeugen keine Fahndung.
const CRIME = { theft: 'Ladendiebstahl', carjack: 'Autodiebstahl', shooting: 'Schüsse gemeldet', murder: 'Tötungsdelikt', hitrun: 'Fahrerflucht', assault: 'Körperverletzung' };
let pendingCall = null;
function reportCrime(type, x, z, stars, indoor = false) {
  const copSaw = cars.some(c => c.cop && c.mode !== 'wreck' && Math.hypot(c.x - x, c.z - z) < 60 && lineOfSight(c.x, c.z, x, z)) || officers.some(o => o.state !== 'dead' && Math.hypot(o.x - x, o.z - z) < 50 && lineOfSight(o.x, o.z, x, z));
  if (copSaw) { addWanted(0, Math.max(wanted, stars)); return; }
  if (wanted >= stars) { lastSeen.x = x; lastSeen.z = z; return; }
  if (pendingCall && pendingCall.stars >= stars) return;
  const wit = indoor ? INT.npcs.filter(n => n.state !== 'dead') : peds.filter(p => p.state !== 'dead' && p.state !== 'fly' && Math.hypot(p.x - x, p.z - z) < 40 && lineOfSight(p.x, p.z, x, z));
  if (!wit.length) return;
  if (Math.random() > 1 - Math.pow(0.45, wit.length)) return;
  const w = pick(wit);
  pendingCall = { type, x, z, stars, w, t: rnd(4, 7), phase: 'call', d: districtOf(x, z), bld: indoor ? INT.b : null, car: playerVeh(), foot: !playerVeh() };
  if (!indoor) { w.state = 'walk'; w.path = null; w.task = { type: 'calling' }; w.pose = 'phone'; w.wait = 12; }
}
function updateCrimeCalls(dt) {
  const c = pendingCall; if (!c) return;
  c.t -= dt;
  if (c.w.state === 'dead') { pendingCall = null; return; }
  if (c.phase === 'call' && c.t < 3 && !c.said) { c.said = true; if (Math.hypot((c.w.wx ?? c.w.x) - player.x, (c.w.wz ?? c.w.z) - player.z) < 30) say(pick(LINES.witness[c.type]), { who: 'Zeuge (Telefon)', voice: c.w.voice, rate: c.w.vrate, h: c.w.h, prio: true }); }
  if (c.phase === 'call' && c.t <= 0) { c.phase = 'radio'; c.t = rnd(3, 5); if (scannerOn || Math.hypot(c.x - player.x, c.z - player.z) < 220) say(pick(CRIME_RADIO).replace('{c}', CRIME[c.type]).replace('{d}', c.d), { who: 'Polizeifunk', radio: true, color: '#6fa8ff', prio: true }); }
  else if (c.phase === 'radio' && c.t <= 0) {
    if (wanted < c.stars) { const before = wanted; wanted = c.stars; lastSeen.x = c.x; lastSeen.z = c.z; lastSeen.bld = c.bld; lastSeen.foot = c.foot; lastSeen.car = c.car && cars.includes(c.car) ? c.car : null; wantedCool = 1.5; if (before === 0) { lastSeen.sig = null; notice('GESUCHT!', 1500); say(pick(LINES.chars[cur].cops), { who: CHARS[cur].name, color: CHARS[cur].col }); } }
    if (c.w.task?.type === 'calling') { c.w.task = null; c.w.wait = 0; }
    pendingCall = null;
  }
}
function busted() {
  if (player.dead) return;
  player.bustStars = Math.max(1, wanted);
  player.dead = 4.5; player.bust = true; $('wasted').querySelector('b').textContent = 'VERHAFTET'; $('wasted').classList.add('bust'); $('wasted').style.display = 'flex';
  sfx.wasted(); abortSeq(); if (player.car) exitCar(true);
}
// Einsatzleitung: Streifen auffüllen, Einheiten zuteilen, Verstärkung von der Wache
let dispatchT = 0, hqT = 0, dispClk = 0, respAt = 0, prevW = 0;
// Streifenwagen nur auf Straße, weit weg und außerhalb des Kamerabilds erscheinen lassen
function copSpawnPoint() { for (let t = 0; t < 10; t++) { const rp = roadPoint(130, 280); if (rp && !inCamView(rp.x, rp.z)) return rp; } return null; }
function updateDispatch(dt) {
  dispatchT -= dt; hqT -= dt; dispClk += dt; if (dispatchT > 0) return; dispatchT = 1;
  if (wanted > 0 && !prevW) respAt = dispClk + [0, 8, 6, 4, 3, 2][wanted]; // Reaktionszeit der Leitstelle je Sterne
  prevW = wanted;
  const units = cars.filter(c => c.cop && c.mode !== 'wreck'), pursuing = units.filter(c => c.mode === 'police');
  const dist = c => Math.hypot(c.x - player.x, c.z - player.z);
  if (wanted > 0) {
    const need = [0, 2, 3, 5, 7, 9][wanted] - pursuing.length;
    if (need > 0 && dispClk >= respAt) {
      const free = units.filter(c => c.mode === 'ai').sort((a, b) => dist(a) - dist(b)).slice(0, need);
      for (const c of free) { c.mode = 'police'; c.ai.stuck = 0; }
      if (free.length < need && hqT <= 0 && POLICE_HQ.exit) {
        hqT = [4, 9, 7, 5, 4, 3][wanted]; const e = POLICE_HQ.exit, rp = Math.hypot(e.x - player.x, e.z - player.z) > 130 && !inCamView(e.x, e.z) ? { x: e.x, z: e.z, dir: 1 } : copSpawnPoint();
        if (rp && !cars.some(o => Math.hypot(o.x - rp.x, o.z - rp.z) < 7)) { const c = makeCar('police', '#000', rp.x, rp.z, dirYaw(rp.dir), 'police'); c.cop = true; if (Math.random() < 0.5) say(pick(LINES.hq), { who: 'Polizeifunk', radio: true, color: '#6fa8ff' }); }
      }
    }
    pursuing.sort((a, b) => dist(a) - dist(b)).forEach((c, k) => c.role = ['chase', 'intercept', 'block'][k] || 'chase');
  } else {
    for (const c of pursuing) if (!c.deployed) { c.mode = 'ai'; initAI(c, dirOfYaw(c.yaw)); const D = DIRS[c.ai.dir], k = Math.round((D[0] === 0 ? c.x : c.z) / P + N / 2); c.ai.laneC = laneFor(c.ai.dir, k); }
  }
  if (units.length < 5 && (!wanted || dispClk >= respAt)) { const rp = copSpawnPoint(); if (rp) { const c = makeCar('police', '#000', rp.x, rp.z, 0, 'ai'); c.cop = true; initAI(c, rp.dir); } }
}

// ---------- Player & Charaktere ----------
const player = { x: 9.9, z: 20, y: 0.2, vy: 0, vx: 0, vz: 0, yaw: -Math.PI / 2, hp: 100, armor: 60, money: 18750, car: null, h: null, fireCd: 0, aimT: 0, dead: 0, grounded: true, respect: 0 };
let wanted = 0, wantedCool = 0, cur = 0, switching = null;
const START = { x: 9.9, z: 20 };
const HOMES = {}, HOSPITAL = { x: 0, z: 0, yaw: Math.PI }, POIS = [];
const CHARS = [
  { name: 'FRANKLIN', bank: 12400, col: '#9be389', home: 'franklin', look: { gender: 'm', skin: '#8a5a40', shirt: '#b8d8a0', pants: '#3a4258', shoes: '#ffffff', hair: '#111111', beard: 0.6, hairStyle: 'buzz' }, car: ['italia', '#3a1660'], money: 18750 },
  { name: 'MICHAEL', bank: 245000, col: '#6fb3ff', home: 'michael', look: { gender: 'm', skin: '#f2dccb', shirt: '#d0d8e0', pants: '#4a4d55', shoes: '#2a2018', hair: '#3a2a1c', beard: 0.1, hairStyle: 'slick' }, car: ['concept', '#2d3035'], money: 64200 },
  { name: 'TREVOR', bank: 8600, col: '#ffa060', home: 'trevor', look: { gender: 'm', skin: '#e8c4aa', shirt: '#cfc6a6', pants: '#6a7a90', shoes: '#5a4030', hair: '#5a4632', beard: 0.8, hairStyle: 'bald' }, car: ['suv', '#6b4a2a'], money: 3120 },
];
// Spieler wird umgerissen (Auto, Explosion, Sturz): fliegt, überschlägt sich, bleibt kurz liegen, steht auf
function knockPlayer(vx, vy, vz, dmg) {
  if (player.dead || player.car || player.ride || seq) return;
  hurtPlayer(dmg); if (player.dead) return;
  const sp = Math.hypot(vx, vz);
  player.rag = { phase: 'fly', t: 0, vx, vy, vz, spin: (sp > 3 ? rnd(4, 8) : 2) * Math.min(1.4, sp / 12 + 0.4), roll: rnd(-2, 2), rx: 0, rz: 0 };
  player.vx = player.vz = 0; shake = Math.max(shake, Math.min(0.7, sp / 20 + 0.2)); sfx.hit();
}
function updateRag(dt) {
  const R0 = player.rag, h = player.h; R0.t += dt;
  if (R0.phase === 'fly') {
    R0.vy -= 15 * dt; player.x += R0.vx * dt; player.z += R0.vz * dt; player.y += R0.vy * dt;
    const q = resolveCircle(player.x, player.z, 0.35, player.y + 0.6); if (q.hit) { R0.vx *= -0.3; R0.vz *= -0.3; } player.x = q.x; player.z = q.z;
    R0.rx += R0.spin * dt; R0.rz += R0.roll * dt;
    const gy = floorH(player.x, player.z, player.y);
    if (player.y <= gy && R0.vy < 0) {
      player.y = gy;
      if (Math.abs(R0.vy) > 3 && R0.t < 3) { R0.vy *= -0.28; R0.vx *= 0.5; R0.vz *= 0.5; R0.spin *= 0.4; sfx.hit(); }
      else { R0.phase = 'lie'; R0.t = 0; R0.rx = -Math.PI / 2; R0.rz = 0; }
    }
  } else if (R0.phase === 'lie') { if (R0.t > 1.3) { R0.phase = 'up'; R0.t = 0; } }
  else { const k = Math.min(1, R0.t / 0.7); R0.rx = -Math.PI / 2 * (1 - smooth(0, 1, k)); if (k >= 1) { player.rag = null; h.group.rotation.set(0, player.yaw, 0); return; } }
  h.group.position.set(player.x, player.y + (R0.phase === 'fly' ? 0.4 : Math.abs(Math.sin(R0.rx)) * 0.25), player.z);
  h.group.rotation.set(R0.rx, player.yaw, R0.rz);
  animHuman(h, 0, dt, false, R0.phase === 'up' ? 'sit' : null);
}
function hurtPlayer(d) {
  if (player.dead || switching) return;
  const a = Math.min(player.armor, d * 0.7); player.armor -= a; player.hp -= d - a;
  if (player.hp <= 0) { player.hp = 0; die(); }
}
function addWanted(n, min = 0) {
  const before = wanted; wanted = clamp(Math.max(wanted + n, min), 0, 5); wantedCool = 0;
  lastSeen.x = player.x; lastSeen.z = player.z; lastSeen.foot = !playerVeh(); lastSeen.car = playerVeh(); lastSeen.bld = INT.inside ? INT.b : null;
  if (before === 0) lastSeen.sig = null;
  if (wanted > before && before === 0) { notice('GESUCHT!', 1500); say(pick(LINES.chars[cur].cops), { who: CHARS[cur].name, color: CHARS[cur].col, prio: true }); radioT = 3; }
}
function fade(on) { $('fade').classList.toggle('on', on); }
function die() {
  closeMenu(); INT.menu = null; INT.panelMode = false; INT.pressed = null; player.h.group.visible = true;
  player.dead = 5; $('wasted').style.display = 'flex'; sfx.wasted();
  abortSeq(); if (player.car) exitCar(true);
}
function respawn() {
  $('wasted').style.display = 'none';
  closeMenu(); INT.menu = null; INT.panelMode = false; INT.pressed = null; pendingCall = null; player.rag = null;
  if (INT.active) deactivateBuilding();
  const bust = player.bust; player.bust = false; $('wasted').querySelector('b').textContent = 'WASTED'; $('wasted').classList.remove('bust');
  squadClear(); if (!bust) player.jail = null;
  const spot = bust ? (PRISON ? { x: PRISON.inside.x, z: PRISON.inside.z, yaw: Math.PI } : { x: POLICE_HQ.x, z: POLICE_HQ.z, yaw: Math.PI }) : HOSPITAL;
  Object.assign(player, { x: spot.x, z: spot.z, yaw: spot.yaw, hp: bust ? player.hp : 100, armor: 0, dead: 0, vx: 0, vz: 0, vy: 0, y: 0.2 });
  const bill = Math.min(player.money, bust ? Math.max(250, Math.round(player.money * 0.1)) : 500); player.money -= bill; wanted = 0; wantedCool = 0;
  if (bust) for (const w of WEAPONS) if (w.ammo !== undefined && w.ammo !== Infinity) w.ammo = 0;
  for (const o of [...officers]) { scene.remove(o.h.group); disposeHuman(o.h); } officers.length = 0;
  for (const c of [...cars]) if (c.cop && c.mode === 'police') removeCar(c);
  player.h.group.visible = true; player.h.group.rotation.set(0, player.yaw, 0);
  camYaw = player.yaw; camPitch = 0.2;
  setTimeout(() => fade(false), 400);
  if (bust && PRISON) {
    player.money += bill; jailReset(); Object.assign(player, { x: PRISON.cell.x, z: PRISON.cell.z, yaw: Math.PI });
    banner('VERHAFTET', 'BOLINGBROKE STRAFVOLLZUG · KAUTION 200 $ ODER AUSBRECHEN', 4500);
    notice('Waffen beschlagnahmt', 3000);
  } else notice(bust ? `Polizeiwache Mission Row · Kaution: -$${bill} · Waffen beschlagnahmt` : `Krankenhaus Pillbox Hill · Rechnung: -$${bill}`, 3800);
}
function storeChar() { const c = CHARS[cur]; Object.assign(c.st, { x: player.x, z: player.z, yaw: player.yaw, hp: player.hp, armor: player.armor, money: player.money, bank: player.bank, inv: player.inv, respect: player.respect, hotel: player.hotel }); }
function applyChar(i) {
  cur = i; const c = CHARS[i], st = c.st;
  Object.assign(player, { x: st.x, z: st.z, yaw: st.yaw, hp: st.hp, armor: st.armor, money: st.money, bank: st.bank ?? c.bank, inv: st.inv || {}, hotel: st.hotel || null, respect: st.respect || 0, vx: 0, vz: 0, vy: 0, y: groundH(st.x, st.z), h: c.h, car: null });
  c.h.group.visible = true;
  $('who').textContent = c.name; $('who').style.color = c.col;
  for (const k in HOMES) HOMES[k].marker.visible = k === c.home;
}
function switchChar(i) {
  if (i === cur || switching || player.dead || !started) return;
  if (player.ride) { notice('Erst die Fahrt beenden', 1600); return; }
  if (player.jail) { notice('Nicht im Gefängnis', 1600); return; }
  if (seq) return;
  if (wanted > 0) { notice('Wechsel während einer Fahndung nicht möglich', 1800); return; }
  if (INT.inside) { notice('Erst das Gebäude verlassen', 1800); return; }
  if (player.car) exitCar(true);
  storeChar();
  switching = { t: 0, from: { x: player.x, z: player.z }, to: i, swapped: false };
  sfx.whoosh();
}
function updateSwitch(dt) {
  const s = switching; s.t += dt;
  if (!s.swapped && s.t >= 1.3) { s.swapped = true; applyChar(s.to); camYaw = player.yaw; camPitch = 0.2; sfx.whoosh(); }
  if (s.t >= 2.6) { switching = null; say(pick(LINES.chars[cur].hello), { who: CHARS[cur].name, color: CHARS[cur].col, prio: true }); }
}
// Inaktive Charaktere stehen im Viertel herum
function updateIdleChars(dt) {
  CHARS.forEach((c, i) => {
    if (i === cur && !switching) return;
    if (i === cur) return;
    const st = c.st; c.h.group.position.set(st.x, groundH(st.x, st.z), st.z); c.h.group.rotation.y = st.yaw;
    c.h.group.visible = false; // andere spielbare Charaktere existieren nicht in der Welt des aktiven Charakters
  });
}
const SAVE_KEY = 'gta-ls-save-v1';
function saveGame() {
  storeChar();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ cur, gameMin, chars: CHARS.map(c => c.st) })); return true; } catch (e) { return false; }
}
function loadGame() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (!s || !Array.isArray(s.chars)) return false;
    s.chars.forEach((st, i) => { if (CHARS[i] && Number.isFinite(st.x) && Number.isFinite(st.z)) Object.assign(CHARS[i].st, st, { hp: 100 }); });
    if (Number.isFinite(s.gameMin)) gameMin = s.gameMin;
    cur = clamp(s.cur | 0, 0, CHARS.length - 1); return true;
  } catch (e) { return false; }
}
function useHome() {
  const home = HOMES[CHARS[cur].home];
  if (!home || player.car || Math.hypot(home.x - player.x, home.z - player.z) > 2) return false;
  if (wanted > 0) { notice('Erst die Polizei abhängen!', 1600); return true; }
  fade(true); sfx.save();
  setTimeout(() => {
    gameMin = (gameMin + 6 * 60) % 1440; player.hp = 100;
    const ok = saveGame(); fade(false);
    notice(ok ? 'Geschlafen · Spiel gespeichert' : 'Geschlafen · Speichern im Browser nicht möglich', 2500);
  }, 900);
  return true;
}
let seq = null;
function enterCar() {
  if (seq || INT.inside || player.rag || player.dead) return;
  let best = null, bd = 4.5;
  for (const c of cars) { if (c.mode === 'wreck' || c.mode === 'service' || c.ai?.hail || c.type === 'police' || c.npcSeq) continue; const [dx, dz] = doorPoint(c); const d = Math.hypot(dx - player.x, dz - player.z); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  if (best.mode === 'ai') { best.ai.speed = 0; best.mode = 'held'; }
  seq = { type: 'enter', car: best, t: 0, phase: 'walk' };
}
// Ein-/Ausstieg abbrechen (Tod, Verhaftung): sonst bleibt seq hängen und setzt den Spieler nach dem Respawn ins alte Auto
function abortSeq() {
  const q = seq; if (!q) return; seq = null;
  const c = q.car, h = player.h; c.doors[0].target = 0;
  if (q.type === 'enter') {
    if (c.driver === h) { c.body.remove(h.group); scene.add(h.group); c.driver = null; }
    if (c.mode === 'held') c.mode = 'abandoned';
  }
  h.group.visible = true;
}
function exitCar(force = false) {
  const c = player.car; if (!c) return;
  if (force) {
    c.body.remove(player.h.group); scene.add(player.h.group);
    const [x, z] = doorPoint(c); const r = resolveCircle(x, z, 0.4); player.x = r.x; player.z = r.z; player.yaw = c.yaw;
    c.mode = c.health > 0 ? 'abandoned' : 'wreck'; c.driver = null; player.car = null; return;
  }
  if (seq) return;
  if (Math.hypot(c.vx, c.vz) > 6) { notice('Erst langsamer fahren', 900); return; }
  seq = { type: 'exit', car: c, t: 0, phase: 'open' }; c.doors[0].target = 1; sfx.door();
}
function updateSeq(dt) {
  const q = seq, c = q.car, h = player.h; q.t += dt;
  const [dx, dz] = doorPoint(c), [slx, sly, slz] = seatLocal(c);
  const seatW = () => { const [x, z] = carLocal(c, slx, slz); return [x, c.y + sly, z]; };
  if (q.type === 'enter') {
    if (q.phase === 'walk') {
      const vx = dx - player.x, vz = dz - player.z, d = Math.hypot(vx, vz);
      if (d > 0.15 && q.t < 3) { const st = Math.min(d, 3.2 * dt); player.x += vx / d * st; player.z += vz / d * st; player.yaw += angDiff(player.yaw, Math.atan2(vx, vz)) * Math.min(1, dt * 10); animHuman(h, 3.2, dt); }
      else { q.phase = 'open'; q.t = 0; c.doors[0].target = 1; sfx.door(); }
    } else if (q.phase === 'open') {
      player.yaw += angDiff(player.yaw, c.yaw - Math.PI / 2) * Math.min(1, dt * 8); animHuman(h, 0, dt);
      if (q.t > 0.45) {
        if (c.driver && c.driver !== h) {
          const victim = takeDriver(c), p = adoptPed(victim, dx + Math.sin(c.yaw) * 1.2, dz + Math.cos(c.yaw) * 1.2, c.yaw);
          p.state = 'free'; p.t = 6; scarePeds(c.x, c.z, 20); say(pick(LINES.carjack), { who: 'Fahrer', voice: p.voice, rate: p.vrate, h: p.h, prio: true });
          reportCrime('carjack', c.x, c.z, 1);
        }
        q.phase = 'sit'; q.t = 0; q.from = [player.x, player.y, player.z];
      }
    } else if (q.phase === 'sit') {
      const k = Math.min(1, q.t / 0.6), [sx, sy, sz] = seatW();
      player.x = lerp(q.from[0], sx, k); player.z = lerp(q.from[2], sz, k); player.y = lerp(q.from[1], sy, k);
      player.yaw += angDiff(player.yaw, c.yaw) * Math.min(1, dt * 6); animHuman(h, 0, dt, false, k > 0.5 ? 'sit' : null);
      if (k >= 1) { setDriver(c, h); q.phase = 'close'; q.t = 0; c.doors[0].target = 0; }
    } else if (q.t > 0.4) { player.car = c; c.mode = 'player'; c.vx = c.vz = 0; c.speedF = 0; seq = null; sfx.door(); }
    if (q.phase !== 'close') { h.group.position.set(player.x, player.y, player.z); h.group.rotation.set(0, player.yaw, 0); }
    else animHuman(h, 0, dt, false, 'drive');
  } else {
    if (q.phase === 'open') { animHuman(h, 0, dt, false, 'drive'); if (q.t > 0.45) { q.phase = 'out'; q.t = 0; c.body.remove(h.group); scene.add(h.group); c.driver = null; const [sx, sy, sz] = seatW(); q.from = [sx, sy, sz]; player.yaw = c.yaw - Math.PI / 2; } }
    else if (q.phase === 'out') {
      const k = Math.min(1, q.t / 0.6), r = resolveCircle(dx, dz, 0.4);
      player.x = lerp(q.from[0], r.x, k); player.z = lerp(q.from[2], r.z, k); player.y = lerp(q.from[1], groundH(r.x, r.z), k);
      animHuman(h, 0, dt, false, k < 0.5 ? 'sit' : null); h.group.position.set(player.x, player.y, player.z); h.group.rotation.set(0, player.yaw, 0);
      if (k >= 1) { q.phase = 'close'; q.t = 0; c.doors[0].target = 0; player.car = null; c.mode = c.health > 0 ? 'abandoned' : 'wreck'; }
    } else { animHuman(h, 0, dt); if (q.t > 0.4) { seq = null; sfx.door(); } }
  }
}

// ---------- Menüs, Bezahlen, Bank, Hotel ----------
let uiMenu = null, uiMenuPos = null;
function closeMenu() { uiMenu = null; uiMenuPos = null; $('elev').style.display = 'none'; }
function openMenu(title, items) { uiMenuPos = [player.x, player.z]; uiMenu = { title, items, sel: items.findIndex(i => i.act), pose: title.startsWith('Geldautomat') ? 'atm' : null }; renderMenu(); $('elev').style.display = 'block'; sfx.click(); }
function renderMenu() { const m = uiMenu; $('elev').innerHTML = `<div class="et">${m.title}</div>` + m.items.map((it, k) => `<div class="ef${k === m.sel ? ' sel' : ''}${it.act ? '' : ' cur'}">${it.label}</div>`).join('') + '<div class="eh">W/S wählen · E bestätigen · F schließen</div>'; }
function menuKey(code) {
  const m = uiMenu, n = m.items.length, step = d => { let k = m.sel; do { k = (k + d + n) % n; } while (!m.items[k].act && k !== m.sel); m.sel = k; };
  if (code === 'KeyW' || code === 'ArrowUp') step(-1); else if (code === 'KeyS' || code === 'ArrowDown') step(1);
  else if (code === 'KeyF' || code === 'Backspace' || code === 'Escape') { closeMenu(); return; }
  else if (code === 'KeyE' || code === 'Enter') { const it = m.items[m.sel]; if (it?.act) { const keep = it.act(); if (!keep) { closeMenu(); return; } } }
  renderMenu();
}
const fmt = v => '$' + Math.floor(v).toLocaleString('en-US');
function pay(amount, method) {
  if (method === 'card') { if ((player.bank || 0) < amount) { notice('Karte abgelehnt – Kontostand zu niedrig', 1800); return false; } player.bank -= amount; }
  else { if (player.money < amount) { notice('Nicht genug Bargeld', 1800); return false; } player.money -= amount; }
  sfx.coin(); return true;
}
function bankMenu(where) {
  if (where.startsWith('Geldautomat')) faceATM();
  const mv = (amt, dir) => () => { const a = amt === 'all' ? (dir > 0 ? player.money : player.bank) : amt; if (dir > 0) { if (player.money < a || a <= 0) { notice('Nicht genug Bargeld', 1400); return true; } player.money -= a; player.bank += a; notice(`Eingezahlt: ${fmt(a)}`, 1400); holdItem('cash', '#4a8a3a', 0.8); } else { if (player.bank < a || a <= 0) { notice('Kontostand zu niedrig', 1400); return true; } player.bank -= a; player.money += a; notice(`Abgehoben: ${fmt(a)}`, 1400); setTimeout(() => holdItem('cash', '#4a8a3a', 1.6), 700); sfx.click(); } sfx.coin(); bankMenu(where); return true; };
  openMenu(where, [{ label: `Konto: ${fmt(player.bank)} · Bargeld: ${fmt(player.money)}` }, { label: 'Abheben 100 $', act: mv(100, -1) }, { label: 'Abheben 500 $', act: mv(500, -1) }, { label: 'Abheben 2.000 $', act: mv(2000, -1) }, { label: 'Einzahlen 500 $', act: mv(500, 1) }, { label: 'Alles Bargeld einzahlen', act: mv('all', 1) }, { label: 'Schließen', act: () => false }]);
}
const HOTEL_PRICE = 180;
function hotelMenu() {
  const b = INT.b, book = method => () => {
    if (!pay(HOTEL_PRICE, method)) return true;
    const fl = rint(1, Math.min(b.floors - 1, 9)), room = rint(0, 5);
    player.hotel = { seed: b.seed, x: b.x, z: b.z, floor: fl, room, name: floorName(b, 0) };
    notice(`Zimmer ${fl}.${String(room + 1).padStart(2, '0')} gebucht · ${fl}. Stock`, 3500);
    say('Ihr Zimmer ist bereit. Die Aufzüge sind direkt hinter mir. Angenehmen Aufenthalt!', { who: 'Rezeption', voice: 'kerstin', prio: true });
    for (const F of INT.floors.values()) if (F.f === fl) { unloadFloor(F); } syncFloors(); return false;
  };
  openMenu(floorName(b, 0), [{ label: `Zimmer, 1 Nacht – ${fmt(HOTEL_PRICE)}` }, { label: 'Mit Karte bezahlen', act: book('card') }, { label: 'Bar bezahlen', act: book('cash') }, { label: 'Schließen', act: () => false }]);
}
const ATMS = [];
const ITEMS = {
  wasser: { n: 'Wasser', p: 2, hp: 8, ico: '💧' }, cola: { n: 'eCola', p: 3, hp: 10, ico: '🥤' }, sprunk: { n: 'Sprunk', p: 3, hp: 10, ico: '🥤' },
  sandwich: { n: 'Sandwich', p: 7, hp: 25, ico: '🥪' }, burger: { n: 'Burger', p: 9, hp: 35, ico: '🍔' }, chips: { n: 'Chips', p: 3, hp: 6, ico: '🍟' },
  schoko: { n: 'Schokoriegel', p: 2, hp: 5, ico: '🍫' }, bier: { n: 'Pißwasser Bier', p: 4, hp: 3, ico: '🍺' }, kippen: { n: 'Zigaretten', p: 9, smoke: true, ico: '🚬' },
  medkit: { n: 'Erste-Hilfe-Set', p: 60, hp: 100, ico: '🩹' }, weste: { n: 'Schutzweste', p: 250, armor: 100, ico: '🦺' }, zeitung: { n: 'Zeitung', p: 1, read: true, ico: '📰' },
};
const SHOP_STOCK = { market: ['wasser', 'cola', 'sprunk', 'sandwich', 'chips', 'schoko', 'bier', 'medkit'], gas: ['wasser', 'cola', 'sprunk', 'burger', 'chips', 'schoko', 'kippen', 'zeitung'], shop: ['wasser', 'cola', 'schoko', 'chips', 'kippen', 'zeitung', 'weste'] };
const HEADLINES = ['Los Santos Tagblatt: Vinewood-Star in Entzugsklinik gesichtet', 'Weazel News: Bürgermeister verspricht weniger Schlaglöcher', 'LS Tagblatt: Rekordhitze – Sprunk-Verkäufe verdoppelt', 'Polizei sucht Zeugen nach wilder Verfolgungsjagd', 'Lifeinvader-Aktie stürzt nach Datenleck ab'];
function keepMenuSel(fn) { const s0 = uiMenu?.sel; fn(); if (uiMenu && s0 != null && uiMenu.items[s0]?.act) uiMenu.sel = s0; renderMenu(); }
let shopClerk = null;
function shopFx(k) {
  const n = shopClerk; if (n && n.state !== 'dead') { n.pose = 'cook'; n.wait = 2; }
  sfx.click(); setTimeout(() => sfx.liftBeep(), 400);
  if (n && n.F) { const it = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: pick(['#c4161c', '#2fbf4a', '#f2c200', '#3a6ad0', '#ffffff']) })); const [lx, lz] = toLocal(player.x, player.z); it.position.set((n.x + lx) / 2, 1.18, (n.z + lz) / 2); n.F.group.add(it); setTimeout(() => { n.F.group.remove(it); it.geometry.dispose(); holdItem('bag', '#c8a46a', 6); }, 1300); }
}
function shopMenu(kind) {
  const pm = player.payPref || 'cash', inv = player.inv ||= {};
  keepMenuSel(() => openMenu(INT.company || floorName(INT.b, 0).replace('EG · ', ''), [
    { label: `Bargeld ${fmt(player.money)} · Konto ${fmt(player.bank || 0)}` },
    ...SHOP_STOCK[kind].map(k => ({ label: `${ITEMS[k].ico} ${ITEMS[k].n} – ${fmt(ITEMS[k].p)}${inv[k] ? ` <small>· ${inv[k]} dabei</small>` : ''}`, act: () => { if (pay(ITEMS[k].p, pm)) { inv[k] = (inv[k] || 0) + 1; notice(`${ITEMS[k].n} gekauft`, 1100); shopFx(k); } shopMenu(kind); return true; } })),
    { label: `Zahlung: ${pm === 'card' ? '💳 Karte' : '💵 Bar'}`, act: () => { player.payPref = pm === 'card' ? 'cash' : 'card'; shopMenu(kind); return true; } },
    { label: 'Fertig', act: () => false },
  ]));
}
function useItem(k) {
  const it = ITEMS[k], inv = player.inv; if (!inv?.[k]) return;
  inv[k]--; if (!inv[k]) delete inv[k];
  if (it.hp) player.hp = Math.min(100, player.hp + it.hp);
  if (it.armor) player.armor = Math.max(player.armor, it.armor);
  if (it.read) notice(pick(HEADLINES), 4000);
  player.act = { pose: it.smoke ? 'smoke' : it.read ? 'browse' : it.armor ? null : 'smoke', t: it.smoke ? 7 : it.read ? 3 : 1.6 };
  notice(it.hp ? `${it.n} · +${Math.min(it.hp, 100)} Gesundheit` : it.armor ? 'Schutzweste angelegt' : it.smoke ? 'Zigarette angezündet' : it.n, 1500);
  sfx.click();
}
function invMenu() {
  const inv = player.inv || {}, keys0 = Object.keys(inv).filter(k => inv[k] > 0);
  if (!keys0.length) { notice('Inventar leer – in Läden und Tankstellen einkaufen', 1800); return; }
  keepMenuSel(() => openMenu('Inventar', [...keys0.map(k => ({ label: `${ITEMS[k].ico} ${ITEMS[k].n} ×${inv[k]} – benutzen`, act: () => { useItem(k); if (Object.keys(player.inv || {}).length) invMenu(); return !!Object.keys(player.inv || {}).length; } })), { label: 'Schließen', act: () => false }]));
}
let stealCd = 0;
function nearShelf() { const Fc = INT.floors.get(curFloorOf(player.y)); if (!Fc || !['shop', 'market', 'gas'].includes(Fc.kind)) return null; const [lx, lz] = toLocal(player.x, player.z); return Fc.spots.find(sp => sp.type === 'shelf' && Math.hypot(sp.x - lx, sp.z - lz) < 1.6) ? Fc : null; }
function shoplift() {
  const Fc = nearShelf(); if (!Fc || performance.now() < stealCd) return; stealCd = performance.now() + 1500;
  const k = pick(SHOP_STOCK[Fc.kind].filter(q => ITEMS[q].p < 100)); (player.inv ||= {})[k] = (player.inv[k] || 0) + 1; player.act = { pose: 'pickup', t: 0.7 }; setTimeout(() => holdItem('item', pick(['#c4161c', '#2fbf4a', '#f2c200']), 1.2), 500);
  const [lx, lz] = toLocal(player.x, player.z), clerk = Fc.npcs.find(n => n.role === 'cashier' && n.state !== 'dead');
  if (clerk && Math.hypot(clerk.x - lx, clerk.z - lz) < 18 && Math.random() < 0.75) {
    notice(`${ITEMS[k].n} geklaut – der Kassierer hat es gesehen!`, 2200);
    say(pick(LINES.shoplift), { who: 'Kassierer', voice: clerk.voice, rate: clerk.vrate, h: clerk.h, prio: true });
    clerk.pose = 'phone'; clerk.wait = 12; reportCrime('theft', player.x, player.z, 1, true);
  } else notice(`${ITEMS[k].n} eingesteckt – niemand hat es gesehen`, 2000);
}
// Gegenstand in der Hand der Spielfigur (Dose, Geld, Tüte, Ware)
const HELD = { m: null, t: 0 }, litter = [];
function holdItem(kind, col, secs) {
  dropHeld(false);
  if (kind === 'bottle') { const mi = modelInstance('WaterBottle', 0.24, 'y'); if (mi) { dropHeld(false); const hand = player.h.B.RightHand, ws = hand.getWorldScale(_pv1).x || 1; mi.scale.multiplyScalar(1 / ws); mi.position.set(0, 0.06 / ws, 0.03 / ws); hand.add(mi); HELD.m = mi; HELD.t = secs; HELD.kind = 'can'; mi.geometry = { dispose() {} }; return; } kind = 'can'; }
  const geo = kind === 'can' ? new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12) : kind === 'cash' ? new THREE.BoxGeometry(0.075, 0.025, 0.155) : kind === 'bag' ? new THREE.BoxGeometry(0.26, 0.32, 0.13) : new THREE.BoxGeometry(0.09, 0.14, 0.05);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: kind === 'can' ? 0.25 : 0.7, metalness: kind === 'can' ? 0.6 : 0 }));
  const hand = player.h.B.RightHand, ws = hand.getWorldScale(_pv1).x || 1; m.scale.setScalar(1 / ws); m.position.set(0, (kind === 'bag' ? 0.2 : 0.08) / ws, 0.03 / ws); hand.add(m);
  HELD.m = m; HELD.t = secs; HELD.kind = kind;
}
function dropHeld(throwIt) {
  const m = HELD.m; if (!m) return; HELD.m = null;
  if (!throwIt) { m.parent?.remove(m); m.geometry.dispose(); return; }
  m.getWorldPosition(_pv1); m.parent.remove(m); m.scale.setScalar(m.userData.scale || 1); m.position.copy(_pv1); scene.add(m);
  litter.push({ m, vx: Math.sin(player.yaw) * 3 + rnd(-0.5, 0.5), vy: 2.5, vz: Math.cos(player.yaw) * 3 + rnd(-0.5, 0.5), t: 25, spin: rnd(6, 12) });
}
function updateHeld(dt) {
  if (HELD.m && (HELD.t -= dt) <= 0) dropHeld(HELD.kind === 'can');
  for (let i = litter.length - 1; i >= 0; i--) {
    const q = litter[i], m = q.m; q.t -= dt; q.vy -= 12 * dt; m.position.x += q.vx * dt; m.position.y += q.vy * dt; m.position.z += q.vz * dt; m.rotation.x += q.spin * dt;
    const gy = floorH(m.position.x, m.position.z, m.position.y) + 0.035;
    if (m.position.y < gy) { m.position.y = gy; q.vy *= -0.35; q.vx *= 0.6; q.vz *= 0.6; q.spin *= 0.5; if (Math.abs(q.vy) > 0.8) sfx.click(); else { q.vy = 0; m.rotation.x = Math.PI / 2; } }
    if (q.t < 0) { scene.remove(m); m.geometry.dispose(); litter.splice(i, 1); }
  }
}
function nearVend() { return VENDS.find(v => Math.hypot(v.x - player.x, v.z - player.z) < 1.3); }
function vendMenu(v) {
  player.yaw = Math.atan2(v.x - player.x, v.z - player.z) + Math.PI;
  const buy = (k, label) => () => {
    if (!(pay(1, 'cash') || pay(1, 'card'))) return true;
    const col = k === 'cola' ? '#c4161c' : k === 'sprunk' ? '#2fbf4a' : '#9ad0ff';
    player.act = { pose: 'press', t: 0.7 }; sfx.click();
    setTimeout(() => sfx.door(), 350);
    setTimeout(() => { player.act = { pose: 'pickup', t: 0.6 }; }, 900);
    setTimeout(() => { holdItem(k === 'wasser' ? 'bottle' : 'can', col, 3.4); player.act = { pose: 'smoke', t: 2.6 }; }, 1500);
    setTimeout(() => { player.hp = Math.min(100, player.hp + 10); notice(`${label} · +10 Gesundheit`, 1300); }, 3200);
    return false;
  };
  openMenu(`Getränkeautomat · ${v.brand}`, [{ label: 'Münzen oder Karte · je $1' }, { label: `🥤 ${v.brand} – $1`, act: buy(v.brand === 'eCola' ? 'cola' : 'sprunk', v.brand) }, { label: '💧 Wasser – $1', act: buy('wasser', 'Wasser') }, { label: 'Schließen', act: () => false }]);
}
function nearATM() { return ATMS.find(a => Math.hypot(a.x - player.x, a.z - player.z) < 1.6); }
function faceATM() { const a = nearATM(); if (a && a.bx !== undefined) player.yaw = Math.atan2(a.bx - player.x, a.bz - player.z); }

// ---------- LS Ride: Taxi & Chauffeur (wie Uber) ----------
const RIDE = {
  taxi: { name: 'Taxi', car: ['sedan', TAXI_COLOR], base: 5, perM: 0.022, who: 'Taxifahrer', voice: 'karlsson', rate: 1.08, sp: 15 },
  chauffeur: { name: 'Chauffeur', car: ['limo', '#121315'], base: 60, perM: 0.07, who: 'Chauffeur', voice: 'pavoque', rate: 0.94, sp: 12 },
};
const CHAUFFEUR_LOOK = { gender: 'm', skin: '#b8876a', shirt: '#15161a', pants: '#15161a', shoes: '#0a0a0a', hair: '#120c08', beard: 0.1, hairStyle: 'slick', hat: '#111111' };
let ride = null;
const paxLocal = c => [-0.4, 0.04, c.T.L / 2 - 1.95];
const syncPH = () => { player.h.group.position.set(player.x, player.y, player.z); player.h.group.rotation.set(0, player.yaw, 0); };
// Bordstein-Haltepunkt an der nächsten Straße (nicht auf Kreuzungen, nicht hinter geparkten Autos)
function curbPoint(x, z) {
  const kx = clamp(Math.round(x / P + N / 2), 0, N), kz = clamp(Math.round(z / P + N / 2), 0, N), rx = roadPos(kx), rz = roadPos(kz);
  const off = a => { const c = roadPos(clamp(Math.round(a / P + N / 2), 0, N)), m = R / 2 + 7; return Math.abs(a - c) < m ? c + (Math.sign(a - c) || 1) * m : a; };
  const alongZ = Math.abs(x - rx) < Math.abs(z - rz), s0 = Math.sign(alongZ ? x - rx : z - rz) || 1;
  for (const sh of [0, 10, -10, 20, -20]) {
    const q = alongZ ? { x: rx + s0 * PARK, z: off(z + sh), yaw: dirYaw(s0 > 0 ? 0 : 2) } : { x: off(x + sh), z: rz + s0 * PARK, yaw: dirYaw(s0 > 0 ? 1 : 3) };
    if (!cars.some(c => c !== ride?.car && Math.hypot(c.x - q.x, c.z - q.z) < 6.5)) return q;
  }
  return alongZ ? { x: rx + s0 * PARK, z: off(z), yaw: dirYaw(s0 > 0 ? 0 : 2) } : { x: off(x), z: rz + s0 * PARK, yaw: dirYaw(s0 > 0 ? 1 : 3) };
}
// Fahren über das Straßenraster (rechte Spur), Abstand halten, bei Blockade zurücksetzen
function rideDrive(c, tx, tz, dt, maxSp, exact) {
  const dd = Math.hypot(tx - c.x, tz - c.z), fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;
  let wx = tx, wz = tz;
  // Ziel liegt an einer Straße: direkt anfahren nur, wenn das Auto schon auf derselben Straße ist (keine Abkürzung durch Häuser)
  const rx0 = roadPos(clamp(Math.round(tx / P + N / 2), 0, N)), rz0 = roadPos(clamp(Math.round(tz / P + N / 2), 0, N)), vert = Math.abs(tx - rx0) < Math.abs(tz - rz0);
  const onLine = vert ? Math.abs(c.x - rx0) < 9 : Math.abs(c.z - rz0) < 9;
  exact = exact && onLine && dd < 60;
  if (!exact) {
    [wx, wz] = roadWaypoint(c, tx, tz);
    if (wx === tx && wz === tz) { if (vert) { wx = rx0; wz = roadPos(clamp(Math.round(c.z / P + N / 2), 0, N)); } else { wz = rz0; wx = roadPos(clamp(Math.round(c.x / P + N / 2), 0, N)); } }
    const hx = wx - c.x, hz = wz - c.z, hl = Math.hypot(hx, hz) || 1; if (hl > 6) { wx += -hz / hl * LANE; wz += hx / hl * LANE; }
  }
  // Watchdog: kein Fortschritt -> zurück auf die Fahrspur setzen
  if (!c.rideWd || c.rideWd.tx !== tx || c.rideWd.tz !== tz || dd < c.rideWd.best - 3) c.rideWd = { tx, tz, best: dd, t: 0 };
  else if ((c.rideWd.t += dt) > 7) { snapToLane(c, wx, wz); c.rideWd = null; }
  const vf = c.vx * fx + c.vz * fz, diff = angDiff(c.yaw, Math.atan2(wx - c.x, wz - c.z));
  let tgt = exact && dd < 40 ? Math.min(maxSp, Math.max(0, dd - 0.5) * 0.7) : maxSp;
  if (Math.abs(diff) > 0.35) tgt = Math.min(tgt, 7);
  if (!(c.rideGhost > 0)) {
    for (const o of cars) { if (o === c) continue; const ox = o.x - c.x, oz = o.z - c.z, ah = ox * fx + oz * fz; if (ah > 0 && ah < 14 && Math.abs(ox * rx + oz * rz) < 2.2) tgt = Math.min(tgt, Math.max(0, (ah - 6) * 0.9)); }
    for (const q of peds) { if (q.state === 'dead') continue; const ox = q.x - c.x, oz = q.z - c.z, ah = ox * fx + oz * fz; if (ah > 0 && ah < 10 && Math.abs(ox * rx + oz * rz) < 1.6) tgt = Math.min(tgt, Math.max(0, ah - 3.5)); }
    if (!player.ride && !player.car) { const ox = player.x - c.x, oz = player.z - c.z, ah = ox * fx + oz * fz; if (ah > 0 && ah < 9 && Math.abs(ox * rx + oz * rz) < 1.6) tgt = 0; }
  } else c.rideGhost -= dt;
  const want = exact && dd < 2 ? 0 : 1;
  c.rideBlock = tgt < 0.5 && want ? (c.rideBlock || 0) + dt : 0;
  if (c.rideBlock > 6) { c.rideGhost = 3; c.rideBlock = 0; }
  c.rideStuck = Math.abs(vf) < 0.6 && tgt > 2 ? (c.rideStuck || 0) + dt : 0;
  if (c.rideStuck > 2.5) { c.rideRev = 1.3; c.rideStuck = 0; }
  let thr = clamp((tgt - vf) * 0.35, -1, 1), steer = clamp(diff * 2.2, -1, 1);
  if (Math.abs(diff) > 2.2 && dd > 4) { thr = -0.6; steer = -steer; }
  if (c.rideRev > 0) { c.rideRev -= dt; thr = -0.7; steer = -steer; }
  driveCar(c, thr, steer, tgt < 0.3 && Math.abs(vf) < 1.5, dt);
  if (c.driver && c.driver !== player.h) animHuman(c.driver, 0, dt, false, 'drive');
  return dd;
}
function snapToLane(c, wx, wz) {
  const kx = clamp(Math.round(c.x / P + N / 2), 0, N), kz = clamp(Math.round(c.z / P + N / 2), 0, N), ex = Math.abs(c.x - roadPos(kx)), ez = Math.abs(c.z - roadPos(kz));
  const ang = Math.atan2(wx - c.x, wz - c.z);
  if (ex < ez) { const d = Math.cos(ang) < 0 ? 0 : 2; c.x = laneFor(d, kx); c.yaw = dirYaw(d); } else { const d = Math.sin(ang) > 0 ? 1 : 3; c.z = laneFor(d, kz); c.yaw = dirYaw(d); }
  c.vx = c.vz = 0; c.av = 0; c.rideRev = 0; c.rideStuck = 0;
}
// kleine Ablaufsteuerung: jeder Schritt läuft, bis er true liefert
const wait = sec => { let t = 0; return dt => (t += dt) >= sec; };
const once = f => () => (f(), true);
function walkHuman(hf, pts, sp = 1.5) {
  let i = 0;
  return dt => {
    if (i >= pts.length) return true;
    const h = typeof hf === 'function' ? hf() : hf, g = h.group.position, [tx, tz] = pts[i](), dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz);
    if (d < 0.12) { i++; return i >= pts.length; }
    const st = Math.min(d, sp * dt); g.x += dx / d * st; g.z += dz / d * st; g.y = groundH(g.x, g.z);
    h.group.rotation.y += angDiff(h.group.rotation.y, Math.atan2(dx, dz)) * Math.min(1, dt * 8); animHuman(h, sp, dt); return false;
  };
}
const faceStep = (hf, ang) => { let t = 0; return dt => { const h = hf(); h.group.rotation.y += angDiff(h.group.rotation.y, ang()) * Math.min(1, dt * 8); animHuman(h, 0, dt); return (t += dt) > 0.35; }; };
const rideSay = (k, line) => say(line, { who: RIDE[k].who, voice: RIDE[k].voice, rate: RIDE[k].rate, h: ride?.ch || ride?.drv, prio: true, color: '#f2c200' });
// Chauffeur: aussteigen, ums Auto herum zur Beifahrertür, Tür aufhalten
function chauffeurToDoor(c) {
  const W = c.T.W, L = c.T.L, zh = L / 2 - 1.25, P0 = (lx, lz) => () => carLocal(c, lx, lz);
  return [
    once(() => { c.doors[0].target = 1; sfx.door(); }), wait(0.5),
    once(() => { ride.ch = takeDriver(c); }), wait(0.3), once(() => { c.doors[0].target = 0; }),
    walkHuman(() => ride.ch, [P0(W / 2 + 0.9, L / 2 + 0.8), P0(-(W / 2 + 0.9), L / 2 + 0.8), P0(-(W / 2 + 1.3), zh + 0.35)]),
    faceStep(() => ride.ch, () => c.yaw + Math.PI), once(() => { c.doors[1].target = 1; sfx.door(); }), wait(0.5),
    faceStep(() => ride.ch, () => Math.atan2(player.x - ride.ch.group.position.x, player.z - ride.ch.group.position.z)),
  ];
}
function chauffeurBack(c) {
  const W = c.T.W, L = c.T.L, P0 = (lx, lz) => () => carLocal(c, lx, lz);
  return [
    once(() => { c.doors[1].target = 0; sfx.door(); }), wait(0.4),
    walkHuman(() => ride.ch, [P0(-(W / 2 + 0.9), L / 2 + 0.8), P0(W / 2 + 0.9, L / 2 + 0.8), () => doorPoint(c, 1)]),
    once(() => { c.doors[0].target = 1; sfx.door(); }), wait(0.45),
    once(() => { setDriver(c, ride.ch); ride.ch = null; }), wait(0.3), once(() => { c.doors[0].target = 0; sfx.door(); }), wait(0.4),
  ];
}
function playerWalkTo(pt) {
  let t = 0;
  return dt => {
    t += dt; const [tx, tz] = pt(), vx = tx - player.x, vz = tz - player.z, d = Math.hypot(vx, vz);
    if (d < 0.15 || t > 4) return true;
    const st = Math.min(d, 3 * dt); player.x += vx / d * st; player.z += vz / d * st;
    player.yaw += angDiff(player.yaw, Math.atan2(vx, vz)) * Math.min(1, dt * 10); animHuman(player.h, 3, dt); syncPH(); return false;
  };
}
function playerSit(c) {
  let t = 0, from = null;
  return dt => {
    from ||= [player.x, player.y, player.z]; t += dt;
    const k = Math.min(1, t / 0.6), [lx, ly, lz] = paxLocal(c), [sx, sz] = carLocal(c, lx, lz);
    player.x = lerp(from[0], sx, k); player.z = lerp(from[2], sz, k); player.y = lerp(from[1], c.y + ly, k);
    player.yaw += angDiff(player.yaw, c.yaw) * Math.min(1, dt * 6); animHuman(player.h, 0, dt, false, k > 0.5 ? 'sit' : null); syncPH();
    if (k < 1) return false;
    c.body.add(player.h.group); player.h.group.position.set(lx, ly, lz); player.h.group.rotation.set(0, 0, 0); setHumanShadow(player.h, false); player.rideSeat = true; return true;
  };
}
function playerOut(c) {
  let t = 0, from = null;
  return dt => {
    if (!from) {
      const [lx, ly, lz] = paxLocal(c), [sx, sz] = carLocal(c, lx, lz);
      c.body.remove(player.h.group); scene.add(player.h.group); setHumanShadow(player.h, true); player.rideSeat = false;
      from = [sx, c.y + ly, sz]; player.yaw = c.yaw - Math.PI / 2;
    }
    t += dt; const k = Math.min(1, t / 0.6), [dx, dz] = doorPoint(c, -1), q = resolveCircle(dx, dz, 0.4);
    player.x = lerp(from[0], q.x, k); player.z = lerp(from[2], q.z, k); player.y = lerp(from[1], groundH(q.x, q.z), k);
    animHuman(player.h, 0, dt, false, k < 0.5 ? 'sit' : null); syncPH();
    if (k < 1) return false;
    player.ride = false; return true;
  };
}
function requestRide(kind, payM = 'card') {
  if (ride) { notice('Es ist bereits eine Fahrt aktiv', 1500); return false; }
  if (player.jail) { notice('Im Gefängnis gibt es kein LS Ride', 1500); return false; }
  if (wanted > 0) { notice('LS Ride: Keine Fahrer verfügbar – du wirst gesucht', 2000); return false; }
  if (player.car) { notice('Steig zuerst aus dem Fahrzeug aus', 1600); return false; }
  const R0 = RIDE[kind], from = INT.inside && INT.b?.door ? INT.b.door : player, cp = curbPoint(from.x, from.z);
  let rp = null; for (let t = 0; t < 6 && !rp; t++) rp = roadPoint(130, 220);
  rp ||= roadPoint(70, 130); if (!rp) { notice('LS Ride: Gerade kein Fahrer in der Nähe', 1800); return false; }
  const c = makeCar(R0.car[0], R0.car[1], rp.x, rp.z, dirYaw(rp.dir), 'service'); c.keep = true;
  if (kind === 'taxi') addTaxiSign(c);
  const look = kind === 'taxi' ? { ...pedLook(), gender: 'm', skin: pick(SKIN_T), shirt: pick(CLOTH), pants: pick(PANTS), shoes: '#3a3a3a', hair: pick(HAIR), beard: Math.random(), hairStyle: pick(['buzz', 'slick', 'bald']), hat: null } : CHAUFFEUR_LOOK;
  const h = makeHuman(look); setDriver(c, h);
  ride = { kind, car: c, drv: h, ch: null, state: 'coming', pay: payM, fare: 0, odo: 0, curb: cp, steps: [], t: 0, uiT: 0 };
  notice(kind === 'taxi' ? 'Dein Taxi ist unterwegs' : 'Der Chauffeur ist unterwegs', 2600); sfx.ding();
  return true;
}
function rideEstimate(k) { const p = player, w = waypoint; return RIDE[k].base + (w ? (Math.abs(w.x - p.x) + Math.abs(w.z - p.z)) * RIDE[k].perM : 0); }
function rideETA() { const c = ride.car, q = ride.curb; return Math.max(3, Math.round((Math.abs(c.x - q.x) + Math.abs(c.z - q.z)) / 9)); }
function cancelRide() {
  if (!ride) return;
  if (ride.state === 'boarding' || ride.state === 'riding' || ride.state === 'arrived') { notice('Du sitzt bereits im Wagen – F: hier aussteigen', 1800); return; }
  notice('Fahrt storniert', 1400);
  const c = ride.car; ride.steps = ride.ch ? chauffeurBack(c) : []; ride.steps.push(once(() => { ride.state = 'leaving'; }));
  ride.state = 'cancel';
}
function boardRide() {
  const c = ride.car; player.ride = true; player.rideSeat = false; ride.state = 'boarding';
  ride.steps = [playerWalkTo(() => doorPoint(c, -1)), dt => { player.yaw += angDiff(player.yaw, c.yaw + Math.PI / 2) * Math.min(1, dt * 8); animHuman(player.h, 0, dt); syncPH(); return Math.abs(angDiff(player.yaw, c.yaw + Math.PI / 2)) < 0.2; }];
  if (ride.kind === 'taxi') ride.steps.push(once(() => { c.doors[1].target = 1; sfx.door(); }), wait(0.45));
  ride.steps.push(playerSit(c));
  if (ride.kind === 'chauffeur') ride.steps.push(...chauffeurBack(c));
  else ride.steps.push(once(() => { c.doors[1].target = 0; sfx.door(); }), wait(0.3));
  ride.steps.push(once(() => {
    ride.state = 'riding';
    rideSay(ride.kind, waypoint ? pick(LINES.ride.go) : pick(LINES.ride.where));
  }));
}
function rideStopHere() {
  const c = ride.car; ride.dest = curbPoint(c.x + Math.sin(c.yaw) * 22, c.z + Math.cos(c.yaw) * 22); ride.stopReq = true;
  rideSay(ride.kind, pick(LINES.ride.stop));
}
function skipRide() {
  const c = ride.car, q = ride.dest; if (!q || ride.skipping) return;
  ride.skipping = true; fade(true);
  setTimeout(() => {
    if (!ride || ride.car !== c) return;
    ride.odo += (Math.abs(q.x - c.x) + Math.abs(q.z - c.z)); gameMin = (gameMin + 10) % 1440;
    c.x = q.x; c.z = q.z; c.yaw = q.yaw; c.vx = c.vz = 0; syncCar(c); player.x = c.x; player.z = c.z;
    ride.skipping = false; fade(false);
  }, 800);
}
function settleRide() {
  const R0 = RIDE[ride.kind], total = Math.ceil(ride.fare), other = ride.pay === 'card' ? 'cash' : 'card';
  const can = m => (m === 'card' ? (player.bank || 0) : player.money) >= total, method = can(ride.pay) ? ride.pay : can(other) ? other : null;
  if (method && pay(total, method)) notice(`Fahrt bezahlt: ${fmt(total)} (${method === 'card' ? 'Karte' : 'Bar'})`, 2600);
  else { rideSay(ride.kind, pick(LINES.ride.noPay)); addWanted(1); return; }
  rideSay(ride.kind, pick(LINES.ride.bye));
}
function alightRide() {
  const c = ride.car; ride.state = 'arrived';
  ride.steps = [wait(0.6), once(settleRide), wait(1.2)];
  if (ride.kind === 'chauffeur') ride.steps.push(...chauffeurToDoor(c).slice(0, -1));
  else ride.steps.push(once(() => { c.doors[1].target = 1; sfx.door(); }), wait(0.45));
  ride.steps.push(playerOut(c));
  if (ride.kind === 'chauffeur') ride.steps.push(...chauffeurBack(c)); else ride.steps.push(wait(0.3), once(() => { c.doors[1].target = 0; sfx.door(); }), wait(0.8));
  ride.steps.push(once(() => { ride.state = 'leaving'; }));
}
function updateRide(dt) {
  if (!ride) return;
  const c = ride.car; ride.t += dt;
  if (!cars.includes(c) || c.mode === 'wreck') { if (player.rideSeat) { c.body.remove(player.h.group); scene.add(player.h.group); setHumanShadow(player.h, true); } player.ride = player.rideSeat = false; if (ride.ch) { scene.remove(ride.ch.group); disposeHuman(ride.ch); } ride = null; return; }
  if (player.dead && (player.ride || ride.state !== 'leaving')) {
    if (player.h.group.parent === c.body) { c.body.remove(player.h.group); scene.add(player.h.group); setHumanShadow(player.h, true); player.h.group.position.set(player.x, player.y, player.z); }
    player.ride = player.rideSeat = false; if (ride.ch) { setDriver(c, ride.ch); ride.ch = null; }
    for (const d of c.doors) d.target = 0; ride.steps = []; ride.state = 'leaving';
  }
  while (ride.steps.length) { if (!ride.steps[0](dt)) break; ride.steps.shift(); dt = 0; if (!ride) return; }
  dt = ride.dtLast = dt || ride.dtLast || 0.016;
  if (ride.ch && !ride.steps.length) { const g = ride.ch.group; g.rotation.y += angDiff(g.rotation.y, Math.atan2(player.x - g.position.x, player.z - g.position.z)) * Math.min(1, dt * 4); animHuman(ride.ch, 0, dt, false, null); }
  const R0 = RIDE[ride.kind];
  if (ride.state === 'coming') {
    const dd = rideDrive(c, ride.curb.x, ride.curb.z, dt, R0.sp, true);
    if (dd < 1.6 && Math.hypot(c.vx, c.vz) < 1) {
      c.vx = c.vz = 0; ride.state = 'arriving'; notice(`${R0.name} ist angekommen`, 2200); sfx.ding();
      ride.steps = ride.kind === 'chauffeur' ? [...chauffeurToDoor(c), once(() => rideSay('chauffeur', pick(LINES.ride.chauffeur)))] : [once(() => { sfx.horn(c.x, c.z, 0.7); rideSay('taxi', pick(LINES.ride.taxi)); })];
      ride.steps.push(once(() => { ride.state = 'waiting'; }));
    }
  } else if (ride.state === 'riding') {
    if (waypoint && !ride.stopReq && (!ride.wp || ride.wp.x !== waypoint.x || ride.wp.z !== waypoint.z)) { ride.wp = { ...waypoint }; ride.dest = curbPoint(waypoint.x, waypoint.z); if (ride.t > 1) rideSay(ride.kind, pick(LINES.ride.go)); }
    if (!ride.dest) driveCar(c, 0, 0, true, dt);
    else if (!ride.skipping) {
      const ox = c.x, oz = c.z, dd = rideDrive(c, ride.dest.x, ride.dest.z, dt, R0.sp, true);
      ride.odo += Math.hypot(c.x - ox, c.z - oz);
      if (dd < 1.8 && Math.hypot(c.vx, c.vz) < 1) { c.vx = c.vz = 0; if (waypoint && !ride.stopReq) setWaypoint(null, null, true); alightRide(); }
    }
    ride.fare = R0.base + ride.odo * R0.perM;
  } else if (ride.state === 'leaving') {
    ride.away ||= { x: c.x + Math.sin(c.yaw) * 400, z: c.z + Math.cos(c.yaw) * 400 };
    rideDrive(c, ride.away.x, ride.away.z, dt, 13, false);
    ride.lt = (ride.lt || 0) + dt;
    if (Math.hypot(c.x - player.x, c.z - player.z) > 170 || ride.lt > 60) { if (ride.ch) { scene.remove(ride.ch.group); disposeHuman(ride.ch); } removeCar(c); ride = null; return; }
  } else if (ride.state !== 'boarding' && ride.state !== 'arrived') { c.vx *= 0.9; c.vz *= 0.9; driveCar(c, 0, 0, true, dt); }
  if (ride.state === 'riding' || ride.state === 'boarding' || ride.state === 'arrived') ride.t2 = (ride.t2 || 0) + dt;
  if (phone.open && phone.screen === 'ridestatus' && (ride.uiT -= dt) < 0) { ride.uiT = 0.25; renderPhone(); }
}
function rideStatusHTML() {
  if (!ride) return `<div class="ttl">LS Ride</div><small class="ri">Keine aktive Fahrt.</small><div class="row sel">Zurück</div>`;
  const R0 = RIDE[ride.kind], c = ride.car, st = ride.state;
  const pop = st === 'coming' ? (ride.kind === 'taxi' ? 'Dein Taxi ist unterwegs' : 'Der Chauffeur ist unterwegs') : st === 'arriving' ? `${R0.name} ist angekommen` : st === 'waiting' ? (ride.kind === 'taxi' ? 'Dein Taxi wartet – steig selbst ein (F)' : 'Dein Chauffeur hält dir die Tür auf (F)') : st === 'riding' ? (ride.dest ? 'Unterwegs zum Ziel' : 'Ziel auf der Karte (M) setzen') : st === 'arrived' ? 'Angekommen' : st === 'boarding' ? 'Einsteigen …' : 'Fahrt beendet';
  const fresh = ride.popSt !== st; setTimeout(() => { if (ride) ride.popSt = st; }, 0);
  const info = st === 'coming' ? `Ankunft in ca. ${rideETA()} s · ${Math.round(Math.hypot(c.x - player.x, c.z - player.z))} m` : st === 'riding' ? `Fahrpreis ${fmt(ride.fare)} · ${ride.pay === 'card' ? 'Karte' : 'Bar'}` : `${R0.name} · ${ride.pay === 'card' ? 'Karte' : 'Bar'}`;
  return `<div class="pop${fresh ? ' new' : ''}">🔔 ${pop}</div><canvas id="rmap" width="240" height="190"></canvas><div class="ri"><b>${R0.name}</b> · ${R0.car[0] === 'limo' ? 'Schwarze Limousine' : 'Gelbes Taxi'}<br>${info}</div>${['coming', 'arriving', 'waiting'].includes(st) ? `<div class="row sel">Fahrt stornieren</div>` : ''}`;
}
function drawRideMap() {
  const cv = $('rmap'); if (!cv || !ride) return;
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, c = ride.car, tgt = ride.state === 'riding' && ride.dest ? ride.dest : player;
  const mx = (c.x + tgt.x) / 2, mz = (c.z + tgt.z) / 2, span = Math.max(170, Math.abs(c.x - tgt.x) * 1.5, Math.abs(c.z - tgt.z) * 1.5 * W / H), sc = W / span;
  const w2s = (px, pz) => [W / 2 + (px - mx) * sc, H / 2 + (pz - mz) * sc];
  x.fillStyle = '#1a1e24'; x.fillRect(0, 0, W, H);
  if (satCanvas) { const k = satCanvas.width / (2 * SAT_HALF), sh = span * H / W; x.drawImage(satCanvas, (mx - span / 2 + SAT_HALF) * k, (mz - sh / 2 + SAT_HALF) * k, span * k, sh * k, 0, 0, W, H); }
  x.fillStyle = 'rgba(8,10,14,.25)'; x.fillRect(0, 0, W, H);
  const a = w2s(c.x, c.z), b = w2s(tgt.x, tgt.z);
  x.lineCap = 'round'; x.strokeStyle = '#0b0d10'; x.lineWidth = 7; x.beginPath(); x.moveTo(...a); x.lineTo(b[0], a[1]); x.lineTo(...b); x.stroke();
  x.strokeStyle = '#4aa3ff'; x.lineWidth = 4; x.stroke();
  const dot = (p, col, r) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(p[0], p[1], r + 2, 0, 7); x.fill(); x.fillStyle = col; x.beginPath(); x.arc(p[0], p[1], r, 0, 7); x.fill(); };
  if (tgt !== player) { const pp = w2s(player.x, player.z); dot(pp, '#4aa3ff', 4); x.fillStyle = '#ff4d6d'; x.fillRect(b[0] - 1, b[1] - 14, 2, 14); x.fillRect(b[0], b[1] - 14, 9, 6); }
  else dot(b, '#4aa3ff', 6);
  x.save(); x.translate(...a); x.rotate(Math.PI - c.yaw); x.fillStyle = ride.kind === 'taxi' ? '#f2c200' : '#111'; x.strokeStyle = '#fff'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(0, -9); x.lineTo(6, 7); x.lineTo(-6, 7); x.closePath(); x.fill(); x.stroke(); x.restore();
}
function callRide(cn) {
  phone.screen = 'call'; phone.who = cn; phone.status = 'Wählt …'; phone.busy = true; renderPhone(); sfx.ring();
  setTimeout(() => {
    phone.status = 'Verbunden'; renderPhone();
    say(pick(LINES.ride.dispatch), { who: cn.name, voice: 'ramona', prio: true, color: cn.col });
    setTimeout(() => {
      phone.busy = false;
      if (requestRide(cn.ride, phone.pay || 'card')) { phone.screen = 'ridestatus'; phone.sel = 0; } else { phone.screen = 'home'; phone.sel = 0; }
      renderPhone();
    }, 2600);
  }, 2000);
}

// ---------- Input ----------
const keys = {}; let mouseDX = 0, mouseDY = 0, lmb = false, rmb = false, lastMouse = 0;
let started = false, paused = false, showHelp = true;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!started || e.repeat) return;
  if (e.code === 'KeyF' && !player.dead && !switching && !seq && ride && !uiMenu && !phone.open) {
    if (player.ride) { if (ride.state === 'riding' && !ride.stopReq) rideStopHere(); return; }
    if (ride.state === 'waiting' && Math.hypot(...doorPoint(ride.car, -1).map((v, i) => v - (i ? player.z : player.x))) < 6) { boardRide(); return; }
  }
  if (e.code === 'Space' && player.ride && ride?.state === 'riding' && ride.dest) skipRide();
  if (e.code === 'KeyF' && !player.dead && !switching && !seq && !player.ride) player.car ? exitCar() : enterCar();
  if (e.code === 'KeyH') { showHelp = !showHelp; $('help').style.display = showHelp ? 'block' : 'none'; }
  if (e.code === 'KeyQ') { qIdx = (qIdx + 1) % QUALITY.length; qCeil = qIdx; applySize(); notice('Grafik: ' + QUALITY[qIdx][0], 1800); }
  if (e.code === 'KeyR' && player.car) sfx.radio();
  if (['F3', 'Tab', 'KeyM'].includes(e.code)) e.preventDefault();
  if (bigMap.open) { if (e.code === 'KeyM' || e.code === 'Escape') closeMap(); return; }
  if (phone.open) { phoneKey(e.code); e.preventDefault(); return; }
  if (uiMenu) { menuKey(e.code); e.preventDefault(); return; }
  if (INT.menu) { elevatorKey(e.code); e.preventDefault(); return; }
  if (e.code === 'KeyM' && !player.dead) { openMap(); return; }
  if (e.code === 'KeyP' && !phone.open) { openPhone(); return; }
  if (e.code === 'F3') { scannerOn = !scannerOn; scanT = 1.5; notice('Polizeifunk ' + (scannerOn ? 'AN – du hörst mit' : 'AUS'), 1600); sfx.squelch(); return; }
  if (e.code === 'Tab') { openWheel(); return; }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') { if (!player.car) { player.sneak = !player.sneak; notice(player.sneak ? 'Schleichen' : 'Normal', 800); } return; }
  if (e.code === 'KeyE' && !player.dead && !switching) {
    if (player.jail && jailUse()) return;
    if (INT.inside) interiorUse();
    else if (!player.car && nearATM()) bankMenu('Geldautomat · Fleeca');
    else if (!player.car && nearVend()) vendMenu(nearVend());
    else if (!useHome() && player.car) sfx.horn(player.x, player.z, 0.5);
  }
  if (e.code === 'KeyI' && !player.dead && !player.car && !player.ride && !uiMenu && !phone.open) invMenu();
  if (e.code === 'KeyG' && !player.dead && INT.inside) shoplift();
  if (e.code === 'Digit1') switchChar(0); if (e.code === 'Digit2') switchChar(1); if (e.code === 'Digit3') switchChar(2);
  if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; if (e.code === 'Tab') { closeWheel(); e.preventDefault(); } });
addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { if (wheelUI.open) { wheelMove(e.movementX, e.movementY); return; } mouseDX += e.movementX; mouseDY += e.movementY; lastMouse = performance.now(); } });
addEventListener('wheel', e => { if (started && !paused && !bigMap.open && !phone.open && !wheelUI.open) cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
let lmbEdge = false;
addEventListener('mousedown', e => { if (e.button === 0) { lmb = true; if (document.pointerLockElement === canvas) lmbEdge = true; } if (e.button === 2) rmb = true; });
addEventListener('mouseup', e => { if (e.button === 0) lmb = false; if (e.button === 2) rmb = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (!started) return;
  paused = document.pointerLockElement !== canvas && !bigMap.open;
  $('pause').style.display = paused ? 'flex' : 'none';
  sfx.setPaused(paused);
  try { paused ? speechSynthesis.pause() : speechSynthesis.resume(); } catch (e) { /* keine Sprachausgabe */ }
});
$('pause').addEventListener('click', () => canvas.requestPointerLock());

// ---------- Dialoge & Untertitel ----------
// Wiederholungsschutz: pick(LINES.x) liefert dieselbe Zeile nie direkt nochmal (Verlauf je Liste).
// extra(): optionale Zusatzzeilen (z.B. Tageszeit), die zur Liste gemischt werden.
const FRESH = Symbol('fresh');
function pickFresh(arr, hist, extra) {
  const pool = extra ? arr.concat(extra() || []) : arr;
  if (pool.length <= 1) return pool[0];
  const keep = Math.max(1, Math.min(6, Math.floor(pool.length / 3)));
  let i, n = 0;
  do { i = Math.floor(Math.random() * pool.length); } while (hist.q.includes(pool[i]) && ++n < 40);
  hist.q.push(pool[i]); while (hist.q.length > keep) hist.q.shift();
  return pool[i];
}
function freshList(arr, extra) {
  const hist = { q: [] };
  return new Proxy(arr, {
    get(t, k) {
      if (k === FRESH) return true;
      if (typeof k === 'string' && /^\d+$/.test(k)) return pickFresh(t, hist, extra);
      const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
function freshAll(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (Array.isArray(v) && !v[FRESH]) { if (v.every(x => typeof x === 'string' || (Array.isArray(x) && typeof x[0] === 'string'))) o[k] = freshList(v); else v.forEach(freshAll); }
    else if (v && typeof v === 'object' && !Array.isArray(v)) freshAll(v);
  }
}
const LINES = {
  chars: [
    { // Franklin
      hello: ['Na gut, zurück an die Arbeit.', 'Los Santos, ich bin wieder da.', 'Zeit, ein bisschen Geld zu machen, Homie.', 'Okay, ganz entspannt. Mal sehen, was heute geht.', 'Grove Street, für immer. Aber erst mal Kaffee.', 'Die Miete zahlt sich nicht von selbst.', 'Ich brauch einen Plan. Oder wenigstens einen Burger.', 'Noch ein Tag, noch ein Dollar.', 'Lamar hat bestimmt wieder eine Superidee. Na toll.', 'Heute wird nichts Dummes gemacht. Versprochen.', 'Okay, Franklin. Reiß dich zusammen und mach was draus.', 'Die Stadt schläft nie, und ich auch nicht.', 'Mal sehen, wer heute Ärger macht.', 'Ich brauche dringend mehr Geld und weniger Stress.', 'Auf geht es. Die Straße wartet nicht.', 'Moin, Los Santos. Zeig mir, was du hast.'],
      cops: ['Oh Mann, die Bullen!', 'Nicht schon wieder, Mann!', 'Ich muss hier weg!', 'Verdammt, die haben mich gesehen!', 'Das gibt Ärger, großen Ärger!', 'Bleib ruhig, Franklin, bleib ruhig.', 'Immer ich! Warum immer ich?', 'Die Cops sind echt überall hier.', 'Okay, okay, jetzt wird es heiß.', 'Ich hab meine Bewährung echt nicht für so was.', 'Los, Franklin, lauf, lauf, lauf!', 'Die kriegen mich nie, nie im Leben.', 'Ach komm, nicht in meinem Viertel!', 'Wenn die mich kriegen, bin ich erledigt.', 'Warum kann nie was einfach laufen?', 'Auf geht es, zeig denen mal, was du kannst.'] },
    { // Michael
      hello: ['Ich hätte im Ruhestand bleiben sollen.', 'Noch ein schöner Tag im Paradies.', 'Mal sehen, was die Familie wieder angestellt hat.', 'Ein Mann in meinem Alter sollte eigentlich Golf spielen.', 'Mein Therapeut sagt, ich soll mehr rausgehen. Na gut.', 'Die Kinder sind in der Schule. Zumindest hoffe ich das.', 'Was für ein Tag. Und noch nicht mal Mittag.', 'Ich brauche einen Kaffee und einen guten Anwalt.', 'Das Leben ist schön, wenn man nicht darüber nachdenkt.', 'Amanda hat bestimmt wieder neue Rechnungen.', 'Ich bin hier, ich lebe, ich bin aufgeregt. Na ja, fast.', 'Immerhin scheint die Sonne. Das ist schon was.', 'Okay, Michael, noch ein Versuch, ein normaler Mensch zu sein.', 'Früher war ich mal ein Profi. Heute bin ich ein Pool-Besitzer.', 'Die Midlife-Crisis hat wenigstens eine schöne Aussicht.', 'Also gut. Auf in den nächsten Fehler.'],
      cops: ['Ich bin zu alt für so was.', 'Ganz ruhig, Michael. Ganz ruhig.', 'Wie in alten Zeiten.', 'Na wunderbar, genau das hat noch gefehlt.', 'Das hab ich schon mal erlebt. Es endete nicht gut.', 'Die Polizei, natürlich. Wer sonst.', 'Mein Herz macht das nicht mehr lange mit.', 'Ich hasse es, wenn Leute hinter mir herrennen.', 'Das war definitiv nicht im Plan.', 'Kann man nicht ein einziges Mal in Ruhe leben?', 'Okay, das nennt man dann wohl Ruhestand.', 'Ich werde das hier bereuen, ich wette.', 'Das gibt wieder Streit mit Amanda.', 'Na los, versuchen wir es mal auf die professionelle Art.', 'Ich kenne zwei, drei Tricks, die ihr noch nicht kennt.', 'Leute, ich hab das schon bei Besseren erlebt.'] },
    { // Trevor
      hello: ['Wer hat mich geweckt?!', 'Heute wird es lustig.', 'Ich bin völlig entspannt. Wirklich.', 'Guten Morgen, Welt. Ihr habt mich vermisst, ich weiß.', 'Ich rieche Chaos. Wunderbar!', 'Hat jemand was gegen meine gute Laune? Dann soll er vortreten.', 'Mein Kopf brummt, aber das ist normal.', 'Heute geht es um Spaß. Und ein bisschen um Gewalt.', 'Ah, frische Luft! Und der Geruch von Benzin. Perfekt.', 'Ich bin gerade in einer ausgezeichneten Stimmung. Lauft!', 'Wer braucht schon Therapie, wenn man Explosionen hat?', 'Philip, Philip, mein Freund, hier kommt Trevor!', 'Sandy Shores ist viel besser als Los Santos. Aber gut.', 'Ich hab dreimal geschlafen. Das reicht für eine Woche.', 'Hallo, Zivilisation. Ich hab leider Hunger.', 'Moment, hab ich den Herd ausgemacht? Egal.'],
      cops: ['Kommt doch her, ihr Clowns!', 'Endlich passiert mal was!', 'Ihr wollt Ärger? Den kriegt ihr!', 'Hahaha, die Schweine kommen!', 'Ihr kriegt mich nie, ihr Amateure!', 'Wunderbar, ein Tanz mit der Polizei!', 'Ich liebe es, wenn ihr so wütend seid!', 'Na los, schießt doch! Aber zielt bitte!', 'Ich zünde euch gleich eure Streifenwagen an!', 'Diese Stadt braucht mehr Feuer, mehr Krach, mehr Trevor!', 'Dafür bin ich geboren!', 'Zwei Streifenwagen? Ist das alles, was ihr habt?', 'Meine Ex war gefährlicher als ihr!', 'Ich hab euch so vermisst, wirklich!', 'Lauf, Trevor, lauf, es wird lustig!', 'Mich hat noch keiner gekriegt, und ihr seid nicht die Ersten!'] },
  ],
  ped: ['Schönes Wetter heute, oder?', 'Hast du mal einen Dollar?', 'Ich muss echt mal wieder ins Fitnessstudio.', 'Die Mieten hier sind der Wahnsinn.', 'Hey, cooles Outfit!', 'Mein Agent ruft einfach nicht zurück.', 'Kennst du ein gutes Taco-Lokal hier?', 'Der Verkehr in dieser Stadt bringt mich um.',
    'Ich bin nur wegen der Sonne nach Kalifornien gezogen.', 'Jeder hier ist Schauspieler. Oder Kellner. Oder beides.', 'Haben Sie mal Feuer?', 'Meine Katze hat gestern den Fernseher umgeworfen.', 'Wo kriegt man hier einen anständigen Kaffee?', 'Ich warte seit einer Stunde auf meinen Lieferdienst.', 'Entschuldigung, ist das hier die Bushaltestelle?', 'Diese Stadt ist gleichzeitig toll und anstrengend.', 'Mein Auto ist schon wieder in der Werkstatt.', 'Ich brauche dringend Urlaub.', 'Hast du das Spiel gestern gesehen? Unfassbar.', 'Meine Schwester zieht nach Vinewood. Als ob das was bringt.', 'Ich hab zu viel Geld für Sneaker ausgegeben.', 'Hier gibt es mehr Fitnessstudios als Supermärkte.', 'Den ganzen Tag Sonne. Irgendwann reicht es auch.', 'Mein Chef denkt, ich arbeite gerade. Pssst.', 'Wo war noch mal mein Auto?', 'Ich glaub, ich hab den Herd angelassen.', 'Die Parkplatzsuche ist hier der reinste Krieg.', 'Heute Abend gibt es endlich Pizza.', 'Ich hab keine Ahnung, was ich mit meinem Leben mache.', 'Das ist alles nur noch Marketing, sag ich dir.', 'Hast du schon die Preise für Avocados gesehen?', 'Mein Therapeut ist ausgebucht. Ausgerechnet jetzt.', 'Alle reden über Vinewood, aber hier ist es genauso teuer.', 'Ich hab gestern jemanden gesehen, der sah aus wie ein Star.', 'Mein Handy ist schon wieder leer.', 'Ich muss unbedingt mehr Wasser trinken.', 'Der Typ da drüben starrt mich schon die ganze Zeit an.', 'Ich sollte meine Steuererklärung machen. Später.', 'Wer hat diese Kreisverkehre erfunden?', 'Meine Nachbarn feiern jeden Abend. Jeden!', 'Ich habe heute schon zehntausend Schritte gemacht.', 'Ein Burger Shot wäre jetzt genau richtig.', 'Ich glaub, ich zieh zu meiner Tante nach Sandy Shores.', 'Wieder ein Strafzettel. Das ist ein Komplott.', 'Hier wird einem nichts geschenkt.', 'Mal ehrlich, ohne Auto ist diese Stadt verloren.', 'Gestern sind schon wieder Sirenen die ganze Nacht gefahren.', 'Du siehst aus, als hättest du es eilig.', 'Das ist die beste Stadt der Welt. Sagt zumindest die Werbung.'],
  pedDay: ['Ich brauche einen Kaffee, und zwar sofort.', 'Mittagspause! Endlich.', 'Die Sonne knallt heute wieder.', 'Ich bin schon seit sechs Uhr auf den Beinen.', 'Heute Nachmittag gehe ich an den Strand.', 'Der Morgenverkehr war wieder die Hölle.', 'Frühstück hatte ich noch nicht. Typisch.', 'Ich muss gleich zu einem Termin.', 'Wenigstens ist es heute nicht so voll.', 'Der Tag fängt ja schon gut an.'],
  pedNight: ['Wieso bist du um diese Uhrzeit noch draußen?', 'Nachts ist es hier am schönsten.', 'Ich sollte längst im Bett sein.', 'Die Stadt leuchtet wie ein Weihnachtsbaum.', 'Zu spät für Kaffee, zu früh zum Schlafen.', 'Nachts sind hier komische Leute unterwegs. Nichts gegen dich.', 'Ich hab die Bahn verpasst. Wieder mal.', 'Alle Läden zu, na toll.', 'Ich such noch eine Bar, die offen ist.', 'Heute Nacht ist nichts los. Gruselig.'],
  bump: ['Hey, pass doch auf!', 'Geht es noch?', 'Augen auf, Mann!', 'Entschuldigung? Hallo?', 'Hast du keine Augen im Kopf?', 'Ey, was soll das denn?', 'Du bist wohl blind, oder was?', 'Pass auf, wo du hinrennst!', 'Na vielen Dank auch.', 'Das tat weh, du Idiot!', 'Kannst du nicht aufpassen?', 'Frechheit! So was gibt es nur hier.', 'Immer diese Rempler in dieser Stadt.', 'Ich hab doch Platz gemacht!', 'Mein Kaffee! Mein ganzer Kaffee!', 'Sag mal, hast du was getrunken?', 'Das ist ein Bürgersteig, keine Rennstrecke!', 'Ach, super. Jetzt tut mir die Schulter weh.', 'Nächstes Mal sagst du wenigstens Entschuldigung.', 'Rücksicht ist hier wohl ein Fremdwort.'],
  scared: ['Nicht schießen!', 'Hilfe! Polizei!', 'Der ist verrückt!', 'Lauf! Lauf!', 'Oh mein Gott!', 'Bitte tu mir nichts!', 'Ich hab Kinder zu Hause!', 'Weg hier, schnell!', 'Jemand soll die Polizei rufen!', 'Das ist nicht echt, das ist nicht echt!', 'Ich will nach Hause!', 'Oh nein, oh nein, oh nein!', 'Alle in Deckung!', 'Er hat eine Waffe!', 'Bitte nicht! Ich gebe dir alles!', 'Ich hab doch gar nichts gemacht!', 'Hilfe, ein Irrer!', 'Geh weg von mir!', 'Das darf doch nicht wahr sein!', 'Rennt! Rennt um euer Leben!', 'Ich wollte nur einkaufen!', 'Das war heute echt nicht mein Tag!', 'Mama! Ich will zu meiner Mama!', 'Ruft einen Krankenwagen!'],
  carjack: ['Hey! Mein Auto!', 'Das kannst du nicht machen!', 'Ich ruf die Polizei!', 'Das ist mein Wagen, du Dieb!', 'Hilfe, mein Auto wird geklaut!', 'Bitte nicht! Ich hab gerade erst die Raten bezahlt!', 'Na toll, das ging ja schnell.', 'Der Wagen ist nicht mal versichert!', 'Das gibt Ärger, das sag ich dir!', 'Halt! Der Schlüssel gehört mir!', 'Mein Wagen! Mein schöner Wagen!', 'Das ist ein Leihwagen, du Idiot!', 'Ich merk mir dein Gesicht!', 'Mein Hund sitzt noch drin!', 'Bitte, nimm alles, nur nicht mein Auto!'],
  chat: ['Und dann hat er einfach aufgelegt!', 'Hast du das neue Café an der Ecke probiert?', 'Die Stadt wird immer teurer, sag ich dir.', 'Mein Cousin dreht jetzt Imagefilme für Firmen, läuft super.', 'Gehen wir später an den Strand?', 'Ich hatte heute schon drei Castings.', 'Hast du Lust auf Tacos heute Abend?', 'Meine Vermieterin hat die Miete schon wieder erhöht.', 'Ich hab gehört, in Vinewood gibt es eine neue Bar.', 'Er hat mich auf der Hochzeit total blamiert.', 'Wir sollten mal wieder zusammen kochen.', 'Hast du die Nachrichten gesehen? Schon wieder Verfolgungsjagd.', 'Mein Chef meint, ich soll Überstunden machen.', 'Ich überleg, ob ich mir einen Hund hole.', 'Der Typ von nebenan ist ein totaler Nerd.', 'Meine Mutter ruft jeden Tag an, unfassbar.', 'Hast du schon deinen Urlaub gebucht?', 'Ich sag es dir, das war echt unglaublich.', 'Ich kann nicht mehr, ich brauch ein Wochenende.', 'Wie war dein Date gestern?', 'Meine neue Wohnung hat einen Balkon!', 'Wir müssen unbedingt mal in den Freizeitpark.', 'Er hat tatsächlich gesagt, er sei Musikproduzent.', 'Ich glaub, der Kellner hat mich erkannt.', 'Mit dem Auto brauchst du hier eine Ewigkeit.', 'Ich lasse mir ein Tattoo stechen. Nur ein kleines.', 'Ach komm, das sagst du jedes Mal!', 'Der neue Film soll echt gut sein.', 'Ich brauch mehr Schlaf, ernsthaft.', 'Das glaubt dir doch kein Mensch.', 'Erzähl, was ist dann passiert?', 'Echt jetzt? Das ist doch nicht dein Ernst!', 'Ich würd ja gern, aber ich hab kein Geld.', 'Du schuldest mir noch zwanzig Dollar!', 'Lass uns einfach Pizza bestellen.', 'Hast du die Preise im neuen Supermarkt gesehen?', 'Der Strand ist heute bestimmt wieder überfüllt.', 'Ich hab mir den Fuß gestoßen, schau mal.', 'Gestern habe ich Michael aus dem Fernsehen gesehen, glaub ich.'],
  phone: ['Ja, Schatz, ich bin gleich da.', 'Nein, die Mail hab ich nicht bekommen.', 'Sag dem Chef, ich steck im Stau.', 'Echt jetzt? Das glaub ich nicht!', 'Hallo? Hallo? Ich hör dich kaum!', 'Nein, ich komme nicht zur Party.', 'Ja, ich hab es dir doch gestern gesagt.', 'Ich ruf dich später zurück, ich bin unterwegs.', 'Kannst du bitte Milch mitbringen?', 'Moment, ich muss kurz den Ton lauter machen.', 'Das ist nicht mein Problem, das ist deins.', 'Wie, du bist schon wieder pleite?', 'Ich bin gleich im Meeting, ich muss auflegen.', 'Nein, das habe ich so nicht gesagt.', 'Ja, ich bin im Park, direkt neben dem Brunnen.', 'Hör mal, ich kann jetzt nicht reden.', 'Ich muss noch tanken, dann bin ich da.', 'Okay, okay, ich komm ja schon.', 'Hast du schon was gegessen?', 'Mama, ich bin erwachsen, mir geht es gut.', 'Ich schick dir gleich das Foto.', 'Lass uns das Ganze morgen besprechen.', 'Nein, ich hab das Konto nicht überzogen!', 'Ja, kauf einfach die blaue Version.'],
  intruder: ['Wer sind Sie? Raus aus meiner Wohnung!', 'Hey! Das ist Privatbesitz!', 'Ich ruf gleich die Polizei!', 'Wie sind Sie hier reingekommen?', 'Verschwinden Sie sofort!', 'Ich habe einen Hund und der beißt!', 'Hilfe, ein Einbrecher!', 'Das ist ein Hausfriedensbruch!', 'Schatz, ruf die Polizei, hier ist ein Fremder!', 'Raus! Raus, sonst hole ich meinen Baseballschläger!', 'Haben Sie geklingelt? Nein? Dann raus!', 'Ich zeige Sie an, das schwöre ich!', 'Mein Mann ist Anwalt, der macht Sie fertig!', 'Hier gibt es nichts zu holen!', 'Was wollen Sie in meinem Wohnzimmer?', 'Verlassen Sie sofort mein Haus!'],
  inside: {
    worker: ['Das Meeting hätte auch eine E-Mail sein können.', 'Hast du den Bericht schon gesehen?', 'Noch drei Stunden bis Feierabend.', 'Der Kaffee hier ist furchtbar.', 'Sie arbeiten nicht hier, oder?', 'Ich warte seit Tagen auf die Freigabe.', 'Der Drucker spinnt schon wieder.', 'Bitte stören Sie mich nicht, ich habe eine Deadline.', 'Wissen Sie, wo der Kopierer ist?', 'Mein Computer hat sich gerade aufgehängt.', 'Dienstag ist der schlimmste Tag der Woche.', 'Die Klimaanlage ist wieder ausgefallen.', 'Wir müssen die Zahlen noch mal prüfen.', 'Haben Sie einen Termin mit der Geschäftsführung?', 'Das Büro ist heute leer, alle sind im Homeoffice.', 'Ich habe schon wieder meine Karte vergessen.'],
    resident: ['Wer sind Sie? Raus hier!', 'Ich hab Sie nicht reingelassen!', 'Das ist meine Wohnung, verschwinden Sie!', 'Ich habe nichts bestellt, gehen Sie bitte!', 'Wie sind Sie am Pförtner vorbeigekommen?', 'Ich hab gleich Besuch. Gehen Sie bitte.', 'Kennen wir uns? Ich glaube nicht.', 'Unsere Hausordnung gilt auch für Sie!'],
    reception: ['Willkommen bei {co}. Haben Sie einen Termin?', 'Die Aufzüge sind direkt hinter mir.', 'Bitte tragen Sie sich ins Besucherbuch ein.', 'Guten Tag und willkommen bei {co}.', 'Wen darf ich Ihnen melden?', 'Der Aufzug ist gleich dort drüben.', 'Falls Sie etwas brauchen, sagen Sie Bescheid.', 'Einen schönen Tag bei {co}!', 'Ich kann Sie leider nicht ohne Termin durchlassen.', 'Der Fahrstuhl fährt bis ganz nach oben.', 'Entschuldigen Sie bitte, mein Telefon klingelt.', 'Haben Sie einen Besucherausweis?'],
    cashier: ['Hallo! Brauchen Sie eine Tüte?', 'Das macht dann zwölf Dollar fünfzig.', 'Wir schließen um Mitternacht.', 'Haben Sie eine Kundenkarte?', 'Bar oder mit Karte?', 'Der Nächste, bitte!', 'Heute im Angebot: alles, was abläuft.', 'Brauchen Sie noch etwas?', 'Haben Sie alles gefunden?', 'Die Preise mache ich nicht, ich arbeite hier nur.', 'Schönen Tag noch, und kommen Sie bald wieder!', 'Möchten Sie noch einen Kaugummi dazu?'],
    customer: ['Wo finde ich hier die Chips?', 'Alles so teuer geworden.', 'Die Auswahl hier ist ein Witz.', 'Ich such schon eine halbe Stunde nach Milch.', 'Haben die hier auch glutenfreies Brot?', 'Drei Dollar für einen Apfel? Das ist Raub.', 'Entschuldigung, wissen Sie, wo die Taco-Soße steht?', 'Immer wenn ich komme, ist die Schlange lang.', 'Das Sonderangebot ist doch nur ein Trick.', 'Ich wollte eigentlich nur eine Sache kaufen.', 'Gibt es das auch in Bio?', 'Mein Einkaufswagen quietscht schon wieder.'],
    nurse: ['Bitte leise, hier schlafen Patienten.', 'Die Besuchszeit ist gleich vorbei.', 'Bitte folgen Sie mir nicht auf die Station.', 'Hier dürfen Sie nicht rein.', 'Kann ich Ihnen helfen? Sie sehen verwirrt aus.', 'Die Notaufnahme ist wie immer überfüllt.', 'Haben Sie einen Termin beim Arzt?', 'Bitte desinfizieren Sie sich die Hände.'],
    patient: ['Ich will einfach nur nach Hause.', 'Haben Sie Schokolade dabei?', 'Das Essen hier schmeckt nach nichts.', 'Wann kommt endlich der Arzt?', 'Mein Rücken bringt mich noch um.', 'Ich liege jetzt schon die dritte Nacht hier.', 'Die Schwestern hier sind eigentlich ganz nett.', 'Haben Sie die Fernbedienung gesehen? Ich finde sie nicht.'],
    visitor: ['Ich warte auf meinen Termin.', 'Wissen Sie, in welchem Stock die Buchhaltung ist?', 'Ich bin schon das dritte Mal hier.', 'Die haben mich einfach warten lassen.', 'Sind Sie auch wegen des Vorstellungsgesprächs hier?', 'Ich bin ein bisschen nervös.', 'Gibt es hier irgendwo eine Toilette?', 'Das Wartezimmer ist ja mal richtig voll.'],
  },
  witness: {
    theft: ['Ja, Polizei? Hier im Laden wurde gerade geklaut!', 'Hallo, ich möchte einen Diebstahl melden, jetzt gerade!', 'Polizei? Da klaut einer, ich seh es genau!', 'Schicken Sie jemanden, hier wurde gerade etwas gestohlen!'],
    carjack: ['Hallo, Polizei? Hier wurde gerade ein Auto geklaut!', 'Jemand hat gerade mit Gewalt ein Auto genommen!', 'Polizei! Ein Autodieb, er ist in einem gestohlenen Wagen unterwegs!', 'Ein Mann hat gerade einen Fahrer aus dem Auto gezerrt!'],
    shooting: ['Polizei? Hier wird geschossen! Kommen Sie schnell!', 'Ich höre Schüsse! Bitte kommen Sie sofort!', 'Hier ist eine Schießerei, schicken Sie alle Einheiten!', 'Da schießt einer wild um sich, ich verstecke mich!'],
    murder: ['Hilfe, hier wurde jemand umgebracht! Schicken Sie jemanden!', 'Da liegt eine Leiche, ich glaube, es war Mord!', 'Polizei, es gab einen Todesfall, und der Täter ist noch da!', 'Jemand wurde erschossen, schicken Sie bitte einen Krankenwagen!'],
    hitrun: ['Ein Auto hat gerade jemanden überfahren und ist abgehauen!', 'Fahrerflucht! Er hat einen Fußgänger erwischt!', 'Polizei, ein Wagen hat jemanden angefahren und ist weg!', 'Da liegt ein Verletzter, der Fahrer ist einfach weitergefahren!'],
    assault: ['Hier prügelt einer auf Leute ein, kommen Sie bitte!', 'Da wird jemand zusammengeschlagen, bitte beeilen Sie sich!', 'Polizei, hier ist eine Schlägerei, und die wird schlimmer!', 'Ein Mann greift Passanten an, kommen Sie sofort!'] },
  arrest: ['Hände hoch! Sie sind verhaftet!', 'Keine Bewegung! Auf den Boden!', 'Das war es für Sie. Hände auf den Rücken!', 'Sie haben das Recht zu schweigen. Nutzen Sie es.', 'Aus die Maus. Umdrehen!', 'Ihre Fahrt endet hier. Legen Sie die Hände an den Kopf!', 'Auf die Knie! Sofort!', 'Jetzt ist Schluss. Sie kommen mit.', 'Nehmen Sie die Hände hoch und bleiben Sie ruhig!', 'Das war es, mein Freund. Handschellen klicken.', 'Ich sagte keine Bewegung!', 'Ihre Flucht ist vorbei.'],
  hq: ['Zentrale: Einheit verlässt die Wache, unterwegs zum Einsatzort.', 'Verstärkung von der Wache ist unterwegs.', 'Mission Row meldet: Streife rückt aus.', 'Weitere Fahrzeuge von der Wache zugeteilt.', 'Zentrale, Einheit zwei ist auf dem Weg.', 'Wache Davis: Wagen fahren raus, Ankunft in Kürze.', 'Alle verfügbaren Wagen verlassen das Revier.', 'Zentrale, wir rücken mit zwei Fahrzeugen aus.'],
  redlight: ['Zentrale, Rotlichtverstoß beobachtet. Wir halten das Fahrzeug an.', 'Fahrzeug ist über Rot gefahren, nehmen die Verfolgung auf.', 'Rotlichtsünder vor uns, Blaulicht ist an.', 'Zentrale, ein Fahrer ignoriert das Rotlicht, wir bleiben dran.', 'Der Wagen hat die Ampel überfahren, Verfolgung eingeleitet.', 'Rotlichtverstoß. Das wird teuer für den Fahrer.'],
  shoplift: ['Hey! Das musst du bezahlen! Ich rufe die Polizei!', 'Haltet den Dieb! Polizei, schnell!', 'Stehen bleiben! Das ist Diebstahl!', 'Ich hab das gesehen! Zahlen oder ich rufe die Polizei!', 'Hey, du! Zurück mit der Ware!', 'Ladendieb! Jemand soll die Polizei rufen!', 'Ich lasse dich nicht damit raus!', 'Das ist ein Überfall auf mein Regal! Polizei!'],
  prison: ['Kaution ist bezahlt. Raus hier, und lass dich nicht wieder blicken!', 'Die Tür ist offen. Benimm dich da draußen, verstanden?', 'Du bist frei. Aber ich seh dich bald wieder, wetten?', 'Raus mit dir. Und dass ich dich nicht wieder erwische!', 'Deine Sachen sind hinten, dann bist du weg.', 'Schönes Leben noch. Und lass das Klauen.', 'Du hast Glück, dass sie dich rauskaufen.', 'Ab nach Hause. Keine Dummheiten mehr.'],
  bail: ['In Ordnung, ich komme und schließe auf.', 'Kaution ist eingegangen. Ich bin gleich bei dir.', 'Moment, ich hole die Schlüssel.', 'Ein Anruf vom Anwalt. Na gut, ich komme.', 'Das Geld ist da. Dann wollen wir mal.', 'Okay, okay, ich öffne ja schon.'],
  guardWarn: ['Hey! Finger weg von dem Gitter!', 'Was machst du da hinten? Lass das!', 'Zurück vom Zaun, sofort!', 'Ich seh dich! Mach keinen Unsinn!', 'Das Gitter ist kein Spielzeug, Freundchen!', 'Noch ein Schritt und es gibt Ärger!', 'Hey, du da! Was hast du vor?', 'Zurück in die Zelle, sonst gibt es Hofgang-Verbot!'],
  breakout: ['Alarm! Häftling aus Bolingbroke ausgebrochen! Alle Einheiten!', 'Zentrale an alle: Ausbruch aus dem Gefängnis, Verdächtiger flüchtig.', 'Ausbruch in Bolingbroke! Straßensperren einrichten!', 'Ein Häftling ist entkommen, alle Wagen in die Umgebung!', 'Gefängnisalarm! Ein Insasse ist flüchtig.', 'Alle Einheiten: Entflohener Häftling, gilt als gefährlich.'],
  surround: ['Verdächtiger ist in ein Gebäude geflüchtet. Wir umstellen den Eingang.', 'Zentrale, Verdächtiger im Gebäude. Wir gehen rein.', 'Gebäude wird umstellt. Niemand kommt raus.', 'Ziel hat sich im Haus verschanzt. Wir sichern alle Ausgänge.', 'Er ist da drin. Alle Zugänge werden abgeriegelt.', 'Zentrale, Verdächtiger in Gebäude verschwunden, wir riegeln ab.', 'Einheiten, bringt euch vor dem Eingang in Stellung.', 'Das Gebäude ist umstellt, wir warten auf Verstärkung.'],
  enter: ['Einheiten betreten das Gebäude. Durchsuchen Etage für Etage.', 'Wir sind drin. Sichern das Erdgeschoss.', 'Zugriff! Wir gehen rein.', 'Wir durchsuchen jetzt jedes Stockwerk.', 'Eingang gesichert, rücken vor.', 'Streife eins betritt das Gebäude, Rückendeckung bitte.', 'Wir sind im Treppenhaus, nach oben.', 'Wir gehen rein, Waffen bereit.'],
  found: ['Da ist er! Stehen bleiben!', 'Polizei! Hände hoch!', 'Hier drüben, ich hab ihn!', 'Da! Ich sehe ihn!', 'Stehen bleiben, du Kleinkrimineller!', 'Jetzt hab ich dich!', 'Ich hab ihn! Alle Einheiten hierher!', 'Keine Bewegung, wir haben dich gesehen!'],
  ride: {
    taxi: ['Taxi! Steig ein, Kumpel.', 'Hier ist dein Taxi. Hinten ist zu, setz dich nach vorne.', 'Na, wo soll es hingehen?', 'Dein Taxi ist da, spring rein!', 'Taxi nach Los Santos und Umgebung. Rein mit dir!', 'Du hast ein Taxi bestellt? Hier bin ich.', 'Steig ein, ich hab nicht ewig Zeit.', 'Hallo, Freund. Hinten ist ein bisschen unordentlich, nimm vorn Platz.'],
    chauffeur: ['Guten Tag. Bitte sehr, steigen Sie ein.', 'Ihr Wagen ist bereit. Darf ich Ihnen die Tür aufhalten?', 'Willkommen an Bord. Bitte einsteigen.', 'Guten Tag, der Wagen steht für Sie bereit.', 'Es ist mir ein Vergnügen. Bitte nehmen Sie Platz.', 'Ihr Chauffeur zu Diensten. Wohin darf es gehen?', 'Bitte sehr, die Tür ist offen.', 'Guten Tag. Machen Sie es sich bequem.'],
    where: ['Wohin soll es gehen? Markieren Sie das Ziel einfach auf der Karte.', 'Sag mir wohin, setz einfach einen Punkt auf der Karte.', 'Wohin darf es gehen? Setzen Sie ein Ziel auf der Karte.', 'Wo soll ich dich hinbringen? Markier es auf der Karte.', 'Ich brauche ein Ziel. Nimm die Karte und setz einen Punkt.', 'Okay, und wohin? Ich warte auf deinen Kartenpunkt.'],
    go: ['Alles klar, wir fahren los.', 'Sehr gerne, ich bringe Sie hin.', 'Okay, das kenne ich. Lehn dich zurück.', 'Kein Problem, das ist nicht weit.', 'Alles klar, Anschnallen und ab geht es.', 'Verstanden. Das Ziel ist notiert.', 'Gute Wahl. Dann mal los.', 'Dann bringe ich Sie mal sicher dorthin.'],
    stop: ['Kein Problem, ich halte hier vorne an.', 'Alles klar, ich fahre rechts ran.', 'Wie du willst, ich halte an.', 'Ich fahre an den Rand, einen Moment.', 'Selbstverständlich, ich halte sofort.', 'Okay, hier bleib ich stehen.'],
    bye: ['Danke und einen schönen Tag noch!', 'Wir sind da. Beehren Sie uns bald wieder.', 'Hier sind wir. Pass auf dich auf.', 'Endstation. Mach es gut, Kumpel.', 'Wir sind am Ziel. Danke für die Fahrt.', 'Ankunft. Einen guten Tag noch!', 'So, das war es. Bis zum nächsten Mal.', 'Bitte sehr, wir sind da. Gute Geschäfte!'],
    noPay: ['Du kannst nicht zahlen? Ich rufe die Polizei!', 'Hey! Erst fahren und dann nicht zahlen? Polizei!', 'Kein Geld? Das gibt eine Anzeige!', 'Du schuldest mir die Fahrt! Ich rufe die Polizei!', 'Das ist Betrug, ich melde dich!', 'Bezahl oder ich hol die Cops!'],
    dispatch: ['Downtown Cab, guten Tag. Wir schicken sofort einen Wagen zu Ihnen.', 'Ihr Fahrer ist gleich bei Ihnen. Vielen Dank für Ihre Buchung.', 'Wir haben Ihre Bestellung. Der Wagen ist unterwegs.', 'Guten Tag, ein Fahrzeug ist bereits auf dem Weg zu Ihnen.', 'Vielen Dank für Ihren Anruf. In wenigen Minuten ist jemand da.', 'Downtown Cab, wir kümmern uns darum. Einen Moment.'],
  },
  mega: ['Halt! Polizei!', 'Hände hoch und auf den Boden!', 'Fahrzeug sofort anhalten!', 'Waffe fallen lassen!', 'Sie sind umstellt! Ergeben Sie sich!', 'Fahren Sie rechts ran und steigen Sie aus!', 'Stellen Sie den Motor ab!', 'Aussteigen, mit erhobenen Händen!', 'Leisten Sie keinen Widerstand!', 'Hier spricht die Polizei. Bleiben Sie stehen!', 'Das ist Ihre letzte Warnung!', 'Legen Sie die Waffe auf den Boden!', 'Bleiben Sie, wo Sie sind!', 'Sie können nicht entkommen!', 'Zeigen Sie uns Ihre Hände!', 'Anhalten! Das ist ein Befehl!'],
  radio: ['Zentrale an alle Einheiten: Verdächtiger flüchtig.', 'Einheit zwölf, Verdächtiger in Sichtweite, nehmen Verfolgung auf.', 'Brauchen Verstärkung, Code drei!', 'Alle Einheiten: Schüsse gemeldet.', 'Verdächtiger fährt mit hoher Geschwindigkeit.', 'Hier Einheit vier, wir sind direkt dahinter.', 'Verdächtiger hat die Fahrbahn gewechselt, bleiben dran.', 'Zentrale, brauchen einen Hubschrauber, Verdächtiger ist schnell.', 'Alle Wagen, Straßensperre vorbereiten.', 'Verdächtiger hat gerade eine rote Ampel überfahren.', 'Zentrale, wir verlieren ihn in der Kurve.', 'Verfolgung läuft, Verdächtiger ignoriert alle Anweisungen.', 'Einheit sieben, wir sind beim Verdächtigen.', 'Achtung, Verdächtiger könnte bewaffnet sein.', 'Wagen drei, nehmt die Seitenstraße!', 'Verdächtiger fährt über den Bürgersteig, Vorsicht, Passanten!', 'Zentrale, Fahrzeug rammt Absperrung.', 'Verfolgung eskaliert, fordern weitere Einheiten an.', 'Verdächtiger flüchtet zu Fuß, nehmen die Verfolgung auf.', 'Zentrale, hier Einheit neun: Er kommt direkt auf uns zu.', 'Bitte um Unterstützung, Verdächtiger widersetzt sich.', 'Alle Einheiten, Verdächtiger trägt dunkle Kleidung.', 'Zentrale, Fahndung läuft auf Hochtouren.', 'Verdächtiger hat ein Hindernis gerammt, nähern uns.'],
  radioLost: ['Sichtkontakt verloren, suchen das Gebiet ab.', 'Kein Sichtkontakt. Letzte bekannte Position wird abgesucht.', 'Wir haben ihn verloren. Alle Einheiten schwärmen aus.', 'Verdächtiger ist uns entwischt, wir suchen weiter.', 'Kein Kontakt mehr. Fahrzeuge an allen Ausfallstraßen.', 'Zentrale, er ist weg. Wir kämmen die Gegend durch.', 'Wir haben nichts mehr. Wo steckt der Kerl?', 'Spur verloren, durchsuchen die Nebenstraßen.', 'Er ist wie vom Erdboden verschluckt.', 'Suchaktion läuft, bitte um Hubschrauberunterstützung.'],
  radioEnd: 'Alle Einheiten: Fahndung eingestellt. Verdächtiger entkommen.',
};
{ // Passanten-Sprüche passend zur Tageszeit beimischen
  const day = LINES.pedDay, night = LINES.pedNight;
  LINES.ped = freshList(LINES.ped, () => { const h = (gameMin / 60) % 24; return h < 5 || h >= 21 ? night : h >= 7 && h < 19 ? day : null; });
}
freshAll(LINES);
let voices = [];
try { const lv = () => { voices = speechSynthesis.getVoices(); }; lv(); speechSynthesis.addEventListener('voiceschanged', lv); } catch (e) { /* keine Sprachausgabe */ }
let speakUntil = 0, subT = null;
const VOICE = { index: null, bins: {}, cache: new Map() };
async function loadVoices() {
  try {
    VOICE.index = await (await fetch('voices/index.json')).json();
    await Promise.all(Object.keys(VOICE.index).map(async v => { VOICE.bins[v] = await (await fetch(`voices/${v}.bin`)).arrayBuffer(); }));
  } catch (e) { console.warn('Stimmen nicht geladen', e); VOICE.index = null; }
}
// Feste Rollenstimmen (Name im say() -> [Stimme, Wiedergaberate]); Hauptfiguren, Kontakte, Funk, Fahrer
const VOICE_OF = { FRANKLIN: ['franklin', 1], MICHAEL: ['michael', 1], TREVOR: ['trevor', 1], Franklin: ['franklin', 1], Michael: ['michael', 1], Trevor: ['trevor', 1], Jamal: ['jamal', 1], 'Tante Gloria': ['gloria', 1], 'Lester-Hacker': ['lester', 1], Polizeifunk: ['cop_radio', 1.02], Polizei: ['cop_foot', 1], 'Polizei (Megafon)': ['cop_foot', 1], Wärter: ['guard', 1], Taxifahrer: ['taxi', 1], Chauffeur: ['chauffeur', 1], 'Downtown Cab Co.': ['dispatch', 1], 'Chauffeur-Service': ['dispatch', 1], Rezeption: ['f_recep', 1], Angestellte: ['f_young', 1.04] };
// alte Stimmennamen (aus älteren Aufrufen) -> neue Stimmen
const VOICE_ALIAS = { thorsten: 'franklin', karlsson: 'taxi', pavoque: 'cop_foot', kerstin: 'f_recep', ramona: 'dispatch' };
const FEM_ALL = ['f_recep', 'f_young', 'f_eva', 'gloria', 'dispatch'];
function clipVoice(text, v) {
  const I = VOICE.index; if (!I) return null;
  v = VOICE_ALIAS[v] || v;
  if (I[v]?.[text]) return v;
  const same = FEM_ALL.includes(v) ? FEM_V : MALE_V;
  return [...same, ...MALE_V, ...FEM_V, ...Object.keys(I)].find(o => I[o]?.[text]) || null;
}
function say(text, { who = '', pitch = 1, rate = 1, vol = 1, prio = false, color = '#ffd23a', radio = false, voice = null, h = null } = {}) {
  const now = performance.now();
  if (!prio && now < speakUntil) return false;
  speakUntil = now + 900 + text.length * 60;
  const ci = CHARS.findIndex(c => c.name === who); if (!h && ci >= 0) h = CHARS[ci].h;
  let [v, vr] = VOICE_OF[who] || (voice ? [voice, rate] : [pick(MALE_V), rnd(0.95, 1.05)]);
  const cv = clipVoice(text, v);
  if (cv && sfx.ready()) {
    const sub = $('sub'); sub.innerHTML = `<b style="color:${color}">${who}:</b>${text}`; sub.style.opacity = 1;
    clearTimeout(subT); subT = setTimeout(() => sub.style.opacity = 0, 1400 + text.length * 60);
    let g = vol; if (h && !radio) { const d = h.group.position.distanceTo(camera.position); g *= clamp(1.4 - d / 25, 0.2, 1); }
    sfx.speak(cv, text, vr || 1, radio, h, g, prio); return true;
  }
  const sub = $('sub'); sub.innerHTML = `<b style="color:${color}">${who}:</b>${text}`; sub.style.opacity = 1;
  clearTimeout(subT); subT = setTimeout(() => sub.style.opacity = 0, 1400 + text.length * 60);
  if (radio) sfx.squelch();
  try {
    if (prio) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text), de = voices.filter(v => /^de/i.test(v.lang));
    u.voice = de.find(v => /male|mann|stefan|markus|hans|conrad|yannick|klaus|jonas|florian/i.test(v.name)) || de[0] || null;
    u.lang = 'de-DE'; u.pitch = pitch; u.rate = rate; u.volume = vol;
    if (radio) u.onend = () => sfx.squelch();
    speechSynthesis.speak(u);
  } catch (e) { /* Untertitel reichen */ }
  return true;
}
window.__voice = { get index() { return VOICE.index; }, get bins() { return VOICE.bins; }, say, clipVoice, LINES, get CALL_LINES() { return CALL_LINES; }, get SCAN() { return SCAN; }, MALE_V, FEM_V, voiceFor };

// ---------- Audio (prozedural) ----------
const sfx = (() => {
  let ac = null, master, echo, noiseBuf, eng, screech, traffic, siren, aiVoices = [], radioOn = false, radioTimer = null, ambT = 2;
  const init = () => {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ac.createDynamicsCompressor(); comp.connect(ac.destination);
    master = ac.createGain(); master.gain.value = 0.75; master.connect(comp);
    // Häuserschluchten-Echo
    echo = ac.createGain(); echo.gain.value = 0.35;
    const dl = ac.createDelay(1), fb = ac.createGain(), elp = ac.createBiquadFilter();
    dl.delayTime.value = 0.21; fb.gain.value = 0.3; elp.type = 'lowpass'; elp.frequency.value = 1800;
    echo.connect(dl); dl.connect(elp); elp.connect(fb); fb.connect(dl); elp.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const loopNoise = (type, f, q = 1) => {
      const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = rnd(0.9, 1.1);
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ac.createGain(); g.gain.value = 0; s.connect(fl).connect(g).connect(master); s.start(); return { f: fl, g };
    };
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lp = ac.createBiquadFilter(), g = ac.createGain(), g2 = ac.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.Q.value = 3; g.gain.value = 0; g2.gain.value = 0.45;
    o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(master); o1.start(); o2.start();
    eng = { o1, o2, lp, g, rumble: loopNoise('lowpass', 140) };
    screech = loopNoise('bandpass', 2300, 7);
    traffic = loopNoise('lowpass', 420);
    for (let i = 0; i < 3; i++) {
      const o = ac.createOscillator(), f = ac.createBiquadFilter(), vg = ac.createGain(), pan = ac.createStereoPanner();
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 380; vg.gain.value = 0;
      o.connect(f).connect(vg).connect(pan).connect(master); o.start(); aiVoices.push({ o, g: vg, pan });
    }
    const so = ac.createOscillator(), so2 = ac.createOscillator(), sf = ac.createBiquadFilter(), sg = ac.createGain(), sp = ac.createStereoPanner();
    so.type = 'sawtooth'; so2.type = 'square'; sf.type = 'lowpass'; sf.frequency.value = 2600; sg.gain.value = 0;
    so.connect(sf); so2.connect(sf); sf.connect(sg).connect(sp).connect(master); sg.connect(echo); so.start(); so2.start();
    siren = { o: so, o2: so2, g: sg, pan: sp };
  };
  const panOf = (x, z) => {
    if (x == null) return 0;
    const dx = x - camera.position.x, dz = z - camera.position.z, d = Math.hypot(dx, dz) || 1;
    return clamp((dx * -Math.cos(camYaw) + dz * Math.sin(camYaw)) / d, -1, 1) * 0.8;
  };
  const vol = (x, z) => x == null ? 1 : clamp(1 - Math.hypot(x - player.x, z - player.z) / 130, 0, 1);
  const out = (node, x, z, wet) => { const p = ac.createStereoPanner(); p.pan.value = panOf(x, z); node.connect(p).connect(master); if (wet) node.connect(echo); };
  const noise = (dur, f, g, type = 'lowpass', x, z, wet = false) => {
    if (!ac || g <= 0.001) return;
    const s = ac.createBufferSource(); s.buffer = noiseBuf; const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
    const gn = ac.createGain(); gn.gain.setValueAtTime(g, ac.currentTime); gn.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    s.connect(fl).connect(gn); out(gn, x, z, wet); s.start(); s.stop(ac.currentTime + dur);
  };
  const tone = (f, dur, g, type = 'sine', t0 = 0, f2 = null, x, z, wet = false) => {
    if (!ac || g <= 0.001) return;
    const o = ac.createOscillator(); o.type = type; const gn = ac.createGain(); const t = ac.currentTime + t0;
    o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.linearRampToValueAtTime(g, t + 0.01); gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gn); out(gn, x, z, wet); o.start(t); o.stop(t + dur + 0.05);
  };
  const horn = (x, z, g = 0.4) => { const v = g * (x == null ? 1 : vol(x, z)); [415, 523].forEach(f => tone(f, 0.45, v * 0.25, 'square', 0, null, x, z, true)); };
  const birds = () => { const n = rint(2, 4); for (let i = 0; i < n; i++) tone(rnd(2600, 3600), 0.09, 0.025, 'sine', i * 0.13, rnd(3200, 4400)); };
  const crickets = () => { for (let i = 0; i < 6; i++) tone(4400, 0.03, 0.012, 'triangle', i * 0.07); };
  // Mini-Radio: 16-Step West-Coast-Beat
  const radioStep = (() => {
    let step = 0; const bass = [55, 0, 0, 55, 0, 0, 65.4, 0, 49, 0, 0, 49, 0, 0, 58.3, 0];
    return () => {
      if (!radioOn || !ac) return; const s = step++ % 16;
      if (s === 0 || s === 6 || s === 10) tone(110, 0.25, 0.5, 'sine', 0, 40);
      if (s === 4 || s === 12) noise(0.18, 3000, 0.25, 'highpass');
      if (s % 2 === 0) noise(0.04, 8000, 0.06, 'highpass');
      if (bass[s]) tone(bass[s], 0.28, 0.22, 'triangle');
      if (s === 0 || s === 8) [261.6, 311.1, 392].forEach(f => tone(f * (s === 8 ? 0.89 : 1), 0.7, 0.03, 'sawtooth'));
    };
  })();
  let curVoice = null, speaking = null; const lipData = new Uint8Array(256);
  const DIST = (() => { const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 2.2); } return c; })();
  return {
    speak(v, text, rate, radio, h, gain, prio) {
      if (!ac) return;
      const key = v + '|' + text;
      const play = b => {
        if (curVoice) { try { curVoice.stop(); } catch (e) { /* schon beendet */ } }
        const s = ac.createBufferSource(); s.buffer = b; s.playbackRate.value = rate; let node = s;
        if (radio) { const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.1; const ws = ac.createWaveShaper(); ws.curve = DIST; s.connect(bp); bp.connect(ws); node = ws; }
        const an = ac.createAnalyser(); an.fftSize = 256; const g = ac.createGain(); g.gain.value = (radio ? 1.3 : 1.7) * gain;
        node.connect(an); an.connect(g); g.connect(master); if (!radio) g.connect(echo);
        curVoice = s; speaking = { an, h };
        s.onended = () => { if (curVoice === s) { curVoice = null; if (speaking?.h) speaking.h.talkAmp = 0; speaking = null; if (radio) this.squelch(); } };
        if (radio) this.squelch();
        s.start();
      };
      const cached = VOICE.cache.get(key);
      if (cached) return play(cached);
      const [off, len] = VOICE.index[v][text];
      ac.decodeAudioData(VOICE.bins[v].slice(off, off + len)).then(b => { VOICE.cache.set(key, b); play(b); }).catch(e => console.warn(e));
    },
    lipSync() {
      if (!speaking || !speaking.h) return;
      speaking.an.getByteTimeDomainData(lipData); let s = 0;
      for (let i = 0; i < lipData.length; i++) { const x = (lipData[i] - 128) / 128; s += x * x; }
      speaking.h.talkAmp = Math.min(1, Math.sqrt(s / lipData.length) * 5);
    },
    init, ready: () => !!ac,
    setPaused(p) { if (ac) p ? ac.suspend() : ac.resume(); },
    update(s) {
      if (!ac) return; const t = ac.currentTime;
      if (s.car) {
        const v = Math.abs(s.speed), gears = [0, 9, 17, 26, 36, 48, 70]; let gi = 0;
        while (gi < gears.length - 2 && v > gears[gi + 1]) gi++;
        const rpm = 0.2 + 0.8 * clamp((v - gears[gi]) / (gears[gi + 1] - gears[gi]), 0, 1), f = 34 + rpm * (68 + gi * 8) + s.thr * 8;
        eng.o1.frequency.setTargetAtTime(f, t, 0.04); eng.o2.frequency.setTargetAtTime(f / 2, t, 0.04);
        eng.lp.frequency.setTargetAtTime(280 + rpm * 900 + s.thr * 900, t, 0.05);
        eng.g.gain.setTargetAtTime(0.05 + s.thr * 0.05, t, 0.08); eng.rumble.g.gain.setTargetAtTime(0.1 + v * 0.004, t, 0.1);
      } else { eng.g.gain.setTargetAtTime(0, t, 0.1); eng.rumble.g.gain.setTargetAtTime(0, t, 0.1); }
      screech.g.gain.setTargetAtTime(clamp(s.skid, 0, 1) * 0.22, t, 0.05);
      traffic.g.gain.setTargetAtTime(0.025 + Math.min(0.12, s.trafficN * 0.01), t, 0.5);
      aiVoices.forEach((v, i) => {
        const c = s.ai[i]; if (!c) { v.g.gain.setTargetAtTime(0, t, 0.2); return; }
        v.g.gain.setTargetAtTime(clamp(1 - c.d / 45, 0, 1) * 0.035, t, 0.2);
        v.o.frequency.setTargetAtTime(30 + c.speed * 3.2, t, 0.1); v.pan.pan.setTargetAtTime(panOf(c.x, c.z), t, 0.1);
      });
      if (s.siren > 0) {
        const ph = s.sirenClose ? (t * 3.5) % 1 : (t * 0.45) % 1;
        const tri = s.sirenClose ? (ph < 0.5 ? ph * 2 : 2 - ph * 2) : 0.5 - 0.5 * Math.cos(ph * Math.PI * 2), f = 640 + tri * 820;
        siren.o.frequency.setTargetAtTime(f, t, 0.01); siren.o2.frequency.setTargetAtTime(f * 1.006, t, 0.01);
        siren.g.gain.setTargetAtTime(s.siren * 0.045, t, 0.1); siren.pan.pan.setTargetAtTime(panOf(s.sirenX, s.sirenZ), t, 0.1);
      } else siren.g.gain.setTargetAtTime(0, t, 0.2);
      ambT -= s.dt;
      if (ambT < 0) { ambT = rnd(1.5, 4); if (s.night < 0.5) { if (Math.random() < 0.5) birds(); } else crickets(); if (Math.random() < 0.25) horn(player.x + rnd(-80, 80), player.z + rnd(-80, 80), 0.25); }
    },
    shot(x, z, g = 1) { const v = g * vol(x, z); noise(0.25, 2600, 0.8 * v, 'lowpass', x, z, true); tone(150, 0.14, 0.35 * v, 'square', 0, 45, x, z); },
    crash(i, c) { noise(0.4, 700, i * vol(c.x, c.z), 'lowpass', c.x, c.z, true); noise(0.15, 3500, 0.3 * i * vol(c.x, c.z), 'highpass', c.x, c.z); },
    boom(x, z) { const v = vol(x, z); noise(1.8, 400, 1.3 * v, 'lowpass', x, z, true); tone(70, 1.3, 0.8 * v, 'sine', 0, 25, x, z); },
    horn,
    pain(x, z) { tone(rnd(260, 380), 0.35, 0.18 * vol(x, z), 'sawtooth', 0, rnd(150, 200), x, z); },
    coin() { tone(1200, 0.12, 0.15, 'square'); tone(1800, 0.2, 0.12, 'square', 0.07); },
    door() { noise(0.12, 900, 0.35); tone(90, 0.08, 0.2, 'sine'); },
    hit() { noise(0.15, 500, 0.6); },
    squelch() { noise(0.09, 2500, 0.18, 'highpass'); tone(1150, 0.05, 0.05, 'square'); },
    whoosh() { if (!ac) return; const s = ac.createBufferSource(); s.buffer = noiseBuf; const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; const g = ac.createGain(); const t = ac.currentTime;
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3000, t + 1.1); g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.4, t + 0.6); g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
      s.connect(f).connect(g).connect(master); s.start(); s.stop(t + 1.3); tone(98, 1.2, 0.2, 'sine', 0.1, 49); },
    wasted() { tone(220, 2.5, 0.25, 'sawtooth', 0, 55); tone(110, 3, 0.2, 'sine', 0.2, 40); },
    jingle() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 0.16, 'square', i * 0.11)); [523, 659, 784].forEach(f => tone(f, 1.2, 0.08, 'sawtooth', 0.48)); },
    hum(on) { if (!ac) return; if (on && !this._hum) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sawtooth'; o.frequency.value = 55; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180; g.gain.value = 0.05; o.connect(f).connect(g).connect(master); o.start(); this._hum = o; } else if (!on && this._hum) { this._hum.stop(); this._hum = null; } },
    click() { tone(1800, 0.04, 0.05, 'square'); },
    ring() { for (let i = 0; i < 2; i++) { tone(440, 0.4, 0.07, 'sine', i * 1.1); tone(480, 0.4, 0.07, 'sine', i * 1.1); } },
    liftBeep() { tone(1046, 0.09, 0.09, 'square'); tone(1568, 0.14, 0.06, 'sine', 0.09); },
    liftBeepOld() { tone(880, 0.12, 0.1, 'sine'); tone(1320, 0.18, 0.08, 'sine', 0.1); },
    ding() { tone(1318, 0.6, 0.12, 'sine'); tone(1046, 0.8, 0.1, 'sine', 0.18); },
    save() { [392, 494, 587].forEach((f, i) => tone(f, 0.6, 0.1, 'triangle', i * 0.15)); },
    radio() {
      radioOn = !radioOn; notice(radioOn ? 'Radio Los Santos' : 'Radio aus', 1500);
      clearInterval(radioTimer); if (radioOn) radioTimer = setInterval(radioStep, 60000 / 92 / 4);
    },
  };
})();

// ---------- HUD ----------
let noticeT = null, bannerT = null;
function notice(t, ms) { const n = $('notice'); n.textContent = t; n.style.opacity = 1; clearTimeout(noticeT); noticeT = setTimeout(() => n.style.opacity = 0, ms); }
function banner(big, small, ms = 4000) {
  const b = $('banner'); b.querySelector('.big').textContent = big; b.querySelector('.small').textContent = small;
  b.classList.add('show'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('show'), ms);
}
const mapCanvas = document.createElement('canvas'), MS = 2;
function buildMinimapBase() {
  const S = Math.ceil(EXT * 2 * MS); mapCanvas.width = mapCanvas.height = S;
  const c = mapCanvas.getContext('2d'); c.fillStyle = '#5d636b'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    c.fillStyle = parks.has(i + ',' + j) ? '#3f6e3a' : '#262b31';
    c.fillRect((BLOCK0 + i * P + EXT) * MS, (BLOCK0 + j * P + EXT) * MS, B * MS, B * MS);
  }
  c.fillStyle = '#3a4048';
  for (const [x, z, w, d] of mapBuildings) c.fillRect((x + EXT) * MS, (z + EXT) * MS, w * MS, d * MS);
}
const mm = $('minimap').getContext('2d');
function drawMinimap(camYaw, time) {
  if (INT.inside) return drawInteriorMap(time);
  const W = 520, H = 400; mm.fillStyle = '#20252b'; mm.fillRect(0, 0, W, H);
  const px = player.car ? player.car.x : player.x, pz = player.car ? player.car.z : player.z;
  const zoom = player.car ? 1.2 - Math.min(0.5, Math.abs(player.car.speedF || 0) / 80) : 1.4;
  mm.save(); mm.translate(W / 2, H * 0.62); mm.rotate(camYaw - Math.PI); mm.scale(zoom, zoom);
  mm.drawImage(mapCanvas, -(px + EXT) * MS, -(pz + EXT) * MS);
  // Sichtkegel der Polizei
  if (wanted > 0) for (const c of cars) {
    if (c.mode !== 'police') continue;
    const cx = (c.x - px) * MS, cz = (c.z - pz) * MS, ang = Math.atan2(Math.cos(c.yaw), Math.sin(c.yaw));
    mm.fillStyle = c.sees ? 'rgba(255,50,50,0.30)' : 'rgba(90,150,255,0.22)';
    mm.beginPath(); mm.moveTo(cx, cz); mm.arc(cx, cz, VIS_FAR * MS, ang - VIS_ANG, ang + VIS_ANG); mm.closePath(); mm.fill();
    mm.beginPath(); mm.arc(cx, cz, VIS_NEAR * MS, 0, 7); mm.fill();
  }
  const blip = (x, z, col, r) => { mm.fillStyle = col; mm.beginPath(); mm.arc((x - px) * MS, (z - pz) * MS, r / zoom, 0, 7); mm.fill(); };
  for (const c of cars) {
    if (c.type === 'police') blip(c.x, c.z, Math.sin(time * 10) > 0 ? '#ff2a2a' : '#2a6bff', 9);
    else if (c === CHARS[cur].carRef && c !== player.car) blip(c.x, c.z, '#7cff63', 8);
  }
  for (const k of pickups) blip(k.m.position.x, k.m.position.z, '#7fd36f', 5);
  const edge = (x, z, col, r) => { // Ziel am Rand der Minimap anzeigen
    let dx = (x - px) * MS, dz = (z - pz) * MS; const lim = 230 / zoom, l = Math.hypot(dx, dz);
    if (l > lim) { dx *= lim / l; dz *= lim / l; }
    mm.fillStyle = '#000'; mm.beginPath(); mm.arc(dx, dz, (r + 3) / zoom, 0, 7); mm.fill(); mm.fillStyle = col; mm.beginPath(); mm.arc(dx, dz, r / zoom, 0, 7); mm.fill();
  };
  drawRoute(mm, (x, z) => [(x - px) * MS, (z - pz) * MS], 9 / zoom);
  if (waypoint) edge(waypoint.x, waypoint.z, '#b46cff', 10);
  if (meeting && meeting.state === 'wait') edge(meeting.x, meeting.z, meeting.col, 11);
  // Symbole: Häuser & Krankenhaus (aufrecht trotz Kartendrehung)
  mm.font = `bold ${Math.round(26 / zoom)}px Arial`; mm.textAlign = 'center'; mm.textBaseline = 'middle';
  for (const p of visiblePOIs()) {
    const x = (p.x - px) * MS, z = (p.z - pz) * MS; if (Math.abs(x) > 400 || Math.abs(z) > 400) continue;
    mm.save(); mm.translate(x, z); mm.rotate(-(camYaw - Math.PI));
    mm.fillStyle = '#000'; mm.beginPath(); mm.arc(0, 0, 15 / zoom, 0, 7); mm.fill();
    mm.fillStyle = p.col; mm.fillText(p.sym, 0, 1); mm.restore();
  }
  mm.restore();
  const heading = player.car ? player.car.yaw : player.yaw, a = camYaw - heading;
  mm.save(); mm.translate(W / 2, H * 0.62); mm.rotate(a); mm.fillStyle = '#fff'; mm.strokeStyle = '#000'; mm.lineWidth = 3;
  mm.beginPath(); mm.moveTo(0, -16); mm.lineTo(11, 12); mm.lineTo(0, 6); mm.lineTo(-11, 12); mm.closePath(); mm.stroke(); mm.fill(); mm.restore();
  if (wanted > 0) { mm.strokeStyle = Math.sin(time * 8) > 0 ? 'rgba(255,40,40,.8)' : 'rgba(40,100,255,.8)'; mm.lineWidth = 10; mm.strokeRect(0, 0, W, H); }
}
function updateHUD() {
  $('money').innerHTML = '$' + Math.floor(player.money).toLocaleString('en-US') + `<small>Bank $${Math.floor(player.bank || 0).toLocaleString('en-US')}</small>`;
  $('fare').style.display = ride && ride.state === 'riding' ? 'block' : 'none'; if (ride) $('fare').innerHTML = `${RIDE[ride.kind].name} · $${ride.fare.toFixed(2)} · ${ride.pay === 'card' ? 'Karte' : 'Bar'}<small>${ride.dest ? 'Leertaste: Fahrt überspringen · ' : 'Ziel auf der Karte (M) setzen · '}F: hier aussteigen</small>`;
  const h = Math.floor(gameMin / 60) % 24, m = Math.floor(gameMin % 60);
  $('clock').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  $('stars').innerHTML = [0, 1, 2, 3, 4].map(i => `<span class="${i < wanted ? 'on' : ''}">★</span>`).join('');
  $('stars').className = wantedCool > 0.5 ? 'flash' : '';
  $('stars').style.visibility = wanted > 0 ? 'visible' : 'hidden';
  $('hp').firstChild.style.width = player.hp + '%'; $('ar').firstChild.style.width = player.armor + '%';
  $('hp').firstChild.style.background = player.hp < 30 ? '#d0453a' : '#5dbb4f';
  $('speed').style.display = player.car ? 'block' : 'none';
  if (player.car) $('spv').textContent = Math.round(Math.abs(player.car.speedF || 0) * 3.6);
  $('weapon').textContent = player.car ? (player.car.health < 30 ? '⚠ FAHRZEUG BESCHÄDIGT' : '') : curW().name + (curW().ammo === undefined ? '' : '  ' + (curW().ammo === Infinity ? '∞' : curW().ammo)) + (player.sneak ? '  · SCHLEICHEN' : '') + (scannerOn ? '  · 📻' : '');
  let hint = '';
  if (player.jail && !player.dead) hint = jailHint();
  else if (!player.car && !player.dead && !switching && !player.ride) {
    const home = HOMES[CHARS[cur].home];
    if (INT.inside) hint = interiorHint();
    else if (home && Math.hypot(home.x - player.x, home.z - player.z) < 2) hint = 'Drücke <b>E</b>, um zu schlafen und zu speichern';
    else if (nearestDoor(player.x, player.z, 2.2)) { const b = nearestDoor(player.x, player.z, 2.2); hint = `${floorName(b, 0)} · einfach hineingehen`; }
    else if (nearATM()) hint = 'Drücke <b>E</b> für den Geldautomaten';
    else if (nearVend()) hint = 'Drücke <b>E</b> für den Getränkeautomaten ($1)';
    else if (ride && ride.state === 'waiting' && Math.hypot(...doorPoint(ride.car, -1).map((v, i) => v - (i ? player.z : player.x))) < 6) hint = ride.hailed ? 'Drücke <b>F</b> – Taxi nehmen' : `Drücke <b>F</b>, um in ${ride.kind === 'taxi' ? 'das Taxi' : 'die Limousine'} einzusteigen`;
    else for (const c of cars) if (c.mode !== 'wreck' && c.type !== 'police' && c.mode !== 'service' && !c.ai?.hail && Math.hypot(c.x - player.x, c.z - player.z) < 4.2) { hint = 'Drücke <b>F</b>, um einzusteigen'; break; }
  }
  $('hint').innerHTML = hint; $('hint').style.display = hint ? 'block' : 'none';
  $('cross').style.display = !player.car && player.aimT > 0 ? 'block' : 'none';
}

// ---------- Waffen & Schießen ----------
const tracers = [];
const tracerG = new THREE.BoxGeometry(0.03, 0.03, 1); tracerG.translate(0, 0, 0.5);
const tracerM = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
const flash = new THREE.PointLight(0xffc070, 0, 8, 2); scene.add(flash);
const WEAPONS = [
  { id: 'fist', name: 'FAUST', icon: '✊', dmg: 18, rate: 0.45, melee: true },
  { id: 'pistol', name: 'PISTOLE', icon: '🔫', dmg: 25, rate: 0.22, spread: 0.008, ammo: Infinity, snd: 1, gun: [1, 1, 1] },
  { id: 'smg', name: 'MASCHINENPISTOLE', icon: 'MP', dmg: 17, rate: 0.08, spread: 0.03, auto: true, ammo: 600, snd: 0.75, gun: [1.2, 1.3, 1.7] },
  { id: 'shotgun', name: 'SCHROTFLINTE', icon: 'SF', dmg: 13, pellets: 8, rate: 0.85, spread: 0.07, ammo: 60, snd: 1.7, gun: [1.4, 1.1, 3.1] },
  { id: 'rifle', name: 'STURMGEWEHR', icon: 'SG', dmg: 30, rate: 0.12, spread: 0.014, auto: true, ammo: 360, snd: 1.25, gun: [1.4, 1.4, 3.3] },
  { id: 'grenade', name: 'GRANATE', icon: '💣', rate: 1.0, throw: true, ammo: 10 },
];
let weapon = 1;
const curW = () => WEAPONS[weapon];
const _ray = new THREE.Raycaster(), _v2 = new THREE.Vector2();
function muzzlePos() {
  return new THREE.Vector3(player.x - Math.cos(player.yaw) * 0.3 + Math.sin(player.yaw) * 0.6, player.y + 1.45, player.z + Math.sin(player.yaw) * 0.3 + Math.cos(player.yaw) * 0.6);
}
function fireRay(o, d, dmg) {
  let best = 150, hitPed = null, hitCar = null;
  for (const p of [...peds, ...INT.npcs, ...officers]) {
    if (p.state === 'dead') continue;
    const tpx = p.wx ?? p.x, tpz = p.wz ?? p.z, ty = p.wy ?? 0, c = new THREE.Vector3(tpx, ty + 1.0, tpz), t = c.clone().sub(o).dot(d); if (t < 0 || t > best) continue;
    const q = o.clone().addScaledVector(d, t);
    if (Math.hypot(q.x - tpx, q.z - tpz) < 0.4 && q.y > ty && q.y < ty + 1.85) { best = t; hitPed = p; hitCar = null; }
  }
  for (const c of cars) {
    if (c === player.car) continue;
    const inv = new THREE.Matrix4().copy(c.group.matrixWorld).invert();
    const lo = o.clone().applyMatrix4(inv), ld = d.clone().transformDirection(inv);
    const t = rayBox(lo, ld, c.T.W / 2, 1.5, c.T.L / 2); if (t !== null && t < best && t > 0) { best = t; hitCar = c; hitPed = null; }
  }
  for (let t = 1; t < best; t += 0.5) { const q = o.clone().addScaledVector(d, t); if (q.y < 0 || solidAt(q.x, q.y, q.z)) { best = t; hitPed = hitCar = null; break; } }
  const hit = o.clone().addScaledVector(d, best), muzzle = muzzlePos();
  const tr = new THREE.Mesh(tracerG, tracerM); tr.position.copy(muzzle); tr.lookAt(hit); tr.scale.z = muzzle.distanceTo(hit); scene.add(tr); tracers.push({ m: tr, t: 0.05 });
  if (hitPed) { hitPed.hp -= dmg; for (let i = 0; i < 8; i++) emit(smoke, hit.x, hit.y, hit.z, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), 0.5, 0.15, 0.2, 0.5, 0, 0); if (hitPed.hp <= 0) killPed(hitPed); }
  else if (hitCar) { hitCar.pHit = SIG.t; damageCar(hitCar, dmg * (hitCar.type === 'police' ? 0.36 : 0.28)); if (hitCar.type === 'police') addWanted(0, Math.max(2, wanted)); for (let i = 0; i < 6; i++) emit(fire, hit.x, hit.y, hit.z, rnd(-3, 3), rnd(0, 3), rnd(-3, 3), 0.15, 0.12, 0, 1, 0.8, 0.3); }
  else for (let i = 0; i < 4; i++) emit(smoke, hit.x, hit.y, hit.z, rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1), 0.7, 0.3, 0.6, 0.6, 0.58, 0.55);
}
function crimeNoise() {
  if (INT.inside) { if (INT.npcs.some(n => n.state !== 'dead')) { reportCrime('shooting', player.x, player.z, 2, true); iPanic(); } }
  else {
    scarePeds(player.x, player.z, 45);
    reportCrime('shooting', player.x, player.z, 2);
  }
}
function attack() {
  const w = curW();
  if (w.melee) {
    player.punchT = 0.25; sfx.hit();
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    for (const p of [...peds, ...INT.npcs, ...officers]) {
      if (p.state === 'dead') continue;
      const px = p.wx ?? p.x, pz = p.wz ?? p.z, dx = px - player.x, dz = pz - player.z, d = Math.hypot(dx, dz);
      if (d < 1.6 && (dx * fx + dz * fz) / (d || 1) > 0.4) {
        p.hp -= w.dmg; sfx.pain(px, pz); if (p.hp <= 0) killPed(p, true);
        else { if (p.F) iPanic(); else { scarePeds(px, pz, 6); reportCrime('assault', px, pz, 1); } }
        break;
      }
    }
    return;
  }
  if (w.ammo <= 0) { notice('Keine Munition', 900); return; }
  w.ammo--;
  if (w.throw) { throwGrenade(); return; }
  _ray.setFromCamera(_v2.set(0, 0), camera);
  for (let k = 0; k < (w.pellets || 1); k++) {
    const d = _ray.ray.direction.clone(); const s = w.spread * (player.sneak ? 0.6 : 1);
    d.x += rnd(-s, s); d.y += rnd(-s, s); d.z += rnd(-s, s); d.normalize();
    fireRay(_ray.ray.origin, d, w.dmg);
  }
  const muzzle = muzzlePos(); flash.position.copy(muzzle); flash.intensity = 30;
  emit(fire, muzzle.x, muzzle.y, muzzle.z, 0, 0, 0, 0.06, 0.4, 0, 1, 0.8, 0.4);
  sfx.shot(undefined, undefined, w.snd);
  crimeNoise();
}
const grenades = [];
const grenadeG = new THREE.SphereGeometry(0.09, 12, 8), grenadeM = new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6 });
function throwGrenade() {
  const d = new THREE.Vector3(); camera.getWorldDirection(d);
  const m = new THREE.Mesh(grenadeG, grenadeM); const p = muzzlePos(); m.position.copy(p); scene.add(m);
  grenades.push({ m, v: d.multiplyScalar(15).add(new THREE.Vector3(0, 4.5, 0)), t: 2.2 });
  player.punchT = 0.3;
}
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i]; g.t -= dt; g.v.y -= 14 * dt;
    const p = g.m.position, nx = p.x + g.v.x * dt, nz = p.z + g.v.z * dt;
    if (solidAt(nx, p.y, nz)) { g.v.x *= -0.4; g.v.z *= -0.4; } else { p.x = nx; p.z = nz; }
    p.y += g.v.y * dt; const gh = floorH(p.x, p.z, p.y) + 0.09;
    if (p.y < gh) { p.y = gh; g.v.y *= -0.35; g.v.x *= 0.7; g.v.z *= 0.7; }
    if (g.t <= 0) { scene.remove(g.m); grenades.splice(i, 1); explosion(p.x, p.y, p.z); crimeNoise(); reportCrime('shooting', p.x, p.z, 2); }
  }
}
// Waffenrad (Tab gedrückt halten)
const wheelUI = { open: false, x: 0, y: 0 };
function openWheel() {
  if (wheelUI.open || player.car || player.dead) return;
  wheelUI.open = true; wheelUI.x = wheelUI.y = 0; wheelUI.sel = weapon; renderWheel(); $('wheel').style.display = 'block';
}
function closeWheel() {
  if (!wheelUI.open) return; wheelUI.open = false; $('wheel').style.display = 'none';
  if (wheelUI.sel !== weapon) { weapon = wheelUI.sel; notice(curW().name, 900); sfx.door(); }
}
function wheelMove(dx, dy) {
  wheelUI.x = clamp(wheelUI.x + dx, -120, 120); wheelUI.y = clamp(wheelUI.y + dy, -120, 120);
  if (Math.hypot(wheelUI.x, wheelUI.y) > 40) {
    const a = (Math.atan2(wheelUI.x, -wheelUI.y) + Math.PI * 2) % (Math.PI * 2), k = Math.round(a / (Math.PI * 2 / WEAPONS.length)) % WEAPONS.length;
    if (k !== wheelUI.sel) { wheelUI.sel = k; renderWheel(); }
  }
}
function renderWheel() {
  const n = WEAPONS.length;
  $('wheel').innerHTML = WEAPONS.map((w, k) => {
    const a = k / n * Math.PI * 2, x = Math.sin(a) * 36, y = -Math.cos(a) * 36;
    return `<div class="ws${k === wheelUI.sel ? ' sel' : ''}" style="left:calc(50% + ${x}vmin);top:calc(50% + ${y}vmin)"><b>${w.icon}</b><span>${w.name}</span><i>${w.ammo === undefined ? '' : w.ammo === Infinity ? '∞' : w.ammo}</i></div>`;
  }).join('') + `<div class="wc">${WEAPONS[wheelUI.sel].name}</div>`;
}
function cycleWeapon(dir) { if (player.car) return; weapon = (weapon + dir + WEAPONS.length) % WEAPONS.length; notice(curW().name, 800); }

// ---------- Stadtteile, Wegpunkt, Karte, Polizeifunk, Handy ----------
const DISTRICTS = [['Rockford-Hügel', 'Nordhügel', 'Mirror Park'], ['Weststrand', 'Innenstadt', 'Ostpark'], ['Hafenviertel', 'Grove', 'Davis-Süd']];
let POI_BLD = null;
function visiblePOIs() {
  if (!POI_BLD) { POI_BLD = []; for (const b of BUILDINGS) if (b.door && (b.type === 'bank' || b.type === 'hotel')) POI_BLD.push({ x: b.door.x, z: b.door.z, col: b.type === 'bank' ? '#2fbf5a' : '#ff7ac8', sym: b.type === 'bank' ? '$' : 'H' }); }
  return [...POIS.filter(p => !p.home || p.home === CHARS[cur].home), ...POI_BLD];
}
const LEGEND = [['⌂', '#9be389', 'Dein Zuhause'], ['+', '#ff4040', 'Krankenhaus'], ['P', '#4a7dff', 'Polizei'], ['⛓', '#d8a860', 'Gefängnis'], ['S', '#ff6a3a', 'Supermarkt'], ['G', '#3aa0ff', 'Tankstelle'], ['$', '#2fbf5a', 'Bank'], ['H', '#ff7ac8', 'Hotel']];
function districtOf(x, z) { const f = v => v < -EXT / 3 ? 0 : v > EXT / 3 ? 2 : 1; return DISTRICTS[f(z)][f(x)]; }
let waypoint = null;
const wpBeam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 160, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xb46cff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
wpBeam.visible = false; scene.add(wpBeam);
function setWaypoint(x, z, quiet = false) {
  waypoint = x == null ? null : { x, z };
  wpBeam.visible = !!waypoint; if (waypoint) wpBeam.position.set(x, 80, z);
  if (!quiet) notice(waypoint ? 'Wegpunkt gesetzt · ' + districtOf(x, z) : 'Wegpunkt entfernt', 1400);
}
let navRoute = null, navT = 0;
function roadProj(x, z) {
  const kx = clamp(Math.round(x / P + N / 2), 0, N), kz = clamp(Math.round(z / P + N / 2), 0, N), rx = roadPos(kx), rz = roadPos(kz);
  const cx = clamp(x, roadPos(0), roadPos(N)), cz = clamp(z, roadPos(0), roadPos(N));
  return Math.abs(x - rx) < Math.abs(z - rz) ? { x: rx, z: cz, v: true } : { x: cx, z: rz, v: false };
}
function computeRoute(sx, sz, tx, tz) {
  const S = roadProj(sx, sz), D = roadProj(tx, tz), pts = [[sx, sz], [S.x, S.z]];
  const bestLine = (a, b) => { let best = null; for (let k = 0; k <= N; k++) { const q = roadPos(k), l = Math.abs(a - q) + Math.abs(q - b) + Math.abs(a - q) * 0.01; if (!best || l < best[1]) best = [q, l]; } return best[0]; };
  if (S.v && D.v) { if (Math.abs(S.x - D.x) > 1) { const q = bestLine(S.z, D.z); pts.push([S.x, q], [D.x, q]); } }
  else if (!S.v && !D.v) { if (Math.abs(S.z - D.z) > 1) { const q = bestLine(S.x, D.x); pts.push([q, S.z], [q, D.z]); } }
  else if (S.v) pts.push([S.x, D.z]); else pts.push([D.x, S.z]);
  pts.push([D.x, D.z], [tx, tz]);
  return pts.filter((p0, i) => i === 0 || Math.hypot(p0[0] - pts[i - 1][0], p0[1] - pts[i - 1][1]) > 0.5);
}
function updateNav(dt) {
  const el = $('nav'), tgt = waypoint || (meeting && meeting.state === 'wait' ? meeting : null);
  if (!tgt || INT.inside || player.dead) { navRoute = null; if (el.style.display !== 'none') el.style.display = 'none'; return; }
  const p = player.car || (player.rideSeat && ride ? ride.car : player);
  if ((navT -= dt) <= 0 || !navRoute) { navT = 0.5; navRoute = computeRoute(p.x, p.z, tgt.x, tgt.z); }
  let len = 0; for (let i = 1; i < navRoute.length; i++) len += Math.hypot(navRoute[i][0] - navRoute[i - 1][0], navRoute[i][1] - navRoute[i - 1][1]);
  // nächste Abbiegung
  let txt = '';
  for (let i = 2; i < navRoute.length - 1; i++) {
    const a = navRoute[i - 1], b = navRoute[i], c = navRoute[i + 1], d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
    if (Math.hypot(...d1) < 2 || Math.hypot(...d2) < 2) continue;
    const cr = d1[0] * d2[1] - d1[1] * d2[0], dist = Math.hypot(b[0] - p.x, b[1] - p.z); if (Math.abs(cr) < 1e-3) continue;
    txt = `<b>${cr < 0 ? '↰' : '↱'}</b> In ${dist < 1000 ? Math.round(dist / 10) * 10 + ' m' : (dist / 1000).toFixed(1) + ' km'} ${cr < 0 ? 'links' : 'rechts'} abbiegen`; break;
  }
  if (!txt) txt = '<b>⬆</b> Dem Straßenverlauf folgen';
  if (len < 25) txt = '<b>⚑</b> Ziel erreicht';
  el.innerHTML = `${txt}<small>${len < 1000 ? Math.round(len) + ' m' : (len / 1000).toFixed(1) + ' km'} · ${districtOf(tgt.x, tgt.z)}</small>`;
  if (el.style.display !== 'block') el.style.display = 'block';
}
function drawRoute(ctx, map, lw) {
  if (!navRoute) return;
  ctx.save(); ctx.lineJoin = ctx.lineCap = 'round';
  for (const [col, w] of [['rgba(0,0,0,.75)', lw * 1.9], ['#b46cff', lw]]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); navRoute.forEach(([x, z], i) => { const [a, b] = map(x, z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.stroke(); }
  ctx.restore();
}
function updateWaypoint() {
  if (!waypoint) return;
  wpBeam.visible = !INT.inside;
  const p = player.car || player;
  if (!meeting && Math.hypot(waypoint.x - p.x, waypoint.z - p.z) < 8) { setWaypoint(null, null, true); notice('Ziel erreicht', 1400); }
}
// Große Karte (M)
const bigMap = { open: false };
const bm = $('bigmap'), bmc = bm.querySelector('canvas'), bmx = bmc.getContext('2d');
let satCanvas = null; const SAT_HALF = EXT + 120;
function renderSatellite() {
  const S = 2048, rt = new THREE.WebGLRenderTarget(S, S);
  const cam = new THREE.OrthographicCamera(-SAT_HALF, SAT_HALF, SAT_HALF, -SAT_HALF, 10, 3000); cam.position.set(0, 1500, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0);
  const fog = scene.fog; scene.fog = null; const sw = [sun.castShadow, skyDome.visible]; skyDome.visible = false;
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null); scene.fog = fog; skyDome.visible = sw[1];
  const buf = new Uint8Array(S * S * 4); renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf); rt.dispose();
  satCanvas = document.createElement('canvas'); satCanvas.width = satCanvas.height = S;
  const cx = satCanvas.getContext('2d'), img = cx.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = ((S - 1 - y) * S + x) * 4, o = (y * S + x) * 4;
    for (let k = 0; k < 3; k++) { const v = buf[i + k] / 255 * 1.25; img.data[o + k] = Math.min(255, Math.pow(v / (1 + v * 0.35), 1 / 2.2) * 265); }
    img.data[o + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
}
function openMap() {
  bigMap.open = true; bm.style.display = 'flex'; drawBigMap();
  document.exitPointerLock?.();
}
function closeMap() { bigMap.open = false; bm.style.display = 'none'; canvas.requestPointerLock?.(); }
function drawBigMap() {
  const S = bmc.width, w2s = (x, z) => [(x + SAT_HALF) / (2 * SAT_HALF) * S, (z + SAT_HALF) / (2 * SAT_HALF) * S];
  if (satCanvas) bmx.drawImage(satCanvas, 0, 0, S, S); else bmx.drawImage(mapCanvas, 0, 0, S, S);
  bmx.fillStyle = 'rgba(10,14,20,.18)'; bmx.fillRect(0, 0, S, S);
  bmx.font = 'bold 26px Arial'; bmx.textAlign = 'center'; bmx.lineWidth = 5; bmx.strokeStyle = 'rgba(0,0,0,.7)'; bmx.fillStyle = 'rgba(255,255,255,.9)';
  DISTRICTS.forEach((row, j) => row.forEach((n, i) => { const [a, b] = w2s(-EXT + EXT * 2 * (i + 0.5) / 3, -EXT + EXT * 2 * (j + 0.5) / 3); bmx.strokeText(n.toUpperCase(), a, b); bmx.fillText(n.toUpperCase(), a, b); }));
  for (const [n, x, z] of [['PAZIFIK', -EXT - 90, 0], ['VINEWOOD HILLS', -150, -EXT - 80], ['HAFEN', 260, EXT + 80]]) { const [a, b] = w2s(x, z); bmx.strokeText(n, a, b); bmx.fillText(n, a, b); }
  const dot = (x, z, col, r, sym) => { const [a, b] = w2s(x, z); bmx.fillStyle = '#000'; bmx.beginPath(); bmx.arc(a, b, r + 3, 0, 7); bmx.fill(); bmx.fillStyle = col; bmx.beginPath(); bmx.arc(a, b, r, 0, 7); bmx.fill(); if (sym) { bmx.fillStyle = '#000'; bmx.font = `bold ${r * 1.4}px Arial`; bmx.textBaseline = 'middle'; bmx.fillText(sym, a, b + 1); } };
  drawRoute(bmx, w2s, 6);
  for (const p of visiblePOIs()) dot(p.x, p.z, p.col, 11, p.sym);
  { bmx.save(); const lx = 18, ly = S - 26 - LEGEND.length * 30; bmx.fillStyle = 'rgba(8,10,14,.72)'; bmx.fillRect(lx - 8, ly - 26, 210, LEGEND.length * 30 + 22);
    bmx.textAlign = 'left'; bmx.textBaseline = 'middle'; LEGEND.forEach(([sy, col, name], k) => { const y = ly + k * 30; bmx.fillStyle = '#000'; bmx.beginPath(); bmx.arc(lx + 12, y, 13, 0, 7); bmx.fill(); bmx.fillStyle = col; bmx.font = 'bold 17px Arial'; bmx.textAlign = 'center'; bmx.fillText(sy, lx + 12, y + 1); bmx.textAlign = 'left'; bmx.fillStyle = '#fff'; bmx.font = 'bold 18px Arial'; bmx.fillText(name, lx + 34, y + 1); }); bmx.restore(); }
  for (const c of cars) if (c.type === 'police') dot(c.x, c.z, '#ff3b3b', 6);
  if (meeting) dot(meeting.x, meeting.z, meeting.col, 10, '★');
  if (waypoint) dot(waypoint.x, waypoint.z, '#b46cff', 10);
  const pp = player.car || player, [px, pz] = w2s(pp.x, pp.z), h = player.car ? player.car.yaw : player.yaw;
  bmx.save(); bmx.translate(px, pz); bmx.rotate(Math.PI - h); bmx.fillStyle = '#fff'; bmx.strokeStyle = '#000'; bmx.lineWidth = 3;
  bmx.beginPath(); bmx.moveTo(0, -16); bmx.lineTo(11, 12); bmx.lineTo(0, 6); bmx.lineTo(-11, 12); bmx.closePath(); bmx.stroke(); bmx.fill(); bmx.restore();
}
bmc.addEventListener('mousedown', e => {
  const r = bmc.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * SAT_HALF * 2 - SAT_HALF, z = (e.clientY - r.top) / r.height * SAT_HALF * 2 - SAT_HALF;
  if (e.button === 2) setWaypoint(null); else setWaypoint(x, z);
  drawBigMap();
});
// Polizeifunk-Scanner (F3)
let scannerOn = false, scanT = 6;
const SCAN = freshList(['Einheit {n}, Ruhestörung in {d}, bitte prüfen.', 'Zentrale an alle: Verkehrsunfall in {d}, Krankenwagen ist unterwegs.', 'Einheit {n}, verdächtige Person in {d} gemeldet.', 'Ladendiebstahl in {d}, Täter flüchtig zu Fuß.', 'Einheit {n} meldet sich ab, Mittagspause.', 'Alle Einheiten: Raser in {d}, rotes Coupé.', 'Einheit {n}, Hund ohne Leine in {d}. Ja, wirklich.', 'Streit vor einem Club in {d}, zwei Einheiten bitte.',
  'Einheit {n}, Fahrzeug blockiert die Einfahrt in {d}.', 'Zentrale: Alarmanlage ausgelöst in {d}, vermutlich Fehlalarm.', 'Alle Einheiten: Betrunkener Fahrradfahrer in {d}.', 'Einheit {n}, Beschwerde über Lärm vom Nachbarn in {d}.', 'Zentrale an alle: Ampelausfall in {d}, bitte Verkehr regeln.', 'Einheit {n}, Tankstellenräuber in {d} gemeldet, Täter flüchtig.', 'Alle Einheiten: Vermisstes Kind in {d}, trägt rote Jacke.', 'Zentrale: Straßenkünstler ohne Genehmigung in {d}.', 'Einheit {n}, Taschendiebstahl in {d}, Verdächtiger trägt Kapuze.', 'Alle Einheiten: Wildes Parken in {d}, bitte Abschleppwagen schicken.', 'Einheit {n}, Streit zwischen Taxifahrern in {d}.', 'Zentrale an Einheit {n}: Kaffeepause genehmigt, aber nur kurz.', 'Alle Einheiten: Gestohlenes Motorrad in {d} gesichtet.', 'Zentrale, ein Mann klettert in {d} auf ein Dach. Wer ist in der Nähe?', 'Einheit {n}, Demonstration in {d}, bitte Lage beobachten.', 'Zentrale an alle: Wasserrohrbruch in {d}, Straße gesperrt.', 'Alle Einheiten: Verdächtiges Paket in {d}, bitte Abstand halten.', 'Einheit {n}, Lieferwagen steht quer in {d}.', 'Zentrale: Anwohner meldet Schüsse in {d}. Es war ein Feuerwerk.',
  'Einheit {n}, Streife beendet, fahre zurück zur Wache.', 'Zentrale an alle: Der Donutladen an der Ecke hat wieder geöffnet.', 'Alle Einheiten: Funkdisziplin, bitte.', 'Einheit {n}, bitte melden. Einheit {n}, bitte melden!', 'Zentrale an alle: Schichtwechsel in zehn Minuten.', 'Ladendiebstahl in einem Supermarkt, Täter ist mit einer Gurke geflohen.', 'Alle Einheiten: Wer hat das Funkgerät im Wagen vier liegen lassen?', 'Zentrale: Bitte die Lautstärke am Funk reduzieren, wir hören euch.',
  'Zentrale an alle: Ein Eiswagen steht seit einer Stunde falsch in {d}.', 'Alle Einheiten: Papageien-Entlaufmeldung in {d}, Tier ist laut und flüchtig.', 'Zentrale: Lieferdienst verfährt sich in {d}, Anwohner rufen an.', 'Alle Einheiten: Wohnmobil fährt Schlangenlinien in {d}.', 'Zentrale an alle: Filmdreh in {d}, bitte Straße nicht sperren.', 'Alle Einheiten: Jemand hat in {d} Graffiti an die Wache gesprüht.', 'Zentrale: Beschwerde über Drohnen über {d}.', 'Alle Einheiten: Schlägerei vor einer Bar in {d}, Kellner ruft an.', 'Einheit {n}, Fahrraddiebstahl in {d}, Zeuge wartet vor Ort.', 'Einheit {n}, Trunkenheit am Steuer in {d}, bitte Kontrolle.', 'Einheit {n}, Nachbarschaftsstreit in {d}, es geht um einen Zaun.', 'Einheit {n}, Einbruchsalarm in {d}, bitte prüfen und melden.']);
const CRIME_RADIO = ['Zentrale an alle Einheiten: {c} in {d}. Verdächtiger flüchtig.', 'Achtung, alle Einheiten: {c} gemeldet, {d}. Täter ist auf der Flucht.', '{c} in {d}. Alle verfügbaren Einheiten bitte melden.', 'Zentrale: Meldung aus {d}, {c}. Streifen bitte hinfahren.'];
function updateScanner(dt) {
  if (!scannerOn) return;
  scanT -= dt;
  if (scanT < 0) {
    scanT = wanted > 0 ? rnd(6, 10) : rnd(12, 22);
    const tgt = playerVeh() || player, lsd = lastSeen.car && cars.includes(lastSeen.car) ? ` ${carDesc(lastSeen.car)}` : lastSeen.foot ? ' zu Fuß' : '';
    const line = wanted > 0
      ? pick([`Verdächtiger${lsd ? ' ' + (lastSeen.foot ? 'zu Fuß' : 'in' + lsd) : ''} zuletzt gesehen in ${districtOf(lastSeen.x, lastSeen.z)}.`, `Alle Einheiten nach ${districtOf(lastSeen.x, lastSeen.z)}, Verdächtiger ist bewaffnet.`, wantedCool > 2 ? `Kein Sichtkontakt mehr, wir durchsuchen ${districtOf(lastSeen.x, lastSeen.z)}.` : `Sichtkontakt in ${districtOf(tgt.x, tgt.z)}, Verfolgung läuft.`, `Zentrale, Verdächtiger zuletzt in ${districtOf(lastSeen.x, lastSeen.z)} gesehen, alle Wagen dorthin.`, `Verfolgung geht weiter, Richtung ${districtOf(tgt.x, tgt.z)}.`])
      : pick(SCAN).replace('{n}', pick([7, 12])).replace('{d}', pick(DISTRICTS.flat()));
    say(line, { who: 'Polizeifunk', color: '#6fa8ff', pitch: 0.7, rate: 1.15, vol: 0.7, radio: true });
  }
}
// Handy (P): Kontakte anrufen und Treffen vereinbaren
const phone = { open: false, screen: 'home', sel: 0, busy: false };
let meeting = null;
const EXTRA_CONTACTS = [
  { name: 'Jamal', col: '#ffd23a', look: { gender: 'm', skin: '#6a4030', shirt: '#4a9a5f', pants: '#1f2a44', shoes: '#f0f0f0', hair: '#0e0906', beard: 0.4, hairStyle: 'buzz', hat: '#222222' }, activity: 'Basketball im Park' },
  { name: 'Tante Gloria', col: '#ff8ac8', look: { gender: 'f', tint: '#ffd0e0' }, activity: 'Kaffee trinken' },
  { name: 'Lester-Hacker', col: '#9be3ff', look: { gender: 'm', skin: '#f2dccb', shirt: '#8a8e7a', pants: '#4a4a44', shoes: '#3a2a1c', hair: '#6a5a4a', beard: 0.5, hairStyle: 'bald', hat: '#3a3a3a' }, activity: 'Pläne besprechen' },
];
const CALL_LINES = {
  greet: ['Hey, was geht? Lust dich zu treffen?', 'Na, hast du kurz Zeit? Lass uns treffen.', 'Yo, ich bin in der Gegend. Treffen?', 'Hallo, ich bin es. Hast du heute noch was vor?', 'Na du, lange nichts gehört. Treffen wir uns?', 'Hey, ich langweile mich. Komm, wir hängen ein bisschen ab.', 'Was machst du gerade? Ich hätte Zeit.', 'Ich wollte nur kurz fragen, ob du Lust auf ein Treffen hast.', 'Sag mal, hättest du Zeit für mich?', 'Hi, hier ist es nur ruhig. Wollen wir was unternehmen?', 'Hey, ich brauche eine Pause. Treffen wir uns?', 'Du, ich muss mal raus. Kommst du mit?', 'Alter, bist du da? Komm, wir treffen uns.', 'Hallo? Ich hoffe, ich störe nicht. Treffen wir uns kurz?'],
  yes: ['Klar, ich warte auf dich: {p}.', 'Okay, wir sehen uns. Treffpunkt: {p}.', 'Gute Idee. Treffpunkt {p}, bis gleich.', 'Okay, dann los. Ich bin schon unterwegs, {p}.', 'Klar doch, bin unterwegs.', 'Gute Idee, ich komme sofort.', 'Na klar, ich warte schon.', 'Sehr gern, bis gleich!', 'Super, ich bin in zehn Minuten da.', 'Perfekt, ich hab sowieso nichts vor.', 'Machen wir. Ich bring auch was zu trinken mit.', 'Gern, ich freu mich. Bis gleich!'],
  wanted: ['Bist du verrückt? Ruf mich an, wenn du die Bullen los bist!', 'Nicht mit der Polizei an den Fersen, Mann.', 'Hör mal, die Cops sind hinter dir. Ruf später an!', 'Ich seh es im Fernsehen. Erst Polizei abschütteln, dann reden wir.', 'Ich will nichts mit der Polizei zu tun haben. Tschüss!', 'Wie bitte? Du bist gesucht! Auflegen, sofort!', 'Nicht jetzt, du hast die Polizei im Nacken!', 'Wenn du Sirenen hörst, ruf mich bitte nicht an.', 'Ich kann gerade nicht. Bring erst deinen Ärger in Ordnung.', 'Keine Chance. Mit dir gibt es gerade nur Stress.'],
  talk: [
    ['Schön, dass du da bist.', 'Klar doch. Wie läuft das Geschäft?'],
    ['Läuft. Ich hab da so ein Ding am Laufen.', 'Erzähl mir lieber nichts davon.'],
    ['Wir sollten das öfter machen.', 'Auf jeden Fall. Pass auf dich auf da draußen.'],
    ['Wie geht es der Familie?', 'Besser, als ich dachte. Und bei dir?'],
    ['Hast du die Nachrichten gesehen?', 'Ich versuche, sie zu ignorieren.'],
    ['Der Kaffee hier ist übrigens gar nicht schlecht.', 'Das sagst du, weil du ihn nicht bezahlt hast.'],
    ['Los Santos wird jeden Tag verrückter.', 'Es war nie anders. Wir haben uns nur dran gewöhnt.'],
    ['Ich hab neulich fast einen Strafzettel bekommen.', 'Fast? Dann bist du ja ein Profi.'],
    ['Sag mal, ist das Wetter immer so?', 'Immer. Deshalb zieht jeder hierher.'],
    ['Was Neues in der Szene?', 'Nichts, was ich dir erzählen darf.'],
    ['Manchmal frage ich mich, wo das alles hinführt.', 'Hauptsache, wir sind dabei, wenn es knallt.'],
    ['Hast du eigentlich mal Urlaub gemacht?', 'Urlaub? Ich weiß nicht mal, wie man das schreibt.'],
    ['Ich hab neulich einen Film gesehen, der war echt schlecht.', 'In dieser Stadt gibt es nur schlechte Filme.'],
    ['Weißt du noch, wie wir uns kennengelernt haben?', 'Wie könnte ich das vergessen? Das war ein Chaos.'],
  ],
};
freshAll(CALL_LINES);
function contacts() {
  return [...EXTRA_CONTACTS, { name: 'Downtown Cab Co.', col: '#f2c200', ride: 'taxi' }, { name: 'Chauffeur-Service', col: '#c9b27a', ride: 'chauffeur' }];
}
function phoneApps() { return [{ id: 'ride', name: 'LS Ride', ico: '🚕' }, { id: 'bank', name: 'Fleeca Bank', ico: '🏦' }, { id: 'contacts', name: 'Kontakte', ico: '👤' }, { id: 'scanner', name: scannerOn ? 'Funk: AN' : 'Funk: AUS', ico: '📻' }, { id: 'map', name: 'Karte', ico: '🗺️' }, { id: 'meet', name: meeting ? 'Treffen absagen' : 'Kein Termin', ico: '📅' }]; }
function renderPhone() {
  const el = $('phone'), h = Math.floor(gameMin / 60) % 24, m = Math.floor(gameMin % 60);
  let body = '';
  if (phone.screen === 'home') body = `<div class="apps">${phoneApps().map((a, k) => `<div class="app${k === phone.sel ? ' sel' : ''}"><b>${a.ico}</b><span>${a.name}</span></div>`).join('')}</div>`;
  else if (phone.screen === 'contacts') body = `<div class="ttl">Kontakte</div>${contacts().map((c, k) => `<div class="row${k === phone.sel ? ' sel' : ''}"><i style="background:${c.col}"></i>${c.name}</div>`).join('')}`;
  else if (phone.screen === 'ride') {
    const est = k => waypoint ? 'ca. ' + fmt(rideEstimate(k)) : 'ab ' + fmt(RIDE[k].base);
    body = `<div class="ttl">LS Ride</div>${['taxi', 'chauffeur'].map((k, i) => `<div class="row ro${i === phone.sel ? ' sel' : ''}"><b>${k === 'taxi' ? '🚕' : '🚘'}</b><div>${RIDE[k].name}<small>${k === 'taxi' ? 'Du steigst selbst ein' : 'Fahrer öffnet dir die Tür'} · ${est(k)}</small></div></div>`).join('')}<div class="row${phone.sel === 2 ? ' sel' : ''}">Zahlung: <b>${(phone.pay || 'card') === 'card' ? '💳 Karte' : '💵 Bar'}</b></div><small class="ri">${waypoint ? 'Ziel: ' + districtOf(waypoint.x, waypoint.z) : 'Ziel später auf der Karte (M) setzen'}</small>`;
  }
  else if (phone.screen === 'ridestatus') body = rideStatusHTML();
  else if (phone.screen === 'bank') body = `<div class="ttl">Fleeca Mobile</div><div class="bank"><small>Girokonto</small><b>${fmt(player.bank || 0)}</b><small>Bargeld</small><b>${fmt(player.money)}</b></div><small class="ri">Ein- und Auszahlen am Geldautomaten oder am Schalter einer Fleeca-Filiale.</small>`;
  else if (phone.screen === 'call') body = `<div class="call"><i style="background:${phone.who.col}"></i><div>${phone.who.name}</div><small>${phone.status}</small></div>`;
  el.innerHTML = `<div class="bar">${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} <span>LS-Mobil ▂▄▆</span></div>${body}<div class="hint">W/S · E wählen · P/Rück zurück</div>`;
  if (phone.screen === 'ridestatus') drawRideMap();
}
function openPhone() { if (player.dead || switching) return; phone.open = true; phone.screen = 'home'; phone.sel = 0; $('phone').style.display = 'block'; renderPhone(); sfx.click(); }
function closePhone() { phone.open = false; $('phone').style.display = 'none'; }
function phoneKey(code) {
  if (phone.busy) return;
  const list = phone.screen === 'home' ? phoneApps() : phone.screen === 'contacts' ? contacts() : phone.screen === 'ride' ? [0, 1, 2] : phone.screen === 'ridestatus' ? [0] : [];
  if (code === 'KeyW' || code === 'ArrowUp') phone.sel = (phone.sel - (phone.screen === 'home' ? 2 : 1) + list.length) % Math.max(1, list.length);
  else if (code === 'KeyS' || code === 'ArrowDown') phone.sel = (phone.sel + (phone.screen === 'home' ? 2 : 1)) % Math.max(1, list.length);
  else if (code === 'KeyA' || code === 'ArrowLeft') phone.sel = Math.max(0, phone.sel - 1);
  else if (code === 'KeyD' || code === 'ArrowRight') phone.sel = Math.min(list.length - 1, phone.sel + 1);
  else if (code === 'Backspace' || code === 'KeyP') { if (phone.screen === 'home') return closePhone(); phone.screen = 'home'; phone.sel = 0; }
  else if (code === 'KeyE' || code === 'Enter') {
    if (phone.screen === 'home') {
      const a = list[phone.sel].id;
      if (a === 'contacts') { phone.screen = 'contacts'; phone.sel = 0; }
      else if (a === 'ride') { phone.screen = ride ? 'ridestatus' : 'ride'; phone.sel = 0; }
      else if (a === 'bank') { phone.screen = 'bank'; phone.sel = 0; }
      else if (a === 'scanner') { scannerOn = !scannerOn; scanT = 2; notice('Polizeifunk ' + (scannerOn ? 'an' : 'aus'), 1200); }
      else if (a === 'map') { closePhone(); openMap(); return; }
      else if (a === 'meet' && meeting) { cancelMeeting(); notice('Treffen abgesagt', 1400); }
    } else if (phone.screen === 'ride') {
      if (phone.sel === 2) phone.pay = (phone.pay || 'card') === 'card' ? 'cash' : 'card';
      else if (requestRide(phone.sel ? 'chauffeur' : 'taxi', phone.pay || 'card')) { phone.screen = 'ridestatus'; phone.sel = 0; }
    } else if (phone.screen === 'ridestatus') { if (ride) cancelRide(); else { phone.screen = 'home'; phone.sel = 0; } }
    else if (phone.screen === 'contacts') { const cn = list[phone.sel]; if (cn.ride) { callRide(cn); return; } callContact(cn); }
  }
  sfx.click(); renderPhone();
}
function callContact(c) {
  phone.screen = 'call'; phone.who = c; phone.status = 'Wählt …'; phone.busy = true; renderPhone(); sfx.ring();
  const me = CHARS[cur];
  setTimeout(() => {
    phone.status = 'Verbunden'; renderPhone();
    say(pick(CALL_LINES.greet), { who: me.name, color: me.col, prio: true });
    setTimeout(() => {
      if (wanted > 0) { say(pick(CALL_LINES.wanted), { who: c.name, color: c.col, prio: true, pitch: 0.9 }); }
      else {
        const spot = meetingSpot(); cancelMeeting();
        meeting = { ...spot, who: c, col: c.col, state: 'wait' };
        say(pick(CALL_LINES.yes).replace('{p}', spot.place), { who: c.name, color: c.col, prio: true, pitch: c.char === undefined ? 1.05 : 0.95 });
        placeMeetingPerson(); setWaypoint(spot.x, spot.z, true);
        setTimeout(() => notice(`Treffen mit ${c.name}: ${spot.place}`, 3000), 2500);
      }
      setTimeout(() => { phone.busy = false; sfx.click(); closePhone(); }, 2600);
    }, 2600);
  }, 2200);
}
function meetingSpot() {
  const p = player.car || player;
  const opts = benches.filter(b => { const d = Math.hypot(b.x - p.x, b.z - p.z); return d > 90 && d < 380 && !b.occ; });
  if (opts.length) { const b = pick(opts); return { x: b.x + Math.sin(b.yaw) * 1.2, z: b.z + Math.cos(b.yaw) * 1.2, yaw: b.yaw, place: 'Park in ' + districtOf(b.x, b.z) }; }
  const q = ringProj(p.x + rnd(-250, 250), p.z + rnd(-250, 250));
  return { x: q.x, z: q.z, yaw: 0, place: 'Ecke in ' + districtOf(q.x, q.z) };
}
function placeMeetingPerson() {
  const m = meeting, c = m.who;
  if (c.char !== undefined) { const st = CHARS[c.char].st; st.x = m.x; st.z = m.z; st.yaw = m.yaw + Math.PI; m.h = CHARS[c.char].h; m.own = false; }
  else { m.h = makeHuman(c.look); scene.add(m.h.group); m.own = true; }
}
function cancelMeeting() {
  if (!meeting) return;
  if (meeting.own && meeting.h) { scene.remove(meeting.h.group); disposeHuman(meeting.h); }
  meeting = null; setWaypoint(null, null, true);
}
function updateMeeting(dt) {
  const m = meeting; if (!m) return;
  if (m.own && m.h) { m.h.group.position.set(m.x, groundH(m.x, m.z), m.z); m.h.group.rotation.y = m.state === 'talk' ? Math.atan2(player.x - m.x, player.z - m.z) : m.yaw + Math.PI; animHuman(m.h, 0, dt, false, m.state === 'talk' ? 'talk' : 'phone'); m.h.group.visible = true; }
  if (m.state === 'wait' && !player.car && !INT.inside && Math.hypot(player.x - m.x, player.z - m.z) < 3) {
    m.state = 'talk'; setWaypoint(null, null, true);
    if (m.who.char !== undefined) CHARS[m.who.char].st.yaw = Math.atan2(player.x - m.x, player.z - m.z);
    const me = CHARS[cur], conv = pick(CALL_LINES.talk); let t = 0;
    for (const [a, b] of [conv, pick(CALL_LINES.talk)]) {
      setTimeout(() => say(a, { who: me.name, color: me.col, prio: true }), t); t += 3200;
      setTimeout(() => say(b, { who: m.who.name, color: m.col, prio: true }), t); t += 3200;
    }
    setTimeout(() => {
      fade(true);
      setTimeout(() => {
        gameMin = (gameMin + 60) % 1440; player.respect += 3; if (player.hp < 100) player.hp = 100;
        fade(false); banner('TREFFEN BEENDET', `${m.who.activity.toUpperCase()} MIT ${m.who.name.toUpperCase()} · FREUNDSCHAFT +10%`);
        sfx.jingle();
        const keep = meeting; meeting = null;
        if (keep.own) setTimeout(() => { scene.remove(keep.h.group); disposeHuman(keep.h); }, 15000);
      }, 900);
    }, t + 500);
  }
}

function rayBox(o, d, hx, hy, hz) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, -hx, hx], [o.y, d.y, 0, hy], [o.z, d.z, -hz, hz]]) {
    if (Math.abs(dd) < 1e-8) { if (oo < lo || oo > hi) return null; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd; if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) return null;
  }
  return tmin;
}

// ---------- Camera ----------
let camYaw = -Math.PI / 2 + 0.5, camPitch = 0.22, camDist = 4.5;
const camTarget = new THREE.Vector3();
const headlight = new THREE.SpotLight(0xfff1d6, 0, 70, 0.5, 0.5, 1.2); scene.add(headlight, headlight.target);
const _pv1 = new THREE.Vector3(), _pv2 = new THREE.Vector3(), _pv3 = new THREE.Vector3();
function updateCamera(dt) {
  if (INT.panelMode && INT.cab) {
    const Pn = INT.cab.panel; Pn.updateMatrixWorld(); Pn.getWorldPosition(_pv1); _pv2.set(0, 0, 1).transformDirection(Pn.matrixWorld);
    _pv3.copy(_pv1).addScaledVector(_pv2, 0.62); _pv3.y += 0.05; if (camera.position.distanceTo(_pv3) > 2.5) camera.position.copy(_pv3); else camera.position.lerp(_pv3, Math.min(1, dt * 7)); camera.lookAt(_pv1);
    camera.fov = lerp(camera.fov, 52, Math.min(1, dt * 6)); camera.updateProjectionMatrix(); skyDome.position.copy(camera.position); mouseDX = mouseDY = 0; return;
  }
  if (switching) {
    // Charakterwechsel wie in GTA V: hoch in den Himmel, rüber, runter
    const s = switching, up = s.t < 1.3 ? smooth(0, 1, s.t / 1.3) : 1 - smooth(0, 1, (s.t - 1.3) / 1.3);
    const cx = s.swapped ? player.x : s.from.x, cz = s.swapped ? player.z : s.from.z, h = 3 + up * 260;
    camera.position.set(cx - Math.sin(camYaw) * (4 + up * 20), h, cz - Math.cos(camYaw) * (4 + up * 20));
    camera.lookAt(cx, 1, cz); camera.fov = 68; camera.updateProjectionMatrix();
    skyDome.position.copy(camera.position); mouseDX = mouseDY = 0; return;
  }
  camYaw -= mouseDX * 0.0024; camPitch = clamp(camPitch + mouseDY * 0.002, -0.35, 1.2); mouseDX = mouseDY = 0;
  let tx, ty, tz, dist;
  const vcar = player.car || (player.rideSeat && ride ? ride.car : null);
  if (vcar) {
    const c = vcar, sp = Math.abs(c.speedF || 0);
    if (!Number.isFinite(c.x + c.y + c.z)) { c.x = Number.isFinite(c.lx) ? c.lx : 0; c.z = Number.isFinite(c.lz) ? c.lz : 0; c.y = 0; c.vx = c.vz = 0; }
    tx = c.x; ty = c.y + 1.5; tz = c.z; dist = 7.2 + sp * 0.05;
    if (performance.now() - lastMouse > 1300 && sp > 2) {
      camYaw += angDiff(camYaw, c.speedF < -2 ? c.yaw + Math.PI : c.yaw) * Math.min(1, dt * 2.5);
      camPitch = lerp(camPitch, 0.2, dt * 1.5);
    }
    camera.fov = lerp(camera.fov, 68 + Math.min(20, sp * 0.4), dt * 3);
  } else {
    const aim = player.aimT > 0;
    const sx = -Math.cos(camYaw) * (aim ? 0.75 : 0.45), sz = Math.sin(camYaw) * (aim ? 0.75 : 0.45);
    tx = player.x + sx; ty = player.y + 1.65; tz = player.z + sz; dist = aim ? 2.6 : 4.4;
    if (player.dead) { dist = 6; camPitch = lerp(camPitch, 0.9, dt * 0.5); }
    if (INT.inside) { dist = Math.min(dist, 2.9); camPitch = Math.min(camPitch, 0.55); if (INT.cab && inCab()) { dist = Math.min(dist, 1.7); camPitch = clamp(camPitch, 0.05, 0.45); } }
    camera.fov = lerp(camera.fov, aim ? 55 : 68, dt * 6);
  }
  camera.updateProjectionMatrix();
  camDist = lerp(camDist, dist, Math.min(1, dt * 4));
  camTarget.set(tx, ty, tz);
  const cp = Math.cos(camPitch), dx = -Math.sin(camYaw) * cp, dy = Math.sin(camPitch), dz = -Math.cos(camYaw) * cp;
  let d = camDist;
  const inLift = INT.active && INT.cab && !player.car && inCab(); // in der Kabine: Kamera nur durch die Kabinenwände begrenzen (Tür-/Etagenkollision ließ sie beim Anfahren ab- und hochspringen)
  if (!inLift) for (let s = 0.3; s <= camDist; s += 0.2) if (solidAt(tx + dx * s, ty + dy * s, tz + dz * s)) { d = Math.max(0.6, s - 0.4); break; }
  camera.position.set(tx + dx * d, Math.max(ty + dy * d, INT.inside ? player.y + 0.3 : 0.4), tz + dz * d);
  if (INT.inside && !inLift) camera.position.y = Math.min(camera.position.y, Math.max(floorY(curFloorOf(player.y)) + 3.15, player.y + 1.9));
  if (inLift) {
    let [clx, clz] = toLocal(camera.position.x, camera.position.z); clx = clamp(clx, ELEV[0] + 0.12, ELEV[1] - 0.12); clz = clamp(clz, ELEV[2] + 0.12, ELEV[3] - 0.12);
    const [cwx, cwz] = toWorld(clx, clz); camera.position.x = cwx; camera.position.z = cwz; camera.position.y = clamp(camera.position.y, INT.cab.y + 0.6, INT.cab.y + 2.45);
  }
  if (shake > 0) { camera.position.x += rnd(-1, 1) * shake * 0.4; camera.position.y += rnd(-1, 1) * shake * 0.4; shake = Math.max(0, shake - dt * 1.8); }
  camera.lookAt(tx, ty + 0.2, tz);
  // NaN-Schutz: nie mit ungültiger Kameralage rendern (sonst schwarzer Bildschirm) – letzte gute Lage behalten
  if (Number.isFinite(camera.position.x + camera.position.y + camera.position.z + camera.fov + camYaw + camPitch + camDist)) { camGood.copy(camera.position); }
  else {
    if (!Number.isFinite(camYaw)) camYaw = vcar && Number.isFinite(vcar.yaw) ? vcar.yaw : 0;
    if (!Number.isFinite(camPitch)) camPitch = 0.2;
    if (!Number.isFinite(camDist)) camDist = 6;
    if (!Number.isFinite(camera.fov)) camera.fov = 68;
    camera.position.copy(camGood); camera.updateProjectionMatrix();
    if (Number.isFinite(tx + ty + tz)) camera.lookAt(tx, ty + 0.2, tz);
  }
  skyDome.position.copy(camera.position);
}
const camGood = new THREE.Vector3(0, 5, 0);

// ---------- Main update ----------
let carInput = { thr: 0, skid: 0 };
function updatePlayer(dt, raw) {
  player.fireCd -= dt; player.aimT -= dt;
  if (uiMenu && uiMenuPos && Math.hypot(player.x - uiMenuPos[0], player.z - uiMenuPos[1]) > 3) closeMenu();
  if (seq && !player.dead) { updateSeq(dt); return; }
  if (player.dead) {
    player.dead -= raw;
    if (player.dead < 1.2 && !$('fade').classList.contains('on')) fade(true);
    if (player.dead <= 0) respawn();
    const h = player.h; if (player.bust) animHuman(h, 0, dt, false, 'handsup'); else { h.group.rotation.x = lerp(h.group.rotation.x, -Math.PI / 2, Math.min(1, dt * 4)); h.group.position.y = lerp(h.group.position.y, player.y + 0.25, dt * 4); }
    return;
  }
  if (player.ride) {
    if (player.rideSeat && ride) { const c = ride.car, [lx, ly, lz] = paxLocal(c), [x, z] = carLocal(c, lx, lz); player.x = x; player.z = z; player.y = c.y + ly; player.yaw = c.yaw; animHuman(player.h, 0, dt, false, 'sit'); }
    return;
  }
  if (player.rag) { updateRag(dt); return; }
  if (player.car) {
    const c = player.car;
    const thr = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const st = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
    driveCar(c, thr, st, !!keys.Space, dt); checkRedLight(c);
    player.x = c.x; player.z = c.z; player.y = c.y;
    animHuman(player.h, 0, dt, false, 'drive');
    const lat = Math.abs(c.vx * -Math.cos(c.yaw) + c.vz * Math.sin(c.yaw));
    carInput = { thr: Math.max(0, thr), skid: Math.max((lat - 2.5) / 6, keys.Space && Math.abs(c.speedF) > 6 ? 0.8 : 0, thr > 0 && c.speedF < 4 && c.speedF > 0.3 ? 0.4 : 0) };
    if (Math.abs(c.speedF) > 3) for (const p of peds) {
      if (p.state === 'dead') continue;
      for (const [cx, cz] of carCircles(c)) if (Math.hypot(p.x - cx, p.z - cz) < 1.3) { launchPed(p, c); sfx.hit(); damageCar(c, 1); break; }
    } else for (const p of peds) if (p.state === 'walk' && Math.hypot(p.x - c.x, p.z - c.z) < 4) { p.state = 'flee'; p.t = 4; }
    headlight.intensity = nightF * 60;
    headlight.position.set(c.x + Math.sin(c.yaw) * 2.3, c.y + 0.8, c.z + Math.cos(c.yaw) * 2.3);
    headlight.target.position.set(c.x + Math.sin(c.yaw) * 20, 0, c.z + Math.cos(c.yaw) * 20);
    return;
  }
  carInput = { thr: 0, skid: 0 };
  headlight.intensity = 0;
  if (INT.menu || INT.busy) { animHuman(player.h, 0, dt); return; }
  if (uiMenu) { player.vx = player.vz = 0; animHuman(player.h, 0, dt, false, uiMenu.pose || null); return; }
  const nav = phone.open;
  const cabHold = INT.cab && (INT.cab.state === 'moving' || INT.cab.state === 'closing') && inCab();
  const mf = nav || cabHold ? 0 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), ms = nav || cabHold ? 0 : (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -fz, rz = fx;
  let mx = fx * mf + rx * ms, mz = fz * mf + rz * ms; const ml = Math.hypot(mx, mz);
  const aiming = (rmb || lmb) && !curW().melee && !phone.open;
  const spd = ml > 0 ? player.sneak ? 1.7 : (keys.ShiftLeft || keys.ShiftRight) && !aiming ? 7.6 : aiming ? 2.6 : 4.2 : 0;
  if (ml > 0) { mx /= ml; mz /= ml; }
  // Trägheit: beschleunigen/abbremsen mit begrenzter Rate, Sprint kostet Ausdauer
  const sprinting = spd > 7 && ml > 0; player.stam = clamp((player.stam ?? 100) + (sprinting ? -13 : 9) * dt, 0, 100);
  const spdE = sprinting && player.stam < 3 ? 4.6 : spd, accR = ml > 0 ? (spdE > 5 ? 9 : 14) : 16;
  const dvx = mx * spdE - player.vx, dvz = mz * spdE - player.vz, dl = Math.hypot(dvx, dvz), lim = accR * dt;
  if (dl > lim) { player.vx += dvx / dl * lim; player.vz += dvz / dl * lim; } else { player.vx += dvx; player.vz += dvz; }
  player.x += player.vx * dt; player.z += player.vz * dt;
  const r = resolveCircle(player.x, player.z, 0.38, player.y + 0.9); player.x = r.x; player.z = r.z;
  for (const c of cars) {
    if (Math.abs(c.x - player.x) > 5 || Math.abs(c.z - player.z) > 5) continue;
    for (const [cx, cz] of carCircles(c)) {
      const dx = player.x - cx, dz = player.z - cz, d = Math.hypot(dx, dz);
      if (d < 1.35 && d > 0.01) {
        player.x = cx + dx / d * 1.35; player.z = cz + dz / d * 1.35;
        const cs = Math.hypot(c.vx, c.vz) + (c.mode === 'ai' ? c.ai.speed : 0);
        if (cs > 5) { const cvx = c.mode === 'ai' ? Math.sin(c.yaw) * c.ai.speed : c.vx, cvz = c.mode === 'ai' ? Math.cos(c.yaw) * c.ai.speed : c.vz; knockPlayer(cvx * 0.8 + dx / d * 2, 2 + cs * 0.18, cvz * 0.8 + dz / d * 2, cs * 1.4); return; }
      }
    }
  }
  // Anrempeln: Passanten werden weggeschoben, bei Sprint stolpern sie und fallen
  for (const p of peds) {
    if (p.state === 'dead' || p.state === 'fly' || p.state === 'entering') continue;
    const ex = p.x - player.x, ez = p.z - player.z, ed = Math.hypot(ex, ez);
    if (ed < 0.62 && ed > 0.01) {
      const ps = Math.hypot(player.vx, player.vz); p.x += ex / ed * (0.62 - ed); p.z += ez / ed * (0.62 - ed);
      if (ps > 5.5) { launchPed(p, { vx: player.vx * 0.5, vz: player.vz * 0.5 }); p.impact = 2; player.vx *= 0.55; player.vz *= 0.55; shake = Math.max(shake, 0.15); sfx.hit(); }
      if (ps > 1 && performance.now() > (p.bumpCd || 0)) { p.bumpCd = performance.now() + 4000; say(pick(LINES.bump), { who: 'Passant', voice: p.voice, rate: p.vrate, h: p.h }); }
    }
  }
  if (aiming) { player.aimT = 0.8; player.yaw = camYaw; }
  else if (player.aimT > 0) player.yaw = camYaw;
  else if (ml > 0) player.yaw += angDiff(player.yaw, Math.atan2(mx, mz)) * Math.min(1, dt * 12);
  const g = floorH(player.x, player.z, player.y);
  if (keys.Space && player.grounded) { player.vy = 5.4; player.grounded = false; }
  player.vy -= 15 * dt; player.y += player.vy * dt;
  if (player.y <= g) { const impactV = player.vy; player.y = player.grounded ? lerp(player.y, g, Math.min(1, dt * 20)) : g; player.vy = 0; player.grounded = true; if (impactV < -10.5) { knockPlayer(player.vx * 0.4, 0.5, player.vz * 0.4, (-impactV - 10) * 7); return; } }
  if (player.grounded && player.y < g) player.y = g;
  if (player.grounded && INT.inside && Math.abs(player.y - g) < 0.6) player.y = g;
  const w = curW();
  if ((w.auto ? lmb : lmbEdge) && player.fireCd <= 0 && !phone.open) { player.fireCd = w.rate; attack(); }
  lmbEdge = false;
  if (player.hp < 50) player.hp = Math.min(50, player.hp + dt * 1.2);
  const h = player.h; h.group.position.set(player.x, player.y, player.z); h.group.rotation.set(0, player.yaw, 0);
  const gw = curW().gun, aimNow = player.aimT > 0 && !!gw;
  if (player.act && (player.act.t -= dt) <= 0) player.act = null;
  const mv = Math.hypot(player.vx, player.vz);
  animHuman(h, mv, dt, aimNow, phone.open ? 'phone' : player.act && mv < 0.5 ? player.act.pose : uiMenu?.pose && mv < 0.5 ? uiMenu.pose : null, player.sneak);
  if (aimNow) aimPose(h, camPitch);
  h.gun.visible = aimNow; if (gw) { h.gunBase ??= h.gun.scale.x; h.gun.scale.set(gw[0] * h.gunBase, gw[1] * h.gunBase, gw[2] * h.gunBase); }
  if (player.punchT > 0) { player.punchT -= dt; punchPose(h, Math.sin((1 - player.punchT / 0.25) * Math.PI)); }
}

function updateCars(dt, time) {
  const pc = player.car;
  updateSignals(dt); updateKnock(dt); updateHail(dt);
  for (const c of [...cars]) {
    if (c.mode === 'ai') updateAI(c, dt);
    else if (c.mode === 'police') updatePolice(c, dt);
    else if (c.mode === 'crashed') updateCrashed(c, dt);
    else if (c.mode === 'abandoned' || c.mode === 'wreck') { if (Math.hypot(c.vx, c.vz) > 0.05) driveCar(c, 0, 0, true, dt); else c.vx = c.vz = 0; }
    if (c === pc || c.mode === 'police') {
      for (const o of cars) {
        if (o === c || Math.abs(o.x - c.x) > 7 || Math.abs(o.z - c.z) > 7) continue;
        for (const [ax, az] of carCircles(c)) for (const [bx, bz] of carCircles(o)) {
          const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz);
          if (d >= 1.9 || d < 0.01) continue;
          const nx = dx / d, nz = dz / d, pen = 1.9 - d;
          const ovx = o.mode === 'ai' ? Math.sin(o.yaw) * o.ai.speed : o.vx, ovz = o.mode === 'ai' ? Math.cos(o.yaw) * o.ai.speed : o.vz;
          const rv = (c.vx - ovx) * nx + (c.vz - ovz) * nz;
          c.x += nx * pen * 0.6; c.z += nz * pen * 0.6;
          if (rv < 0) {
            c.vx -= rv * nx * 1.1; c.vz -= rv * nz * 1.1;
            { const Jx = -rv * nx * 1.1, Jz = -rv * nz * 1.1, rxc = ax - c.x, rzc = az - c.z, rxo = bx - o.x, rzo = bz - o.z;
              c.av += clamp((rzc * Jx - rxc * Jz) * 0.22, -3, 3); o.av = (o.av || 0) + clamp((rzo * -Jx - rxo * -Jz) * 0.22, -3, 3);
              c.rv = (c.rv || 0) + clamp(-rv * 0.06, -1, 1); }
            if (c === pc) o.pHit = SIG.t;
            if (-rv > 4) { const mx = (ax + bx) / 2, mz = (az + bz) / 2, dep = Math.min(0.35, (-rv - 4) * 0.03); deformLocal(c, ...toCarLocal(c, mx, mz), dep); deformLocal(o, ...toCarLocal(o, mx, mz), dep); }
            if (o.mode === 'ai' && -rv > 6) { o.mode = 'crashed'; o.crashT = 0; o.vx = ovx - rv * nx * 0.7; o.vz = ovz - rv * nz * 0.7; o.av = (o.av || 0) + rnd(-1.5, 1.5); o.ai.honk = 0.3; }
            else if (o.mode === 'ai') { o.ai.knockX += rv * nx * 0.6; o.ai.knockZ += rv * nz * 0.6; o.ai.speed = 0; o.ai.honk = 0.3; }
            else if (o.mode !== 'police' && o.mode !== 'player' && o.mode !== 'service') { o.mode = o.mode === 'wreck' ? 'wreck' : 'abandoned'; o.vx += rv * nx * 0.6; o.vz += rv * nz * 0.6; }
            else { o.vx += rv * nx * 0.5; o.vz += rv * nz * 0.5; }
            const imp = -rv; if (imp > 5) { damageCar(c, imp * 1.2); damageCar(o, imp * 1.2); sfx.crash(Math.min(1, imp / 20), c); if (c === pc) shake = Math.min(1, imp / 25); }
          }
        }
      }
    }
    // Wütende Fahrer hupen
    if (c.mode === 'ai' && c.ai.honk !== undefined) { c.ai.honk -= dt; if (c.ai.honk < 0) { sfx.horn(c.x, c.z, 0.5); c.ai.honk = undefined; } }
    if (c.health < 35 && Math.random() < dt * 12) emit(smoke, c.x + Math.sin(c.yaw) * c.T.L * 0.4, c.y + 1, c.z + Math.cos(c.yaw) * c.T.L * 0.4, rnd(-0.3, 0.3), rnd(1, 2), rnd(-0.3, 0.3), rnd(1, 2), 0.6, 1.2, c.health > 0 ? 0.35 : 0.08, 0.35, 0.35);
    if (c.health < 15 && c.health > 0 && c.mode !== 'wreck') { if (Math.random() < dt * 15) emit(fire, c.x + Math.sin(c.yaw) * c.T.L * 0.4, c.y + 0.9, c.z + Math.cos(c.yaw) * c.T.L * 0.4, rnd(-0.4, 0.4), rnd(1, 2.5), rnd(-0.4, 0.4), 0.5, 0.6, 0.5, 1, 0.5, 0.1); c.health -= dt * 2.5; if (c.health <= 0) explodeCar(c); }
    if (c.mode === 'wreck' && c === pc) hurtPlayer(200);
    const d = Math.hypot(c.x - player.x, c.z - player.z);
    if ((c.mode === 'ai' || c.mode === 'police') && !c.driver && !c.deployed && d < 70) { setDriver(c, makeHuman(c.dlook ||= c.type === 'police' ? COP_LOOK : pedLook())); c.lazyDriver = true; }
    if (c.driver && c.lazyDriver && c.driver !== player.h && d > 95) { const h = c.driver; c.body.remove(h.group); disposeHuman(h); c.driver = null; }
    if (c.driver && c.driver !== player.h) { c.driver.group.visible = d < 60; if (d < 60) animHuman(c.driver, 0, dt, false, 'drive'); }
    if (c.npcSeq) updateNpcSeq(c, dt);
    syncCar(c);
    cgLod(c, d);
    c.group.visible = d < 600;
    if (c !== pc && !c.keep && d > 300 && !(c.cop && c.mode === 'police')) removeCar(c);
  }
  const counts = { ai: 0, parked: 0, police: 0 };
  for (const c of cars) if (counts[c.mode] !== undefined) counts[c.mode]++;
  if (counts.ai < 38) spawnTraffic(counts.ai < 10 ? 30 : 160, 280);
  if (counts.parked < 22) spawnParked(counts.parked < 8 ? 25 : 150, 270);
  updateDispatch(dt); updateOfficers(dt);
  const on = wanted > 0, f = Math.sin(time * 14) > 0;
  M.copRed.emissiveIntensity = on && f ? 6 : 0.2; M.copBlue.emissiveIntensity = on && !f ? 6 : 0.2;
}

// Nach einem Unfall: ausrollen, dann weiterfahren oder wütend aussteigen
function updateCrashed(c, dt) {
  driveCar(c, 0, 0, true, dt); c.crashT += dt;
  if (Math.hypot(c.vx, c.vz) < 0.3 && c.crashT > 2.5) {
    c.vx = c.vz = 0;
    if (c.health > 45 && c.driver && Math.random() < 0.6) {
      c.mode = 'ai'; initAI(c, dirOfYaw(c.yaw)); const D = DIRS[c.ai.dir], k = Math.round((D[0] === 0 ? c.x : c.z) / P + N / 2); c.ai.laneC = laneFor(c.ai.dir, clamp(k, 0, N)); c.ai.speed = 0; sfx.horn(c.x, c.z, 0.6);
    } else { c.mode = 'abandoned'; if (c.driver) { c.doors[0].target = 1; c.npcSeq = { type: 'exit', t: 0 }; } }
  }
}
let visT = 0, radioT = 4, sigT = 0;
// Funktext passend zum bekannten Modus des Verdächtigen (Fahrzeug / zu Fuß)
function suspectRadio(lost) {
  const car = lastSeen.car && cars.includes(lastSeen.car) ? lastSeen.car : null, d = districtOf(lastSeen.x, lastSeen.z);
  const base = (lost ? LINES.radioLost : LINES.radio).filter(l => car ? !/zu Fuß/.test(l) : !/fährt|Fahrbahn|Hindernis|rammt|Kurve|Absperrung|Straßensperre|Hubschrauber|Fahrzeug/.test(l));
  const mode = car ? (lost ? [`Wir suchen einen ${colName(car.color || '#888')}en ${CAR_NAME[car.type] || 'Wagen'} in ${d}.`, `Achtet auf ${carDesc(car)}, zuletzt in ${d} gesehen.`] : [`Verdächtiger weiter in ${carDesc(car)}, Verfolgung läuft.`, `Wir sind hinter ${carDesc(car)}, Richtung ${d}.`])
    : (lost ? [`Verdächtiger zu Fuß in ${d} verloren, Gebiet wird abgesucht.`, `Fußstreifen nach ${d}, Verdächtiger war zu Fuß.`] : ['Verdächtiger zu Fuß, Einheiten steigen aus.', `Verdächtiger rennt zu Fuß durch ${d}.`]);
  return pick(base.concat(mode, mode));
}
function updateWanted(dt) {
  if (wanted <= 0) return;
  sigT -= dt;
  let copsNear = false;
  visT -= dt;
  if (visT <= 0) {
    visT = 0.2; let seen = false;
    for (const c of cars) if (c.mode === 'police') { c.sees = copSees(c); seen = seen || c.sees; if (Math.hypot(c.x - player.x, c.z - player.z) < 260) copsNear = true; }
    for (const o of officers) if (o.state !== 'dead') { seen = seen || o.sees; copsNear = true; }
    const veh = playerVeh(), tgt = veh || player;
    if (seen) {
      if (wantedCool > 3) radioT = Math.min(radioT, 0.5); wantedCool = 0; lastSeen.x = tgt.x; lastSeen.z = tgt.z; lastSeen.foot = !veh; lastSeen.car = veh; lastSeen.bld = INT.inside ? INT.b : null;
      // Moduswechsel (Fahrzeug / zu Fuß) im Sichtfeld: Funkdurchsage
      const sg = veh || (INT.inside ? 'bld' : 'foot');
      if (sg !== lastSeen.sig) {
        const old = lastSeen.sig; lastSeen.sig = sg;
        if (sg !== 'bld' && sigT <= 0) { sigT = 5; say(veh ? (old ? `Verdächtiger wechselt das Fahrzeug, jetzt in ${carDesc(veh)}.` : `Verdächtiger in ${carDesc(veh)}.`) : (old ? 'Verdächtiger ist ausgestiegen und flüchtet zu Fuß.' : 'Verdächtiger zu Fuß, Sichtkontakt.'), { who: 'Polizeifunk', radio: true, color: '#6fa8ff', prio: true }); }
      }
    }
    else if (copsNear || wantedCool > 0) wantedCool += squad.cops.length && INT.inside && squad.b === INT.b ? 0.07 : 0.2;
  }
  // Polizeifunk
  radioT -= dt;
  if (radioT < 0) { radioT = rnd(8, 13); say(suspectRadio(wantedCool > 2), { who: 'Polizeifunk', color: '#6fa8ff', pitch: 0.7, rate: 1.15, vol: 0.7, radio: true }); }
  if (wantedCool > 9 + wanted * 3) escapeWanted();
}
function escapeWanted() {
  const w = wanted; wanted = 0; wantedCool = 0; lastSeen.car = null; lastSeen.foot = false; lastSeen.bld = null; lastSeen.sig = null;
  player.respect += w * 5;
  banner('VERFOLGER ABGEHÄNGT!', `RESPEKT +${w * 5}%   ·   ${w} STERN${w > 1 ? 'E' : ''} WEG`);
  sfx.jingle();
  setTimeout(() => say(LINES.radioEnd, { who: 'Polizeifunk', color: '#6fa8ff', pitch: 0.7, rate: 1.15, vol: 0.7, radio: true, prio: true }), 1500);
}
function updateAudio(dt) {
  if (!sfx.ready()) return;
  const near = [];
  let trafficN = 0, sirenD = Infinity, sx = 0, sz = 0;
  for (const c of cars) {
    const d = Math.hypot(c.x - player.x, c.z - player.z);
    if (c.mode === 'ai' && d < 70) { trafficN++; near.push({ d, x: c.x, z: c.z, speed: c.ai.speed }); }
    if (c.mode === 'police' && wanted > 0 && d < sirenD) { sirenD = d; sx = c.x; sz = c.z; }
  }
  near.sort((a, b) => a.d - b.d);
  const c = player.car;
  sfx.update({ dt, car: !!c, speed: c ? c.speedF : 0, thr: carInput.thr, skid: carInput.skid, trafficN, ai: near.slice(0, 3), siren: clamp(1 - sirenD / 160, 0, 1), sirenClose: sirenD < 45, sirenX: sx, sirenZ: sz, night: nightF });
}

// ---------- Häuser & Krankenhaus ----------
function buildStructures() {
  const geos = [], glass = [], y0 = 0.2;
  const add = (w, h, d, x, y, z, c) => geos.push(box(w, h, d, x, y, z, c));
  const addG = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); glass.push(g); };
  const solid = (x, z, w, d, h) => addSolid(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h);
  const markerG = new THREE.CylinderGeometry(0.75, 0.75, 1.3, 32, 1, true);
  const home = (key, x, z, col, sym) => {
    const m = new THREE.Mesh(markerG, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, groundH(x, z) + 0.65, z); m.visible = false; scene.add(m);
    HOMES[key] = { x, z, marker: m }; POIS.push({ x, z, col, sym, home: key });
  };
  // Franklin: modernes Haus mit Garage
  { const cx = blockCenter(7), cz = blockCenter(7);
    add(16, 3.4, 11, cx, y0 + 1.7, cz, '#eceae4'); add(11, 3.2, 9, cx + 2, y0 + 5, cz + 0.5, '#f4f2ee');
    add(17, 0.35, 12, cx, y0 + 3.55, cz, '#3a3a3a'); add(12, 0.35, 10, cx + 2, y0 + 6.75, cz + 0.5, '#3a3a3a');
    addG(6, 2.4, 0.1, cx - 4, y0 + 1.6, cz - 5.52); addG(8, 2.2, 0.1, cx + 2, y0 + 5, cz - 4.02);
    add(1.4, 2.4, 0.15, cx + 1.5, y0 + 1.2, cz - 5.55, '#5a3b24'); add(4, 2.6, 0.15, cx + 5.5, y0 + 1.3, cz - 5.55, '#9a9ea3');
    add(4.5, 0.05, 24.5, cx + 5.5, y0 + 0.02, cz - 17.75, '#7c7c78');
    solid(cx, cz, 16, 11, 7.2); home('franklin', cx + 1.5, cz - 7.2, '#9be389', 'F'); }
  // Michael: Villa mit Pool
  { const cx = blockCenter(3), cz = blockCenter(3);
    add(22, 4, 14, cx, y0 + 2, cz, '#e6d6b8'); add(14, 3.6, 10, cx - 3, y0 + 5.8, cz + 1, '#eadcc2');
    add(23, 0.4, 15, cx, y0 + 4.2, cz, '#8a4a32'); add(15, 0.4, 11, cx - 3, y0 + 7.8, cz + 1, '#8a4a32');
    addG(14, 2.4, 0.1, cx - 3, y0 + 1.8, cz - 7.02); addG(10, 2, 0.1, cx - 3, y0 + 5.8, cz - 4.02);
    add(1.8, 2.8, 0.15, cx + 7, y0 + 1.4, cz - 7.05, '#3b2616');
    add(0.5, 4, 0.5, cx + 5.6, y0 + 2, cz - 8.6, '#f2ece0'); add(0.5, 4, 0.5, cx + 8.4, y0 + 2, cz - 8.6, '#f2ece0'); add(3.6, 0.3, 2.4, cx + 7, y0 + 4.05, cz - 8, '#f2ece0');
    add(16, 0.06, 9, cx, y0 + 0.03, cz + 13, '#f0ece2');
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(11, 5.5), new THREE.MeshStandardMaterial({ color: 0x1e8fd6, roughness: 0.05, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(cx, y0 + 0.07, cz + 13); pool.receiveShadow = true; scene.add(pool);
    solid(cx, cz, 22, 14, 8.2); home('michael', cx + 7, cz - 9.6, '#6fb3ff', 'M'); }
  // Trevor: Wohnwagen
  { const cx = blockCenter(11), cz = blockCenter(10);
    add(12, 0.5, 3.4, cx, y0 + 0.25, cz, '#4a4640'); add(13, 3, 3.8, cx, y0 + 2, cz, '#cfc6a6');
    add(13.05, 0.4, 3.85, cx, y0 + 1.6, cz, '#7a5230'); add(13.2, 0.15, 4, cx, y0 + 3.58, cz, '#9a9a92');
    addG(1.4, 0.9, 0.1, cx - 3.5, y0 + 2.5, cz - 1.92); addG(1.4, 0.9, 0.1, cx + 3, y0 + 2.5, cz - 1.92);
    add(0.9, 2, 0.1, cx + 0.5, y0 + 1.9, cz - 1.95, '#6b6250'); add(1.2, 0.5, 0.8, cx + 0.5, y0 + 0.25, cz - 2.4, '#555');
    add(1, 1, 1, cx - 6, y0 + 0.5, cz - 4, '#7a5a30'); add(0.9, 0.9, 0.9, cx - 5.2, y0 + 0.45, cz - 5.1, '#6a4a28'); add(2.5, 0.8, 1.5, cx + 6, y0 + 0.4, cz - 4.5, '#3d3f41');
    solid(cx, cz, 13, 3.8, 4); solid(cx + 6, cz - 4.5, 2.5, 1.5, 1); home('trevor', cx + 0.5, cz - 3.5, '#ffa060', 'T'); }
  // Krankenhaus
  { const cx = blockCenter(5), cz = blockCenter(8);
    const hm = new THREE.Mesh(mergeGeometries([wallBox(44, 24, 30, cx, y0 + 12, cz + 4, '#f4f4f2'), wallBox(20, 12, 14, cx + 12, y0 + 30, cz + 6, '#e4ecf2')]), M.facade);
    hm.castShadow = hm.receiveShadow = true; scene.add(hm);
    add(44.4, 0.5, 30.4, cx, y0 + 24.25, cz + 4, '#6a6e72'); add(20.4, 0.5, 14.4, cx + 12, y0 + 36.25, cz + 6, '#6a6e72');
    add(10, 0.1, 10, cx - 10, y0 + 24.55, cz + 6, '#3a3a3a'); add(0.8, 0.04, 6, cx - 12, y0 + 24.62, cz + 6, '#ffffff'); add(0.8, 0.04, 6, cx - 8, y0 + 24.62, cz + 6, '#ffffff'); add(4, 0.04, 0.8, cx - 10, y0 + 24.62, cz + 6, '#ffffff');
    add(12, 0.4, 5, cx, y0 + 4.2, cz - 13.5, '#d0d4d8'); add(0.4, 4, 0.4, cx - 5.5, y0 + 2, cz - 15.6, '#bbbbbb'); add(0.4, 4, 0.4, cx + 5.5, y0 + 2, cz - 15.6, '#bbbbbb');
    const crossM = new THREE.MeshStandardMaterial({ color: 0xd01818, emissive: 0xff1010, emissiveIntensity: 0.8 });
    for (const [x, y] of [[cx - 15, y0 + 18], [cx + 15, y0 + 18]]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 0.3), crossM), b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, 0.3), crossM);
      a.position.set(x, y, cz - 11.2); b.position.copy(a.position); scene.add(a, b);
    }
    const sign = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = '#c41a1a'; c.font = 'bold 92px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PILLBOX KRANKENHAUS', w / 2, h / 2 + 4); });
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(16, 2), new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.4 }));
    sm.rotation.y = Math.PI; sm.position.set(cx, y0 + 7, cz - 11.06); scene.add(sm);
    const hsol = solid(cx, cz + 4, 44, 30, 36);
    Object.assign(HOSPITAL, { x: cx, z: cz - 17, yaw: Math.PI });
    BUILDINGS.push({ x: cx, z: cz + 4, w: 44, d: 30, floors: 6, seed: 4242, type: 'hospital', solid: hsol, door: { x: cx, z: cz - 11 - 1.1, nx: 0, nz: -1, tx: 1, tz: 0 } });
    POIS.push({ x: cx, z: cz - 12, col: '#ff4040', sym: '+' });
    mapBuildings.push([cx - 22, cz - 11, 44, 30]); }
  const vm = new THREE.Mesh(mergeGeometries(geos), M.vcol); vm.castShadow = vm.receiveShadow = true; scene.add(vm);
  const gm = new THREE.Mesh(mergeGeometries(glass), M.glass); scene.add(gm);
}

// ---------- Loop ----------
const clock = new THREE.Clock();
let lastEnv = 0, mapT = 0, worldReady = false, qCeil = 2, fpsT = 0, fpsN = 0, lastQUp = 0;
function simulate(dt, raw, raw0, time) {
  gameMin = (gameMin + dt * 0.5) % 1440;
  if (switching) updateSwitch(raw); else updatePlayer(dt, raw);
  updateBuildings(dt);
  updateIdleChars(dt);
  updateCars(dt, time); updateRide(dt); updateSquad(dt); updatePrison(dt); updateHeld(dt);
  updatePeds(dt);
  updatePickups(dt, time);
  updateWanted(dt); updateCrimeCalls(dt);
  updateGrenades(dt); updateScanner(dt); updateMeeting(dt); updateWaypoint(); updateNav(dt);
  for (let i = tracers.length - 1; i >= 0; i--) { if ((tracers[i].t -= dt) < 0) { scene.remove(tracers[i].m); tracers.splice(i, 1); } }
  flash.intensity = Math.max(0, flash.intensity - dt * 600);
  const hm = HOMES[CHARS[cur].home]; if (hm) { hm.marker.scale.y = 1 + Math.sin(time * 3) * 0.15; hm.marker.material.opacity = 0.3 + Math.sin(time * 3) * 0.1; }
  // Dynamische Auflösung: bei zu wenig FPS automatisch eine Stufe runter
  fpsT += raw0; fpsN++;
  if (fpsT > 4) {
    const fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
    if (fps < 30 && qIdx > 0) { qIdx--; qCeil = qIdx; applySize(); notice('Auflösung automatisch angepasst: ' + QUALITY[qIdx][0], 2200); }
    else if (fps > 55 && qIdx < Math.min(qCeil, 2) && performance.now() - lastQUp > 15000) { qIdx++; lastQUp = performance.now(); applySize(); }
  }
}
function frame() {
  requestAnimationFrame(frame);
  if (!worldReady) return;
  const raw0 = clock.getDelta(); let dt = Math.min(raw0, 0.05); const time = clock.elapsedTime;
  if (paused || !started || bigMap.open) dt = 0;
  if (wheelUI.open) dt *= 0.25;
  const raw = dt;
  if (player.dead) dt *= 0.4;
  if (dt > 0) simulate(dt, raw, raw0, time);
  updateAudio(raw); sfx.lipSync();
  updateParticles(fire, dt, 1.5); updateParticles(smoke, dt, 0.6);
  if (WHEEL) WHEEL.rotation.z += dt * 0.05; if (TEX.water) TEX.water.offset.set(time * 0.004, time * 0.0025);
  updateCamera(Math.max(dt, 0.001));
  updateSky();
  const ts = 190 / 4096, sx = Math.round(player.x / ts) * ts, sz = Math.round(player.z / ts) * ts;
  const ld = sky.sunDir.y > 0 ? sky.sunDir : sky.sunDir.clone().negate();
  sun.target.position.set(sx, 0, sz); sun.position.set(sx + ld.x * 250, ld.y * 250, sz + ld.z * 250);
  if (time - lastEnv > 20) { lastEnv = time; updateEnv(); }
  if (composer) composer.render(); else renderer.render(scene, camera);
  if (started && (mapT += 1) % 2 === 0) { drawMinimap(camYaw, time); updateHUD(); }
}

// ---------- Boot / Loading screen ----------
async function boot() {
  const bar = $('bar').firstChild, txt = $('loadtext');
  const progress = (p, t) => { if (t) txt.textContent = t; bar.style.width = (p * 100).toFixed(0) + '%'; };
  progress(0.03, 'Fotopanorama, Fototexturen und Modelle werden geladen …'); await loadAssets('assets/', k => progress(0.03 + k * 0.12));
  progress(0.15, 'Texturen werden vorbereitet …'); await nextFrame();
  makeTextures(); makeMaterials();
  progress(0.2, 'Los Santos wird gebaut …'); await nextFrame();
  updateSky(); updateEnv();
  await buildCity(progress);
  buildStructures();
  buildBenches();
  initInteriorLights();
  buildMinimapBase();
  progress(0.8, 'Verkehr wird gestartet …'); await nextFrame();
  fire = makeParticles(600, true); smoke = makeParticles(700, false);
  progress(0.82, 'Menschen werden geladen …'); await loadHumans('models/', k => progress(0.82 + k * 0.06));
  progress(0.88, 'Stimmen werden geladen …'); await loadVoices();
  // Charaktere: Startpunkte an ihren Häusern, eigene Autos davor
  const carSpots = [[PARK, 26, Math.PI], null, null];
  CHARS.forEach((c, i) => {
    const hm = HOMES[c.home];
    c.st = i === 0 ? { x: START.x, z: START.z, yaw: -Math.PI / 2 } : { x: hm.x, z: hm.z - 1.5, yaw: Math.PI };
    Object.assign(c.st, { hp: 100, armor: i === 0 ? 60 : 30, money: c.money, bank: c.bank, respect: 0 });
    c.h = makeHuman(c.look); scene.add(c.h.group);
    const bj = Math.round((hm.z - BLOCK0 - B / 2) / P), spot = carSpots[i] || [hm.x + 8, roadPos(bj) + PARK, Math.PI / 2];
    c.carRef = makeCar(c.car[0], c.car[1], spot[0], spot[1], spot[2], 'parked'); c.carRef.keep = true;
  });
  const loaded = loadGame();
  cur = 0; // Spiel startet immer als Franklin (gespeicherte Zustände bleiben)
  applyChar(cur);
  camYaw = player.yaw + 0.5;
  for (let i = 0; i < 26; i++) spawnTraffic(25, 260);
  for (let i = 0; i < 18; i++) spawnParked(15, 230);
  for (let i = 0; i < 50; i++) spawnPed(6, 130);
  worldReady = true;
  window.__game = { camStep(dt) { updateCamera(dt); }, dbgSolids(x, z, r) { const o = [], seen = new Set(); for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) for (const s of solids.get(ckey(cx, cz)) || []) if (!seen.has(s) && s.maxx > x - r && s.minx < x + r && s.maxz > z - r && s.minz < z + r) { seen.add(s); o.push([s.minx, s.maxx, s.minz, s.maxz, s.h, s.y0]); } return o; }, get camYaw() { return camYaw; }, set camYaw(v) { camYaw = v; }, deactivateBuilding, renderer, scene, camera, get composer() { return composer; }, player, cars, peds, CHARS, switchChar, die, escapeWanted, INT, BUILDINGS, activateBuilding, callCab, interiorUse, curFloorOf, get cur() { return cur; }, get wanted() { return wanted; }, set wanted(v) { wanted = v; }, set time(v) { gameMin = v; }, step(n) { for (let i = 0; i < n; i++) simulate(0.05, 0.05, 0, clock.elapsedTime); }, get cool() { return wantedCool; }, requestRide, boardRide, setWaypoint, openElevator, knockPlayer, jailReset, get navRoute() { return navRoute; }, holdItem, KNOCK, VENDS, sigState, vendMenu, busted, get PRISON() { return PRISON; }, squad, officers, lastSeen, addWanted, openPhone, phoneKey, bankMenu, get ride() { return ride; }, get hail() { return hail; }, get uiMenu() { return uiMenu; }, get pendingCall() { return pendingCall; }, respawn, carStep, groundH, doorPoint, seatLocal, carLocal, get seq() { return seq; }, enterCar, exitCar, inCab, get phone() { return phone; } };
  progress(0.9, CHARS[cur].name[0] + CHARS[cur].name.slice(1).toLowerCase() + ' wird geweckt …'); await nextFrame();
  progress(0.95, 'Shader werden kompiliert …'); await nextFrame();
  updateCamera(0.016);
  setupPost();
  renderSatellite();
  // Auto-Modelle einmal vorkompilieren, damit das erste Einsteigen nicht an Shader-Kompilierung hängt
  const pre = [];
  for (const n of ['ferrari', 'CarConcept']) { const mi = modelInstance(n, 4.5, 'z'); if (!mi) continue; cgTintModel(mi, n, '#3366aa'); mi.position.set(camera.position.x, camera.position.y - 2, camera.position.z - 6); scene.add(mi); pre.push(mi); }
  renderer.compile(scene, camera);
  composer.render();
  for (const mi of pre) scene.remove(mi);
  const t0 = performance.now(); while (performance.now() - t0 < 900) { await nextFrame(); }
  progress(1, loaded ? 'Spielstand geladen. Bereit.' : 'Bereit.');
  $('start').style.display = 'block';
  const start = () => {
    if (started) return; started = true;
    removeEventListener('keydown', start); $('loading').removeEventListener('click', start);
    $('loading').classList.add('hide'); $('hud').style.display = 'block';
    try { sfx.init(); } catch (e) { console.warn(e); }
    canvas.requestPointerLock?.();
    notice(`${CHARS[cur].name} · LOS SANTOS`, 3000);
    setTimeout(() => say(pick(LINES.chars[cur].hello), { who: CHARS[cur].name, color: CHARS[cur].col, prio: true }), 1200);
    setTimeout(() => { if (showHelp) { showHelp = false; $('help').style.display = 'none'; } }, 25000);
  };
  addEventListener('keydown', start); $('loading').addEventListener('click', start);
  canvas.addEventListener('click', () => { if (started && !paused && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
}
frame();
boot().catch(e => { $('loadtext').textContent = 'Fehler: ' + e.message; console.error(e); });
