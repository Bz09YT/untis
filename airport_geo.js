// Geometrie-Helfer & Flugzeugbau für den Flughafen (alles prozedural).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function canvasTex(w, h, draw, srgb = true, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Sammelt Geometrien pro Material-Schlüssel und baut je ein Mesh
export class Batch {
  constructor() { this.m = new Map(); }
  add(key, g) { if (!this.m.has(key)) this.m.set(key, []); this.m.get(key).push(g); return g; }
  col(g, color) {
    const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
  }
  box(key, w, h, d, x, y, z, color, ry = 0, rx = 0) {
    const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); g.translate(x, y, z);
    return this.add(key, this.col(g, color));
  }
  cyl(key, r0, r1, h, x, y, z, color, seg = 12, rx = 0, rz = 0) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg); if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); g.translate(x, y, z);
    return this.add(key, this.col(g, color));
  }
  build(parent, mats, shadow = false) {
    const out = [];
    for (const [k, list] of this.m) {
      const g = mergeGeometries(list.map(x => { x = x.index ? x : x; return x; })); if (!g) continue;
      const mesh = new THREE.Mesh(g, mats[k]); mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; parent.add(mesh); out.push(mesh);
    }
    return out;
  }
}

// ---------- Rumpf: gitterförmig, mit optionalem Türausschnitt (Backbord) ----------
// Station-Radien: Nase bei z = -L/2, Heck bei z = +L/2
export function fuselageGeo(L, R, cut) {
  const SEG = 48, ns = 90, st = [];
  const prof = t => { // t 0..1 Nase->Heck, Radiusfaktor und Höhenversatz
    if (t < 0.07) { const k = t / 0.07; return [Math.sqrt(1 - (1 - k) ** 2) * 0.98 + 0.02, 0]; }
    if (t < 0.78) return [1, 0];
    const k = (t - 0.78) / 0.22; return [Math.max(0.06, 1 - k * k * 0.94), k * k * 0.22 * R];
  };
  const set = new Set([0, 1]); for (let i = 0; i <= ns; i++) set.add(i / ns);
  if (cut) { set.add(cut.t0); set.add(cut.t1); }
  const ts = [...set].sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-5);
  const pos = [], uv = [], idx = [];
  for (const t of ts) {
    const [f, up] = prof(t);
    for (let j = 0; j <= SEG; j++) {
      const th = j / SEG * Math.PI * 2;
      pos.push(Math.sin(th) * R * f, Math.cos(th) * R * f + up, -L / 2 + t * L); uv.push(t, j / SEG);
    }
  }
  const W = SEG + 1;
  for (let i = 0; i < ts.length - 1; i++) for (let j = 0; j < SEG; j++) {
    if (cut) {
      const tm = (ts[i] + ts[i + 1]) / 2, thm = (j + 0.5) / SEG * 360;
      if (tm > cut.t0 && tm < cut.t1 && thm > cut.a0 && thm < cut.a1) continue;
    }
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}

export function liveryTex(opt) {
  return canvasTex(2048, 512, (c, w, h) => {
    c.fillStyle = opt.body || '#f4f6f8'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#c9ced4'; c.fillRect(0, h * 0.62, w, h * 0.38); // Unterseite (Backbord/Steuerbord je 0.5 von oben gezählt)
    // Winkel theta: v=0 oben, 0.25 Steuerbord, 0.75 Backbord
    for (const side of [0.25, 0.75]) {
      const vc = side * h, flip = side < 0.5;
      c.fillStyle = opt.stripe || '#1a56c4'; c.fillRect(0.06 * w, vc + h * 0.07, 0.82 * w, h * 0.012);
      c.fillStyle = opt.stripe2 || '#e0302a'; c.fillRect(0.06 * w, vc + h * 0.085, 0.82 * w, h * 0.006);
      // Fenster
      c.fillStyle = '#16212e';
      for (let x = 0.095 * w; x < 0.75 * w; x += 0.0098 * w) c.fillRect(x, vc - h * 0.012, 0.0045 * w, h * 0.036);
      c.save(); c.translate(0.24 * w, vc - h * 0.065); if (flip) { c.translate(0.34 * w, 0); c.scale(-1, 1); }
      c.fillStyle = opt.text || '#12315e'; c.font = `bold ${h * 0.085}px Arial Black, Arial, sans-serif`; c.textBaseline = 'middle'; c.fillText(opt.name || 'LS AIR', 0, 0); c.restore();
    }
    // Cockpitfenster
    c.fillStyle = '#0c1118';
    for (const vc of [0.0, 1.0]) { c.beginPath(); c.moveTo(0.052 * w, (vc - 0.06) * h); c.lineTo(0.082 * w, (vc - 0.05) * h); c.lineTo(0.082 * w, (vc + 0.05) * h); c.lineTo(0.052 * w, (vc + 0.06) * h); c.fill(); }
    c.fillRect(0.046 * w, 0.215 * h, 0.034 * w, 0.045 * h); c.fillRect(0.046 * w, 0.74 * h, 0.034 * w, 0.045 * h);
  }, true, false);
}

