// SLAGLINE — Foundry 9: the map as data (boxes, waypoints, sites, spawns) plus
// the builder that turns it into three.js meshes. Every solid is an axis-aligned
// box { x, z, hx, hz, y0, y1, mat, sight, bullet, solid }: one shape drives the
// rendering, the movement collision, the sight checks and the bullet tests, so
// what the player sees is exactly what the sim believes.

import * as THREE from 'three';
import { PALETTE } from './config.js';
import { segBlocked } from './physics.js';

const boxes = [];
function box(x, z, hx, hz, y1, mat, opts = {}) {
  const b = {
    x, z, hx, hz, y0: opts.y0 ?? 0, y1, mat,
    sight: opts.sight !== false, bullet: opts.bullet !== false, solid: opts.solid !== false,
  };
  boxes.push(b);
  return b;
}
const wall = (x, z, hx, hz, mat = 'conc') => box(x, z, hx, hz, 5.2, mat);
const block = (x, z, hx, hz, h, mat = 'dark') => box(x, z, hx, hz, h, mat);
const crate = (x, z, s, h) => box(x, z, s / 2, s / 2, h, 'crate');

// Perimeter of the foundry yard.
wall(0, -32.5, 47, 0.5, 'metal');
wall(0, 32.5, 47, 0.5, 'metal');
wall(-46.5, 0, 0.5, 33, 'metal');
wall(46.5, 0, 0.5, 33, 'metal');

// North building row (z -18..-10) with the A-short and vent gaps.
block(-21, -14, 9, 4, 6, 'dark');
block(2, -14, 8, 4, 6, 'rust');
block(20, -14, 4, 4, 6, 'dark');
// South building row (z 10..18), B-short and duct gaps mirrored.
block(-21, 14, 9, 4, 6, 'dark');
block(2, 14, 8, 4, 6, 'rust');
block(20, 14, 4, 4, 6, 'dark');
// West-mid smelter block: the west yard reaches mid only around its ends.
block(-24, 0, 6, 10, 6.5, 'rust');
// East works block between the hall and the defenders' yard.
block(22, 0, 6, 4, 5.6, 'dark');
// The furnace: a low wide block in the middle of the hall, catwalk over it.
block(2, 0, 4, 3.2, 2.0, 'rust');

// Catwalk across the hall (top y 2.3) with stair towers at both ends and
// railings a bullet passes but a body does not.
box(1, 0, 15, 1.6, 2.3, 'slab', { y0: 2.0 });
for (const side of [-1, 1]) {
  box(-6, side * 1.75, 7, 0.15, 3.25, 'rail', { y0: 2.3, sight: false, bullet: false });
  box(10.5, side * 1.75, 4.5, 0.15, 3.25, 'rail', { y0: 2.3, sight: false, bullet: false });
}
function stairs(x0, dir) {
  for (let i = 0; i < 8; i += 1) box(x0 + dir * (i * 0.45 + 0.225), 0, 0.225, 1.6, 0.29 * (i + 1), 'slab');
}
stairs(-15.8, 1); // west tower climbs eastward onto the catwalk
stairs(17.8, -1); // east tower climbs westward

// Site thresholds: low walls that funnel the last metres into each cradle.
wall(24, -8.5, 4, 0.4, 'conc');
wall(24, 8.5, 4, 0.4, 'conc');
wall(20.5, -27, 0.4, 3, 'conc');
wall(20.5, 27, 0.4, 3, 'conc');

