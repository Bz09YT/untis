// Flughafen LSIA + Privatterminal + Ziel "North Yankton": Logik (Telefon-App, Ticket, Sicherheit, Gate, Flug).
// Hooks in game.js sind mit "==== AIRPORT HOOK ====" markiert.
import * as THREE from 'three';
import { makeHuman, animHuman } from './humans.js';
import { LS, AIRLINER, BIZJET, clamp, lerp, rnd, canvasTex } from './airport_geo.js';
import { buildLS, GATE_NAMES, boardTex, signTex } from './airport_ls.js';
import { buildYankton, updateYankton, YK } from './airport_yk.js';

const noop = () => {};
export const AIR = {
  ready: false,
  terrain: (x, z, h) => { // Rollfeld einebnen (weicher Übergang)
    if (x < 440 || x > 1500) return h;
    const dx = Math.max(548 - x, 0, x - 1170), dz = Math.max(-650 - z, 0, z - 540), d = Math.hypot(dx, dz), w = 1 - clamp(d / 160, 0, 1);
    return lerp(h, -0.05, w * w * (3 - 2 * w));
  },
  floor: () => undefined, control: () => false, camera: () => false, camLimit: () => null, key: () => false, hint: () => '', update: noop, post: noop,
  phoneHTML: () => '', phoneKey: () => false, phoneOpen: noop, mini: noop, bigmap: noop, afterLoad: noop, invRows: () => [], pois: [], tick: noop,
};

const DEST = { yk: { name: 'North Yankton', code: 'NYK', eco: 480, biz: 1450, hrs: 6.5, ico: '❄️' }, ls: { name: 'Los Santos', code: 'LSA', eco: 480, biz: 1450, hrs: 6.5, ico: '🌴' } };
const JETS = [{ n: 'Light Jet · 4 Sitze', p: 6900 }, { n: 'Midsize Jet · 8 Sitze', p: 11500 }, { n: 'Heavy Jet · Lounge', p: 19000 }];
const SITE_LS = () => ({ id: 'ls', px: LS.PX, taxX: LS.TWY.x, cz: 180, rwyX: LS.RWY.x, rwyEnd: LS.RWY.z0 });
const SITE_YK = { id: 'yk', px: YK.px, taxX: YK.taxX, cz: YK.cz, rwyX: YK.rwyX, rwyEnd: YK.rwy.z0 };

