// Town: talking with townsfolk and the interact buttons (bottom centre, E / Enter, the phone's
// Block bar).

import { FOLLOW_LINES, fillLine, firstName, giftLine, talkLine } from './townPeople.js';
import { GOODS } from './townEconomy.js';
import {
  ACT_DIST, BAIL, BRIBE, FRIEND_ATTITUDE, GIFT_COINS, GIVE_UP_DIST, GRUDGE_ATTITUDE, TALK_RANGE,
  dist2, el, pickOf,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownActs(T, ctx) {
  // ── Talking with the player ──
  const talkTo = (n) => {
    if (!n.alive || !n.body) return;
    if (n.fear > 0) { T.say(n, talkLine(n)); return; }
    if (n.following) { T.say(n, fillLine(pickOf(FOLLOW_LINES.join), { name: ctx.getPlayerName() }), { big: true }); T.talking = { npc: n }; return; }
    const taskType = n.task?.type === 'talk' ? n.task.prevType : n.task?.type;
    // (someone busy with another player — shared town — talks without stopping)
    if (n.task?.type !== 'talk') {
      if (T.take(n)) {
        n.task = { type: 'talk', t: 0, phase: 'do', dur: 7, prevType: taskType };
        n.path = null;
        n.moving = false;
      }
    } else {
      n.task.t = 0;
    }
    T.talking = { npc: n };
    const job = T.jobOf(n);
    if (job && n.attitude >= GRUDGE_ATTITUDE && !(job.shady && n.attitude <= -0.2)) { T.openJobTalk(n, job); return; }
    T.say(n, talkLine(n, { playerName: ctx.getPlayerName(), taskType, market: marketTalk() }), { big: true });
    if (T.simT - n.talkBonusAt > 60) {
      n.talkBonusAt = T.simT;
      n.attitude = Math.min(1, n.attitude + 0.04);
    }
  };
  const gift = (n) => {
    if (!n.alive) return;
    if (ctx.getCoins() < GIFT_COINS) { T.say(n, giftLine(n, ctx.getPlayerName(), true), { big: true }); return; }
    ctx.addCoins(-GIFT_COINS);
    ctx.playSfx('coin');
    T.npcMoney(n, GIFT_COINS);
    n.attitude = Math.min(1, n.attitude + 0.25);
    if (n.task?.type === 'talk') n.task.t = 0;
    T.say(n, giftLine(n, ctx.getPlayerName()), { big: true });
    if (n.attitude >= FRIEND_ATTITUDE && !n.friendNoted) {
      n.friendNoted = true;
      T.feedLine(`🤝 ${firstName(n.name)} is your friend now — they won't tell the guards on you.`);
    }
  };
  const clearTalk = (n) => {
    if (T.talking?.npc === n) T.talking = null;
    if (n.task?.type === 'talk') n.task = null;
  };
  const clearAllTalk = () => {
    T.talking = null;
    for (const n of T.npcs) if (n.task?.type === 'talk') n.task = null;
  };

  // What the market's like, for the townsfolk's talk
  const marketTalk = () => {
    const scarce = T.market.scarcest();
    return {
      scarce: scarce ? { ...GOODS[scarce], price: T.market.price(scarce) } : null,
      foodOut: !T.market.cheapestFood(),
      merchantGone: !T.npcs.some((m) => m.alive && m.role === 'merchant'),
    };
  };

  // ── Interact (bottom-centre buttons, E / Enter, the phone's Block bar) ──
  const nearestTalkable = () => {
    const p = T.playerPos();
    const hostileNear = T.npcs.some((n) => n.fighter && dist2(n.x, n.z, p.x, p.z) < 8);
    if (hostileNear || ctx.isPlayerDead()) return null;
    let best = null;
    let bd = TALK_RANGE;
    for (const n of T.npcs) {
      if (!n.alive || !n.body || n.fighter || n.netFight || n.inside || n.dying || n.def.outlaw) continue;
      if (['brawl', 'mug', 'arrest'].includes(n.task?.type)) continue;
      const d = dist2(n.x, n.z, p.x, p.z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  const computeActs = () => {
    const out = [];
    if (T.sequence) return out;
    if (T.marketPanel.isOpen()) {
      out.push({ key: 'close', label: '✖ Close market', onClick: T.closeMarket });
      return out;
    }
    if (T.stalls.focused()) {
      // At a counter: buy what's picked, the next thing, back
      const buy = T.stalls.buyLabel();
      if (buy) out.push({ key: 'buy', label: buy, onClick: () => { T.stalls.buySelected(); T.actsAt = 0; } });
      out.push({ key: 'next', label: '› Next', onClick: () => { T.stalls.step(1); T.actsAt = 0; } });
      out.push({ key: 'back', label: '⬅ Back', onClick: () => { T.stalls.unfocus(); T.actsAt = 0; } });
      return out;
    }
    if (T.lockpick.isOpen()) {
      out.push({ key: 'pin', label: '🔧 Now!', onClick: () => T.lockpick.press() });
      out.push({ key: 'unpick', label: '✖ Stop', onClick: () => T.lockpick.stop() });
      return out;
    }
    if (T.jail) {
      out.push({ key: 'bail', label: `🔓 Bail (${BAIL} 🪙)`, onClick: T.payBail });
      out.push({ key: 'bribe', label: `🤝 Bribe (${BRIBE} 🪙)`, onClick: T.bribe });
      out.push({ key: 'pick', label: '🔧 Pick the lock', onClick: T.startLockpick });
      out.push({ key: 'sleep', label: '😴 Sleep it off', onClick: T.sleepItOff });
      return out;
    }
    if (T.jobTalk.isOpen()) return out; // (the talk box has its own buttons)
    if (T.law.stars > 0) {
      const p = T.playerPos();
      if (T.npcs.some((n) => n.fighter && n.def.law && dist2(n.x, n.z, p.x, p.z) < GIVE_UP_DIST)) {
        out.push({ key: 'giveup', label: '🙌 Give up', onClick: () => T.busted({ surrendered: true }) });
        return out;
      }
    }
    if (T.fishing) {
      out.push({ key: 'fishing', label: '🎣 Fishing… (reel in)', onClick: () => { T.fishing = null; } });
      return out;
    }
    const calm = T.calmNow();
    // (the strongbox can be snatched mid-fight: the gang guards it)
    if (!T.strongboxHeld && T.layout.props.strongbox.visible && T.activeJobs().some((j) => j.kind === 'fetchStrongbox')) {
      const p = T.playerPos();
      const sb = T.layout.places.strongbox;
      if (dist2(p.x, p.z, sb.x, sb.z) < 2) out.push({ key: 'strongbox', label: '📦 Take the strongbox', onClick: T.takeStrongbox });
    }
    const stall = calm ? T.nearestStall() : null;
    if (stall === 'gear' && T.gearOpen()) out.push({ key: 'gear', label: '⚔️ Weapons', onClick: () => T.focusStall('gear') });
    if (stall === 'goods' && T.marketOpen()) {
      out.push({ key: 'goods', label: '🧺 Goods', onClick: () => T.focusStall('goods') });
      out.push({ key: 'sell', label: '💰 Sell', onClick: T.openMarket });
    }
    // A job's townsperson within reach (not only the nearest): its 📦 / 💰 first
    if (!ctx.isPlayerDead() && calm) {
      for (const o of T.npcs) {
        if (o.alive && o.body && !o.fighter && !o.inside && T.distToPlayer(o) < ACT_DIST) out.push(...T.jobActsFor(o));
      }
    }
    const n = nearestTalkable();
    if (n) {
      // (❗ a job to give, ❓ a reward waiting — as the marker over them)
      const j = T.jobOf(n);
      const icon = j && !j.shady && j.status !== 'active' ? (j.status === 'done' ? '❓' : '❗') : '💬';
      out.push({ key: `talk:${n.id}`, label: `${icon} ${firstName(n.name)}`, onClick: () => talkTo(n) });
      if (T.talking?.npc === n) {
        if (n.following) out.push({ key: `dismiss:${n.id}`, label: '👋 Go home', onClick: () => T.dismiss(n) });
        else if (T.canRecruit(n)) out.push({ key: `join:${n.id}`, label: '🤝 Join me', onClick: () => T.recruit(n) });
        else out.push({ key: `gift:${n.id}`, label: `🪙 Give ${GIFT_COINS}`, onClick: () => gift(n) });
      }
    }
    if (calm) {
      if (T.ripeCropNear()) out.push({ key: 'pick', label: '🌾 Pick veg', onClick: T.pickCrop });
      if (T.nearWater()) out.push({ key: 'fish', label: '🎣 Fish', onClick: T.startFishing });
      const food = T.hurtFood();
      if (food) out.push({ key: `eat:${food}`, label: `🍽 Eat ${GOODS[food].emoji}`, onClick: () => T.eat(food) });
    }
    return out.slice(0, 3);
  };
  const refreshActs = () => {
    T.acts = computeActs();
    const key = T.acts.map((a) => `${a.key}|${a.label}`).join(',');
    if (key === T.actsKey) return;
    T.actsKey = key;
    T.actsEl.replaceChildren(...T.acts.map((a, i) => {
      const b = el('button', `${i > 0 ? 'ui-btn-secondary' : 'ui-btn'} town-act`, a.label);
      b.type = 'button';
      b.addEventListener('click', () => { if (T.active) a.onClick(); });
      return b;
    }));
    T.actsEl.classList.toggle('hidden', !T.acts.length);
  };
  const interact = () => {
    if (T.active && T.jobTalk.pressFirst()) { T.actsAt = 0; return true; }
    if (!T.active || !T.acts.length) return false;
    T.acts[0].onClick();
    T.actsAt = 0;
    return true;
  };
  const onKey = (e) => {
    if (!T.active || e.repeat) return;
    if (e.target?.closest?.('input, textarea, select')) return;
    if (document.body.classList.contains('settings-open')) return;
    if (e.key === 'Escape' && T.marketPanel.isOpen()) { T.closeMarket(); e.preventDefault(); return; }
    if (e.key === 'Escape' && T.stalls.focused()) { T.stalls.unfocus(); e.preventDefault(); return; }
    if (e.key === 'Escape' && T.jobTalk.isOpen()) { T.jobTalk.close(); e.preventDefault(); return; }
    if (e.key === 'Escape' && T.lockpick.isOpen()) { T.lockpick.stop(); e.preventDefault(); return; }
    if (e.key === 'e' || e.key === 'E' || (e.key === 'Enter' && !e.target?.closest?.('button'))) {
      if (interact()) e.preventDefault();
    }
  };

  Object.assign(T, {
    clearAllTalk, clearTalk, interact, marketTalk, onKey, refreshActs,
  });
}
