// GTA – Los Santos (Browser-3D, Three.js) – direkt als Franklin, keine Intro-Mission.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
  camera.aspect = w / h; camera.updateProjectionMatrix();
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.2, 2600);
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
const TW = 21, TH = 14.4; // Weltgröße einer Fassadenkachel (6 Achsen x 4 Etagen)
let TEX = {};
function makeTextures() {
  TEX.asphalt = canvasTex(512, 512, (c, w, h) => { c.fillStyle = '#323438'; c.fillRect(0, 0, w, h); speckle(c, w, h, 9000, 0.07, 0.18); });
  TEX.concrete = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#9a9891'; c.fillRect(0, 0, w, h); speckle(c, w, h, 2500, 0.08, 0.1);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 0, w, 3); c.fillRect(0, 0, 3, h);
  });
  TEX.grass = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#4a7a36'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { c.fillStyle = `hsl(${rnd(80, 115)},${rnd(35, 55)}%,${rnd(20, 38)}%)`; c.fillRect(Math.random() * w, Math.random() * h, 1.5, rnd(2, 5)); }
  });
  const S = 1024, bays = 6, floors = 4, bw = S / bays, fh = S / floors;
  const lit = []; for (let i = 0; i < bays * floors; i++) lit.push(Math.random() < 0.55 ? rnd(0.5, 1) : 0);
  const eachWin = fn => { for (let f = 0; f < floors; f++) for (let b = 0; b < bays; b++) fn(b * bw + bw * 0.16, f * fh + fh * 0.18, bw * 0.68, fh * 0.6, lit[f * bays + b]); };
  TEX.facade = canvasTex(S, S, (c) => {
    c.fillStyle = '#e4e1da'; c.fillRect(0, 0, S, S); speckle(c, S, S, 12000, 0.06, 0.07);
    for (let f = 0; f < floors; f++) { c.fillStyle = '#c4c0b6'; c.fillRect(0, f * fh + fh - 14, S, 14); }
    eachWin((x, y, w, h) => {
      c.fillStyle = '#8d8a83'; c.fillRect(x - 7, y - 7, w + 14, h + 14);
      const g = c.createLinearGradient(x, y, x + w, y + h);
      g.addColorStop(0, '#1b2738'); g.addColorStop(0.45, '#5b7a9e'); g.addColorStop(0.55, '#3e5878'); g.addColorStop(1, '#162131');
      c.fillStyle = g; c.fillRect(x, y, w, h);
      c.fillStyle = '#2b2b2b'; c.fillRect(x + w / 2 - 3, y, 6, h); c.fillRect(x, y + h * 0.35, w, 5);
      c.fillStyle = '#d2cec4'; c.fillRect(x - 10, y + h + 7, w + 20, 9);
    });
  });
  TEX.facadeE = canvasTex(S, S, (c) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
    eachWin((x, y, w, h, l) => {
      if (!l) return;
      const g = c.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, `rgba(255,214,150,${l})`); g.addColorStop(1, `rgba(255,150,70,${l * 0.8})`);
      c.fillStyle = g; c.fillRect(x, y, w, h);
      c.fillStyle = '#000'; c.fillRect(x + w / 2 - 3, y, 6, h); c.fillRect(x, y + h * 0.35, w, 5);
    });
  });
  TEX.facadeORM = canvasTex(S, S, (c) => {
    c.fillStyle = 'rgb(255,225,0)'; c.fillRect(0, 0, S, S);
    eachWin((x, y, w, h) => { c.fillStyle = 'rgb(255,30,210)'; c.fillRect(x, y, w, h); });
  }, false);
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
  M.facade = new THREE.MeshStandardMaterial({ map: TEX.facade, emissiveMap: TEX.facadeE, emissive: 0xffffff, emissiveIntensity: 0, roughnessMap: TEX.facadeORM, metalnessMap: TEX.facadeORM, roughness: 1, metalness: 1, vertexColors: true });
  M.vcol = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
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
function addSolid(minx, maxx, minz, maxz, h) {
  const s = { minx, maxx, minz, maxz, h };
  for (let cx = Math.floor(minx / CELL); cx <= Math.floor(maxx / CELL); cx++)
    for (let cz = Math.floor(minz / CELL); cz <= Math.floor(maxz / CELL); cz++) {
      const k = ckey(cx, cz); if (!solids.has(k)) solids.set(k, []); solids.get(k).push(s);
    }
}
const _r = { x: 0, z: 0, nx: 0, nz: 0, hit: false };
function resolveCircle(x, z, r) {
  _r.hit = false; let nx = 0, nz = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const list = solids.get(ckey(cx, cz)); if (!list) continue;
        for (const s of list) {
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
  for (const s of list) if (x >= s.minx && x <= s.maxx && z >= s.minz && z <= s.maxz && y < s.h) return true;
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
const skyUniforms = { top: { value: sky.top }, hor: { value: sky.hor }, sunDir: { value: sky.sunDir }, sunCol: { value: sky.sunCol }, night: { value: 0 } };
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec3 top, hor, sunDir, sunCol; uniform float night; varying vec3 vDir;
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
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat);
skyDome.renderOrder = -1; skyDome.frustumCulled = false;
scene.add(skyDome);
const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(skyDome.geometry, skyMat));
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
function updateEnv() { const rt = pmrem.fromScene(envScene, 0, 0.1, 3000); scene.environment = rt.texture; if (envRT) envRT.dispose(); envRT = rt; }

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
  nTop: new THREE.Color('#03050f'), nHor: new THREE.Color('#0d1630'), dTop: new THREE.Color('#2b67b8'), dHor: new THREE.Color('#acd0ee'),
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
  skyUniforms.night.value = nightF;
  scene.fog.color.copy(sky.hor);
  const sunI = 3.2 * smooth(0.0, 0.18, e), moonI = 0.45 * smooth(0.0, 0.15, -e);
  sun.intensity = Math.max(sunI, moonI);
  sun.color.copy(sunI > moonI ? C.sunE.clone().lerp(C.sunD, smooth(0.05, 0.45, e)) : C.moon);
  hemi.intensity = lerp(0.18, 0.7, day);
  hemi.color.copy(sky.top).lerp(new THREE.Color(0xffffff), 0.4);
  scene.environmentIntensity = lerp(0.12, 0.9, day);
  M.facade.emissiveIntensity = nightF * 1.6;
  M.lampHead.emissiveIntensity = nightF * 4;
  M.head.emissiveIntensity = 0.3 + nightF * 3;
  M.tail.emissiveIntensity = 0.4 + nightF * 1.5;
  if (lampGlow) lampGlow.material.opacity = nightF * 0.55;
  return e;
}

// ---------- City generation ----------
const palette = ['#d8d2c4', '#c9cdd3', '#b9a99a', '#a8b4c0', '#cdbba2', '#9aa5ad', '#e0d9c8', '#8d939a', '#b8705e', '#7b8794', '#c7b48a', '#d9c2b0'];
const parks = new Set();
const HOME_BLOCKS = ['7,7', '3,3', '11,10'], HOSPITAL_BLOCK = '5,8';
let lampGlow = null;
function wallBox(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const ou = rint(0, 5) / 6, ov = rint(0, 3) / 4;
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
  const xs = splits(rint(1, 3)), zs = splits(rint(1, 3));
  let px = x0;
  for (const fx of xs) {
    let pz = z0; const cw = inner * fx;
    for (const fz of zs) {
      const cd = inner * fz, gap = rnd(0.6, 2.2);
      const w = cw - gap, d = cd - gap, bx = px + cw / 2, bz = pz + cd / 2;
      const floors = Math.max(3, Math.round((rnd(10, 24) + down * down * rnd(10, 130) * (Math.random() < 0.7 ? 1 : 0.3)) / 3.6));
      const h = floors * 3.6, color = pick(palette);
      chunk.walls.push(wallBox(w, h, d, bx, 0.2 + h / 2, bz, color));
      chunk.roofs.push(box(w + 0.4, 0.5, d + 0.4, bx, 0.2 + h + 0.25, bz, '#5b5f63'));
      let top = h;
      if (h > 55 && w > 12 && d > 12) {
        const h2 = Math.round(rnd(0.15, 0.4) * h / 3.6) * 3.6, w2 = w * rnd(0.55, 0.75), d2 = d * rnd(0.55, 0.75);
        chunk.walls.push(wallBox(w2, h2, d2, bx, 0.2 + h + h2 / 2, bz, color));
        chunk.roofs.push(box(w2 + 0.4, 0.5, d2 + 0.4, bx, 0.2 + h + h2 + 0.25, bz, '#4d5155'));
        top = h + h2;
        if (Math.random() < 0.6) chunk.roofs.push(box(0.4, rnd(8, 18), 0.4, bx, 0.2 + top + 6, bz, '#888'));
      }
      for (let k = rint(0, 3); k > 0; k--) {
        const aw = rnd(1.5, 4), ad = rnd(1.5, 4), ah = rnd(1, 2.5);
        chunk.roofs.push(box(aw, ah, ad, bx + rnd(-w / 3, w / 3), 0.2 + h + 0.5 + ah / 2, bz + rnd(-d / 3, d / 3), pick(['#9a9c9e', '#7d8083', '#b0b2b4'])));
      }
      addSolid(bx - w / 2, bx + w / 2, bz - d / 2, bz + d / 2, top + 0.7);
      mapBuildings.push([bx - w / 2, bz - d / 2, w, d]);
      pz += cd;
    }
    px += cw;
  }
}

