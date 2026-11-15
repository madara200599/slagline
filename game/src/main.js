// SLAGLINE — boot, the fixed-step loop, and the match director: round phases,
// the plant/defuse channels, the core's economy, win checks, the camera, and
// the staged ?shot=N scenes the screenshots are taken from.

import * as THREE from 'three';
import { RULES, ECON, WEAPONS, BUY_ITEMS, otherTeam } from './config.js';
import { createState, makeFighter, freshGun, aliveOf, payRound, currentDef } from './state.js';
import { MAP, buildWorld } from './map.js';
import { eyeHeight } from './physics.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';
import { stepPlayer } from './player.js';
import { createBots, assignPlans, stepBots, botBuy, resetBot, syncMesh } from './bots.js';
import {
  tryFire, startReload, switchTo, throwGrenade, stepWeapons, stepGrenades, createViewmodel,
} from './weapons.js';

const STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotMode = Number.parseInt(params.get('shot') ?? '0', 10) || 0;
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2027);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);
scene.add(camera);

const S = createState(seed);
S.shotMode = shotMode;
const audio = createAudio();
const fx = createFx(scene);
S.fxRef = fx;
S.audioRef = audio;
S.onPlayerHit = () => hud.flashHit();

buildWorld(scene);
const player = makeFighter('union', 'You', true);
S.fighters.push(player);
createBots(S, scene);
// Boot pose: crews stand at their spawns behind the menu until a match starts.
{
  const perTeam = { union: 0, warden: 0 };
  for (const f of S.fighters) {
    const idx = perTeam[f.team]++;
    const spawn = (f.team === 'union' ? MAP.spawns.atk : MAP.spawns.def)[idx % 5];
    place(f, spawn.x, spawn.z, spawn.yaw);
    syncMesh(f, 0.016);
  }
}
const viewmodel = createViewmodel(camera);
const hud = createHud(S, {
  onBuy: (key) => buyItem(S, player, key),
  onPlay: () => { audio.init(); startMatch(); input.requestLock(); },
  onRestart: () => { startMatch(); input.requestLock(); },
});
const input = createInput(S, renderer.domElement, refreshPause);
S.input.takeLookRef = input.takeLook;

// The core prop: one glowing octahedron that rides on its carrier's back,
// sits where it drops, and locks onto the cradle once planted.
const coreMesh = new THREE.Group();
const coreGem = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.21),
  new THREE.MeshStandardMaterial({ color: 0x331a05, emissive: 0xff8c2e, emissiveIntensity: 2.2 }),
);
coreMesh.add(coreGem);
const coreLight = new THREE.PointLight(0xff8c2e, 12, 7, 2);
coreMesh.add(coreLight);
scene.add(coreMesh);
// Thrown grenades get simple tumbling shells from a small pool.
const nadeMeshes = [];
for (let i = 0; i < 6; i += 1) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a4038, roughness: 0.6, metalness: 0.4 }),
  );
  m.visible = false;
  scene.add(m);
  nadeMeshes.push(m);
}

// --- Buying (shared by the player's menu and the bots) ---

export function buyItem(S2, f, key, silent = false) {
  const deny = () => { if (f.isPlayer && !silent) audio.denied(); return false; };
  const pay = (amount) => { f.money -= amount; if (f.isPlayer && !silent) audio.buy(); return true; };
  if (key === 'smg' || key === 'rifle' || key === 'sniper') {
    if (f.guns.primary?.key === key) return false;
    if (f.money < WEAPONS[key].price) return deny();
    pay(WEAPONS[key].price);
    f.guns.primary = freshGun(key);
    return true;
  }
  if (key === 'frag' || key === 'smoke') {
    if (f.nades[key] >= 1 || f.money < WEAPONS[key].price) return deny();
    pay(WEAPONS[key].price);
    f.nades[key] += 1;
    return true;
  }
  if (key === 'armor') {
    if (f.armor || f.money < 650) return deny();
    pay(650);
    f.armor = true;
    return true;
  }
  if (key === 'armorhelm') {
    const cost = f.armor && !f.helmet ? 350 : 1000;
    if (f.helmet || f.money < cost) return deny();
    pay(cost);
    f.armor = true;
    f.helmet = true;
    return true;
  }
  if (key === 'kit') {
    if (f.kit || f.team === S2.attackTeam || f.money < 400) return deny();
    pay(400);
    f.kit = true;
    return true;
  }
  return false;
}

