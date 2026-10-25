// Town: talking with townsfolk (the talk box) and the interact buttons (bottom centre, E / Enter, the phone's
// Block bar).

import { FOLLOW_LINES, fillLine, firstName, giftLine, talkLine } from './townPeople.js';
import { GOODS } from './townEconomy.js';
import {
  ACT_DIST, BAIL, BRIBE, FRIEND_ATTITUDE, GIFT_COINS, GIVE_UP_DIST, GRUDGE_ATTITUDE, TALK_RANGE,
  dist2, el, pickOf,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownActs(T, ctx) {
  // ── Talking with the player: the talk box at the bottom (townJobs.js createJobTalk) with what
  // they say and what the player can say back; speech bubbles are for townsfolk among themselves ──
  const whoOf = (n) => `${n.def.emoji} ${firstName(n.name)}`;
  // A line of small talk (something they remember the player did, now and then — townMemory.js)
  const smallTalk = (n) => {
    const taskType = n.task?.type === 'talk' ? n.task.prevType : n.task?.type;
    const line = T.memoryLine(n) ?? talkLine(n, { playerName: ctx.getPlayerName(), taskType, market: marketTalk() });
    if (T.simT - n.talkBonusAt > 60) {
      n.talkBonusAt = T.simT;
      n.attitude = Math.min(1, n.attitude + 0.04);
    }
    return line;
  };
  // Show what they said, with the player's answers
  const chat = (n, text) => {
    T.talking = { npc: n };
    const choices = [];
    if (n.fear > 0) {
      choices.push({ label: '👋 Leave them be', primary: true });
    } else {
      choices.push({ label: '💬 Chat', primary: true, onClick: () => { if (n.alive) chat(n, smallTalk(n)); } });
      if (n.following) {
        choices.push({ label: '👋 Go home', onClick: () => {
          const said = T.dismiss(n, undefined, { quiet: true });
          if (said) farewell(n, said);
        } });
      } else if (T.canRecruit(n)) {
        choices.push({ label: '🤝 Join me', onClick: () => {
          const said = T.recruit(n, { quiet: true });
          if (said) farewell(n, said, '👍 Let\'s go');
        } });
      }
      choices.push({ label: `🪙 Give ${GIFT_COINS}`, onClick: () => gift(n) });
      choices.push({ label: '👋 Goodbye' });
    }
    T.jobTalk.open({ who: whoOf(n), sub: n.def.label, text, choices });
  };
  // Their last word (joining the player / heading home), one button to close
  const farewell = (n, text, label = '👋 Bye') => {
    T.talking = { npc: n };
    T.jobTalk.open({ who: whoOf(n), sub: n.def.label, text, choices: [{ label, primary: true }] });
  };
  const talkTo = (n) => {
    if (!n.alive || !n.body) return;
    if (n.fear > 0) { chat(n, talkLine(n)); return; }
    if (n.following) { chat(n, fillLine(pickOf(FOLLOW_LINES.join), { name: ctx.getPlayerName() })); return; }
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
    // (the first day: whoever's showing the player around — townIntro.js)
    if (T.introTalk(n)) return;
    const job = T.jobOf(n);
    if (job && n.attitude >= GRUDGE_ATTITUDE && !(job.shady && n.attitude <= -0.2)) { T.openJobTalk(n, job); return; }
    chat(n, smallTalk(n));
  };
  const gift = (n) => {
    if (!n.alive) return;
    if (ctx.getCoins() < GIFT_COINS) { chat(n, giftLine(n, ctx.getPlayerName(), true)); return; }
    ctx.addCoins(-GIFT_COINS);
    ctx.playSfx('coin');
    T.npcMoney(n, GIFT_COINS);
    n.attitude = Math.min(1, n.attitude + 0.25);
    T.remember(n, 'gift');
    if (n.task?.type === 'talk') n.task.t = 0;
    if (n.attitude >= FRIEND_ATTITUDE && !n.friendNoted) {
      n.friendNoted = true;
      T.feedLine(`🤝 ${firstName(n.name)} is your friend now — they won't tell the guards on you.`);
    }
    chat(n, giftLine(n, ctx.getPlayerName()));
  };
  const clearTalk = (n) => {
    if (T.talking?.npc === n) T.talking = null;
    if (n.task?.type === 'talk') n.task = null;
  };
  // (the talk box closed: they go back to what they were doing)
  const endTalk = () => {
    const n = T.talking?.npc;
    if (n) clearTalk(n);
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
    if (T.storage.isOpen()) {
      out.push({ key: 'closechest', label: '✖ Close chest', onClick: () => T.storage.close() });
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
    if (T.jobTalk.isOpen()) return out; // (the talk box has its own answers)
    if (T.law.stars > 0) {
      const p = T.playerPos();
      if (T.npcs.some((n) => n.fighter && n.def.law && dist2(n.x, n.z, p.x, p.z) < GIVE_UP_DIST)) {
        out.push({ key: 'giveup', label: '🙌 Give up', onClick: () => T.busted({ surrendered: true }) });
        return out;
      }
    }
    if (T.fishing) {
      out.push(...T.fishingActs(false)); // (the reel / the rod do the rest; no gyro: ⬆ Pull)
      return out;
    }
    if (T.cooking) {
      out.push(...T.cookActs());
      return out;
    }
    // Something in hand (townGrab.js — the hose): ✋ Drop it, and the farming buttons
    if (T.held) {
      out.push(...T.grabActs(), ...T.farmActs());
      return out.slice(0, 3);
    }
    const calm = T.calmNow();
    // (the strongbox can be snatched mid-fight: the gang guards it)
    if (!T.strongboxHeld && T.layout.props.strongbox.visible && T.activeJobs().some((j) => j.kind === 'fetchStrongbox')) {
      const p = T.playerPos();
      const sb = T.layout.places.strongbox;
      if (dist2(p.x, p.z, sb.x, sb.z) < 2) out.push({ key: 'strongbox', label: '📦 Take the strongbox', onClick: T.takeStrongbox });
    }
    // The houses (walked into through the door — updateRooms): inside, 🚪 Leave by the doorway;
    // the shops' back counter buttons
    if (T.inRoom) {
      const p = T.playerPos();
      const d = T.rooms.doorInside(T.inRoom);
      if (dist2(p.x, p.z, d.x, d.z) < 1.8) out.push({ key: 'leave', label: '🚪 Leave', onClick: T.leaveRoom });
      out.push(...T.chestActs());
      out.push(...T.bedActs());
    }
    // A locked door (townHomes.js): buy the player's house, knock, pick the lock
    if (calm) out.push(...T.doorActs());
    const stall = calm ? T.nearestStall() : null;
    if (stall === 'shop' && T.marketOpen()) {
      out.push({ key: 'shop', label: '🛒 Shop', onClick: () => T.focusStall('shop') });
      out.push({ key: 'sell', label: '💰 Sell', onClick: T.openMarket });
    }
    if (stall === 'wizard' && T.stallOpen('wizard')) out.push({ key: 'wizard', label: '🔮 Wizard\'s wares', onClick: () => T.focusStall('wizard') });
    // Farming (townFarming.js): pick a grown veg, buy a field, plant a seed
    if (calm) out.push(...T.farmActs());
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
      const icon = T.isIntroGuide(n) ? '❗' : j && !j.shady && j.status !== 'active' ? (j.status === 'done' ? '❓' : '❗') : '💬';
      // (and how they feel about the player — townMemory.js)
      out.push({ key: `talk:${n.id}`, label: `${icon} ${firstName(n.name)} ${T.moodOf(n.attitude).emoji}`, onClick: () => talkTo(n) });
    }
    // (the first day: walk the player to the goal again — townIntro.js)
    if (calm) out.push(...T.introActs());
    if (calm) {
      out.push(...T.cookActs());
      out.push(...T.grabActs());
      if (T.ripeCropNear()) out.push({ key: 'pick', label: '🌾 Pick veg', onClick: T.pickCrop });
      out.push(...T.fishingActs(true));
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
    if (e.key === 'Escape' && T.storage.isOpen()) { T.storage.close(); e.preventDefault(); return; }
    if (e.key === 'Escape' && T.stalls.focused()) { T.stalls.unfocus(); e.preventDefault(); return; }
    if (e.key === 'Escape' && T.jobTalk.isOpen()) { T.jobTalk.close(); e.preventDefault(); return; }
    if (e.key === 'Escape' && T.lockpick.isOpen()) { T.lockpick.stop(); e.preventDefault(); return; }
    if (e.key === 'e' || e.key === 'E' || (e.key === 'Enter' && !e.target?.closest?.('button'))) {
      if (interact()) e.preventDefault();
    }
  };

  Object.assign(T, {
    clearAllTalk, clearTalk, endTalk, interact, marketTalk, onKey, refreshActs, talkTo,
  });
}