const trees = [], lamps = [];
async function buildCity(progress) {
  // Boden
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1 }));
  TEX.grass.repeat.set(1600, 1600); grass.rotation.x = -Math.PI / 2; grass.position.y = -0.05; grass.receiveShadow = true;
  scene.add(grass);
  const roadSize = EXT * 2 + 8;
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(roadSize, roadSize), new THREE.MeshStandardMaterial({ map: TEX.asphalt, roughness: 0.92 }));
  TEX.asphalt.repeat.set(roadSize / 7, roadSize / 7);
  asphalt.rotation.x = -Math.PI / 2; asphalt.receiveShadow = true; scene.add(asphalt);

  // Parks auswählen (Startblock ist eine Plaza/Park)
  for (let n = 0; n < 18; n++) parks.add(rint(0, N - 1) + ',' + rint(0, N - 1));
  for (const k of HOME_BLOCKS) parks.add(k);
  parks.delete(HOSPITAL_BLOCK);

  const chunks = new Map(), sidewalk = [], parkGeo = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const ck = Math.floor(i / 4) + ',' + Math.floor(j / 4);
      if (!chunks.has(ck)) chunks.set(ck, { walls: [], roofs: [] });
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
          trees.push([tx, tz, rnd(0.9, 1.5)]);
        }
      } else if (i + ',' + j !== HOSPITAL_BLOCK) genBlock(i, j, chunks.get(ck));
      // Laternen & Straßenbäume an den Bordsteinen
      for (let side = 0; side < 4; side++) {
        for (let s = 0; s < 3; s++) {
          const t = -B / 2 + 10 + s * 20, e = B / 2 - 0.7;
          const p = [[t, -e], [e, t], [t, e], [-e, t]][side];
          lamps.push([cx + p[0], cz + p[1], side]);
          if (s < 2 && Math.random() < 0.8) {
            const tt = t + 10, e2 = B / 2 - 1.3, q = [[tt, -e2], [e2, tt], [tt, e2], [-e2, tt]][side];
            trees.push([cx + q[0], cz + q[1], rnd(0.8, 1.15)]);
          }
        }
      }
    }
    if (i % 2 === 1) { progress(0.25 + 0.4 * i / N, 'Los Santos wird gebaut …'); await nextFrame(); }
  }
  for (const c of chunks.values()) {
    if (c.walls.length) {
      const m = new THREE.Mesh(mergeGeometries(c.walls), M.facade); m.castShadow = m.receiveShadow = true; scene.add(m);
      const r = new THREE.Mesh(mergeGeometries(c.roofs), M.vcol); r.castShadow = r.receiveShadow = true; scene.add(r);
    }
  }
  const swm = new THREE.Mesh(mergeGeometries(sidewalk), new THREE.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.9 }));
  swm.receiveShadow = true; scene.add(swm);
  const pm = new THREE.Mesh(mergeGeometries(parkGeo), new THREE.MeshStandardMaterial({ map: TEX.grass, roughness: 1 }));
  pm.receiveShadow = true; scene.add(pm);
  progress(0.7, 'Straßenmarkierungen …'); await nextFrame();
  buildMarkings();
  buildProps();
  // Stadtgrenze
  const wallM = new THREE.MeshStandardMaterial({ map: TEX.concrete, roughness: 0.9 });
  const W = EXT + 14;
  for (const [x, z, w, d] of [[0, -W, 2 * W + 4, 2], [0, W, 2 * W + 4, 2], [-W, 0, 2, 2 * W], [W, 0, 2, 2 * W]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), wallM); m.position.set(x, 2, z); m.castShadow = m.receiveShadow = true; scene.add(m);
    addSolid(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 4);
  }
}

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

function buildProps() {
  const dummy = new THREE.Object3D();
  // Bäume
  const trunkG = new THREE.CylinderGeometry(0.16, 0.24, 3, 7); trunkG.translate(0, 1.5, 0);
  const leafG = new THREE.IcosahedronGeometry(2.1, 1); leafG.translate(0, 4.4, 0);
  const trunk = new THREE.InstancedMesh(trunkG, mat('#5a4030'), trees.length);
  const leaf = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees.length);
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
    addSolid(x - 0.15, x + 0.15, z - 0.15, z + 0.15, 7);
  });
  pole.castShadow = true;
  scene.add(pole, head, lampGlow);
}