// --- Match and round flow ---

function notice(text, sub, secs = 3.2) {
  S.notices.push({ text, sub, t: S.time, until: S.time + secs });
}

function startMatch() {
  S.score.union = 0;
  S.score.warden = 0;
  S.lossStreak.union = 0;
  S.lossStreak.warden = 0;
  S.round = 0;
  S.matchWinner = null;
  for (const f of S.fighters) {
    f.money = ECON.start;
    f.kills = 0;
    f.deaths = 0;
    f.guns = { pistol: freshGun('pistol'), primary: null };
    f.nades = { frag: 0, smoke: 0 };
    f.armor = false;
    f.helmet = false;
    f.kit = false;
    f.lostGear = false;
  }
  nextRound();
}

function nextRound() {
  S.round += 1;
  S.attackTeam = S.round <= RULES.swapAfter ? 'union' : 'warden';
  S.core.planted = false;
  S.core.dropped = false;
  S.core.carrier = null;
  S.core.site = null;
  S.core.detT = 0;
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.winner = null;
  const perTeam = { union: 0, warden: 0 };
  for (const f of S.fighters) {
    const idx = perTeam[f.team]++;
    const spawn = (f.team === S.attackTeam ? MAP.spawns.atk : MAP.spawns.def)[idx % 5];
    f.alive = true;
    f.hp = 100;
    f.pos.x = spawn.x; f.pos.y = 0; f.pos.z = spawn.z;
    f.vel.x = 0; f.vel.y = 0; f.vel.z = 0;
    f.yaw = spawn.yaw;
    f.pitch = 0;
    f.crouch = false;
    f.channel = null;
    f.hasCore = false;
    f.fireT = 0; f.reloadT = 0; f.swapT = 0; f.recoil = 0;
    f.current = f.guns.primary ? 'primary' : 'pistol';
    if (f.lostGear) {
      f.guns.primary = null;
      f.armor = false;
      f.helmet = false;
      f.kit = false;
      f.current = 'pistol';
      f.lostGear = false;
    }
    for (const slot of ['pistol', 'primary']) {
      const gun = f.guns[slot];
      if (gun) { gun.mag = WEAPONS[gun.key].mag; gun.reserve = WEAPONS[gun.key].reserve; }
    }
    if (f.mesh) { f.mesh.rotation.x = 0; f.mesh.visible = true; }
    if (!f.isPlayer) resetBot(f);
  }
  assignPlans(S);
  for (const f of S.fighters) if (!f.isPlayer) botBuy(S, f, buyItem);
  S.phase = 'buy';
  S.phaseT = RULES.buyTime;
  S.input.buyOpen = player.alive && !shotMode;
  notice(`ROUND ${S.round}`, S.attackTeam === player.team ? 'Your crew plants the core' : 'Your crew guards the cradles', 2.6);
  refreshPause();
}

function endRound(winner, reason, objective) {
  if (S.phase !== 'live') return;
  S.winner = winner;
  S.winReason = reason;
  S.score[winner] += 1;
  payRound(S, winner, objective);
  for (const f of S.fighters) if (!f.alive) f.lostGear = true;
  S.phase = 'end';
  S.phaseT = RULES.endTime;
  const won = winner === player.team;
  notice(won ? 'ROUND WON' : 'ROUND LOST', reason, 3.6);
  audio.sting(won);
  S.input.buyOpen = false;
  refreshPause();
}

