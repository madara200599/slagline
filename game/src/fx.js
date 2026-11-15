// SLAGLINE — transient visuals: tracer lines, impact sparks, muzzle flashes,
// explosion fireballs and smoke clouds. Everything is pooled and preallocated;
// update() writes into existing buffers and never creates objects per frame.

import * as THREE from 'three';

const MAX_TRACERS = 40;
const MAX_PARTS = 700;
const MAX_SMOKE_SPRITES = 110;

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createFx(scene) {
  // Tracers: one LineSegments, each tracer a segment with a life.
  const tracerPos = new Float32Array(MAX_TRACERS * 6);
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  const tracers = new THREE.LineSegments(
    tracerGeo,
    new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 }),
  );
  tracers.frustumCulled = false;
  scene.add(tracers);
  const tracerLife = new Float32Array(MAX_TRACERS);
  let tracerHead = 0;
  for (let i = 0; i < MAX_TRACERS; i += 1) tracerPos[i * 6 + 1] = -999;

  // Sparks and debris: one Points cloud with per-particle velocity and life
  // kept in side arrays, positions written in place.
  const partPos = new Float32Array(MAX_PARTS * 3);
  const partCol = new Float32Array(MAX_PARTS * 3);
  const partVel = new Float32Array(MAX_PARTS * 3);
  const partLife = new Float32Array(MAX_PARTS);
  const partMax = new Float32Array(MAX_PARTS);
  const partGeo = new THREE.BufferGeometry();
  partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
  partGeo.setAttribute('color', new THREE.BufferAttribute(partCol, 3));
  const points = new THREE.Points(partGeo, new THREE.PointsMaterial({
    size: 0.085, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
    map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
  }));
  points.frustumCulled = false;
  scene.add(points);
  let partHead = 0;
  for (let i = 0; i < MAX_PARTS; i += 1) partPos[i * 3 + 1] = -999;

  // Smoke: sprites that grow and thin over the volume's life.
  const smokeTex = radialTexture('rgba(196,200,205,0.85)', 'rgba(196,200,205,0)');
  const smokeSprites = [];
  for (let i = 0; i < MAX_SMOKE_SPRITES; i += 1) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0, depthWrite: false }));
    sp.visible = false;
    scene.add(sp);
    smokeSprites.push({ sp, life: 0, max: 1, x: 0, y: 0, z: 0, seed: i * 1.7 });
  }
  let smokeHead = 0;

  // One shared flash light for muzzles and explosions.
  const flash = new THREE.PointLight(0xffc37a, 0, 18, 2);
  scene.add(flash);
  let flashLife = 0;

  // Explosion fireball: a sphere that swells and fades.
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xffa63e, transparent: true, opacity: 0 }),
  );
  ball.visible = false;
  scene.add(ball);
  let ballLife = 0;

  const tmpColor = new THREE.Color();

  function spawnParts(x, y, z, n, color, speed, spread, up) {
    tmpColor.set(color);
    for (let k = 0; k < n; k += 1) {
      const i = partHead;
      partHead = (partHead + 1) % MAX_PARTS;
      partPos[i * 3] = x; partPos[i * 3 + 1] = y; partPos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * spread;
      const v = speed * (0.35 + Math.random() * 0.65);
      partVel[i * 3] = Math.cos(a) * Math.cos(e) * v;
      partVel[i * 3 + 1] = Math.sin(e) * v + up;
      partVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * v;
      partLife[i] = partMax[i] = 0.3 + Math.random() * 0.45;
      partCol[i * 3] = tmpColor.r; partCol[i * 3 + 1] = tmpColor.g; partCol[i * 3 + 2] = tmpColor.b;
    }
  }

  return {
    tracer(x0, y0, z0, x1, y1, z1) {
      const i = tracerHead;
      tracerHead = (tracerHead + 1) % MAX_TRACERS;
      tracerPos[i * 6] = x0; tracerPos[i * 6 + 1] = y0; tracerPos[i * 6 + 2] = z0;
      tracerPos[i * 6 + 3] = x1; tracerPos[i * 6 + 4] = y1; tracerPos[i * 6 + 5] = z1;
      tracerLife[i] = 0.07;
    },
    impact(x, y, z, kind) {
      if (kind === 'flesh') spawnParts(x, y, z, 7, 0x9e2f23, 2.4, 1.4, 0.6);
      else if (kind === 'metal') spawnParts(x, y, z, 6, 0xffc37a, 3.2, 1.6, 0.8);
      else spawnParts(x, y, z, 5, 0xb8ab90, 1.8, 1.4, 0.7);
    },
    muzzle(x, y, z, big) {
      flash.position.set(x, y, z);
      flash.intensity = big ? 260 : 120;
      flashLife = 0.05;
      spawnParts(x, y, z, 2, 0xffd9a0, 1.2, 1, 0.2);
    },
    explosion(x, y, z) {
      flash.position.set(x, y + 1, z);
      flash.intensity = 2400;
      flashLife = 0.3;
      ball.position.set(x, y + 0.8, z);
      ball.visible = true;
      ballLife = 0.45;
      spawnParts(x, y + 0.6, z, 46, 0xff8c3a, 7, 1.8, 3.2);
      spawnParts(x, y + 0.6, z, 22, 0x55483a, 4, 1.6, 2.4);
    },
    smoke(x, y, z, r, life) {
      // One volume claims a shell of sprites scattered through the sphere.
      const count = 20;
      for (let k = 0; k < count; k += 1) {
        const s = smokeSprites[smokeHead];
        smokeHead = (smokeHead + 1) % MAX_SMOKE_SPRITES;
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * r * 0.72;
        s.x = x + Math.cos(a) * d;
        s.z = z + Math.sin(a) * d;
        s.y = y + 0.5 + Math.random() * r * 0.8;
        s.life = s.max = life * (0.8 + Math.random() * 0.35);
        s.sp.visible = true;
      }
    },
    update(dt) {
      let anyTracer = false;
      for (let i = 0; i < MAX_TRACERS; i += 1) {
        if (tracerLife[i] > 0) {
          tracerLife[i] -= dt;
          if (tracerLife[i] <= 0) tracerPos[i * 6 + 1] = -999;
          else anyTracer = true;
        }
      }
      if (anyTracer || true) tracerGeo.attributes.position.needsUpdate = true;

      for (let i = 0; i < MAX_PARTS; i += 1) {
        if (partLife[i] <= 0) continue;
        partLife[i] -= dt;
        if (partLife[i] <= 0) { partPos[i * 3 + 1] = -999; continue; }
        partVel[i * 3 + 1] -= 6.5 * dt;
        partPos[i * 3] += partVel[i * 3] * dt;
        partPos[i * 3 + 1] += partVel[i * 3 + 1] * dt;
        partPos[i * 3 + 2] += partVel[i * 3 + 2] * dt;
        if (partPos[i * 3 + 1] < 0.03) { partPos[i * 3 + 1] = 0.03; partVel[i * 3 + 1] = 0; }
      }
      partGeo.attributes.position.needsUpdate = true;

      for (const s of smokeSprites) {
        if (!s.sp.visible) continue;
        s.life -= dt;
        if (s.life <= 0) { s.sp.visible = false; continue; }
        const t = 1 - s.life / s.max; // 0 fresh -> 1 spent
        const fadeIn = Math.min(1, (s.max - s.life) / 0.7);
        const fadeOut = Math.min(1, s.life / 2.5);
        s.sp.material.opacity = 0.5 * Math.min(fadeIn, fadeOut);
        const scale = 2.2 + t * 5.2;
        s.sp.scale.set(scale, scale, 1);
        s.sp.position.set(
          s.x + Math.sin(s.seed + s.life * 0.4) * 0.3,
          s.y + t * 0.8,
          s.z + Math.cos(s.seed * 1.3 + s.life * 0.3) * 0.3,
        );
      }

      if (flashLife > 0) {
        flashLife -= dt;
        if (flashLife <= 0) flash.intensity = 0;
      }
      if (ballLife > 0) {
        ballLife -= dt;
        const t = 1 - Math.max(0, ballLife) / 0.45;
        ball.scale.setScalar(0.6 + t * 4.6);
        ball.material.opacity = 0.85 * (1 - t);
        if (ballLife <= 0) ball.visible = false;
      }
    },
  };
}