// ---------- Humans ----------
const SKIN = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#e8bfa0', '#5a3a22', '#3d2414', '#a8714a'];
const HAIR = ['#120c08', '#2a1c12', '#4a3322', '#7a5a36', '#b8975e', '#2b2b2b', '#6a6a6a'];
const EYES = ['#3b2414', '#2e4f6e', '#4b5d2e', '#5a3a1a', '#1d1d1d'];
const CLOTH = ['#b03a2e', '#2e86c1', '#28b463', '#f1c40f', '#7d3c98', '#e67e22', '#ecf0f1', '#17202a', '#566573', '#a04000', '#1abc9c', '#d98880', '#34495e', '#c0b283'];
const PANTS = ['#1f2a44', '#2b2b2b', '#5d4e3a', '#3f4a3c', '#7a7a7a', '#14213d', '#4a5d7a', '#c2b59b'];
function colorBy(g, fn) {
  const p = g.attributes.position, n = p.count, a = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { c.set(fn(p.getY(i), p.getX(i), p.getZ(i))); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
// Gesichtstextur (Kugel-UV: Gesichtsmitte bei u = 0.25)
const faceCache = new Map();
function faceMat(L) {
  const key = [L.skin, L.hair, L.beard, L.eye, L.hairStyle].join('|');
  if (faceCache.has(key)) return faceCache.get(key);
  const sk = new THREE.Color(L.skin), sh = f => '#' + sk.clone().multiplyScalar(f).getHexString();
  const tex = canvasTex(512, 256, (c, W, H) => {
    c.fillStyle = L.skin; c.fillRect(0, 0, W, H);
    const rg = c.createRadialGradient(128, 135, 8, 128, 135, 150);
    rg.addColorStop(0, 'rgba(255,235,220,0.12)'); rg.addColorStop(0.6, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.2)');
    c.fillStyle = rg; c.fillRect(0, 0, W, H);
    speckle(c, W, H, 2500, 0.03, 0.05);
    if (L.beard > 0) {
      c.fillStyle = L.hair;
      for (let i = 0; i < 9000 * L.beard; i++) {
        const x = 128 + rnd(-62, 62), y = rnd(132, 235);
        if (((x - 128) / 62) ** 2 + ((y - 165) / 72) ** 2 > 1) continue;
        if (y < 152 && Math.abs(x - 128) < 48) continue;
        if (Math.abs(x - 128) < 14 && y > 170 && y < 184) continue;
        c.globalAlpha = rnd(0.15, 0.5) * Math.min(1, L.beard * 1.4); c.fillRect(x, y, rnd(1, 2.5), rnd(1.5, 3));
      }
      c.globalAlpha = 1;
    }
    for (const s of [-1, 1]) {
      const ex = 128 + s * 26, ey = 122;
      c.fillStyle = 'rgba(0,0,0,0.16)'; c.beginPath(); c.ellipse(ex, ey + 1, 15, 9, 0, 0, 7); c.fill();
      c.fillStyle = '#f3efe9'; c.beginPath(); c.ellipse(ex, ey, 10, 5, 0, 0, 7); c.fill();
      c.fillStyle = L.eye; c.beginPath(); c.arc(ex, ey, 4.6, 0, 7); c.fill();
      c.fillStyle = '#080808'; c.beginPath(); c.arc(ex, ey, 2.2, 0, 7); c.fill();
      c.fillStyle = '#fff'; c.fillRect(ex + 1, ey - 2.5, 1.6, 1.6);
      c.strokeStyle = sh(0.3); c.lineWidth = 2.2; c.beginPath(); c.ellipse(ex, ey + 1, 10.5, 6, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
      c.strokeStyle = L.hairStyle === 'bald' ? sh(0.45) : L.hair; c.lineWidth = 4; c.lineCap = 'round';
      c.beginPath(); c.moveTo(128 + s * 13, 109); c.quadraticCurveTo(128 + s * 26, 103, 128 + s * 39, 109); c.stroke();
    }
    const ng = c.createLinearGradient(116, 0, 140, 0);
    ng.addColorStop(0, 'rgba(0,0,0,0.13)'); ng.addColorStop(0.5, 'rgba(0,0,0,0)'); ng.addColorStop(1, 'rgba(0,0,0,0.13)');
    c.fillStyle = ng; c.fillRect(116, 124, 24, 30);
    c.fillStyle = sh(0.45); for (const s of [-1, 1]) { c.beginPath(); c.ellipse(128 + s * 5, 155, 3, 1.8, 0, 0, 7); c.fill(); }
    c.fillStyle = sh(0.68); c.beginPath(); c.ellipse(128, 174, 16, 3.6, 0, 0, 7); c.fill();
    c.fillStyle = sh(0.8); c.beginPath(); c.ellipse(128, 179, 13, 4, 0, 0, 7); c.fill();
    c.strokeStyle = sh(0.3); c.lineWidth = 1.6; c.beginPath(); c.moveTo(113, 176); c.quadraticCurveTo(128, 178.5, 143, 176); c.stroke();
    // Haaransatz (vorne höher, hinten tiefer)
    c.fillStyle = L.hair;
    const band = (yF, yB, from = 0, alpha = 1) => {
      c.globalAlpha = alpha;
      for (let x = 0; x < W; x += 2) {
        const d = Math.min(Math.abs(x - 128), W - Math.abs(x - 128)) / 256;
        if (d < from) continue;
        c.fillRect(x, 0, 2, lerp(yF, yB, smooth(0.12, 0.6, d)) + rnd(-2, 2));
      }
      c.globalAlpha = 1;
    };
    if (L.hairStyle === 'bald') { c.globalAlpha = 0.55; for (let x = 0; x < W; x += 2) { const d = Math.min(Math.abs(x - 128), W - Math.abs(x - 128)) / 256; if (d > 0.28) c.fillRect(x, 92 + rnd(-2, 2), 2, 55); } c.globalAlpha = 1; }
    else band(L.hairStyle === 'buzz' ? 66 : 60, L.hairStyle === 'slick' ? 150 : 128, 0, L.hairStyle === 'buzz' ? 0.85 : 1);
  });
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
  faceCache.set(key, m); return m;
}
const HUM = {};
function humGeo() {
  if (HUM.ok) return HUM;
  const cap = (r, l, ty) => { const g = new THREE.CapsuleGeometry(r, l, 5, 14); g.translate(0, ty, 0); return g; };
  HUM.thigh = cap(0.085, 0.32, -0.2); HUM.shin = cap(0.066, 0.34, -0.21);
  HUM.shoe = new THREE.CapsuleGeometry(0.058, 0.14, 4, 10); HUM.shoe.rotateX(Math.PI / 2); HUM.shoe.scale(1.05, 0.75, 1); HUM.shoe.translate(0, -0.43, 0.045);
  HUM.upper = cap(0.058, 0.22, -0.15); HUM.fore = cap(0.048, 0.21, -0.14);
  HUM.hand = new THREE.SphereGeometry(0.052, 12, 8); HUM.hand.scale(0.8, 1.15, 0.6); HUM.hand.translate(0, -0.31, 0);
  const prof = [[0, 0], [0.16, 0], [0.17, 0.08], [0.165, 0.22], [0.19, 0.4], [0.21, 0.5], [0.17, 0.57], [0.07, 0.61], [0, 0.61]].map(([x, y]) => new THREE.Vector2(x, y));
  HUM.torso = new THREE.LatheGeometry(prof, 24); HUM.torso.scale(1, 1, 0.62); HUM.torso.translate(0, 0.94, 0);
  HUM.hips = new THREE.CapsuleGeometry(0.13, 0.14, 4, 14); HUM.hips.rotateZ(Math.PI / 2); HUM.hips.scale(1, 1, 0.75); HUM.hips.translate(0, 0.93, 0);
  HUM.neck = new THREE.CylinderGeometry(0.05, 0.058, 0.14, 12); HUM.neck.translate(0, 1.6, 0);
  HUM.head = new THREE.SphereGeometry(0.115, 48, 32); HUM.head.scale(0.92, 1.12, 1.0);
  const hairG = r => { const g = new THREE.SphereGeometry(r, 36, 16, 0, Math.PI * 2, 0, Math.PI * 0.42); g.rotateX(-0.35); g.scale(0.94, 1.13, 1.03); return g; };
  HUM.hair = hairG(0.124); HUM.hairBuzz = hairG(0.118);
  const ear = new THREE.SphereGeometry(0.026, 10, 8); ear.scale(0.5, 1, 0.8);
  const e1 = ear.clone().translate(0.104, -0.005, -0.005), e2 = ear.clone().translate(-0.104, -0.005, -0.005);
  const nose = new THREE.SphereGeometry(0.02, 10, 8); nose.scale(0.75, 1.25, 1); nose.translate(0, -0.012, 0.112);
  HUM.ears = mergeGeometries([e1, e2, nose]);
  HUM.gun = new THREE.BoxGeometry(0.05, 0.09, 0.26); HUM.gun.translate(0, 0, 0.08);
  HUM.ok = true; return HUM;
}
function makeHuman(L) {
  const G = humGeo(), g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const skin = L.skin, meshes = [];
  const add = (geo, parent, m = M.body) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; parent.add(o); meshes.push(o); return o; };
  const grp = (parent, x, y, z) => { const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); return o; };
  const col = (geo, c) => colorBy(geo.clone(), () => c);
  const legs = [], shins = [], arms = [], fores = [];
  for (const s of [1, -1]) {
    const leg = grp(body, s * 0.1, 0.9, 0); add(col(G.thigh, L.pants), leg);
    const shin = grp(leg, 0, -0.42, 0); add(mergeGeometries([col(G.shin, L.pants), col(G.shoe, L.shoes)]), shin);
    legs.push(leg); shins.push(shin);
  }
  add(mergeGeometries([col(G.torso, L.shirt), col(G.hips, L.pants), col(G.neck, skin)]), body);
  for (const s of [1, -1]) {
    const arm = grp(body, s * 0.215, 1.46, 0);
    add(colorBy(G.upper.clone(), y => (L.sleeves !== 'long' && y < -0.13) ? skin : L.shirt), arm);
    const fore = grp(arm, 0, -0.29, 0);
    add(mergeGeometries([col(G.fore, L.sleeves === 'long' ? L.shirt : skin), col(G.hand, skin)]), fore);
    arms.push(arm); fores.push(fore);
  }
  const head = grp(body, 0, 1.75, 0);
  const hm = new THREE.Mesh(G.head, faceMat(L)); hm.castShadow = true; head.add(hm);
  const extras = [col(G.ears, skin)];
  if (L.hairStyle !== 'bald') extras.push(col(L.hairStyle === 'buzz' ? G.hairBuzz : G.hair, L.hair));
  add(mergeGeometries(extras), head);
  const gun = new THREE.Mesh(G.gun, mat('#222', { metalness: 0.8, roughness: 0.3 })); gun.position.set(0, -0.33, 0.06); gun.visible = false; fores[1].add(gun);
  meshes.push(hm);
  return { group: g, body, legL: legs[0], legR: legs[1], shinL: shins[0], shinR: shins[1], armL: arms[0], armR: arms[1], foreL: fores[0], foreR: fores[1], head, gun, meshes, phase: Math.random() * 6, t: Math.random() * 9, cast: true };
}
function disposeHuman(h) { for (const m of h.meshes) if (m.geometry !== HUM.head) m.geometry.dispose(); }
function setHumanShadow(h, on) { if (h.cast === on) return; h.cast = on; for (const m of h.meshes) m.castShadow = on; }
function animHuman(h, speed, dt, aiming = false) {
  const run = speed > 5;
  h.phase += dt * (run ? speed * 1.75 : speed * 2.4); h.t += dt;
  const a = Math.min(speed / 4.2, 1) * (run ? 0.85 : 0.55), s = Math.sin(h.phase), c = Math.cos(h.phase);
  h.legL.rotation.x = s * a; h.legR.rotation.x = -s * a;
  h.shinL.rotation.x = Math.max(0, c) * a * 1.4 + 0.03; h.shinR.rotation.x = Math.max(0, -c) * a * 1.4 + 0.03;
  const breath = Math.sin(h.t * 1.8) * 0.025, elbow = -0.15 - (run ? 0.9 : 0.25 * a);
  h.armL.rotation.set(-s * a * 0.8 + breath, 0, 0.07); h.foreL.rotation.x = elbow;
  if (aiming) {
    h.armR.rotation.set(-Math.PI / 2, 0, 0); h.foreR.rotation.x = 0;
    h.armL.rotation.set(-1.25, 0, -0.55); h.foreL.rotation.x = -0.35;
  } else { h.armR.rotation.set(s * a * 0.8 + breath, 0, -0.07); h.foreR.rotation.x = elbow; }
  h.gun.visible = aiming;
  h.body.position.y = Math.abs(c) * 0.035 * a;
  h.body.rotation.x = run ? 0.13 : 0.03 * a;
  h.head.rotation.y = speed < 0.3 ? Math.sin(h.t * 0.45) * 0.35 : 0;
}
// Gesichter-Pool für Passanten (begrenzt Texturspeicher)
const FACE_POOL = [];
function buildFacePool() {
  for (let i = 0; i < 18; i++) {
    const L = { skin: pick(SKIN), hair: pick(HAIR), beard: pick([0, 0, 0.25, 0.5, 0.8]), eye: pick(EYES), hairStyle: pick(['buzz', 'short', 'short', 'slick', 'bald']) };
    faceMat(L); FACE_POOL.push(L);
  }
}
function pedLook() {
  return { ...pick(FACE_POOL), shirt: pick(CLOTH), pants: pick(PANTS), shoes: pick(['#1a1a1a', '#f0f0f0', '#5a3a22', '#2a2a40']), sleeves: Math.random() < 0.6 ? 'short' : 'long' };
}

// ---------- Cars ----------
const carGeoCache = {};
function extrudeProfile(pts, depth, bevel) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, bevel ? { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 } : { depth, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0); return g;
}
function carGeos(L, W, hs) {
  const key = L + '_' + W + '_' + hs; if (carGeoCache[key]) return carGeoCache[key];
  const Y = y => 0.32 + (y - 0.32) * hs;
  const body = extrudeProfile([[0.05, 0.32], [0, Y(0.82)], [0.3, Y(0.96)], [L - 1.3, Y(0.98)], [L - 0.4, Y(0.88)], [L, Y(0.68)], [L - 0.04, 0.32]], W - 0.14, 0.07);
  const gh = extrudeProfile([[0.85, Y(0.96)], [1.4, Y(1.46)], [L - 1.75, Y(1.46)], [L - 1.2, Y(0.97)]], W - 0.3, 0);
  [body, gh].forEach(g => g.translate(0, 0, -L / 2));
  const roof = new THREE.BoxGeometry(W - 0.34, 0.05, L - 3.15); roof.translate(0, Y(1.46) + 0.025, (1.4 + L - 1.75) / 2 - L / 2);
  const paintG = mergeGeometries([body, roof.toNonIndexed()]);
  const trims = [
    [W, 0.2, 0.16, 0, 0.42, L / 2 + 0.02], [W, 0.2, 0.16, 0, 0.42, -L / 2 - 0.02], [W * 0.5, 0.16, 0.05, 0, Y(0.6), L / 2 + 0.03],
    [0.12, 0.1, 0.2, W / 2 + 0.05, Y(1.0), L / 2 - 1.5], [0.12, 0.1, 0.2, -W / 2 - 0.05, Y(1.0), L / 2 - 1.5],
  ].map(([w, h, d, x, y, z]) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed(); });
  const lightG = (z, y) => { const a = new THREE.BoxGeometry(0.42, 0.13, 0.06), b = a.clone(); a.translate(W / 2 - 0.32, y, z); b.translate(-W / 2 + 0.32, y, z); return mergeGeometries([a, b]); };
  const tire = colorize(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 18).rotateZ(Math.PI / 2).toNonIndexed(), '#141414');
  const rim = colorize(new THREE.CylinderGeometry(0.23, 0.23, 0.275, 10).rotateZ(Math.PI / 2).toNonIndexed(), '#c4c7cc');
  return carGeoCache[key] = {
    paint: paintG, glass: gh, trim: mergeGeometries(trims), head: lightG(L / 2 + 0.005, Y(0.74)), tail: lightG(-L / 2 - 0.005, Y(0.8)),
    wheel: mergeGeometries([tire, rim]), top: Y(1.46),
  };
}
const CAR_TYPES = {
  sedan: { L: 4.6, W: 1.86, hs: 1, max: 38, acc: 13 }, coupe: { L: 4.4, W: 1.92, hs: 0.86, max: 48, acc: 19 },
  suv: { L: 4.8, W: 2.0, hs: 1.25, max: 34, acc: 11 }, compact: { L: 3.9, W: 1.75, hs: 1.05, max: 32, acc: 11 },
  police: { L: 4.7, W: 1.9, hs: 1, max: 44, acc: 17 },
};
const CAR_COLORS = ['#b8b8b8', '#1c1c1c', '#f2f2f2', '#7d0f12', '#123d6b', '#2f5233', '#c9a227', '#5c5f63', '#a34a12', '#3a2f5c', '#0f5e63', '#d35d0e'];
const cars = [];
function makeCar(type, color, x, z, yaw, mode) {
  const T = CAR_TYPES[type], G = carGeos(T.L, T.W, T.hs);
  const group = new THREE.Group();
  const paintMesh = new THREE.Mesh(G.paint, type === 'police' ? paint('#0d0e10') : paint(color));
  const glass = new THREE.Mesh(G.glass, M.glass);
  paintMesh.castShadow = glass.castShadow = true;
  group.add(paintMesh, glass, new THREE.Mesh(G.trim, M.trim), new THREE.Mesh(G.head, M.head), new THREE.Mesh(G.tail, M.tail));
  const wheels = [];
  for (const [wx, wz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const pivot = new THREE.Group(); pivot.position.set(wx * (T.W / 2 - 0.15), 0.36, wz * (T.L / 2 - 0.88));
    const w = new THREE.Mesh(G.wheel, M.wheel); pivot.add(w); group.add(pivot); wheels.push(pivot);
  }
  const car = { type, T, group, paintMesh, wheels, x, z, y: 0, yaw, vx: 0, vz: 0, steer: 0, spin: 0, health: 100, mode, smoke: 0,
    ai: { dir: 0, laneC: 0, nextK: 0, decided: -99, turn: null, speed: 0, stuck: 0, rev: 0, knockX: 0, knockZ: 0 } };
  if (type === 'police') {
    const doorG = new THREE.PlaneGeometry(1.6, 0.42);
    for (const s of [1, -1]) { const d = new THREE.Mesh(doorG, M.white); d.rotation.y = s * Math.PI / 2; d.position.set(s * (T.W / 2 + 0.005), 0.66, 0.1); group.add(d); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.3), M.trim); bar.position.set(0, G.top + 0.12, -0.2);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.26), M.copRed); red.position.set(0.28, G.top + 0.2, -0.2);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.26), M.copBlue); blue.position.set(-0.28, G.top + 0.2, -0.2);
    group.add(bar, red, blue);
  }
  scene.add(group); cars.push(car); syncCar(car);
  return car;
}
function syncCar(c) {
  c.group.position.set(c.x, c.y, c.z); c.group.rotation.y = c.yaw;
  for (let i = 0; i < 4; i++) { c.wheels[i].children[0].rotation.x = c.spin; if (i < 2) c.wheels[i].rotation.y = c.steer * 0.6; }
}
function removeCar(c) { scene.remove(c.group); cars.splice(cars.indexOf(c), 1); }
const carCircles = c => { const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), o = c.T.L / 2 - 0.95; return [[c.x + fx * o, c.z + fz * o], [c.x, c.z], [c.x - fx * o, c.z - fz * o]]; };

