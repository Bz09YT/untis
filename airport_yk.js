// North Yankton: verschneite Kleinstadt mit eigenem Flugfeld (abseits der Hauptkarte).
import * as THREE from 'three';
import { makeHuman, animHuman } from './humans.js';
import { Batch, canvasTex, rnd, buildAirliner } from './airport_geo.js';
import { signTex, boardTex } from './airport_ls.js';

export const YK = { OX: 15000, gz: 0, bz: -13.5, px: 15030, T: { x0: 14940, x1: 15000, z0: -22, z1: 22, H: 7 }, taxX: 15075, cz: 110, rwyX: 15150, rwyEnd: -400, rwy: { z0: -400, z1: 300 }, arrive: { x: 14970, z: 6 }, exitFront: { x: 14925, z: 0 }, bed: { x: 14742, z: -23 } };

export function buildYankton(env) {
  const root = new THREE.Group(), sol = (a, b, c, d, h) => env.addSolid(a, b, c, d, h), out = { root, peds: [], solids: [] };
  const mats = {
    v: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    e: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    g: new THREE.MeshStandardMaterial({ color: 0xa8c8dc, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.6, depthWrite: false }),
    leaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  };
  mats.e.color.setScalar(1.5);
  // Boden
  const snowT = canvasTex(512, 512, (c, w, h) => { c.fillStyle = '#eef3f8'; c.fillRect(0, 0, w, h); for (let i = 0; i < 5000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '170,195,225'},${Math.random() * 0.25})`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); } }, true, true);
  snowT.repeat.set(120, 90);
  const gx0 = 14400, gx1 = 15300, gz0 = -520, gz1 = 520, SX = 90, SZ = 104;
  const gg = new THREE.PlaneGeometry(gx1 - gx0, gz1 - gz0, SX, SZ); gg.rotateX(-Math.PI / 2);
  const gp = gg.attributes.position;
  const nz = (x, z) => Math.sin(x * 0.011) * Math.cos(z * 0.013) * 0.6 + Math.sin(x * 0.027 + z * 0.019) * 0.3 + Math.sin(z * 0.045) * 0.15;
  for (let i = 0; i < gp.count; i++) { const wx = gp.getX(i) + (gx0 + gx1) / 2, wz = gp.getZ(i); const edge = Math.max(0, Math.max(Math.abs(wz) - 300, 14570 - wx, wx - 15250)); gp.setY(i, edge > 0 ? edge * 0.35 * (0.6 + nz(wx, wz) + 0.6) : -0.04); }
  gg.computeVertexNormals();
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: snowT, roughness: 0.95 })); ground.position.set((gx0 + gx1) / 2, 0, 0); ground.receiveShadow = true; root.add(ground);
  // Begrenzung des begehbaren Bereichs
  sol(14400, 15260, -312, -300, 30); sol(14400, 15260, 300, 312, 30); sol(14390, 14402, -310, 310, 30); sol(15258, 15270, -310, 310, 30);
  const B = new Batch(), asphalt = '#35373b';
  // Straßen
  B.box('v', 440, 0.04, 9, 14715, 0.05, 0, asphalt); B.box('v', 440, 0.05, 0.25, 14715, 0.08, 0, '#c9a227');
  B.box('v', 8, 0.04, 80, 14790, 0.05, 40, asphalt); B.box('v', 8, 0.04, 70, 14650, 0.05, -35, asphalt);
  B.box('v', 40, 0.04, 40, 14925, 0.05, 0, '#9a9ea5');
  // Flugfeld
  B.box('v', 60, 0.04, 40, 15030, 0.05, 0, '#8e9298'); B.box('v', 20, 0.04, 400, YK.taxX, 0.05, -50, asphalt); B.box('v', 70, 0.04, 20, 15110, 0.05, YK.cz, asphalt);
  B.box('v', 30, 0.05, 700, YK.rwyX, 0.06, -50, '#2f3135');
  for (let z = -380; z < 280; z += 40) B.box('v', 0.6, 0.02, 18, YK.rwyX, 0.09, z, '#ececec');
  for (let k = 0; k < 6; k++) { B.box('v', 1.6, 0.02, 14, YK.rwyX - 10 + k * 4, 0.09, 288, '#ececec'); B.box('v', 1.6, 0.02, 14, YK.rwyX - 10 + k * 4, 0.09, -388, '#ececec'); }
  for (let z = -400; z <= 300; z += 25) for (const sx of [-1, 1]) B.box('e', 0.4, 0.3, 0.4, YK.rwyX + sx * 16.5, 0.2, z, '#fff4d0');
  // Terminal
  const T = YK.T, mid = 0, tw = T.x1 - T.x0;
  B.box('v', tw + 6, 0.6, T.z1 - T.z0 + 4, (T.x0 + T.x1) / 2, T.H + 0.3, mid, '#f4f7fb'); B.box('v', tw + 6.2, 0.4, T.z1 - T.z0 + 4.2, (T.x0 + T.x1) / 2, T.H - 0.2, mid, '#5a3b22');
  B.box('v', tw, T.H, 1, (T.x0 + T.x1) / 2, T.H / 2, T.z0, '#7a5230'); B.box('v', tw, T.H, 1, (T.x0 + T.x1) / 2, T.H / 2, T.z1, '#7a5230');
  sol(T.x0, T.x1, T.z0 - 0.5, T.z0 + 0.5, T.H); sol(T.x0, T.x1, T.z1 - 0.5, T.z1 + 0.5, T.H);
  B.box('v', 0.8, T.H, 16, T.x0, T.H / 2, -14, '#7a5230'); B.box('v', 0.8, T.H, 16, T.x0, T.H / 2, 14, '#7a5230'); sol(T.x0 - 0.4, T.x0 + 0.4, T.z0, -6, T.H); sol(T.x0 - 0.4, T.x0 + 0.4, 6, T.z1, T.H);
  B.box('v', 0.8, T.H - 3, 12, T.x0, T.H - 1.5, 0, '#7a5230');
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(tw, T.z1 - T.z0), new THREE.MeshStandardMaterial({ color: 0xa88a62, roughness: 0.6 })); fl.rotation.x = -Math.PI / 2; fl.position.set((T.x0 + T.x1) / 2, 0.07, 0); root.add(fl);
  const ge = new THREE.Mesh(new THREE.PlaneGeometry(T.z1 - T.z0, T.H), mats.g); ge.rotation.y = Math.PI / 2; ge.position.set(T.x1, T.H / 2, 0); root.add(ge);
  const bz = YK.bz; sol(T.x1 - 0.2, T.x1 + 0.2, T.z0, bz - 1.3, T.H); sol(T.x1 - 0.2, T.x1 + 0.2, bz + 1.3, T.z1, T.H);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xa8c8dc, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.5, depthWrite: false })); door.position.set(T.x1, 1.3, bz); root.add(door);
  out.bridgeDoor = { m: door, s: sol(T.x1 - 0.3, T.x1 + 0.3, bz - 1.2, bz + 1.2, 4), open: 0, want: 0, z: bz };
  // Brücke
  { const len = YK.px - 2 - T.x1, ang = Math.atan2(3.3, len), lenA = Math.hypot(len, 3.3), tg = new THREE.Group(), tb = new Batch();
    tb.box('v', lenA, 0.2, 2.6, lenA / 2, -0.1, 0, '#7a7e82'); tb.box('v', lenA, 2.3, 0.14, lenA / 2, 1.15, -1.3, '#e3e6e8'); tb.box('v', lenA, 2.3, 0.14, lenA / 2, 1.15, 1.3, '#e3e6e8'); tb.box('v', lenA, 0.16, 2.8, lenA / 2, 2.35, 0, '#eef0f2');
    tb.build(tg, { v: mats.v }); tg.position.set(T.x1 + 2, 0.06, bz); tg.rotation.z = ang; root.add(tg);
    sol(T.x1, YK.px - 1.9, bz - 1.45, bz - 1.25, 8); sol(T.x1, YK.px - 1.9, bz + 1.25, bz + 1.45, 8); }
  B.box('v', 4, 1.1, 1.2, 14994, 0.6, bz + 5.5, '#5a3b22'); B.box('v', 4.2, 0.06, 1.3, 14994, 1.15, bz + 5.5, '#f2c200'); sol(14992, 14996, bz + 4.9, bz + 6.1, 1.3);
  for (const z of [-17, 17]) { B.box('v', 1.0, 0.15, 5, 14960, 0.5, z, '#3a4a66'); sol(14959.5, 14960.5, z - 2.5, z + 2.5, 1); }
  B.box('e', 4, 0.12, 4, 14970, T.H - 0.5, -10, '#fff0d0'); B.box('e', 4, 0.12, 4, 14970, T.H - 0.5, 10, '#fff0d0');
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.8), new THREE.MeshBasicMaterial({ map: signTex('YANKTON AIRFIELD', '#16324f', '#ffffff', 1024, 128), toneMapped: false })); sg.position.set(T.x0 - 0.5, T.H - 1.2, 0); sg.rotation.y = -Math.PI / 2; root.add(sg);
  const sg2 = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.2), new THREE.MeshBasicMaterial({ map: signTex('GATE G1', '#0b3d91', '#ffffff', 512, 128), toneMapped: false })); sg2.position.set(T.x1 - 0.5, 4.4, bz); sg2.rotation.y = -Math.PI / 2; root.add(sg2);
  out.board = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ map: boardTex([]), toneMapped: false })); out.board.position.set(14972, 4.5, T.z1 - 0.7); out.board.rotation.y = Math.PI; root.add(out.board);
  out.exitSpot = { x: T.x0 + 2, z: 0 };
  // Gebäude der Kleinstadt
  const house = (x, z, w, d, h, wall, roof, name, nameCol, face = 1) => {
    B.box('v', w, h, d, x, h / 2, z, wall);
    const rs = new THREE.Shape(); rs.moveTo(-w / 2 - 0.6, 0); rs.lineTo(w / 2 + 0.6, 0); rs.lineTo(0, w * 0.32); rs.closePath();
    const rg = new THREE.ExtrudeGeometry(rs, { depth: d + 1.2, bevelEnabled: false }); rg.translate(0, 0, -(d + 1.2) / 2); B.add('v', B.col(rg.translate(x, h, z), roof));
    const sn = new THREE.Shape(); sn.moveTo(-w / 2 - 0.7, 0.05); sn.lineTo(w / 2 + 0.7, 0.05); sn.lineTo(0, w * 0.32 + 0.2); sn.lineTo(0, w * 0.32 - 0.1); sn.closePath();
    sol(x - w / 2, x + w / 2, z - d / 2, z + d / 2, h + 3);
    for (let k = -1; k <= 1; k += 2) { const wz = z + face * (d / 2 + 0.02); B.box('e', 1.0, 1.1, 0.06, x + k * w * 0.27, h * 0.55, wz, '#ffcf80'); }
    B.box('v', 1.1, 2.1, 0.08, x, 1.05, z + face * (d / 2 + 0.04), '#4a2e18');
    B.box('v', w + 1.2, 0.12, 0.2, x, h + 0.1, z + face * (d / 2 + 0.7), '#ffffff');
    if (name) { const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, 8), 1.0), new THREE.MeshBasicMaterial({ map: signTex(name, nameCol || '#5a1e1e', '#ffe9c0', 512, 128), toneMapped: false })); m.position.set(x, h + 0.6, z + face * (d / 2 + 0.2)); if (face < 0) m.rotation.y = Math.PI; root.add(m); }
  };
  const wood = ['#8a5a36', '#7a4a2c', '#9a6a40', '#6e4a30'];
  house(14560, -16, 9, 8, 4.2, wood[0], '#e9eef3', null, null, 1); house(14600, -16, 8, 8, 4, wood[1], '#e9eef3', null, null, 1);
  house(14640, -16, 12, 9, 4.6, '#a33a2a', '#e9eef3', 'YANKTON DINER', '#a33a2a', 1);
  house(14690, -16, 11, 9, 4.6, '#3c5a7a', '#e9eef3', 'TRADING POST', '#24415f', 1);
  house(14560, 16, 9, 8, 4.2, wood[2], '#e9eef3', null, null, -1); house(14600, 16, 10, 8, 4.2, wood[3], '#e9eef3', null, null, -1);
  house(14640, 16, 9, 8, 4.2, wood[0], '#e9eef3', null, null, -1); house(14500, -16, 9, 8, 4.2, wood[2], '#e9eef3', null, null, 1); house(14500, 16, 9, 8, 4.2, wood[1], '#e9eef3', null, null, -1);
  house(14690, 18, 12, 10, 4.8, '#c9b48a', '#e9eef3', 'GAS & GO', '#a35a1a', -1);
  // Kirche
  house(14850, 22, 11, 16, 6, '#d8d2c4', '#e9eef3', null, null, -1); B.box('v', 3.4, 12, 3.4, 14850, 6, 31, '#d8d2c4'); B.box('v', 4, 0.6, 4, 14850, 12.3, 31, '#e9eef3'); B.box('v', 0.3, 3, 0.3, 14850, 14.2, 31, '#e9eef3'); B.box('v', 1.6, 0.3, 0.3, 14850, 14.5, 31, '#e9eef3');
  sol(14848.3, 14851.7, 29.3, 32.7, 14);
  // Lodge mit Bett (begehbar)
  { const lx = 14742, lz = -27, w = 14, d = 11, h = 4.4;
    B.box('v', w, h, 0.6, lx, h / 2, lz - d / 2, '#7a4a2c'); B.box('v', 0.6, h, d, lx - w / 2, h / 2, lz, '#7a4a2c'); B.box('v', 0.6, h, d, lx + w / 2, h / 2, lz, '#7a4a2c');
    B.box('v', w / 2 - 1, h, 0.6, lx - w / 4 - 0.5, h / 2, lz + d / 2, '#7a4a2c'); B.box('v', w / 2 - 1, h, 0.6, lx + w / 4 + 0.5, h / 2, lz + d / 2, '#7a4a2c'); B.box('v', 2, h - 2.4, 0.6, lx, 2.4 + (h - 2.4) / 2, lz + d / 2, '#7a4a2c');
    B.box('v', w + 1.2, 0.5, d + 1.2, lx, h + 0.25, lz, '#e9eef3'); B.box('v', w, 0.2, d, lx, 0.1, lz, '#a07850');
    sol(lx - w / 2, lx + w / 2, lz - d / 2 - 0.3, lz - d / 2 + 0.3, 6); sol(lx - w / 2 - 0.3, lx - w / 2 + 0.3, lz - d / 2, lz + d / 2, 6); sol(lx + w / 2 - 0.3, lx + w / 2 + 0.3, lz - d / 2, lz + d / 2, 6);
    sol(lx - w / 2, lx - 1, lz + d / 2 - 0.3, lz + d / 2 + 0.3, 6); sol(lx + 1, lx + w / 2, lz + d / 2 - 0.3, lz + d / 2 + 0.3, 6);
    B.box('v', 2.2, 0.5, 3.2, lx + 4, 0.5, lz - 2.5, '#a33a2a'); B.box('v', 2.2, 0.9, 0.2, lx + 4, 0.9, lz - 4.0, '#6a2218'); B.box('v', 0.8, 0.2, 0.6, lx + 4, 0.82, lz - 3.5, '#f4f4f4'); B.box('e', 1.2, 0.1, 1.2, lx, h - 0.4, lz, '#fff0d0');
    B.box('e', 1.4, 1.1, 0.08, lx - w / 2 + 0.4, 1.0, lz - 2, '#ffcf80');
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.0), new THREE.MeshBasicMaterial({ map: signTex('YANKTON LODGE', '#2a1d12', '#ffe9c0', 512, 96), toneMapped: false })); m.position.set(lx, h + 1.0, lz + d / 2 + 0.4); root.add(m); }
  // Lampen & Schneemänner & Feuer
  for (let x = 14480; x <= 14920; x += 36) for (const sz of [-6, 6]) { B.box('v', 0.15, 4.4, 0.15, x, 2.2, sz, '#2a2d31'); B.box('e', 0.5, 0.3, 0.5, x, 4.5, sz, '#ffe0a0'); }
  for (const [x, z] of [[14610, 7], [14760, 10]]) { B.box('v', 1.4, 1.4, 1.4, x, 0.7, z, '#f4f8ff'); B.box('v', 1.0, 1.0, 1.0, x, 1.9, z, '#f4f8ff'); B.box('v', 0.7, 0.7, 0.7, x, 2.75, z, '#f4f8ff'); B.box('v', 0.12, 0.12, 0.5, x, 2.75, z + 0.4, '#e8761a'); }
  B.box('v', 1.6, 0.4, 1.6, 14735, 0.2, 9, '#3a2a1c'); B.box('e', 1.0, 0.9, 1.0, 14735, 0.8, 9, '#ff8a2a');
  // Kleinflugzeug-Hangar
  B.box('v', 20, 7, 0.6, 14900, 3.5, -90, '#8a5a36'); B.box('v', 0.6, 7, 14, 14890, 3.5, -83, '#8a5a36'); B.box('v', 0.6, 7, 14, 14910, 3.5, -83, '#8a5a36'); B.box('v', 21, 0.5, 15, 14900, 7.2, -83, '#e9eef3');
  sol(14890, 14910, -90.3, -89.7, 8); sol(14889.7, 14890.3, -90, -76, 8); sol(14909.7, 14910.3, -90, -76, 8);
  B.build(root, mats, true);
  // Bäume (Kiefern)
  { const tb = new Batch(), cone = (x, z, s) => { const g = new THREE.ConeGeometry(2.2 * s, 4.2 * s, 7); g.translate(x, 2.6 * s + 1, z); tb.add('l', tb.col(g, '#2a4a35')); const g2 = new THREE.ConeGeometry(1.6 * s, 3.2 * s, 7); g2.translate(x, 5 * s + 1, z); tb.add('l', tb.col(g2, '#305a40')); const g3 = new THREE.ConeGeometry(2.0 * s, 1.0 * s, 7); g3.translate(x, 3.0 * s + 1.5, z); tb.add('l', tb.col(g3, '#eaf0f6')); tb.box('l', 0.5, 2, 0.5, x, 1, z, '#4a3322'); };
    for (let i = 0; i < 420; i++) { const x = rnd(14420, 15250), z = rnd(-300, 300); if (Math.abs(z) < 14 && x < 14930) continue; if (x > 14920 && x < 15200 && Math.abs(z) < 140) continue; if (Math.abs(x - 14742) < 12 && z < 0 && z > -40) continue; if (x > 14530 && x < 14720 && Math.abs(z) < 28) continue; if (Math.abs(x - 14850) < 10 && z > 5 && z < 40) continue; if (Math.abs(x - 14790) < 8 && z > 0 && z < 80) continue; if (Math.abs(x - 14650) < 8 && z < 0 && z > -70) continue; if (x > 14880 && x < 14920 && z < -70 && z > -100) continue; cone(x, z, rnd(0.9, 1.7)); }
    for (let i = 0; i < 260; i++) { const a = rnd(0, 6.28), r = rnd(310, 520), x = 14780 + Math.cos(a) * r * 1.2, z = Math.sin(a) * r; if (x < 14400 || x > 15290) continue; cone(x, z, rnd(1.6, 3)); }
    const m = tb.build(root, { l: mats.leaf }, true); }
  // Berge am Horizont
  { const mb = new Batch(); for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2, r = rnd(780, 900), h = rnd(160, 360), g = new THREE.ConeGeometry(rnd(130, 220), h, 6); g.translate(14780 + Math.cos(a) * r * 1.25, h / 2 - 8, Math.sin(a) * r); mb.add('l', mb.col(g, i % 3 ? '#cfd8e2' : '#aab6c4')); }
    const mm = mb.build(root, { l: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }) }); }
  // Spaziergänger
  const coats = [['#8a2a2a', '#2b3a55'], ['#2a5a8a', '#3a3a3a'], ['#d8a02a', '#2b2b2b'], ['#3a3f45', '#4a3a2a'], ['#e8e8e8', '#2a2f44'], ['#2a6a4a', '#333']];
  coats.forEach(([s, p], i) => {
    const h = makeHuman({ gender: i % 3 === 1 ? 'f' : 'm', tint: '#e6e0f0', skin: '#e8c4aa', shirt: s, pants: p, shoes: '#222', hair: '#5a4632', beard: 0.3, hairStyle: 'buzz', hat: i % 2 ? '#4a3a2a' : null });
    h.group.position.set(14600 + i * 30, 0, rnd(-3, 3)); root.add(h.group);
    out.peds.push({ h, x: 14600 + i * 30, z: rnd(-3, 3), tx: 14500 + Math.random() * 400, tz: rnd(-3, 3), wait: Math.random() * 3 });
  });
  // Schneefall
  const N = 1400, sp = new Float32Array(N * 3); for (let i = 0; i < N; i++) { sp[i * 3] = rnd(-40, 40); sp[i * 3 + 1] = rnd(0, 30); sp[i * 3 + 2] = rnd(-40, 40); }
  const sg3 = new THREE.BufferGeometry(); sg3.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  out.snow = new THREE.Points(sg3, new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.9, depthWrite: false })); out.snow.frustumCulled = false; root.add(out.snow);
  out.snowPos = sp;
  // Flugzeug-Platz: Lichter der Rollbahn
  return out;
}

export function updateYankton(Y, dt, cam, player) {
  const sp = Y.snowPos, cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
  for (let i = 0; i < sp.length; i += 3) {
    sp[i + 1] -= dt * 1.6; sp[i] += dt * 0.5 * Math.sin(i + performance.now() / 1500);
    if (sp[i + 1] < -2) sp[i + 1] += 32;
  }
  Y.snow.position.set(cx, cy - 6, cz); Y.snow.geometry.attributes.position.needsUpdate = true;
  for (const p of Y.peds) {
    const dd = Math.hypot(p.x - player.x, p.z - player.z); p.h.group.visible = dd < 70; p.h.lod = dd > 40 ? 3 : dd > 20 ? 2 : 1;
    if (p.wait > 0) { p.wait -= dt; animHuman(p.h, 0, dt, false, 'stand'); continue; }
    const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
    if (d < 1) { p.tx = 14480 + Math.random() * 440; p.tz = rnd(-3.5, 3.5); p.wait = rnd(2, 8); continue; }
    p.x += dx / d * 1.3 * dt; p.z += dz / d * 1.3 * dt; p.h.group.position.set(p.x, 0, p.z); p.h.group.rotation.y = Math.atan2(dx, dz);
    animHuman(p.h, 1.3, dt, false, null);
  }
}
