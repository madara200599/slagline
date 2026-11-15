// SLAGLINE — shared tables: palette, weapons, prices, economy and round rules.
// Everything tunable lives here so the other modules stay logic-only.

// Foundry palette: basalt and rust, sodium-lamp amber, warden teal against union ember.
export const PALETTE = {
  sky: 0x1a2027,
  fog: 0x232a31,
  ground: '#3a3f45',
  concrete: '#565d63',
  concreteDark: '#43484e',
  metal: '#6b7178',
  rust: '#8a4a2b',
  ember: 0xff7a26,
  emberCss: '#ff7a26',
  teal: 0x2fd4c4,
  tealCss: '#2fd4c4',
  hazard: '#e8b62a',
  ink: '#ece7db',
  lamp: 0xffb45e,
};

export const TEAMS = {
  union: { name: 'Union', color: 0xff7a26, css: '#ff7a26' },
  warden: { name: 'Wardens', color: 0x2fd4c4, css: '#2fd4c4' },
};
export const otherTeam = (t) => (t === 'union' ? 'warden' : 'union');

// Weapon table. damage is per bullet before body-part and armour multipliers.
// spread is a cone half-angle in radians at rest; bloom adds while moving or airborne.
export const WEAPONS = {
  knife:  { name: 'Trench Pry', slot: 'melee', price: 0, damage: 55, rpm: 110, mag: 0, reserve: 0, reload: 0, range: 1.7, spread: 0, bloom: 0, speed: 5.4, auto: false, zoom: 0 },
  pistol: { name: 'P9 Stub', slot: 'sidearm', price: 0, damage: 26, rpm: 400, mag: 12, reserve: 120, reload: 1.5, range: 70, spread: 0.006, bloom: 0.016, speed: 5.2, auto: false, zoom: 0 },
  smg:    { name: 'Ripper SMG', slot: 'primary', price: 1100, damage: 21, rpm: 780, mag: 32, reserve: 128, reload: 2.1, range: 55, spread: 0.010, bloom: 0.020, speed: 5.1, auto: true, zoom: 0 },
  rifle:  { name: 'VK-7 Rifle', slot: 'primary', price: 2700, damage: 34, rpm: 600, mag: 30, reserve: 90, reload: 2.3, range: 90, spread: 0.0035, bloom: 0.014, speed: 4.9, auto: true, zoom: 0 },
  sniper: { name: 'Longshot', slot: 'primary', price: 4300, damage: 115, rpm: 42, mag: 5, reserve: 30, reload: 3.2, range: 140, spread: 0.030, bloom: 0.030, speed: 4.6, auto: false, zoom: 3.2 },
  frag:   { name: 'Frag Charge', slot: 'nade', price: 300, damage: 110, rpm: 60, mag: 1, reserve: 0, reload: 0, range: 6, spread: 0, bloom: 0, speed: 5.2, auto: false, zoom: 0 },
  smoke:  { name: 'Smoke Can', slot: 'nade', price: 300, damage: 0, rpm: 60, mag: 1, reserve: 0, reload: 0, range: 4.6, spread: 0, bloom: 0, speed: 5.2, auto: false, zoom: 0 },
};
// Buy-menu order and the non-weapon items.
export const BUY_ITEMS = [
  { key: 'smg', label: 'Ripper SMG', price: 1100, hint: 'Fast, loose' },
  { key: 'rifle', label: 'VK-7 Rifle', price: 2700, hint: 'Precise, hard' },
  { key: 'sniper', label: 'Longshot', price: 4300, hint: 'Scoped, one-shot' },
  { key: 'frag', label: 'Frag Charge', price: 300, hint: 'Area damage' },
  { key: 'smoke', label: 'Smoke Can', price: 300, hint: 'Blocks sight' },
  { key: 'armor', label: 'Plating', price: 650, hint: 'Body armour' },
  { key: 'armorhelm', label: 'Plating + Visor', price: 1000, hint: 'Armour + helmet' },
  { key: 'kit', label: 'Wire Kit', price: 400, hint: 'Defuse twice as fast' },
];

export const ECON = {
  start: 800,
  kill: 300,
  plantPlanter: 300,
  plantTeam: 300,
  winElim: 3250,
  winObjective: 3500,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  maxMoney: 16000,
};

export const RULES = {
  buyTime: 12,
  roundTime: 100,
  plantTime: 3.2,
  defuseTime: 10,
  defuseKitTime: 5,
  detonateTime: 40,
  endTime: 4.5,
  winRounds: 7,
  maxRounds: 12,
  swapAfter: 6, // rounds 1..6 one way, then the teams trade jobs
  siteRadius: 5.5,
};