// ---------- Verkehrsflugzeug (Nase bei -z, Backbord = -x) ----------
export const AIRLINER = { L: 38, R: 2.0, AH: 3.8, FY: 3.3, doorZ: -13.5, doorW: 1.3 };
export function buildAirliner(opt = {}) {
  const { L, R, AH } = AIRLINER, grp = new THREE.Group(), body = new THREE.Group(); body.position.y = AH; grp.add(body);
  const dz = AIRLINER.doorZ, t0 = (dz - AIRLINER.doorW / 2 + L / 2) / L, t1 = (dz + AIRLINER.doorW / 2 + L / 2) / L;
  const hull = new THREE.Mesh(fuselageGeo(L, R, opt.door ? { t0, t1, a0: 255, a1: 315 } : null),
    new THREE.MeshStandardMaterial({ map: liveryTex(opt), roughness: 0.38, metalness: 0.25, envMapIntensity: 0.8 }));
  hull.castShadow = true; hull.receiveShadow = true; body.add(hull);
  const B = new Batch(), col = opt.tail || '#1a56c4', W = '#e9edf1', G = '#8d949b';
  const wing = side => { // Pfeilflügel als extrudierte Kontur
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(side * 16.5, 7.5); s.lineTo(side * 16.5, 9.2); s.lineTo(0, 7.2); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.28, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, -0.55 + 0.14, -3.2); // flach, leicht unterhalb der Achse
    if (side < 0) { /* Spiegelung: Windungsrichtung drehen */ g.scale(1, 1, 1); }
    return g;
  };
  for (const sd of [-1, 1]) {
    const g = wing(sd); if (sd < 0) { const idx = g.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.computeVertexNormals(); }
    B.add('v', B.col(g, W));
    B.box('v', 0.22, 1.5, 1.4, sd * 16.5, 0.65, 8.4, col);
    B.cyl('v', 0.9, 0.85, 3.4, sd * 5.6, -1.65, -1.2, G, 14, Math.PI / 2); // Triebwerk
    B.cyl('v', 0.75, 0.75, 0.05, sd * 5.6, -1.65, -2.95, '#2a2d31', 14, Math.PI / 2);
    // Höhenleitwerk
    const hs = new THREE.Shape(); hs.moveTo(0, 0); hs.lineTo(sd * 6.2, 3.6); hs.lineTo(sd * 6.2, 4.6); hs.lineTo(0, 3.6); hs.closePath();
    const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.14, bevelEnabled: false }); hg.rotateX(Math.PI / 2); hg.translate(0, 0.9, 13.2);
    if (sd < 0) { const ix = hg.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } hg.computeVertexNormals(); }
    B.add('v', B.col(hg, W));
  }
  // Seitenleitwerk
  const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(5.6, 0); fs.lineTo(3.6, 6.6); fs.lineTo(2.0, 6.6); fs.closePath();
  const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.24, bevelEnabled: false }); fg.translate(0, 0, -0.12); fg.rotateY(-Math.PI / 2); fg.translate(0, 1.2, 8.4);
  B.add('v', B.col(fg, col));
  // Fahrwerk
  B.cyl('v', 0.05, 0.05, 2.2, 0, -2.3, -12.8, G, 6); for (const sx of [-0.25, 0.25]) B.cyl('v', 0.4, 0.4, 0.22, sx, -3.4, -12.8, '#15171a', 12, 0, Math.PI / 2);
  for (const sx of [-2.4, 2.4]) { B.cyl('v', 0.06, 0.06, 2.4, sx, -2.5, 0.2, G, 6); for (const dx of [-0.25, 0.25]) B.cyl('v', 0.5, 0.5, 0.3, sx + dx, -3.35, 0.2, '#15171a', 12, 0, Math.PI / 2); }
  const mats = { v: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }) };
  B.build(body, mats, true);
  grp.userData.body = body; return grp;
}

