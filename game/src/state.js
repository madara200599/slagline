// SLAGLINE — the one central state object and the fighter factory.
// Every module reads and writes this shape; nothing keeps a private copy of game truth.

import { WEAPONS, ECON, RULES, otherTeam } from './config.js';

// Deterministic RNG (mulberry32): the sim never calls Math.random, so a seeded
// run — a screenshot staging or a replayed round — always lands the same way.
export function makeRng(seed) {
  let a = seed | 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;

// A fighter is the player or a bot: body, loadout, wallet and (for bots) a brain.
// pos is the feet position; eye height derives from crouch in physics.
export function makeFighter(team, name, isPlayer) {
  return {
    id: nextId++,
    team,
    name,
    isPlayer: !!isPlayer,
    alive: true,
    hp: 100,
    armor: false,
    helmet: false,
    kit: false,
    money: ECON.start,
    kills: 0,
    deaths: 0,
    // body
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    crouch: false,
    onGround: true,
    speed2d: 0,
    // loadout: guns maps slot key -> { key, mag, reserve }; nades are counts
    guns: { pistol: freshGun('pistol'), primary: null },
    nades: { frag: 0, smoke: 0 },
    current: 'pistol', // 'primary' | 'pistol' | 'knife'
    fireT: 0, // seconds until the held gun may fire again
    reloadT: 0, // seconds left in a reload (0 = not reloading)
    swapT: 0, // weapon raise timer after a switch
    recoil: 0, // accumulated kick, decays; bends the next shots up
    scoped: false,
    hasCore: false,
    channel: null, // { kind: 'plant'|'defuse', t, need } while channelling
    hurtT: 9, // time since last damage taken (drives the HUD indicator); 9 = long ago
    hurtFrom: 0, // world yaw of the last attacker, for the direction arc
    hurtFresh: false, // set by applyDamage, read by the channel logic
    ads: false, // aiming down sights this tick
    stepT: 0, // footstep cadence timer
    bot: null, // brain object for bots, filled by bots.js
    mesh: null, // three.js group, filled by bots.js (null for the player)
  };
}

function freshGun(key) {
  const def = WEAPONS[key];
  return { key, mag: def.mag, reserve: def.reserve };
}
export { freshGun };

export function currentDef(f) {
  if (f.current === 'knife') return WEAPONS.knife;
  const gun = f.guns[f.current];
  return gun ? WEAPONS[gun.key] : WEAPONS.knife;
}
export function currentGun(f) {
  return f.current === 'knife' ? null : f.guns[f.current];
}

// The whole match in one object. Phases: menu, buy, live, end, over.
// `live` with core.planted is the post-plant state; the round timer then
// shows the detonation countdown instead of the round clock.
export function createState(seed) {
  nextId = 1;
  return {
    rng: makeRng(seed),
    time: 0,
    phase: 'menu',
    phaseT: 0,
    round: 0,
    attackTeam: 'union',
    score: { union: 0, warden: 0 },
    lossStreak: { union: 0, warden: 0 },
    winner: null, // team that took the round
    winReason: '',
    matchWinner: null,
    fighters: [],
    core: { planted: false, site: null, x: 0, z: 0, detT: 0, carrier: null, dropped: false },
    grenades: [], // live thrown grenades: { kind, pos, vel, fuse, owner }
    smokes: [], // active smoke volumes: { x, y, z, r, until }
    sounds: [], // hearing events for bots: { x, z, radius, team, kind }
    feed: [], // killfeed lines: { text, t, color }
    notices: [], // centre-screen notices: { text, sub, t, until }
    input: {
      keys: new Set(),
      lookX: 0,
      lookY: 0,
      firing: false,
      locked: false,
      buyOpen: false,
      boardOpen: false,
    },
    shake: 0, // camera shake energy, set by fx and read by main
    shotMode: 0, // 0 = play, 1..4 = staged screenshot scenes
    over: false,
  };
}

export function aliveOf(S, team) {
  let n = 0;
  for (const f of S.fighters) if (f.alive && f.team === team) n += 1;
  return n;
}
export function defendTeam(S) {
  return otherTeam(S.attackTeam);
}
// Round income: winners by elimination or by the objective, losers on the
// escalating loss bonus; the plant pays its team the moment it lands.
export function payRound(S, winner, objective) {
  const loser = otherTeam(winner);
  const winPay = objective ? ECON.winObjective : ECON.winElim;
  S.lossStreak[winner] = 0;
  S.lossStreak[loser] = Math.min(S.lossStreak[loser] + 1, 4);
  const lossPay = Math.min(ECON.lossBase + ECON.lossStep * (S.lossStreak[loser] - 1), ECON.lossMax);
  for (const f of S.fighters) {
    const gain = f.team === winner ? winPay : lossPay;
    f.money = Math.min(ECON.maxMoney, f.money + gain);
  }
}
export { RULES };
