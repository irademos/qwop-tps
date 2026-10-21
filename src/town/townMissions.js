// Town: missions (townJobs.js) — the jobs townsfolk hand out, authored chains, progress, markers
// (❗ / 📍 / ❓) and the job talk.

import { CHAINS, MAX_ACTIVE_JOBS, OPEN_JOBS } from './townJobs.js';
import { GOODS, GOOD_IDS } from './townEconomy.js';
import { characterForRole, firstName, randomName } from './townPeople.js';
import { makeTextSprite } from '../village/villageMode.js';
import {
  JOB_REFRESH_S, KID_FOUND_DIST, KID_HOME_DIST, KID_WITH_PLAYER_DIST, MINUTES_PER_SEC, RAID_HOUR,
  dist2, heightScale, pickOf,
} from './townConfig.js';

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownMissions(T, ctx) {
  // ── Missions (townJobs.js): jobs townsfolk hand out, authored chains, the tracker ──
  const npcById = (id) => T.npcs.find((n) => n.id === id && n.alive) ?? null;
  const activeJobs = () => T.jobs.filter((j) => j.status === 'active');
  // (taken: being done, or done and waiting on the reward)
  const takenJobs = () => T.jobs.filter((j) => j.status === 'active' || j.status === 'done');
  const rewardText = (r) => [r.coins ? `🪙 ${r.coins}` : null, r.attitude ? '🤝 goodwill' : null, r.item ? `🛡️ a ${r.item}` : null].filter(Boolean).join(' · ') || 'Their thanks';
  const townsfolkFor = (test) => T.npcs.filter((n) => n.alive && !n.def.law && !n.def.outlaw && !n.def.unhurt
    && n.role !== 'merchant' && !n.following && n.jailedUntil <= T.simT && test(n));
  // Seconds of town time until the clock next reads `h` o'clock
  const secondsUntilHour = (h) => {
    const nowMin = T.clock.minutes % 1440;
    let mins = h * 60 - nowMin;
    if (mins <= 0) mins += 1440;
    return mins / MINUTES_PER_SEC;
  };
  const makeJob = (spec) => ({ id: T.nextJobId++, status: 'open', reward: { coins: 0 }, data: {}, ...spec });
  // The jobs townsfolk hand out: a few at a time, made from what the town needs right now
  const chainCtx = () => ({
    byRole: (role) => T.npcs.find((n) => n.alive && n.role === role && n.jailedUntil <= T.simT) ?? null,
    parentOfKid: () => {
      for (const kid of T.npcs.filter((n) => n.alive && n.role === 'kid' && !n.lost)) {
        const parent = T.family(kid).find((o) => !o.def.unhurt && !o.def.law) ?? null;
        if (parent) return { parent, kid: { ...kid, first: firstName(kid.name) } };
      }
      return null;
    },
    firstField: (g) => Math.max(0, T.layout.places.fields.indexOf(npcById(g.id)?.work)),
  });
  const chainJob = (chain, step) => {
    const c = chainCtx();
    const giver = chain.who(c);
    if (!giver) return null;
    const g = { id: giver.id, first: firstName(giver.name) };
    const spec = chain.steps[step](g, c);
    const last = step === chain.steps.length - 1;
    return makeJob({
      giverId: giver.id, ...spec,
      title: `${chain.title}: ${spec.title}`,
      reward: last ? chain.reward : { coins: 10 },
      chain: { id: chain.id, step },
    });
  };
  // (one job per townsperson — offered, being done or waiting on its reward)
  const hasJob = (id) => T.jobs.some((j) => j.giverId === id);
  const offerJobs = () => {
    const offered = () => T.jobs.filter((j) => j.status === 'open' && !j.shady).length;
    // Chains first (one step at a time each)
    for (const chain of CHAINS) {
      if (offered() >= OPEN_JOBS) break;
      if (T.chainsDone.has(chain.id) || T.jobs.some((j) => j.chain?.id === chain.id)) continue;
      const j = chainJob(chain, 0);
      if (j && !hasJob(j.giverId)) T.jobs.push(j);
    }
    let tries = 0;
    while (offered() < OPEN_JOBS && tries++ < 8) {
      const j = Math.random() < 0.4 ? lawJob() : townJob();
      if (j && j.giverId != null && !hasJob(j.giverId)) T.jobs.push(j);
    }
    // The drifter's: no ❗ — he brings it up when the player talks to him
    const drifter = T.npcs.find((n) => n.alive && n.role === 'drifter' && n.jailedUntil <= T.simT && !hasJob(n.id));
    if (drifter) T.jobs.push(shadyJob(drifter));
  };
  const lawJob = () => {
    // A bounty on a bandit not already posted
    const posted = new Set(T.jobs.filter((j) => j.kind === 'bounty').map((j) => j.data.targetId));
    const bandit = T.npcs.find((n) => n.alive && n.def.outlaw && !posted.has(n.id));
    const h = T.hour();
    const fields = T.layout.places.fields;
    if (Math.random() < 0.6 && bandit) {
      return makeJob({
        kind: 'bounty', giverId: chainCtx().byRole('sheriff')?.id ?? null,
        title: `Bounty: ${bandit.name}`, desc: `${bandit.name} has been robbing travellers. Bring them down — their camp's a long way out of town. They'll warn you off; they won't warn you twice.`,
        reward: { coins: bandit.def.bounty ?? 25 }, data: { targetId: bandit.id },
      });
    }
    if (h >= 10 && h < 20 && fields.length && !T.jobs.some((j) => j.kind === 'guardField')) {
      const field = Math.floor(Math.random() * fields.length);
      const owner = T.npcs.find((n) => n.alive && n.role === 'farmer' && n.work === fields[field]);
      return makeJob({
        kind: 'guardField', giverId: owner?.id ?? chainCtx().byRole('sheriff')?.id ?? null,
        title: `Guard ${owner ? `${firstName(owner.name)}'s` : 'a'} field tonight`,
        desc: 'Bandits have been seen eyeing the crops. Be there tonight and beat them off.',
        reward: { coins: 45, attitude: 0.3 }, data: { field, raiders: [] },
      });
    }
    return null;
  };
  const townJob = () => {
    if (Math.random() < 0.7) {
      // A delivery: what the market is short of, for someone who needs it
      const g = T.market.scarcest() ?? pickOf(GOOD_IDS);
      const giver = pickOf(townsfolkFor((n) => !T.jobs.some((j) => j.giverId === n.id)));
      if (!giver) return null;
      const n = g === 'wood' ? 3 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 3);
      const why = g === 'wood' ? 'I need firewood for the cold nights' : g === 'fish' ? 'I\'m sick of veg — I\'d kill for some fish' : 'I need veg for a stew';
      return makeJob({
        kind: 'deliver', giverId: giver.id,
        title: `Bring ${n} ${GOODS[g].emoji} to ${firstName(giver.name)}`,
        desc: `${why}${T.market.stock[g] <= 0 ? ', and the market\'s sold out' : ''}. Could you bring me ${n} ${GOODS[g].emoji}?`,
        reward: { coins: Math.round(GOODS[g].base * n * 1.8) + 4, attitude: 0.2 }, data: { good: g, n, toId: giver.id },
      });
    }
    // A debt to collect (or forgive)
    const debtor = pickOf(townsfolkFor((n) => !T.jobs.some((j) => j.data?.debtorId === n.id)));
    const creditor = debtor && pickOf(townsfolkFor((n) => n !== debtor && n.homeIndex !== debtor.homeIndex));
    if (!debtor || !creditor) return null;
    const amount = 8 + Math.floor(Math.random() * 12);
    return makeJob({
      kind: 'debt', giverId: creditor.id,
      title: `${firstName(debtor.name)} owes ${firstName(creditor.name)}`,
      desc: `${firstName(debtor.name)} owes me ${amount} coins and won't pay. Get it back for me and you keep a cut — or let it go, if you're soft.`,
      reward: { coins: Math.round(amount * 0.4) }, data: { debtorId: debtor.id, creditorId: creditor.id, amount },
    });
  };
  // The drifter's shady work: veg, no questions asked (taking it, the sheriff hears about it)
  const shadyJob = (n) => makeJob({
    kind: 'deliver', giverId: n.id, shady: true,
    title: `Veg for ${firstName(n.name)}`, desc: 'Psst. Three veg — from wherever. No questions asked, and don\'t tell the sheriff.',
    reward: { coins: 30 }, data: { good: 'crops', n: 3, toId: n.id },
  });
  const startJob = (j) => {
    j.status = 'active';
    if (j.kind === 'guardField') {
      j.data.raidAt = T.simT + secondsUntilHour(RAID_HOUR);
      j.data.raiders = [];
      j.data.raidStarted = false;
    }
    if (j.kind === 'findKid') loseKid(j);
  };
  const acceptJob = (j) => {
    if (!j || j.status !== 'open') return;
    const giver = npcById(j.giverId);
    if (takenJobs().length >= MAX_ACTIVE_JOBS) {
      if (giver) T.say(giver, 'You\'ve got enough on your plate. Come back when you\'re done.', { big: true });
      return;
    }
    startJob(j);
    if (j.shady) {
      const sheriff = chainCtx().byRole('sheriff');
      if (sheriff) sheriff.attitude = Math.max(-1, sheriff.attitude - 0.15);
    }
    if (giver) T.say(giver, j.shady ? 'Good. Quietly, now.' : 'Thank you! Come back when it\'s done.', { big: true });
    T.feedLine(`📋 Job taken: ${j.title}`);
  };
  const dropJob = (j) => {
    T.jobs = T.jobs.filter((x) => x !== j);
    if (j.kind === 'findKid') {
      const kid = npcById(j.data.kidId);
      if (kid && T.mine(kid)) { kid.lost = false; kid.escort = false; kid.following = false; kid.task = null; }
    }
    if (j.kind === 'fetchStrongbox' || j.kind === 'returnTo') {
      T.strongboxHeld = false;
      T.layout.props.strongbox.visible = true;
    }
  };
  const abandonJob = (j) => {
    dropJob(j);
    const giver = npcById(j.giverId);
    if (giver) {
      giver.attitude = Math.max(-1, giver.attitude - 0.05);
      T.say(giver, 'Oh. Never mind, then.', { big: true });
    }
    T.feedLine(`📋 Dropped: ${j.title}`);
  };
  // A job's work is done: back to whoever gave it for the reward (paid at once if they're gone)
  const markDone = (j, text = null) => {
    const giver = npcById(j.giverId);
    if (!giver) { completeJob(j, { text }); return; }
    j.status = 'done';
    T.feedLine(`✔ ${text ?? j.title} — see ${firstName(giver.name)} for your reward.`);
    T.save();
  };
  const completeJob = (j, { coins = j.reward.coins, text = null } = {}) => {
    T.jobs = T.jobs.filter((x) => x !== j);
    const giver = npcById(j.giverId);
    if (coins > 0) ctx.addCoins(coins);
    if (giver && j.reward.attitude) giver.attitude = Math.min(1, giver.attitude + j.reward.attitude);
    if (j.reward.item) ctx.grantItem(j.reward.item);
    if (j.reward.town) for (const n of T.npcs) if (n.alive && !n.def.outlaw) n.attitude = Math.min(1, n.attitude + j.reward.town);
    if (giver?.body && !T.jobTalk.isOpen()) T.say(giver, 'Thank you!', { big: true });
    T.feedLine(text ?? `✅ ${j.title}${coins > 0 ? ` · +${coins} 🪙` : ''}`);
    // A chain goes on to its next step (or ends)
    const chain = j.chain && CHAINS.find((c) => c.id === j.chain.id);
    if (chain) {
      const step = j.chain.step + 1;
      if (step < chain.steps.length) {
        const next = chainJob(chain, step);
        if (next) {
          T.jobs.push(next);
          startJob(next);
          T.feedLine(`📋 Next: ${next.title}`);
          T.save();
          return next;
        }
      } else {
        T.chainsDone.add(chain.id);
        ctx.showBanner('QUEST COMPLETE!', `${chain.title}${chain.reward.coins ? ` · 🪙 +${chain.reward.coins}` : ''}`, 3000);
      }
    }
    T.save();
    return null;
  };
  // Someone died: bounties pay, jobs for / about them end
  const onJobDeath = (n, byPlayer) => {
    const mine = byPlayer || T.distToPlayer(n) < 25;
    for (const j of [...T.jobs]) {
      if (j.kind === 'bounty' && j.data.targetId === n.id) {
        if (j.status === 'active' && mine) markDone(j, `💰 ${n.name} is down`);
        else if (j.status !== 'done') T.jobs = T.jobs.filter((x) => x !== j);
      } else if (j.kind === 'killBandits' && n.def.outlaw && j.status === 'active' && mine) {
        j.data.kills += 1;
        if (j.data.kills >= j.data.n) markDone(j);
      } else if (j.kind === 'guardField' && (j.data.raiders ?? []).includes(n.id)) {
        // (checked in updateJobs: all raiders down)
      } else if (j.status === 'done' && n.id === j.giverId) {
        // (the work was done: paid out of their estate)
        completeJob(j);
      } else if ([j.giverId, j.data.toId, j.data.debtorId, j.data.creditorId, j.data.kidId].includes(n.id) && !n.def.outlaw) {
        dropJob(j);
        if (j.status === 'active') T.feedLine(`✖ ${j.title}: ${firstName(n.name)} is dead.`);
      }
    }
  };
  // A lost kid: off somewhere quiet, a little way out of town
  const loseKid = (j) => {
    const kid = npcById(j.data.kidId);
    if (!kid || !T.take(kid)) return;
    let spot = j.data.spot;
    if (!spot) {
      const nav = T.layout.nav;
      const cells = nav.cellsWhere((i) => {
        const d = dist2(nav.cellX(i), nav.cellZ(i), kid.home.x, kid.home.z);
        return d > 22 && d < 45 && nav.clearanceAt(i) >= 1.5;
      });
      const i = cells.length ? pickOf(cells) : nav.nearestWalkable(kid.home.x + 25, kid.home.z);
      spot = { x: nav.cellX(i), z: nav.cellZ(i) };
      j.data.spot = spot;
    }
    T.endBrawl(kid);
    kid.lost = true;
    kid.inside = false;
    kid.x = spot.x;
    kid.z = spot.z;
    kid.path = null;
    T.setTask(kid, { type: 'lost', dur: Infinity });
  };
  // The acts a job puts on a townsperson the player is next to
  const jobActsFor = (n) => {
    const out = [];
    for (const j of activeJobs()) {
      const d = j.data;
      if (j.kind === 'deliver' && d.toId === n.id && T.goods[d.good] >= d.n) {
        out.push({ key: `give:${j.id}`, label: `📦 Give ${d.n} ${GOODS[d.good].emoji}`, onClick: () => {
          if (T.goods[d.good] < d.n) return;
          T.goods[d.good] -= d.n;
          T.renderGoods();
          completeJob(j);
        } });
      } else if (j.kind === 'debt' && d.debtorId === n.id) {
        out.push({ key: `collect:${j.id}`, label: `💰 Collect ${d.amount}`, onClick: () => collectDebt(j, n) });
        out.push({ key: `forgive:${j.id}`, label: '🤲 Let it go', onClick: () => forgiveDebt(j, n) });
      } else if (j.kind === 'returnTo' && d.toId === n.id && T.strongboxHeld) {
        out.push({ key: `return:${j.id}`, label: '📦 Hand over the strongbox', onClick: () => {
          T.strongboxHeld = false;
          completeJob(j);
        } });
      }
    }
    return out;
  };
  const collectDebt = (j, debtor) => {
    const creditor = npcById(j.data.creditorId);
    const paid = Math.min(j.data.amount, Math.floor(debtor.money));
    if (paid <= 0) { T.say(debtor, 'I\'ve got nothing! Honest!', { big: true }); return; }
    T.npcMoney(debtor, -paid);
    j.data.collected = paid;
    j.reward = { ...j.reward, coins: Math.round(paid * 0.4) };
    debtor.attitude = Math.max(-1, debtor.attitude - 0.3);
    T.say(debtor, paid < j.data.amount ? 'That\'s all I have…' : 'Fine. Take it.', { big: true });
    markDone(j, `💰 Collected ${paid} for ${creditor ? firstName(creditor.name) : 'nobody'}`);
  };
  const forgiveDebt = (j, debtor) => {
    const creditor = npcById(j.data.creditorId);
    debtor.attitude = Math.min(1, debtor.attitude + 0.4);
    if (creditor) creditor.attitude = Math.max(-1, creditor.attitude - 0.2);
    T.say(debtor, 'Bless you! I won\'t forget it.', { big: true });
    completeJob(j, { coins: 0, text: `🤲 You let ${firstName(debtor.name)}'s debt go.` });
  };
  // Per-tick job upkeep: postings, raids, the lost kid, the tracker
  const updateJobs = () => {
    if (T.simT > T.jobsAt) { T.jobsAt = T.simT + JOB_REFRESH_S; offerJobs(); }
    const P = T.layout.places;
    for (const j of [...activeJobs()]) {
      const d = j.data;
      if (j.kind === 'guardField') {
        if (!d.raidStarted && T.simT >= d.raidAt) {
          d.raidStarted = true;
          d.failed = false;
          const field = P.fields[d.field] ?? P.fields[0];
          const free = T.npcs.filter((n) => n.alive && n.def.outlaw && !n.fighter && n.jailedUntil <= T.simT
            && (T.mine(n) || (T.netMode === 'client' && !n.ctrl)));
          // (only the host makes new townsfolk)
          while (T.isHost() && free.length < 2) {
            const n = T.makeNpc({ id: T.nextId++, name: randomName('bandit', T.usedNames()), role: 'bandit', url: characterForRole('bandit') });
            T.npcs.push(n);
            free.push(n);
          }
          d.raiders = free.filter((n) => T.take(n)).slice(0, 2).map((n) => { T.startRaid(n, field, j.id); return n.id; });
          T.feedLine('🌙 Raiders are heading for the field!');
        } else if (d.raidStarted && d.raiders.every((id) => !npcById(id) || npcById(id).jailedUntil > T.simT)) {
          markDone(j, '🌾 The field is safe');
        } else if (d.raidStarted && d.failed) {
          // (they got away: they'll be back tomorrow night)
          d.raidStarted = false;
          d.failed = false;
          d.raiders = [];
          d.raidAt = T.simT + secondsUntilHour(RAID_HOUR);
          T.feedLine('🌙 They\'ll be back tomorrow night.');
        }
      } else if (j.kind === 'findKid') {
        const kid = npcById(d.kidId);
        if (!kid) continue;
        if (!d.found && T.distToPlayer(kid) < KID_FOUND_DIST && T.take(kid)) {
          d.found = true;
          kid.lost = false;
          kid.escort = true;
          kid.following = true;
          T.setTask(kid, { type: 'follow', dur: Infinity });
          T.say(kid, 'You found me! Take me home?', { big: true });
        } else if (d.found && dist2(kid.x, kid.z, kid.home.x, kid.home.z) < KID_HOME_DIST
          && T.distToPlayer(kid) < KID_WITH_PLAYER_DIST) {
          kid.inside = false;
          kid.escort = false;
          kid.following = false;
          kid.task = null;
          for (const f of T.family(kid)) f.attitude = Math.min(1, f.attitude + 0.5);
          T.say(kid, 'Home! Thank you!', { big: true });
          markDone(j, `🏠 ${firstName(kid.name)} is home`);
        } else if (d.found && !kid.following && kid.fear <= 0 && kid.jailedUntil <= T.simT && T.take(kid)) {
          // (walked home with the player, not on their own: whatever pulled them away — a scare,
          // the evening fire, bedtime — they come back to the player)
          if (kid.inside) { kid.inside = false; kid.x = kid.home.x; kid.z = kid.home.z; }
          kid.escort = true;
          kid.following = true;
          T.setTask(kid, { type: 'follow', dur: Infinity });
        }
      } else if (j.kind === 'fetchStrongbox' && T.strongboxHeld) {
        completeJob(j);
      }
    }
    T.tracker.render(takenJobs().map((j) => ({ title: j.title, progress: jobProgress(j), icon: j.status === 'done' ? '❓' : '📍' })));
  };
  const jobProgress = (j) => {
    const d = j.data;
    const who = (id) => (npcById(id) ? firstName(npcById(id).name) : '?');
    if (j.status === 'done') return `Back to ${who(j.giverId)} for your reward`;
    switch (j.kind) {
      case 'deliver': return `${Math.min(T.goods[d.good], d.n)} / ${d.n} ${GOODS[d.good].emoji} → ${who(d.toId)}`;
      case 'bounty': return 'Find them near the bandit camp';
      case 'killBandits': return `${d.kills} / ${d.n} bandits`;
      case 'guardField': return d.raidStarted ? 'Raiders at the field!' : `Be at the field by ${RAID_HOUR}:00`;
      case 'findKid': return d.found ? `Walk ${who(d.kidId)} home` : `Look for ${who(d.kidId)} out of town`;
      case 'debt': return `Talk to ${who(d.debtorId)}`;
      case 'fetchStrongbox': return 'At the bandit camp';
      case 'returnTo': return `Bring it to ${who(d.toId)}`;
      default: return '';
    }
  };
  // Where a job's 📍 points
  const jobTarget = (j) => {
    const d = j.data;
    const P = T.layout.places;
    const at = (n) => (n ? { x: n.x, z: n.z, h: 1.7 * heightScale(n.url) } : null);
    switch (j.kind) {
      case 'deliver': case 'returnTo': return at(npcById(d.toId));
      case 'bounty': return at(npcById(d.targetId));
      case 'killBandits': return { ...P.camp, h: 2.6 };
      case 'guardField': return { ...(P.fields[d.field] ?? P.fields[0]), h: 1.5 };
      case 'findKid': { const kid = npcById(d.kidId); return d.found && kid ? { ...kid.home, h: 2 } : at(kid); }
      case 'debt': return at(npcById(d.debtorId));
      case 'fetchStrongbox': return { ...P.strongbox, h: 1 };
      default: return null;
    }
  };
  // Markers: 📍 where a job's work is, ❗ over whoever has a job to give, ❓ over whoever has a
  // reward waiting (the Showdown village's quest marker)
  const GIVER_MARKER = { height: 0.42, bg: 'rgba(244, 196, 84, 0.92)', border: 'rgba(255,255,255,0.9)', pad: 14 };
  const markerFor = (j) => {
    if (j.status === 'active') {
      const t = jobTarget(j);
      return t ? { icon: '📍', ...t } : null;
    }
    if (j.shady) return null;
    const giver = npcById(j.giverId);
    if (!giver || giver.inside || giver.fighter || giver.jailedUntil > T.simT) return null;
    return { icon: j.status === 'done' ? '❓' : '❗', x: giver.x, z: giver.z, h: 1.7 * heightScale(giver.url) + 0.5 };
  };
  const updateMarkers = () => {
    const live = new Set();
    for (const j of T.jobs) {
      const t = markerFor(j);
      if (!t) continue;
      const key = `${j.id}:${t.icon}`;
      live.add(key);
      let m = T.markers.get(key);
      if (!m) {
        m = t.icon === '📍'
          ? makeTextSprite('📍', { height: 0.5, size: 96, bg: null, pad: 10 })
          : makeTextSprite(t.icon, GIVER_MARKER);
        m.renderOrder = 8;
        T.root.add(m);
        T.markers.set(key, m);
      }
      m.position.set(t.x, T.groundAt(t.x, t.z) + t.h + Math.sin(T.simT * 3) * 0.08, t.z);
    }
    for (const [key, m] of T.markers) {
      if (live.has(key)) continue;
      m.parent?.remove(m);
      m.material.map?.dispose();
      m.material.dispose();
      T.markers.delete(key);
    }
  };
  // (chain: the sheriff's strongbox — the gang wakes up when it's taken)
  const takeStrongbox = () => {
    T.strongboxHeld = true;
    if (T.standoffGang().length) T.campFightAll();
    T.layout.props.strongbox.visible = false;
    T.feedLine('📦 You have the strongbox!');
    const P = T.layout.places;
    for (const n of T.npcs) {
      if (n.alive && n.def.outlaw && !n.fighter && n.jailedUntil <= T.simT && dist2(n.x, n.z, P.camp.x, P.camp.z) < 20) {
        T.say(n, 'Oi! That\'s ours!');
        n.campFight = true;
        T.promote(n);
      }
    }
  };
  // A townsperson's job (the one they'd talk about): a reward waiting, one to give, one on
  const jobOf = (n) => {
    const mine = T.jobs.filter((j) => j.giverId === n.id);
    return mine.find((j) => j.status === 'done') ?? mine.find((j) => j.status === 'open') ?? mine.find((j) => j.status === 'active') ?? null;
  };
  // Talking to someone with a job: take it / how it's going / the reward
  const openJobTalk = (n, j) => {
    const who = `${n.def.emoji} ${firstName(n.name)}`;
    if (j.status === 'done') {
      const reward = rewardText(j.reward);
      const lines = {
        bounty: 'You got them! The town sleeps easier tonight.',
        killBandits: 'That\'ll teach them. Well done.',
        guardField: 'You saved the harvest! I can\'t thank you enough.',
        findKid: 'You brought my little one home! Thank you, thank you.',
        debt: `You got my money back${j.data.collected < j.data.amount ? ' — some of it, anyway' : ''}! Here's your cut.`,
      };
      T.jobTalk.open({
        who, sub: j.title, text: lines[j.kind] ?? 'You did it! Here, this is yours.', reward: `Reward: ${reward}`,
        choices: [{ label: '🪙 Take the reward', primary: true, onClick: () => {
          if (j.kind === 'debt') T.npcMoney(n, Math.max(0, (j.data.collected ?? 0) - j.reward.coins));
          const next = completeJob(j);
          if (next && next.giverId === n.id) {
            T.jobTalk.open({ who, sub: next.title, text: next.desc, choices: [{ label: '👍 On my way', primary: true }] });
          }
        } }],
      });
      return;
    }
    if (j.status === 'open') {
      const full = takenJobs().length >= MAX_ACTIVE_JOBS;
      T.jobTalk.open({
        who, sub: j.title, text: j.desc, reward: `Reward: ${rewardText(j.reward)}`,
        choices: full
          ? [{ label: `You have ${MAX_ACTIVE_JOBS} jobs on — later`, primary: false }]
          : [{ label: '✅ I\'ll do it', primary: true, onClick: () => acceptJob(j) }, { label: 'Not right now', primary: false }],
      });
      return;
    }
    // On it: how it's going (deliveries can be handed over right here)
    const d = j.data;
    const choices = [];
    if (j.kind === 'deliver' && d.toId === n.id && T.goods[d.good] >= d.n) {
      choices.push({ label: `📦 Give ${d.n} ${GOODS[d.good].emoji}`, primary: true, onClick: () => {
        if (T.goods[d.good] < d.n) return;
        T.goods[d.good] -= d.n;
        T.renderGoods();
        completeJob(j);
      } });
    } else if (j.kind === 'returnTo' && d.toId === n.id && T.strongboxHeld) {
      choices.push({ label: '📦 Hand over the strongbox', primary: true, onClick: () => { T.strongboxHeld = false; completeJob(j); } });
    }
    choices.push({ label: '👍 I\'m on it', primary: !choices.length });
    if (!j.chain || j.chain.step === 0) choices.push({ label: '✖ Drop the job', primary: false, onClick: () => abandonJob(j) });
    T.jobTalk.open({ who, sub: j.title, text: `How's it going? (${jobProgress(j)})`, choices });
  };
  // Saved jobs back (raids are re-planned for the next night)
  const restoreJobs = (state) => {
    T.jobs = Array.isArray(state?.jobs) ? state.jobs.filter((j) => j && j.kind && j.data) : [];
    for (const j of T.jobs) {
      // (older saves: jobs posted on boards)
      if (j.board === 'shady') j.shady = true;
      delete j.board;
    }
    T.jobs = T.jobs.filter((j) => j.status !== 'open' || npcById(j.giverId));
    T.nextJobId = Math.max(state?.nextJobId ?? 1, ...T.jobs.map((j) => j.id + 1), 1);
    T.chainsDone = new Set(state?.chainsDone ?? []);
    T.strongboxHeld = !!state?.strongboxHeld;
    T.layout.props.strongbox.visible = !T.strongboxHeld && !T.chainsDone.has('strongbox');
    T.jobsAt = 0;
    for (const j of T.jobs) {
      if (j.status !== 'active') continue;
      if (j.kind === 'guardField') { j.data.raidStarted = false; j.data.raiders = []; j.data.raidAt = T.simT + secondsUntilHour(RAID_HOUR); }
      if (j.kind === 'findKid') {
        const kid = npcById(j.data.kidId);
        if (kid && !j.data.found) loseKid(j);
        else if (kid && T.take(kid)) { kid.escort = true; kid.following = true; }
      }
    }
  };

  Object.assign(T, {
    activeJobs, jobActsFor, jobOf, npcById, onJobDeath, openJobTalk, restoreJobs, takeStrongbox,
    updateJobs, updateMarkers,
  });
}
