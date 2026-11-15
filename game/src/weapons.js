// SLAGLINE — weapons: hitscan fire with body-part zones, recoil and spread,
// armour, melee, grenades, reloads and the first-person viewmodel. One fire
// path serves the player and every bot, so the gunplay rules cannot drift.

import * as THREE from 'three';
import { WEAPONS, ECON } from './config.js';
import { MAP } from './map.js';
import { raycastWorld, segBlocked, eyeHeight } from './physics.js';
import { currentDef, currentGun } from './state.js';
import { spatial } from './audio.js';

const ZONE_MULT = { head: 4, chest: 1, stomach: 1.25, legs: 0.75 };
const tmpDir = { x: 0, y: 0, z: 0 };

export function aimDir(f, out) {
  const cp = Math.cos(f.pitch);
  out.x = -Math.sin(f.yaw) * cp;
  out.y = Math.sin(f.pitch);
  out.z = -Math.cos(f.yaw) * cp;
  return out;
}

// Body zones for one fighter, crouch-aware: head sphere + three stacked boxes.
function rayFighter(o, d, f) {
  const crouch = f.crouch;
  const hx = f.pos.x;
  const hz = f.pos.z;
  const base = f.pos.y;
  const headY = base + (crouch ? 1.06 : 1.5);
  let best = Infinity;
  let zone = null;
  // Head sphere.
  const ox = o.x - hx;
  const oy = o.y - headY;
  const oz = o.z - hz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - 0.21 * 0.21;
  const disc = b * b - c;
  if (disc > 0) {
    const t = -b - Math.sqrt(disc);
    if (t > 0 && t < best) { best = t; zone = 'head'; }
  }
  // Stacked boxes: legs, stomach, chest.
  const spans = crouch
    ? [[0.02, 0.36, 'legs'], [0.36, 0.64, 'stomach'], [0.64, 1.0, 'chest']]
    : [[0.02, 0.62, 'legs'], [0.62, 0.98, 'stomach'], [0.98, 1.44, 'chest']];
  for (const [lo, hi, name] of spans) {
    let t0 = 0;
    let t1 = best;
    let ok = true;
    const axes = [
      [o.x, d.x, hx - 0.34, hx + 0.34],
      [o.y, d.y, base + lo, base + hi],
      [o.z, d.z, hz - 0.34, hz + 0.34],
    ];
    for (const [oo, dd, mn, mx] of axes) {
      if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) { ok = false; break; } } else {
        let ta = (mn - oo) / dd;
        let tb = (mx - oo) / dd;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 < best && t0 > 0) { best = t0; zone = name; }
  }
  return zone ? { t: best, zone } : null;
}

export function applyDamage(S, victim, amount, zone, attacker, fx, audio) {
  if (!victim.alive || S.phase !== 'live') return false;
  let mult = 1;
  if (zone === 'chest' || zone === 'stomach') mult = victim.armor ? 0.5 : 1;
  else if (zone === 'head') mult = victim.helmet ? 0.55 : 1;
  const dmg = amount * mult;
  victim.hp -= dmg;
  victim.hurtT = 0;
  victim.hurtFresh = true;
  victim.hurtFrom = attacker ? Math.atan2(attacker.pos.x - victim.pos.x, attacker.pos.z - victim.pos.z) : victim.hurtFrom;
  if (victim.isPlayer) audio.hurt();
  if (victim.hp > 0) return false;
  victim.hp = 0;
  victim.alive = false;
  victim.deaths += 1;
  victim.channel = null;
  if (victim.hasCore) {
    victim.hasCore = false;
    S.core.dropped = true;
    S.core.x = victim.pos.x;
    S.core.z = victim.pos.z;
    S.core.carrier = null;
  }
  if (attacker && attacker !== victim) {
    attacker.kills += 1;
    attacker.money = Math.min(ECON.maxMoney, attacker.money + ECON.kill);
    if (attacker.isPlayer) { audio.hit(true); if (S.onPlayerHit) S.onPlayerHit(true); }
  }
  S.feed.push({
    text: `${attacker ? attacker.name : 'The foundry'}  ▸  ${victim.name}`,
    t: S.time,
    color: attacker && attacker.team === 'union' ? '#ff7a26' : '#2fd4c4',
  });
  if (S.feed.length > 5) S.feed.shift();
  return true;
}

