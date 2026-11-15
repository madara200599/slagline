// SLAGLINE — bots: low-poly rigs, round plans over the waypoint graph, and a
// brain that routes, holds, hears, sees, engages, plants and defuses. Bots use
// the same fire path, physics and economy as the player; only their input is
// synthetic.

import * as THREE from 'three';
import { MAP, nodeByTag, nearestNode } from './map.js';
import { moveBody, segBlocked, eyeHeight } from './physics.js';
import { makeFighter, currentDef, makeRng } from './state.js';
import { tryFire, startReload, switchTo, smokeBlocks } from './weapons.js';
import { WEAPONS, RULES } from './config.js';

const UNION_NAMES = ['Rook', 'Piston', 'Ember', 'Sable'];
const WARDEN_NAMES = ['Bastion', 'Circuit', 'Halo', 'Vex', 'Onyx'];

const teamMats = {
  union: new THREE.MeshStandardMaterial({ color: 0xb3541e, roughness: 0.8 }),
  warden: new THREE.MeshStandardMaterial({ color: 0x1e7a72, roughness: 0.8 }),
};
const darkMat = new THREE.MeshStandardMaterial({ color: 0x33373c, roughness: 0.9 });
const headMat = new THREE.MeshStandardMaterial({ color: 0x9a8d7a, roughness: 0.85 });
const visorMats = {
  union: new THREE.MeshStandardMaterial({ color: 0x180c02, emissive: 0xff7a26, emissiveIntensity: 1.4 }),
  warden: new THREE.MeshStandardMaterial({ color: 0x02140f, emissive: 0x2fd4c4, emissiveIntensity: 1.4 }),
};

function limb(w, h, d, mat, x, y, z) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0); // pivot at the top: swings from the joint
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildRig(team) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.28), teamMats[team]);
  torso.position.y = 1.09;
  torso.castShadow = true;
  g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.32), darkMat);
  vest.position.y = 1.12;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), headMat);
  head.position.y = 1.56;
  head.castShadow = true;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.02), visorMats[team]);
  visor.position.set(0, 1.58, -0.13);
  g.add(visor);
  const legL = limb(0.17, 0.8, 0.2, darkMat, -0.14, 0.8, 0);
  const legR = limb(0.17, 0.8, 0.2, darkMat, 0.14, 0.8, 0);
  g.add(legL, legR);
  const armR = limb(0.11, 0.62, 0.11, teamMats[team], 0.31, 1.36, 0);
  const armL = limb(0.11, 0.62, 0.11, teamMats[team], -0.31, 1.36, 0);
  armR.rotation.x = -1.35; // right arm levelled forward, holding the gun
  armL.rotation.x = -0.9;
  armL.rotation.z = -0.5;
  g.add(armR, armL);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.15, 0.62), darkMat);
  gun.position.set(0.31, 1.32, -0.34);
  g.add(gun);
  g.userData = { legL, legR, armR, torso };
  return g;
}

export function createBots(S, scene) {
  const bots = [];
  const rng = makeRng(20240); // fixed seed: bot skills are the same every load
  for (let i = 0; i < 4; i += 1) bots.push(makeFighter('union', UNION_NAMES[i], false));
  for (let i = 0; i < 5; i += 1) bots.push(makeFighter('warden', WARDEN_NAMES[i], false));
  for (const f of bots) {
    f.bot = {
      thinkT: rng() * 0.12, state: 'route', path: [], pathI: 0,
      destNode: -1, holdNode: -1, holdYaw: 0, scanT: 0,
      enemy: null, seenT: -99, lastX: 0, lastZ: 0, reactT: 0,
      burst: 0, burstWait: 0, strafeDir: 1, strafeT: 0,
      aimYaw: 0, aimPitch: 0, errYaw: 0, errPitch: 0,
      role: '', site: 'A', skill: 0.82 + rng() * 0.35,
      idleT: 0, shuffleT: 3 + rng() * 5,
      planNode: -1, stuckT: 0, dodgeT: 0, dodgeDir: 1,
    };
    f.mesh = buildRig(f.team);
    scene.add(f.mesh);
    S.fighters.push(f);
  }
  return bots;
}