// Cover crates: 1.2 high hides a crouch, 2.4 high hides a stand.
crate(26, -24, 2.2, 2.4); crate(36, -16, 2.2, 1.2); crate(30, -12.5, 2.2, 2.4); crate(38, -25, 1.8, 1.2);
crate(26, 24, 2.2, 2.4); crate(36, 16, 2.2, 1.2); crate(30, 12.5, 2.2, 2.4); crate(38, 25, 1.8, 1.2);
crate(-1, -25.6, 2.2, 1.2); crate(-20, -20.2, 2.2, 2.4); crate(-1, 25.6, 2.2, 1.2); crate(-20, 20.2, 2.2, 2.4);
crate(-10, -6, 2, 1.2); crate(12, 6, 2, 1.2); crate(-11, 6.5, 2, 2.4); crate(12, -6, 2, 1.2);
crate(-36, -8, 2.2, 1.2); crate(-36, 8, 2.2, 1.2); crate(39, 0, 2.2, 2.4); crate(-40, -16, 2, 1.2); crate(-40, 16, 2, 1.2);
// The cradle devices the core is planted on: low, solid, glowing (mesh added by the builder).
box(32, -20, 0.9, 0.9, 0.9, 'cradle');
box(32, 20, 0.9, 0.9, 0.9, 'cradle');

// Waypoint graph: nodes carry a ground height (catwalk nodes sit at 2.3) and
// tags the bot plans read. Edges are derived below from distance + sight.
const N = (x, z, tags = [], y = 0) => ({ x, z, y, tags });
const nodes = [
  N(-40, 0, ['spawnAtk']), N(-36, -12), N(-36, 12), N(-38, -21, ['laneA']), N(-24, -23, ['laneA']),
  N(-8, -23, ['laneA']), N(8, -23, ['laneA']), N(20, -21, ['entryA']), N(28, -23, ['siteA']),
  N(38, -14, ['siteA', 'holdA']), N(-33, -23, ['laneA']), N(-9, -14, ['shortA']), N(13, -14, ['vent']),
  N(2, -8, ['mid']), N(-10, -5, ['hall']), N(-3.5, -5, ['mid', 'holdMid']), N(12, -5, ['hall']),
  N(22, -7, ['pass']), N(36, 0, ['spawnDef']), N(22, 7, ['pass']), N(12, 5, ['hall']),
  N(-3.5, 5, ['mid']), N(-10, 5, ['hall']), N(13, 14, ['duct']), N(-9, 14, ['shortB']),
  N(2, 8, ['mid']), N(8, 23, ['laneB']), N(-8, 23, ['laneB']), N(-24, 23, ['laneB']),
  N(-38, 21, ['laneB']), N(20, 21, ['entryB']), N(28, 23, ['siteB']), N(38, 14, ['siteB', 'holdB']),
  N(-33, 23, ['laneB']), N(40, -20, ['backA']), N(40, 20, ['backB']), N(-16, 0, ['stairW']),
  N(18, 0, ['stairE']), N(-10, 0, ['cat'], 2.3), N(12, 0, ['cat'], 2.3), N(29.5, -17.5, ['siteA']),
  N(29.5, 17.5, ['siteB']), N(-11, 0, ['hall']),
];
// Hand-set edges for the stairs (a sight check at one height cannot see them).
const extraEdges = [[36, 38], [38, 39], [39, 37]];

function buildEdges() {
  const edges = nodes.map(() => []);
  const link = (a, b) => { edges[a].push(b); edges[b].push(a); };
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 17 || Math.abs(a.y - b.y) > 0.4) continue;
      const eye = a.y + 1.5;
      if (!segBlocked(boxes, a.x, eye, a.z, b.x, b.y + 1.5, b.z, 'sight')) link(i, j);
    }
  }
  for (const [a, b] of extraEdges) link(a, b);
  return edges;
}