// Arcade-Fahrphysik (Spieler, Polizei, herrenlose Autos)
function driveCar(c, throttle, steerIn, hand, dt) {
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
  c.yaw += (vf / 2.8) * Math.tan(c.steer) * dt * (hand ? 1.45 : 1);
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
    const imp = -vn; if (imp > 7) { damageCar(c, (imp - 7) * 2.2); sfx.crash(Math.min(1, imp / 25), c); if (c === player.car) shake = Math.min(1, imp / 20); }
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
  if (c.type === 'police') addWanted(1, 3);
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
  for (const p of peds) if (p.state !== 'dead' && Math.hypot(p.x - x, p.z - z) < 8) killPed(p, false);
  for (const c of cars) if (c.mode !== 'wreck') { const dc = Math.hypot(c.x - x, c.z - z); if (dc > 0.1 && dc < 8) damageCar(c, 45 * (1 - dc / 8)); }
}

// ---------- Pedestrians ----------
const peds = [];
const RING = B - 4.4;
const PED_COUNT = 55;
function pedPos(p) {
  const L = RING, h = L / 2, s = ((p.s % (4 * L)) + 4 * L) % (4 * L), side = Math.floor(s / L), t = s % L - h;
  const cx = blockCenter(p.bi), cz = blockCenter(p.bj), o = p.off;
  const [u, v, tx, tz] = [[t, -h + o, 1, 0], [h - o, t, 0, 1], [-t, h - o, -1, 0], [-h + o, -t, 0, -1]][side];
  return [cx + u, cz + v, tx * p.dir, tz * p.dir];
}
function spawnPed(minD = 25, maxD = 120) {
  for (let tries = 0; tries < 20; tries++) {
    const a = Math.random() * Math.PI * 2, d = rnd(minD, maxD);
    const bi = clamp(Math.floor((player.x + Math.cos(a) * d - BLOCK0) / P), 0, N - 1), bj = clamp(Math.floor((player.z + Math.sin(a) * d - BLOCK0) / P), 0, N - 1);
    const p = { bi, bj, s: rnd(0, 4 * RING), dir: Math.random() < 0.5 ? 1 : -1, off: rnd(0, 1.2), speed: rnd(1.1, 1.6), state: 'walk', t: 0, x: 0, z: 0, yaw: 0, hp: 40 };
    const [x, z] = pedPos(p); const dd = Math.hypot(x - player.x, z - player.z);
    if (dd < minD || dd > maxD) continue;
    p.x = x; p.z = z;
    p.h = makeHuman(pedLook());
    p.h.group.scale.setScalar(rnd(0.94, 1.05));
    scene.add(p.h.group); peds.push(p); return p;
  }
}
function killPed(p, byPlayer = true) {
  if (p.state === 'dead') return;
  p.state = 'dead'; p.t = 15;
  p.h.group.rotation.x = -Math.PI / 2; p.h.group.position.y = 0.3;
  sfx.pain(p.x, p.z);
  if (Math.random() < 0.7) spawnMoney(p.x, p.z, rint(8, 90));
  if (byPlayer) addWanted(1, 1);
}
function scarePeds(x, z, r) {
  let talker = null;
  for (const p of peds) if (p.state === 'walk' && Math.hypot(p.x - x, p.z - z) < r) { p.state = 'flee'; p.t = rnd(6, 10); if (!talker || Math.random() < 0.3) talker = p; }
  if (talker && Math.hypot(talker.x - player.x, talker.z - player.z) < 30) say(pick(LINES.scared), { who: 'Passant', pitch: rnd(0.9, 1.3), rate: 1.2 });
}
let pedTalkT = 6, bumpCd = 0;
function updatePeds(dt) {
  pedTalkT -= dt; bumpCd -= dt;
  for (let i = peds.length - 1; i >= 0; i--) {
    const p = peds[i], dist = Math.hypot(p.x - player.x, p.z - player.z);
    if (dist > 160 || (p.state === 'dead' && (p.t -= dt) < 0)) { scene.remove(p.h.group); disposeHuman(p.h); peds.splice(i, 1); continue; }
    setHumanShadow(p.h, dist < 40);
    if (p.state === 'dead') continue;
    let spd = p.speed;
    if (p.state === 'flee') {
      spd = 5.2; p.t -= dt;
      const [, , tx, tz] = pedPos(p);
      if (tx * (p.x - player.x) + tz * (p.z - player.z) < 0 && dist < 25) p.dir *= -1;
      if (p.t < 0) p.state = 'walk';
    } else if (p.state === 'free') {
      // Weglaufen (z.B. nach Carjacking)
      p.t -= dt; const a = Math.atan2(p.x - player.x, p.z - player.z);
      p.x += Math.sin(a) * 5 * dt; p.z += Math.cos(a) * 5 * dt; const r = resolveCircle(p.x, p.z, 0.35); p.x = r.x; p.z = r.z;
      p.yaw = a; animHuman(p.h, 6, dt);
      p.h.group.position.set(p.x, groundH(p.x, p.z), p.z); p.h.group.rotation.y = p.yaw;
      if (p.t < 0 && dist > 40) { p.state = 'dead'; p.t = 0; }
      continue;
    }
    // stehen bleiben und quatschen, wenn Franklin direkt vor ihnen steht
    const blocked = !player.car && dist < 1.1;
    if (blocked && bumpCd <= 0) { bumpCd = 6; say(pick(LINES.bump), { who: 'Passant', pitch: rnd(0.85, 1.25) }); }
    if (!blocked) p.s += p.dir * spd * dt;
    const [x, z, tx, tz] = pedPos(p);
    p.x = x; p.z = z; p.yaw = blocked ? Math.atan2(player.x - x, player.z - z) : Math.atan2(tx, tz);
    animHuman(p.h, blocked ? 0 : spd, dt);
    p.h.group.position.set(p.x, 0.2, p.z); p.h.group.rotation.y = p.yaw;
    p.h.group.visible = dist < 140;
    if (pedTalkT < 0 && p.state === 'walk' && dist < 6 && !player.car && !player.dead) { pedTalkT = rnd(9, 16); say(pick(LINES.ped), { who: 'Passant', pitch: rnd(0.85, 1.25) }); }
  }
  let alive = 0; for (const p of peds) if (p.state !== 'dead') alive++;
  for (let n = 0; alive < PED_COUNT && n < 2; n++, alive++) if (!spawnPed(peds.length < 10 ? 8 : 70, 140)) break;
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
  const type = pick(['sedan', 'sedan', 'coupe', 'suv', 'compact', 'compact']);
  const c = makeCar(type, pick(CAR_COLORS), rp.x, rp.z, 0, 'ai'); initAI(c, rp.dir);
}
function spawnParked(minD, maxD) {
  const rp = roadPoint(minD, maxD); if (!rp) return;
  const D = DIRS[rp.dir], r = rightOf(rp.dir);
  const x = D[0] === 0 ? roadPos(rp.k) + r[0] * PARK : rp.x, z = D[0] === 0 ? rp.z : roadPos(rp.k) + r[1] * PARK;
  if (inBlock(D[0] === 0 ? z : x) === false) return; // nicht auf Kreuzungen parken
  makeCar(pick(['sedan', 'coupe', 'suv', 'compact']), pick(CAR_COLORS), x, z, dirYaw(rp.dir), 'parked');
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
    c.steer = lerp(c.steer, 0, dt * 5);
    const kc = roadPos(a.nextK), along = D[0] === 0 ? c.z : c.x, sgn = D[0] + D[1];
    const dist = (kc - along) * sgn;
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
  const tgt = player.car || player, dx = tgt.x - c.x, dz = tgt.z - c.z, d = Math.hypot(dx, dz);
  if (d > VIS_FAR) return false;
  if (d > VIS_NEAR && Math.abs(angDiff(c.yaw, Math.atan2(dx, dz))) > VIS_ANG) return false;
  return lineOfSight(c.x, c.z, tgt.x, tgt.z);
}
function updatePolice(c, dt) {
  const a = c.ai, tgt = player.car || player;
  let tx, tz;
  if (wanted > 0 && wantedCool < 2) { tx = tgt.x; tz = tgt.z; }
  else if (wanted > 0) {
    if (!a.search || Math.hypot(a.search[0] - c.x, a.search[1] - c.z) < 14) a.search = [lastSeen.x + rnd(-60, 60), lastSeen.z + rnd(-60, 60)];
    [tx, tz] = a.search;
  } else { tx = c.x + Math.sin(c.yaw) * 50; tz = c.z + Math.cos(c.yaw) * 50; }
  const dx = tx - c.x, dz = tz - c.z, dist = Math.hypot(dx, dz);
  const diff = angDiff(c.yaw, Math.atan2(dx, dz));
  let steer = clamp(diff * 2, -1, 1), thr = wanted > 0 ? 1 : 0.35;
  const probe = (ang, d) => solidAt(c.x + Math.sin(c.yaw + ang) * d, 1, c.z + Math.cos(c.yaw + ang) * d);
  if (probe(0.35, 9)) steer -= 0.9; if (probe(-0.35, 9)) steer += 0.9;
  const pd = Math.hypot(tgt.x - c.x, tgt.z - c.z);
  if (wanted > 0 && pd < 14 && !player.car) thr = -0.6 * Math.sign(c.speedF || 0);
  if (Math.abs(diff) > 2.2 && dist < 25) { thr = -1; steer = -steer; }
  if (Math.abs(c.speedF || 0) < 1.2 && thr > 0) a.stuck += dt; else a.stuck = 0;
  if (a.stuck > 1.6) { a.rev = 1.4; a.stuck = 0; }
  if (a.rev > 0) { a.rev -= dt; thr = -1; steer = -Math.sign(diff); }
  driveCar(c, clamp(thr, -1, 1), clamp(steer, -1, 1), false, dt);
  // Schüsse & Megafon nur mit Sichtkontakt
  if (wanted > 0 && c.sees && pd < 28) {
    a.fire = (a.fire || 0) - dt;
    if (a.fire <= 0) {
      a.fire = rnd(0.5, 1.1); sfx.shot(c.x, c.z, 0.5);
      if (Math.random() < 0.45) { if (player.car) damageCar(player.car, 2 + wanted); else hurtPlayer(3 + wanted * 1.5); }
    }
    a.mega = (a.mega ?? rnd(1, 4)) - dt;
    if (a.mega <= 0 && pd < 24) { a.mega = rnd(10, 16); say(pick(LINES.mega), { who: 'Polizei (Megafon)', pitch: 0.75, rate: 1.05, color: '#6fa8ff' }); }
  }
}