// Breadth-first path over the waypoint graph; node indices in walk order.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of MAP.edges[cur]) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        const path = [to];
        let p = cur;
        while (p !== -1) { path.unshift(p); p = prev.get(p); }
        return path;
      }
      queue.push(next);
    }
  }
  return [from];
}

function setDest(S, f, node, state) {
  const b = f.bot;
  b.path = findPath(nearestNode(f.pos.x, f.pos.z), node);
  b.pathI = 0;
  b.destNode = node;
  if (state) b.state = state;
}

// Round plans. Attackers pick a site: the carrier and an escort take its lane,
// one takes mid, one the far lane, one flexes through the connector. Defenders
// split 2/2/1 across the cradles and mid and hold their angles.
export function assignPlans(S) {
  const rng = S.rng;
  const atk = S.attackTeam;
  const site = rng() < 0.5 ? 'A' : 'B';
  const siteNode = nodeByTag('site' + site)[0];
  const entryNode = nodeByTag('entry' + site)[0];
  const otherSite = site === 'A' ? 'B' : 'A';
  let carrier = null;
  const atkBots = [];
  for (const f of S.fighters) {
    if (f.team !== atk) continue;
    if (f.bot) f.bot.site = site;
    if (!f.isPlayer) atkBots.push(f);
    if (!carrier && !f.isPlayer) carrier = f;
  }
  // The core goes to a bot by default; the player may pick it up instead.
  if (carrier) { carrier.hasCore = true; S.core.carrier = carrier; }
  const roles = ['escort', 'mid', 'far', 'flex'];
  atkBots.forEach((f, i) => {
    const b = f.bot;
    if (f === carrier) {
      b.role = 'carrier';
      setDest(S, f, entryNode, 'route');
    } else {
      b.role = roles[i - 1] ?? 'flex';
      if (b.role === 'escort') setDest(S, f, entryNode, 'route');
      else if (b.role === 'mid') setDest(S, f, nodeByTag('holdMid')[0], 'route');
      else if (b.role === 'far') setDest(S, f, nodeByTag('entry' + otherSite)[0], 'route');
      else setDest(S, f, site === 'A' ? nodeByTag('vent')[0] : nodeByTag('duct')[0], 'route');
    }
    b.planNode = b.destNode;
  });
  const defs = S.fighters.filter((f) => f.team !== atk && !f.isPlayer);
  const holdPlan = [
    { node: nodeByTag('holdA')[0], yaw: Math.PI / 2 }, { node: nodeByTag('siteA')[0], yaw: Math.PI / 2 + 0.35 },
    { node: nodeByTag('holdB')[0], yaw: Math.PI / 2 }, { node: nodeByTag('siteB')[0], yaw: Math.PI / 2 - 0.35 },
    { node: nodeByTag('holdMid')[0], yaw: Math.PI / 2 },
  ];
  defs.forEach((f, i) => {
    const plan = holdPlan[i % holdPlan.length];
    f.bot.role = 'hold';
    f.bot.holdNode = plan.node;
    f.bot.planNode = plan.node;
    f.bot.holdYaw = plan.yaw + (rng() - 0.5) * 0.4;
    setDest(S, f, plan.node, 'route');
  });
  // The defending player gets no orders; attacking player teammates follow the plan.
  const player = S.fighters[0];
  if (player.team === atk && !carrier) { player.hasCore = true; S.core.carrier = player; }
}

// --- Perception ---

function canSee(S, f, e) {
  const dx = e.pos.x - f.pos.x;
  const dz = e.pos.z - f.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 62) return false;
  if (dist > 4) {
    const fx = -Math.sin(f.yaw);
    const fz = -Math.cos(f.yaw);
    if ((dx * fx + dz * fz) / dist < 0.28) return false; // ~106 degree cone
  }
  const eye = eyeHeight(f);
  if (segBlocked(MAP.boxes, f.pos.x, eye, f.pos.z, e.pos.x, e.pos.y + 1.05, e.pos.z, 'sight')) return false;
  if (smokeBlocks(S, f.pos.x, eye, f.pos.z, e.pos.x, e.pos.y + 1.05, e.pos.z)) return false;
  return true;
}