// Fire the held weapon once. Returns true when a shot actually left.
export function tryFire(S, f, fx, audio) {
  if (!f.alive || f.fireT > 0 || f.reloadT > 0 || f.swapT > 0 || f.channel) return false;
  const def = currentDef(f);
  if (f.current === 'knife') {
    f.fireT = 60 / def.rpm;
    audio.shot('knife', f.isPlayer ? 0.7 : spatial(S, f.pos.x, f.pos.z, 0.5).vol, 0);
    aimDir(f, tmpDir);
    for (const e of S.fighters) {
      if (!e.alive || e.team === f.team) continue;
      const dx = e.pos.x - f.pos.x;
      const dz = e.pos.z - f.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > def.range + 0.3 || Math.abs(e.pos.y - f.pos.y) > 1.6) continue;
      if ((dx * tmpDir.x + dz * tmpDir.z) / (dist || 1) < 0.4) continue;
      // Behind the victim: their facing aligns with the attacker->victim line.
      const behind = (-Math.sin(e.yaw) * dx - Math.cos(e.yaw) * dz) / (dist || 1);
      applyDamage(S, e, behind > 0.4 ? 150 : def.damage, 'chest', f, fx, audio);
      if (f.isPlayer) audio.hit(false);
      return true;
    }
    return true;
  }
  const gun = currentGun(f);
  if (!gun) return false;
  if (gun.mag <= 0) {
    f.fireT = 0.3;
    if (f.isPlayer) audio.dryFire();
    startReload(S, f, audio);
    return false;
  }
  gun.mag -= 1;
  f.fireT = 60 / def.rpm;
  const rng = S.rng;

  // Spread: base cone + movement bloom + air penalty, eased by crouch and ADS;
  // the scoped Longshot is only honest while actually scoped.
  let spread = def.spread + def.bloom * Math.min(1, f.speed2d / 5.2) + (f.onGround ? 0 : 0.03);
  if (f.crouch) spread *= 0.7;
  if (f.ads) spread *= 0.72;
  if (def.zoom) spread = f.scoped ? 0.0009 : def.spread + def.bloom * Math.min(1, f.speed2d / 5.2);
  spread += f.recoil * 0.0011;

  aimDir(f, tmpDir);
  // Recoil bends the shot up and a little sideways; it recovers in stepWeapons.
  tmpDir.y += f.recoil * 0.010 + (rng() * 2 - 1) * spread;
  tmpDir.x += (rng() * 2 - 1) * spread;
  tmpDir.z += (rng() * 2 - 1) * spread;
  const len = Math.hypot(tmpDir.x, tmpDir.y, tmpDir.z) || 1;
  tmpDir.x /= len; tmpDir.y /= len; tmpDir.z /= len;
  f.recoil = Math.min(6, f.recoil + (gun.key === 'sniper' ? 3.2 : def.rpm > 500 ? 0.55 : 0.85));

  const eye = eyeHeight(f);
  const o = { x: f.pos.x, y: eye, z: f.pos.z };
  const wallT = raycastWorld(MAP.boxes, o.x, o.y, o.z, tmpDir.x, tmpDir.y, tmpDir.z, def.range);
  let bestT = wallT;
  let bestF = null;
  let bestZone = null;
  for (const e of S.fighters) {
    if (!e.alive || e.team === f.team || e === f) continue;
    const hit = rayFighter(o, tmpDir, e);
    if (hit && hit.t < bestT) { bestT = hit.t; bestF = e; bestZone = hit.zone; }
  }
  const hx = o.x + tmpDir.x * bestT;
  const hy = o.y + tmpDir.y * bestT;
  const hz = o.z + tmpDir.z * bestT;
  // Muzzle point for the tracer: just ahead of the shooter's chest.
  const mx = f.pos.x + tmpDir.x * 0.55;
  const my = eye - 0.14 + tmpDir.y * 0.55;
  const mz = f.pos.z + tmpDir.z * 0.55;
  fx.tracer(mx, my, mz, hx, hy, hz);
  fx.muzzle(mx, my, mz, gun.key === 'sniper');
  if (bestF) {
    const fall = bestT <= 15 ? 1 : 1 - 0.45 * Math.min(1, (bestT - 15) / 50);
    fx.impact(hx, hy, hz, 'flesh');
    const killed = applyDamage(S, bestF, def.damage * ZONE_MULT[bestZone] * fall, bestZone, f, fx, audio);
    if (f.isPlayer && !killed) { audio.hit(false); if (S.onPlayerHit) S.onPlayerHit(false); }
  } else if (bestT < def.range) {
    fx.impact(hx, hy, hz, 'dust');
  }
  const sp = f.isPlayer ? { vol: 0.95, pan: 0 } : spatial(S, f.pos.x, f.pos.z);
  audio.shot(gun.key, sp.vol, sp.pan);
  S.sounds.push({ x: f.pos.x, z: f.pos.z, radius: 34, team: f.team, kind: 'shot' });
  return true;
}

