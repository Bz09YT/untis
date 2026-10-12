// GTA – Los Santos (Browser-3D, Three.js) – direkt als Franklin, keine Intro-Mission.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/pp/EffectComposer.js';
import { RenderPass } from 'three/addons/pp/RenderPass.js';
import { ShaderPass } from 'three/addons/pp/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/pp/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/pp/OutputPass.js';
import { GTAOPass } from 'three/addons/pp/GTAOPass.js';
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
let qIdx = 2;
function applySize() {
  const w = innerWidth, h = innerHeight;
  const ratio = Math.min(QUALITY[qIdx][1](), 8192 / Math.max(w, h));
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h, false);
  if (composer) { composer.setPixelRatio(ratio); composer.setSize(w, h); if (aoPass) aoPass.enabled = qIdx >= 2; }
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
// Nachbearbeitung: Bloom + Farbkorrektur (warmes Kalifornien-Licht, Sättigung, Vignette)
let composer = null, bloomPass = null, aoPass = null;
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.14 }, warm: { value: new THREE.Vector3(1.05, 1.0, 0.93) }, vig: { value: 0.42 }, contrast: { value: 1.06 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, vig, contrast; uniform vec3 warm; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb * warm;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = mix(vec3(l), col, sat);
      col = pow(max(col, 0.0), vec3(contrast)) * (1.0 + (contrast - 1.0) * 0.5);
      vec2 d = vUv - 0.5; col *= 1.0 - vig * dot(d, d) * 1.6;
      gl_FragColor = vec4(col, c.a);
    }`,
};
function setupPost() {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight); aoPass.output = GTAOPass.OUTPUT.Default; aoPass.blendIntensity = 0.85; aoPass.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.2, scale: 1 }); composer.addPass(aoPass);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.55, 0.9);
  composer.addPass(bloomPass);
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());
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
      for (let y = 0, row = 0; y < S; y += 18, row++) for (let x = (row % 2) * -22; x < S; x += 44) { c.fillStyle = `hsl(${rnd(8, 18)},${rnd(38, 55)}%,${rnd(30, 42)}%)`; c.fillRect(x + 1, y + 1, 42, 16); }
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
    c.fillStyle = id === 'glass' ? 'rgb(255,110,150)' : 'rgb(255,230,0)'; c.fillRect(0, 0, S, S);
    eachWin((x, y, w, h) => { c.fillStyle = 'rgb(255,25,215)'; c.fillRect(x, y, w, h); });
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
function updateEnv() { const rt = pmrem.fromScene(envScene, 0, 0.1, 12000); scene.environment = rt.texture; if (envRT) envRT.dispose(); envRT = rt; }

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
  nTop: new THREE.Color('#03050f'), nHor: new THREE.Color('#0d1630'), dTop: new THREE.Color('#3474c4'), dHor: new THREE.Color('#cfe0ea'),
  dusk: new THREE.Color('#ff8a4a'), sunD: new THREE.Color('#fff3e0'), sunE: new THREE.Color('#ffac66'), moon: new THREE.Color('#8ea6ff'),
};
let nightF = 0;
function updateSky() {
  const a = (gameMin / 60 - 6) / 24 * Math.PI * 2;
  sky.sunDir.set(Math.cos(a) * 0.85, Math.sin(a), 0.45).normalize();
  const e = sky.sunDir.y;
  const day = smooth(-0.08, 0.3, e), dusk = clamp(1 - Math.abs(e + 0.02) / 0.22, 0, 1);
  nightF = 1 - smooth(-0.06, 0.1, e);
  sky.top.copy(C.nTop).lerp(C.dTop, day);
  sky.hor.copy(C.nHor).lerp(C.dHor, day).lerp(C.dusk, dusk * 0.75);
  sky.sunCol.copy(C.sunE).lerp(C.sunD, smooth(0.05, 0.4, e)).multiplyScalar(smooth(-0.1, 0.02, e));
  skyUniforms.night.value = nightF; skyUniforms.day.value = day; skyUniforms.time.value = performance.now() / 1000;
  scene.fog.color.copy(sky.hor);
  const sunI = 3.2 * smooth(0.0, 0.18, e), moonI = 0.45 * smooth(0.0, 0.15, -e);
  sun.intensity = Math.max(sunI, moonI);
  sun.color.copy(sunI > moonI ? C.sunE.clone().lerp(C.sunD, smooth(0.05, 0.45, e)) : C.moon);
  hemi.intensity = lerp(0.18, 0.7, day);
  hemi.color.copy(sky.top).lerp(new THREE.Color(0xffffff), 0.4);
  scene.environmentIntensity = lerp(0.12, 0.9, day);
  for (const id in M.facades) M.facades[id].emissiveIntensity = nightF * 1.6;
  M.lampHead.emissiveIntensity = nightF * 4;
  for (const m of ADMATS) m.emissiveIntensity = 0.25 + nightF * 1.2;
  M.head.emissiveIntensity = 0.3 + nightF * 3;
  M.tail.emissiveIntensity = 0.4 + nightF * 1.5;
  if (lampGlow) lampGlow.material.opacity = nightF * 0.55;
  const inside = INT.inside;
  if (INT.amb) { INT.amb.intensity = inside ? 0.45 : 0; for (const l of INT.lights) l.intensity = INT.active ? 24 : 0; }
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
  const cop = cars.some(o => o.cop && o !== c && o.mode !== 'wreck' && Math.hypot(o.x - c.x, o.z - c.z) < 70 && lineOfSight(o.x, o.z, c.x, c.z)) || officers.some(o => o.state !== 'dead' && Math.hypot(o.x - c.x, o.z - c.z) < 40);
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
    wall(L, 0.6, cx, z1); wall(0.6, z1 - z0, x0, cz); wall(0.6, z1 - z0, x1, cz); wall(sw, 0.6, x0 + sw / 2, z0); wall(sw, 0.6, x1 - sw / 2, z0);
    for (const [tx, tz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) { chunk.roofs.push(box(1.3, 8.6, 1.3, tx, y0 + 4.3, tz, '#8a8478'), box(3.6, 2.4, 3.6, tx, y0 + 9.8, tz, '#d8d2c4'), box(3.2, 1.0, 3.7, tx, y0 + 10.0, tz, '#2a3440'), box(4.0, 0.3, 4.0, tx, y0 + 11.15, tz, '#5b5f63')); addSolid(tx - 0.7, tx + 0.7, tz - 0.7, tz + 0.7, 9); }
    for (const px of [-gw / 2 - 0.5, gw / 2 + 0.5]) { chunk.roofs.push(box(1.0, h + 2.6, 1.0, cx + px, y0 + (h + 2.6) / 2, z0, '#8a8478')); addSolid(cx + px - 0.5, cx + px + 0.5, z0 - 0.5, z0 + 0.5, h + 3); }
    reg(cx, cz + 11, 38, 18, 3 * 3.6, 3, 'prison', 'concrete', '#cfc8b8');
    const yard = new THREE.PlaneGeometry(L - 1, 20); yard.rotateX(-Math.PI / 2); yard.translate(cx, y0 + 0.015, z0 + 11); const ym = new THREE.Mesh(yard, new THREE.MeshStandardMaterial({ map: TEX.asphalt, color: 0xb8b0a0, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 })); ym.receiveShadow = true; scene.add(ym);
    for (const bx of [cx - 14, cx + 14]) chunk.roofs.push(box(0.15, 3.05, 0.15, bx, y0 + 1.5, z0 + 12, '#777'), box(1.8, 1.05, 0.08, bx, y0 + 3.0, z0 + 12, '#eee'));
    const gate = new THREE.Mesh(new THREE.BoxGeometry(gw, h - 0.3, 0.2), mat('#3c4248', { metalness: 0.8, roughness: 0.35 })); gate.position.set(cx, y0 + (h - 0.3) / 2, z0); gate.castShadow = true; scene.add(gate);
    signMesh('BOLINGBROKE STRAFVOLLZUG', '#2a2a2a', '#e8e0c8', 9, 1.2, cx, y0 + h + 1.6, z0 - 0.55, Math.PI);
    PRISON = { x: cx, z: cz, x0, x1, z0, z1, gate, gw, open: 0, target: 0, solid: addSolid(cx - gw / 2, cx + gw / 2, z0 - 0.3, z0 + 0.3, h), inside: { x: cx, z: z0 + 3 }, people: [] };
    POIS.push({ x: cx, z: z0 - 3, col: '#d8a860', sym: '⛓' });
  }
}
// Gefängnis: Tor, Häftlinge im Hof, Wachen auf den Türmen
function updatePrison(dt) {
  const P0 = PRISON; if (!P0) return;
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
function syncKnock(p) { for (const [m, i, off] of p.inst) { m.setMatrixAt(i, knockMatrix(p, off)); m.instanceMatrix.needsUpdate = true; } }
function knockProp(p, c, sp) {
  removeSolid(p.so); p.st = 1; p.ang = 0.02; const l = Math.hypot(c.vx, c.vz) || 1;
  p.dx = c.vx / l; p.dz = c.vz / l; p.w = (p.kind === 'hyd' ? 2.5 : 0.6) + sp * 0.08; p.vx = c.vx * 0.35; p.vz = c.vz * 0.35; p.sx = p.sz = 0; p.t = 0;
  const loss = { lamp: 0.8, tl: 0.83, hyd: 0.92 }[p.kind]; c.vx *= loss; c.vz *= loss;
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
      p.st = 0; p.ang = 0; p.sx = p.sz = 0; syncKnock(p); p.so = addSolid(p.so.minx, p.so.maxx, p.so.minz, p.so.maxz, p.so.h);
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
function wallBox(w, h, d, x, y, z, color, st = FSTYLES.classic) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, TW = st.TW, TH = st.TH;
  const ou = rint(0, st.bays - 1) / st.bays, ov = rint(0, st.floors - 1) / st.floors;
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v; let u = uv.getX(i), vv = uv.getY(i);
    if (f < 2) { u = u * d / TW + ou; vv = vv * h / TH + ov; }
    else if (f >= 4) { u = u * w / TW + ou; vv = vv * h / TH + ov; }
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
      let top = h;
      if (h > 55 && w > 12 && d > 12) {
        const h2 = Math.round(rnd(0.15, 0.4) * h / 3.6) * 3.6, w2 = w * rnd(0.55, 0.75), d2 = d * rnd(0.55, 0.75);
        chunk.walls[sid].push(wallBox(w2, h2, d2, bx, 0.2 + h + h2 / 2, bz, color, st));
        chunk.roofs.push(box(w2 + 0.4, 0.5, d2 + 0.4, bx, 0.2 + h + h2 + 0.25, bz, '#4d5155'));
        top = h + h2;
        if (Math.random() < 0.6) chunk.roofs.push(box(0.4, rnd(8, 18), 0.4, bx, 0.2 + top + 6, bz, '#888'));
      }
      for (let k = rint(0, 3); k > 0; k--) {
        const aw = rnd(1.5, 4), ad = rnd(1.5, 4), ah = rnd(1, 2.5);
        chunk.roofs.push(box(aw, ah, ad, bx + rnd(-w / 3, w / 3), 0.2 + h + 0.5 + ah / 2, bz + rnd(-d / 3, d / 3), pick(['#9a9c9e', '#7d8083', '#b0b2b4'])));
      }
      const bsol = addSolid(bx - w / 2, bx + w / 2, bz - d / 2, bz + d / 2, top + 0.7);
      mapBuildings.push([bx - w / 2, bz - d / 2, w, d]);
      addBuilding(chunk, bx, bz, w, d, Math.round(top / 3.6), cx, cz, floors <= 5, bsol);
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
function addBuilding(chunk, bx, bz, w, d, floors, cx, cz, low, solid) {
  const fd = [(bz - d / 2) - (cz - B / 2), (cx + B / 2) - (bx + w / 2), (cz + B / 2) - (bz + d / 2), (bx - w / 2) - (cx - B / 2)];
  let side = 0; for (let k = 1; k < 4; k++) if (fd[k] < fd[side]) side = k;
  const rr0 = Math.random(), type = floors > 11 ? (Math.min(w, d) >= 19 && rr0 < 0.3 ? 'hotel' : 'office') : low && rr0 < 0.5 ? 'shop' : rr0 > 0.5 && rr0 < 0.56 ? 'bank' : Math.random() < 0.6 ? 'apartment' : 'office';
  const bld = { x: bx, z: bz, w, d, floors: Math.max(2, floors), seed: Math.floor(Math.random() * 1e9), type, door: null, solid };
  if (fd[side] < 6 && Math.min(w, d) > 7) {
    const [nx, nz] = DIRS[side], tx = -nz, tz = nx;
    const fx = bx + nx * w / 2, fz = bz + nz * d / 2;
    const ob = (along, h, thick, off, y, col) => chunk.roofs.push(nx ? box(thick, h, along, fx + nx * off, y, fz, col) : box(along, h, thick, fx, y, fz + nz * off, col));
    ob(2.8, 3.1, 0.3, 0.1, 0.2 + 1.55, '#2a2c30');
    ob(2.0, 2.6, 0.12, 0.22, 0.2 + 1.3, type === 'shop' ? '#3a5068' : '#1d2a38');
    ob(type === 'shop' ? 6 : 3.6, 0.14, 1.5, 0.75, 0.2 + 3.4, pick(AWNING));
    if (type === 'shop') ob(5.5, 2.2, 0.1, 0.12, 0.2 + 1.7, '#5d7891');
    if (type === 'shop' || type === 'bank' || Math.random() < 0.15) { const ax = fx + nx * 0.35 + tx * 2.4, az = fz + nz * 0.35 + tz * 2.4; chunk.roofs.push(nx ? box(0.5, 1.7, 0.75, ax, 0.2 + 0.85, az, '#2a6a3a') : box(0.75, 1.7, 0.5, ax, 0.2 + 0.85, az, '#2a6a3a')); ATMS.push({ x: ax + nx * 0.7, z: az + nz * 0.7 }); }
    if (type === 'bank' || type === 'hotel') bld.sign = true;
    bld.door = { x: fx + nx * 1.1, z: fz + nz * 1.1, nx, nz, tx, tz };
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
      if (!chunks.has(ck)) chunks.set(ck, { walls: {}, roofs: [] });
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
  }
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
  wn.repeat.set(160, 160); TEX.water = wn;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(S, S), new THREE.MeshPhysicalMaterial({ color: 0x1b5a7e, roughness: 0.08, metalness: 0.1, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.05 }));
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
    const r0 = 0.21 - k * 0.009, seg = new THREE.CylinderGeometry(r0 - 0.012, r0, 1.06, 8, 1);
    seg.translate(0, 0.52, 0); seg.rotateZ(-ang); seg.translate(x, y, 0); parts.push(colorize(seg, k % 2 ? '#7d6448' : '#8f7556'));
    x += Math.sin(ang); y += Math.cos(ang); ang += lean;
  }
  for (let f = 0; f < fronds; f++) {
    const fr = new THREE.PlaneGeometry(1.0, 1, 1, 8), p = fr.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) + 0.5, wd = p.getX(i) * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1.15 - t * 0.5);
      p.setXYZ(i, wd, Math.sin(t * Math.PI * 0.55) * 1.1 - t * t * 2.7, 4.2 * t);
    }
    fr.computeVertexNormals(); fr.rotateY(f / fronds * Math.PI * 2 + rnd(-0.2, 0.2)); fr.translate(x, y, 0);
    parts.push(colorize(fr, pick(['#3f6e2a', '#4a7a30', '#5a8a38', '#3a5f28', '#6a8a3a'])));
  }
  parts.push(colorize(new THREE.SphereGeometry(0.32, 8, 6).translate(x, y - 0.2, 0), '#5a4a2a'));
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
  const lampG = new THREE.SphereGeometry(0.1, 8, 6); lampG.translate(0, 4.2, 0.32);
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
  const leafG = new THREE.IcosahedronGeometry(2.1, 4); { const p = leafG.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (Math.sin(p.getX(i) * 3.1) * Math.cos(p.getZ(i) * 2.7) + Math.sin(p.getY(i) * 4.3)) * 0.07; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k); } leafG.computeVertexNormals(); } leafG.translate(0, 4.4, 0);
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
  const hG = mergeGeometries([new THREE.CylinderGeometry(0.15, 0.17, 0.62, 10).translate(0, 0.31, 0), new THREE.SphereGeometry(0.15, 10, 6).translate(0, 0.62, 0), new THREE.CylinderGeometry(0.06, 0.06, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 0.42, 0)].map(g => g.index ? g.toNonIndexed() : g));
  const hM = new THREE.InstancedMesh(hG, mat('#b8261c', { roughness: 0.5, metalness: 0.3 }), Math.max(1, hyd.length));
  hyd.forEach(([x, z], k) => { dummy.position.set(x, 0.2, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); hM.setMatrixAt(k, dummy.matrix); const so = addSolid(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 0.8); addKnock({ kind: 'hyd', x, z, rot: 0, h: 0.8, so, inst: [[hM, k, 0]] }); });
  hM.count = hyd.length; hM.castShadow = true; scene.add(hM);
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
const MALE_V = ['thorsten', 'karlsson', 'pavoque'], FEM_V = ['kerstin', 'ramona'];
function pedLook(office = false) {
  if (Math.random() < 0.45) return { gender: 'f', tint: pick(FEM_T) };
  return { gender: 'm', skin: pick(SKIN_T), shirt: pick(office ? OFFICE : CLOTH), pants: pick(PANTS), shoes: pick(['#ffffff', '#3a3a3a', '#8a6a4a', '#c0c0c0']), hair: pick(HAIR), beard: Math.random(), hairStyle: pick(['buzz', 'buzz', 'slick', 'bald']), hat: Math.random() < 0.2 ? pick(['#3a2a1c', '#222222', '#c8a070']) : null };
}
const officeLook = () => pedLook(true);
const voiceFor = L => L.gender === 'f' ? [pick(FEM_V), rnd(0.95, 1.08)] : [pick(MALE_V), rnd(0.9, 1.1)];
function buildFacePool() {}

// ---------- Cars ----------
const carGeoCache = {};
function extrudeProfile(pts, depth, bevel) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, bevel ? { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 } : { depth, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0); return g;
}
function carGeos(L, W, hs, kind = 'car') {
  const key = L + '_' + W + '_' + hs + kind; if (carGeoCache[key]) return carGeoCache[key];
  const Y = y => 0.32 + (y - 0.32) * hs;
  const body = extrudeProfile([[0.05, 0.32], [0, Y(0.82)], [0.3, Y(0.96)], [L - 1.3, Y(0.98)], [L - 0.4, Y(0.88)], [L, Y(0.68)], [L - 0.04, 0.32]], W - 0.14, 0.07);
  let ghP = [[0.85, Y(0.96)], [1.4, Y(1.46)], [L - 1.75, Y(1.46)], [L - 1.2, Y(0.97)]], top = Y(1.46);
  if (kind === 'pickup') ghP = [[L * 0.43, Y(0.96)], [L * 0.47, Y(1.5)], [L - 1.75, Y(1.5)], [L - 1.2, Y(0.97)]];
  if (kind === 'van') ghP = [[L - 1.62, Y(0.98)], [L - 1.56, Y(1.9)], [L - 1.4, Y(1.9)], [L - 0.7, Y(0.99)]];
  if (kind === 'convertible') { ghP = [[L - 1.62, Y(0.97)], [L - 1.95, Y(1.32)], [L - 1.86, Y(1.34)], [L - 1.52, Y(0.97)]]; top = Y(1.0); }
  const gh = extrudeProfile(ghP, W - 0.3, 0);
  [body, gh].forEach(g => g.translate(0, 0, -L / 2));
  const extra = [];
  if (kind === 'van') { const cargo = extrudeProfile([[0.12, Y(0.97)], [0.16, Y(2.0)], [L - 1.62, Y(2.0)], [L - 1.62, Y(0.97)]], W - 0.24, 0.04); cargo.translate(0, 0, -L / 2); extra.push(cargo); top = Y(2.0); }
  else if (kind !== 'convertible') { const roof = new THREE.BoxGeometry(W - 0.34, 0.05, ghP[2][0] - ghP[1][0]); roof.translate(0, ghP[1][1] + 0.025, (ghP[1][0] + ghP[2][0]) / 2 - L / 2); extra.push(roof.toNonIndexed()); }
  const paintG = mergeGeometries([body, ...extra]);
  let seat = null;
  if (kind === 'convertible') {
    const parts = [[0.5, 0.5, 0.5, 0.42, 0.2], [0.5, 0.5, 0.5, -0.42, 0.2], [1.3, 0.45, 0.5, 0, -0.9]].flatMap(([w, h, d, x, z]) => {
      const a = new THREE.BoxGeometry(w, 0.18, d); a.translate(x, Y(0.98) + 0.05, z); const b = new THREE.BoxGeometry(w, h, 0.14); b.translate(x, Y(0.98) + h / 2, z - d / 2);
      return [a.toNonIndexed(), b.toNonIndexed()];
    });
    seat = mergeGeometries(parts);
  }
  const trims = [
    [W, 0.2, 0.16, 0, 0.42, L / 2 + 0.02], [W, 0.2, 0.16, 0, 0.42, -L / 2 - 0.02], [W * 0.5, 0.16, 0.05, 0, Y(0.6), L / 2 + 0.03],
    [0.12, 0.1, 0.2, W / 2 + 0.05, Y(1.0), L / 2 - 1.5], [0.12, 0.1, 0.2, -W / 2 - 0.05, Y(1.0), L / 2 - 1.5],
    ...(kind === 'pickup' ? [[W - 0.32, 0.03, L * 0.43 - 0.35, 0, Y(0.98) + 0.02, -L / 2 + 0.15 + (L * 0.43 - 0.35) / 2]] : []),
  ].map(([w, h, d, x, y, z]) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed(); });
  const lightG = (z, y) => { const a = new THREE.BoxGeometry(0.42, 0.13, 0.06), b = a.clone(); a.translate(W / 2 - 0.32, y, z); b.translate(-W / 2 + 0.32, y, z); return mergeGeometries([a, b]); };
  const tire = colorize(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18).rotateZ(Math.PI / 2).toNonIndexed(), '#141414');
  const rim = colorize(new THREE.CylinderGeometry(0.23, 0.23, 0.275, 10).rotateZ(Math.PI / 2).toNonIndexed(), '#c4c7cc');
  return carGeoCache[key] = {
    paint: paintG, glass: gh, trim: mergeGeometries(trims), head: lightG(L / 2 + 0.005, Y(0.74)), tail: lightG(-L / 2 - 0.005, Y(0.8)),
    wheel: mergeGeometries([tire, rim]), top, seat,
  };
}
const CAR_TYPES = {
  sedan: { L: 4.6, W: 1.86, hs: 1, max: 38, acc: 13 }, coupe: { L: 4.4, W: 1.92, hs: 0.86, max: 48, acc: 19 },
  suv: { L: 4.8, W: 2.0, hs: 1.25, max: 34, acc: 11 }, compact: { L: 3.9, W: 1.75, hs: 1.05, max: 32, acc: 11 },
  police: { L: 4.7, W: 1.9, hs: 1, max: 44, acc: 17 },
  pickup: { L: 5.3, W: 2.0, hs: 1.2, max: 36, acc: 12, kind: 'pickup' }, van: { L: 5.0, W: 2.0, hs: 1, max: 30, acc: 9, kind: 'van' },
  convertible: { L: 4.5, W: 1.9, hs: 0.9, max: 45, acc: 16, kind: 'convertible' }, limo: { L: 6.3, W: 2.0, hs: 1.0, max: 36, acc: 10 }, muscle: { L: 4.8, W: 1.96, hs: 0.86, max: 50, acc: 20 },
};
const TRAFFIC_TYPES = ['sedan', 'sedan', 'coupe', 'suv', 'compact', 'compact', 'pickup', 'pickup', 'van', 'convertible', 'muscle', 'suv'];
const CAR_COLORS = ['#b8b8b8', '#1c1c1c', '#f2f2f2', '#7d0f12', '#123d6b', '#2f5233', '#c9a227', '#5c5f63', '#a34a12', '#3a2f5c', '#0f5e63', '#d35d0e', '#d7c9a3', '#9c2a2a', '#e8e0d0', '#2a4a6a', '#556b2f', '#c0392b', '#7a8a9a', '#4a3a2a'];
const cars = [];
function makeCar(type, color, x, z, yaw, mode) {
  const T = CAR_TYPES[type], G = carGeos(T.L, T.W, T.hs, T.kind);
  const group = new THREE.Group(), body = new THREE.Group(); group.add(body);
  const pm = type === 'police' ? paint('#0d0e10') : paint(color);
  const paintMesh = new THREE.Mesh(G.paint, pm);
  const glass = new THREE.Mesh(G.glass, M.glass);
  paintMesh.castShadow = glass.castShadow = true;
  body.add(paintMesh, glass, new THREE.Mesh(G.trim, M.trim), new THREE.Mesh(G.head, M.head), new THREE.Mesh(G.tail, M.tail));
  if (G.seat) body.add(new THREE.Mesh(G.seat, mat('#c8a882', { roughness: 0.6 })));
  // Vordertüren mit Scharnier (links = Fahrer)
  const Yh = y => 0.32 + (y - 0.32) * T.hs, zh = T.L / 2 - 1.25, doors = [];
  for (const side of [1, -1]) {
    const pv = new THREE.Group(); pv.position.set(side * (T.W / 2 - 0.02), 0, zh); body.add(pv);
    const ph = Yh(0.96) - 0.38, pnl = new THREE.Mesh(new THREE.BoxGeometry(0.07, ph, 1.1), type === 'police' ? M.white : pm); pnl.position.set(side * 0.03, 0.38 + ph / 2, -0.55); pnl.castShadow = true; pv.add(pnl);
    if (T.kind !== 'convertible') { const gh = Yh(1.36) - Yh(0.99), gl = new THREE.Mesh(new THREE.BoxGeometry(0.035, gh, 0.9), M.glass); gl.position.set(side * 0.02, Yh(0.99) + gh / 2, -0.6); pv.add(gl); }
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), M.trim); hd.position.set(side * 0.08, Yh(0.85), -0.85); pv.add(hd);
    doors.push({ pv, side, open: 0, target: 0 });
  }
  const wheels = [];
  for (const [wx, wz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pivot = new THREE.Group(); pivot.position.set(wx * (T.W / 2 - 0.15), 0.36, wz * (T.L / 2 - 0.88));
    const w = new THREE.Mesh(G.wheel, M.wheel); pivot.add(w); group.add(pivot); wheels.push(pivot);
  }
  const car = { type, T, top: G.top, group, body, doors, driver: null, pitch: 0, roll: 0, av: 0, paintMesh, wheels, x, z, y: 0, yaw, vx: 0, vz: 0, steer: 0, spin: 0, health: 100, mode, smoke: 0,
    ai: { dir: 0, laneC: 0, nextK: 0, decided: -99, turn: null, speed: 0, stuck: 0, rev: 0, knockX: 0, knockZ: 0 } };
  if (type === 'police') {
    const doorG = new THREE.PlaneGeometry(1.6, 0.42);
    for (const s of [1, -1]) { const d = new THREE.Mesh(doorG, M.white); d.rotation.y = s * Math.PI / 2; d.position.set(s * (T.W / 2 + 0.005), 0.66, -0.9); body.add(d); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.3), M.trim); bar.position.set(0, G.top + 0.12, -0.2);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.26), M.copRed); red.position.set(0.28, G.top + 0.2, -0.2);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.26), M.copBlue); blue.position.set(-0.28, G.top + 0.2, -0.2);
    body.add(bar, red, blue);
  }
  scene.add(group); cars.push(car); syncCar(car);
  return car;
}
function syncCar(c) {
  c.group.position.set(c.x, c.y, c.z); c.group.rotation.y = c.yaw;
  c.body.rotation.set(c.pitch, 0, c.roll);
  for (const d of c.doors) { if (d.open !== d.target) { d.open += clamp(d.target - d.open, -0.05, 0.05); d.pv.rotation.y = -d.side * 1.15 * smooth(0, 1, d.open); } }
  for (let i = 0; i < 4; i++) { c.wheels[i].children[0].rotation.x = c.spin; if (i < 2) c.wheels[i].rotation.y = c.steer * 0.6; }
}
function removeCar(c) { if (c.ownGeo) c.paintMesh.geometry.dispose(); if (c.driver && c.driver !== player.h) disposeHuman(c.driver); scene.remove(c.group); cars.splice(cars.indexOf(c), 1); }
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
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;
  let vf = c.vx * fx + c.vz * fz, vl = c.vx * rx + c.vz * rz;
  const max = c.mode === 'wreck' ? 0 : c.T.max;
  if (throttle > 0) vf += c.T.acc * throttle * Math.max(0.1, 1 - vf / max) * dt;
  else if (throttle < 0) { if (vf > 0.5) vf -= 28 * dt; else vf = Math.max(-11, vf - 9 * dt); }
  else vf -= Math.sign(vf) * Math.min(Math.abs(vf), 3.5 * dt);
  if (hand) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);
  vf *= 1 - 0.12 * dt;
  vl *= Math.exp(-(hand ? 1.3 : 9) * dt);
  const maxSteer = 0.62 / (1 + Math.abs(vf) * 0.045);
  c.steer = lerp(c.steer, steerIn * maxSteer, Math.min(1, dt * 7));
  const yawRate = (vf / 2.8) * Math.tan(c.steer) * (hand ? 1.45 : 1);
  c.yaw += yawRate * dt + c.av * dt; c.av *= Math.exp(-2.2 * dt);
  // Federung: Nicken beim Bremsen/Beschleunigen, Rollen in Kurven (Feder-Dämpfer)
  const acc = (vf - (c.lastVf ?? vf)) / Math.max(dt, 1e-3); c.lastVf = vf;
  const tp = clamp(-acc * 0.0065, -0.07, 0.07), tr = clamp(vf * yawRate * 0.0065, -0.09, 0.09);
  c.pv = ((c.pv || 0) + ((tp - c.pitch) * 90 - (c.pv || 0) * 9) * dt); c.pitch += c.pv * dt;
  c.rv = ((c.rv || 0) + ((tr - c.roll) * 80 - (c.rv || 0) * 8) * dt); c.roll += c.rv * dt;
  if ((Math.abs(vl) > 3.5 || (hand && Math.abs(vf) > 7)) && c === player.car) skidMark(c);
  const nfx = Math.sin(c.yaw), nfz = Math.cos(c.yaw);
  c.vx = nfx * vf + -nfz * vl; c.vz = nfz * vf + nfx * vl;
  c.x += c.vx * dt; c.z += c.vz * dt;
  c.spin += vf * dt / 0.36;
  carWorldCollide(c);
  c.y = lerp(c.y, groundH(c.x, c.z), Math.min(1, dt * 10));
  c.speedF = vf;
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
  if (d < 9) hurtPlayer(70 * (1 - d / 9));
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
    setHumanShadow(p.h, dist < 40);
    p.h.group.visible = dist < 140;
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
  INT.amb = new THREE.AmbientLight(0xffffff, 0); scene.add(INT.amb);
}
let ITEX = null;
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
  ITEX.mats = {
    carpet: sm(ITEX.carpet, 0.95), carpet2: sm(ITEX.carpet2, 0.95), wood: sm(ITEX.wood, 0.5), wood2: sm(ITEX.wood2, 0.45), tile: sm(ITEX.tile, 0.3, 0.05), tile2: sm(ITEX.tile2, 0.25, 0.05),
    ceil: new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.9, side: THREE.DoubleSide }),
    panel: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3e2, emissiveIntensity: 1.8 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0a1020, emissive: 0x6a9cff, emissiveIntensity: 1.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fc0d0, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    door: new THREE.MeshStandardMaterial({ color: 0xa7afb7, metalness: 0.7, roughness: 0.3 }),
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
function buildFloor(f) {
  const b = INT.b, F = { f, group: new THREE.Group(), solids: [], npcs: [], spots: [], rooms: [], kind: '', respawnT: rnd(8, 20), doors: [], doorSolid: null };
  F.group.position.y = floorY(f); INT.root.add(F.group);
  const T = interiorTextures(), r = mulberry(b.seed * 31 + f * 7919 + 1), rr = (a, c) => a + r() * (c - a), rp = a => a[Math.floor(r() * a.length)];
  const W = INT.W, D = INT.D, hw = W / 2 - 0.2, hd = D / 2 - 0.2, top = f >= b.floors - 1, hole = f > 0, small = b.small;
  const kind = b.type === 'prison' ? 'flat' : small && !['market', 'gas', 'bank'].includes(b.type) ? 'shop' : b.type === 'bank' ? (f === 0 ? 'bank' : 'office') : b.type === 'hotel' ? (f === 0 ? 'hotel' : 'flat') : b.type === 'hospital' ? (f === 0 ? 'lobby' : 'ward') : b.type === 'police' ? (f === 0 ? 'police' : 'office') : b.type === 'market' ? 'market' : b.type === 'gas' ? 'gas' : f === 0 ? (b.type === 'shop' ? 'shop' : 'lobby') : b.type === 'office' ? 'office' : 'flat';
  F.kind = kind;
  const g = F.group, vc = [], scr = [], pan = [], glass = [], spots = F.spots;
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
  const wallCol = rp(['#e9e6df', '#dfe4e8', '#ece4d6', '#e4e0ea', '#e6ece4', '#d8e2dc', '#efe2d2', '#d6d9e4']);
  const wallX = (x0, x1, z, gaps = [], col = wallCol, t = 0.16) => { let a = x0; for (const [g0, g1] of [...gaps, [x1, x1]].sort((p, q) => p[0] - q[0])) { if (g0 - a > 0.05) fb(g0 - a, 3.4, t, (a + g0) / 2, 1.7, z, col, true); a = Math.max(a, g1); } };
  const wallZ = (z0, z1, x, gaps = [], col = wallCol, t = 0.16) => { let a = z0; for (const [g0, g1] of [...gaps, [z1, z1]].sort((p, q) => p[0] - q[0])) { if (g0 - a > 0.05) fb(t, 3.4, g0 - a, x, 1.7, (a + g0) / 2, col, true); a = Math.max(a, g1); } };
  const plane = (x0, x1, z0, z1, y, m, tileS) => g.add(holedPlane(x0, x1, z0, z1, y, m, tileS, []));
  // Boden & Decke (mit Schacht- und Treppenöffnungen)
  const fm = { flat: rp([T.mats.wood, T.mats.wood2, T.mats.tile]), office: rp([T.mats.carpet, T.mats.carpet2, T.mats.wood2]), ward: T.mats.tile, police: T.mats.tile2 }[kind] || rp([T.mats.tile, T.mats.tile2]);
  const core = !small;
  g.add(holedPlane(-hw, hw, -hd, hd, 0.005, fm, 2, core && hole ? [ELEV, H1, H2] : []));
  g.add(holedPlane(-hw, hw, -hd, hd, 3.4, T.mats.ceil, 2, core && !top ? [ELEV, H1, H2] : [], true));
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
  if (f === 0) { fb(2.6, 0.75, 0.3, 0, 2.97, -hd, ext); F.exit = { x: 0, z: -hd + 0.9 }; }
  // Kern: Aufzug + Treppenhaus mit Zwischenpodest
  const coreCol = rp(['#b9c2c9', '#c9bfb2', '#a9b4a8', '#c4c0cc', '#d0c8b8']);
  if (core) {
    wallX(-3.2, 3.2, -3, [[-2.6, -1.2], [0.1, 1.3]], coreCol, 0.2); wallX(-3.2, 3.2, 3, [], coreCol, 0.2);
    wallZ(-3, 3, -3.2, [], coreCol, 0.2); wallZ(-3, 3, 3.2, [], coreCol, 0.2); wallZ(-3, 3, -0.5, [], coreCol, 0.16); wallX(-3.2, -0.5, -0.4, [], coreCol, 0.16);
    iSolid(-3.2, -0.5, -0.4, 3);
    const dl = new THREE.Mesh(new THREE.BoxGeometry(0.72, 2.3, 0.06), T.mats.door), dr = dl.clone(); dl.position.set(-2.25, 1.15, -3.13); dr.position.set(-1.55, 1.15, -3.13); g.add(dl, dr); F.doors = [dl, dr];
    F.doorSolid = fSolid(F, -2.6, -1.2, -3.12, -2.98, -0.05, 3.0);
    fb(0.1, 0.18, 0.05, -0.95, 1.2, -3.13, '#ffd23a'); fb(0.7, 0.2, 0.04, -1.9, 2.75, -3.13, '#111');
    scr.push(box(0.6, 0.14, 0.02, -1.9, 2.75, -3.16, '#fff'));
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
  }
  // Möbel
  const deskCol = rp(['#c8b89a', '#e6e6e6', '#6b5040', '#9aa0a6']);
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
  const chair = (x, z, yaw, room, type = 'meet') => { rb(0.46, 0.07, 0.46, 0, 0.45, 0, yaw, x, z, '#30343a'); rb(0.46, 0.5, 0.06, 0, 0.75, -0.24, yaw, x, z, '#30343a'); return spot(type, x, z, yaw, 'sit', room); };
  const plant = (x, z) => { fb(0.45, 0.45, 0.45, x, 0.225, z, '#6b5040', true); vc.push(colorize(new THREE.IcosahedronGeometry(0.45, 1).translate(x, 0.95, z), '#3f7a3a')); };
  const sofa = (x, z, yaw, room, col) => { rb(2.0, 0.42, 0.85, 0, 0.21, 0, yaw, x, z, col, true); rb(2.0, 0.5, 0.2, 0, 0.65, -0.33, yaw, x, z, col); rb(0.2, 0.3, 0.85, -0.9, 0.55, 0, yaw, x, z, col); rb(0.2, 0.3, 0.85, 0.9, 0.55, 0, yaw, x, z, col); return spot('sofa', x, z, yaw, 'watch', room); };
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
      const prod = ['#d43f3a', '#f0ad4e', '#5cb85c', '#5bc0de', '#ffffff', '#8e44ad', '#2c3e50', '#e67e22', '#f4d03f', '#a04000'];
      const lanes = kind === 'market' ? Math.max(2, Math.min(4, Math.floor(W / 8))) : 1;
      for (let k = 0; k < lanes; k++) {
        const x = -hw + 2.6 + k * 3.4, z = -hd + 3.4;
        rb(0.8, 0.9, 2.4, 0, 0.45, 0, 0, x, z, '#3a3f45', true); rb(0.5, 0.05, 1.6, 0, 0.92, -0.2, 0, x, z, '#222'); rb(0.35, 0.35, 0.3, 0, 1.12, 0.7, 0, x, z, '#1a1a1a');
        spot('cashier', x + 0.95, z + 0.4, -Math.PI / 2, 'stand', all); spot('pay', x - 0.95, z - 0.2, Math.PI / 2, 'look', all);
      }
      for (let z = -hd + (kind === 'market' ? 7 : 5.5), row = 0; z < hd - 2.6; z += 2.8, row++) {
        for (let x = -hw + (kind === 'market' ? 4 : 2.8); x < hw - 3; x += 7) {
          const len = Math.min(5.5, hw - 1.5 - x); if (len < 2) continue;
          rb(len, 1.8, 0.6, 0, 0.9, 0, 0, x + len / 2, z, '#e3e3e3', true);
          for (let k = 0; k < Math.floor(len * 4); k++) for (const sz of [-0.32, 0.32]) rb(0.2, 0.26, 0.16, -len / 2 + 0.2 + k * 0.25, 0.35 + (k % 3) * 0.55, sz, 0, x + len / 2, z, prod[(k * 7 + row * 3) % prod.length]);
          spot('shelf', x + len / 2 + rnd(-1.5, 1.5), z - 0.9, 0, 'browse', all); spot('shelf', x + len / 2 + rnd(-1.5, 1.5), z + 0.9, Math.PI, 'browse', all);
        }
      }
      for (let x = -hw + 1.2; x < hw - 0.8; x += 1.2) { fb(1.1, 2.0, 0.7, x, 1.0, hd - 0.6, '#d8dde2', true); scr.push(box(1.0, 1.6, 0.02, x, 1.05, hd - 0.96, '#fff')); }
      if (kind === 'market') for (let k = 0; k < 4; k++) { const x = hw - 3 - k * 1.6, z = -hd + 3; rb(1.3, 0.8, 1.0, 0, 0.4, 0, 0, x, z, '#8a6a3a', true); for (let q = 0; q < 12; q++) rb(0.12, 0.12, 0.12, rnd(-0.5, 0.5), 0.86, rnd(-0.4, 0.4), 0, x, z, ['#e74c3c', '#f1c40f', '#27ae60', '#e67e22'][k]); }
    } else if (kind === 'bank') {
      INT.company = 'Fleeca Bank';
      for (let k = 0; k < 3; k++) { const x = -3 + k * 3; rb(2.4, 1.1, 0.8, 0, 0.55, 0, 0, x, -hd + 5, '#2f5a3a', true); rb(2.4, 0.9, 0.05, 0, 1.55, 0.3, 0, x, -hd + 5, '#cfe0e8'); spot('cashier', x, -hd + 5.8, Math.PI, 'stand', all); spot('visit', x, -hd + 4, 0, 'look', all); }
      const v = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 32), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.25 })); v.rotation.x = Math.PI / 2; v.position.set(hw - 0.3, 1.6, 0); v.rotation.z = Math.PI / 2; g.add(v);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.8), new THREE.MeshStandardMaterial({ map: signTex('FLEECA', '#1f6b3a', '#ffffff'), emissive: 0xffffff, emissiveMap: signTex('FLEECA', '#1f6b3a', '#ffffff'), emissiveIntensity: 0.4 })); sign.position.set(0, 2.7, -hd + 6.6); sign.rotation.y = Math.PI; g.add(sign);
      plant(-hw + 0.8, -hd + 0.8); plant(hw - 0.8, -hd + 0.8); sofa(-hw + 2.2, -hd + 3, Math.PI / 2, all, '#2a3a2a');
    } else if (kind === 'hotel') {
      INT.company = floorName(b, 0).replace('EG · ', '');
      rb(4, 1.1, 0.8, 0, 0.55, 0, 0, 0, -hd + 5, '#5a3a24', true); rb(4.2, 0.05, 1.0, 0, 1.12, 0, 0, 0, -hd + 5, '#e8dcc0');
      spot('reception', 0, -hd + 5.9, Math.PI, 'stand', all); spot('visit', -0.6, -hd + 4, 0, 'look', all); spot('visit', 0.8, -hd + 4, 0, 'talk', all);
      sofa(-hw + 2.4, -hd + 4, Math.PI / 2, all, '#7a2a2a'); sofa(hw - 2.4, -hd + 4, -Math.PI / 2, all, '#7a2a2a'); plant(-2.6, -hd + 5); plant(2.6, -hd + 5);
      const chand = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0a0, emissiveIntensity: 2 })); chand.position.set(0, 2.9, -hd + 3); g.add(chand);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.8), new THREE.MeshStandardMaterial({ map: signTex(INT.company.toUpperCase(), '#2a1a10', '#e8c070', 1024, 160, 'bold 80px Georgia'), emissive: 0xffffff, emissiveMap: signTex(INT.company.toUpperCase(), '#2a1a10', '#e8c070', 1024, 160, 'bold 80px Georgia'), emissiveIntensity: 0.4 })); sign.position.set(0, 2.6, -hd + 6.5); sign.rotation.y = Math.PI; g.add(sign);
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
    }
  }
  // Meshes zusammenführen
  const add = (list, m, shadow = true) => { if (!list.length) return; const mesh = new THREE.Mesh(mergeGeometries(list.map(q => q.index ? q.toNonIndexed() : q)), m); mesh.receiveShadow = shadow; g.add(mesh); };
  add(vc, M.ivcol); add(scr, T.mats.screen, false); add(pan, T.mats.panel, false);
  if (glass.length) g.add(new THREE.Mesh(mergeGeometries(glass), T.mats.glass));
  F.rooms = rooms;
  if (myHotelFloor(F) && rooms.length) {
    const q = rooms[player.hotel.room % rooms.length], bed = spots.find(sp => sp.type === 'bed' && sp.room === q);
    if (bed) { const mk = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })); mk.position.set(q.inPt[0], 0.6, q.inPt[1]); g.add(mk); F.hotelBed = { x: q.inPt[0], z: q.inPt[1] }; }
  }
  populateFloor(F);
  return F;
}
function unloadFloor(F) {
  for (const s of F.solids) removeSolid(s);
  for (const n of F.npcs) { if (n.at && n.at.occ === n) n.at.occ = null; disposeHuman(n.h); }
  F.group.traverse(o => { if (o.geometry && !o.isSkinnedMesh && o.geometry !== F.doors[0]?.geometry) o.geometry.dispose(); });
  INT.root.remove(F.group); INT.floors.delete(F.f);
}
// ---------- Aufzug: fahrende Kabine mit Türen ----------
function buildCab() {
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.7, roughness: 0.28 }), wood = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 0.6 });
  const add = (w, h, d, x, y, z, mat = m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.receiveShadow = true; g.add(o); return o; };
  add(2.45, 0.08, 2.4, 0, 0.04, 0, wood); add(2.45, 2.7, 0.06, 0, 1.35, 1.2); add(0.06, 2.7, 2.4, -1.22, 1.35, 0); add(0.06, 2.7, 2.4, 1.22, 1.35, 0); add(2.45, 0.06, 2.4, 0, 2.72, 0);
  add(1.2, 0.03, 0.8, 0, 2.68, 0, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2 }));
  add(2.3, 0.05, 0.05, 0, 0.95, 1.12, m); add(0.2, 0.5, 0.03, 1.05, 1.3, -1.1, new THREE.MeshStandardMaterial({ color: 0x222, emissive: 0x3366ff, emissiveIntensity: 0.6 }));
  const dl = add(0.62, 2.5, 0.05, -0.31, 1.3, -1.18), dr = add(0.62, 2.5, 0.05, 0.31, 1.3, -1.18);
  g.position.set(-1.85, floorY(0), -1.7); INT.root.add(g);
  return { g, dl, dr, y: floorY(0), target: 0, floor: 0, v: 0, open: 1, state: 'open', wait: 6 };
}
function callCab(f) {
  const C = INT.cab; if (!C) return;
  C.target = f;
  if (C.state === 'moving') return;
  if (C.floor === f && Math.abs(C.y - floorY(f)) < 0.01) { if (C.state !== 'open') C.state = 'opening'; C.wait = 8; return; }
  C.state = 'closing';
}
function inCab() { const [lx, lz] = toLocal(player.x, player.z); return lx > ELEV[0] && lx < ELEV[1] && lz > ELEV[2] && lz < ELEV[3] && Math.abs(player.y - INT.cab.y) < 1.2; }
function updateCab(dt) {
  const C = INT.cab, ty = floorY(C.target);
  if (C.state === 'closing') { C.open = Math.max(0, C.open - dt * 1.3); if (C.open === 0) { C.state = Math.abs(C.y - ty) > 0.01 ? 'moving' : 'opening'; if (C.state === 'moving') sfx.hum(true); } }
  else if (C.state === 'moving') {
    const d = ty - C.y, sp = Math.min(4.5, Math.sqrt(Math.abs(d) * 2 * 2.2) + 0.15);
    C.v = lerp(C.v, Math.sign(d) * sp, Math.min(1, dt * 2.5)); const step = C.v * dt;
    if (Math.abs(step) >= Math.abs(d)) { C.y = ty; C.v = 0; C.floor = C.target; C.state = 'opening'; sfx.hum(false); sfx.ding(); } else C.y += step;
    C.floor = clamp(Math.round((C.y - Y0) / FH), 0, INT.b.floors - 1);
  }
  else if (C.state === 'opening') { C.open = Math.min(1, C.open + dt * 1.3); if (C.open === 1) { C.state = 'open'; C.wait = 8; } }
  else if (C.state === 'open') { C.wait -= dt; if (C.wait < 0 && !inCab()) { C.state = 'closing'; C.target = C.floor; } }
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
  if (riding) { player.y = C.y; player.vy = 0; player.grounded = true; }
}
// ---------- Etagen laden/entladen, Gebäude aktivieren ----------
const curFloorOf = y => clamp(Math.floor((y - Y0 + 0.6) / FH), 0, INT.b.floors - 1);
function syncFloors() {
  const fc = INT.inside ? curFloorOf(player.y) : 0; INT.fc = fc;
  const want = new Set([fc - 1, fc, fc + 1].filter(f => f >= 0 && f < (INT.b.small ? 1 : INT.b.floors)));
  if (INT.cab && INT.cab.state === 'moving') want.add(INT.cab.floor);
  for (const [f, F] of [...INT.floors]) if (!want.has(f)) unloadFloor(F);
  for (const f of want) if (!INT.floors.has(f)) INT.floors.set(f, buildFloor(f));
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
  INT.cab = b.small ? null : buildCab();
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
  INT.active = false; INT.inside = false; INT.b = null; INT.cab = null; INT.menu = null; INT.npcs = []; $('elev').style.display = 'none';
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
    if (!INT.active) { if (!player.car && !player.dead) { const b = nearestDoor(player.x, player.z, 14); if (b) activateBuilding(b); } }
    else if (!INT.inside) {
      const d = INT.b.door, dd = Math.hypot(d.x - player.x, d.z - player.z);
      const nb = !player.car && nearestDoor(player.x, player.z, 10);
      if (dd > 26 || player.car || (nb && nb !== INT.b && dd > 12)) deactivateBuilding();
    }
    if (INT.active) syncFloors();
  }
  if (!INT.active) return;
  if (INT.cab) updateCab(dt);
  updateInterior(dt);
}
// ---------- Innen-NPCs ----------
function spawnINpc(F, role, s, look) {
  const L = look || (['worker', 'reception', 'visitor', 'cop'].includes(role) ? officeLook() : pedLook()), h = makeHuman(L);
  setHumanShadow(h, false); F.group.add(h.group);
  const [voice, vrate] = voiceFor(L);
  const n = { F, h, voice, vrate, x: s.x, z: s.z, yaw: s.yaw, role, home: s, at: s, room: s.room, path: null, pi: 0, pose: s.pose, wait: rnd(4, 25), state: 'act', hp: 40, n: 0 };
  if (!s.multi) s.occ = n; F.npcs.push(n); return n;
}
function populateFloor(F) {
  const S = F.spots, free = t => S.filter(s => s.type === t && !s.occ), kind = F.kind;
  if (kind === 'office') { const desks = free('desk'); desks.sort(() => Math.random() - 0.5); desks.slice(0, Math.min(10, Math.ceil(desks.length * 0.7))).forEach(s => spawnINpc(F, 'worker', s)); }
  else if (kind === 'flat') { for (const q of F.rooms) if (Math.random() < 0.75 && !(myHotelFloor(F) && F.rooms.indexOf(q) === player.hotel.room % F.rooms.length)) { const opts = S.filter(s => s.room === q && !s.occ && s.type !== 'window'); const s = nightF > 0.6 ? opts.find(o => o.type === 'bed') : pick(opts); if (s) spawnINpc(F, 'resident', s, INT.b.type === 'prison' ? INMATE_LOOK() : undefined); } }
  else if (kind === 'ward') { for (const s of free('bed')) if (Math.random() < 0.7) spawnINpc(F, 'patient', s); for (let k = 0; k < 2; k++) { const s = pick(free('bedside')); if (s) spawnINpc(F, 'nurse', s, { gender: 'f', tint: '#cfe8f0' }); } }
  else if (kind === 'bank') { for (const s of free('cashier')) spawnINpc(F, 'cashier', s, officeLook()); for (const v of free('visit').slice(0, 2)) spawnINpc(F, 'visitor', v); }
  else if (kind === 'lobby' || kind === 'police' || kind === 'hotel') { const s = free('reception')[0]; if (s) spawnINpc(F, 'reception', s, kind === 'police' ? COP_LOOK : null); const v = free('visit')[0]; if (v) spawnINpc(F, 'visitor', v); if (kind === 'police') for (const d of free('desk').slice(0, 3)) spawnINpc(F, 'worker', d, COP_LOOK); }
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
      if (n.at !== n.home) { if (!n.home.occ || n.home.occ === n) return iGo(n, n.home, rnd(25, 70)); return leave(); }
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
    F.respawnT -= dt;
    if (F.respawnT < 0 && !INT.panic) {
      F.respawnT = rnd(10, 25);
      const free = t => F.spots.filter(s => s.type === t && !s.occ);
      if (F.npcs.length < 14) {
        let role = null, tgt = null;
        if (F.kind === 'office') { tgt = pick(free('desk')); role = 'worker'; }
        else if (['shop', 'market', 'gas'].includes(F.kind)) { tgt = pick(free('shelf')); role = 'customer'; }
        else if (F.kind === 'lobby' || F.kind === 'police') { tgt = pick(free('visit')); role = 'visitor'; }
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
    if (b.small || f === 0 || !(inR(ELEV) || inR(H1) || inR(H2))) c.push(base);
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
function nearElevCall() { const [lx, lz] = toLocal(player.x, player.z); return !INT.b.small && Math.hypot(lx + 1.9, lz + 3.7) < 1.4; }
function openElevator() { INT.menu = true; INT.sel = curFloorOf(player.y); renderElevator(); $('elev').style.display = 'block'; sfx.ding(); }
function renderElevator() {
  const b = INT.b, n = b.floors, lo = clamp(INT.sel - 5, 0, Math.max(0, n - 11)), hi = Math.min(n, lo + 11), cf = INT.cab.floor;
  let html = '<div class="et">AUFZUG</div>';
  for (let f = hi - 1; f >= lo; f--) html += `<div class="ef${f === INT.sel ? ' sel' : ''}${f === cf ? ' cur' : ''}">${floorName(b, f)}</div>`;
  $('elev').innerHTML = html + '<div class="eh">W/S wählen · E fahren · F abbrechen</div>';
}
function elevatorKey(code) {
  if (code === 'KeyW' || code === 'ArrowUp') { INT.sel = Math.min(INT.b.floors - 1, INT.sel + 1); renderElevator(); }
  else if (code === 'KeyS' || code === 'ArrowDown') { INT.sel = Math.max(0, INT.sel - 1); renderElevator(); }
  else if (code === 'KeyE' || code === 'Enter') { INT.menu = null; $('elev').style.display = 'none'; callCab(INT.sel); notice('Fahre zu: ' + floorName(INT.b, INT.sel), 2000); }
  else if (code === 'KeyF' || code === 'Backspace') { INT.menu = null; $('elev').style.display = 'none'; }
}
function nearestINpc(r) { let best = null, bd = r; for (const n of INT.npcs) { if (n.state === 'dead' || Math.abs(n.wy - player.y) > 1.5) continue; const d = Math.hypot(n.wx - player.x, n.wz - player.z); if (d < bd) { bd = d; best = n; } } return best; }
function myHotelFloor(F) { return player.hotel && INT.b && player.hotel.seed === INT.b.seed && F.f === player.hotel.floor; }
function interiorUse() {
  const Fc = INT.floors.get(curFloorOf(player.y)), [plx, plz] = toLocal(player.x, player.z);
  if (Fc?.hotelBed && Math.hypot(plx - Fc.hotelBed.x, plz - Fc.hotelBed.z) < 1.8) { fade(true); sfx.save(); setTimeout(() => { gameMin = (gameMin + 8 * 60) % 1440; player.hp = 100; const ok = saveGame(); fade(false); notice(ok ? 'Im Hotel geschlafen · Spiel gespeichert' : 'Im Hotel geschlafen', 2500); }, 900); return; }
  const near = nearestINpc(2.6);
  if (near && near.role === 'cashier' && INT.kind === 'bank') return bankMenu('Fleeca Bank · Schalter');
  if (near && near.role === 'reception' && INT.kind === 'hotel') return hotelMenu();
  if (near && near.role === 'cashier' && ['shop', 'market', 'gas'].includes(INT.kind)) return shopMenu(INT.kind);
  if (INT.cab && inCab()) return openElevator();
  if (nearElevCall()) { callCab(curFloorOf(player.y)); notice('Aufzug gerufen', 1400); sfx.click(); return; }
  const n = nearestINpc(2.3);
  if (n) {
    const L = LINES.inside[n.role] || LINES.inside.worker;
    n.yaw = Math.atan2(...toLocal(player.x, player.z).map((v, i) => v - (i ? n.z : n.x)));
    say(pick(L).replace('{co}', INT.company || 'uns'), { who: { worker: 'Angestellter', resident: 'Bewohner', reception: 'Empfang', cashier: 'Kassierer', customer: 'Kunde', nurse: 'Pflegerin', patient: 'Patient', visitor: 'Besucher' }[n.role] || 'Person', voice: n.voice, rate: n.vrate, h: n.h, prio: true });
  }
}
function interiorHint() {
  if (INT.menu) return '';
  if (INT.cab && inCab()) return 'Drücke <b>E</b> für das Etagenmenü';
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
  const type = pick(TRAFFIC_TYPES);
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
  const pBlock = pa > 0 && pa < (player.car ? 9 : 12) && Math.abs(pdx * rx + pdz * rz) < 1.8;
  if (!player.car && pBlock) target = 0;
  a.honkWait = pBlock && a.speed < 1 ? (a.honkWait || 0) + dt : 0;
  if (a.honkWait > 1.5 && a.honk === undefined) { a.honk = 0; a.honkWait = -6; }
  a.speed = lerp(a.speed, target, Math.min(1, dt * (target < a.speed ? 4 : 1.2)));
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
    } else if (c.driver && Math.random() < dt * 0.006 && Math.hypot(c.x - player.x, c.z - player.z) < 120) {
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
      const nd = opts.length ? pick(opts) : (a.dir + 2) % 4;
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

// ---------- Police ----------
const VIS_NEAR = 22, VIS_FAR = 75, VIS_ANG = 1.1;
const lastSeen = { x: 0, z: 0 };
function copSees(c) {
  if (INT.inside && INT.b?.door) { const dr = INT.b.door; if (Math.hypot(player.x - dr.x, player.z - dr.z) > 7 || Math.hypot(c.x - dr.x, c.z - dr.z) > 45) return false; }
  const tgt = player.car || player, dx = tgt.x - c.x, dz = tgt.z - c.z, d = Math.hypot(dx, dz);
  const sn = player.sneak && !player.car, far = sn ? VIS_FAR * 0.55 : VIS_FAR, near = sn ? 10 : VIS_NEAR;
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
  const a = c.ai, tgt = player.car || player, pv = player.car ? [player.car.vx, player.car.vz] : [player.vx, player.vz];
  const pd = Math.hypot(tgt.x - c.x, tgt.z - c.z);
  if (c.deployed) { driveCar(c, 0, 0, true, dt); if (c.deployT !== undefined) deployCrew(c, dt); return; }
  let tx, tz;
  if (wanted > 0 && wantedCool < 2 && !INT.inside) {
    tx = tgt.x; tz = tgt.z; c.bldDone = null; c.footDone = false;
    if (c.role === 'intercept' && player.car) { tx += pv[0] * 2.5; tz += pv[1] * 2.5; }
    if (c.role === 'block' && player.car && Math.hypot(...pv) < 6 && pd < 35) { const f = [Math.sin(player.car.yaw), Math.cos(player.car.yaw)]; tx += f[0] * 9; tz += f[1] * 9; }
  } else if (wanted > 0) {
    if (INT.inside && wantedCool < 2) lastSeen.bld = INT.b;
    const bl = lastSeen.bld, inSearch = bl ? squad.cops.length * (squad.b === bl) + officers.filter(o => o.bld === bl).length : 0;
    if (bl && bl.door && c.bldDone !== bl && inSearch < 4) {
      const dr = bl.door; tx = dr.x + dr.nx * 6; tz = dr.z + dr.nz * 6;
      if (Math.hypot(tx - c.x, tz - c.z) < 16 && c.driver) { c.bldDone = bl; c.searchB = bl; c.deployed = true; c.deployT = 0; if (Math.random() < 0.6) say(pick(LINES.surround), { who: 'Polizeifunk', radio: true, color: '#6fa8ff' }); }
    } else if (!bl && lastSeen.foot && !c.footDone && c.driver && Math.hypot(lastSeen.x - c.x, lastSeen.z - c.z) < 22) { c.footDone = true; c.deployed = true; c.deployT = 0; }
    else {
      const ref = !bl && lastSeen.car && cars.includes(lastSeen.car) && lastSeen.car !== player.car ? lastSeen.car : lastSeen;
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
  if (wanted > 0 && wantedCool < 2 && !player.car && !INT.inside && pd < 24 && (c.sees || pd < 12)) {
    thr = Math.abs(c.speedF || 0) > 1 ? -Math.sign(c.speedF) : 0;
    if (Math.abs(c.speedF || 0) < 1.5 && c.driver) { c.deployed = true; c.deployT = 0; }
  }
  driveCar(c, clamp(thr, -1, 1), clamp(steer, -1, 1), false, dt);
  // Schüsse aus dem fahrenden Wagen (ab 3 Sternen) & Megafon
  if (wanted >= 3 && c.sees && pd < 28) {
    a.fire = (a.fire || 0) - dt;
    if (a.fire <= 0) { a.fire = rnd(0.7, 1.3); sfx.shot(c.x, c.z, 0.5); if (Math.random() < 0.35) { if (player.car) damageCar(player.car, 2 + wanted); else hurtPlayer(3 + wanted * 1.5); } }
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
function updateOfficers(dt) {
  const tgt = player.car || player;
  for (let i = officers.length - 1; i >= 0; i--) {
    const o = officers[i];
    if (o.state === 'dead') { if ((o.t -= dt) < 0) { scene.remove(o.h.group); disposeHuman(o.h); officers.splice(i, 1); } continue; }
    const dx = tgt.x - o.x, dz = tgt.z - o.z, d = Math.hypot(dx, dz), gate = !INT.inside || (Math.hypot(player.x - INT.b.door.x, player.z - INT.b.door.z) < 7 && Math.hypot(o.x - INT.b.door.x, o.z - INT.b.door.z) < 30), los = gate && d < 70 && lineOfSight(o.x, o.z, tgt.x, tgt.z);
    o.sees = los && d < 55;
    const carAway = player.car && Math.hypot(player.car.vx, player.car.vz) > 5 && d > 14;
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
      const keep = wanted >= 2 ? (los ? 11 : 2.5) : player.car ? 2.8 : 1.4;
      if (d > keep) { mx = dx / d; mz = dz / d; sp = d > 8 ? 4.6 : 2.2; }
      if (wanted >= 2 && los && d < 40) {
        aim = true; sp = Math.min(sp, 2.2); o.fire -= dt;
        if (o.fire <= 0) {
          o.fire = rnd(0.6, 1.2); sfx.shot(o.x, o.z, 0.7);
          const from = new THREE.Vector3(o.x, groundH(o.x, o.z) + 1.45, o.z), to = new THREE.Vector3(tgt.x + rnd(-0.6, 0.6), (player.car ? player.car.y + 0.9 : player.y + 1.2), tgt.z + rnd(-0.6, 0.6));
          const tr = new THREE.Mesh(tracerG, tracerM); tr.position.copy(from); tr.lookAt(to); tr.scale.z = from.distanceTo(to); scene.add(tr); tracers.push({ m: tr, t: 0.05 });
          if (Math.random() < clamp(0.6 - d * 0.012 - (player.sneak ? 0.15 : 0), 0.08, 0.6)) { if (player.car) damageCar(player.car, 3 + wanted); else hurtPlayer(4 + wanted * 1.5); }
        }
      }
      // Festnahme bei einem Stern
      if (wanted === 1 && d < (player.car ? 3.4 : 2.3) && (player.car ? Math.hypot(player.car.vx, player.car.vz) < 1 : Math.hypot(player.vx, player.vz) < 1.3)) {
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
    if (c.n && c.n.state === 'dead') { squad.cops.splice(squad.cops.indexOf(c), 1); addWanted(0, Math.max(3, wanted)); continue; }
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
  const copSaw = cars.some(c => c.cop && Math.hypot(c.x - x, c.z - z) < 60 && lineOfSight(c.x, c.z, x, z)) || officers.some(o => o.state !== 'dead' && Math.hypot(o.x - x, o.z - z) < 50);
  if (copSaw) { addWanted(0, Math.max(wanted, stars)); return; }
  if (wanted >= stars) { lastSeen.x = x; lastSeen.z = z; return; }
  if (pendingCall && pendingCall.stars >= stars) return;
  const wit = indoor ? INT.npcs.filter(n => n.state !== 'dead') : peds.filter(p => p.state !== 'dead' && p.state !== 'fly' && Math.hypot(p.x - x, p.z - z) < 40 && lineOfSight(p.x, p.z, x, z));
  if (!wit.length) return;
  if (Math.random() > 1 - Math.pow(0.45, wit.length)) return;
  const w = pick(wit);
  pendingCall = { type, x, z, stars, w, t: rnd(4, 7), phase: 'call', d: districtOf(x, z), bld: indoor ? INT.b : null, foot: !player.car };
  if (!indoor) { w.state = 'walk'; w.path = null; w.task = { type: 'calling' }; w.pose = 'phone'; w.wait = 12; }
}
function updateCrimeCalls(dt) {
  const c = pendingCall; if (!c) return;
  c.t -= dt;
  if (c.w.state === 'dead') { pendingCall = null; return; }
  if (c.phase === 'call' && c.t < 3 && !c.said) { c.said = true; if (Math.hypot((c.w.wx ?? c.w.x) - player.x, (c.w.wz ?? c.w.z) - player.z) < 30) say(LINES.witness[c.type], { who: 'Zeuge (Telefon)', voice: c.w.voice, rate: c.w.vrate, h: c.w.h, prio: true }); }
  if (c.phase === 'call' && c.t <= 0) { c.phase = 'radio'; c.t = rnd(3, 5); if (scannerOn || Math.hypot(c.x - player.x, c.z - player.z) < 220) say(`Zentrale an alle Einheiten: ${CRIME[c.type]} in ${c.d}. Verdächtiger flüchtig.`, { who: 'Polizeifunk', radio: true, color: '#6fa8ff', prio: true }); }
  else if (c.phase === 'radio' && c.t <= 0) {
    if (wanted < c.stars) { const before = wanted; wanted = c.stars; lastSeen.x = c.x; lastSeen.z = c.z; lastSeen.bld = c.bld; lastSeen.foot = c.foot; lastSeen.car = null; wantedCool = 1.5; if (before === 0) { notice('GESUCHT!', 1500); say(pick(LINES.chars[cur].cops), { who: CHARS[cur].name, color: CHARS[cur].col }); } }
    if (c.w.task?.type === 'calling') { c.w.task = null; c.w.wait = 0; }
    pendingCall = null;
  }
}
function busted() {
  if (player.dead) return;
  player.bustStars = Math.max(1, wanted);
  player.dead = 4.5; player.bust = true; $('wasted').querySelector('b').textContent = 'VERHAFTET'; $('wasted').classList.add('bust'); $('wasted').style.display = 'flex';
  sfx.wasted(); if (player.car) exitCar(true);
}
// Einsatzleitung: Streifen auffüllen, Einheiten zuteilen, Verstärkung von der Wache
let dispatchT = 0, hqT = 0;
function updateDispatch(dt) {
  dispatchT -= dt; hqT -= dt; if (dispatchT > 0) return; dispatchT = 1;
  const units = cars.filter(c => c.cop && c.mode !== 'wreck'), pursuing = units.filter(c => c.mode === 'police');
  const dist = c => Math.hypot(c.x - player.x, c.z - player.z);
  if (wanted > 0) {
    const need = [0, 2, 3, 5, 7, 9][wanted] - pursuing.length;
    if (need > 0) {
      const free = units.filter(c => c.mode === 'ai').sort((a, b) => dist(a) - dist(b)).slice(0, need);
      for (const c of free) { c.mode = 'police'; c.ai.stuck = 0; }
      if (free.length < need && hqT <= 0 && POLICE_HQ.exit) {
        hqT = 4; const e = POLICE_HQ.exit;
        if (!cars.some(o => Math.hypot(o.x - e.x, o.z - e.z) < 7)) { const c = makeCar('police', '#000', e.x, e.z, dirYaw(1), 'police'); c.cop = true; if (Math.random() < 0.5) say(pick(LINES.hq), { who: 'Polizeifunk', radio: true, color: '#6fa8ff' }); }
      }
    }
    pursuing.sort((a, b) => dist(a) - dist(b)).forEach((c, k) => c.role = ['chase', 'intercept', 'block'][k] || 'chase');
  } else {
    for (const c of pursuing) if (!c.deployed) { c.mode = 'ai'; initAI(c, dirOfYaw(c.yaw)); const D = DIRS[c.ai.dir], k = Math.round((D[0] === 0 ? c.x : c.z) / P + N / 2); c.ai.laneC = laneFor(c.ai.dir, k); }
  }
  if (units.length < 5) { const rp = roadPoint(120, 280); if (rp) { const c = makeCar('police', '#000', rp.x, rp.z, 0, 'ai'); c.cop = true; initAI(c, rp.dir); } }
}

// ---------- Player & Charaktere ----------
const player = { x: 9.9, z: 20, y: 0.2, vy: 0, vx: 0, vz: 0, yaw: -Math.PI / 2, hp: 100, armor: 60, money: 18750, car: null, h: null, fireCd: 0, aimT: 0, dead: 0, grounded: true, respect: 0 };
let wanted = 0, wantedCool = 0, cur = 0, switching = null;
const START = { x: 9.9, z: 20 };
const HOMES = {}, HOSPITAL = { x: 0, z: 0, yaw: Math.PI }, POIS = [];
const CHARS = [
  { name: 'FRANKLIN', bank: 12400, col: '#9be389', home: 'franklin', look: { gender: 'm', skin: '#8a5a40', shirt: '#b8d8a0', pants: '#3a4258', shoes: '#ffffff', hair: '#111111', beard: 0.6, hairStyle: 'buzz' }, car: ['coupe', '#4b1f7a'], money: 18750 },
  { name: 'MICHAEL', bank: 245000, col: '#6fb3ff', home: 'michael', look: { gender: 'm', skin: '#f2dccb', shirt: '#d0d8e0', pants: '#4a4d55', shoes: '#2a2018', hair: '#3a2a1c', beard: 0.1, hairStyle: 'slick' }, car: ['sedan', '#2d3035'], money: 64200 },
  { name: 'TREVOR', bank: 8600, col: '#ffa060', home: 'trevor', look: { gender: 'm', skin: '#e8c4aa', shirt: '#cfc6a6', pants: '#6a7a90', shoes: '#5a4030', hair: '#5a4632', beard: 0.8, hairStyle: 'bald' }, car: ['suv', '#6b4a2a'], money: 3120 },
];
function hurtPlayer(d) {
  if (player.dead || switching) return;
  const a = Math.min(player.armor, d * 0.7); player.armor -= a; player.hp -= d - a;
  if (player.hp <= 0) { player.hp = 0; die(); }
}
function addWanted(n, min = 0) {
  const before = wanted; wanted = clamp(Math.max(wanted + n, min), 0, 5); wantedCool = 0;
  lastSeen.x = player.x; lastSeen.z = player.z; lastSeen.foot = !player.car; lastSeen.car = player.car; lastSeen.bld = INT.inside ? INT.b : null;
  if (wanted > before && before === 0) { notice('GESUCHT!', 1500); say(pick(LINES.chars[cur].cops), { who: CHARS[cur].name, color: CHARS[cur].col, prio: true }); radioT = 3; }
}
function fade(on) { $('fade').classList.toggle('on', on); }
function die() {
  player.dead = 5; $('wasted').style.display = 'flex'; sfx.wasted();
  if (player.car) exitCar(true);
}
function respawn() {
  $('wasted').style.display = 'none';
  if (INT.active) deactivateBuilding();
  const bust = player.bust; player.bust = false; $('wasted').querySelector('b').textContent = 'WASTED'; $('wasted').classList.remove('bust');
  squadClear();
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
    const days = 1 + (player.bustStars || 1); gameMin = (gameMin + 7 * 60) % 1440; PRISON.target = 1;
    banner('ENTLASSEN', `BOLINGBROKE STRAFVOLLZUG · ${days} TAGE HAFT · GELDSTRAFE -$${bill}`, 4500);
    setTimeout(() => say(pick(LINES.prison), { who: 'Wärter', voice: 'pavoque', color: '#d8a860', prio: true }), 1600);
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
  if (seq) return;
  let best = null, bd = 4.5;
  for (const c of cars) { if (c.mode === 'wreck' || c.mode === 'service' || c.type === 'police' || c.npcSeq) continue; const [dx, dz] = doorPoint(c); const d = Math.hypot(dx - player.x, dz - player.z); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  if (best.mode === 'ai') { best.ai.speed = 0; best.mode = 'held'; }
  seq = { type: 'enter', car: best, t: 0, phase: 'walk' };
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
let uiMenu = null;
function openMenu(title, items) { uiMenu = { title, items, sel: items.findIndex(i => i.act) }; renderMenu(); $('elev').style.display = 'block'; sfx.click(); }
function renderMenu() { const m = uiMenu; $('elev').innerHTML = `<div class="et">${m.title}</div>` + m.items.map((it, k) => `<div class="ef${k === m.sel ? ' sel' : ''}${it.act ? '' : ' cur'}">${it.label}</div>`).join('') + '<div class="eh">W/S wählen · E bestätigen · F schließen</div>'; }
function menuKey(code) {
  const m = uiMenu, n = m.items.length, step = d => { let k = m.sel; do { k = (k + d + n) % n; } while (!m.items[k].act && k !== m.sel); m.sel = k; };
  if (code === 'KeyW' || code === 'ArrowUp') step(-1); else if (code === 'KeyS' || code === 'ArrowDown') step(1);
  else if (code === 'KeyF' || code === 'Backspace' || code === 'Escape') { uiMenu = null; $('elev').style.display = 'none'; return; }
  else if (code === 'KeyE' || code === 'Enter') { const it = m.items[m.sel]; if (it?.act) { const keep = it.act(); if (!keep) { uiMenu = null; $('elev').style.display = 'none'; return; } } }
  renderMenu();
}
const fmt = v => '$' + Math.floor(v).toLocaleString('en-US');
function pay(amount, method) {
  if (method === 'card') { if ((player.bank || 0) < amount) { notice('Karte abgelehnt – Kontostand zu niedrig', 1800); return false; } player.bank -= amount; }
  else { if (player.money < amount) { notice('Nicht genug Bargeld', 1800); return false; } player.money -= amount; }
  sfx.coin(); return true;
}
function bankMenu(where) {
  const mv = (amt, dir) => () => { const a = amt === 'all' ? (dir > 0 ? player.money : player.bank) : amt; if (dir > 0) { if (player.money < a || a <= 0) { notice('Nicht genug Bargeld', 1400); return true; } player.money -= a; player.bank += a; notice(`Eingezahlt: ${fmt(a)}`, 1400); } else { if (player.bank < a || a <= 0) { notice('Kontostand zu niedrig', 1400); return true; } player.bank -= a; player.money += a; notice(`Abgehoben: ${fmt(a)}`, 1400); } sfx.coin(); bankMenu(where); return true; };
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
function shopMenu(kind) {
  const pm = player.payPref || 'cash', inv = player.inv ||= {};
  keepMenuSel(() => openMenu(INT.company || floorName(INT.b, 0).replace('EG · ', ''), [
    { label: `Bargeld ${fmt(player.money)} · Konto ${fmt(player.bank || 0)}` },
    ...SHOP_STOCK[kind].map(k => ({ label: `${ITEMS[k].ico} ${ITEMS[k].n} – ${fmt(ITEMS[k].p)}${inv[k] ? ` <small>· ${inv[k]} dabei</small>` : ''}`, act: () => { if (pay(ITEMS[k].p, pm)) { inv[k] = (inv[k] || 0) + 1; notice(`${ITEMS[k].n} gekauft`, 1100); } shopMenu(kind); return true; } })),
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
  const k = pick(SHOP_STOCK[Fc.kind].filter(q => ITEMS[q].p < 100)); (player.inv ||= {})[k] = (player.inv[k] || 0) + 1;
  const [lx, lz] = toLocal(player.x, player.z), clerk = Fc.npcs.find(n => n.role === 'cashier' && n.state !== 'dead');
  if (clerk && Math.hypot(clerk.x - lx, clerk.z - lz) < 18 && Math.random() < 0.75) {
    notice(`${ITEMS[k].n} geklaut – der Kassierer hat es gesehen!`, 2200);
    say(pick(LINES.shoplift), { who: 'Kassierer', voice: clerk.voice, rate: clerk.vrate, h: clerk.h, prio: true });
    clerk.pose = 'phone'; clerk.wait = 12; reportCrime('theft', player.x, player.z, 1, true);
  } else notice(`${ITEMS[k].n} eingesteckt – niemand hat es gesehen`, 2000);
}
function nearVend() { return VENDS.find(v => Math.hypot(v.x - player.x, v.z - player.z) < 1.3); }
function vendMenu(v) {
  const buy = (k, label) => () => { if (!(pay(1, 'cash') || pay(1, 'card'))) return true; sfx.door(); player.hp = Math.min(100, player.hp + 10); player.act = { pose: 'smoke', t: 1.8 }; notice(`${label} · +10 Gesundheit`, 1300); return false; };
  openMenu(`Getränkeautomat · ${v.brand}`, [{ label: 'Münzen oder Karte · je $1' }, { label: `🥤 ${v.brand} – $1`, act: buy(v.brand === 'eCola' ? 'cola' : 'sprunk', v.brand) }, { label: '💧 Wasser – $1', act: buy('wasser', 'Wasser') }, { label: 'Schließen', act: () => false }]);
}
function nearATM() { return ATMS.find(a => Math.hypot(a.x - player.x, a.z - player.z) < 1.6); }

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
  if (pay(total, ride.pay)) notice(`Fahrt bezahlt: ${fmt(total)} (${ride.pay === 'card' ? 'Karte' : 'Bar'})`, 2600);
  else if (pay(total, other)) notice(`Fahrt bezahlt: ${fmt(total)} (${other === 'card' ? 'Karte' : 'Bar'})`, 2600);
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
    if (player.h.group.parent === c.body) { c.body.remove(player.h.group); scene.add(player.h.group); setHumanShadow(player.h, true); }
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
  if (['F2', 'F3', 'Tab', 'KeyM'].includes(e.code)) e.preventDefault();
  if (bigMap.open) { if (e.code === 'KeyM' || e.code === 'Escape') closeMap(); return; }
  if (phone.open) { phoneKey(e.code); e.preventDefault(); return; }
  if (uiMenu) { menuKey(e.code); e.preventDefault(); return; }
  if (INT.menu) { elevatorKey(e.code); e.preventDefault(); return; }
  if (e.code === 'KeyM' && !player.dead) { openMap(); return; }
  if (e.code === 'F2') { openPhone(); return; }
  if (e.code === 'F3') { scannerOn = !scannerOn; scanT = 1.5; notice('Polizeifunk ' + (scannerOn ? 'AN – du hörst mit' : 'AUS'), 1600); sfx.squelch(); return; }
  if (e.code === 'Tab') { openWheel(); return; }
  if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'KeyC') { if (!player.car) { player.sneak = !player.sneak; notice(player.sneak ? 'Schleichen' : 'Normal', 800); } return; }
  if (e.code === 'KeyE' && !player.dead && !switching) {
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
const LINES = {
  chars: [
    { hello: ['Na gut, zurück an die Arbeit.', 'Los Santos, ich bin wieder da.', 'Zeit, ein bisschen Geld zu machen, Homie.'], cops: ['Oh Mann, die Bullen!', 'Nicht schon wieder, Mann!', 'Ich muss hier weg!'] },
    { hello: ['Ich hätte im Ruhestand bleiben sollen.', 'Noch ein schöner Tag im Paradies.', 'Mal sehen, was die Familie wieder angestellt hat.'], cops: ['Ich bin zu alt für so was.', 'Ganz ruhig, Michael. Ganz ruhig.', 'Wie in alten Zeiten.'] },
    { hello: ['Wer hat mich geweckt?!', 'Heute wird es lustig.', 'Ich bin völlig entspannt. Wirklich.'], cops: ['Kommt doch her, ihr Clowns!', 'Endlich passiert mal was!', 'Ihr wollt Ärger? Den kriegt ihr!'] },
  ],
  ped: ['Schönes Wetter heute, oder?', 'Hast du mal einen Dollar?', 'Ich muss echt mal wieder ins Fitnessstudio.', 'Die Mieten hier sind der Wahnsinn.', 'Hey, cooles Outfit!', 'Mein Agent ruft einfach nicht zurück.', 'Kennst du ein gutes Taco-Lokal hier?', 'Der Verkehr in dieser Stadt bringt mich um.'],
  bump: ['Hey, pass doch auf!', 'Geht es noch?', 'Augen auf, Mann!', 'Entschuldigung? Hallo?'],
  scared: ['Nicht schießen!', 'Hilfe! Polizei!', 'Der ist verrückt!', 'Lauf! Lauf!', 'Oh mein Gott!'],
  carjack: ['Hey! Mein Auto!', 'Das kannst du nicht machen!', 'Ich ruf die Polizei!'],
  chat: ['Und dann hat er einfach aufgelegt!', 'Hast du das neue Café an der Ecke probiert?', 'Die Stadt wird immer teurer, sag ich dir.', 'Mein Cousin dreht jetzt Imagefilme für Firmen, läuft super.', 'Gehen wir später an den Strand?', 'Ich hatte heute schon drei Castings.'],
  phone: ['Ja, Schatz, ich bin gleich da.', 'Nein, die Mail hab ich nicht bekommen.', 'Sag dem Chef, ich steck im Stau.', 'Echt jetzt? Das glaub ich nicht!'],
  intruder: ['Wer sind Sie? Raus aus meiner Wohnung!', 'Hey! Das ist Privatbesitz!', 'Ich ruf gleich die Polizei!'],
  inside: {
    worker: ['Das Meeting hätte auch eine E-Mail sein können.', 'Hast du den Bericht schon gesehen?', 'Noch drei Stunden bis Feierabend.', 'Der Kaffee hier ist furchtbar.', 'Sie arbeiten nicht hier, oder?'],
    resident: ['Wer sind Sie? Raus hier!', 'Ich hab Sie nicht reingelassen!'],
    reception: ['Willkommen bei {co}. Haben Sie einen Termin?', 'Die Aufzüge sind direkt hinter mir.', 'Bitte tragen Sie sich ins Besucherbuch ein.'],
    cashier: ['Hallo! Brauchen Sie eine Tüte?', 'Das macht dann zwölf Dollar fünfzig.', 'Wir schließen um Mitternacht.'],
    customer: ['Wo finde ich hier die Chips?', 'Alles so teuer geworden.'],
    nurse: ['Bitte leise, hier schlafen Patienten.', 'Die Besuchszeit ist gleich vorbei.'],
    patient: ['Ich will einfach nur nach Hause.', 'Haben Sie Schokolade dabei?'],
    visitor: ['Ich warte auf meinen Termin.', 'Wissen Sie, in welchem Stock die Buchhaltung ist?'],
  },
  witness: {
    theft: 'Ja, Polizei? Hier im Laden wurde gerade geklaut!', carjack: 'Hallo, Polizei? Hier wurde gerade ein Auto geklaut!', shooting: 'Polizei? Hier wird geschossen! Kommen Sie schnell!', murder: 'Hilfe, hier wurde jemand umgebracht! Schicken Sie jemanden!', hitrun: 'Ein Auto hat gerade jemanden überfahren und ist abgehauen!', assault: 'Hier prügelt einer auf Leute ein, kommen Sie bitte!' },
  arrest: ['Hände hoch! Sie sind verhaftet!', 'Keine Bewegung! Auf den Boden!'],
  hq: ['Zentrale: Einheit verlässt die Wache, unterwegs zum Einsatzort.', 'Verstärkung von der Wache ist unterwegs.'],
  redlight: ['Zentrale, Rotlichtverstoß beobachtet. Wir halten das Fahrzeug an.', 'Fahrzeug ist über Rot gefahren, nehmen die Verfolgung auf.'],
  shoplift: ['Hey! Das musst du bezahlen! Ich rufe die Polizei!', 'Haltet den Dieb! Polizei, schnell!'],
  prison: ['Du bist frei. Lass dich hier nicht wieder blicken!', 'Entlassen. Benimm dich da draußen, verstanden?'],
  surround: ['Verdächtiger ist in ein Gebäude geflüchtet. Wir umstellen den Eingang.', 'Zentrale, Verdächtiger im Gebäude. Wir gehen rein.'],
  enter: ['Einheiten betreten das Gebäude. Durchsuchen Etage für Etage.', 'Wir sind drin. Sichern das Erdgeschoss.'],
  found: ['Da ist er! Stehen bleiben!', 'Polizei! Hände hoch!', 'Hier drüben, ich hab ihn!'],
  ride: {
    taxi: ['Taxi! Steig ein, Kumpel.', 'Hier ist dein Taxi. Hinten ist zu, setz dich nach vorne.', 'Na, wo soll es hingehen?'],
    chauffeur: ['Guten Tag. Bitte sehr, steigen Sie ein.', 'Ihr Wagen ist bereit. Darf ich Ihnen die Tür aufhalten?', 'Willkommen an Bord. Bitte einsteigen.'],
    where: ['Wohin soll es gehen? Markieren Sie das Ziel einfach auf der Karte.', 'Sag mir wohin, setz einfach einen Punkt auf der Karte.'],
    go: ['Alles klar, wir fahren los.', 'Sehr gerne, ich bringe Sie hin.', 'Okay, das kenne ich. Lehn dich zurück.'],
    stop: ['Kein Problem, ich halte hier vorne an.', 'Alles klar, ich fahre rechts ran.'],
    bye: ['Danke und einen schönen Tag noch!', 'Wir sind da. Beehren Sie uns bald wieder.', 'Hier sind wir. Pass auf dich auf.'],
    noPay: ['Du kannst nicht zahlen? Ich rufe die Polizei!', 'Hey! Erst fahren und dann nicht zahlen? Polizei!'],
    dispatch: ['Downtown Cab, guten Tag. Wir schicken sofort einen Wagen zu Ihnen.', 'Ihr Fahrer ist gleich bei Ihnen. Vielen Dank für Ihre Buchung.'],
  },
  mega: ['Halt! Polizei!', 'Hände hoch und auf den Boden!', 'Fahrzeug sofort anhalten!', 'Waffe fallen lassen!'],
  radio: ['Zentrale an alle Einheiten: Verdächtiger flüchtig.', 'Einheit zwölf, Verdächtiger in Sichtweite, nehmen Verfolgung auf.', 'Brauchen Verstärkung, Code drei!', 'Alle Einheiten: Schüsse gemeldet.', 'Verdächtiger fährt mit hoher Geschwindigkeit.'],
  radioLost: ['Sichtkontakt verloren, suchen das Gebiet ab.', 'Kein Sichtkontakt. Letzte bekannte Position wird abgesucht.'],
  radioEnd: 'Alle Einheiten: Fahndung eingestellt. Verdächtiger entkommen.',
};
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
const VOICE_OF = { FRANKLIN: ['thorsten', 1], MICHAEL: ['karlsson', 1], TREVOR: ['pavoque', 0.97], Franklin: ['thorsten', 1], Michael: ['karlsson', 1], Trevor: ['pavoque', 0.97], Jamal: ['thorsten', 1.1], 'Tante Gloria': ['kerstin', 0.95], 'Lester-Hacker': ['pavoque', 1.06], Polizeifunk: ['karlsson', 1.04], 'Polizei (Megafon)': ['pavoque', 0.95], Angestellte: ['kerstin', 1.1] };
function clipVoice(text, v) {
  const I = VOICE.index; if (!I) return null;
  if (I[v]?.[text]) return v;
  const same = FEM_V.includes(v) ? FEM_V : MALE_V;
  return [...same, ...MALE_V, ...FEM_V].find(o => I[o]?.[text]) || null;
}
function say(text, { who = '', pitch = 1, rate = 1, vol = 1, prio = false, color = '#ffd23a', radio = false, voice = null, h = null } = {}) {
  const now = performance.now();
  if (!prio && now < speakUntil) return false;
  speakUntil = now + 900 + text.length * 60;
  const ci = CHARS.findIndex(c => c.name === who); if (!h && ci >= 0) h = CHARS[ci].h;
  let [v, vr] = voice ? [voice, rate] : VOICE_OF[who] || [pick(MALE_V), rnd(0.92, 1.08)];
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
  CHARS.forEach((c, i) => { if (i !== cur) blip(c.st.x, c.st.z, c.col, 9); });
  const edge = (x, z, col, r) => { // Ziel am Rand der Minimap anzeigen
    let dx = (x - px) * MS, dz = (z - pz) * MS; const lim = 230 / zoom, l = Math.hypot(dx, dz);
    if (l > lim) { dx *= lim / l; dz *= lim / l; }
    mm.fillStyle = '#000'; mm.beginPath(); mm.arc(dx, dz, (r + 3) / zoom, 0, 7); mm.fill(); mm.fillStyle = col; mm.beginPath(); mm.arc(dx, dz, r / zoom, 0, 7); mm.fill();
  };
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
  if (!player.car && !player.dead && !switching && !player.ride) {
    const home = HOMES[CHARS[cur].home];
    if (INT.inside) hint = interiorHint();
    else if (home && Math.hypot(home.x - player.x, home.z - player.z) < 2) hint = 'Drücke <b>E</b>, um zu schlafen und zu speichern';
    else if (nearestDoor(player.x, player.z, 2.2)) { const b = nearestDoor(player.x, player.z, 2.2); hint = `${floorName(b, 0)} · einfach hineingehen`; }
    else if (nearATM()) hint = 'Drücke <b>E</b> für den Geldautomaten';
    else if (nearVend()) hint = 'Drücke <b>E</b> für den Getränkeautomaten ($1)';
    else if (ride && ride.state === 'waiting' && Math.hypot(...doorPoint(ride.car, -1).map((v, i) => v - (i ? player.z : player.x))) < 6) hint = `Drücke <b>F</b>, um in ${ride.kind === 'taxi' ? 'das Taxi' : 'die Limousine'} einzusteigen`;
    else for (const c of cars) if (c.mode !== 'wreck' && c.type !== 'police' && c.mode !== 'service' && Math.hypot(c.x - player.x, c.z - player.z) < 4.2) { hint = 'Drücke <b>F</b>, um einzusteigen'; break; }
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
const SCAN = ['Einheit {n}, Ruhestörung in {d}, bitte prüfen.', 'Zentrale an alle: Verkehrsunfall in {d}, Krankenwagen ist unterwegs.', 'Einheit {n}, verdächtige Person in {d} gemeldet.', 'Ladendiebstahl in {d}, Täter flüchtig zu Fuß.', 'Einheit {n} meldet sich ab, Mittagspause.', 'Alle Einheiten: Raser in {d}, rotes Coupé.', 'Einheit {n}, Hund ohne Leine in {d}. Ja, wirklich.', 'Streit vor einem Club in {d}, zwei Einheiten bitte.'];
function updateScanner(dt) {
  if (!scannerOn) return;
  scanT -= dt;
  if (scanT < 0) {
    scanT = wanted > 0 ? rnd(6, 10) : rnd(12, 22);
    const tgt = player.car || player;
    const line = wanted > 0
      ? pick([`Verdächtiger zuletzt gesehen in ${districtOf(lastSeen.x, lastSeen.z)}.`, `Alle Einheiten nach ${districtOf(lastSeen.x, lastSeen.z)}, Verdächtiger ist bewaffnet.`, wantedCool > 2 ? `Kein Sichtkontakt mehr, wir durchsuchen ${districtOf(lastSeen.x, lastSeen.z)}.` : `Sichtkontakt in ${districtOf(tgt.x, tgt.z)}, Verfolgung läuft.`])
      : pick(SCAN).replace('{n}', pick([4, 7, 12, 21])).replace('{d}', pick(DISTRICTS.flat()));
    say(line, { who: 'Polizeifunk', color: '#6fa8ff', pitch: 0.7, rate: 1.15, vol: 0.7, radio: true });
  }
}
// Handy (F2): Kontakte anrufen und Treffen vereinbaren
const phone = { open: false, screen: 'home', sel: 0, busy: false };
let meeting = null;
const EXTRA_CONTACTS = [
  { name: 'Jamal', col: '#ffd23a', look: { gender: 'm', skin: '#6a4030', shirt: '#4a9a5f', pants: '#1f2a44', shoes: '#f0f0f0', hair: '#0e0906', beard: 0.4, hairStyle: 'buzz', hat: '#222222' }, activity: 'Basketball im Park' },
  { name: 'Tante Gloria', col: '#ff8ac8', look: { gender: 'f', tint: '#ffd0e0' }, activity: 'Kaffee trinken' },
  { name: 'Lester-Hacker', col: '#9be3ff', look: { gender: 'm', skin: '#f2dccb', shirt: '#8a8e7a', pants: '#4a4a44', shoes: '#3a2a1c', hair: '#6a5a4a', beard: 0.5, hairStyle: 'bald', hat: '#3a3a3a' }, activity: 'Pläne besprechen' },
];
const CALL_LINES = {
  greet: ['Hey, was geht? Lust dich zu treffen?', 'Na, hast du kurz Zeit? Lass uns treffen.', 'Yo, ich bin in der Gegend. Treffen?'],
  yes: ['Klar, komm nach {p}. Ich warte auf dich.', 'Okay, wir sehen uns in {p}.', 'Gute Idee. Treffpunkt {p}, bis gleich.'],
  wanted: ['Bist du verrückt? Ruf mich an, wenn du die Bullen los bist!', 'Nicht mit der Polizei an den Fersen, Mann.'],
  talk: [['Schön, dass du da bist.', 'Klar doch. Wie läuft das Geschäft?'], ['Läuft. Ich hab da so ein Ding am Laufen.', 'Erzähl mir lieber nichts davon.'], ['Wir sollten das öfter machen.', 'Auf jeden Fall. Pass auf dich auf da draußen.']],
};
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
  el.innerHTML = `<div class="bar">${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} <span>LS-Mobil ▂▄▆</span></div>${body}<div class="hint">W/S · E wählen · F2/Rück zurück</div>`;
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
  else if (code === 'Backspace' || code === 'F2') { if (phone.screen === 'home') return closePhone(); phone.screen = 'home'; phone.sel = 0; }
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
function updateCamera(dt) {
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
    if (INT.inside) { dist = Math.min(dist, 2.9); camPitch = Math.min(camPitch, 0.55); }
    camera.fov = lerp(camera.fov, aim ? 55 : 68, dt * 6);
  }
  camera.updateProjectionMatrix();
  camDist = lerp(camDist, dist, Math.min(1, dt * 4));
  camTarget.set(tx, ty, tz);
  const cp = Math.cos(camPitch), dx = -Math.sin(camYaw) * cp, dy = Math.sin(camPitch), dz = -Math.cos(camYaw) * cp;
  let d = camDist;
  for (let s = 0.3; s <= camDist; s += 0.2) if (solidAt(tx + dx * s, ty + dy * s, tz + dz * s)) { d = Math.max(0.6, s - 0.4); break; }
  camera.position.set(tx + dx * d, Math.max(ty + dy * d, INT.inside ? player.y + 0.3 : 0.4), tz + dz * d);
  if (INT.inside) camera.position.y = Math.min(camera.position.y, Math.max(floorY(curFloorOf(player.y)) + 3.15, player.y + 1.9));
  if (shake > 0) { camera.position.x += rnd(-1, 1) * shake * 0.4; camera.position.y += rnd(-1, 1) * shake * 0.4; shake = Math.max(0, shake - dt * 1.8); }
  camera.lookAt(tx, ty + 0.2, tz);
  skyDome.position.copy(camera.position);
}

// ---------- Main update ----------
let carInput = { thr: 0, skid: 0 };
function updatePlayer(dt, raw) {
  player.fireCd -= dt; player.aimT -= dt;
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
  const nav = phone.open;
  const mf = nav ? 0 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), ms = nav ? 0 : (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -fz, rz = fx;
  let mx = fx * mf + rx * ms, mz = fz * mf + rz * ms; const ml = Math.hypot(mx, mz);
  const aiming = (rmb || lmb) && !curW().melee && !phone.open;
  const spd = ml > 0 ? player.sneak ? 1.7 : (keys.ShiftLeft || keys.ShiftRight) && !aiming ? 7.6 : aiming ? 2.6 : 4.2 : 0;
  if (ml > 0) { mx /= ml; mz /= ml; }
  player.vx = lerp(player.vx, mx * spd, Math.min(1, dt * 10)); player.vz = lerp(player.vz, mz * spd, Math.min(1, dt * 10));
  player.x += player.vx * dt; player.z += player.vz * dt;
  const r = resolveCircle(player.x, player.z, 0.38, player.y + 0.9); player.x = r.x; player.z = r.z;
  for (const c of cars) {
    if (Math.abs(c.x - player.x) > 5 || Math.abs(c.z - player.z) > 5) continue;
    for (const [cx, cz] of carCircles(c)) {
      const dx = player.x - cx, dz = player.z - cz, d = Math.hypot(dx, dz);
      if (d < 1.35 && d > 0.01) {
        player.x = cx + dx / d * 1.35; player.z = cz + dz / d * 1.35;
        const cs = Math.hypot(c.vx, c.vz) + (c.mode === 'ai' ? c.ai.speed : 0);
        if (cs > 6) { hurtPlayer(cs * 1.5); player.vx += dx / d * cs; player.vz += dz / d * cs; }
      }
    }
  }
  if (aiming) { player.aimT = 0.8; player.yaw = camYaw; }
  else if (player.aimT > 0) player.yaw = camYaw;
  else if (ml > 0) player.yaw += angDiff(player.yaw, Math.atan2(mx, mz)) * Math.min(1, dt * 12);
  const g = floorH(player.x, player.z, player.y);
  if (keys.Space && player.grounded) { player.vy = 5.4; player.grounded = false; }
  player.vy -= 15 * dt; player.y += player.vy * dt;
  if (player.y <= g) { player.y = player.grounded ? lerp(player.y, g, Math.min(1, dt * 20)) : g; player.vy = 0; player.grounded = true; }
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
  animHuman(h, mv, dt, aimNow, phone.open ? 'phone' : player.act && mv < 0.5 ? player.act.pose : null, player.sneak);
  if (aimNow) aimPose(h, camPitch);
  h.gun.visible = aimNow; if (gw) { h.gunBase ??= h.gun.scale.x; h.gun.scale.set(gw[0] * h.gunBase, gw[1] * h.gunBase, gw[2] * h.gunBase); }
  if (player.punchT > 0) { player.punchT -= dt; punchPose(h, Math.sin((1 - player.punchT / 0.25) * Math.PI)); }
}

function updateCars(dt, time) {
  const pc = player.car;
  updateSignals(dt); updateKnock(dt);
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
            else if (o.mode !== 'police' && o.mode !== 'player') { o.mode = o.mode === 'wreck' ? 'wreck' : 'abandoned'; o.vx += rv * nx * 0.6; o.vz += rv * nz * 0.6; }
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
    if ((c.mode === 'ai' || c.mode === 'police') && !c.driver && d < 70) { setDriver(c, makeHuman(c.dlook ||= c.type === 'police' ? COP_LOOK : pedLook())); c.lazyDriver = true; }
    if (c.driver && c.lazyDriver && c.driver !== player.h && d > 95) { const h = c.driver; c.body.remove(h.group); disposeHuman(h); c.driver = null; }
    if (c.driver && c.driver !== player.h && d < 80) animHuman(c.driver, 0, dt, false, 'drive');
    if (c.npcSeq) updateNpcSeq(c, dt);
    syncCar(c);
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
let visT = 0, radioT = 4;
function updateWanted(dt) {
  if (wanted <= 0) return;
  let copsNear = false;
  visT -= dt;
  if (visT <= 0) {
    visT = 0.2; let seen = false;
    for (const c of cars) if (c.mode === 'police') { c.sees = copSees(c); seen = seen || c.sees; if (Math.hypot(c.x - player.x, c.z - player.z) < 260) copsNear = true; }
    for (const o of officers) if (o.state !== 'dead') { seen = seen || o.sees; copsNear = true; }
    const tgt = player.car || player;
    if (seen) { if (wantedCool > 3) radioT = Math.min(radioT, 0.5); wantedCool = 0; lastSeen.x = tgt.x; lastSeen.z = tgt.z; lastSeen.foot = !player.car; lastSeen.car = player.car; lastSeen.bld = INT.inside ? INT.b : null; }
    else if (copsNear || wantedCool > 0) wantedCool += squad.cops.length && INT.inside && squad.b === INT.b ? 0.07 : 0.2;
  }
  // Polizeifunk
  radioT -= dt;
  if (radioT < 0) { radioT = rnd(8, 13); say(wantedCool > 2 ? pick(LINES.radioLost) : pick(LINES.radio), { who: 'Polizeifunk', color: '#6fa8ff', pitch: 0.7, rate: 1.15, vol: 0.7, radio: true }); }
  if (wantedCool > 9 + wanted * 3) escapeWanted();
}
function escapeWanted() {
  const w = wanted; wanted = 0; wantedCool = 0;
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
let lastEnv = 0, mapT = 0, worldReady = false, qCeil = qIdx, fpsT = 0, fpsN = 0;
function simulate(dt, raw, raw0, time) {
  gameMin = (gameMin + dt * 0.5) % 1440;
  if (switching) updateSwitch(raw); else updatePlayer(dt, raw);
  updateBuildings(dt);
  updateIdleChars(dt);
  updateCars(dt, time); updateRide(dt); updateSquad(dt); updatePrison(dt);
  updatePeds(dt);
  updatePickups(dt, time);
  updateWanted(dt); updateCrimeCalls(dt);
  updateGrenades(dt); updateScanner(dt); updateMeeting(dt); updateWaypoint();
  for (let i = tracers.length - 1; i >= 0; i--) { if ((tracers[i].t -= dt) < 0) { scene.remove(tracers[i].m); tracers.splice(i, 1); } }
  flash.intensity = Math.max(0, flash.intensity - dt * 600);
  const hm = HOMES[CHARS[cur].home]; if (hm) { hm.marker.scale.y = 1 + Math.sin(time * 3) * 0.15; hm.marker.material.opacity = 0.3 + Math.sin(time * 3) * 0.1; }
  // Dynamische Auflösung: bei zu wenig FPS automatisch eine Stufe runter
  fpsT += raw0; fpsN++;
  if (fpsT > 3) { const fps = fpsN / fpsT; fpsT = 0; fpsN = 0; if (fps < 24 && qIdx > 0) { qIdx--; applySize(); notice('Auflösung automatisch angepasst: ' + QUALITY[qIdx][0], 2200); } }
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
  progress(0.05, 'Texturen werden generiert …'); await nextFrame();
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
  applyChar(cur);
  camYaw = player.yaw + 0.5;
  for (let i = 0; i < 26; i++) spawnTraffic(25, 260);
  for (let i = 0; i < 18; i++) spawnParked(15, 230);
  for (let i = 0; i < 50; i++) spawnPed(6, 130);
  worldReady = true;
  window.__game = { player, cars, peds, CHARS, switchChar, die, escapeWanted, INT, BUILDINGS, activateBuilding, callCab, interiorUse, curFloorOf, get cur() { return cur; }, get wanted() { return wanted; }, set wanted(v) { wanted = v; }, set time(v) { gameMin = v; }, step(n) { for (let i = 0; i < n; i++) simulate(0.05, 0.05, 0, clock.elapsedTime); }, get cool() { return wantedCool; }, requestRide, boardRide, setWaypoint, KNOCK, VENDS, sigState, vendMenu, busted, get PRISON() { return PRISON; }, squad, officers, lastSeen, addWanted, openPhone, phoneKey, bankMenu, get ride() { return ride; }, get phone() { return phone; } };
  progress(0.9, CHARS[cur].name[0] + CHARS[cur].name.slice(1).toLowerCase() + ' wird geweckt …'); await nextFrame();
  progress(0.95, 'Shader werden kompiliert …'); await nextFrame();
  updateCamera(0.016);
  setupPost();
  renderSatellite();
  renderer.compile(scene, camera);
  composer.render();
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