function matchOver() {
  S.phase = 'over';
  S.matchWinner = S.score.union > S.score.warden ? 'union' : S.score.warden > S.score.union ? 'warden' : null;
  const title = S.matchWinner === null
    ? 'DEAD HEAT AT THE FOUNDRY'
    : S.matchWinner === 'union' ? 'UNION TAKES THE FOUNDRY' : 'WARDENS HOLD THE FOUNDRY';
  hud.els.endTitle.textContent = title;
  hud.els.endSub.textContent = `Union ${S.score.union} — ${S.score.warden} Wardens` +
    (S.matchWinner === player.team ? ' · your crew wins' : S.matchWinner ? ' · your crew falls' : '');
  input.releaseLock();
}

// --- The core: plant, defuse, detonate ---

function plantCore(f) {
  const siteKey = Math.hypot(MAP.sites.A.x - f.pos.x, MAP.sites.A.z - f.pos.z) <
    Math.hypot(MAP.sites.B.x - f.pos.x, MAP.sites.B.z - f.pos.z) ? 'A' : 'B';
  const site = MAP.sites[siteKey];
  S.core.planted = true;
  S.core.site = siteKey;
  S.core.x = site.x;
  S.core.z = site.z;
  S.core.detT = RULES.detonateTime;
  S.core.beepT = 0;
  f.hasCore = false;
  S.core.carrier = null;
  f.money = Math.min(ECON.maxMoney, f.money + ECON.plantPlanter);
  for (const o of S.fighters) if (o.team === S.attackTeam) o.money = Math.min(ECON.maxMoney, o.money + ECON.plantTeam);
  notice('CORE PLANTED', `${site.label} — ${RULES.detonateTime} seconds to detonation`, 3);
  audio.beep(true);
}

function stepChannels(dt) {
  for (const f of S.fighters) {
    if (f.hurtFresh) {
      f.hurtFresh = false;
      if (f.channel) f.channel = null; // pain breaks concentration
    }
    if (!f.channel || !f.alive || S.phase !== 'live') continue;
    const ch = f.channel;
    ch.t += dt;
    ch.beepT = (ch.beepT ?? 0) - dt;
    if (ch.beepT <= 0) {
      ch.beepT = 0.72;
      if (f.isPlayer || ch.kind === 'plant') audio.beep(false);
    }
    if (ch.t < ch.need) continue;
    f.channel = null;
    if (ch.kind === 'plant') plantCore(f);
    else {
      audio.defuse();
      endRound(otherTeam(S.attackTeam), 'The core was defused', true);
    }
  }
}

// The player's own channel: hold E in the right place, standing still.
function playerChannel() {
  const p = player;
  if (!p.alive || S.phase !== 'live') { p.channel = null; return; }
  const holding = S.input.keys.has('KeyE');
  const still = p.speed2d < 0.6;
  if (!holding || !still) {
    if (p.channel) p.channel = null;
    return;
  }
  if (!S.core.planted && p.hasCore) {
    for (const key of ['A', 'B']) {
      const site = MAP.sites[key];
      if (Math.hypot(site.x - p.pos.x, site.z - p.pos.z) < RULES.siteRadius) {
        if (!p.channel) p.channel = { kind: 'plant', t: 0, need: RULES.plantTime };
        return;
      }
    }
  }
  if (S.core.planted && p.team !== S.attackTeam) {
    const site = MAP.sites[S.core.site];
    if (Math.hypot(site.x - p.pos.x, site.z - p.pos.z) < 3.4) {
      if (!p.channel) {
        p.channel = { kind: 'defuse', t: 0, need: p.kit ? RULES.defuseKitTime : RULES.defuseTime };
      }
      return;
    }
  }
  if (p.channel) p.channel = null;
}

