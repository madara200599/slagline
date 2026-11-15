// SLAGLINE — the human fighter: mouse look, acceleration movement with
// friction, crouch, jump and footsteps, all on the shared box physics.

import { MAP } from './map.js';
import { moveBody } from './physics.js';
import { currentDef } from './state.js';

const ACCEL = 68;
const FRICTION = 11;

export function stepPlayer(S, dt, audio) {
  const p = S.fighters[0];
  if (!p || !p.alive) return;
  const input = S.input;

  // Look: consume the accumulated mouse deltas. Sensitivity eases while scoped.
  const sens = p.scoped ? 0.00075 : 0.0021;
  const look = input.takeLookRef ? input.takeLookRef() : { x: 0, y: 0 };
  p.yaw -= look.x * sens;
  p.pitch -= look.y * sens;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));

  const def = currentDef(p);
  const crouching = input.keys.has('ControlLeft') || input.keys.has('KeyC');
  p.crouch = crouching;
  p.ads = !!input.ads && p.current !== 'knife';

  // Wish direction in world space from the held keys and the view yaw.
  let fwd = 0;
  let strafe = 0;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) fwd += 1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) fwd -= 1;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) strafe -= 1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) strafe += 1;
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  let wx = (-sin * fwd + cos * strafe);
  let wz = (-cos * fwd - sin * strafe);
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  let maxSpeed = def.speed;
  if (p.crouch) maxSpeed *= 0.45;
  if (p.scoped) maxSpeed *= 0.5;
  else if (p.ads) maxSpeed *= 0.62;

  if (p.onGround) {
    // Friction first, then accelerate toward the wish direction: stopping is
    // fast and deliberate, which is what makes counter-strafing pay.
    const drag = Math.max(0, 1 - FRICTION * dt);
    p.vel.x *= drag;
    p.vel.z *= drag;
    p.vel.x += wx * ACCEL * dt;
    p.vel.z += wz * ACCEL * dt;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp > maxSpeed) {
      p.vel.x = (p.vel.x / sp) * maxSpeed;
      p.vel.z = (p.vel.z / sp) * maxSpeed;
    }
    if (input.keys.has('Space')) {
      p.vel.y = 7.4;
      p.onGround = false;
    }
  } else {
    // Air control is weak on purpose: a jump is a commitment.
    p.vel.x += wx * ACCEL * 0.12 * dt;
    p.vel.z += wz * ACCEL * 0.12 * dt;
  }

  const wasFalling = p.vel.y;
  moveBody(MAP.boxes, p, dt);
  if (p.onGround && wasFalling < -9) S.shake = Math.min(0.6, S.shake + 0.18);

  // Footsteps on a cadence scaled by speed; bots hear them.
  if (p.onGround && p.speed2d > 1.2) {
    p.stepT -= dt * p.speed2d;
    if (p.stepT <= 0) {
      p.stepT = 2.6;
      audio.step(p.crouch ? 0.05 : 0.14);
      if (!p.crouch) S.sounds.push({ x: p.pos.x, z: p.pos.z, radius: 13, team: p.team, kind: 'step' });
    }
  }
}
