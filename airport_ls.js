// Los Santos International (LSIA): Rollfeld, Terminal, Sicherheitskontrolle, Gates, Flugsteige, Tower, FBO.
import * as THREE from 'three';
import { Batch, canvasTex, rnd, buildAirliner, buildBizjet, buildCabin, LS, AIRLINER, BIZJET } from './airport_geo.js';

const T = LS.T;
export const GATE_NAMES = LS.GATES.map((z, i) => 'A' + (i + 1));

function tex(w, h, draw, rep) { const t = canvasTex(w, h, draw, true, true); if (rep) t.repeat.set(rep[0], rep[1]); return t; }
export function signTex(lines, bg, fg, w = 1024, h = 256, sub) {
  return canvasTex(w, h, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `bold ${h * (sub ? 0.46 : 0.6)}px Arial, sans-serif`; c.fillText(lines, w / 2, sub ? h * 0.38 : h / 2);
    if (sub) { c.font = `${h * 0.22}px Arial, sans-serif`; c.fillStyle = fg; c.fillText(sub, w / 2, h * 0.78); }
  });
}
function quad(parent, mat, w, d, x, y, z, ry = 0, vertical = false) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat); if (vertical) m.rotation.y = ry; else { m.rotation.x = -Math.PI / 2; m.rotation.z = ry; }
  m.position.set(x, y, z); m.receiveShadow = true; parent.add(m); return m;
}
export function boardTex(rows, w = 1024, h = 512) { // Abflugtafel
  return canvasTex(w, h, (c) => {
    c.fillStyle = '#05080d'; c.fillRect(0, 0, w, h); c.fillStyle = '#0d1a2e'; c.fillRect(0, 0, w, h * 0.12);
    c.font = `bold ${h * 0.065}px Courier New, monospace`; c.fillStyle = '#ffd23a'; c.textBaseline = 'middle';
    c.fillText('ABFLUG · DEPARTURES', 20, h * 0.06); c.textAlign = 'right'; c.fillText('LSIA', w - 20, h * 0.06); c.textAlign = 'left';
    const cols = [20, 150, 520, 700, 840];
    c.fillStyle = '#7d8aa0'; c.font = `${h * 0.04}px Courier New, monospace`;
    ['FLUG', 'ZIEL', 'ZEIT', 'GATE', 'STATUS'].forEach((t, i) => c.fillText(t, cols[i], h * 0.16));
    rows.forEach((r, i) => {
      const y = h * 0.23 + i * h * 0.095, hi = r.hi;
      if (hi) { c.fillStyle = 'rgba(255,210,58,.16)'; c.fillRect(8, y - h * 0.045, w - 16, h * 0.09); }
      c.fillStyle = hi ? '#ffd23a' : '#e8edf5'; c.font = `bold ${h * 0.058}px Courier New, monospace`;
      [r.f, r.d, r.t, r.g, r.s].forEach((t, k) => { c.fillStyle = k === 4 ? (r.sc || (hi ? '#7fe08a' : '#9fb4cc')) : (hi ? '#ffd23a' : '#e8edf5'); c.fillText(t, cols[k], y); });
    });
  });
}