function stepMatch(dt) {
  if (S.phase === 'buy') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      S.phase = 'live';
      S.phaseT = RULES.roundTime;
      S.input.buyOpen = false;
      notice('FIGHT', S.attackTeam === player.team ? 'Plant the core or clear the Wardens' : 'Guard the cradles', 1.8);
      refreshPause();
    }
    return;
  }
  if (S.phase === 'end') {
    S.phaseT -= dt;
    if (S.phaseT <= 0) {
      if (S.score.union >= RULES.winRounds || S.score.warden >= RULES.winRounds || S.round >= RULES.maxRounds) matchOver();
      else nextRound();
    }
    return;
  }
  if (S.phase !== 'live') return;

  if (S.core.planted) {
    S.core.detT -= dt;
    S.core.beepT -= dt;
    const interval = S.core.detT < 10 ? 0.36 : S.core.detT < 20 ? 0.7 : 1.1;
    if (S.core.beepT <= 0) {
      S.core.beepT = interval;
      audio.beep(S.core.detT < 5);
    }
    if (S.core.detT <= 0) {
      const site = MAP.sites[S.core.site];
      fx.explosion(site.x, 1, site.z);
      S.shake = 1.4;
      endRound(S.attackTeam, 'The core detonated', true);
      return;
    }
    if (aliveOf(S, otherTeam(S.attackTeam)) === 0) {
      endRound(S.attackTeam, 'Defenders eliminated', false);
      return;
    }
  } else {
    S.phaseT -= dt;
    // A dropped core is picked up by the first attacker to reach it.
    if (S.core.dropped) {
      for (const f of S.fighters) {
        if (f.alive && f.team === S.attackTeam && Math.hypot(f.pos.x - S.core.x, f.pos.z - S.core.z) < 1.3) {
          f.hasCore = true;
          S.core.carrier = f;
          S.core.dropped = false;
          if (f.isPlayer) notice('CORE SECURED', 'Get it to a cradle', 2);
          break;
        }
      }
    }
    if (aliveOf(S, S.attackTeam) === 0) { endRound(otherTeam(S.attackTeam), 'Attackers eliminated', false); return; }
    if (aliveOf(S, otherTeam(S.attackTeam)) === 0) { endRound(S.attackTeam, 'Defenders eliminated', false); return; }
    if (S.phaseT <= 0) { endRound(otherTeam(S.attackTeam), 'Time — the core was never planted', false); return; }
  }
}

// --- Player combat input ---

function drainPresses() {
  const presses = S.input.presses;
  S.input.boardOpen = S.input.keys.has('Tab');
  for (const code of presses) {
    if (code === 'KeyB' && S.phase === 'buy') {
      S.input.buyOpen = !S.input.buyOpen;
      refreshPause();
      continue;
    }
    if (S.phase === 'buy' && S.input.buyOpen && code.startsWith('Digit')) {
      const idx = Number(code.slice(5)) - 1;
      if (BUY_ITEMS[idx]) buyItem(S, player, BUY_ITEMS[idx].key);
      continue;
    }
    if (!player.alive || S.phase !== 'live') continue;
    if (code === 'Digit1') switchTo(S, player, 'primary');
    else if (code === 'Digit2') switchTo(S, player, 'pistol');
    else if (code === 'Digit3') switchTo(S, player, 'knife');
    else if (code === 'Digit4') throwGrenade(S, player, 'frag', fx, audio);
    else if (code === 'Digit5') throwGrenade(S, player, 'smoke', fx, audio);
    else if (code === 'KeyR') startReload(S, player, audio);
    else if (code === 'KeyQ') {
      const order = ['primary', 'pistol', 'knife'].filter((s) => s === 'knife' || player.guns[s]);
      const next = order[(order.indexOf(player.current) + 1) % order.length];
      switchTo(S, player, next);
    }
  }
  presses.length = 0;
  if (S.input.wheel !== 0 && player.alive && S.phase === 'live') {
    const order = ['primary', 'pistol', 'knife'].filter((s) => s === 'knife' || player.guns[s]);
    const idx = order.indexOf(player.current);
    const next = order[(idx + Math.sign(S.input.wheel) + order.length) % order.length];
    switchTo(S, player, next);
  }
  S.input.wheel = 0;
}