// ---------- Business-Jet ----------
export const BIZJET = { L: 19, R: 1.35, AH: 2.15, FY: 1.55, doorZ: -6.3 };
export function buildBizjet(opt = {}) {
  const { L, R, AH } = BIZJET, grp = new THREE.Group(), body = new THREE.Group(); body.position.y = AH; grp.add(body);
  const t0 = (BIZJET.doorZ - 0.55 + L / 2) / L, t1 = (BIZJET.doorZ + 0.55 + L / 2) / L;
  const hull = new THREE.Mesh(fuselageGeo(L, R, opt.door ? { t0, t1, a0: 240, a1: 300 } : null),
    new THREE.MeshStandardMaterial({ map: liveryTex({ body: opt.body || '#f6f6f2', stripe: opt.stripe || '#222a36', stripe2: '#c9a24a', name: opt.name || 'LS JETS', text: '#222a36' }), roughness: 0.3, metalness: 0.3 }));
  hull.castShadow = true; hull.receiveShadow = true; body.add(hull);
  const B = new Batch(), W = '#eceef0', col = opt.tail || '#222a36';
  for (const sd of [-1, 1]) {
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(sd * 8.2, 3.6); s.lineTo(sd * 8.2, 4.5); s.lineTo(0, 3.4); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, -0.45, -1.2);
    if (sd < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
    B.add('v', B.col(g, W));
    B.cyl('v', 0.42, 0.4, 2.0, sd * 1.5, 0.35, 6.2, '#9aa0a6', 12, Math.PI / 2); // Heckträger-Triebwerke
    B.box('v', 0.7, 0.14, 1.6, sd * 0.4 - sd * 0.0, 0.4, 6.0, W);
    const hs = new THREE.Shape(); hs.moveTo(0, 0); hs.lineTo(sd * 2.8, 1.6); hs.lineTo(sd * 2.8, 2.2); hs.lineTo(0, 1.9); hs.closePath();
    const hg = new THREE.ExtrudeGeometry(hs, { depth: 0.1, bevelEnabled: false }); hg.rotateX(Math.PI / 2); hg.translate(0, 2.7, 7.3);
    if (sd < 0) { const ix = hg.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } hg.computeVertexNormals(); }
    B.add('v', B.col(hg, W));
    B.cyl('v', 0.05, 0.05, 1.6, sd * 1.0, -1.6, 0.5, '#8d949b', 6); B.cyl('v', 0.28, 0.28, 0.2, sd * 1.0, -2.3, 0.5, '#15171a', 10, 0, Math.PI / 2);
  }
  const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(3.2, 0); fs.lineTo(1.7, 3.0); fs.lineTo(0.7, 3.0); fs.closePath();
  const fg = new THREE.ExtrudeGeometry(fs, { depth: 0.16, bevelEnabled: false }); fg.translate(0, 0, -0.08); fg.rotateY(-Math.PI / 2); fg.translate(0, 0.9, 5.8);
  B.add('v', B.col(fg, col));
  B.cyl('v', 0.05, 0.05, 1.5, 0, -1.7, -5.0, '#8d949b', 6); B.cyl('v', 0.26, 0.26, 0.2, 0, -2.4, -5.0, '#15171a', 10, 0, Math.PI / 2);
  B.build(body, { v: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 }) }, true);
  grp.userData.body = body; return grp;
}

