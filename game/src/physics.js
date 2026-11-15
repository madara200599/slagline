// SLAGLINE — physics over the map's box list: ground height, body movement with
// step-up, sight segments and bullet rays. Pure functions of the box array, so
// the map builder can use them for its waypoint edges before the game exists.

export const STEP = 0.62; // tallest ledge a body climbs without jumping
export const GRAVITY = 22;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const HEIGHT_STAND = 1.78;
export const HEIGHT_CROUCH = 1.28;

export function eyeHeight(body) {
  return body.pos.y + (body.crouch ? EYE_CROUCH : EYE_STAND);
}
export function bodyHeight(body) {
  return body.crouch ? HEIGHT_CROUCH : HEIGHT_STAND;
}

// Highest walkable top at (x, z) that is not more than STEP above refY:
// lets a body land on crates and climb stairs, never teleport up a wall.
export function groundAt(boxes, x, z, refY) {
  let g = 0;
  for (const b of boxes) {
    if (!b.solid) continue;
    if (Math.abs(x - b.x) <= b.hx && Math.abs(z - b.z) <= b.hz) {
      if (b.y1 <= refY + STEP && b.y1 > g) g = b.y1;
    }
  }
  return g;
}

function blocksAt(boxes, x, z, feetY, height, r) {
  for (const b of boxes) {
    if (!b.solid) continue;
    if (b.y1 <= feetY + STEP || b.y0 >= feetY + height - 0.2) continue;
    if (Math.abs(x - b.x) < b.hx + r && Math.abs(z - b.z) < b.hz + r) return b;
  }
  return null;
}

// Move a body { pos, vel, crouch } for dt seconds: axis-separated horizontal
// slides, step-up onto low boxes, gravity, ground landing, head bumps.
export function moveBody(boxes, body, dt) {
  const r = 0.36;
  const height = bodyHeight(body);
  body.vel.y -= GRAVITY * dt;
  if (body.vel.y < -30) body.vel.y = -30;

  for (const axis of ['x', 'z']) {
    const delta = body.vel[axis] * dt;
    if (delta === 0) continue;
    let nx = body.pos.x + (axis === 'x' ? delta : 0);
    let nz = body.pos.z + (axis === 'z' ? delta : 0);
    const hit = blocksAt(boxes, nx, nz, body.pos.y, height, r);
    if (!hit) {
      body.pos.x = nx;
      body.pos.z = nz;
      continue;
    }
    // Step-up: if the blocker's top is within a step and the landing is clear,
    // climb it instead of stopping (stairs and crate lips).
    if (body.onGround && hit.y1 - body.pos.y <= STEP && hit.y1 > body.pos.y) {
      if (!blocksAt(boxes, nx, nz, hit.y1, height, r)) {
        body.pos.x = nx;
        body.pos.z = nz;
        body.pos.y = hit.y1;
        continue;
      }
    }
    // Slide to the contact plane.
    if (axis === 'x') {
      nx = delta > 0 ? hit.x - hit.hx - r : hit.x + hit.hx + r;
      if (!blocksAt(boxes, nx, body.pos.z, body.pos.y, height, r)) body.pos.x = nx;
    } else {
      nz = delta > 0 ? hit.z - hit.hz - r : hit.z + hit.hz + r;
      if (!blocksAt(boxes, body.pos.x, nz, body.pos.y, height, r)) body.pos.z = nz;
    }
    body.vel[axis] = 0;
  }

  const ny = body.pos.y + body.vel.y * dt;
  const ground = groundAt(boxes, body.pos.x, body.pos.z, Math.max(body.pos.y, ny));
  if (ny <= ground) {
    body.pos.y = ground;
    body.vel.y = 0;
    body.onGround = true;
  } else {
    // Head bump against the underside of a slab.
    let bumped = false;
    if (body.vel.y > 0) {
      for (const b of boxes) {
        if (!b.solid) continue;
        if (Math.abs(body.pos.x - b.x) < b.hx + r * 0.6 && Math.abs(body.pos.z - b.z) < b.hz + r * 0.6) {
          if (b.y0 >= body.pos.y + height - 0.05 && b.y0 < ny + height) { bumped = true; break; }
        }
      }
    }
    body.pos.y = bumped ? body.pos.y : ny;
    if (bumped) body.vel.y = 0;
    body.onGround = body.pos.y <= ground + 0.001;
  }
  body.speed2d = Math.hypot(body.vel.x, body.vel.z);
}

// Segment vs boxes, slab method. `flag` is 'sight' or 'bullet': railings stop
// neither, crates stop both, walls stop both.
export function segBlocked(boxes, ax, ay, az, bx, by, bz, flag) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  for (const b of boxes) {
    if (!b[flag]) continue;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    const axes = [
      [ax, dx, b.x - b.hx, b.x + b.hx],
      [ay, dy, b.y0, b.y1],
      [az, dz, b.z - b.hz, b.z + b.hz],
    ];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { ok = false; break; }
      } else {
        let ta = (lo - o) / d;
        let tb = (hi - o) / d;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t1 > 0 && t0 < 1) return true;
  }
  return false;
}

// Ray vs boxes: returns the distance to the first bullet-stopping box, or
// Infinity. Used for hitscan and for the wall distance behind a target.
export function raycastWorld(boxes, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const b of boxes) {
    if (!b.bullet) continue;
    let t0 = 0;
    let t1 = best;
    let ok = true;
    const axes = [
      [ox, dx, b.x - b.hx, b.x + b.hx],
      [oy, dy, b.y0, b.y1],
      [oz, dz, b.z - b.hz, b.z + b.hz],
    ];
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { ok = false; break; }
      } else {
        let ta = (lo - o) / d;
        let tb = (hi - o) / d;
        if (ta > tb) { const t = ta; ta = tb; tb = t; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
    }
    if (ok && t0 < best && t1 > 0) best = t0;
  }
  return best;
}