// ---------- Player & Charaktere ----------
const player = { x: 9.9, z: 20, y: 0.2, vy: 0, vx: 0, vz: 0, yaw: -Math.PI / 2, hp: 100, armor: 60, money: 18750, car: null, h: null, fireCd: 0, aimT: 0, dead: 0, grounded: true, respect: 0 };
let wanted = 0, wantedCool = 0, cur = 0, switching = null;
const START = { x: 9.9, z: 20 };
const HOMES = {}, HOSPITAL = { x: 0, z: 0, yaw: Math.PI }, POIS = [];
const CHARS = [
  { name: 'FRANKLIN', col: '#9be389', home: 'franklin', look: { skin: '#5b3a25', shirt: '#a9c98f', pants: '#2a3142', shoes: '#f2f2f2', hair: '#110b07', beard: 0.55, eye: '#2b1a0e', hairStyle: 'buzz', sleeves: 'short' }, car: ['coupe', '#4b1f7a'], money: 18750 },
  { name: 'MICHAEL', col: '#6fb3ff', home: 'michael', look: { skin: '#e3b993', shirt: '#eef1f4', pants: '#34373e', shoes: '#1b1512', hair: '#3a2a1c', beard: 0.25, eye: '#3d5a7a', hairStyle: 'slick', sleeves: 'long' }, car: ['sedan', '#2d3035'], money: 64200 },
  { name: 'TREVOR', col: '#ffa060', home: 'trevor', look: { skin: '#dba98c', shirt: '#d8d2c0', pants: '#5d6f8a', shoes: '#4a3020', hair: '#5a4632', beard: 0.45, eye: '#4d5a3a', hairStyle: 'bald', sleeves: 'short' }, car: ['suv', '#6b4a2a'], money: 3120 },
];
function hurtPlayer(d) {
  if (player.dead || switching) return;
  const a = Math.min(player.armor, d * 0.7); player.armor -= a; player.hp -= d - a;
  if (player.hp <= 0) { player.hp = 0; die(); }
}
function addWanted(n, min = 0) {
  const before = wanted; wanted = clamp(Math.max(wanted + n, min), 0, 5); wantedCool = 0;
  lastSeen.x = player.x; lastSeen.z = player.z;
  if (wanted > before && before === 0) { notice('GESUCHT!', 1500); say(pick(LINES.chars[cur].cops), { who: CHARS[cur].name, color: CHARS[cur].col, prio: true }); radioT = 3; }
}
function fade(on) { $('fade').classList.toggle('on', on); }
function die() {
  player.dead = 5; $('wasted').style.display = 'flex'; sfx.wasted();
  if (player.car) exitCar(true);
}
function respawn() {
  $('wasted').style.display = 'none';
  Object.assign(player, { x: HOSPITAL.x, z: HOSPITAL.z, yaw: HOSPITAL.yaw, hp: 100, armor: 0, dead: 0, vx: 0, vz: 0, vy: 0, y: 0.2 });
  const bill = Math.min(player.money, 500); player.money -= bill; wanted = 0; wantedCool = 0;
  for (const c of [...cars]) if (c.type === 'police') removeCar(c);
  player.h.group.visible = true; player.h.group.rotation.set(0, player.yaw, 0);
  camYaw = player.yaw; camPitch = 0.2;
  setTimeout(() => fade(false), 400);
  notice(`Krankenhaus Pillbox Hill · Rechnung: -$${bill}`, 3500);
}
function storeChar() { const c = CHARS[cur]; Object.assign(c.st, { x: player.x, z: player.z, yaw: player.yaw, hp: player.hp, armor: player.armor, money: player.money, respect: player.respect }); }
function applyChar(i) {
  cur = i; const c = CHARS[i], st = c.st;
  Object.assign(player, { x: st.x, z: st.z, yaw: st.yaw, hp: st.hp, armor: st.armor, money: st.money, respect: st.respect || 0, vx: 0, vz: 0, vy: 0, y: groundH(st.x, st.z), h: c.h, car: null });
  c.h.group.visible = true;
  $('who').textContent = c.name; $('who').style.color = c.col;
  for (const k in HOMES) HOMES[k].marker.visible = k === c.home;
}
function switchChar(i) {
  if (i === cur || switching || player.dead || !started) return;
  if (wanted > 0) { notice('Wechsel während einer Fahndung nicht möglich', 1800); return; }
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
    animHuman(c.h, 0, dt); c.h.group.visible = Math.hypot(st.x - player.x, st.z - player.z) < 150;
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
function enterCar() {
  let best = null, bd = 4.2;
  for (const c of cars) { if (c.mode === 'wreck' || c.type === 'police') continue; const d = Math.hypot(c.x - player.x, c.z - player.z); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  if (best.mode === 'ai') {
    const p = spawnPed(0, 9999); if (p) { p.x = best.x; p.z = best.z; p.state = 'free'; p.t = 6; }
    scarePeds(best.x, best.z, 20); say(pick(LINES.carjack), { who: 'Fahrer', pitch: rnd(0.9, 1.2), prio: true });
  }
  best.mode = 'player'; best.vx = best.vz = 0; best.speedF = 0;
  player.car = best; player.h.group.visible = false; sfx.door();
}
function exitCar(force = false) {
  const c = player.car; if (!c) return;
  const sx = Math.cos(c.yaw), sz = -Math.sin(c.yaw); // linke Seite
  let x = c.x + sx * 2.2, z = c.z + sz * 2.2;
  if (!force && solidAt(x, 1, z)) { x = c.x - sx * 2.2; z = c.z - sz * 2.2; }
  const r = resolveCircle(x, z, 0.4); player.x = r.x; player.z = r.z; player.yaw = c.yaw;
  c.mode = c.health > 0 ? 'abandoned' : 'wreck';
  player.car = null; player.h.group.visible = true; sfx.door();
}

// ---------- Input ----------
const keys = {}; let mouseDX = 0, mouseDY = 0, lmb = false, rmb = false, lastMouse = 0;
let started = false, paused = false, showHelp = true;
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!started || e.repeat) return;
  if (e.code === 'KeyF' && !player.dead && !switching) player.car ? exitCar() : enterCar();
  if (e.code === 'KeyH') { showHelp = !showHelp; $('help').style.display = showHelp ? 'block' : 'none'; }
  if (e.code === 'KeyQ') { qIdx = (qIdx + 1) % QUALITY.length; qCeil = qIdx; applySize(); notice('Grafik: ' + QUALITY[qIdx][0], 1800); }
  if (e.code === 'KeyR' && player.car) sfx.radio();
  if (e.code === 'KeyE' && !player.dead && !switching && !useHome()) sfx.horn(player.x, player.z, 0.5);
  if (e.code === 'Digit1') switchChar(0); if (e.code === 'Digit2') switchChar(1); if (e.code === 'Digit3') switchChar(2);
  if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { mouseDX += e.movementX; mouseDY += e.movementY; lastMouse = performance.now(); } });