export const MAP = {
  boxes,
  nodes,
  edges: buildEdges(),
  sites: {
    A: { x: 32, z: -20, label: 'Cradle A' },
    B: { x: 32, z: 20, label: 'Cradle B' },
  },
  spawns: {
    atk: [
      { x: -41, z: -3, yaw: -Math.PI / 2 }, { x: -41, z: 3, yaw: -Math.PI / 2 },
      { x: -39, z: -6, yaw: -Math.PI / 2 }, { x: -39, z: 6, yaw: -Math.PI / 2 },
      { x: -43, z: 0, yaw: -Math.PI / 2 },
    ],
    def: [
      { x: 42, z: -3, yaw: Math.PI / 2 }, { x: 42, z: 3, yaw: Math.PI / 2 },
      { x: 40, z: -6, yaw: Math.PI / 2 }, { x: 40, z: 6, yaw: Math.PI / 2 },
      { x: 44, z: 0, yaw: Math.PI / 2 },
    ],
  },
  bounds: { minX: -45.8, maxX: 45.8, minZ: -31.8, maxZ: 31.8 },
};
export function nodeByTag(tag) {
  const out = [];
  for (let i = 0; i < nodes.length; i += 1) if (nodes[i].tags.includes(tag)) out.push(i);
  return out;
}
export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// --- Rendering: procedural canvas textures and one mesh per box. ---

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function speckle(ctx, s, base, flecks, n, rng) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = flecks[(rng() * flecks.length) | 0];
    ctx.globalAlpha = 0.12 + rng() * 0.25;
    const w = 2 + rng() * 26;
    ctx.fillRect(rng() * s, rng() * s, w, w * (0.3 + rng()));
  }
  ctx.globalAlpha = 1;
}

