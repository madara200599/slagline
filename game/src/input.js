// SLAGLINE — keyboard and mouse capture. Held keys live in S.input.keys,
// look deltas accumulate until the frame consumes them, and discrete presses
// (weapon slots, buy, grenades) queue in S.input.presses for main to drain.

export function createInput(S, element, onLockChange) {
  const input = S.input;
  input.presses = [];
  input.wheel = 0;
  let lookX = 0;
  let lookY = 0;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
    if (!e.repeat) input.presses.push(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); input.firing = false; });

  element.addEventListener('mousedown', (e) => {
    if (input.locked && e.button === 0) input.firing = true;
    if (input.locked && e.button === 2) input.ads = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.ads = false;
  });
  element.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => { if (input.locked) input.wheel += Math.sign(e.deltaY); }, { passive: true });

  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === element;
    if (!input.locked) { input.firing = false; input.ads = false; }
    onLockChange(input.locked);
  });

  return {
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    requestLock() {
      if (!input.locked) element.requestPointerLock();
    },
    releaseLock() {
      if (input.locked) document.exitPointerLock();
    },
  };
}