export function initAirport(ctx) {
  const C = ctx, player = C.player, scene = C.scene, camera = C.camera;
  const V = new THREE.Vector3(), V2 = new THREE.Vector3();
  const S = { sec: 0, secDone: false, flight: null, lock: null, trayT: -1, trayX: 0, alarm: 0, npcs: [], doorOpen: -1, yk: null, built: false, planeGate: 2, planeAt: 'ls', msgT: 0 };
  const W = buildLS({ TEX: C.TEX, addSolid: C.addSolid });
  scene.add(W.root);
  W.cabin.userData.seatsDone = true;
  const PL = W.plane, JET = W.jets[1];
  // Fluggastbrücken-Anzeige / Anzeigetafeln
  const guardLook = { gender: 'm', skin: '#b8876a', shirt: '#1f2c44', pants: '#1a2233', shoes: '#111', hair: '#111', beard: 0.2, hairStyle: 'buzz', hat: '#1f2c44' };
  const agentLook = { gender: 'f', tint: '#d0dcf0' }, fboLook = { gender: 'm', skin: '#e0bc9c', shirt: '#14110d', pants: '#14110d', shoes: '#111', hair: '#2a1c12', beard: 0.0, hairStyle: 'slick' };
  const pilotLook = { gender: 'm', skin: '#e0bc9c', shirt: '#f4f6f8', pants: '#14213d', shoes: '#111', hair: '#4a3322', beard: 0.3, hairStyle: 'buzz', hat: '#14213d' };
  const addNpc = (look, spot, pose, root = scene, name = '') => { const h = makeHuman(look); h.group.position.set(spot.x, spot.y || 0.06, spot.z); h.group.rotation.y = spot.yaw || 0; root.add(h.group); const n = { h, x: spot.x, z: spot.z, y: spot.y || 0.06, pose, name, yaw: spot.yaw || 0 }; S.npcs.push(n); return n; };
  const guard = addNpc(guardLook, W.npcSpots.guard, 'stand', scene, 'guard'), guard2 = addNpc({ ...guardLook, gender: 'f', tint: '#9fb4d0' }, W.npcSpots.guard2, 'stand', scene, 'guard2');
  const info = addNpc(agentLook, W.npcSpots.info, 'type', scene, 'info');
  const agents = LS.GATES.map((g, i) => addNpc(agentLook, W.npcSpots['agent' + i], 'type', scene, 'agent'));
  const fboN = addNpc(fboLook, W.npcSpots.fbo, 'stand', scene, 'fbo');
  const pilot = addNpc(pilotLook, { x: LS.JX - 6, z: LS.JZ[1] - 6.5, yaw: Math.PI / 2 }, 'stand', scene, 'pilot');
  const attendant = addNpc({ gender: 'f', tint: '#ffd0d0' }, { x: LS.PX - 1.0, z: LS.GATES[2] - 12.6, y: 3.36, yaw: Math.PI / 2 }, 'stand', scene, 'att');
  // Zwei Wartende in der Sicherheitsschlange
  const pax1 = addNpc({ gender: 'm', skin: '#e0bc9c', shirt: '#2e86c1', pants: '#2b2b2b', shoes: '#fff', hair: '#2a1c12', beard: 0.5, hairStyle: 'buzz' }, { x: 795, z: -1.0, yaw: -Math.PI / 2 }, 'phone', scene, 'pax');
  const pax2 = addNpc({ gender: 'f', tint: '#ffe2d0' }, { x: 793.6, z: 0.9, yaw: -Math.PI / 2 }, 'stand', scene, 'pax');
  const paxS = addNpc({ gender: 'f', tint: '#d8f0e6' }, { x: 810, z: 8 - 1.9, yaw: Math.PI }, 'stand', scene, 'pax');
  // Cockpit-Piloten verstecken wir: Kapitänsstimme per Ansage
  // ---------- Hilfsfunktionen ----------
  const planeNow = () => PL.position;
  const siteOf = () => S.planeAt === 'yk' ? SITE_YK : SITE_LS();
  const inYK = () => player.x > 5000;
  const gateName = () => S.planeAt === 'yk' ? 'G1' : GATE_NAMES[S.planeGate];
  const now = () => { const m = Math.floor(C.getGameMin()); return [Math.floor(m / 60) % 24, m % 60]; };
  const hhmm = (add = 0) => { let m = Math.floor(C.getGameMin()) + add; m = Math.ceil(m / 5) * 5; return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
  const dist2 = (x, z, a, b) => Math.hypot(x - a, z - b);
  const say = (t, who, voice) => C.say(t, { who, voice, prio: true });
  const SEAT = () => { // Platz des Spielers im Flugzeug (Welt)
    const t = player.ticket, eco = !t || t.cls !== 1, zl = eco ? -15.8 + 3.2 + 5 * 0.82 : -15.8 + 3.2 + 1 * 0.82;
    return { x: PL.position.x - 1.56, z: PL.position.z + zl, y: PL.position.y + AIRLINER.AH + AIRLINER.FY - AIRLINER.AH + 0.0 + (AIRLINER.FY - AIRLINER.FY), zl };
  };
  const seatY = () => PL.position.y + AIRLINER.AH - 0.5;
  const JSEAT = () => ({ x: JET.position.x - 0.78, z: JET.position.z - 4.8 + 2.2 * 0, y: JET.position.y + BIZJET.AH - 0.6 });

  // ---------- Ziel North Yankton (lazy) ----------
  function ensureYK() {
    if (S.yk) return S.yk;
    S.yk = buildYankton({ addSolid: C.addSolid, makeCar: C.makeCar });
    scene.add(S.yk.root);
    S.ykBoards = S.yk.board;
    S.ykAgent = (() => { const h = makeHuman(agentLook); h.group.position.set(14995.6, 0.06, YK.bz + 5.5); h.group.rotation.y = -Math.PI / 2; scene.add(h.group); const n = { h, x: 14995.6, z: YK.bz + 5.5, y: 0.06, pose: 'type', yaw: -Math.PI / 2, name: 'agent' }; S.npcs.push(n); return n; })();
    // Autos am Straßenrand
    if (C.makeCar) { try { for (const [x, z, y, col] of [[14585, 5.5, 0, '#8a2a2a'], [14665, -5.5, Math.PI, '#2a4a6a'], [14715, 5.5, 0, '#e8e8e8']]) { const c = C.makeCar('pickup', col, x, z, Math.PI / 2, 'parked'); if (c) c.keep = true; } } catch (e) { /* optional */ } }
    return S.yk;
  }
  function placePlane(site) {
    S.planeAt = site;
    if (site === 'yk') { ensureYK(); PL.position.set(YK.px, 0.05, 0); } else PL.position.set(LS.PX, 0.05, LS.GATES[S.planeGate]);
    PL.rotation.set(0, 0, 0); for (let i = 0; i < 5; i++) W.statics[i].visible = !(site === 'ls' && i === S.planeGate);
    attendant.x = PL.position.x - 1.0; attendant.z = PL.position.z - 12.6; attendant.y = 3.36;
  }
  // ---------- Ticket / Buchung ----------
  const T = () => player.ticket;
  function bookAir(destId, cls, method) {
    if (player.ticket) { C.notice('Du hast bereits ein Ticket', 1600); return false; }
    if (C.getWanted() > 0) { C.notice('LS Air: Buchung verweigert – du wirst polizeilich gesucht', 2400); return false; }
    const d = DEST[destId], price = cls ? d.biz : d.eco;
    if (!C.pay(price, method)) return false;
    const gate = S.planeAt === 'yk' ? 'G1' : GATE_NAMES[S.planeGate];
    player.ticket = { type: 'air', from: inYK() ? 'yk' : 'ls', dest: destId, destName: d.name, code: d.code, gate, cls, price, seat: cls ? '2A' : '14A', time: hhmm(25), flight: 'LS ' + (100 + Math.floor(Math.random() * 880)), pax: C.charName(), pay: method, valid: true };
    C.sfx.ding(); C.notice(`Ticket gebucht: ${d.name} · ${C.fmt(price)}`, 2600);
    return true;
  }
  function bookJet(destId, jetIdx, method) {
    if (player.ticket) { C.notice('Du hast bereits ein Ticket', 1600); return false; }
    if (C.getWanted() > 0) { C.notice('LS Jets: Charter verweigert – du wirst gesucht', 2400); return false; }
    const j = JETS[jetIdx], d = DEST[destId];
    if (!C.pay(j.p, method)) return false;
    player.ticket = { type: 'jet', from: inYK() ? 'yk' : 'ls', dest: destId, destName: d.name, code: d.code, gate: 'FBO', cls: 2, price: j.p, seat: '1A', time: hhmm(15), flight: 'LJ ' + (10 + Math.floor(Math.random() * 89)), jet: j.n, pax: C.charName(), pay: method, valid: true };
    C.sfx.ding(); C.notice(`Jet gechartert: ${j.n} → ${d.name}`, 2600);
    return true;
  }
  const cancelTicket = () => { const t = player.ticket; if (!t) return; const back = Math.round(t.price * 0.8); if (t.pay === 'cash') player.money += back; else player.bank += back; player.ticket = null; C.sfx.coin(); C.notice(`Storniert · ${C.fmt(back)} erstattet (80 %)`, 2400); };

  // ---------- Telefon ----------
  const PH = { sel: 0, dest: 0, cls: 0, pay: 'card', jet: 0 };
  const destList = () => inYK() ? ['ls'] : ['yk'];
  const rowsAir = () => { // Reihenfolge der wählbaren Zeilen
    if (player.ticket) return ['ticket', 'nav', 'cancel', 'back'];
    return ['dest', 'cls', 'pay', 'book', 'nav', 'back'];
  };
  const rowsJet = () => inYK() ? ['back'] : player.ticket ? ['ticket', 'nav2', 'cancel', 'back'] : ['dest', 'jet', 'pay', 'book', 'nav2', 'back'];
  function passHTML(t) {
    const jet = t.type === 'jet';
    return `<div style="background:${jet ? 'linear-gradient(135deg,#2a2218,#4a3a22)' : 'linear-gradient(135deg,#0e3a7a,#1a56c4)'};border-radius:1vmin;padding:1.1vmin;margin-bottom:.8vmin;color:#fff"><div style="font-size:1.2vmin;opacity:.8">${jet ? 'LS JETS · PRIVATFLUG' : 'LS AIR · BORDKARTE'}</div><div style="font-size:2.3vmin;font-weight:700;margin:.2vmin 0">${t.from === 'yk' ? 'NYK' : 'LSA'} ✈ ${t.code}</div><div style="font-size:1.3vmin;line-height:1.45">${t.pax}<br>${t.flight} · ${jet ? t.jet : (t.cls ? 'Business' : 'Economy')}<br>${jet ? 'Terminal: FBO (privat)' : 'Gate ' + t.gate + ' · Sitz ' + t.seat}<br>Abflug ${t.time}</div><div style="margin-top:.6vmin;height:3.2vmin;background:repeating-linear-gradient(90deg,#fff 0 .25vmin,#0000 .25vmin .5vmin,#fff .5vmin .6vmin,#0000 .6vmin .95vmin);opacity:.9"></div></div>`;
  }
  const rowH = (k, i, inner) => `<div class="row${i === PH.sel ? ' sel' : ''}" style="padding:.6vmin 1vmin;font-size:1.5vmin">${inner}</div>`;
  AIR.phoneHTML = (screen) => {
    const jet = screen === 'jets', rows = jet ? rowsJet() : rowsAir(), ds = destList(), d = DEST[ds[PH.dest % ds.length]];
    let h = `<div class="ttl">${jet ? '🛩️ LS Jets' : '✈️ LS Air'}</div>`;
    if (jet && inYK()) return h + '<small class="ri">LS Jets ist nur in Los Santos verfügbar. Für den Rückflug nutze LS Air.</small>';
    if (player.ticket) h += passHTML(player.ticket);
    h += rows.map((k, i) => {
      if (k === 'ticket') return rowH(k, i, 'Ticket gültig · E: Details');
      if (k === 'dest') return rowH(k, i, `${d.ico} <b>${d.name}</b> <small>${d.hrs} h</small>`);
      if (k === 'cls') return rowH(k, i, `Klasse: <b>${PH.cls ? 'Business ' + C.fmt(d.biz) : 'Economy ' + C.fmt(d.eco)}</b>`);
      if (k === 'jet') return rowH(k, i, `<b>${JETS[PH.jet].n}</b> <small>${C.fmt(JETS[PH.jet].p)}</small>`);
      if (k === 'pay') return rowH(k, i, `Zahlung: <b>${PH.pay === 'card' ? '💳 Karte' : '💵 Bar'}</b>`);
      if (k === 'book') return rowH(k, i, `<b>${jet ? 'Jet chartern' : 'Buchen'}</b> · ${C.fmt(jet ? JETS[PH.jet].p : (PH.cls ? d.biz : d.eco))}`);
      if (k === 'nav') return rowH(k, i, '📍 Navigation Flughafen');
      if (k === 'nav2') return rowH(k, i, '📍 Navigation Privatterminal');
      if (k === 'cancel') return rowH(k, i, 'Ticket stornieren (−20 %)');
      return rowH(k, i, 'Zurück');
    }).join('');
    h += `<small class="ri">${jet ? 'Privatjet: eigener Terminal (FBO), keine Sicherheitsschlange.' : 'Mobiles Ticket: an der Sicherheitskontrolle vorzeigen, am Gate scannen lassen.'}</small>`;
    return h;
  };
  AIR.phoneOpen = (phone, app) => { PH.sel = 0; PH.dest = 0; };
  AIR.phoneKey = (phone, code) => {
    if (phone.screen !== 'air' && phone.screen !== 'jets') return false;
    const jet = phone.screen === 'jets', rows = jet ? rowsJet() : rowsAir(), n = rows.length, ds = destList();
    PH.sel = clamp(PH.sel, 0, n - 1);
    if (code === 'KeyW' || code === 'ArrowUp') PH.sel = (PH.sel - 1 + n) % n;
    else if (code === 'KeyS' || code === 'ArrowDown') PH.sel = (PH.sel + 1) % n;
    else if (code === 'Backspace' || code === 'KeyP') { phone.screen = 'home'; phone.sel = 0; return true; }
    else if (code === 'KeyE' || code === 'Enter' || code === 'KeyA' || code === 'KeyD' || code === 'ArrowLeft' || code === 'ArrowRight') {
      const k = rows[PH.sel];
      if (k === 'dest') PH.dest = (PH.dest + 1) % ds.length;
      else if (k === 'cls') PH.cls ^= 1;
      else if (k === 'jet') PH.jet = (PH.jet + (code === 'KeyA' || code === 'ArrowLeft' ? 2 : 1)) % JETS.length;
      else if (k === 'pay') PH.pay = PH.pay === 'card' ? 'cash' : 'card';
      else if (k === 'book') { if (jet ? bookJet(ds[PH.dest % ds.length], PH.jet, PH.pay) : bookAir(ds[PH.dest % ds.length], PH.cls, PH.pay)) PH.sel = 0; }
      else if (k === 'nav') { if (inYK()) C.notice('Du bist bereits in North Yankton – Flugfeld im Osten', 2000); else C.setWaypoint(722, 0); }
      else if (k === 'nav2') { if (!inYK()) C.setWaypoint(745, -292); }
      else if (k === 'cancel') cancelTicket();
      else if (k === 'back') { phone.screen = 'home'; phone.sel = 0; }
    }
    return true;
  };
  AIR.invRows = () => player.ticket ? [{ label: `${player.ticket.type === 'jet' ? '🛩️' : '🎫'} Ticket ${player.ticket.flight} → ${player.ticket.destName} · ${player.ticket.type === 'jet' ? 'FBO' : 'Gate ' + player.ticket.gate} · ${player.ticket.time}` }] : [];

  // ---------- Türen & Schranken ----------
  const slide = (d, dt) => { d.open += clamp(d.want - d.open, -dt * 1.6, dt * 1.6); d.m.position.z = d.z + d.open * 2.2; d.m.visible = d.open < 0.99; };
  const setSolid = (s, on) => { if (!s) return; if (on && s.off) { C.restoreSolid(s); s.off = false; } else if (!on && !s.off) { C.removeSolid(s); s.off = true; } };
  const barrierSet = (i, closed) => { const b = W.barr[i]; b.m.visible = closed; setSolid(b.s, closed); };
  [0, 1, 2].forEach(i => barrierSet(i, true));
  const gateOpenFor = new Set();
  W.bridgeDoors.forEach(d => { setSolid(d.s, true); });
  setSolid(W.fboDoor.s, true);
  const resetSecurity = () => { S.sec = 0; S.secDone = false; [0, 1, 2].forEach(i => barrierSet(i, true)); W.tray.visible = false; S.trayT = -1; };
  const resetGates = () => { W.bridgeDoors.forEach(d => { d.want = 0; setSolid(d.s, true); }); W.fboDoor.want = 0; setSolid(W.fboDoor.s, true); if (S.yk) { S.yk.bridgeDoor.want = 0; setSolid(S.yk.bridgeDoor.s, true); } };

  // ---------- Interaktionen ----------
  const pDist = (x, z) => Math.hypot(player.x - x, player.z - z);
  function inTerminalZone() { return player.x > 755 && player.x < 855 && Math.abs(player.z) < 135 && player.y < 2; }
  function ctxNow() { // aktuelle Interaktion bestimmen -> {hint, act}
    if (player.car || player.dead || S.flight || S.lock) return null;
    const t = T(), px = player.x, pz = player.z;
    if (!inYK()) {
      // Sicherheitspult
      if (S.sec === 0 && pDist(800.6, 1.4) < 2.6 && px > 788 && px < 803) return { hint: 'Drücke <b>E</b>: Ticket vorzeigen', act: showTicket };
      if (S.sec === 1 && px > 806 && px < 812 && Math.abs(pz) < 3.1) return { hint: 'Drücke <b>E</b>: Gepäck in die Wanne legen', act: putBag };
      if (S.sec === 2 && px > 812 && px < 826 && Math.abs(pz) < 3.1 && S.secScanned === false) return null;
      if (S.sec >= 3 && !S.secDone && pDist(824.6, -1.7) < 2.4) return { hint: S.trayX > 22.5 ? 'Drücke <b>E</b>: Gepäck nehmen' : 'Dein Gepäck kommt gleich …', act: takeBag };
      // Gate-Pult
      for (let i = 0; i < 5; i++) if (pDist(843.5, LS.GATES[i] - 13.5 + 4.5) < 3.8 && px > 826 && px < 850) return { hint: `Gate ${GATE_NAMES[i]} · Drücke <b>E</b>: Bordkarte scannen`, act: () => gateScan(i) };
      if (pDist(W.exitDoor.x, W.exitDoor.z) < 3.2) return { hint: 'Drücke <b>E</b>: Sicherheitsbereich verlassen', act: leaveAirside };
      for (const s of W.shops) if (pDist(s.x, s.z) < 2.6) return { hint: `${s.name} · Drücke <b>E</b>`, act: () => shopMenu(s) };
      if (pDist(783, 0) < 3) return { hint: 'Information · Drücke <b>E</b>', act: infoDesk };
      for (const zc of [-96, -72, -48, 48, 72, 96]) if (pDist(775, zc) < 8 && Math.abs(px - 775) < 3.4) return { hint: 'Check-in · Mobiles Ticket reicht – <b>E</b>', act: checkinDesk };
      // FBO
      if (pDist(W.npcSpots.fbo.x, W.npcSpots.fbo.z + 1.6) < 3 && px > 780 && px < 830 && Math.abs(pz + 295) < 20) return { hint: 'Concierge · Drücke <b>E</b>: Charterflug einchecken', act: fboCheckin };
      // Sitzen im Flugzeug
      if (player.y > 3 && S.planeAt === 'ls' || player.y > 3 && S.planeAt === 'yk') { const sg = SEAT(); if (Math.abs(pz - sg.z) < 1.0 && Math.abs(px - (PL.position.x - 0.35)) < 1.2) return { hint: `Drücke <b>E</b>: Platz ${t?.seat || '14A'} einnehmen`, act: sitDown }; }
      if (player.y > 1.2 && player.y < 2 && t?.type === 'jet') { const js = JSEAT(); if (Math.abs(px - (JET.position.x - 0.1)) < 1.2 && Math.abs(pz - js.z) < 1.1) return { hint: 'Drücke <b>E</b>: Platz 1A einnehmen', act: sitDownJet }; }
      if (pDist(JET.position.x - 5.2, JET.position.z - 6.3) < 3.2 && t?.type === 'jet' && W.fboDoor.open > 0.9) return { hint: 'Pilot: <b>E</b> ansprechen', act: () => say('Willkommen an Bord! Bitte nehmen Sie Platz, wir starten sofort.', 'Pilot') };
      if (pDist(PL.position.x - 3.5, PL.position.z - 12.6) < 1.5 && player.y > 3) return null;
    } else {
      const Yd = S.yk;
      if (Yd && pDist(14993.5, YK.bz + 4.2) < 3.6) return { hint: `Gate G1 · Drücke <b>E</b>: Bordkarte scannen`, act: () => gateScanYK() };
      if (Yd && pDist(YK.bed.x, YK.bed.z - 2.5) < 2.5) return { hint: 'Drücke <b>E</b>: Im Bett ausruhen & speichern', act: restYK };
      if (player.y > 3) { const sg = SEAT(); if (Math.abs(pz - sg.z) < 1.0 && Math.abs(px - (PL.position.x - 0.35)) < 1.2) return { hint: `Drücke <b>E</b>: Platz ${t?.seat || '14A'} einnehmen`, act: sitDown }; }
    }
    return null;
  }
  AIR.hint = () => { const c = ctxNow(); return c ? c.hint : ''; };
  AIR.key = (code) => {
    if (S.flight) { if (code === 'Space') skipFlight(); return true; }
    if (S.lock) return true;
    if (code === 'KeyE') { const c = ctxNow(); if (c) { c.act(); return true; } }
    return false;
  };
  const lockFor = (secs, pose, face, fn) => { S.lock = { t: secs, pose, face, fn }; player.vx = player.vz = 0; };
  function showTicket() {
    const t = T();
    guard.pose = 'talk'; setTimeout(() => guard.pose = 'stand', 2200);
    if (!t) { C.sfx.liftBeep(); say('Ohne gültiges Ticket kann ich Sie nicht durchlassen. Buchen Sie zuerst Ihren Flug – am besten über die LS-Air-App.', 'Sicherheit', 'dispatch'); C.notice('Kein Ticket – Zutritt verweigert', 2200); return; }
    if (t.type === 'jet') { say('Charterkunden nutzen bitte das Privatterminal, nördlich von hier.', 'Sicherheit', 'dispatch'); return; }
    if (C.getWanted() > 0) { say('Sie werden gesucht. Ich muss die Polizei rufen!', 'Sicherheit', 'dispatch'); return; }
    if (t.from !== 'ls') { C.notice('Dieses Ticket gilt nicht für diesen Flughafen', 2000); return; }
    lockFor(1.8, 'phone', null, () => { S.sec = 1; barrierSet(0, false); C.sfx.ding(); C.notice(`Ticket ${t.flight} akzeptiert · weiter zur Gepäckkontrolle`, 2400); say(`Danke, ${t.flight} nach ${t.destName}. Bitte Taschen und Gürtel in die Wanne legen.`, 'Sicherheit', 'dispatch'); });
  }
  function putBag() {
    lockFor(1.5, 'pickup', Math.PI, () => {
      if (C.getWeapon() > 0) { S.stash = C.getWeapon(); C.setWeapon(0); C.notice('Waffe liegt mit im Gepäck – wird am Ende zurückgegeben', 3000); say('Waffen bitte immer in die Wanne – die bekommen Sie am Ausgang zurück.', 'Sicherheit', 'dispatch'); }
      S.sec = 2; S.trayX = 0; W.tray.visible = true; W.tray.position.set(808.4, 0.98, -2.1); barrierSet(1, false); S.trayT = 0; S.secScanned = false; C.sfx.click();
      C.notice('Gepäck liegt auf dem Band · jetzt durch den Metalldetektor', 2400);
    });
  }
  function takeBag() {
    if (S.trayX < 22.5) { C.notice('Das Gepäck ist noch im Röntgengerät …', 1500); return; }
    lockFor(1.4, 'pickup', Math.PI, () => { W.tray.visible = false; if (S.stash) { C.setWeapon(S.stash); S.stash = 0; } S.secDone = true; S.sec = 4; S.trayT = -1; barrierSet(2, false); C.sfx.liftBeep(); C.notice('Sicherheitskontrolle bestanden · Gate suchen', 2600); say('Alles in Ordnung. Guten Flug!', 'Sicherheit', 'dispatch'); });
  }
  function scannerCheck() {
    const bad = C.getWeapon() > 0;
    if (!bad) { W.scanLight.material.color.set(0x33ff66); S.alarm = 0; C.sfx.liftBeep(); C.notice('Scanner: kein Alarm', 1400); S.secScanned = true; S.sec = 3; return; }
    S.alarm = 4; S.stash = 0; S.secScanned = true; S.sec = 3; W.scanLight.material.color.set(0xff2a1a); C.setWeapon(0);
    for (let i = 0; i < 3; i++) setTimeout(() => C.sfx.horn?.(player.x, player.z, 0.4), i * 450);
    say('Alarm! Sie führen eine Waffe mit sich. Die Waffe wird beschlagnahmt – das hier ist ein Flughafen!', 'Sicherheit', 'dispatch'); C.notice('⚠ ALARM · Waffe beschlagnahmt', 3000);
    guard2.pose = 'talk';
  }
  function gateScan(i) {
    const t = T(); agents[i].pose = 'talk'; setTimeout(() => agents[i].pose = 'type', 2000);
    if (!t) { say('Ich kann keine Bordkarte finden. Bitte buchen Sie Ihren Flug in der App.', 'Gate-Agentin', 'f_recep'); return; }
    if (t.type === 'jet') { say('Charterflüge starten am Privatterminal.', 'Gate-Agentin', 'f_recep'); return; }
    if (!S.secDone) { C.notice('Zuerst durch die Sicherheitskontrolle', 1800); return; }
    if (t.gate !== GATE_NAMES[i]) { say(`Das ist Gate ${GATE_NAMES[i]}. Ihr Flug geht von Gate ${t.gate}.`, 'Gate-Agentin', 'f_recep'); C.notice('Falsches Gate – Ihr Gate: ' + t.gate, 2400); return; }
    if (S.planeAt !== 'ls') { C.notice('Das Flugzeug ist noch nicht eingetroffen', 2000); return; }
    lockFor(1.6, 'phone', null, () => { C.sfx.ding(); const d = W.bridgeDoors[i]; d.want = 1; setSolid(d.s, false); say(`Bordkarte gescannt. Sitz ${t.seat}. Guten Flug nach ${t.destName}!`, 'Gate-Agentin', 'f_recep'); C.notice('Boarding · Fluggastbrücke geöffnet', 2400); });
  }
  function gateScanYK() {
    const t = T(); S.ykAgent.pose = 'talk'; setTimeout(() => S.ykAgent.pose = 'type', 2000);
    if (!t || t.type !== 'air' || t.from !== 'yk') { say(t ? 'Dieses Ticket gilt hier nicht.' : 'Ohne Ticket kein Flug. Buchen Sie über LS Air auf Ihrem Handy.', 'Gate-Agent', 'f_recep'); return; }
    if (C.getWanted() > 0) return;
    lockFor(1.6, 'phone', null, () => { C.sfx.ding(); S.yk.bridgeDoor.want = 1; setSolid(S.yk.bridgeDoor.s, false); say('Bordkarte gescannt. Guten Flug nach Los Santos!', 'Gate-Agent', 'f_recep'); });
  }
  function leaveAirside() { resetSecurity(); resetGates(); C.fade(true); setTimeout(() => { player.x = 752; player.z = -4; player.yaw = Math.PI / 2; C.fade(false); C.notice('Zurück in der Abflughalle', 1600); }, 600); }
  function checkinDesk() { say(T() ? `Ihr mobiles Ticket ${T().flight} ist gültig. Gehen Sie bitte zur Sicherheitskontrolle in der Hallenmitte.` : 'Willkommen bei LS Air! Buchen Sie Ihren Flug bequem über die App auf Ihrem Handy.', 'Check-in', 'f_recep'); }
  function infoDesk() { info.pose = 'talk'; setTimeout(() => info.pose = 'type', 2500); say(pick(['Willkommen am Los Santos International. Abflug ist geradeaus, Sicherheitskontrolle in der Mitte, Privatjets im Norden.', 'Die Privatjet-Lounge finden Sie nördlich der Haupthalle. Einfach der Beschilderung folgen.', 'Haben Sie schon ein Ticket? Die Buchung geht ganz einfach mit der App LS Air.']), 'Information', 'f_recep'); }
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function shopMenu(s) {
    const ids = s.name === 'KIOSK' ? ['zeitung', 'schoko', 'chips', 'wasser'] : ['cola', 'sandwich', 'burger', 'wasser'];
    const mk = () => C.openMenu(s.name, [{ label: `Bargeld ${C.fmt(player.money)} · Konto ${C.fmt(player.bank || 0)}` }, ...ids.map(k => ({ label: `${C.ITEMS[k].ico} ${C.ITEMS[k].n} – ${C.fmt(C.ITEMS[k].p * 2)} (Flughafenpreis)`, act: () => { const m = player.payPref || 'cash'; const p = C.ITEMS[k].p * 2; if (C.pay(p, m)) { (player.inv ||= {})[k] = (player.inv[k] || 0) + 1; C.notice(C.ITEMS[k].n + ' gekauft', 1100); } mk(); return true; } })), { label: 'Fertig', act: () => false }]);
    mk();
  }
  function fboCheckin() {
    const t = T(); fboN.pose = 'talk'; setTimeout(() => fboN.pose = 'stand', 2500);
    if (!t || t.type !== 'jet') { say(t ? 'Das ist ein Linienticket – dafür ist das Hauptterminal zuständig.' : 'Guten Tag. Wenn Sie einen Jet über die App LS Jets chartern, begleite ich Sie gern zur Maschine.', 'Concierge', 'pm_old'); return; }
    if (t.from !== (inYK() ? 'yk' : 'ls')) return;
    W.fboDoor.want = 1; setSolid(W.fboDoor.s, false);
    say(`Willkommen, ${t.pax}. Ihre Maschine steht bereit. Bitte folgen Sie dem Weg über das Vorfeld – die Treppe ist ausgefahren.`, 'Concierge', 'pm_old'); C.notice('Privatjet wartet auf dem Vorfeld', 2600);
  }
  function restYK() { C.fade(true); C.sfx.save?.(); setTimeout(() => { C.addGameMin(360); player.hp = 100; const ok = C.saveGame(); C.fade(false); C.notice(ok ? 'Geschlafen · Spiel gespeichert (North Yankton)' : 'Speichern nicht möglich', 2800); }, 900); }

  // ---------- Sitzen & Flug ----------
  function sitDown() { startFlight('air'); }
  function sitDownJet() { startFlight('jet'); }
  function startFlight(kind) {
    const t = T(); if (!t) return;
    const sitg = kind === 'air' ? PL : JET;
    S.flight = { kind, t: 0, phase: 'close', plane: sitg, site: kind === 'air' ? siteOf() : SITE_LS_JET(), v: 0, s: 0, curve: null, lift: false, skipped: false, y: 0, sway: 0, white: 0, cloud: null, said: {} };
    if (kind === 'air') { const sg = SEAT(); S.flight.seat = { x: -1.56, z: sg.zl }; } else S.flight.seat = { x: -0.78, z: -4.8 };
    player.vx = player.vz = 0; C.closePhone?.();
    document.body.classList.add('cine'); bars(true);
    const hello = kind === 'air' ? ['Meine Damen und Herren, willkommen an Bord von Flug ' + t.flight + ' nach ' + t.destName + '. Hier spricht Ihr Kapitän. Bitte schnallen Sie sich an – wir rollen gleich zur Startbahn.', 'Kapitän'] : ['Guten Tag, hier spricht Ihr Pilot. Wir fliegen direkt nach ' + t.destName + '. Gute Reise, ' + t.pax + '.', 'Pilot'];
    say(hello[0], hello[1], 'dispatch');
    if (kind === 'air') { const d = W.bridgeDoors[S.planeGate]; if (S.planeAt === 'ls' && d) { d.want = 0; } }
  }
  function SITE_LS_JET() { return { id: 'ls', px: LS.JX, gzOverride: LS.JZ[1], taxX: LS.TWY.x, cz: 180, rwyX: LS.RWY.x, rwyEnd: LS.RWY.z0, jet: true }; }
  let barsEl = null;
  function bars(on) {
    if (!barsEl) {
      barsEl = document.createElement('div'); barsEl.style.cssText = 'position:fixed;inset:0;z-index:9;pointer-events:none;display:none';
      barsEl.innerHTML = '<div style="position:absolute;left:0;right:0;top:0;height:9vh;background:#000"></div><div style="position:absolute;left:0;right:0;bottom:0;height:9vh;background:#000"></div><div id="airwhite" style="position:absolute;inset:0;background:#fff;opacity:0"></div><div id="aircap" style="position:absolute;left:0;right:0;bottom:11vh;text-align:center;color:#fff;font:700 2.4vmin Arial;text-shadow:0 .2vmin .8vmin #000"></div><div id="airskip" style="position:absolute;right:3vmin;bottom:10vh;color:#cfd6dd;font:1.6vmin Arial">Leertaste: überspringen</div><div id="airfade" style="position:absolute;inset:0;background:#000;opacity:0;transition:opacity .8s"></div>';
      document.body.appendChild(barsEl);
      const st = document.createElement('style'); st.textContent = 'body.cine #mapwrap,body.cine #topright,body.cine #who,body.cine #healthwrap,body.cine #nav,body.cine #speed,body.cine #hint,body.cine #weapon{display:none!important}'; document.head.appendChild(st);
    }
    barsEl.style.display = on ? 'block' : 'none';
    if (!on) { document.body.classList.remove('cine'); barsEl.querySelector('#airwhite').style.opacity = 0; barsEl.querySelector('#airfade').style.opacity = 0; }
  }
  const capEl = () => barsEl.querySelector('#aircap'), fadeEl = () => barsEl.querySelector('#airfade');
  function buildPath(site, gz) {
    const pts = site.jet ? [[site.px, gz], [site.px + 20, gz + 4], [site.taxX - 12, gz + 18], [site.taxX, gz + 50], [site.taxX, site.cz - 60], [site.taxX + 6, site.cz - 18], [site.taxX + (site.rwyX - site.taxX) * 0.6, site.cz], [site.rwyX - 14, site.cz - 5], [site.rwyX, site.cz - 32], [site.rwyX, site.cz - 75]] : [[site.px, gz], [site.px, gz + 35], [site.px + 12, site.cz - 40], [site.taxX, site.cz - 6], [site.taxX + (site.rwyX - site.taxX) * 0.6, site.cz], [site.rwyX - 14, site.cz - 5], [site.rwyX, site.cz - 32], [site.rwyX, site.cz - 75]];
    return new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0.05, p[1])), false, 'centripetal');
  }
  let cloudMesh = null;
  function ensureClouds() {
    if (cloudMesh) return cloudMesh;
    const t = canvasTex(512, 512, (c, w, h) => { c.clearRect(0, 0, w, h); for (let i = 0; i < 320; i++) { const g = c.createRadialGradient(0, 0, 0, 0, 0, 1); const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 60; c.save(); c.translate(x, y); c.scale(r, r * 0.7); const gg = c.createRadialGradient(0, 0, 0, 0, 0, 1); gg.addColorStop(0, 'rgba(255,255,255,.55)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gg; c.beginPath(); c.arc(0, 0, 1, 0, 7); c.fill(); c.restore(); } }, true, true);
    t.repeat.set(12, 12);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, opacity: 0.98 }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 2; m.visible = false; scene.add(m); cloudMesh = m;
    const m2 = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshBasicMaterial({ color: 0xdfe9f5, transparent: true, opacity: 0.55, depthWrite: false, fog: false })); m2.rotation.x = -Math.PI / 2; m2.position.y = -12; m.add(m2);
    return m;
  }
  function flightStep(F, dt) {
    F.t += dt; const g = F.plane;
    // Phasen: close (4s) -> taxi -> roll -> climb -> cloud -> land
    if (F.phase === 'close') {
      if (F.t > 4.5) { F.phase = 'taxi'; const gz = F.site.gzOverride ?? g.position.z; F.curve = buildPath(F.site, gz); F.len = F.curve.getLength(); F.s = 0; F.v = 0; F.yaw = 0; if (F.kind === 'air') say('Kabinencrew, bitte Türen schließen und auf Automatik stellen.', 'Purser', 'f_recep'); }
    } else if (F.phase === 'taxi') {
      F.v = Math.min(18, F.v + dt * 5); F.s += F.v * dt; const u = Math.min(1, F.s / F.len);
      const p = F.curve.getPointAt(u), tg = F.curve.getTangentAt(u); g.position.set(p.x, 0.05, p.z);
      const target = Math.atan2(-tg.x, -tg.z), start = F.s < 15 ? 0 : 1;
      if (!F.yawInit) { F.yawInit = true; F.yaw = 0; }
      const dy = Math.atan2(Math.sin(target - F.yaw), Math.cos(target - F.yaw)); F.yaw += dy * Math.min(1, dt * (F.s < 30 ? 1.2 : 3)); g.rotation.y = F.yaw;
      if (u >= 1) { F.phase = 'roll'; F.rz = g.position.z; F.rx = g.position.x; F.v = 6; F.yaw = Math.atan2(-tg.x, -tg.z); say(F.kind === 'air' ? 'Tower, Flug ' + T().flight + ' bereit zum Start.  Startfreigabe erteilt. Besatzung, Start.' : 'Tower, Bereit zum Start. Freigabe erteilt.', 'Funk', 'dispatch'); }
    } else if (F.phase === 'roll') {
      F.v += dt * 5.8; F.rz -= F.v * dt; F.rx = lerp(F.rx, F.site.rwyX, Math.min(1, dt * 2)); g.position.x = F.rx; g.position.z = F.rz;
      g.rotation.y = lerp(g.rotation.y, 0, Math.min(1, dt * 3));
      if (F.v > 66 && !F.lift) { F.lift = true; F.liftT = F.t; if (F.kind === 'air') say('Rotate. Positive rate. Fahrwerk einfahren.', 'Funk', 'dispatch'); }
      if (F.lift) { const k = clamp((F.t - F.liftT) / 3, 0, 1); g.rotation.x = k * 0.2; F.y += F.v * Math.sin(g.rotation.x) * dt; g.position.y = F.y + 0.05; if (F.t - F.liftT > 3.5) F.phase = 'climb', F.t2 = F.t; }
    } else if (F.phase === 'climb') {
      F.v = Math.min(110, F.v + dt * 7); F.rz -= F.v * Math.cos(0.2) * dt; F.y += F.v * Math.sin(0.2) * dt * 1.6; g.rotation.x = 0.2; g.rotation.z = Math.sin(F.t * 0.3) * 0.08; g.position.set(F.rx, F.y, F.rz);
      if (F.y > 180 && !F.said.c) { F.said.c = 1; ensureClouds().visible = true; cloudMesh.position.set(g.position.x, 260, g.position.z); }
      if (cloudMesh && cloudMesh.visible) { cloudMesh.position.x = g.position.x; cloudMesh.position.z = g.position.z; const k = 1 - Math.abs(F.y - 262) / 70; F.white = clamp(k, 0, 1); barsEl.querySelector('#airwhite').style.opacity = F.white * 0.9; }
      if (F.y > 380) { F.phase = 'cruise'; F.t3 = F.t; capEl().textContent = `Reiseflughöhe erreicht · ${T().destName}`; say('Wir haben die Reiseflughöhe erreicht. Lehnen Sie sich zurück und genießen Sie den Flug.', F.kind === 'air' ? 'Kapitän' : 'Pilot', 'dispatch'); }
    } else if (F.phase === 'cruise') {
      F.rz -= 120 * dt; F.y += 6 * dt; g.rotation.x = lerp(g.rotation.x, 0.03, dt); g.position.set(F.rx, F.y, F.rz); cloudMesh.position.set(g.position.x, 260, g.position.z);
      if (F.t - F.t3 > 6) endFlight(F);
    }
    // Kamera: Mix aus Fensterplatz (innen) und Außenkameras
    const body = g.userData.body, st = F.seat, ey = F.kind === 'air' ? 0.62 : 0.2;
    let mode = 'win';
    if (F.phase === 'taxi' && F.s > F.len * 0.3) mode = 'taxi';
    else if (F.phase === 'roll') { if (F.rollZ0 === undefined) F.rollZ0 = F.rz; mode = !F.lift && F.rz > F.rollZ0 - 300 ? 'track' : 'chase'; }
    else if (F.phase === 'climb') mode = F.y < 150 ? 'side' : 'win';
    if (mode === 'win') {
      camera.position.copy(body.localToWorld(V.set(st.x + 0.04, ey + 0.05, st.z + 0.1))); const sway = Math.sin(F.t * 1.3) * 0.01 + (F.phase === 'roll' ? Math.sin(F.t * 40) * 0.004 : 0);
      camera.position.y += sway; body.localToWorld(V2.set(-6, ey - 0.45, st.z - 2.2 + Math.sin(F.t * 0.4) * 0.3)); camera.lookAt(V2); camera.fov = 60;
    } else {
      const big = F.kind === 'air' ? 1 : 0.6;
      if (mode === 'track') { if (F.trkZ === undefined) F.trkZ = F.rz - 140; camera.position.set(F.site.rwyX + 42, 2.2, F.trkZ); }
      else if (mode === 'taxi') { g.localToWorld(V.set(-24 * big, 4.5, -28 * big)); camera.position.copy(V); }
      else if (mode === 'chase') { g.localToWorld(V.set(0, 6, 46 * big)); camera.position.copy(V); }
      else { g.localToWorld(V.set(-38 * big, 5 + F.y * 0.05, 8)); camera.position.copy(V); }
      V2.copy(g.position); V2.y += 3.5; camera.lookAt(V2); camera.fov = mode === 'track' ? 38 : 55;
      if (mode === 'track') camera.fov = 30;
    }
    camera.updateProjectionMatrix();
    // Spieler sitzt mit
    const h = player.h; body.localToWorld(V.set(st.x, F.kind === 'air' ? -0.5 : -0.6, st.z)); h.group.position.copy(V); h.group.visible = false; h.group.rotation.set(0, g.rotation.y + Math.PI, 0); player.x = V.x; player.z = V.z; player.y = V.y;
    animHuman(h, 0, dt, false, 'sit');
    if (F.phase === 'close') capEl().textContent = F.t < 2.5 ? 'Türen werden geschlossen …' : `Flug ${T().flight} · ${T().destName}`;
    else if (F.phase === 'taxi') capEl().textContent = 'Rollen zur Startbahn';
    else if (F.phase === 'roll') capEl().textContent = F.lift ? '' : 'Start';
  }
  function skipFlight() { const F = S.flight; if (F && !F.skipped) { F.skipped = true; endFlight(F); } }
  function endFlight(F) {
    if (F.ending) return; F.ending = true; const t = T(), dest = t.dest;
    fadeEl().style.opacity = 1; capEl().textContent = `Landung: ${t.destName}`;
    setTimeout(() => {
      if (cloudMesh) cloudMesh.visible = false;
      barsEl.querySelector('#airwhite').style.opacity = 0; const g = F.plane;
      g.rotation.set(0, 0, 0);
      if (F.kind === 'air') {
        if (dest === 'yk') { S.planeAt = 'yk'; ensureYK(); S.planeGate = 0; placePlane('yk'); } else { S.planeGate = Math.floor(Math.random() * 5); placePlane('ls'); }
      } else { g.position.set(LS.JX, 0.05, LS.JZ[1]); if (dest === 'yk') placePlane('yk'); }
      resetGates(); resetSecurity();
      const a = dest === 'yk' ? (F.kind === 'jet' ? { x: 15040, z: 18 } : YK.arrive) : { x: 752, z: -4 };
      player.ticket = null; C.addGameMin(30); C.clearWanted?.();
      if (dest === 'yk') ensureYK(); else if (S.yk) { /* bleibt */ }
      player.x = a.x; player.z = a.z; player.y = 0.06; player.yaw = dest === 'yk' ? -Math.PI / 2 : Math.PI / 2; player.vx = player.vz = 0; player.h.group.rotation.set(0, player.yaw, 0);
      S.flight = null; player.h.group.visible = true; capEl().textContent = ''; bars(false); fadeEl().style.opacity = 0;
      C.camReset(player.yaw);
      camera.fov = 68; camera.updateProjectionMatrix();
      C.banner(dest === 'yk' ? 'NORTH YANKTON' : 'LOS SANTOS', dest === 'yk' ? 'Willkommen · −8 °C' : 'Willkommen zurück', 4500);
      setTimeout(() => { C.saveGame(); C.notice('Spielstand gespeichert · ' + (dest === 'yk' ? 'North Yankton' : 'Los Santos'), 2600); }, 1500);
    }, 1400);
  }
  AIR.camera = (dt) => { if (!S.flight) return false; C.skyFollow(); return true; };
  AIR.control = (dt) => {
    if (S.flight) { flightStep(S.flight, dt); return true; }
    const L = S.lock;
    if (L) {
      L.t -= dt; player.vx = player.vz = 0;
      if (L.face !== null && L.face !== undefined) { player.yaw += (Math.atan2(Math.sin(L.face - player.yaw), Math.cos(L.face - player.yaw))) * Math.min(1, dt * 10); }
      player.h.group.position.set(player.x, player.y, player.z); player.h.group.rotation.set(0, player.yaw, 0);
      animHuman(player.h, 0, dt, false, L.pose);
      if (L.t <= 0) { S.lock = null; L.fn?.(); }
      return true;
    }
    return false;
  };
  AIR.camLimit = () => {
    if (S.flight) return null; const px = player.x, pz = player.z;
    if (player.y > 1 && (px > 850 && px < 900 || (S.planeAt === 'yk' && px > 15000 && px < 15040))) return { dist: 1.6, pitch: 0.35 };
    if (px > 788 && px < 828 && Math.abs(pz) < 4) return { dist: 2.1, pitch: 0.5 };
    if (px > 758 && px < 852 && Math.abs(pz) < 134 && player.y < 2) return { dist: 3.3, pitch: 0.8 };
    if (px > 776 && px < 832 && pz < -265 && pz > -325) return { dist: 3.0, pitch: 0.7 };
    if (px > 14935 && px < 15002 && Math.abs(pz) < 24) return { dist: 3.0, pitch: 0.7 };
    return null;
  };
  AIR.camFix = (cam) => {
    const px = player.x, pz = player.z;
    if (px > 758 && px < 852 && Math.abs(pz) < 134 && player.y < 2) cam.position.y = Math.min(cam.position.y, 8.5);
    else if (player.y > 1 && px > 850 && px < 900) cam.position.y = clamp(cam.position.y, player.y + 0.2, player.y + 2.2);
  };

  // ---------- Fußboden (begehbare Flächen über dem Boden) ----------
  AIR.floor = (x, z, y) => {
    if (x > 5000) { // Yankton
      const g = Math.abs(z - YK.bz) < 1.2 && x > YK.T.x1 && x < YK.px - 1.9;
      if (g && S.yk) return 0.06 + (x - YK.T.x1) / (YK.px - 1.9 - YK.T.x1) * 3.28;
      if (S.planeAt === 'yk' && y > 1.5 && Math.abs(x - PL.position.x) < 1.9 && Math.abs(z - PL.position.z) < 15.4) return 3.35;
      return undefined;
    }
    if (x < 840) return undefined;
    if (x < 878.2 && Math.abs(z - LS.GATES[0] + 13.5) < 130) { for (const g of LS.GATES) if (Math.abs(z - (g - 13.5)) < 1.25 && x > LS.BR0 && x < LS.PX - 1.9) return 0.06 + (x - LS.BR0) / (LS.PX - 1.9 - LS.BR0) * 3.28; }
    if (S.planeAt === 'ls' && y > 1.5 && Math.abs(x - PL.position.x) < 1.9 && Math.abs(z - PL.position.z) < 15.4 && PL.position.y < 1) return 3.35;
    // Jet: Treppe + Kabine
    const jx = JET.position.x, jz = JET.position.z, dzz = z - (jz - 6.3);
    if (Math.abs(dzz) < 0.55 && x > jx - 4.0 && x < jx - 1.3) return clamp(0.06 + (x - (jx - 4.0)) / 2.7 * 1.5, 0.06, 1.6);
    if (y > 0.9 && Math.abs(x - jx) < 1.1 && z > jz - 7.2 && z < jz + 5.3) return 1.6;
    return undefined;
  };
  // Kabinen-Kollider werden beim Platzieren des Flugzeugs neu gesetzt
  const cabinCol = { list: [], at: null };
  function refreshCabinColliders() {
    const key = PL.position.x + ',' + PL.position.z; if (cabinCol.at === key) return; cabinCol.at = key;
    for (const s of cabinCol.list) C.removeSolid(s); cabinCol.list = [];
    const px = PL.position.x, pz = PL.position.z, fy = 3.35, add = (a, b, c, d) => cabinCol.list.push(C.addSolid(px + a, px + b, pz + c, pz + d, fy + 2.6, fy - 0.4));
    add(-2.1, -1.95, -15.6, 15.6); add(1.95, 2.1, -15.6, 15.6); add(-2.1, 2.1, -15.9, -15.6); add(-2.1, 2.1, 15.4, 15.7);
    add(-1.85, -0.43, -12.6, 7.5); add(0.43, 1.85, -12.6, 7.5);
    // Rumpf unten (Boden) – verhindert Gehen durch den Rumpf auf Apron-Höhe
    cabinCol.list.push(C.addSolid(px - 2.0, px - 1.9, pz - 15, pz + 15, 3.0, -Infinity));
    cabinCol.list.push(C.addSolid(px + 1.9, px + 2.0, pz - 15, pz + 15, 3.0, -Infinity));
  }
  const jetCol = [];
  { const jx = JET.position.x, jz = JET.position.z, fy = 1.65, add = (a, b, c, d) => jetCol.push(C.addSolid(jx + a, jx + b, jz + c, jz + d, fy + 2.2, fy - 0.4));
    add(-1.25, -1.15, -6.9, 5.1); add(1.15, 1.25, -6.9, 5.1); add(-1.25, 1.25, 5.1, 5.4); add(-1.25, 1.25, -7.2, -6.9);
    add(-1.0, -0.55, -5.6, 3.9); add(0.55, 1.0, -5.6, 3.9); }
  { const jx = JET.position.x, jz = JET.position.z; C.addSolid(jx - 1.25, jx - 1.15, jz - 6.3 + 0.55, jz - 6.3 + 5, 1.6, -Infinity); }
  // ---------- Update ----------
  let uiT = 0, lightsOn = false;
  const lamp1 = new THREE.PointLight(0xfff2dd, 0, 38, 1.6), lamp2 = new THREE.PointLight(0xfff2dd, 0, 38, 1.6); scene.add(lamp1, lamp2);
  AIR.update = (dt) => {
    const px = player.x, pz = player.z, dLS = Math.hypot(px - 850, pz), onLS = px < 3000;
    W.root.visible = onLS && dLS < 1100; W.interior.visible = onLS && dLS < 260;
    if (S.yk) S.yk.root.visible = px > 5000;
    if (cloudMesh && !S.flight) cloudMesh.visible = false;
    refreshCabinColliders();
    // Türen
    if (onLS && dLS < 300) {
      for (const d of W.doors.main) { d.want = Math.abs(px - 758) < 7 && Math.abs(pz) < 8 ? 1 : 0; d.open += clamp(d.want - d.open, -dt * 1.5, dt * 1.5); d.m.position.z = d.z0 + d.dir * d.open * 1.5; }
      for (const d of W.bridgeDoors) slide(d, dt);
      slide(W.fboDoor, dt);
      const fb = W.fboDoor; fb.m.position.z = fb.z + fb.open * 2.6;
    }
    if (S.yk && px > 5000) { const d = S.yk.bridgeDoor; d.open += clamp(d.want - d.open, -dt * 1.6, dt * 1.6); d.m.position.z = d.z + d.open * 2.2; d.m.visible = d.open < 0.99; updateYankton(S.yk, dt, camera, player); }
    // Tray-Band
    if (S.trayT >= 0 && W.tray.visible) {
      S.trayX = Math.min(22.5, S.trayX + dt * 2.6); const x = 808.4 + S.trayX * 0.7; W.tray.position.x = Math.min(x, 824.6); W.tray.visible = true;
      if (x > 813.8 && x < 819) W.tray.position.y = 0.98 + 0.0; W.tray.children.forEach(c => c.visible = !(x > 814.2 && x < 818.6));
    }
    // Scanner
    if (S.sec === 2 && !S.secScanned && px > 816.4 && Math.abs(pz) < 1.4) scannerCheck();
    if (S.alarm > 0) { S.alarm -= dt; W.scanLight.material.color.set(Math.sin(performance.now() / 90) > 0 ? 0xff2a1a : 0x550000); if (S.alarm <= 0) W.scanLight.material.color.set(0x33ff66); }
    // Hinweis: Spieler verlässt Sicherheitsbereich rückwärts nicht erlaubt; Reset wenn weit weg
    if (onLS && (dLS > 300) && (S.sec || S.secDone)) { resetSecurity(); resetGates(); }
    // NPCs
    for (const n of S.npcs) {
      const dd = Math.hypot(n.x - px, n.z - pz); n.h.group.visible = dd < 70 && (n.x < 3000 || px > 5000) && (n.z !== undefined);
      if (!n.h.group.visible) continue; n.h.lod = dd > 45 ? 3 : dd > 25 ? 2 : 1;
      if (n.name === 'guard') n.h.group.rotation.y = lerp(n.h.group.rotation.y, Math.atan2(px - n.x, pz - n.z) * (dd < 8 ? 1 : 0) + (dd < 8 ? 0 : n.yaw), 0.05);
      n.h.group.position.set(n.x, n.y, n.z);
      animHuman(n.h, 0, dt, false, n.pose);
    }
    if (S.flight) PL.visible = true;
    PL.visible = S.planeAt === 'ls' ? (onLS && dLS < 1000) : px > 5000;
    // Licht im Terminal
    const inT = px > 757 && px < 852 && Math.abs(pz) < 132 && player.y < 2.5 && !S.flight;
    const inF = (px > 778 && px < 832 && pz > -327 && pz < -263) || (px > 14935 && px < 15002 && Math.abs(pz) < 24);
    lamp1.intensity = lerp(lamp1.intensity, inT || inF ? 30 : 0, 0.1); lamp2.intensity = lerp(lamp2.intensity, inT || inF ? 14 : 0, 0.1);
    lamp1.position.set(px, 7.5, pz); lamp2.position.set(px + 10 * Math.sin(C.getCamYaw()), 6.5, pz + 10 * Math.cos(C.getCamYaw()));
    S.inT = inT || inF;
    // Tafeln aktualisieren
    if ((uiT -= dt) <= 0) { uiT = 1.2; updateBoards(); }
    // Lock-Pose Ausrichtung: Spieler an Tray
  };
  function updateBoards() {
    const t = T(), [h, m] = now(), tm = (k) => { const x = h * 60 + m + k; return String(Math.floor(x / 60) % 24).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
    const rows = [
      { f: 'SA 2210', d: 'SAN FIERRO', t: tm(35), g: 'A1', s: 'GEPLANT' }, { f: 'PC 778', d: 'LIBERTY CITY', t: tm(55), g: 'A2', s: 'CHECK-IN' }, { f: 'MZ 31', d: 'VICE CITY', t: tm(80), g: 'A5', s: 'GEPLANT' }, { f: 'SA 119', d: 'LAS VENTURAS', t: tm(110), g: 'A4', s: 'GEPLANT' }, { f: 'LS 905', d: 'CAYO PERICO', t: tm(150), g: 'A2', s: 'GEPLANT' }];
    if (t && t.type === 'air' && t.from === 'ls') rows.unshift({ f: t.flight, d: t.destName.toUpperCase(), t: t.time, g: t.gate, s: S.secDone ? 'BOARDING' : 'CHECK-IN', hi: true, sc: '#7fe08a' });
    const tex = boardTex(rows.slice(0, 7)); for (const b of W.boards) { b.material.map?.dispose(); b.material.map = tex; b.material.needsUpdate = true; }
    if (S.yk) { const r = [{ f: t && t.from === 'yk' ? t.flight : 'LS 211', d: 'LOS SANTOS', t: t && t.from === 'yk' ? t.time : tm(50), g: 'G1', s: t && t.from === 'yk' ? 'BOARDING' : 'GEPLANT', hi: !!(t && t.from === 'yk') }]; const tx = boardTex(r, 1024, 512); S.yk.board.material.map?.dispose(); S.yk.board.material.map = tx; S.yk.board.material.needsUpdate = true; }
  }
  // ---------- Himmel/Nebel/Beleuchtung (nach updateSky) ----------
  AIR.post = () => {
    const px = player.x, bl = C.bloom?.();
    let dim = 0;
    if (px > 5000 && !S.flight) { // Yankton: heller, verschneiter Wintertag (unabhängig von der Tageszeit)
      C.sky.top.set('#7f9bbd'); C.sky.hor.set('#d4e0ec'); C.scene.fog.color.set('#d4e0ec'); C.scene.fog.density = 0.0026;
      C.sun.intensity = Math.max(C.sun.intensity, 2.0); C.sun.color.set('#f0f4ff'); C.hemi.intensity = Math.max(C.hemi.intensity, 1.1); C.hemi.color.set('#dfe9f5'); C.hemi.groundColor.set('#9fb0c4'); C.scene.environmentIntensity = Math.max(C.scene.environmentIntensity, 0.8);
    }
    const cab = player.y > 2.3 && px < 3000 && px > 850 && px < 890 || (player.y > 2.3 && px > 15000 && px < 15040) || (player.y > 1.2 && px > 876 && px < 884 && player.z < -255 && player.z > -315);
    const ykT = px > 14935 && px < 15002 && Math.abs(player.z) < 24 && player.y < 2;
    if (ykT) { C.sun.intensity = Math.max(C.sun.intensity, 1.4); C.hemi.intensity = Math.max(C.hemi.intensity, 1.5); }
    else if (S.inT || cab) { dim = 1; C.sun.intensity *= 0.12; C.hemi.intensity = cab ? 0.75 : 0.7; C.scene.environmentIntensity = 0.3; }
    if (bl) bl.strength = lerp(bl.strength, dim ? 0.05 : bl.strength, 0.5);
    if (S.flight) { C.scene.fog.density = S.flight.phase === 'climb' || S.flight.phase === 'cruise' ? 0.00008 : 0.00012; }
  };
  // ---------- Karte ----------
  AIR.pois = [{ x: 722, z: 0, col: '#4aa8ff', sym: '✈' }, { x: 740, z: -292, col: '#d9b45a', sym: 'J' }];
  AIR.mini = (mm, px, pz, MS) => {
    mm.save(); const f = (x, z) => [(x - px) * MS, (z - pz) * MS];
    mm.fillStyle = '#34383e'; const r = (x0, x1, z0, z1, col) => { const a = f(x0, z0), b = f(x1, z1); mm.fillStyle = col; mm.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); };
    r(540, 722, -8, 8, '#3a4048'); r(722, 740, -350, 150, '#3a4048'); r(760, 850, -130, 130, '#6a7078'); r(850, 938, -340, 140, '#4a4f55'); r(938, 962, -545, 425, '#3a4048'); r(1007, 1052, -560, 440, '#2c3036'); r(962, 1007, 168, 192, '#3a4048'); r(780, 830, -325, -265, '#7a6a4a');
    mm.restore();
  };
  AIR.bigmap = (ctx, w2s) => {
    ctx.save(); ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = '#fff';
    const [a, b] = w2s(900, 230); ctx.strokeText('FLUGHAFEN LSIA', a, b); ctx.fillText('FLUGHAFEN LSIA', a, b);
    ctx.restore();
  };
  // ---------- Laden / Start ----------
  AIR.afterLoad = () => {
    S.planeGate = Math.floor(Math.random() * 5);
    if (player.x > 5000) { ensureYK(); placePlane('yk'); } else placePlane('ls');
    updateBoards();
  };
  AIR.state = S; AIR.W = W; AIR.PL = PL; AIR.JET = JET; AIR.bookAir = bookAir; AIR.bookJet = bookJet; AIR.ensureYK = ensureYK; AIR.placePlane = placePlane; AIR.startFlight = startFlight;
  AIR.ready = true;
  placePlane('ls');
  return AIR;
}