export function buildWorld(scene) {
  let rs = 1234567;
  const rng = () => { rs = (Math.imul(rs, 1103515245) + 12345) & 0x7fffffff; return rs / 0x7fffffff; };

  const floorTex = canvasTexture(1024, (ctx, s) => {
    speckle(ctx, s, '#33373c', ['#2b2f34', '#3f444a', '#46484a', '#23262a'], 2600, rng);
    ctx.strokeStyle = 'rgba(12,13,15,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 8; i += 1) {
      ctx.beginPath(); ctx.moveTo((i * s) / 8, 0); ctx.lineTo((i * s) / 8, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i * s) / 8); ctx.lineTo(s, (i * s) / 8); ctx.stroke();
    }
    // Painted cradle rings and letters, drawn in world space (map spans 94 x 66).
    const px = (wx) => ((wx + 47) / 94) * s;
    const pz = (wz) => ((wz + 33) / 66) * s;
    for (const [site, letter] of [[MAP.sites.A, 'A'], [MAP.sites.B, 'B']]) {
      ctx.strokeStyle = PALETTE.hazard;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(px(site.x), pz(site.z), (5.5 / 94) * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = PALETTE.hazard;
      ctx.font = `bold ${s / 11}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(letter, px(site.x - 6.5), pz(site.z) + s / 33);
    }
    ctx.fillStyle = 'rgba(232,182,42,0.5)';
    ctx.fillRect(px(-14), pz(-0.4), (28 / 94) * s, 5); // hall centre line
  });
  floorTex.repeat.set(1, 1);

  const mats = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.94, metalness: 0.08 }),
    conc: new THREE.MeshStandardMaterial({ map: canvasTexture(256, (c, s) => speckle(c, s, PALETTE.concrete, ['#4a5057', '#646b72', '#3c4147'], 700, rng), 2), roughness: 0.95 }),
    dark: new THREE.MeshStandardMaterial({ map: canvasTexture(256, (c, s) => speckle(c, s, PALETTE.concreteDark, ['#363b41', '#4d535a', '#2c3036'], 700, rng), 2), roughness: 0.95 }),
    metal: new THREE.MeshStandardMaterial({ map: canvasTexture(256, (c, s) => {
      speckle(c, s, PALETTE.metal, ['#5b6167', '#787e85'], 260, rng);
      c.fillStyle = 'rgba(20,22,25,0.35)';
      for (let y = 0; y < s; y += 32) c.fillRect(0, y, s, 4);
    }, 2), roughness: 0.6, metalness: 0.55 }),
    rust: new THREE.MeshStandardMaterial({ map: canvasTexture(256, (c, s) => speckle(c, s, PALETTE.rust, ['#74401f', '#a05a30', '#5d3520'], 900, rng), 2), roughness: 0.9, metalness: 0.15 }),
    crate: new THREE.MeshStandardMaterial({ map: canvasTexture(256, (c, s) => {
      speckle(c, s, '#7a6742', ['#66552f', '#8f7a4e', '#57482a'], 500, rng);
      c.strokeStyle = 'rgba(30,24,12,0.8)';
      c.lineWidth = 14;
      c.strokeRect(7, 7, s - 14, s - 14);
      c.beginPath(); c.moveTo(0, 0); c.lineTo(s, s); c.moveTo(s, 0); c.lineTo(0, s); c.stroke();
    }), roughness: 0.85 }),
    slab: new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.5, metalness: 0.7 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xd8a022, roughness: 0.6, metalness: 0.3 }),
    cradle: new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.4, metalness: 0.6, emissive: 0xff7a26, emissiveIntensity: 0.35 }),
  };

  const group = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(94, 66), mats.floor);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  for (const b of boxes) {
    if (b.mat === 'rail') continue; // railings get one merged look below
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.y1 - b.y0, b.hz * 2), mats[b.mat]);
    mesh.position.set(b.x, (b.y0 + b.y1) / 2, b.z);
    mesh.castShadow = b.y1 - b.y0 >= 1;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const b of boxes) {
    if (b.mat !== 'rail') continue;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, 0.08, b.hz * 2), mats.rail);
    mesh.position.set(b.x, b.y1 - 0.05, b.z);
    group.add(mesh);
    const post = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.y1 - b.y0, 0.05), mats.rail);
    post.position.set(b.x, (b.y0 + b.y1) / 2, b.z);
    post.material = new THREE.MeshStandardMaterial({ color: 0x8f8f96, roughness: 0.6, metalness: 0.5, transparent: true, opacity: 0.35 });
    group.add(post);
  }

  // Dressing: chimneys, a pipe run, cradle rings and lamp posts. Pure looks —
  // none of it collides, all of it sits inside boxes that already do.
  const iron = new THREE.MeshStandardMaterial({ color: 0x4a423c, roughness: 0.8, metalness: 0.4 });
  for (const [x, z, h] of [[-21, -14, 11], [2, 14, 10], [-22, 0, 12]]) {
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, h, 10), iron);
    chimney.position.set(x, h / 2 + 4, z);
    chimney.castShadow = true;
    group.add(chimney);
  }
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 60, 8), mats.metal);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(-16, 4.4, -31.6);
  group.add(pipe);
  const ringGeo = new THREE.TorusGeometry(1.5, 0.09, 8, 28);
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffb45e, emissiveIntensity: 1.6 });
  for (const site of [MAP.sites.A, MAP.sites.B]) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(site.x, 1.15, site.z);
    group.add(ring);
  }

  // Sky dome: a dusk gradient, burnt orange at the horizon under slate blue.
  const skyTex = canvasTexture(512, (ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, '#10151d');
    grad.addColorStop(0.55, '#2c3644');
    grad.addColorStop(0.78, '#7a5230');
    grad.addColorStop(1, '#c97a35');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 20, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);

  scene.add(group);
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 160);

  const hemi = new THREE.HemisphereLight(0x93a7bd, 0x3a2a1c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a6, 2.0);
  sun.position.set(-38, 46, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -58;
  sun.shadow.camera.right = 58;
  sun.shadow.camera.top = 58;
  sun.shadow.camera.bottom = -58;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  for (const site of [MAP.sites.A, MAP.sites.B]) {
    const lamp = new THREE.PointLight(PALETTE.lamp, 900, 34, 2);
    lamp.position.set(site.x, 5.5, site.z);
    scene.add(lamp);
  }
  const hallLamp = new THREE.PointLight(0x9fd8d2, 500, 30, 2);
  hallLamp.position.set(1, 6, 0);
  scene.add(hallLamp);
  return { group };
}