// ---------- Kabineninnenraum (Liner mit Fensterlöchern, Boden, Sitze, Gepäckfächer) ----------
export function buildCabin(kind) {
  const jet = kind === 'jet', cfg = jet ? { L: 12.5, z0: -4.2, R: 1.3, FY: -0.6, rows: 4, pitch: 1.5, win: 0.2 } : { L: 31, z0: -15.8, R: 1.94, FY: -0.5, rows: 24, pitch: 0.82, win: 0.28 };
  const g = new THREE.Group(), z1 = cfg.z0 + cfg.L, R = cfg.R;
  // Liner (Innenseite) mit Alpha-Fenstern
  const rows = jet ? 5 : cfg.rows + 2, winZ = []; for (let i = 0; i < rows; i++) winZ.push(cfg.z0 + (jet ? 1.4 + i * 1.8 : 3.6 + i * cfg.pitch));
  const tex = canvasTex(jet ? 512 : 2048, 256, (c, w, h) => {
    c.fillStyle = jet ? '#d8cfbf' : '#e6e3dc'; c.fillRect(0, 0, w, h);
    c.fillStyle = jet ? '#8a6c46' : '#b8b4aa'; c.fillRect(0, 0, w, h * 0.05);
    for (const th of [75, 285]) {
      const vc = th / 360 * h;
      for (const z of winZ) { const u = (z - cfg.z0) / cfg.L * w; c.clearRect(u - w / cfg.L * cfg.win / 2, vc - h * 0.045, w / cfg.L * cfg.win, h * 0.09); }
    }
  }, true, false);
  const lg = new THREE.CylinderGeometry(R, R, cfg.L, 40, 1, true); lg.rotateX(Math.PI / 2); // Achse z
  const lp = lg.attributes.position, lu = lg.attributes.uv;
  for (let i = 0; i < lp.count; i++) { const x = lp.getX(i), y = lp.getY(i), z = lp.getZ(i); const th = (Math.atan2(x, y) + Math.PI * 2) % (Math.PI * 2); lu.setXY(i, (z + cfg.L / 2) / cfg.L, th / (Math.PI * 2)); lp.setZ(i, z + cfg.z0 + cfg.L / 2); }
  // Nahtstelle: Vertices bei th~0/2pi doppelt -> Dreiecke über Naht lassen UV-Sprung; Zylinder hat doppelte Randvertices, daher ok
  lg.computeVertexNormals();
  const liner = new THREE.Mesh(lg, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.BackSide, roughness: 0.8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35 }));
  g.add(liner);
  const B = new Batch(), fy = cfg.FY;
  // Boden (Teppich)
  B.box('v', R * 1.9, 0.08, cfg.L, 0, fy - 0.04, cfg.z0 + cfg.L / 2, jet ? '#4a3c2c' : '#3b4a63');
  if (!jet) B.box('v', 0.5, 0.01, cfg.L - 0.4, 0, fy + 0.005, cfg.z0 + cfg.L / 2, '#7a2e2e');
  // Stirnwände
  B.box('v', R * 1.9, 2.6, 0.1, 0, fy + 1.3, cfg.z0 + 0.05, '#cfcac0'); B.box('v', R * 1.9, 2.6, 0.1, 0, fy + 1.3, z1 - 0.05, '#cfcac0');
  const seatCol = jet ? '#b6894e' : '#2f4f8a';
  const seat = (x, z, big) => {
    const w = big ? 0.6 : 0.46, sc = big ? '#b6894e' : seatCol;
    B.box('v', w, 0.12, big ? 0.7 : 0.46, x, fy + (big ? 0.42 : 0.4), z, sc);
    B.box('v', w, big ? 0.85 : 0.65, 0.12, x, fy + (big ? 0.82 : 0.75), z + (big ? 0.34 : 0.22), sc);
    B.box('v', w * 0.5, 0.18, 0.1, x, fy + (big ? 1.3 : 1.12), z + (big ? 0.34 : 0.22), jet ? '#8e6a38' : '#d8dde5');
    B.box('v', 0.05, 0.4, big ? 0.6 : 0.4, x - w / 2 - 0.02, fy + 0.2, z, '#222');
  };
  const seats = [];
  if (jet) {
    for (let r = 0; r < 3; r++) for (const sx of [-0.78, 0.78]) { const z = cfg.z0 + 2.4 + r * 2.2; seat(sx, z, true); seats.push({ x: sx, z, y: fy, side: sx < 0 ? -1 : 1 }); }
    B.box('v', 0.5, 0.05, 0.9, -0.85, fy + 0.7, cfg.z0 + 3.5, '#4a2e18'); // Tischchen
    B.box('v', 0.9, 0.4, 1.8, 0.5, fy + 0.2, z1 - 1.3, '#d9d2c4'); // Sofa-Block hinten
    B.box('v', 0.9, 0.6, 0.2, 0.5, fy + 0.7, z1 - 0.5, '#c8c0b0');
  } else {
    for (let r = 0; r < cfg.rows; r++) { const z = cfg.z0 + 3.2 + r * cfg.pitch; for (const sx of [-1.5, -1.04, -0.58, 0.58, 1.04, 1.5]) { seat(sx, z); seats.push({ x: sx, z, y: fy, side: sx < 0 ? -1 : 1, win: Math.abs(sx) > 1.4 }); } }
    for (const sd of [-1, 1]) { B.box('v', 0.5, 0.5, cfg.L - 5, sd * 1.5, fy + 2.0, cfg.z0 + cfg.L / 2 + 1, '#dedad2'); } // Gepäckfächer
  }
  B.build(g, { v: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }) });
  g.userData = { seats, cfg }; return g;
}

// Pilot-Silhouette-Cockpit (zwei Piloten werden von außen gesetzt)
export function jetBridgeMesh(len) { // Tunnel entlang +x, Start bei x=0
  const g = new THREE.Group(), B = new Batch();
  B.box('v', len, 0.2, 2.4, len / 2, -0.1, 0, '#6a6e72'); B.box('v', len, 2.3, 0.12, len / 2, 1.15, -1.2, '#cfd3d6'); B.box('v', len, 2.3, 0.12, len / 2, 1.15, 1.2, '#cfd3d6'); B.box('v', len, 0.15, 2.5, len / 2, 2.35, 0, '#dfe2e5');
  B.build(g, { v: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 }) });
  return g;
}

// ---------- Weltkonstanten ----------
export const LS = {
  T: { x0: 760, x1: 850, z0: -130, z1: 130, H: 11 }, GATES: [-100, -50, 0, 50, 100], PX: 880, BR0: 850,
  RWY: { x: 1030, z0: -560, z1: 440, w: 45 }, TWY: { x: 950, w: 23 }, FBO: { x0: 780, x1: 830, z0: -325, z1: -265 }, JX: 880, JZ: [-305, -285, -265],
  SEC: { wallX: 804, laneZ: 0, trayX: 809, scanX: 817 },
};