function nearestVisibleEnemy(S, f) {
  let best = null;
  let bestD = Infinity;
  for (const e of S.fighters) {
    if (!e.alive || e.team === f.team) continue;
    if (!canSee(S, f, e)) continue;
    const d = Math.hypot(e.pos.x - f.pos.x, e.pos.z - f.pos.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// --- Decisions (run at ~8 Hz per bot, staggered) ---

function think(S, f) {
  const b = f.bot;
  const rng = S.rng;
  // Hearing: gunfire and blasts pull a bot to investigate — holders leave
  // their post for anything in earshot, plan-followers only for close noise.
  for (const s of S.sounds) {
    if (s.team === f.team) continue;
    const d = Math.hypot(s.x - f.pos.x, s.z - f.pos.z);
    if (d < s.radius && !b.enemy && (b.state === 'hold' || d < 16)) {
      b.lastX = s.x;
      b.lastZ = s.z;
      if (b.state === 'hold' || b.state === 'route') {
        setDest(S, f, nearestNode(s.x, s.z), 'investigate');
      }
    }
  }
  const seen = nearestVisibleEnemy(S, f);
  if (seen) {
    if (b.enemy !== seen) {
      b.enemy = seen;
      b.reactT = (0.26 + rng() * 0.22) / b.skill;
      b.burst = 0;
      b.burstWait = 0;
    }
    b.seenT = S.time;
    b.lastX = seen.pos.x;
    b.lastZ = seen.pos.z;
  } else if (b.enemy && S.time - b.seenT > 0.5) {
    b.enemy = null;
    if (b.state !== 'plant' && b.state !== 'defuse' && b.state !== 'retake') {
      setDest(S, f, nearestNode(b.lastX, b.lastZ), 'investigate');
    }
  }

  const myTeamAttacks = f.team === S.attackTeam;
  if (S.core.planted) {
    const site = MAP.sites[S.core.site];
    if (myTeamAttacks) {
      // Post-plant: hold ground near the cradle, watching the approaches.
      if (b.state !== 'hold' && !b.enemy) {
        const near = nodeByTag('site' + S.core.site);
        setDest(S, f, near[(f.id + 1) % near.length], 'route');
        b.holdNode = near[(f.id + 1) % near.length];
        b.holdYaw = Math.atan2(-(site.x - f.pos.x), -(site.z - f.pos.z)) + Math.PI;
        b.postPlant = true;
      }
    } else if (b.state !== 'defuse') {
      b.state = 'retake';
      setDest(S, f, nearestNode(site.x, site.z), 'retake');
    }
    return;
  }
  if (b.state === 'investigate' && b.pathI >= b.path.length) {
    // Found nothing: defenders return to their post, attackers resume the plan.
    if (!myTeamAttacks && b.holdNode >= 0) setDest(S, f, b.holdNode, 'route');
    else if (f.hasCore) setDest(S, f, nodeByTag('entry' + b.site)[0], 'route');
    else if (b.planNode >= 0) setDest(S, f, b.planNode, 'route');
    else b.state = 'hold';
  }
  if (b.state === 'route' && b.pathI >= b.path.length) {
    b.state = 'hold';
    if (b.holdNode === b.destNode) b.holdYaw = b.holdYaw || f.yaw;
    else if (f.team === S.attackTeam) {
      // Attackers who arrive early watch the cradle they mean to take.
      const site = MAP.sites[b.site];
      b.holdYaw = Math.atan2(-(site.x - f.pos.x), -(site.z - f.pos.z));
    }
  }
  // The carrier commits: once it reaches the lane entry it pushes the last
  // metres to the cradle itself, then plants.
  if (f.hasCore && !S.core.planted) {
    const site = MAP.sites[b.site];
    const dSite = Math.hypot(site.x - f.pos.x, site.z - f.pos.z);
    if (dSite < RULES.siteRadius + 1.5) b.state = 'plant';
    else if (b.state === 'hold' || b.pathI >= b.path.length) {
      setDest(S, f, nodeByTag('site' + b.site).at(-1), 'route');
    }
  }
  // A dropped core is worth a detour for the nearest attacker.
  if (S.core.dropped && myTeamAttacks && !f.hasCore && b.state !== 'plant') {
    let nearest = true;
    for (const o of S.fighters) {
      if (o.alive && o.team === f.team && o !== f && !o.isPlayer) {
        if (Math.hypot(o.pos.x - S.core.x, o.pos.z - S.core.z) < Math.hypot(f.pos.x - S.core.x, f.pos.z - S.core.z)) nearest = false;
      }
    }
    if (nearest) setDest(S, f, nearestNode(S.core.x, S.core.z), 'route');
  }
  // Reload discipline: never sit on an empty mag out of a fight.
  const gun = f.guns[f.current];
  if (!b.enemy && gun && gun.mag === 0 && gun.reserve > 0) startReload(S, f, S.audioRef);
  if (!b.enemy && gun && gun.mag < WEAPONS[gun.key].mag * 0.3 && gun.reserve > 0 && b.state === 'hold') {
    startReload(S, f, S.audioRef);
  }
}

// --- Acting (every tick) ---

function faceToward(f, tx, tz, dt, rate = 7) {
  const want = Math.atan2(-(tx - f.pos.x), -(tz - f.pos.z));
  let diff = want - f.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const turn = Math.max(-rate * dt, Math.min(rate * dt, diff));
  f.yaw += turn;
  return Math.abs(diff) < 0.06;
}

function moveToward(S, f, tx, tz, dt, speedScale = 0.94) {
  const dx = tx - f.pos.x;
  const dz = tz - f.pos.z;
  const dist = Math.hypot(dx, dz);
  const def = currentDef(f);
  const max = def.speed * speedScale * (f.crouch ? 0.45 : 1);
  const want = dist > 0.05 ? max : 0;
  const txv = dist > 0.05 ? (dx / dist) * want : 0;
  const tzv = dist > 0.05 ? (dz / dist) * want : 0;
  const k = Math.min(1, dt * 9);
  f.vel.x += (txv - f.vel.x) * k;
  f.vel.z += (tzv - f.vel.z) * k;
  moveBody(MAP.boxes, f, dt);
  return dist;
}

function engage(S, f, dt) {
  const b = f.bot;
  const e = b.enemy;
  const rng = S.rng;
  // Aim at the chest with a per-burst error that shrinks as the bot settles.
  const dx = e.pos.x - f.pos.x;
  const dz = e.pos.z - f.pos.z;
  const dist = Math.hypot(dx, dz) || 1;
  const aimY = e.pos.y + (e.crouch ? 0.85 : 1.12);
  const eye = eyeHeight(f);
  const wantYaw = Math.atan2(-dx, -dz) + b.errYaw;
  const wantPitch = Math.atan2(aimY - eye, dist) + b.errPitch;
  let dy = wantYaw - f.yaw;
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  f.yaw += Math.max(-8 * dt, Math.min(8 * dt, dy));
  f.pitch += Math.max(-6 * dt, Math.min(6 * dt, wantPitch - f.pitch));

  // Range-keeping and strafing between bursts.
  b.strafeT -= dt;
  if (b.strafeT <= 0) {
    b.strafeT = 0.6 + rng() * 0.9;
    b.strafeDir = rng() < 0.5 ? -1 : 1;
    b.errYaw = (rng() * 2 - 1) * (0.012 + dist * 0.0006) / b.skill;
    b.errPitch = (rng() * 2 - 1) * 0.008 / b.skill;
  }
  const gunKey = f.guns[f.current]?.key ?? 'pistol';
  const band = gunKey === 'sniper' ? [22, 46] : gunKey === 'smg' ? [5, 15] : gunKey === 'rifle' ? [10, 27] : [7, 18];
  const px = (-dz / dist) * b.strafeDir;
  const pz = (dx / dist) * b.strafeDir;
  let mx = px * 0.8;
  let mz = pz * 0.8;
  if (dist < band[0]) { mx += (dx / dist) * 0.7; mz += (dz / dist) * 0.7; }
  if (dist > band[1]) { mx -= (dx / dist) * 0.8; mz -= (dz / dist) * 0.8; }
  const ml = Math.hypot(mx, mz) || 1;
  const spd = currentDef(f).speed * 0.55;
  f.vel.x += ((mx / ml) * spd - f.vel.x) * Math.min(1, dt * 8);
  f.vel.z += ((mz / ml) * spd - f.vel.z) * Math.min(1, dt * 8);
  moveBody(MAP.boxes, f, dt);

  // Fire control: reaction delay, then bursts with pauses.
  if (b.reactT > 0) { b.reactT -= dt; return; }
  if (f.reloadT > 0) return;
  const gun = f.guns[f.current];
  if (gun && gun.mag <= 0) { startReload(S, f, S.audioRef); return; }
  if (b.burstWait > 0) { b.burstWait -= dt; return; }
  if (b.burst <= 0) {
    b.burst = dist < 9 ? 6 : dist < 22 ? 4 : 3;
    if (gunKey === 'sniper' || gunKey === 'pistol') b.burst = 1;
  }
  if (tryFire(S, f, S.fxRef, S.audioRef)) {
    b.burst -= 1;
    if (b.burst <= 0) b.burstWait = (0.34 + rng() * 0.4) / b.skill;
  }
}

export function stepBots(S, dt) {
  for (const f of S.fighters) {
    if (f.isPlayer) continue;
    const b = f.bot;
    syncMesh(f, dt);
    if (!f.alive) continue;
    b.thinkT -= dt;
    if (b.thinkT <= 0) {
      b.thinkT = 0.12;
      think(S, f);
    }
    if (S.phase !== 'live' && S.phase !== 'buy') continue;
    if (f.channel) {
      f.vel.x = 0;
      f.vel.z = 0;
      moveBody(MAP.boxes, f, dt);
      // Face the cradle while channelling.
      const site = MAP.sites[S.core.site ?? b.site];
      if (site) faceToward(f, site.x, site.z, dt, 4);
      continue;
    }
    if (b.enemy && S.time - b.seenT < 0.6 && S.phase === 'live') {
      engage(S, f, dt);
      continue;
    }
    if (b.state === 'plant') {
      const site = MAP.sites[b.site];
      const d = moveToward(S, f, site.x + 1.6, site.z + 1.2, dt, 0.9);
      faceToward(f, site.x, site.z, dt, 4);
      if (d < 1.4 && S.phase === 'live' && !S.core.planted) {
        f.channel = { kind: 'plant', t: 0, need: RULES.plantTime };
      }
      continue;
    }
    if (b.state === 'retake') {
      const site = MAP.sites[S.core.site];
      const d = Math.hypot(site.x - f.pos.x, site.z - f.pos.z);
      if (d < 4.0 && S.phase === 'live') {
        // Defuse when the site looks clear; a visible enemy breaks it off.
        if (!nearestVisibleEnemy(S, f)) {
          f.channel = { kind: 'defuse', t: 0, need: f.kit ? RULES.defuseKitTime : RULES.defuseTime };
          b.state = 'defuse';
        }
      }
      followPath(S, f, dt);
      continue;
    }
    if (b.state === 'hold') {
      // Settle, scan the assigned angle, shuffle a step now and then.
      b.scanT += dt;
      f.yaw = b.holdYaw + Math.sin(b.scanT * 0.55 + f.id) * 0.45;
      f.pitch = 0;
      b.shuffleT -= dt;
      if (b.shuffleT <= 0) {
        b.shuffleT = 4 + S.rng() * 5;
        const node = MAP.nodes[b.holdNode >= 0 ? b.holdNode : nearestNode(f.pos.x, f.pos.z)];
        if (node) moveToward(S, f, node.x + (S.rng() - 0.5) * 2.4, node.z + (S.rng() - 0.5) * 2.4, dt, 0.5);
      } else {
        f.vel.x *= 0.8;
        f.vel.z *= 0.8;
        moveBody(MAP.boxes, f, dt);
      }
      continue;
    }
    followPath(S, f, dt);
  }
}

function followPath(S, f, dt) {
  const b = f.bot;
  while (b.pathI < b.path.length) {
    const node = MAP.nodes[b.path[b.pathI]];
    const d = Math.hypot(node.x - f.pos.x, node.z - f.pos.z);
    if (d < 1.15) { b.pathI += 1; continue; }
    faceToward(f, node.x, node.z, dt, 6);
    // Unstick: if the body barely moves while a node is still ahead, sidestep
    // around whatever is in the way (a crate edge, a door frame) and re-aim.
    if (f.speed2d < 0.35) b.stuckT += dt;
    else b.stuckT = 0;
    if (b.stuckT > 0.5 && b.dodgeT <= 0) {
      b.dodgeT = 0.8;
      b.dodgeDir = S.rng() < 0.5 ? -1 : 1;
      b.stuckT = 0;
    }
    let tx = node.x;
    let tz = node.z;
    if (b.dodgeT > 0) {
      b.dodgeT -= dt;
      const inv = 1 / (d || 1);
      tx += -(node.z - f.pos.z) * inv * b.dodgeDir * 2.6;
      tz += (node.x - f.pos.x) * inv * b.dodgeDir * 2.6;
    }
    moveToward(S, f, tx, tz, dt);
    return;
  }
  f.vel.x *= 0.8;
  f.vel.z *= 0.8;
  moveBody(MAP.boxes, f, dt);
}

// Mesh follows the body: walk swing, crouch squash, death fall.
export function syncMesh(f, dt) {
  const m = f.mesh;
  if (!m) return;
  m.position.set(f.pos.x, f.pos.y, f.pos.z);
  m.rotation.y = f.yaw;
  const u = m.userData;
  if (!f.alive) {
    m.rotation.x = Math.max(-Math.PI / 2, m.rotation.x - dt * 5);
    m.position.y = f.pos.y + 0.12;
    return;
  }
  m.rotation.x = 0;
  const swing = Math.sin(performance.now() * 0.012 * Math.max(0.4, f.speed2d)) * Math.min(1, f.speed2d / 4);
  u.legL.rotation.x = swing * 0.7;
  u.legR.rotation.x = -swing * 0.7;
  u.torso.position.y = f.crouch ? 0.86 : 1.09;
  u.armR.rotation.x = -1.35 + f.pitch * 0.7;
  m.scale.y = f.crouch ? 0.86 : 1;
}
// Bot shopping, shared rules with the player's buy menu (see main.buyItem):
// a primary first, then plating, then toys with what is left.
export function botBuy(S, f, buyItem) {
  const rng = S.rng;
  const want = [];
  if (!f.guns.primary) want.push(f.money >= 2700 && rng() < 0.8 ? 'rifle' : 'smg');
  if (!f.armor) want.push(f.money >= 1000 ? 'armorhelm' : 'armor');
  if (f.team !== S.attackTeam && !f.kit) want.push('kit');
  if (f.nades.frag === 0) want.push('frag');
  if (f.nades.smoke === 0 && rng() < 0.6) want.push('smoke');
  if (!f.guns.primary && f.money >= 4300 && rng() < 0.25) want.unshift('sniper');
  for (const key of want) buyItem(S, f, key, true);
}

export function resetBot(f) {
  const b = f.bot;
  b.state = 'route';
  b.path = [];
  b.pathI = 0;
  b.enemy = null;
  b.seenT = -99;
  b.postPlant = false;
  f.channel = null;
}

