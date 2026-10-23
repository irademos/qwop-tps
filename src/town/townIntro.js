// Town: the first day — a few townsfolk show a newcomer how Brindlewick lives, one small goal at
// a time, each paying a few coins: say hello to the merchant, go fishing with a fisher and cook
// the catch at the campfire, help a farmer with the harvest (picking their veg is allowed then)
// and sell it, hear the sheriff out about the bandit camp, and take a first job. Shown first in
// the quest tracker; ❗ over whoever to talk to next, 📍 where the goal is.
//
// The guide comes to the player: whoever has the next goal walks up and starts the talk
// (once a step — 'Later' leaves them be for GUIDE_SNOOZE_S), then walks the player to where
// the goal is (`lead`), waiting when they fall behind and fetching them when they wander off,
// and stays there with a tip now and then. Talking to them on the way gives tips (`tips`).
// (n.guiding + the 'guide' task — updateGuide; not by night, not while they're busy with
// something that matters: a fight, fleeing, the law's work.)
//
// State (saved with the town; in a shared town with the player's own things):
//   T.intro = { step, phase: 'talk' | 'do', count, guideId } while it runs, null once it's done
// A save from before the intro starts it too — the welcome offers to skip it.

import { firstName } from './townPeople.js';
import { RUN_SPEED, dist2, heightScale, pickOf } from './townConfig.js';