export function buildLS(env) {
  const { TEX } = env, root = new THREE.Group(), out = { root, interior: new THREE.Group(), solids: [], boards: [], npcSpots: {}, bridges: [], doors: {} };
  root.add(out.interior);
  const sol = (a, b, c, d, h, y0) => { const s = env.addSolid(a, b, c, d, h, y0); out.solids.push(s); return s; };
  out.sol = sol;
  const mats = {
    v: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }),
    m: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 }),
    e: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    g: new THREE.MeshStandardMaterial({ color: 0xa8c8dc, transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.6, depthWrite: false }),
  };
  mats.e.color.setScalar(1.6);
  // ---------- Beläge ----------
  const asph = TEX.asphalt.clone(); asph.needsUpdate = true;
  const conc = tex(512, 512, (c, w, h) => { c.fillStyle = '#a9a8a2'; c.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.07})`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); } c.strokeStyle = 'rgba(0,0,0,.28)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h); c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke(); });
  const mAsph = (rx, rz) => { const t = asph.clone(); t.needsUpdate = true; t.repeat.set(rx, rz); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); };
  const mConc = (rx, rz) => { const t = conc.clone(); t.needsUpdate = true; t.repeat.set(rx, rz); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); };
  const flat = (mat, x0, x1, z0, z1, y) => quad(root, mat, x1 - x0, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2);
  flat(mAsph(80, 2), 540, 740, -8, 8, 0.03);                       // Zufahrt
  flat(mAsph(2, 70), 722, 740, -350, 150, 0.035);                  // Vorfahrt
  flat(mAsph(10, 2), 740, 782, -300, -286, 0.036);                 // FBO-Zufahrt
  flat(mConc(30, 100), 740, 760, -140, 140, 0.05);                 // Vorplatz
  flat(mConc(50, 200), 850, 938, -345, 145, 0.04);                 // Vorfeld
  flat(mAsph(6, 100), 938, 962, -545, 425, 0.045);                 // Rollweg A
  flat(mAsph(20, 6), 962, 1007, 168, 192, 0.045);                  // Rollweg B2
  flat(mAsph(20, 6), 962, 1007, -412, -388, 0.045);                // Rollweg B1
  flat(mAsph(20, 12), 780, 850, 145, 300, 0.04);                   // Hangar-Vorfeld
  // Start-/Landebahn mit Markierungen
  const R = LS.RWY, rl = R.z1 - R.z0;
  const rwy = tex(512, 4096, (c, w, h) => {
    c.fillStyle = '#3d3f43'; c.fillRect(0, 0, w, h); for (let i = 0; i < 60000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.1})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(w * 0.3 + Math.random() * w * 0.4, Math.random() * h, 40, 160 + Math.random() * 300); } // Gummispuren
    c.fillStyle = '#e8e8e8'; c.fillRect(6, 0, 7, h); c.fillRect(w - 13, 0, 7, h);
    for (let y = 300; y < h - 300; y += 100) c.fillRect(w / 2 - 4, y, 8, 52);
    for (const e of [0, 1]) { const y0 = e ? h - 10 : 10; for (let k = 0; k < 8; k++) c.fillRect(30 + k * 58, e ? y0 - 130 : y0, 28, 130); }
    for (const [yy, s] of [[360, 1], [h - 460, 1]]) for (const k of [-1, 1]) { c.fillRect(w / 2 + k * 90 - 14, yy, 28, 100); c.fillRect(w / 2 + k * 150 - 10, yy + 140, 20, 80); }
    c.fillStyle = '#e8e8e8'; c.font = 'bold 120px Arial'; c.textAlign = 'center';
    c.save(); c.translate(w / 2, 220); c.fillText('36', 0, 0); c.restore(); c.save(); c.translate(w / 2, h - 220); c.rotate(Math.PI); c.fillText('18', 0, 0); c.restore();
  });
  rwy.wrapS = rwy.wrapT = THREE.ClampToEdgeWrapping;
  const rmat = new THREE.MeshStandardMaterial({ map: rwy, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  quad(root, new THREE.MeshStandardMaterial({ map: mAsph(1, 1).map, roughness: 0.95 }), R.w + 24, rl + 30, R.x, 0.032, (R.z0 + R.z1) / 2).material.map.repeat.set(5, 100);
  const rm = quad(root, rmat, R.w, rl, R.x, 0.05, (R.z0 + R.z1) / 2, Math.PI / 2 * 0); rm.rotation.z = 0; rm.geometry.dispose(); rm.geometry = new THREE.PlaneGeometry(R.w, rl);
  // Rollweg-Mittellinien (gelb) & Haltebalken
  const B = new Batch();
  B.box('v', 0.35, 0.02, 960, LS.TWY.x, 0.07, -60, '#e8c21a'); B.box('v', 46, 0.02, 0.35, 985, 0.07, 180, '#e8c21a'); B.box('v', 46, 0.02, 0.35, 985, 0.07, -400, '#e8c21a');
  for (const z of [158, -378]) for (const dx of [0, 1.2]) B.box('v', 23, 0.02, 0.3, 950, 0.07, z + dx, '#e8c21a');
  // Randfeuer (Piste weiß, Rollweg blau) als Emissiv-Boxen
  for (let z = R.z0; z <= R.z1; z += 30) for (const sx of [-1, 1]) B.box('e', 0.5, 0.35, 0.5, R.x + sx * (R.w / 2 + 1.5), 0.2, z, '#fff4d0');
  for (let z = -540; z <= 420; z += 25) for (const sx of [-1, 1]) B.box('e', 0.3, 0.25, 0.3, LS.TWY.x + sx * 12.6, 0.15, z, '#3a7bff');
  for (let z = R.z0 - 6; z <= R.z0 + 10; z += 2.2) B.box('e', 0.5, 0.3, 0.5, R.x + (Math.floor((z - R.z0) / 2.2) % 2 ? -1 : 1) * 14, 0.2, z, '#7dff8a');
  for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) B.box('e', 0.7, 0.5, 0.7, R.x + sx * 22, 0.3, R.z1 + 20 + i * 2, i % 2 ? '#ff3a2a' : '#ffffff');
  // ---------- Terminal-Hülle ----------
  const mid = (T.z0 + T.z1) / 2, tl = T.z1 - T.z0, tw = T.x1 - T.x0, H = T.H;
  const floorTex = tex(512, 512, (c, w, h) => { c.fillStyle = '#a9a69f'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(70,70,70,.35)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h); c.strokeStyle = 'rgba(255,255,255,.4)'; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke(); for (let i = 0; i < 1800; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; c.fillRect(Math.random() * w, Math.random() * h, 4, 4); } }, [tw / 4, tl / 4]);
  const fm = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.25, metalness: 0.1 });
  quad(out.interior, fm, tw, tl, (T.x0 + T.x1) / 2, 0.06, mid);
  // Dach & Fassaden
  B.box('v', tw + 28, 0.9, tl + 6, (T.x0 + T.x1) / 2 + 1, H + 0.45, mid, '#f1f2f3');
  B.box('v', tw + 28.2, 0.35, tl + 6.2, (T.x0 + T.x1) / 2 + 1, H - 0.2, mid, '#2c3e5a');
  for (const z of [T.z0, T.z1]) { B.box('v', tw, H, 1, (T.x0 + T.x1) / 2, H / 2, z + (z < 0 ? -0.5 : 0.5), '#cfd3d8'); sol(T.x0, T.x1, z < 0 ? z - 1 : z, z < 0 ? z : z + 1, H); }
  // Westfassade (Landseite): Glas + Pfosten, Türen bei z = -6..6
  const glassW = new THREE.Mesh(new THREE.PlaneGeometry(tl, H), mats.g); glassW.rotation.y = -Math.PI / 2; glassW.position.set(T.x0, H / 2, mid); out.root.add(glassW);
  for (let z = T.z0; z <= T.z1; z += 6) B.box('m', 0.4, H, 0.4, T.x0, H / 2, z, '#2a2f36');
  B.box('m', 0.3, 0.3, tl, T.x0, 4.2, mid, '#2a2f36'); B.box('m', 0.3, 0.3, tl, T.x0, 8.2, mid, '#2a2f36');
  sol(T.x0 - 0.3, T.x0 + 0.2, T.z0, -7, H); sol(T.x0 - 0.3, T.x0 + 0.2, 7, T.z1, H);
  // Eingangs-Schiebetüren (animiert)
  out.doors.main = [];
  for (const dz of [-4.5, -1.5, 1.5, 4.5]) {
    const dm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.4, 1.4), new THREE.MeshStandardMaterial({ color: 0xa8c8dc, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.6, depthWrite: false })); dm.position.set(T.x0, 1.7, dz); out.root.add(dm); out.doors.main.push({ m: dm, z0: dz, dir: dz < 0 ? -1 : 1 });
  }
  B.box('v', 0.4, H - 3.5, 15, T.x0, 3.5 + (H - 3.5) / 2, 0, '#2c3e5a');
  // Vordach über Vorfahrt mit Stützen
  B.box('v', 18, 0.5, tl - 20, 749, 7.2, mid, '#f1f2f3');
  for (let z = T.z0 + 12; z <= T.z1 - 10; z += 24) { B.box('m', 0.7, 7.2, 0.7, 741, 3.6, z, '#cfd3d8'); sol(740.6, 741.4, z - 0.4, z + 0.4, 8); }
  // Poller vor Eingang (Autos bleiben draußen)
  for (let z = -12; z <= 12; z += 2.6) if (Math.abs(z) > 0.1 || true) { B.box('m', 0.4, 1.0, 0.4, 757.5, 0.5, z, '#8d949b'); sol(757.3, 757.7, z - 0.2, z + 0.2, 1.2); }
  // Schilder außen
  const topSign = new THREE.Mesh(new THREE.PlaneGeometry(40, 5), new THREE.MeshBasicMaterial({ map: signTex('LOS SANTOS INTERNATIONAL', '#0e2a5a', '#ffffff', 2048, 256, 'LSIA  ·  ABFLUG / DEPARTURES'), toneMapped: false }));
  topSign.rotation.y = -Math.PI / 2; topSign.position.set(T.x0 - 0.35, H - 3, 0); out.root.add(topSign);
  const topSign2 = topSign.clone(); topSign2.position.set(T.x0 - 8, 6.4, 0); topSign2.scale.set(0.55, 0.45, 1); out.root.add(topSign2);
  // Ostfassade (Luftseite): Glas, Öffnungen für Fluggastbrücken
  const bz = LS.GATES.map(g => g - 13.5);
  const glassE = new THREE.Mesh(new THREE.PlaneGeometry(tl, H), mats.g); glassE.rotation.y = Math.PI / 2; glassE.position.set(T.x1, H / 2, mid); out.root.add(glassE);
  for (let z = T.z0; z <= T.z1; z += 6) B.box('m', 0.4, H, 0.4, T.x1, H / 2, z, '#2a2f36');
  B.box('m', 0.3, 0.3, tl, T.x1, 4.2, mid, '#2a2f36');
  // Solid Ostwand mit Lücken bei Brücken (Tür wird durch Gate-Agent freigegeben)
  { let z = T.z0; for (const b of bz) { sol(T.x1 - 0.2, T.x1 + 0.2, z, b - 1.3, H); z = b + 1.3; } sol(T.x1 - 0.2, T.x1 + 0.2, z, T.z1, H); }
  // ---------- Fluggastbrücken ----------
  out.bridgeDoors = [];
  LS.GATES.forEach((g, gi) => {
    const z = g - 13.5, len = LS.PX - 2 - LS.BR0, ang = Math.atan2(3.3, len), lenA = Math.hypot(len, 3.3);
    B.box('v', 3.6, 3.4, 3.6, LS.BR0 + 1.8, 1.7, z, '#dfe2e5');
    // Rampe als geneigter Tunnel
    const tunnel = new THREE.Group(), tb = new Batch();
    tb.box('v', lenA, 0.2, 2.6, lenA / 2, -0.1, 0, '#7a7e82'); tb.box('v', lenA, 2.3, 0.14, lenA / 2, 1.15, -1.3, '#e3e6e8'); tb.box('v', lenA, 2.3, 0.14, lenA / 2, 1.15, 1.3, '#e3e6e8'); tb.box('v', lenA, 0.16, 2.8, lenA / 2, 2.35, 0, '#eef0f2');
    tb.box('e', lenA - 1, 0.04, 0.3, lenA / 2, 2.25, 0, '#fff4d8');
    tb.build(tunnel, mats); tunnel.position.set(LS.BR0 + 2, 0.06, z); tunnel.rotation.z = ang; root.add(tunnel);
    // Fensterbänder in der Brücke
    for (const sd of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(lenA - 3, 0.8), mats.g); w.position.set(lenA / 2, 1.3, sd * 1.22); w.rotation.y = sd > 0 ? 0 : Math.PI; tunnel.add(w); }
    // Stützen und Schilder
    B.box('m', 0.4, 3.4, 0.4, LS.PX - 6, 1.6, z, '#8d949b');
    sol(LS.BR0, LS.PX - 1.9, z - 1.45, z - 1.25, 8); sol(LS.BR0, LS.PX - 1.9, z + 1.25, z + 1.45, 8);
    // Gate-Tür (Schiebetür, Gate-Agent öffnet)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xa8c8dc, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.5, depthWrite: false })); door.position.set(T.x1, 1.3, z); root.add(door);
    const ds = sol(T.x1 - 0.3, T.x1 + 0.3, z - 1.2, z + 1.2, 4);
    out.bridgeDoors.push({ m: door, s: ds, z, open: 0, want: 0, gi });
    // Gate-Schild
    const gs = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), new THREE.MeshBasicMaterial({ map: signTex('GATE ' + GATE_NAMES[gi], '#0b3d91', '#ffffff', 512, 160), toneMapped: false })); gs.position.set(T.x1 - 0.5, 4.6, z); gs.rotation.y = -Math.PI / 2; out.interior.add(gs);
    const gs2 = gs.clone(); gs2.rotation.y = -Math.PI / 2; gs2.position.set(T.x1 - 0.5, 4.6, z); // (nur einmal)
  });
  // ---------- Innenausstattung: Check-in, Sitze, Läden, Säulen, Deckenlichter ----------
  const IB = new Batch();
  for (let z = T.z0 + 14; z <= T.z1 - 10; z += 18) for (const x of [775, 797]) IB.box('v', 0.8, H - 0.4, 0.8, x, (H - 0.4) / 2, z, '#e6e8ea');
  for (let z = -120; z <= 120; z += 12) for (const x of [770, 782, 794, 830, 840]) if (!(x >= 830 && Math.abs(((z + 100) % 50)) < 3)) IB.box('e', 3.2, 0.12, 1.4, x, H - 0.45, z, '#fff7e6');
  // Check-in-Inseln (Reihen von Schaltern) z = -110..-24 und 24..110 auf x=772
  const desks = [];
  for (const zc of [-96, -72, -48, 48, 72, 96]) {
    IB.box('v', 1.2, 1.05, 14, 773, 0.55, zc, '#ece8de'); IB.box('v', 0.4, 0.06, 14.2, 773.3, 1.1, zc, '#1c3f7a'); IB.box('v', 1.4, 0.08, 14.2, 772.9, 1.05, zc, '#c9c2b2');
    sol(772.3, 773.7, zc - 7, zc + 7, 1.2); desks.push(zc);
    for (let k = -5; k <= 5; k += 2.5) { IB.box('v', 0.5, 0.35, 0.4, 774, 1.3, zc + k, '#222'); IB.box('v', 0.04, 0.3, 0.5, 772.6, 1.28, zc + k, '#0a0f14'); }
    IB.box('v', 0.3, 2.4, 14, 773, 4.3, zc, '#1c3f7a'); // Hänger-Schild
  }
  // Wartebänke (Landseite)
  for (const z of [-30, -18, 18, 30]) for (const x of [786, 792]) { IB.box('v', 1.0, 0.15, 5, x, 0.5, z, '#3a4a66'); IB.box('v', 0.15, 0.6, 5, x + 0.45, 0.85, z, '#3a4a66'); IB.box('m', 0.1, 0.5, 0.1, x, 0.25, z - 2, '#222'); IB.box('m', 0.1, 0.5, 0.1, x, 0.25, z + 2, '#222'); sol(x - 0.5, x + 0.5, z - 2.5, z + 2.5, 1.0); }
  // Läden (Landseite): Kiosk Süd/Nord
  const shops = [];
  for (const [zc, name, col] of [[-30, 'KIOSK', '#e8a12a'], [30, 'CAFÉ GATE', '#5a3a22']]) {
    // Shop an der Sicherheitswand (x=796..803)
    IB.box('v', 5, 0.9, 1.0, 799, 0.45, zc + (zc < 0 ? -10 : 10), '#f4efe4'); IB.box('v', 5.4, 0.12, 1.2, 799, 0.95, zc + (zc < 0 ? -10 : 10), col);
    IB.box('v', 5.6, 3, 0.2, 799, 1.8, zc + (zc < 0 ? -12 : 12), col);
    sol(796.5, 801.5, zc + (zc < 0 ? -10.6 : 9.4), zc + (zc < 0 ? -9.4 : 10.6), 1.2);
    shops.push({ x: 799, z: zc + (zc < 0 ? -9 : 9), name });
  }
  out.shops = shops;
  // Sicherheitswand (x=804..806) mit Spur z in [-3,3], Nebenspuren dekorativ
  const wallSeg = (z0, z1) => { IB.box('v', 2, H, z1 - z0, 805, H / 2, (z0 + z1) / 2, '#d6d9dd'); sol(804, 806, z0, z1, H); };
  wallSeg(T.z0, -3.2); wallSeg(3.2, T.z1);
  // Nebenspuren (dekorativ, mit Förderbändern und Scannerbögen) bei z=-8 (gesperrt) und z=+8
  wallSeg(-13 + 0, -13); // no-op
  for (const lz of [-8, 8]) {
    IB.box('m', 6, 0.25, 0.9, 812, 0.85, lz - 1.9, '#2a2d31'); IB.box('v', 3, 1.6, 1.4, 816, 0.8, lz - 1.9, '#2c3e5a'); IB.box('m', 4, 0.25, 0.9, 822, 0.85, lz - 1.9, '#2a2d31');
    IB.box('v', 0.12, 2.3, 0.12, 817, 1.15, lz + 0.8, '#cfd3d8'); IB.box('v', 0.12, 2.3, 0.12, 817, 1.15, lz - 0.8 + 2.3, '#cfd3d8'); IB.box('v', 0.12, 0.12, 2.6, 817, 2.3, lz + 0.8 + 0.8, '#cfd3d8');
  }
  // Spur-Wände der Hauptspur
  for (const sd of [-1, 1]) { IB.box('v', 36, 1.0, 0.3, 808, 0.5, sd * 3.2, '#cdd2d8'); IB.box('v', 36, 0.6, 0.05, 808, 1.3, sd * 3.2, '#9fb7c9'); sol(790, 826, sd * 3.2 - 0.15, sd * 3.2 + 0.15, 1.4); }
  // Absperr-Schranken (Einlass 1: Ticketkontrolle, 2: vor Scanner, 3: Ausgang)
  const barrier = (x, label) => { const mk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 6.2), new THREE.MeshStandardMaterial({ color: 0xff3b2a, transparent: true, opacity: 0.55, emissive: 0xff2a1a, emissiveIntensity: 0.6 })); mk.position.set(x, 0.62, 0); out.interior.add(mk); const s = sol(x - 0.15, x + 0.15, -3.2, 3.2, 1.6); return { m: mk, s, x }; };
  out.barr = [barrier(802.4), barrier(812.4), barrier(826.4)];
  // Warteschlangen-Pfosten
  for (let x = 790; x <= 800; x += 2.5) for (const z of [-3.0, 3.0]) IB.box('m', 0.08, 0.95, 0.08, x, 0.48, z, '#222');
  // Ticket-Pult & Gepäck-Tisch & Scannerbogen & Förderband (Hauptspur)
  IB.box('v', 0.7, 1.2, 1.2, 800.8, 0.6, 1.9, '#2c3e5a'); IB.box('v', 0.5, 0.06, 0.9, 800.7, 1.23, 1.9, '#f2c200');
  IB.box('v', 3.6, 0.85, 0.9, 809, 0.43, -2.35, '#b8bec6'); // Ablagetisch
  for (let i = 0; i < 4; i++) IB.box('v', 0.5, 0.05, 0.38, 807.8 + i * 0.5, 0.88, -2.35, '#3a7bff');
  IB.box('m', 8.6, 0.25, 1.0, 819.4, 0.82, -2.0, '#2a2d31'); // Band nach Röntgentunnel (Teil 1)
  IB.box('v', 5, 1.9, 1.5, 816, 1.0, -2.0, '#2c3e5a'); // Röntgentunnel
  IB.box('e', 0.05, 0.4, 0.7, 813.45, 1.0, -2.0, '#0a0f14');
  IB.box('m', 8, 0.25, 1.0, 822.6, 0.82, -2.0, '#2a2d31');
  IB.box('v', 3.6, 0.85, 1.0, 825.6, 0.43, -2.35, '#b8bec6');
  // Metalldetektor-Torbogen auf der Spur
  const arch = new THREE.Group(); const ab = new Batch();
  ab.box('v', 0.4, 2.3, 0.3, 0, 1.15, -1.0, '#e8ebee'); ab.box('v', 0.4, 2.3, 0.3, 0, 1.15, 1.0, '#e8ebee'); ab.box('v', 0.4, 0.35, 2.3, 0, 2.3, 0, '#e8ebee');
  ab.build(arch, mats); arch.position.set(LS.SEC.scanX, 0.06, 0); out.interior.add(arch);
  out.scanLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 1.4), new THREE.MeshBasicMaterial({ color: 0x33ff66, toneMapped: false })); out.scanLight.position.set(LS.SEC.scanX - 0.22, 2.3, 0); out.interior.add(out.scanLight);
  // Tray-Meshes
  out.tray = new THREE.Group(); { const tb = new Batch(); tb.box('v', 0.7, 0.05, 0.45, 0, 0, 0, '#3a7bff'); tb.box('v', 0.7, 0.12, 0.04, 0, 0.06, 0.2, '#3a7bff'); tb.box('v', 0.7, 0.12, 0.04, 0, 0.06, -0.2, '#3a7bff'); tb.box('v', 0.5, 0.22, 0.3, 0, 0.17, 0, '#d89a3a'); tb.box('v', 0.3, 0.04, 0.2, 0, 0.3, 0, '#8a5a1a'); tb.build(out.tray, mats); }
  out.tray.visible = false; out.interior.add(out.tray);
  // Abfertigungsbereich Gate-Hall (Luftseite): Sitzreihen, Duty Free, Gate-Pulte
  LS.GATES.forEach((g, gi) => {
    const zb = g - 13.5;
    IB.box('v', 1.0, 1.1, 3.6, 845, 0.55, zb + 5.5, '#2c3e5a'); IB.box('v', 1.2, 0.06, 3.8, 845, 1.13, zb + 5.5, '#f2c200'); sol(844.4, 845.6, zb + 3.6, zb + 7.4, 1.3);
    IB.box('e', 0.1, 0.6, 3, 845, 1.7, zb + 5.5, '#2f6bff');
    for (const dz of [14, 20]) for (const x of [833, 838]) { IB.box('v', 1.0, 0.15, 5.4, x, 0.5, g + dz - 14, '#3a4a66'); IB.box('v', 0.15, 0.6, 5.4, x + 0.45 * (x < 836 ? -1 : 1), 0.85, g + dz - 14, '#3a4a66'); sol(x - 0.5, x + 0.5, g + dz - 14 - 2.7, g + dz - 14 + 2.7, 1.0); }
    const gb = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshBasicMaterial({ map: boardTex([], 256, 80), toneMapped: false })); gb.visible = false;
    out.npcSpots['agent' + gi] = { x: 846.4, z: zb + 5.5, yaw: -Math.PI / 2 };
  });
  // Ausgang (zurück zur Landseite) am Nordende der Luftseite
  IB.box('v', 0.3, 3, 3, 849, 1.5, T.z0 + 6, '#2c3e5a');
  out.exitDoor = { x: 836, z: T.z0 + 6 };
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: signTex('AUSGANG →', '#0a7a3a', '#ffffff', 512, 128), toneMapped: false })); exitSign.position.set(836, 3.2, T.z0 + 1); exitSign.rotation.y = 0; out.interior.add(exitSign);
  // Anzeigetafeln (Landseite: große Wand-Boards; Luftseite am Gate)
  const mkBoard = (x, y, z, ry, sc = 1) => { const t = boardTex([]); const m = new THREE.Mesh(new THREE.PlaneGeometry(9 * sc, 4.5 * sc), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })); m.position.set(x, y, z); m.rotation.y = ry; out.interior.add(m); out.boards.push(m); return m; };
  mkBoard(803.4, 6.2, -20, -Math.PI / 2 + Math.PI, 1.0).rotation.y = -Math.PI / 2; mkBoard(803.4, 6.2, 20, -Math.PI / 2, 1.0);
  mkBoard(803.4, 6.2, -70, -Math.PI / 2, 1.0); mkBoard(803.4, 6.2, 70, -Math.PI / 2, 1.0);
  mkBoard(828, 6.4, 0, Math.PI / 2, 1.1); // gegenüber der Sicherheit (Luftseite, schaut nach Osten)
  // "Sicherheit / Security" Schild
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.4), new THREE.MeshBasicMaterial({ map: signTex('SICHERHEITSKONTROLLE', '#222a36', '#ffd23a', 1024, 240, 'SECURITY CHECK · Ticket bereithalten'), toneMapped: false })); sc.position.set(803.2, 3.9, 0); sc.rotation.y = -Math.PI / 2; out.interior.add(sc);
  // Info-Schalter in der Mitte
  IB.box('v', 3, 1.0, 3, 783, 0.5, 0, '#ece8de'); IB.box('v', 3.2, 0.08, 3.2, 783, 1.03, 0, '#f2c200'); sol(781.4, 784.6, -1.6, 1.6, 1.2);
  out.npcSpots.info = { x: 783, z: -0.2, yaw: -Math.PI / 2 };
  out.npcSpots.guard = { x: 801.8, z: 2.6, yaw: Math.PI };
  out.npcSpots.guard2 = { x: 810, z: 2.4, yaw: -Math.PI / 2 };
  out.npcSpots.fbo = { x: 800.4, z: -295, yaw: -Math.PI / 2 };
  IB.build(out.interior, mats);
  B.build(root, mats, true);
  // ---------- Tower ----------
  { const tb = new Batch(); tb.box('v', 5, 36, 5, 830, 18, 175, '#d9dcdf'); tb.box('v', 11, 1.2, 11, 830, 37, 175, '#8d949b'); tb.box('v', 10, 4, 10, 830, 39.6, 175, '#223142'); tb.box('v', 11.5, 0.8, 11.5, 830, 42, 175, '#e8ebee'); tb.box('m', 0.3, 6, 0.3, 830, 45, 175, '#8d949b'); tb.box('e', 0.6, 0.6, 0.6, 830, 48.3, 175, '#ff3a2a');
    tb.build(root, mats, true); sol(827.5, 832.5, 172.5, 177.5, 40); }
  // ---------- Hangar ----------
  { const hb = new Batch(); hb.box('v', 46, 12, 0.8, 830, 6, 285, '#b9bec4'); hb.box('v', 0.8, 12, 30, 807, 6, 270, '#b9bec4'); hb.box('v', 0.8, 12, 30, 853, 6, 270, '#b9bec4'); hb.box('v', 46, 0.8, 30, 830, 12.2, 270, '#9aa0a6'); hb.box('v', 30, 9, 0.2, 830, 4.5, 254.8, '#4a5560');
    hb.build(root, mats, true); sol(807, 853, 284.6, 285.4, 12); sol(806.6, 807.4, 255, 285, 12); sol(852.6, 853.4, 255, 285, 12); }
  // ---------- Parkplatz (statische Autos) ----------
  { const pb = new Batch(), cs = ['#b8b8b8', '#1c1c1c', '#f2f2f2', '#7d0f12', '#123d6b', '#2f5233', '#c9a227', '#5c5f63'];
    for (let r = 0; r < 4; r++) for (let i = 0; i < 12; i++) { if (Math.random() < 0.3) continue; const x = 600 + i * 5.2, z = 30 + r * 7.5, c = cs[(i * 3 + r) % cs.length]; pb.box('v', 1.9, 0.7, 4.3, x, 0.55, z, c); pb.box('v', 1.6, 0.55, 2.2, x, 1.15, z + 0.2, '#1b2430'); pb.box('v', 1.7, 0.1, 1.4, x, 1.45, z + 0.2, c); }
    for (let r = 0; r <= 4; r++) pb.box('v', 62, 0.02, 0.15, 628, 0.07, 26 + r * 7.5, '#e8e8e8');
    pb.box('v', 70, 0.02, 40, 628, 0.045, 46, '#4a4c50');
    pb.build(root, mats, true); }
  // ---------- Private Terminal (FBO) ----------
  const F = LS.FBO, fb = new Batch(), fi = new Batch();
  const fx = (F.x0 + F.x1) / 2, fz = (F.z0 + F.z1) / 2, fw = F.x1 - F.x0, fd = F.z1 - F.z0;
  fb.box('v', fw + 4, 0.7, fd + 4, fx, 5.6, fz, '#2a2d31'); fb.box('v', fw, 0.2, fd, fx, 0.1, fz, '#c8bfae');
  fb.box('v', 0.6, 5.2, fd, F.x0, 2.6, fz, '#bfae92'); // Westwand (Holz/Stein)
  fb.box('v', 0.6, 5.2, 6, F.x1, 2.6, F.z0 + 3, '#bfae92'); fb.box('v', 0.6, 5.2, 6, F.x1, 2.6, F.z1 - 3, '#bfae92');
  fb.box('v', fw, 5.2, 0.6, fx, 2.6, F.z0, '#bfae92'); fb.box('v', fw, 5.2, 0.6, fx, 2.6, F.z1, '#bfae92');
  for (const [a, b] of [[F.x0 - 0.3, F.x0 + 0.3, F.z0, F.z1]]) { /* Westwand mit Eingang bei z=-295..-292 */ }
  sol(F.x0 - 0.3, F.x0 + 0.3, F.z0, -298, 6); sol(F.x0 - 0.3, F.x0 + 0.3, -292, F.z1, 6);
  sol(F.x1 - 0.3, F.x1 + 0.3, F.z0, F.z0 + 6, 6); sol(F.x1 - 0.3, F.x1 + 0.3, F.z1 - 6, F.z1, 6);
  sol(F.x0, F.x1, F.z0 - 0.3, F.z0 + 0.3, 6); sol(F.x0, F.x1, F.z1 - 0.3, F.z1 + 0.3, 6);
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(F.z1 - F.z0 - 12, 5), mats.g); fg.rotation.y = Math.PI / 2; fg.position.set(F.x1, 2.6, fz); root.add(fg);
  // Tür zur Rampe (Ostseite, z=-287..-283) mit Sperre
  const fdoor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 5), new THREE.MeshStandardMaterial({ color: 0xa8c8dc, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.5, depthWrite: false })); fdoor.position.set(F.x1, 1.3, fz); root.add(fdoor);
  out.fboDoor = { m: fdoor, s: sol(F.x1 - 0.3, F.x1 + 0.3, fz - 2.5, fz + 2.5, 4), open: 0, want: 0, z: fz };
  const fsign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshBasicMaterial({ map: signTex('LS JETS · PRIVATE TERMINAL', '#14110d', '#d9b45a', 1024, 160), toneMapped: false })); fsign.position.set(F.x0 - 0.4, 4.4, -295); fsign.rotation.y = -Math.PI / 2; root.add(fsign);
  fi.box('v', 18, 0.04, 14, fx - 4, 0.22, fz + 6, '#7a2e2e'); // Teppich
  fi.box('v', 6, 1.1, 1.2, fx + 3, 0.65, fz - 8, '#3a2a1c'); fi.box('v', 6.2, 0.1, 1.4, fx + 3, 1.25, fz - 8, '#d9b45a'); sol(F.x0 + 18.6, F.x0 + 25, fz - 8.6, fz - 7.4, 1.3); // Empfangstresen
  for (const [sx, sz, ry] of [[-6, 6, 0], [-6, 11, 0], [-14, 3, 0]]) { fi.box('v', 3, 0.5, 1.2, fx + sx, 0.5, fz + sz, '#4a2e18'); fi.box('v', 3, 0.9, 0.3, fx + sx - 0.2, 0.9, fz + sz - 0.6, '#4a2e18'); sol(fx + sx - 1.5, fx + sx + 1.5, fz + sz - 0.6, fz + sz + 0.6, 1.0); }
  fi.box('v', 4, 1.2, 0.5, fx - 6, 0.7, F.z1 - 1.2, '#2a2d31'); fi.box('e', 3.6, 0.9, 0.05, fx - 6, 0.9, F.z1 - 1.5, '#ff9a3a'); // Kamin
  fi.box('e', 6, 0.1, 6, fx, 5.15, fz, '#fff0d0'); fi.box('e', 6, 0.1, 6, fx - 10, 5.15, fz, '#fff0d0');
  out.npcSpots.fbo = { x: fx + 3, z: fz - 9.4, yaw: Math.PI };
  fi.build(out.interior, mats); fb.build(root, mats, true);
  // Bar
  // ---------- Flugzeuge ----------
  const liv = [{ name: 'LS AIR', tail: '#1a56c4' }, { name: 'SAN ANDREAS', tail: '#c4161c', stripe: '#c4161c', stripe2: '#ffd23a', text: '#c4161c' }, { name: 'LS AIR', tail: '#1a56c4' }, { name: 'PACIFIC', tail: '#0f8a5a', stripe: '#0f8a5a', stripe2: '#ffffff', text: '#0b5a3a' }, { name: 'MAZE AIR', tail: '#6b2fa0', stripe: '#6b2fa0', stripe2: '#ffffff', text: '#4a1f7a' }];
  out.statics = LS.GATES.map((g, gi) => { const p = buildAirliner({ ...liv[gi], door: false }); p.position.set(LS.PX, 0.05, g); root.add(p); return p; });
  out.plane = buildAirliner({ ...liv[0], door: true }); out.plane.position.set(LS.PX, 0.05, LS.GATES[2]); root.add(out.plane); out.statics[2].visible = false;
  out.cabin = buildCabin('liner'); out.plane.userData.body.add(out.cabin); out.cabin.position.y = 0; // Kabinenkoordinaten relativ zur Achse
  out.jets = LS.JZ.map((z, i) => { const j = buildBizjet({ door: i === 1, body: ['#f6f6f2', '#1c2430', '#e8e0d0'][i], stripe: ['#222a36', '#d9b45a', '#7a2e2e'][i], tail: ['#222a36', '#d9b45a', '#7a2e2e'][i], name: 'LS JETS' }); j.position.set(LS.JX, 0.05, z); root.add(j); return j; });
  out.jetCabin = buildCabin('jet'); out.jets[1].userData.body.add(out.jetCabin);
  return out;
}
