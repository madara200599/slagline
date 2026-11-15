// SLAGLINE — procedural WebAudio: every sound is oscillators and shaped noise,
// no audio files. The context wakes on the first user gesture; in screenshot
// mode nothing initialises and every call is a no-op.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }

  function out(vol, pan) {
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(master);
    } else g.connect(master);
    return g;
  }
  // A tone with a pitch slide and an exponential decay.
  function tone(f0, f1, dur, vol, type = 'square', pan = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = out(0, pan);
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  // A burst of filtered noise: the body of every gunshot and explosion.
  function noise(dur, vol, freq, type = 'lowpass', pan = 0, sweepTo = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = out(0, pan);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function shot(kind, vol, pan) {
    if (!ctx || vol <= 0.01) return;
    if (kind === 'sniper') {
      noise(0.5, vol, 900, 'lowpass', pan);
      tone(120, 40, 0.4, vol * 0.9, 'triangle', pan);
    } else if (kind === 'smg') {
      noise(0.11, vol * 0.8, 2600, 'lowpass', pan);
      tone(220, 90, 0.07, vol * 0.4, 'square', pan);
    } else if (kind === 'pistol') {
      noise(0.14, vol * 0.85, 2000, 'lowpass', pan);
      tone(190, 70, 0.09, vol * 0.5, 'square', pan);
    } else if (kind === 'knife') {
      noise(0.16, vol * 0.5, 1200, 'bandpass', pan, 300);
    } else { // rifle
      noise(0.2, vol, 1500, 'lowpass', pan);
      tone(160, 55, 0.14, vol * 0.6, 'square', pan);
    }
  }

  return {
    init,
    shot,
    dryFire: (vol = 0.4) => tone(900, 500, 0.05, vol * 0.4, 'square'),
    reload: () => { tone(300, 180, 0.07, 0.25, 'square'); setTimeout(() => tone(500, 700, 0.05, 0.2, 'square'), 130); },
    hit: (kill) => tone(kill ? 1500 : 1100, kill ? 900 : 800, kill ? 0.16 : 0.07, 0.3, 'sine'),
    hurt: () => noise(0.12, 0.3, 500, 'lowpass'),
    step: (vol) => noise(0.05, vol, 300, 'lowpass'),
    throwNade: () => noise(0.18, 0.2, 900, 'bandpass', 0, 2400),
    explosion: (vol, pan) => { noise(1.1, vol, 300, 'lowpass', pan); tone(70, 28, 0.9, vol, 'sine', pan); },
    smoke: () => noise(1.4, 0.16, 5000, 'highpass', 0, 2500),
    beep: (final) => tone(final ? 1560 : 1040, final ? 1560 : 1040, final ? 0.3 : 0.08, 0.22, 'sine'),
    defuse: () => { tone(700, 700, 0.06, 0.2, 'sine'); setTimeout(() => tone(980, 980, 0.09, 0.2, 'sine'), 90); },
    sting: (win) => {
      if (!ctx) return;
      const base = win ? [392, 523, 659] : [330, 262, 196];
      base.forEach((f, i) => setTimeout(() => tone(f, f, 0.34, 0.22, 'triangle'), i * 120));
    },
    click: () => tone(1200, 900, 0.04, 0.15, 'square'),
    buy: () => { tone(880, 880, 0.06, 0.2, 'sine'); setTimeout(() => tone(1320, 1320, 0.08, 0.2, 'sine'), 70); },
    denied: () => tone(220, 160, 0.12, 0.22, 'square'),
  };
}

// Volume and pan of a world sound for the listener (the player): distance
// falloff plus a stereo pan from the direction relative to view yaw.
export function spatial(S, x, z, base = 1) {
  const p = S.fighters[0];
  if (!p) return { vol: 0, pan: 0 };
  const dx = x - p.pos.x;
  const dz = z - p.pos.z;
  const dist = Math.hypot(dx, dz);
  const vol = base * Math.max(0, 1 - dist / 55) ** 1.4;
  // Camera right vector for yaw is (cos yaw, -sin yaw) in (x, z).
  const pan = dist > 0.01
    ? Math.max(-1, Math.min(1, (dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw)) / dist)) * 0.8
    : 0;
  return { vol, pan };
}
