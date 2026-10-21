// Town: the first day — a few townsfolk show a newcomer how Brindlewick lives, one small goal at
// a time, each paying a few coins: say hello to the merchant, go fishing with a fisher and cook
// the catch at the campfire, help a farmer with the harvest (picking their veg is allowed then)
// and sell it, hear the sheriff out about the bandit camp, and take a first job. Shown first in
// the quest tracker; ❗ over whoever to talk to next, 📍 where the goal is.
//
// State (saved with the town; in a shared town with the player's own things):
//   T.intro = { step, phase: 'talk' | 'do', count, guideId } while it runs, null once it's done
// A save from before the intro starts it too — the welcome offers to skip it.

import { firstName } from './townPeople.js';
import { dist2, heightScale } from './townConfig.js';

// guide: the role who gives it (null: no one — goal only); talk: what they say (talkOnly: the
// talk is the goal); goal + n: what the player does (introNote kinds); at: where its 📍 is;
// noTalk: carries straight on from the step before (same guide); coins: what it pays;
// gives: an item the guide hands over on accepting (ctx.grantItem — unless the player has one)
const STEPS = [
  {
    id: 'welcome', guide: 'merchant', title: 'Say hello at the market', talkOnly: true, coins: 3, skippable: true,
    talk: 'Welcome to Brindlewick, {name}! New in town, and not a coin to your name, by the look of you. Here — a few to start. Folk around here will show you how we live: fishing, farming, the market. Shall I send you round?',
    accept: '👍 Show me around',
    done: 'Go see {next} — they\'ll show you the ropes.',
  },
  {
    id: 'fish', guide: 'fisher', title: 'Go fishing', goal: 'fish', n: 1, coins: 4, at: 'fishSpot', gives: 'rod',
    talk: 'Come fishing, {name}! Here — my old rod, it\'s yours. At the 🎣 fishing spot, swing it forward to cast. When the bobber goes under, pull the rod back sharp to hook it. Let it run, pull when it tires, then reel it in. Catch one and it\'s yours.',
    accept: '🎣 Let\'s fish',
    progress: 'Catch a fish 🐟 at the 🎣 fishing spot',
    done: 'Ha, a fine catch! Now cook it over the town fire — grilled fish fills you up far better.',
  },
  {
    id: 'cook', guide: 'fisher', noTalk: true, title: 'Cook your catch', goal: 'cook', n: 1, coins: 3, at: 'fire',
    progress: 'Grill a fish at the campfire 🍳',
    done: 'Smells good! Cooked food heals more, and the merchant pays more for it too.',
  },
  {
    id: 'harvest', guide: 'farmer', title: 'Help with the harvest', goal: 'pick', n: 3, coins: 3, at: 'guideWork',
    talk: 'Give me a hand with the harvest, {name}? Pick 3 veg from my field — 🌾 Pick — and keep them, they\'re yours. Just don\'t go picking anyone\'s field without asking: that\'s stealing.',
    accept: '🌾 Happy to help',
    progress: 'Pick 3 veg 🥕 from {guide}\'s field',
    done: 'Good hands! Take those to the market and sell them.',
  },
  {
    id: 'sell', guide: 'merchant', noTalk: true, title: 'Sell at the market', goal: 'sell', n: 1, coins: 3, at: 'market',
    progress: 'Sell something at the goods stall (💰 Sell)',
    done: 'Pleasure doing business! The less I have of something, the more I pay for it.',
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
    T.intro = null;
    ctx.showBanner('SETTLED IN!', 'You know your way around Brindlewick now', 2800);
    T.feedLine('🏡 That\'s your first day done. The town\'s yours to make a living in — or trouble.');
    T.save();
  };
  const skip = () => {
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
      T.say(n, fill(s.progress ?? s.title, s, n), { big: true });
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
    else choices.push({ label: 'Later', primary: false });
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
    if (s.at === 'market') return { icon: '📍', ...P.market, h: 2.6 };
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
          : `Talk to ${firstName(g.name)} the ${g.def.label.toLowerCase()}`;
    } else {
      progress = fill(s.progress ?? s.title, s, g);
      if ((s.n ?? 1) > 1) progress += ` (${T.intro.count} / ${s.n})`;
    }
    return { title: `First day: ${s.title}`, progress, icon: T.intro.phase === 'talk' ? '❗' : '📍' };
  };
  // Upkeep: a guide who's gone (dead, jailed) is replaced; a talk with nobody to give it, skipped
  const updateIntro = () => {
    if (!step()) return;
    guideOf();
    noGuide();
  };

  Object.assign(T, {
    introAllowsPick, introEntry, introNote, introSnapshot: snapshot, introTalk, introTarget, isIntroGuide: isGuide,
    startIntro: start, updateIntro,
  });
}
