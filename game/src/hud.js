// SLAGLINE — the DOM HUD: health, armour, ammo, money, timer, score pips,
// killfeed, hitmarker, damage direction, plant/defuse progress, a canvas
// minimap, the buy menu and the scoreboard. update() runs every frame but
// only touches the DOM when a value actually changed.

import { MAP } from './map.js';
import { BUY_ITEMS, WEAPONS, TEAMS } from './config.js';
import { currentDef, currentGun, aliveOf } from './state.js';

const $ = (id) => document.getElementById(id);

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud(S, hooks) {
  const els = {
    hud: $('hud'), timer: $('timer'), timerLabel: $('timer-label'),
    scoreU: $('score-union'), scoreW: $('score-warden'),
    pipsU: $('pips-union'), pipsW: $('pips-warden'),
    health: $('health-num'), healthFill: $('health-fill'), armorTag: $('armor-tag'),
    money: $('money'), ammoMag: $('ammo-mag'), ammoRes: $('ammo-reserve'),
    weaponName: $('weapon-name'), nades: $('nades'), coreTag: $('core-tag'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), dmgArc: $('dmg-arc'),
    feed: $('killfeed'), notice: $('notice'), noticeText: $('notice-text'), noticeSub: $('notice-sub'),
    channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    buy: $('buy-menu'), buyGrid: $('buy-grid'), buyMoney: $('buy-money'),
    board: $('scoreboard'), boardBody: $('board-body'),
    menu: $('menu'), end: $('matchend'), endTitle: $('end-title'), endSub: $('end-sub'),
    spectate: $('spectate'), scope: $('scope'), minimap: $('minimap'),
    roundTag: $('round-tag'),
  };
  const mm = els.minimap.getContext('2d');
  const pipSpans = { union: [], warden: [] };
  for (const team of ['union', 'warden']) {
    const host = team === 'union' ? els.pipsU : els.pipsW;
    for (let i = 0; i < 5; i += 1) {
      const s = document.createElement('i');
      host.appendChild(s);
      pipSpans[team].push(s);
    }
  }
  // Buy menu buttons are built once; their state classes refresh in update().
  const buyButtons = new Map();
  BUY_ITEMS.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy-item';
    btn.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-label">${item.label}</span>` +
      `<span class="buy-hint">${item.hint}</span><span class="buy-price">$${item.price}</span>`;
    btn.addEventListener('click', () => hooks.onBuy(item.key));
    els.buyGrid.appendChild(btn);
    buyButtons.set(item.key, btn);
  });
  $('btn-play').addEventListener('click', () => hooks.onPlay());
  $('btn-restart').addEventListener('click', () => hooks.onRestart());

  const cache = new Map();
  function set(key, el, value) {
    if (cache.get(key) !== value) {
      cache.set(key, value);
      el.textContent = value;
    }
  }
  let feedStamp = '';
  let hitT = -9;
  let boardT = 0;

  function drawMinimap(p) {
    const W = els.minimap.width;
    const H = els.minimap.height;
    const sx = W / 94;
    const sz = H / 66;
    mm.fillStyle = 'rgba(16,19,23,0.88)';
    mm.fillRect(0, 0, W, H);
    mm.fillStyle = '#454c54';
    for (const b of MAP.boxes) {
      if (b.y0 > 0.1 || b.y1 < 2.2) continue;
      mm.fillRect((b.x - b.hx + 47) * sx, (b.z - b.hz + 33) * sz, b.hx * 2 * sx, b.hz * 2 * sz);
    }
    for (const key of ['A', 'B']) {
      const site = MAP.sites[key];
      mm.strokeStyle = '#e8b62a';
      mm.lineWidth = 1.5;
      mm.beginPath();
      mm.arc((site.x + 47) * sx, (site.z + 33) * sz, 5.5 * sx, 0, Math.PI * 2);
      mm.stroke();
      mm.fillStyle = '#e8b62a';
      mm.font = 'bold 9px system-ui';
      mm.textAlign = 'center';
      mm.fillText(key, (site.x + 47) * sx, (site.z + 33) * sz + 3);
    }
    if (S.core.planted || S.core.dropped) {
      const cx = S.core.planted ? MAP.sites[S.core.site].x : S.core.x;
      const cz = S.core.planted ? MAP.sites[S.core.site].z : S.core.z;
      mm.fillStyle = Math.sin(S.time * 6) > 0 ? '#ff5030' : '#ffb45e';
      mm.beginPath();
      mm.arc((cx + 47) * sx, (cz + 33) * sz, 3, 0, Math.PI * 2);
      mm.fill();
    }
    for (const f of S.fighters) {
      if (!f.alive || f.isPlayer) continue;
      if (f.team !== p.team) continue;
      mm.fillStyle = TEAMS[f.team].css;
      mm.beginPath();
      mm.arc((f.pos.x + 47) * sx, (f.pos.z + 33) * sz, 2.4, 0, Math.PI * 2);
      mm.fill();
    }
    // The player: a white wedge pointing along the view yaw.
    const px = (p.pos.x + 47) * sx;
    const pz = (p.pos.z + 33) * sz;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    mm.fillStyle = '#ffffff';
    mm.beginPath();
    mm.moveTo(px + fx * 5, pz + fz * 5);
    mm.lineTo(px - fz * 3.4 - fx * 2.4, pz + fx * 3.4 - fz * 2.4);
    mm.lineTo(px + fz * 3.4 - fx * 2.4, pz - fx * 3.4 - fz * 2.4);
    mm.closePath();
    mm.fill();
  }

  function drawBoard() {
    const rows = [...S.fighters].sort((a, b2) => (a.team === b2.team ? b2.kills - a.kills : a.team === 'union' ? -1 : 1));
    els.boardBody.innerHTML = rows.map((f) =>
      `<tr class="${f.alive ? '' : 'dead'}"><td style="color:${TEAMS[f.team].css}">${f.name}${f.isPlayer ? ' (you)' : ''}</td>` +
      `<td>${f.kills}</td><td>${f.deaths}</td><td>$${f.money}</td></tr>`).join('');
  }

  return {
    els,
    flashHit() { hitT = S.time; },
    update(dt) {
      const p = S.fighters[0];
      const inGame = S.phase !== 'menu';
      els.hud.style.display = inGame ? 'block' : 'none';
      els.menu.style.display = S.phase === 'menu' ? 'grid' : 'none';
      els.end.style.display = S.phase === 'over' ? 'grid' : 'none';
      if (!inGame) return;

      // Timer and round score.
      let label = '';
      let timerText = '';
      let urgent = false;
      if (S.phase === 'buy') { label = 'BUY PHASE — B FOR MENU'; timerText = fmtTime(S.phaseT); }
      else if (S.core.planted) { label = 'CORE PLANTED'; timerText = fmtTime(S.core.detT); urgent = true; }
      else if (S.phase === 'live') { label = 'ROUND ' + S.round; timerText = fmtTime(S.phaseT); urgent = S.phaseT < 11; }
      else if (S.phase === 'end') { label = S.winReason; timerText = ''; }
      set('timer', els.timer, timerText);
      set('tlabel', els.timerLabel, label);
      els.timer.classList.toggle('urgent', urgent);
      set('su', els.scoreU, String(S.score.union));
      set('sw', els.scoreW, String(S.score.warden));
      set('rt', els.roundTag, `ROUND ${S.round} / 12 — FIRST TO 7`);
      for (const team of ['union', 'warden']) {
        const alive = aliveOf(S, team);
        pipSpans[team].forEach((s, i) => s.classList.toggle('off', i >= alive));
      }

      // Player vitals.
      set('hp', els.health, String(Math.max(0, Math.ceil(p.hp))));
      els.healthFill.style.width = `${Math.max(0, p.hp)}%`;
      els.healthFill.style.background = p.hp > 50 ? '#d8d2c2' : p.hp > 25 ? '#e8b62a' : '#e0483e';
      els.armorTag.style.visibility = p.armor ? 'visible' : 'hidden';
      els.armorTag.textContent = p.helmet ? 'PLATING + VISOR' : 'PLATING';
      set('money', els.money, '$' + p.money);
      const def = currentDef(p);
      const gun = currentGun(p);
      set('wname', els.weaponName, def.name + (p.hasCore ? '  ·  CARRYING THE CORE' : ''));
      if (gun) {
        set('mag', els.ammoMag, String(gun.mag));
        set('res', els.ammoRes, '/ ' + gun.reserve);
      } else {
        set('mag', els.ammoMag, '—');
        set('res', els.ammoRes, '');
      }
      set('nades', els.nades, `FRAG ×${p.nades.frag}   SMOKE ×${p.nades.smoke}${p.kit ? '   WIRE KIT ✓' : ''}`);
      els.coreTag.style.display = p.hasCore ? 'block' : 'none';

      // Crosshair spread follows the same numbers the gun uses.
      const gap = 5 + Math.min(16, p.speed2d * 1.7 + p.recoil * 1.6 + (p.onGround ? 0 : 5));
      els.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
      els.crosshair.style.opacity = p.scoped ? '0' : '1';
      els.scope.style.display = p.scoped ? 'block' : 'none';
      els.hitmarker.style.opacity = S.time - hitT < 0.14 ? '1' : '0';
      if (p.hurtT < 1.1 && p.alive) {
        const fx = -Math.sin(p.yaw);
        const fz = -Math.cos(p.yaw);
        const dx = Math.sin(p.hurtFrom);
        const dz = Math.cos(p.hurtFrom);
        const rel = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
        els.dmgArc.style.opacity = String(1 - p.hurtT / 1.1);
        els.dmgArc.style.transform = `translate(-50%,-50%) rotate(${rel}rad)`;
      } else els.dmgArc.style.opacity = '0';
      els.spectate.style.display = !p.alive && (S.phase === 'live' || S.phase === 'buy') ? 'block' : 'none';

      // Killfeed.
      const stamp = S.feed.map((f) => f.text).join('|');
      if (stamp !== feedStamp) {
        feedStamp = stamp;
        els.feed.innerHTML = S.feed
          .filter((f) => S.time - f.t < 5.5)
          .map((f) => `<div style="color:${f.color}">${f.text}</div>`).join('');
      }

      // Notices (round banners and objective calls).
      const notice = S.notices[S.notices.length - 1];
      if (notice && S.time < notice.until) {
        els.notice.style.opacity = '1';
        set('nt', els.noticeText, notice.text);
        set('ns', els.noticeSub, notice.sub || '');
      } else els.notice.style.opacity = '0';

      // Plant / defuse progress: the player's own channel, else anyone's.
      let chan = p.channel;
      if (!chan) for (const f of S.fighters) if (f.channel) { chan = f.channel; break; }
      if (chan) {
        els.channel.style.display = 'block';
        set('cl', els.channelLabel, chan.kind === 'plant' ? 'PLANTING THE CORE' : 'DEFUSING THE CORE');
        els.channelFill.style.width = `${Math.min(100, (chan.t / chan.need) * 100)}%`;
      } else els.channel.style.display = 'none';

      // Buy menu state.
      const buyVisible = S.phase === 'buy' && S.input.buyOpen;
      els.buy.style.display = buyVisible ? 'block' : 'none';
      if (buyVisible) {
        set('bm', els.buyMoney, '$' + p.money);
        for (const item of BUY_ITEMS) {
          const btn = buyButtons.get(item.key);
          const owned = (item.key === 'smg' || item.key === 'rifle' || item.key === 'sniper')
            ? p.guns.primary?.key === item.key
            : item.key === 'armor' ? p.armor && !p.helmet
            : item.key === 'armorhelm' ? p.helmet
            : item.key === 'kit' ? p.kit
            : p.nades[item.key] > 0;
          btn.classList.toggle('owned', !!owned);
          btn.classList.toggle('poor', !owned && p.money < item.price);
        }
      }

      // Scoreboard while Tab is held.
      const boardVisible = S.input.boardOpen && S.phase !== 'over';
      els.board.style.display = boardVisible ? 'block' : 'none';
      boardT -= dt;
      if (boardVisible && boardT <= 0) { boardT = 0.3; drawBoard(); }

      drawMinimap(p);
    },
  };
}