// guide: the role who gives it (null: no one — goal only); talk: what they say (talkOnly: the
// talk is the goal); goal + n: what the player does (introNote kinds); at: where its 📍 is;
// noTalk: carries straight on from the step before (same guide); coins: what it pays;
// gives: an item the guide hands over on accepting (ctx.grantItem — unless the player has one);
// lead: false — the guide stays put for the goal (the merchant, at the counter); tips: what
// they say on the way / when asked
const STEPS = [
  {
    id: 'welcome', guide: 'merchant', title: 'Say hello at the market', talkOnly: true, coins: 3, skippable: true,
    talk: 'Welcome to Brindlewick, {name}! New in town, and not a coin to your name, by the look of you. Here — a few to start. Folk around here will show you how we live: fishing, farming, the market. Shall I send someone round?',
    accept: '👍 Show me around',
    done: '{next} will come and find you — they\'ll show you the ropes.',
  },
  {
    id: 'fish', guide: 'fisher', title: 'Go fishing', goal: 'fish', n: 1, coins: 4, at: 'fishSpot', gives: 'rod',
    talk: 'Come fishing, {name}! Here — my old rod, it\'s yours. At the 🎣 fishing spot, swing it forward to cast. When the bobber goes under, pull the rod back sharp to hook it. Let it run, pull when it tires, then reel it in. Catch one and it\'s yours.',
    accept: '🎣 Let\'s fish',
    progress: 'Catch a fish 🐟 at the 🎣 fishing spot',
    done: 'Ha, a fine catch! Now cook it over the town fire — grilled fish fills you up far better. Come on, I\'ll show you.',
    tips: [
      'Swing the rod forward to cast — the harder the swing, the further it goes.',
      'Watch the bobber. When it goes right under, pull the rod back sharp — a little nibble first is just teasing.',
      'When the fish runs, don\'t fight it. When it tires, pull — then reel it in.',
      'No rod in your hand? Take it out with the 🎣 button.',
    ],
  },
  {
    id: 'cook', guide: 'fisher', noTalk: true, title: 'Cook your catch', goal: 'cook', n: 1, coins: 3, at: 'fire',
    progress: 'Grill a fish at the campfire 🍳',
    done: 'Smells good! Cooked food heals more, and the merchant pays more for it too.',
    tips: [
      'Walk up to the fire with your fish and press 🍳.',
      'Stay by the pot a few seconds while it cooks — wander off and it\'s ruined.',
      'Two veg make a stew, if you\'ve no fish.',
    ],
  },
  {
    id: 'harvest', guide: 'farmer', title: 'Help with the harvest', goal: 'pick', n: 3, coins: 3, at: 'guideWork',
    talk: 'Give me a hand with the harvest, {name}? Pick 3 veg from my field — 🌾 Pick — and keep them, they\'re yours. Just don\'t go picking anyone\'s field without asking: that\'s stealing.',
    accept: '🌾 Happy to help',
    progress: 'Pick 3 veg 🥕 from {guide}\'s field',
    done: 'Good hands! Take those to the market and sell them.',
    tips: [
      'Walk in among the crops and press 🌾 Pick.',
      'It grows back in a while. Only pick a field with the farmer\'s say-so, mind.',
    ],
  },
  {
    id: 'sell', guide: 'merchant', noTalk: true, title: 'Sell at the market', goal: 'sell', n: 1, coins: 3, at: 'market',
    progress: 'Sell something at the goods shop (💰 Sell)', lead: false,
    done: 'Pleasure doing business! The less I have of something, the more I pay for it.',
    tips: [
      'Walk in through the goods shop\'s door and come to my counter — then 💰 Sell.',
      'Cooked food fetches more than raw.',
    ],
  },
  {
    id: 'camp', guide: 'sheriff', title: 'Meet the sheriff', talkOnly: true, coins: 3,
    talk: 'A word, {name}. I keep the law in Brindlewick — keep your blade sheathed in town, and the guards won\'t trouble you. And stay away from the bandit camp, way out past the edge of town. They\'ll warn you once. Then it\'s swords.',
    accept: '👍 Understood',
    done: 'Good. Folk with a ❗ over them have work, if you want to earn your keep.',
  },
  {
    id: 'job', guide: null, title: 'Take a job', goal: 'job', n: 1, coins: 5,
    progress: 'Talk to someone with a ❗ and take their job',
  },
];
const GUIDE_REACH = 22;     // m — a guide this close says the step's done line (else the feed does)
const GUIDE_STOP = 1.9;     // m from the player a guide stops to talk
const LEAD_WAIT = 7;        // m — leading the way: further behind than this, they wait for the player
const LEAD_LOST = 26;       // m — further than this, they come back for them
const LEAD_SPEED = 2.6;     // m/s — a brisk walk while leading
const GUIDE_SNOOZE_S = 90;  // s a guide leaves the player be after 'Later'
const CALL_EVERY_S = 8;     // s between "This way!"s
const TIP_EVERY_S = [22, 34];
// What a guide's busy with that they'd drop to show the player round (anything else — a
// fight, fleeing, the law's work, sleep — comes first)
const GUIDE_OVER = new Set(['work', 'deliver', 'eat', 'browse', 'social', 'wander', 'chat', 'guide']);
const CALLS = ['This way, {name}!', 'Over here!', 'Keep up, {name}!', 'Come on — it\'s just along here.'];
const COMING = ['{name}! Hold on a moment!', 'Ah, {name} — there you are!', 'Hey, {name}! A word?'];

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownIntro(T, ctx) {
  const step = () => (T.intro ? STEPS[T.intro.step] ?? null : null);
  const fill = (text, s, guide) => text.replace(/\{(\w+)\}/g, (_, k) => {
    if (k === 'name') return ctx.getPlayerName();
    if (k === 'guide') return guide ? firstName(guide.name) : 'the farmer';
    if (k === 'next') {
      const next = STEPS[STEPS.indexOf(s) + 1];
      const g = next?.guide ? pickGuide(next.guide) : null;
      return g ? `${firstName(g.name)} the ${g.def.label.toLowerCase()}` : 'the townsfolk';
    }
    return '';
  });
  const available = (n) => !!n && n.alive && !n.fighter && n.jailedUntil <= T.simT && !n.def.outlaw;
  // The guide for a role: the one already picked while they're about, else the nearest
  const pickGuide = (role) => {
    const keep = T.intro?.guideId != null ? T.npcById(T.intro.guideId) : null;
    if (keep && keep.role === role && available(keep)) return keep;
    const p = T.playerPos();
    return T.npcs.filter((n) => n.role === role && available(n))
      .sort((a, b) => dist2(a.x, a.z, p.x, p.z) - dist2(b.x, b.z, p.x, p.z))[0] ?? null;
  };
  const guideOf = () => {
    const s = step();
    if (!s?.guide) return null;
    const g = pickGuide(s.guide);
    if (g) T.intro.guideId = g.id;
    return g;
  };

  const begin = (i) => {
    // (a different guide for this step: the last one goes back to their day)
    const prev = T.intro?.guideId != null ? T.npcById(T.intro.guideId) : null;
    if (prev && STEPS[i]?.guide !== prev.role) unguide(prev);
    if (i >= STEPS.length) { finish(); return; }
    const s = STEPS[i];
    T.intro = { step: i, phase: s.noTalk || !s.guide ? 'do' : 'talk', count: 0, guideId: T.intro?.guideId ?? null };
    guideOf();
    noGuide();
  };
  // Nobody of the guide's role left in town (dead, not replaced yet): the goal goes on without
  // them, a talk is skipped
  const roleGone = (role) => !T.npcs.some((n) => n.alive && n.role === role);
  const noGuide = () => {
    const s = step();
    if (!s?.guide || T.intro.phase !== 'talk' || !roleGone(s.guide)) return;
    if (s.talkOnly) begin(T.intro.step + 1);
    else T.intro.phase = 'do';
  };
  const start = (state) => {
    T.intro = null;
    if (state === null) return; // (done)
    if (state && Number.isInteger(state.step) && STEPS[state.step]) {
      T.intro = { step: state.step, phase: state.phase === 'do' ? 'do' : 'talk', count: Math.max(0, state.count | 0), guideId: state.guideId ?? null };
      if (STEPS[state.step].noTalk) T.intro.phase = 'do';
      return;
    }
    begin(0);
  };
  const snapshot = () => (T.intro ? { ...T.intro } : null);

  const pay = (s, guide) => {
    if (s.coins > 0) ctx.addCoins(s.coins);
    if (guide) {
      guide.attitude = Math.min(1, guide.attitude + 0.15);
      T.remember(guide, 'intro', { what: s.id === 'fish' || s.id === 'cook' ? 'Our fishing' : s.id === 'harvest' ? 'The harvest' : 'Your first day' });
    }
  };
  // A step's goal (or talk) is done: paid, the guide says so, on to the next
  const complete = () => {
    const s = step();
    if (!s) return;
    const g = s.guide ? T.npcById(T.intro.guideId) : null;
    pay(s, g);
    const line = s.done ? fill(s.done, s, g) : null;
    if (line && g?.body && T.distToPlayer(g) < GUIDE_REACH) T.say(g, line, { big: true });
    else if (line) T.feedLine(`${g ? `${g.def.emoji} ${firstName(g.name)}: ` : ''}${line}`);
    T.feedLine(`🌱 ${s.title} ✔${s.coins ? ` · +${s.coins} 🪙` : ''}`);
    const next = T.intro.step + 1;
    // (the next step's guide picked fresh, unless it's the same one carrying on)
    if (STEPS[next]?.guide !== s.guide) T.intro.guideId = null;
    begin(next);
    T.save();
  };
  const finish = () => {
    unguideAll();
    T.intro = null;
    ctx.showBanner('SETTLED IN!', 'You know your way around Brindlewick now', 2800);
    T.feedLine('🏡 That\'s your first day done. The town\'s yours to make a living in — or trouble.');
    T.save();
  };
  const skip = () => {
    unguideAll();
    T.intro = null;
    T.feedLine('🌱 Skipped the first day. Folk with a ❗ have work for you.');
    T.save();
  };

  // The player did something (kind: 'fish' | 'cook' | 'pick' | 'sell' | 'job'); true if it counted
  const introNote = (kind) => {
    const s = step();
    if (!s || s.goal !== kind) return false;
    T.intro.count += 1;
    if (T.intro.count >= (s.n ?? 1)) complete();
    return true;
  };
  // Picking a field is no theft while helping its farmer with the harvest
  const introAllowsPick = (field) => {
    const s = step();
    if (s?.id !== 'harvest') return false;
    const g = T.npcById(T.intro.guideId);
    return !g || g.work === field;
  };
  const isGuide = (n) => {
    const s = step();
    return !!s && T.intro.phase === 'talk' && T.intro.guideId === n.id;
  };
  // Talking to the step's guide: the step's talk (true: handled)
  const introTalk = (n) => {
    const s = step();
    if (!s || T.intro.guideId !== n.id) return false;
    if (T.intro.phase === 'do') {
      if (T.jobOf(n)) return false;
      const tips = s.tips ?? [];
      const tipLine = (k) => `${fill(tips[k % tips.length], s, n)}`;
      const show = (k) => {
        const choices = [{ label: n.guiding ? '👍 Lead on' : '👍 Thanks', primary: true }];
        if (tips.length > 1) choices.push({ label: '💡 Another tip', onClick: () => { if (n.alive) show(k + 1); } });
        T.jobTalk.open({
          who: `${n.def.emoji} ${firstName(n.name)}`, sub: `🌱 First day: ${s.title}`,
          text: tips.length ? tipLine(k) : fill(s.progress ?? s.title, s, n),
          reward: fill(s.progress ?? s.title, s, n), choices,
        });
      };
      show(T.intro.tipI ?? 0);
      T.intro.tipI = (T.intro.tipI ?? 0) + 1;
      return true;
    }
    const choices = [{
      label: s.accept ?? '👍 Okay', primary: true,
      onClick: () => {
        if (T.intro?.step !== STEPS.indexOf(s)) return;
        if (s.gives && !ctx.getItems()?.[s.gives] && ctx.grantItem(s.gives)) T.feedLine(`🎁 ${firstName(n.name)} gave you a ${s.gives === 'rod' ? 'fishing rod 🎣' : s.gives}.`);
        if (s.talkOnly) complete();
        else { T.intro.phase = 'do'; T.intro.count = 0; T.save(); }
      },
    }];
    if (s.skippable) choices.push({ label: 'I know my way around', primary: false, onClick: skip });
    else choices.push({ label: 'Later', primary: false, onClick: () => { snoozeUntil = T.simT + GUIDE_SNOOZE_S; } });
    T.jobTalk.open({
      who: `${n.def.emoji} ${firstName(n.name)}`, sub: `🌱 First day: ${s.title}`, text: fill(s.talk, s, n),
      reward: s.coins ? `Reward: 🪙 ${s.coins}` : null, choices,
    });
    return true;
  };

  // Where its marker goes: ❗ over the guide to talk to, 📍 at the goal
  const introTarget = () => {
    const s = step();
    if (!s) return null;
    const g = guideOf();
    const P = T.layout.places;
    if (T.intro.phase === 'talk') {
      if (!g || g.inside) return null;
      return { icon: '❗', x: g.x, z: g.z, h: 1.7 * heightScale(g.url) + 0.5 };
    }
    if (s.at === 'guideWork' && g?.work) return { icon: '📍', x: g.work.x, z: g.work.z, h: 1.5 };
    if (s.at === 'fire') return { icon: '📍', ...P.fire, h: 1.9 };
    if (s.at === 'fishSpot' && P.fishSpot) return { icon: '📍', x: P.fishSpot.x, z: P.fishSpot.z, h: 1.5 };
    // (the goods shop's counter — over its door while the player's outside)
    if (s.at === 'market') return { icon: '📍', ...T.stalls.spot('goods', 'counter'), h: 1.6 };
    return null;
  };
  // The tracker's first line
  const introEntry = () => {
    const s = step();
    if (!s) return null;
    const g = s.guide ? T.npcById(T.intro.guideId) : null;
    let progress;
    if (T.intro.phase === 'talk') {
      progress = !g ? 'Look around town'
        : g.inside ? `${firstName(g.name)} is home asleep — back in the morning`
          : g.guiding && T.distToPlayer(g) > GUIDE_STOP + 2 ? `${firstName(g.name)} the ${g.def.label.toLowerCase()} is coming to find you`
            : `Talk to ${firstName(g.name)} the ${g.def.label.toLowerCase()}`;
    } else {
      progress = fill(s.progress ?? s.title, s, g);
      if ((s.n ?? 1) > 1) progress += ` (${T.intro.count} / ${s.n})`;
      if (g?.guiding && T.distToPlayer(g) > LEAD_WAIT) progress += ` — follow ${firstName(g.name)}`;
    }
    return { title: `First day: ${s.title}`, progress, icon: T.intro.phase === 'talk' ? '❗' : '📍' };
  };
  // ── The guide coming to the player and walking them to the goal ──
  let snoozeUntil = -1e9;
  let leadAt = null;          // { step, guideId, x, z } — where the guide takes the player
  let greetedStep = -1;       // (the talk opens by itself once a step)
  const isNight = () => { const h = T.hour(); return h >= 21 || h < 6.5; };
  const unguide = (n) => {
    if (!n?.guiding) return;
    n.guiding = false;
    if (n.task?.type === 'guide') { n.task = null; n.path = null; }
  };
  const unguideAll = () => { for (const n of T.npcs) unguide(n); };
  // Should this guide be out showing the player round right now?
  const wantsGuide = (g) => {
    const s = step();
    if (!s || !g || T.intro.guideId !== g.id || ctx.isPlayerDead() || T.jail || T.law.stars > 0 || isNight()) return false;
    if (T.intro.phase === 'talk') return T.simT > snoozeUntil;
    return s.lead !== false && !!s.at && !!leadSpot(s, g);
  };
  const canGuide = (g) => available(g) && !g.inside && !g.following && !g.lost && !g.netFight && !(g.fear > 0)
    && (!g.task || GUIDE_OVER.has(g.task.type)) && T.talking?.npc !== g;
  // Where the goal is — a spot beside it to stand (picked once a step)
  const leadSpot = (s, g) => {
    const i = T.intro.step;
    if (leadAt?.step === i && leadAt.guideId === g.id) return leadAt;
    const P = T.layout.places;
    let at = null;
    if (s.at === 'fishSpot') at = P.fishSpot;
    else if (s.at === 'fire') at = P.fire;
    else if (s.at === 'guideWork') at = g.work;
    if (!at) return null;
    const spot = T.randomNear(at.x, at.z, 2.2);
    leadAt = { step: i, guideId: g.id, x: spot.x, z: spot.z, gx: at.x, gz: at.z };
    return leadAt;
  };
  const assignGuide = () => {
    const s = step();
    const g = s?.guide ? T.npcById(T.intro.guideId) : null;
    for (const n of T.npcs) if (n.guiding && n !== g) unguide(n);
    if (!g) return;
    if (!wantsGuide(g)) { unguide(g); return; }
    if (g.guiding || !canGuide(g) || !T.take(g)) return;
    g.guiding = true;
    T.setTask(g, { type: 'guide', dur: Infinity });
    // (back after a while: they ask again)
    if (T.intro.phase === 'talk') greetedStep = -1;
    if (T.intro.phase === 'talk' && T.distToPlayer(g) > 8) {
      T.feedLine(`👋 ${firstName(g.name)} the ${g.def.label.toLowerCase()} is coming to find you.`);
    }
  };
  // A guide's frame (the 'guide' task — townReactions.js updateSpecialTask); true: handled
  const walkTo = (n, t, x, z, speed, dt) => {
    if (!n.path || T.simT > (t.replanAt ?? 0) || dist2(x, z, t.tx ?? 1e9, t.tz ?? 1e9) > 1) {
      T.planPath(n, x, z);
      t.tx = x;
      t.tz = z;
      t.replanAt = T.simT + 1.5;
    }
    T.stepPath(n, dt, speed * n.speedScale);
  };
  const stand = (n, x, z, dt) => {
    n.moving = false;
    n.path = null;
    T.faceToward(n, x, z, dt);
  };
  const canAutoTalk = () => !T.jobTalk.isOpen() && !T.marketPanel.isOpen() && !T.storage.isOpen() && !T.fishing
    && !T.cooking && !T.inRoom && !T.sequence && !T.stalls.focused() && !T.lockpick.isOpen();
  const updateGuide = (n, t, dt) => {
    const s = step();
    if (!s || !n.guiding || T.intro.guideId !== n.id) { unguide(n); T.decide(n); return true; }
    if (t.step !== T.intro.step) Object.assign(t, { step: T.intro.step, called: false, arrived: false, callAt: 0, tipAt: 0 });
    const P = T.layout.places;
    const p = T.playerPos();
    // (the player indoors: met at the door outside)
    const pRoom = T.rooms.roomAt(p.x, p.z);
    const meet = pRoom && pRoom !== T.rooms.roomAt(n.x, n.z) ? P.rooms[pRoom].door : p;
    const dMeet = dist2(n.x, n.z, meet.x, meet.z);
    const say = (lines) => { if (n.body && !n.bubble) T.say(n, fill(pickOf(lines), s, n)); };
    if (T.intro.phase === 'talk') {
      // (talked to already and walked off: they leave the player be for a while)
      if (greetedStep === T.intro.step && dMeet > 15 && T.talking?.npc !== n) {
        snoozeUntil = T.simT + GUIDE_SNOOZE_S;
        unguide(n);
        T.decide(n);
        return true;
      }
      if (dMeet > GUIDE_STOP) {
        walkTo(n, t, meet.x, meet.z, dMeet > 12 ? RUN_SPEED : LEAD_SPEED, dt);
        if (dMeet < 9 && !t.called) { t.called = true; say(COMING); }
        return true;
      }
      stand(n, p.x, p.z, dt);
      if (greetedStep !== T.intro.step && !pRoom && canAutoTalk()) {
        greetedStep = T.intro.step;
        T.talkTo(n);
      }
      return true;
    }
    const spot = leadSpot(s, n);
    if (!spot) { unguide(n); T.decide(n); return true; }
    const dSpot = dist2(n.x, n.z, spot.x, spot.z);
    const pSpot = dist2(meet.x, meet.z, spot.x, spot.z);
    if (dMeet > LEAD_LOST) {
      // (wandered off: back for them)
      walkTo(n, t, meet.x, meet.z, RUN_SPEED, dt);
    } else if (dSpot > 1 && dMeet > LEAD_WAIT && dSpot < pSpot) {
      // (ahead of the player: wait, and call them on)
      stand(n, p.x, p.z, dt);
      if (T.simT > (t.callAt ?? 0)) { t.callAt = T.simT + CALL_EVERY_S; say(CALLS); }
    } else if (dSpot > 1) {
      walkTo(n, t, spot.x, spot.z, dSpot > pSpot + 4 ? RUN_SPEED : LEAD_SPEED, dt);
    } else {
      // (there: look at the player, a tip now and then while they're about)
      stand(n, dMeet < 12 ? p.x : spot.gx, dMeet < 12 ? p.z : spot.gz, dt);
      if (!t.arrived) { t.arrived = true; t.tipAt = T.simT + 3; if (dMeet < 12) say(['Here we are!', 'This is the place.']); }
      if (s.tips?.length && dMeet < 12 && T.simT > (t.tipAt ?? 0)) {
        t.tipAt = T.simT + TIP_EVERY_S[0] + Math.random() * (TIP_EVERY_S[1] - TIP_EVERY_S[0]);
        say(s.tips);
      }
    }
    return true;
  };

  // Upkeep: a guide who's gone (dead, jailed) is replaced; a talk with nobody to give it, skipped
  const updateIntro = () => {
    if (!step()) { if (T.npcs.some((n) => n.guiding)) unguideAll(); return; }
    guideOf();
    noGuide();
    if (step()) assignGuide();
  };

  Object.assign(T, {
    introAllowsPick, introEntry, introNote, introSnapshot: snapshot, introTalk, introTarget, isIntroGuide: isGuide,
    startIntro: start, updateGuide, updateIntro,
  });
}