addEventListener('mousedown', e => { if (e.button === 0) lmb = true; if (e.button === 2) rmb = true; });
addEventListener('mouseup', e => { if (e.button === 0) lmb = false; if (e.button === 2) rmb = false; });
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (!started) return;
  paused = document.pointerLockElement !== canvas;
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
  mega: ['Halt! Polizei!', 'Hände hoch und auf den Boden!', 'Fahrzeug sofort anhalten!', 'Waffe fallen lassen!'],
  radio: ['Zentrale an alle Einheiten: Verdächtiger flüchtig.', 'Einheit zwölf, Verdächtiger in Sichtweite, nehmen Verfolgung auf.', 'Brauchen Verstärkung, Code drei!', 'Alle Einheiten: Schüsse gemeldet.', 'Verdächtiger fährt mit hoher Geschwindigkeit.'],
  radioLost: ['Sichtkontakt verloren, suchen das Gebiet ab.', 'Kein Sichtkontakt. Letzte bekannte Position wird abgesucht.'],
  radioEnd: 'Alle Einheiten: Fahndung eingestellt. Verdächtiger entkommen.',
};
let voices = [];
try { const lv = () => { voices = speechSynthesis.getVoices(); }; lv(); speechSynthesis.addEventListener('voiceschanged', lv); } catch (e) { /* keine Sprachausgabe */ }
let speakUntil = 0, subT = null;
function say(text, { who = '', pitch = 1, rate = 1, vol = 1, prio = false, color = '#ffd23a', radio = false } = {}) {
  const now = performance.now();
  if (!prio && now < speakUntil) return false;
  speakUntil = now + 900 + text.length * 60;
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
  return {
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
  // Symbole: Häuser & Krankenhaus (aufrecht trotz Kartendrehung)
  mm.font = `bold ${Math.round(26 / zoom)}px Arial`; mm.textAlign = 'center'; mm.textBaseline = 'middle';
  for (const p of POIS) {
    const x = (p.x - px) * MS, z = (p.z - pz) * MS;
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
  $('money').textContent = '$' + Math.floor(player.money).toLocaleString('en-US');
  const h = Math.floor(gameMin / 60) % 24, m = Math.floor(gameMin % 60);
  $('clock').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  $('stars').innerHTML = [0, 1, 2, 3, 4].map(i => `<span class="${i < wanted ? 'on' : ''}">★</span>`).join('');
  $('stars').className = wantedCool > 0.5 ? 'flash' : '';
  $('stars').style.visibility = wanted > 0 ? 'visible' : 'hidden';
  $('hp').firstChild.style.width = player.hp + '%'; $('ar').firstChild.style.width = player.armor + '%';
  $('hp').firstChild.style.background = player.hp < 30 ? '#d0453a' : '#5dbb4f';
  $('speed').style.display = player.car ? 'block' : 'none';
  if (player.car) $('spv').textContent = Math.round(Math.abs(player.car.speedF || 0) * 3.6);
  $('weapon').textContent = player.car ? (player.car.health < 30 ? '⚠ FAHRZEUG BESCHÄDIGT' : '') : 'PISTOLE  ∞';
  let hint = '';
  if (!player.car && !player.dead && !switching) {
    const home = HOMES[CHARS[cur].home];
    if (home && Math.hypot(home.x - player.x, home.z - player.z) < 2) hint = 'Drücke <b>E</b>, um zu schlafen und zu speichern';
    else for (const c of cars) if (c.mode !== 'wreck' && c.type !== 'police' && Math.hypot(c.x - player.x, c.z - player.z) < 4.2) { hint = 'Drücke <b>F</b>, um einzusteigen'; break; }
  }
  $('hint').innerHTML = hint; $('hint').style.display = hint ? 'block' : 'none';
  $('cross').style.display = !player.car && player.aimT > 0 ? 'block' : 'none';
}

// ---------- Shooting ----------
const tracers = [];
const tracerG = new THREE.BoxGeometry(0.03, 0.03, 1); tracerG.translate(0, 0, 0.5);
const tracerM = new THREE.MeshBasicMaterial({ color: 0xffe9a0 });
const flash = new THREE.PointLight(0xffc070, 0, 8, 2); scene.add(flash);
function shoot(camYaw, camPitch) {
  const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const o = ray.ray.origin, d = ray.ray.direction;
  let best = 150, hitPed = null, hitCar = null;
  for (const p of peds) {
    if (p.state === 'dead') continue;
    const c = new THREE.Vector3(p.x, 1.0, p.z), t = c.clone().sub(o).dot(d); if (t < 0 || t > best) continue;
    const q = o.clone().addScaledVector(d, t);
    if (Math.hypot(q.x - p.x, q.z - p.z) < 0.4 && q.y > 0 && q.y < 1.85) { best = t; hitPed = p; hitCar = null; }
  }
  for (const c of cars) {
    if (c === player.car) continue;
    const inv = new THREE.Matrix4().copy(c.group.matrixWorld).invert();
    const lo = o.clone().applyMatrix4(inv), ld = d.clone().transformDirection(inv);
    const t = rayBox(lo, ld, c.T.W / 2, 1.5, c.T.L / 2); if (t !== null && t < best && t > 0) { best = t; hitCar = c; hitPed = null; }
  }
  for (let t = 1; t < best; t += 0.5) { const q = o.clone().addScaledVector(d, t); if (q.y < 0 || solidAt(q.x, q.y, q.z)) { best = t; hitPed = hitCar = null; break; } }
  const hit = o.clone().addScaledVector(d, best);
  const muzzle = new THREE.Vector3(player.x - Math.cos(player.yaw) * 0.3 + Math.sin(player.yaw) * 0.6, player.y + 1.45, player.z + Math.sin(player.yaw) * 0.3 + Math.cos(player.yaw) * 0.6);
  const tr = new THREE.Mesh(tracerG, tracerM); tr.position.copy(muzzle); tr.lookAt(hit); tr.scale.z = muzzle.distanceTo(hit); scene.add(tr); tracers.push({ m: tr, t: 0.05 });
  flash.position.copy(muzzle); flash.intensity = 30;
  emit(fire, muzzle.x, muzzle.y, muzzle.z, 0, 0, 0, 0.06, 0.4, 0, 1, 0.8, 0.4);
  sfx.shot();
  if (hitPed) { hitPed.hp -= 25; for (let i = 0; i < 8; i++) emit(smoke, hit.x, hit.y, hit.z, rnd(-1, 1), rnd(0, 2), rnd(-1, 1), 0.5, 0.15, 0.2, 0.5, 0, 0); if (hitPed.hp <= 0) killPed(hitPed); }
  else if (hitCar) { damageCar(hitCar, hitCar.type === 'police' ? 9 : 7); if (hitCar.type === 'police') addWanted(0, Math.max(2, wanted)); for (let i = 0; i < 6; i++) emit(fire, hit.x, hit.y, hit.z, rnd(-3, 3), rnd(0, 3), rnd(-3, 3), 0.15, 0.12, 0, 1, 0.8, 0.3); }
  else for (let i = 0; i < 5; i++) emit(smoke, hit.x, hit.y, hit.z, rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1), 0.7, 0.3, 0.6, 0.6, 0.58, 0.55);
  scarePeds(player.x, player.z, 45);
  if (wanted === 0 && peds.some(p => p.state !== 'dead' && Math.hypot(p.x - player.x, p.z - player.z) < 25)) addWanted(1);
  void camYaw; void camPitch;
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
  if (player.car) {
    const c = player.car, sp = Math.abs(c.speedF || 0);
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
    camera.fov = lerp(camera.fov, aim ? 55 : 68, dt * 6);
  }
  camera.updateProjectionMatrix();
  camDist = lerp(camDist, dist, Math.min(1, dt * 4));
  camTarget.set(tx, ty, tz);
  const cp = Math.cos(camPitch), dx = -Math.sin(camYaw) * cp, dy = Math.sin(camPitch), dz = -Math.cos(camYaw) * cp;
  let d = camDist;
  for (let s = 0.5; s <= camDist; s += 0.35) if (solidAt(tx + dx * s, ty + dy * s, tz + dz * s)) { d = Math.max(0.6, s - 0.4); break; }
  camera.position.set(tx + dx * d, Math.max(ty + dy * d, 0.4), tz + dz * d);
  if (shake > 0) { camera.position.x += rnd(-1, 1) * shake * 0.4; camera.position.y += rnd(-1, 1) * shake * 0.4; shake = Math.max(0, shake - dt * 1.8); }
  camera.lookAt(tx, ty + 0.2, tz);
  skyDome.position.copy(camera.position);
}

// ---------- Main update ----------
let carInput = { thr: 0, skid: 0 };
function updatePlayer(dt, raw) {
  player.fireCd -= dt; player.aimT -= dt;
  if (player.dead) {
    player.dead -= raw;
    if (player.dead < 1.2 && !$('fade').classList.contains('on')) fade(true);
    if (player.dead <= 0) respawn();
    const h = player.h; h.group.rotation.x = lerp(h.group.rotation.x, -Math.PI / 2, Math.min(1, dt * 4)); h.group.position.y = lerp(h.group.position.y, player.y + 0.25, dt * 4);
    return;
  }
  if (player.car) {
    const c = player.car;
    const thr = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const st = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
    driveCar(c, thr, st, !!keys.Space, dt);
    player.x = c.x; player.z = c.z; player.y = c.y;
    const lat = Math.abs(c.vx * -Math.cos(c.yaw) + c.vz * Math.sin(c.yaw));
    carInput = { thr: Math.max(0, thr), skid: Math.max((lat - 2.5) / 6, keys.Space && Math.abs(c.speedF) > 6 ? 0.8 : 0, thr > 0 && c.speedF < 4 && c.speedF > 0.3 ? 0.4 : 0) };
    if (Math.abs(c.speedF) > 3) for (const p of peds) {
      if (p.state === 'dead') continue;
      for (const [cx, cz] of carCircles(c)) if (Math.hypot(p.x - cx, p.z - cz) < 1.3) { killPed(p); sfx.hit(); damageCar(c, 1); break; }
    } else for (const p of peds) if (p.state === 'walk' && Math.hypot(p.x - c.x, p.z - c.z) < 4) { p.state = 'flee'; p.t = 4; }
    headlight.intensity = nightF * 60;
    headlight.position.set(c.x + Math.sin(c.yaw) * 2.3, c.y + 0.8, c.z + Math.cos(c.yaw) * 2.3);
    headlight.target.position.set(c.x + Math.sin(c.yaw) * 20, 0, c.z + Math.cos(c.yaw) * 20);
    return;
  }
  carInput = { thr: 0, skid: 0 };
  headlight.intensity = 0;
  const mf = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), ms = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -fz, rz = fx;
  let mx = fx * mf + rx * ms, mz = fz * mf + rz * ms; const ml = Math.hypot(mx, mz);
  const aiming = rmb || lmb;
  const spd = ml > 0 ? (keys.ShiftLeft || keys.ShiftRight) && !aiming ? 7.6 : aiming ? 2.6 : 4.2 : 0;
  if (ml > 0) { mx /= ml; mz /= ml; }
  player.vx = lerp(player.vx, mx * spd, Math.min(1, dt * 10)); player.vz = lerp(player.vz, mz * spd, Math.min(1, dt * 10));
  player.x += player.vx * dt; player.z += player.vz * dt;
  const r = resolveCircle(player.x, player.z, 0.38); player.x = r.x; player.z = r.z;
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
  const g = groundH(player.x, player.z);
  if (keys.Space && player.grounded) { player.vy = 5.4; player.grounded = false; }
  player.vy -= 15 * dt; player.y += player.vy * dt;
  if (player.y <= g) { player.y = player.grounded ? lerp(player.y, g, Math.min(1, dt * 20)) : g; player.vy = 0; player.grounded = true; }
  if (player.grounded && player.y < g) player.y = g;
  if (lmb && player.fireCd <= 0) { player.fireCd = 0.2; shoot(camYaw, camPitch); }
  if (player.hp < 50) player.hp = Math.min(50, player.hp + dt * 1.2);
  const h = player.h; h.group.position.set(player.x, player.y, player.z); h.group.rotation.set(0, player.yaw, 0);
  animHuman(h, Math.hypot(player.vx, player.vz), dt, player.aimT > 0);
  if (player.aimT > 0) h.armR.rotation.x = -Math.PI / 2 - camPitch * 0.8 + 0.25;
}