function stepPlayerCombat() {
  const p = player;
  p.scoped = !!(S.input.ads && p.alive && currentDef(p).zoom && p.swapT <= 0 && p.reloadT <= 0);
  if (!p.alive || S.phase !== 'live' || S.input.buyOpen) {
    triggerLatched = S.input.firing;
    return;
  }
  const def = currentDef(p);
  // Full-auto fires while held; semi-auto weapons need a fresh click per shot.
  if (S.input.firing && (def.auto || !triggerLatched)) {
    if (tryFire(S, p, fx, audio)) viewmodel.fire(!!def.zoom);
  }
  triggerLatched = S.input.firing;
}
let triggerLatched = false;

// --- Camera ---

let eyeSmooth = 1.62;
let bobT = 0;
function syncCamera(dt) {
  const p = player;
  S.shake *= Math.exp(-6 * dt);
  const shakeX = (Math.random() * 2 - 1) * S.shake * 0.05;
  const shakeY = (Math.random() * 2 - 1) * S.shake * 0.05;
  if (p.alive) {
    const targetEye = eyeHeight(p);
    eyeSmooth += (targetEye - eyeSmooth) * Math.min(1, dt * 14);
    bobT += dt * (2 + p.speed2d * 1.7);
    const bob = p.onGround ? Math.min(1, p.speed2d / 5) : 0;
    camera.position.set(
      p.pos.x + shakeX,
      eyeSmooth + Math.sin(bobT * 2) * 0.022 * bob + shakeY,
      p.pos.z,
    );
    camera.rotation.set(p.pitch + p.recoil * 0.004, p.yaw, Math.sin(bobT) * 0.0016 * bob, 'YXZ');
    const targetFov = p.scoped ? 24 : p.ads ? 58 : 75;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 16);
    camera.updateProjectionMatrix();
  } else {
    // Spectate the first living teammate from their own eyes.
    const mate = S.fighters.find((f) => f.alive && f.team === p.team && !f.isPlayer) ||
      S.fighters.find((f) => f.alive);
    if (mate) {
      camera.position.set(mate.pos.x, eyeHeight(mate), mate.pos.z);
      camera.rotation.set(mate.pitch, mate.yaw, 0, 'YXZ');
      camera.fov += (75 - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
  }
  viewmodel.set(p.current === 'knife' ? 'knife' : (p.guns[p.current]?.key ?? 'pistol'));
  viewmodel.update(dt, p, p.ads || p.scoped);
  viewmodel.group.visible = p.alive && !p.scoped;
}

// --- Props sync ---

function syncProps(dt) {
  coreGem.rotation.y += dt * 1.7;
  const carrier = S.core.carrier;
  if (S.core.planted) {
    const site = MAP.sites[S.core.site];
    coreMesh.position.set(site.x, 1.35 + Math.sin(S.time * 3) * 0.05, site.z);
    coreMesh.visible = true;
    coreLight.intensity = S.core.detT < 10 ? 26 : 12;
  } else if (carrier && carrier.alive) {
    const back = { x: Math.sin(carrier.yaw), z: Math.cos(carrier.yaw) };
    coreMesh.position.set(carrier.pos.x + back.x * 0.3, carrier.pos.y + 1.42, carrier.pos.z + back.z * 0.3);
    coreMesh.visible = true;
    coreLight.intensity = 10;
  } else if (S.core.dropped) {
    coreMesh.position.set(S.core.x, 0.35 + Math.abs(Math.sin(S.time * 2.4)) * 0.12, S.core.z);
    coreMesh.visible = true;
    coreLight.intensity = 14;
  } else coreMesh.visible = false;

  for (let i = 0; i < nadeMeshes.length; i += 1) {
    const g = S.grenades[i];
    const m = nadeMeshes[i];
    if (g) {
      m.visible = true;
      m.position.set(g.x, g.y, g.z);
      m.rotation.x += dt * 9;
      m.material.color.set(g.kind === 'frag' ? 0x4a3a28 : 0x5a6058);
    } else m.visible = false;
  }
}

// --- The loop ---

function step(dt) {
  S.time += dt;
  drainPresses();
  stepMatch(dt);
  if (S.phase === 'buy' || S.phase === 'live') {
    stepPlayer(S, dt, audio);
    playerChannel();
    stepPlayerCombat();
    stepBots(S, dt);
  } else if (S.phase === 'end') {
    stepBots(S, dt);
  }
  stepChannels(dt);
  stepWeapons(S, dt);
  stepGrenades(S, dt, fx, audio);
  S.sounds.length = 0;
}

let last = performance.now();
let acc = 0;
let frozen = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!frozen) {
    if (S.phase !== 'menu' && S.phase !== 'over') {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 5) { step(STEP); acc -= STEP; n += 1; }
      if (acc > STEP * 5) acc = 0;
    }
    syncCamera(dt);
    syncProps(dt);
    fx.update(dt);
  }
  hud.update(dt);
  renderer.render(scene, camera);
}

