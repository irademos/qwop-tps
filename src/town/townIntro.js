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
// lead: false — the guide stays put for the goal; tips: what they say on the way / when asked;
// next: what the guide says is next when the same guide carries on (a talk box — debrief)
const STEPS = [
  {
    id: 'welcome', guide: 'merchant', title: 'Say hello at the market', talkOnly: true, coins: 3, skippable: true,
    talk: 'Welcome to Brindlewick, {name}! New in town, and not a coin to your name, by the look of you. Here — a few to start. Folk around here will show you how we live: fishing, farming, the market. Shall I send someone round?',
    accept: 'Show me around',
    done: '{next} will come and find you — they\'ll show you the ropes.',
  },
  {
    id: 'fish', guide: 'fisher', title: 'Go fishing', goal: 'fish', n: 1, coins: 4, at: 'fishSpot', gives: 'rod',
    talk: 'Come fishing, {name}! Here — my old rod, it\'s yours. At the fishing spot, swing it forward to cast. When the bobber goes under, pull the rod back sharp to hook it. Let it run, pull when it tires, then reel it in. Catch one and it\'s yours.',
    accept: 'Let\'s fish',
    progress: 'Catch a fish at the fishing spot',
    done: 'Ha, a fine catch! You\'re a natural, {name}.',
    next: 'Now let\'s cook it. Raw fish won\'t do you much good — grilled over the town campfire it heals far more, and sells for more too. Follow me to the fire, then press Grill by the pot and stay close while it grills.',
    tips: [
      'Swing the rod forward to cast — the harder the swing, the further it goes.',
      'Watch the bobber. When it goes right under, pull the rod back sharp — a little nibble first is just teasing.',
      'When the fish runs, don\'t fight it. When it tires, pull — then reel it in.',
      'No rod in your hand? Take it out with the 🎣 button.',
    ],
  },
  {
    id: 'cook', guide: 'fisher', noTalk: true, title: 'Cook your catch', goal: 'cook', n: 1, coins: 3, at: 'fire',
    progress: 'Grill a fish at the campfire',
    done: 'Smells good! Cooked food heals more, and the merchant pays more for it too.',
    tips: [
      'Walk up to the fire with your fish and press Grill.',
      'Stay by the pot a few seconds while it cooks — wander off and it\'s ruined.',
      'Two veg make a stew, if you\'ve no fish.',
    ],
  },
  {
    id: 'harvest', guide: 'farmer', title: 'Help with the harvest', goal: 'pick', n: 3, coins: 3, at: 'guideWork',
    talk: 'Give me a hand with the harvest, {name}? Pick 3 veg from my field — press Pick — and keep them, they\'re yours. Just don\'t go picking anyone\'s field without asking: that\'s stealing.',
    accept: 'Happy to help',
    progress: 'Pick 3 veg from {guide}\'s field',
    done: 'Good hands! That\'s the harvest in.',
    next: 'Those veg are yours to keep — so let\'s turn them into coin. I\'ll walk you to the shop: go in through the door, up to the merchant\'s counter, and press Sell.',
    tips: [
      'Walk in among the crops and press Pick.',
      'It grows back in a while. Only pick a field with the farmer\'s say-so, mind.',
    ],
  },
  {
    id: 'sell', guide: 'farmer', noTalk: true, title: 'Sell at the market', goal: 'sell', n: 1, coins: 3, at: 'market',
    progress: 'Sell your veg at the shop: in through the door, to the counter, Sell',
    done: 'There — coins in your pocket! The less the merchant has of something, the more he pays for it.',
    tips: [
      'In through the door, up to the counter at the back, then Sell.',
      'Cooked food fetches more than raw.',
      'The merchant\'s only there in the day — no selling at night.',
    ],
  },
  {
    id: 'camp', guide: 'sheriff', title: 'Meet the sheriff', talkOnly: true, coins: 3,
    talk: 'A word, {name}. I keep the law in Brindlewick — keep your blade sheathed in town, and the guards won\'t trouble you. And stay away from the bandit camp, way out past the edge of town. They\'ll warn you once. Then it\'s swords.',
    accept: 'Understood',
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
const AUTO_WALK_SPEED = 3.2; // m/s the player is walked along at
const FOLLOW_STOP = 2.4;     // m behind the guide the walked-along player stops…
const FOLLOW_RESUME = 3.8;   // …and sets off again
const WALK_RESUME = 1.2;     // m past a goal's stop distance before walking on again
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
    const next = T.intro.step + 1;
    const carriesOn = !!g && !!s.next && STEPS[next]?.guide === s.guide;
    // (the same guide carrying on: they come over and say what's next in the talk box)
    if (carriesOn) { /* (said in the debrief) */ }
    else if (line && g?.body && T.distToPlayer(g) < GUIDE_REACH) T.say(g, line, { big: true });
    else if (line) T.feedLine(`${g ? `${firstName(g.name)}: ` : ''}${line}`);
    T.feedLine(`${s.title} — done${s.coins ? ` · +${s.coins} coins` : ''}`);
    // (the next step's guide picked fresh, unless it's the same one carrying on)
    if (STEPS[next]?.guide !== s.guide) T.intro.guideId = null;
    begin(next);
    if (carriesOn && T.intro) T.intro.debrief = `${line ? `${line} ` : ''}${fill(s.next, s, g)}`;
    T.save();
  };
  const finish = () => {
    unguideAll();
    T.intro = null;
    ctx.showBanner('SETTLED IN!', 'You know your way around Brindlewick now', 2800);
    T.feedLine('That\'s your first day done. The town\'s yours to make a living in — or trouble.');
    T.save();
  };
  const skip = () => {
    unguideAll();
    T.intro = null;
    T.feedLine('Skipped the first day. Folk with a ❗ have work for you.');
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
    if (T.intro.phase === 'do' && T.intro.debrief) {
      // (a goal just done: what's next — and off they go, the player walked along)
      const text = T.intro.debrief;
      T.intro.debrief = null;
      T.jobTalk.open({
        who: firstName(n.name), sub: `First day: ${s.title}`, text,
        reward: s.coins ? `Next: ${fill(s.progress ?? s.title, s, n)} · 🪙 ${s.coins}` : null,
        choices: [
          { label: 'Lead the way', primary: true, onClick: () => { if (T.intro) T.intro.autoWalk = true; } },
          { label: 'I\'ll find my own way', primary: false, onClick: () => { if (T.intro) T.intro.autoWalk = false; } },
        ],
      });
      return true;
    }
    if (T.intro.phase === 'do') {
      if (T.jobOf(n)) return false;
      const tips = s.tips ?? [];
      const tipLine = (k) => `${fill(tips[k % tips.length], s, n)}`;
      const show = (k) => {
        const choices = [{ label: n.guiding ? 'Lead on' : 'Thanks', primary: true }];
        if (tips.length > 1) choices.push({ label: 'Another tip', act: true, onClick: () => { if (n.alive) show(k + 1); } });
        T.jobTalk.open({
          who: firstName(n.name), sub: `First day: ${s.title}`,
          text: tips.length ? tipLine(k) : fill(s.progress ?? s.title, s, n),
          reward: fill(s.progress ?? s.title, s, n), choices,
        });
      };
      show(T.intro.tipI ?? 0);
      T.intro.tipI = (T.intro.tipI ?? 0) + 1;
      return true;
    }
    const choices = [{
      label: s.accept ?? 'Okay', primary: true,
      onClick: () => {
        if (T.intro?.step !== STEPS.indexOf(s)) return;
        if (s.gives && !ctx.getItems()?.[s.gives] && ctx.grantItem(s.gives)) T.feedLine(`${firstName(n.name)} gave you a ${s.gives === 'rod' ? 'fishing rod' : s.gives}.`);
        if (s.talkOnly) complete();
        else { T.intro.phase = 'do'; T.intro.count = 0; T.intro.autoWalk = true; T.save(); }
      },
    }];
    if (s.skippable) choices.push({ label: 'I know my way around', primary: false, onClick: skip });
    else choices.push({ label: 'Later', primary: false, onClick: () => { snoozeUntil = T.simT + GUIDE_SNOOZE_S; } });
    T.jobTalk.open({
      who: firstName(n.name), sub: `First day: ${s.title}`, text: fill(s.talk, s, n),
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
    // (the shop's counter — over its door while the player's outside)
    if (s.at === 'market') return { icon: '📍', ...T.stalls.spot('shop', 'counter'), h: 1.6 };
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
  const crumbs = [];          // where the leading guide walked (the player walked along follows it)
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
    return !!T.intro.debrief || (s.lead !== false && !!s.at && !!leadSpot(s, g));
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
    else if (s.at === 'market') at = P.rooms.shop?.door ?? null;
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
      T.feedLine(`${firstName(g.name)} the ${g.def.label.toLowerCase()} is coming to find you.`);
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
    if (t.step !== T.intro.step) {
      Object.assign(t, { step: T.intro.step, called: false, arrived: false, callAt: 0, tipAt: 0 });
      crumbs.length = 0;
    }
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
    // (a goal just done, the same guide carrying on: over to the player to say what's next)
    if (T.intro.debrief) {
      if (dMeet > GUIDE_STOP) { walkTo(n, t, meet.x, meet.z, dMeet > 12 ? RUN_SPEED : LEAD_SPEED, dt); return true; }
      stand(n, p.x, p.z, dt);
      if (!pRoom && canAutoTalk()) T.talkTo(n);
      return true;
    }
    const spot = leadSpot(s, n);
    if (!spot) { unguide(n); T.decide(n); return true; }
    // (the way they walk — the player, walked along, follows it: updateIntroWalk)
    const last = crumbs[crumbs.length - 1];
    if (!T.rooms.roomAt(n.x, n.z) && (!last || dist2(last.x, last.z, n.x, n.z) > 1)) {
      crumbs.push({ x: n.x, z: n.z });
      if (crumbs.length > 80) crumbs.shift();
    }
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

  // ── The player walked along (T.intro.autoWalk — on when a goal is taken / 'Lead the way'):
  // behind the guide, along the way they walked, then up to the goal itself; any move of the
  // player's own (joystick / WASD) stops it — 🚶 Walk me there starts it again ──
  const busy = () => T.jobTalk.isOpen() || T.marketPanel.isOpen() || T.storage.isOpen() || T.fishing || T.cooking
    || T.sequence || T.jail || T.stalls.focused() || T.lockpick.isOpen() || ctx.isPlayerDead() || T.law.stars > 0;
  // Where to walk the player now: { x, z, stop } (null: nowhere / there)
  const walkTarget = () => {
    const s = step();
    if (!s || T.intro.phase !== 'do' || T.intro.debrief || !s.at) return null;
    const g = s.guide ? T.npcById(T.intro.guideId) : null;
    const P = T.layout.places;
    const p = T.playerPos();
    const inRoom = T.inRoom;
    // The goal itself
    let goal = null;
    if (s.at === 'market') {
      if (inRoom === 'shop') goal = { ...T.stalls.spot('shop', 'counter'), stop: 2.2 };
      else if (!inRoom && P.rooms.shop) {
        // (just past the door's spot, toward the house: walking there goes in — walkInDoor)
        const r = P.rooms.shop;
        goal = { x: r.door.x - Math.sin(r.exitYaw) * 0.6, z: r.door.z - Math.cos(r.exitYaw) * 0.6, stop: 0.05 };
      }
    } else if (inRoom) return null;
    else if (s.at === 'fishSpot' && P.fishSpot) goal = { x: P.fishSpot.x, z: P.fishSpot.z, stop: 1.5 };
    else if (s.at === 'fire') goal = { x: P.fire.x, z: P.fire.z, stop: 1.9 };
    else if (s.at === 'guideWork' && g?.work) {
      // (the nearest ripe crop of their field)
      const ripe = (g.work.crops ?? []).filter((c) => c.ripe)
        .sort((a, b) => dist2(a.x, a.z, p.x, p.z) - dist2(b.x, b.z, p.x, p.z))[0];
      goal = ripe ? { x: ripe.x, z: ripe.z, stop: 0.8 } : { x: g.work.x, z: g.work.z, stop: 1.5 };
    }
    if (!goal) return null;
    // Behind the guide while they're still on the way (and the player's further from the goal)
    if (g?.guiding && !inRoom && leadAt && dist2(g.x, g.z, leadAt.x, leadAt.z) > 1.5
      && dist2(p.x, p.z, goal.x, goal.z) > dist2(g.x, g.z, goal.x, goal.z)) {
      // (from the crumb nearest the player on: the next one along)
      let k = -1;
      let best = Infinity;
      crumbs.forEach((c, i) => { const d = dist2(c.x, c.z, p.x, p.z); if (d < best) { best = d; k = i; } });
      if (k >= 0) crumbs.splice(0, best < 1.2 ? k + 1 : k);
      return crumbs[0] ? { x: crumbs[0].x, z: crumbs[0].z, stop: 0.3, behind: g } : { x: g.x, z: g.z, stop: 2.2 };
    }
    return goal;
  };
  let walkResting = false;
  let walkSpeed = 0;
  const updateIntroWalk = (dt) => {
    if (!T.intro?.autoWalk || !step()) return;
    if (ctx.isSteering()) {
      T.intro.autoWalk = false;
      T.actsAt = 0;
      return;
    }
    if (busy()) return;
    const tgt = walkTarget();
    if (!tgt) return;
    const p = T.playerPos();
    const d = dist2(p.x, p.z, tgt.x, tgt.z);
    // Stopped once close enough, and off again only once there's a margin to cover (no
    // stop-start every frame as the guide inches ahead); behind the guide, eased down near them
    const gap = tgt.behind ? dist2(p.x, p.z, tgt.behind.x, tgt.behind.z) : Infinity;
    if (walkResting) {
      if (tgt.behind ? gap < FOLLOW_RESUME : d <= tgt.stop + WALK_RESUME) return;
      walkResting = false;
    }
    if (gap < FOLLOW_STOP || d <= tgt.stop) { walkResting = true; walkSpeed = 0; return; }
    const ease = Math.min(1, (gap - FOLLOW_STOP) / (FOLLOW_RESUME - FOLLOW_STOP + 1.5), (d - tgt.stop) / 1.2 + 0.3);
    const want = AUTO_WALK_SPEED * Math.max(0.35, ease);
    walkSpeed += (want - walkSpeed) * Math.min(1, dt * 4);
    ctx.autoWalk((tgt.x - p.x) / d, (tgt.z - p.z) / d, Math.min(walkSpeed * dt, d - tgt.stop + 0.02), dt);
  };
  // 🚶 Walk me there (walking themselves stopped it)
  const introActs = () => {
    if (!T.intro || T.intro.autoWalk || busy()) return [];
    const tgt = walkTarget();
    if (!tgt) return [];
    const p = T.playerPos();
    if (dist2(p.x, p.z, tgt.x, tgt.z) <= tgt.stop + 1) return [];
    const g = T.npcById(T.intro.guideId);
    return [{ key: 'introwalk', label: g?.guiding ? `Follow ${firstName(g.name)}` : 'Walk me there', onClick: () => { if (T.intro) { T.intro.autoWalk = true; T.actsAt = 0; } } }];
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
    introActs, startIntro: start, updateGuide, updateIntro, updateIntroWalk,
  });
}