function updateCars(dt, time) {
  const pc = player.car;
  for (const c of [...cars]) {
    if (c.mode === 'ai') updateAI(c, dt);
    else if (c.mode === 'police') updatePolice(c, dt);
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
            if (o.mode === 'ai') { o.ai.knockX += rv * nx * 0.6; o.ai.knockZ += rv * nz * 0.6; o.ai.speed = 0; o.ai.honk = 0.3; }
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
    syncCar(c);
    const d = Math.hypot(c.x - player.x, c.z - player.z);
    c.group.visible = d < 420;
    if (c !== pc && !c.keep && d > 300) removeCar(c);
  }
  const counts = { ai: 0, parked: 0, police: 0 };
  for (const c of cars) if (counts[c.mode] !== undefined) counts[c.mode]++;
  if (counts.ai < 34) spawnTraffic(counts.ai < 10 ? 30 : 160, 280);
  if (counts.parked < 22) spawnParked(counts.parked < 8 ? 25 : 150, 270);
  const wantCops = [0, 2, 3, 4, 6, 8][wanted];
  if (counts.police < wantCops && Math.random() < dt * 0.8) {
    const rp = roadPoint(80, 150); if (rp) makeCar('police', '#000', rp.x, rp.z, Math.atan2(lastSeen.x - rp.x, lastSeen.z - rp.z), 'police');
  }
  const on = wanted > 0, f = Math.sin(time * 14) > 0;
  M.copRed.emissiveIntensity = on && f ? 6 : 0.2; M.copBlue.emissiveIntensity = on && !f ? 6 : 0.2;
}

