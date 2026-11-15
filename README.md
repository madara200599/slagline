# SLAGLINE — Foundry 9

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/madara200599/slagline/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/madara200599/slagline/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in three.js, set in a shuttered smelting plant. Two crews of five fight over **Foundry 9**: the **Union** carries a fusion core to **Cradle A** or **Cradle B** and holds it through a 40-second countdown; the **Wardens** run them down — or cut the core's wires in time. Win rounds, earn cash, buy better guns. First crew to 7 rounds (of at most 12, sides swap after round 6) takes the foundry.

## Play it

```sh
node serve.ts          # serves game/ at http://localhost:8080
```

Open the page, hit **DEPLOY**, and play with mouse and keyboard. It is a fully static site — `game/index.html` from any static server works the same. No build step, no network requests, single player against nine bots.

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Look · left button fires · right button aims/scopes |
| Ctrl or C | Crouch (quieter, steadier) |
| Space | Jump |
| R | Reload · Q or wheel cycles weapons |
| 1 / 2 / 3 | Primary / pistol / Trench Pry |
| 4 / 5 | Throw frag charge / smoke can |
| E (hold) | Plant the core / defuse it |
| B | Buy menu (during the buy phase; number keys buy too) |
| Tab | Scoreboard |

## The game

- **Gunplay with a point to it.** Hitscan against head/chest/stomach/leg zones (4×/1×/1.25×/0.75×), range falloff, plating and helmets that blunt body and head shots, recoil that climbs and recovers, and spread that blooms hard while moving or airborne — stopping to aim genuinely pays. Five guns (P9 Stub, Ripper SMG, VK-7 Rifle, scoped Longshot, Trench Pry melee) plus frag and smoke grenades.
- **A real economy.** $800 to start; kills pay $300, plants pay the crew, round wins pay $3,250–$3,500 and the loss bonus escalates. Eight buy items including plating, a visor and the Wire Kit that halves defuse time. Dead fighters drop their gear, so force-buys and ecos happen on their own.
- **Bots that play the objective.** Nine bots path a hand-laid waypoint graph across three lanes and a catwalk, split into carrier/escort/mid/far-lane plans on attack and 2-2-1 holds on defence, react to sight *and* gunfire, burst-fire and strafe in their weapon's range band, plant, guard the planted core, retake and defuse.
- **Foundry 9.** An original map: west yard, north and south lanes, a furnace hall split by a rideable catwalk, vent and duct connectors, two cradle sites with painted rings — procedural canvas textures, a dusk sky, sodium lamps and one directional sun with shadows.
- **All sound is synthesized** WebAudio: per-weapon shots with distance and pan, reloads, hit ticks, footsteps, plant beeps that quicken, the defuse chime, the blast.

## Architecture

Static ES modules under `game/src/`, one job each, no build step:

- `main.js` — boot, the fixed 60 Hz loop, and the match director (phases, channels, win checks, camera, `?shot=N` screenshot staging)
- `state.js` — the single central state object, fighter factory, economy payouts, seeded RNG
- `config.js` — palette, weapon table, prices, round rules
- `map.js` — Foundry 9 as data (boxes, waypoint graph, sites, spawns) plus the mesh/texture/lighting builder; one box list drives rendering, collision, sight and bullets alike
- `physics.js` — box physics: ground/step-up movement, sight segments, bullet rays
- `weapons.js` — the shared fire path for player and bots, damage zones, grenades, the viewmodel
- `bots.js` — rigs, BFS pathfinding, plans, perception and the engage/hold/plant/defuse brain
- `player.js` — mouse look, acceleration movement, crouch, footsteps
- `fx.js` — pooled tracers, sparks, muzzle flashes, explosions and smoke sprites (no per-frame allocation)
- `hud.js` — DOM HUD: vitals, ammo, timer, pips, killfeed, minimap, buy menu, scoreboard
- `audio.js` — procedural WebAudio
- `input.js` — keyboard/mouse capture and pointer lock

The simulation steps at a fixed 60 Hz and renders at display rate; the sim never calls `Math.random`, so a seeded run is reproducible.

## Hand-in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts   # copies game/ + screenshots/ to out/, writes out/dossier.json
```

Screenshots are staged scenes from the game's own `?shot=1..4` modes (buy phase, a hall firefight, a plant, a defuse), rendered by the game itself.

MIT licensed. three.js 0.187.0 is vendored under `game/vendor/three/` under its own license.