export function startReload(S, f, audio) {
  const gun = currentGun(f);
  if (!gun || f.reloadT > 0) return;
  const def = WEAPONS[gun.key];
  if (gun.mag >= def.mag || gun.reserve <= 0) return;
  f.reloadT = def.reload;
  f.scoped = false;
  if (f.isPlayer) audio.reload();
}

export function switchTo(S, f, slot) {
  if (f.current === slot || f.swapT > 0) return;
  if (slot !== 'knife' && !f.guns[slot]) return;
  f.current = slot;
  f.reloadT = 0;
  f.scoped = false;
  f.swapT = slot === 'knife' ? 0.22 : 0.34;
}

// Per-fighter timers: fire rate, reload completion, recoil recovery.
export function stepWeapons(S, dt) {
  for (const f of S.fighters) {
    if (f.fireT > 0) f.fireT -= dt;
    if (f.swapT > 0) f.swapT -= dt;
    f.recoil *= Math.exp(-6.5 * dt);
    if (f.recoil < 0.01) f.recoil = 0;
    if (f.reloadT > 0) {
      f.reloadT -= dt;
      if (f.reloadT <= 0) {
        const gun = currentGun(f);
        if (gun) {
          const def = WEAPONS[gun.key];
          const take = Math.min(def.mag - gun.mag, gun.reserve);
          gun.mag += take;
          gun.reserve -= take;
        }
      }
    }
    if (f.hurtT < 9) f.hurtT += dt;
  }
}

// --- Grenades ---

export function throwGrenade(S, f, kind, fx, audio) {
  if (!f.alive || f.nades[kind] <= 0 || f.fireT > 0 || f.channel) return false;
  f.nades[kind] -= 1;
  f.fireT = 0.45;
  aimDir(f, tmpDir);
  const eye = eyeHeight(f);
  S.grenades.push({
    kind,
    x: f.pos.x + tmpDir.x * 0.4, y: eye + 0.1, z: f.pos.z + tmpDir.z * 0.4,
    vx: tmpDir.x * 16 + f.vel.x * 0.5, vy: tmpDir.y * 16 + 3.2, vz: tmpDir.z * 16 + f.vel.z * 0.5,
    fuse: kind === 'frag' ? 1.5 : 1.15,
    owner: f,
  });
  audio.throwNade();
  return true;
}

function explodeFrag(S, g, fx, audio) {
  fx.explosion(g.x, g.y, g.z);
  const sp = spatial(S, g.x, g.z);
  audio.explosion(Math.max(0.25, sp.vol), sp.pan);
  const p = S.fighters[0];
  const pd = Math.hypot(p.pos.x - g.x, p.pos.z - g.z);
  S.shake = Math.min(1, S.shake + Math.max(0, 1 - pd / 16));
  S.sounds.push({ x: g.x, z: g.z, radius: 46, team: g.owner.team, kind: 'boom' });
  for (const e of S.fighters) {
    if (!e.alive) continue;
    if (e.team === g.owner.team && e !== g.owner) continue; // no friendly fire, own blast still bites
    const dx = e.pos.x - g.x;
    const dy = (e.pos.y + 0.9) - g.y;
    const dz = e.pos.z - g.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 6.5) continue;
    const blocked = segBlocked(MAP.boxes, g.x, g.y + 0.2, g.z, e.pos.x, e.pos.y + 0.9, e.pos.z, 'bullet');
    const dmg = (110 * Math.pow(Math.max(0, 1 - dist / 6.5), 1.15) + 6) * (blocked ? 0.3 : 1);
    if (dmg >= 2) applyDamage(S, e, dmg, 'chest', g.owner, fx, audio);
  }
}