let visT = 0, radioT = 4;
function updateWanted(dt) {
  if (wanted <= 0) { for (const c of [...cars]) if (c.type === 'police' && c.mode === 'police' && Math.hypot(c.x - player.x, c.z - player.z) > 200) removeCar(c); return; }
  let copsNear = false;
  visT -= dt;
  if (visT <= 0) {
    visT = 0.2; let seen = false;
    for (const c of cars) if (c.mode === 'police') { c.sees = copSees(c); seen = seen || c.sees; if (Math.hypot(c.x - player.x, c.z - player.z) < 260) copsNear = true; }
    const tgt = player.car || player;
    if (seen) { if (wantedCool > 3) radioT = Math.min(radioT, 0.5); wantedCool = 0; lastSeen.x = tgt.x; lastSeen.z = tgt.z; }
    else if (copsNear || wantedCool > 0) wantedCool += 0.2;
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
    HOMES[key] = { x, z, marker: m }; POIS.push({ x, z, col, sym });
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
    solid(cx, cz + 4, 44, 30, 36);
    Object.assign(HOSPITAL, { x: cx, z: cz - 17, yaw: Math.PI });
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
  updateIdleChars(dt);
  updateCars(dt, time);
  updatePeds(dt);
  updatePickups(dt, time);
  updateWanted(dt);
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
  if (paused || !started) dt = 0;
  const raw = dt;
  if (player.dead) dt *= 0.4;
  if (dt > 0) simulate(dt, raw, raw0, time);
  updateAudio(raw);
  updateParticles(fire, dt, 1.5); updateParticles(smoke, dt, 0.6);
  updateCamera(Math.max(dt, 0.001));
  updateSky();
  const ts = 190 / 4096, sx = Math.round(player.x / ts) * ts, sz = Math.round(player.z / ts) * ts;
  const ld = sky.sunDir.y > 0 ? sky.sunDir : sky.sunDir.clone().negate();
  sun.target.position.set(sx, 0, sz); sun.position.set(sx + ld.x * 250, ld.y * 250, sz + ld.z * 250);
  if (time - lastEnv > 20) { lastEnv = time; updateEnv(); }
  renderer.render(scene, camera);
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
  buildMinimapBase();
  progress(0.8, 'Verkehr wird gestartet …'); await nextFrame();
  fire = makeParticles(600, true); smoke = makeParticles(700, false);
  buildFacePool();
  // Charaktere: Startpunkte an ihren Häusern, eigene Autos davor
  const carSpots = [[PARK, 26, Math.PI], null, null];
  CHARS.forEach((c, i) => {
    const hm = HOMES[c.home];
    c.st = i === 0 ? { x: START.x, z: START.z, yaw: -Math.PI / 2 } : { x: hm.x, z: hm.z - 1.5, yaw: Math.PI };
    Object.assign(c.st, { hp: 100, armor: i === 0 ? 60 : 30, money: c.money, respect: 0 });
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
  window.__game = { player, cars, peds, CHARS, switchChar, die, escapeWanted, get cur() { return cur; }, get wanted() { return wanted; }, set wanted(v) { wanted = v; }, set time(v) { gameMin = v; }, step(n) { for (let i = 0; i < n; i++) simulate(0.05, 0.05, 0, clock.elapsedTime); }, get cool() { return wantedCool; } };
  progress(0.9, CHARS[cur].name[0] + CHARS[cur].name.slice(1).toLowerCase() + ' wird geweckt …'); await nextFrame();
  progress(0.95, 'Shader werden kompiliert …'); await nextFrame();
  updateCamera(0.016);
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
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