function refreshPause() {
  const pause = document.getElementById('pause');
  const show = !shotMode && !S.input.locked && !S.input.buyOpen &&
    (S.phase === 'live' || S.phase === 'end') && S.phase !== 'menu';
  pause.style.display = show ? 'grid' : 'none';
}
document.getElementById('pause').addEventListener('click', () => input.requestLock());
renderer.domElement.addEventListener('click', () => {
  if (!shotMode && (S.phase === 'live' || S.phase === 'buy') && !S.input.buyOpen && !S.input.locked) {
    input.requestLock();
  }
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Screenshot staging: ?shot=1..4 builds one deterministic scene, poses
// every fighter, settles the sim for a fixed count of steps where the scene
// wants motion, paints twice, then freezes on window.__shotReady. ---

function place(f, x, z, yaw, pitch = 0) {
  f.pos.x = x;
  f.pos.y = 0;
  f.pos.z = z;
  f.vel.x = 0; f.vel.y = 0; f.vel.z = 0;
  f.yaw = yaw;
  f.pitch = pitch;
}
function gear(f, primaryKey, plated = true) {
  if (primaryKey) {
    f.guns.primary = freshGun(primaryKey);
    f.current = 'primary';
  }
  f.armor = plated;
  f.helmet = plated;
}
function faceAt(f, tx, tz) {
  f.yaw = Math.atan2(-(tx - f.pos.x), -(tz - f.pos.z));
}

function stageShot(n) {
  const [rook, piston, ember, sable] = S.fighters.slice(1, 5);
  const [bastion, circuit, halo, vex, onyx] = S.fighters.slice(5, 10);
  S.round = 3;
  S.score.union = 2;
  S.score.warden = 1;
  S.phase = 'live';
  S.phaseT = 64;
  gear(player, 'rifle');
  player.money = 1250;
  for (const f of S.fighters) if (!f.isPlayer) gear(f, 'rifle', f.team === 'warden');

  if (n === 1) {
    // Buy phase at the Union spawn: the supply menu open over the yard.
    S.phase = 'buy';
    S.phaseT = 9.4;
    S.input.buyOpen = true;
    player.money = 4650;
    player.guns.primary = null;
    player.current = 'pistol';
    player.armor = false;
    player.helmet = false;
    // Down the north lane: crates, teammates ahead, the Cradle A lamp glowing
    // at the far end — the buy menu overlays the right side.
    place(player, -34, -22, -Math.PI / 2 + 0.15);
    place(rook, -26, -20, -Math.PI / 2);
    place(piston, -28, -25, -Math.PI / 2 + 0.3);
    place(ember, -22, -17, -Math.PI / 2 - 0.2);
    place(sable, -30, -27, -Math.PI / 2);
    place(bastion, 42, -3, Math.PI / 2);
    place(circuit, 42, 3, Math.PI / 2);
    place(halo, 40, -6, Math.PI / 2);
    place(vex, 40, 6, Math.PI / 2);
    place(onyx, 44, 0, Math.PI / 2);
  } else if (n === 2) {
    // A live trade in the hall: the player and Bastion shoot it out while
    // Rook covers from the flank and Circuit pushes the far door.
    place(player, -9, -4.6, -Math.PI / 2, -0.028);
    place(bastion, 9, -4.5, Math.PI / 2, 0);
    bastion.helmet = false; // armour only: return fire dents, never one-taps
    place(rook, -5.5, 3.5, -Math.PI / 2 + 0.15);
    place(circuit, 14, 1, Math.PI / 2 + 0.25);
    place(piston, -13, -8, -Math.PI / 2);
    place(ember, -14, 5, -Math.PI / 2);
    place(sable, -20, 0, -Math.PI / 2);
    place(halo, 38, -14, Math.PI);
    place(vex, 30, 12, Math.PI);
    place(onyx, 40, 20, Math.PI);
    bastion.bot.enemy = player;
    bastion.bot.seenT = 0;
    bastion.bot.reactT = 0.05;
    S.input.firing = true;
    for (let i = 0; i < 26; i += 1) step(STEP);
    S.input.firing = false;
    player.hp = Math.min(player.hp, 71);
    bastion.hp = Math.max(bastion.hp, 40);
    // One frozen exchange of tracers for the capture.
    fx.muzzle(8.4, 1.5, -4.5, false);
    fx.tracer(8.4, 1.5, -4.5, -7.6, 1.35, -4.1);
    viewmodel.fire(false);
  } else if (n === 3) {
    // Piston plants at Cradle A under the player's cover, Rook on the crate line.
    const site = MAP.sites.A;
    place(player, 23.5, -14.5, 0);
    faceAt(player, 31, -19);
    place(piston, 30.2, -18.4, 0);
    faceAt(piston, site.x, site.z);
    piston.hasCore = true;
    S.core.carrier = piston;
    piston.channel = { kind: 'plant', t: 2.0, need: RULES.plantTime };
    place(rook, 26, -24.5, -Math.PI / 2);
    place(ember, 20, -10, -Math.PI / 2);
    place(sable, 16, -20, -Math.PI / 2);
    place(vex, 39, -13, Math.PI / 2 + 0.4);
    place(bastion, 42, -3, Math.PI / 2);
    place(circuit, 42, 3, Math.PI / 2);
    place(halo, 40, -6, Math.PI / 2);
    place(onyx, 44, 0, Math.PI / 2);
    S.feed.push({ text: 'Rook  ▸  Halo', t: 0, color: '#ff7a26' });
  } else {
    // Post-plant: Circuit is on the wires at Cradle A, Halo covers him, and
    // Ember is already down. Sixteen seconds on the clock.
    const site = MAP.sites.A;
    S.core.planted = true;
    S.core.site = 'A';
    S.core.x = site.x;
    S.core.z = site.z;
    S.core.detT = 16.4;
    place(player, 24.5, -12.5, 0);
    faceAt(player, 30.8, -19.2);
    player.hp = 58;
    place(circuit, 30.8, -19.2, Math.PI / 2);
    circuit.kit = true;
    circuit.channel = { kind: 'defuse', t: 4.6, need: RULES.defuseKitTime };
    place(halo, 37, -25, 0);
    faceAt(halo, player.pos.x, player.pos.z);
    place(ember, 27, -16, 0.8);
    ember.alive = false;
    ember.hp = 0;
    place(rook, 21, -21, -Math.PI / 2);
    place(piston, 18, -12, -Math.PI / 2);
    place(sable, 34, -8, Math.PI);
    place(bastion, 42, -3, Math.PI / 2);
    place(vex, 40, 6, Math.PI / 2);
    place(onyx, 44, 0, Math.PI / 2);
    S.feed.push({ text: 'Circuit  ▸  Sable', t: 0, color: '#2fd4c4' });
    notice('CORE PLANTED', 'Cradle A — 16 seconds to detonation', 99);
  }

  for (const f of S.fighters) syncMesh(f, 0.6);
  syncCamera(0.016);
  syncProps(0.016);
  viewmodel.update(0.008, player, false);
  hud.update(0.016);
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

if (shotMode) stageShot(shotMode);
else requestAnimationFrame(frame);

// Dev hook for automated playtests: only with ?debug=1, never in normal play.
if (params.get('debug') === '1') {
  window.__slag = { S, startMatch, buyItem, step, STEP, MAP, THREE };
}