export function stepGrenades(S, dt, fx, audio) {
  for (let i = S.grenades.length - 1; i >= 0; i -= 1) {
    const g = S.grenades[i];
    g.fuse -= dt;
    g.vy -= 15 * dt;
    let nx = g.x + g.vx * dt;
    let nz = g.z + g.vz * dt;
    let ny = g.y + g.vy * dt;
    // Bounce off box sides by axis, then off the floor.
    for (const axis of ['x', 'z']) {
      const tx = axis === 'x' ? nx : g.x;
      const tz = axis === 'z' ? nz : g.z;
      let inside = false;
      for (const b of MAP.boxes) {
        if (!b.solid) continue;
        if (Math.abs(tx - b.x) < b.hx + 0.1 && Math.abs(tz - b.z) < b.hz + 0.1 && ny > b.y0 && ny < b.y1) { inside = true; break; }
      }
      if (inside) {
        if (axis === 'x') { g.vx *= -0.42; nx = g.x; } else { g.vz *= -0.42; nz = g.z; }
      }
    }
    if (ny < 0.14) {
      ny = 0.14;
      g.vy = Math.abs(g.vy) > 1.2 ? -g.vy * 0.38 : 0;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    g.x = nx; g.y = ny; g.z = nz;
    if (g.fuse <= 0) {
      S.grenades.splice(i, 1);
      if (g.kind === 'frag') explodeFrag(S, g, fx, audio);
      else {
        S.smokes.push({ x: g.x, y: 0, z: g.z, r: 4.6, until: S.time + 15 });
        fx.smoke(g.x, 0, g.z, 4.6, 15);
        audio.smoke();
      }
    }
  }
  for (let i = S.smokes.length - 1; i >= 0; i -= 1) {
    if (S.time > S.smokes[i].until) S.smokes.splice(i, 1);
  }
}

// True when the segment passes through any live smoke volume (bots and the
// defuse check use it; bullets do not care).
export function smokeBlocks(S, ax, ay, az, bx, by, bz) {
  for (const s of S.smokes) {
    // Distance from the smoke centre to the segment, in the horizontal plane
    // plus a height band: smoke fills y 0..4.
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((s.x - ax) * dx + (s.z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const py = ay + (by - ay) * t;
    if (Math.hypot(px - s.x, pz - s.z) < s.r && py < 4.2) return true;
  }
  return false;
}

// --- First-person viewmodel: low-poly guns built from boxes and cylinders,
// one per slot, with kick, reload dip, raise and walk-bob animation. ---

export function createViewmodel(camera) {
  const group = new THREE.Group();
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2e3236, roughness: 0.45, metalness: 0.7 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x4c3a28, roughness: 0.9 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0xff7a26, roughness: 0.5, metalness: 0.3, emissive: 0xff7a26, emissiveIntensity: 0.25 });
  const B = (mat, w, h, d, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    return m;
  };
  const C = (mat, r, len, x, y, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  };
  function buildGun(kind) {
    const g = new THREE.Group();
    if (kind === 'knife') {
      g.add(B(gripMat, 0.035, 0.05, 0.16, 0, -0.02, 0.02));
      g.add(B(darkMetal, 0.008, 0.045, 0.3, 0, 0.01, -0.22));
    } else if (kind === 'pistol') {
      g.add(B(darkMetal, 0.05, 0.07, 0.24, 0, 0, -0.05));
      g.add(B(gripMat, 0.045, 0.13, 0.06, 0, -0.09, 0.05, 0.25));
      g.add(B(accentMat, 0.052, 0.012, 0.1, 0, 0.042, -0.08));
    } else if (kind === 'smg') {
      g.add(B(darkMetal, 0.07, 0.11, 0.42, 0, 0, -0.1));
      g.add(C(darkMetal, 0.045, 0.12, 0, -0.1, -0.16));
      g.add(B(gripMat, 0.05, 0.12, 0.06, 0, -0.1, 0.08, 0.25));
      g.add(B(darkMetal, 0.04, 0.04, 0.18, 0, 0.01, -0.36));
    } else if (kind === 'sniper') {
      g.add(B(darkMetal, 0.06, 0.09, 0.6, 0, 0, -0.12));
      g.add(C(darkMetal, 0.016, 0.42, 0, 0.02, -0.6));
      g.add(C(darkMetal, 0.028, 0.17, 0, 0.09, -0.18));
      g.add(B(gripMat, 0.05, 0.13, 0.07, 0, -0.09, 0.14, 0.3));
      g.add(B(darkMetal, 0.05, 0.1, 0.09, 0, -0.08, -0.12, -0.2));
    } else { // rifle
      g.add(B(darkMetal, 0.06, 0.1, 0.55, 0, 0, -0.12));
      g.add(C(darkMetal, 0.02, 0.3, 0, 0.015, -0.5));
      g.add(B(darkMetal, 0.045, 0.14, 0.07, 0, -0.11, -0.08, -0.15));
      g.add(B(gripMat, 0.05, 0.12, 0.06, 0, -0.09, 0.1, 0.25));
      g.add(B(gripMat, 0.05, 0.08, 0.2, 0, -0.01, 0.24));
      g.add(B(accentMat, 0.062, 0.014, 0.16, 0, 0.055, -0.2));
      g.add(B(darkMetal, 0.02, 0.05, 0.02, 0, 0.085, -0.3));
    }
    g.visible = false;
    group.add(g);
    return g;
  }
  const models = {
    knife: buildGun('knife'),
    pistol: buildGun('pistol'),
    smg: buildGun('smg'),
    rifle: buildGun('rifle'),
    sniper: buildGun('sniper'),
  };
  // Muzzle flash: a four-point star sprite that lives for a few frames at the
  // barrel tip — a canvas star, additive, never a plain card.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = flashCanvas.height = 128;
  const fctx = flashCanvas.getContext('2d');
  const grad = fctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,180,80,0.75)');
  grad.addColorStop(1, 'rgba(255,140,40,0)');
  fctx.fillStyle = grad;
  fctx.beginPath();
  for (let i = 0; i < 8; i += 1) {
    const r = i % 2 === 0 ? 62 : 13;
    const a = (i / 8) * Math.PI * 2;
    const px = 64 + Math.cos(a) * r;
    const py = 64 + Math.sin(a) * r;
    if (i === 0) fctx.moveTo(px, py);
    else fctx.lineTo(px, py);
  }
  fctx.closePath();
  fctx.fill();
  const flashMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(flashCanvas), transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  group.add(flashMesh);

  let kick = 0;
  let flashT = 0;
  let bobT = 0;
  let current = null;
  group.position.set(0.26, -0.245, -0.45);
  camera.add(group);

  return {
    group,
    fire(big) {
      kick = Math.min(1, kick + (big ? 1 : 0.45));
      flashT = 0.045;
    },
    set(key) {
      if (current === key) return;
      current = key;
      for (const k of Object.keys(models)) models[k].visible = k === key;
      const tipZ = key === 'sniper' ? -0.85 : key === 'rifle' ? -0.68 : key === 'smg' ? -0.5 : key === 'pistol' ? -0.2 : -0.35;
      flashMesh.position.set(0, 0.02, tipZ);
    },
    update(dt, f, ads) {
      kick *= Math.exp(-11 * dt);
      if (flashT > 0) flashT -= dt;
      flashMesh.material.opacity = flashT > 0 ? 0.95 : 0;
      flashMesh.rotation.z += dt * 7;
      const speed = f ? f.speed2d : 0;
      bobT += dt * (2 + speed * 1.6);
      const bob = f && f.onGround ? Math.min(1, speed / 5) : 0;
      const reloadDip = f && f.reloadT > 0 ? Math.sin(Math.min(1, (WEAPONS[current]?.reload || 1) - f.reloadT) / (WEAPONS[current]?.reload || 1) * Math.PI) : 0;
      const swapDip = f ? Math.max(0, f.swapT) * 1.6 : 0;
      const adsT = ads ? 1 : 0;
      group.position.x = 0.26 - adsT * 0.26;
      group.position.y = -0.245 + Math.sin(bobT * 2) * 0.008 * bob - reloadDip * 0.13 - swapDip * 0.2 + adsT * 0.062;
      group.position.z = -0.45 + kick * 0.09;
      group.rotation.x = kick * 0.11 - reloadDip * 0.5 - swapDip * 0.4;
      group.rotation.z = Math.sin(bobT) * 0.006 * bob;
    },
  };
}

