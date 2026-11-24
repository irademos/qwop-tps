// Town: missions (townJobs.js) — the jobs townsfolk hand out (none round town for now: the
// townsfolk's work comes in order, one job after another — townQuests.js; the sheriff's thanks
// after a night's fighting — townBandits.js — is the one kind left), progress, markers
// (❗ / 📍 / ❓) and the job talk.

import * as THREE from 'three';
import { MAX_ACTIVE_JOBS } from './townJobs.js';
import { firstName } from './townPeople.js';
import { makeTextSprite } from '../village/villageMode.js';
import { JOB_REFRESH_S, heightScale } from './townConfig.js';

// ── A goal's 📍: the pin, a soft halo round it and a beam of light up from the ground — unlit and
// out of the fog, brighter at night (T.nightLevel), so it's easy to find in the dark ──
const PIN_BEAM_H = 7;          // m the beam reaches over the pin
const PIN_BEAM_R = 0.16;       // m — the beam's radius
const PIN_GLOW = { day: 0.3, night: 0.95 };   // the halo / beam's brightness, by T.nightLevel
let pinShared = null;
const pinParts = () => {
  if (pinShared) return pinShared;
  // (the halo: a round soft spot; the beam: bright at its foot, fading out up its length)
  const halo = document.createElement('canvas');
  halo.width = halo.height = 128;
  const hg = halo.getContext('2d');
  const rg = hg.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,230,160,1)');
  rg.addColorStop(0.35, 'rgba(255,190,80,0.55)');
  rg.addColorStop(1, 'rgba(255,160,40,0)');
  hg.fillStyle = rg;
  hg.fillRect(0, 0, 128, 128);
  const beam = document.createElement('canvas');
  beam.width = 4;
  beam.height = 128;
  const bg = beam.getContext('2d');
  const lg = bg.createLinearGradient(0, 128, 0, 0);
  lg.addColorStop(0, 'rgb(255,215,120)');
  lg.addColorStop(0.45, 'rgb(150,100,30)');
  lg.addColorStop(1, 'rgb(0,0,0)');
  bg.fillStyle = lg;
  bg.fillRect(0, 0, 4, 128);
  const geo = new THREE.CylinderGeometry(PIN_BEAM_R, PIN_BEAM_R, 1, 12, 1, true);
  geo.translate(0, 0.5, 0);
  pinShared = { halo: new THREE.CanvasTexture(halo), beam: new THREE.CanvasTexture(beam), geo };
  pinShared.halo.colorSpace = THREE.SRGBColorSpace;
  pinShared.beam.colorSpace = THREE.SRGBColorSpace;
  return pinShared;
};
const makeGoalPin = () => {
  const parts = pinParts();
  const group = new THREE.Group();
  const pin = makeTextSprite('📍', { height: 0.6, size: 96, bg: null, pad: 10 });
  pin.material.fog = false;
  pin.material.toneMapped = false;
  pin.renderOrder = 8;
  const glow = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false };
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: parts.halo, ...glow }));
  halo.scale.set(1.7, 1.7, 1);
  halo.renderOrder = 7;
  halo.userData.sharedMap = true;
  const beam = new THREE.Mesh(parts.geo, new THREE.MeshBasicMaterial({ map: parts.beam, side: THREE.DoubleSide, ...glow }));
  beam.renderOrder = 6;
  beam.userData.sharedMap = true;
  beam.userData.sharedGeo = true;
  group.add(beam, halo, pin);
  // (its pin `h` over the ground at `night` 0…1, pulsing a little)
  group.userData.place = (h, night, t) => {
    pin.position.y = h;
    halo.position.y = h;
    beam.scale.y = h + PIN_BEAM_H;
    const k = (PIN_GLOW.day + (PIN_GLOW.night - PIN_GLOW.day) * night) * (0.85 + 0.15 * Math.sin(t * 3));
    halo.material.opacity = k;
    beam.material.opacity = k * 0.8;
    const s = 1.5 + 0.5 * night;
    halo.scale.set(s, s, 1);
  };
  return group;
};
const disposeMarker = (m) => m.traverse((o) => {
  if (!o.material) return;
  if (!o.userData.sharedMap) o.material.map?.dispose();
  o.material.dispose();
});

// T: the town's shared state + functions (createTownMode in townMode.js); ctx: the game
export function installTownMissions(T, ctx) {
  // ── Missions (townJobs.js): jobs townsfolk hand out, the tracker ──
  const npcById = (id) => T.npcs.find((n) => n.id === id && n.alive) ?? null;
  const activeJobs = () => T.jobs.filter((j) => j.status === 'active');
  // (taken: being done, or done and waiting on the reward)
  const takenJobs = () => T.jobs.filter((j) => j.status === 'active' || j.status === 'done');
  const rewardText = (r) => [r.coins ? `${r.coins}` : null, r.attitude ? 'goodwill' : null, r.item ? `a ${r.item}` : null].filter(Boolean).join(' · ') || 'Their thanks';
  const makeJob = (spec) => ({ id: T.nextJobId++, status: 'open', reward: { coins: 0 }, data: {}, ...spec });
  // New jobs handed out round town: none for now — the townsfolk's work comes in order, one job
  // after another (townQuests.js); the sheriff's thanks after a night's fighting is townBandits.js'.
  // (the hook stays for jobs to come — T.jobs.push(T.makeJob({ kind, giverId, title, desc,
  // reward, data: { target } })), T.markDone(j) once its work's done; one per townsperson)
  const offerJobs = () => {};
  const startJob = (j) => { j.status = 'active'; };
  const acceptJob = (j) => {
    if (!j || j.status !== 'open') return;
    const giver = npcById(j.giverId);
    if (takenJobs().length >= MAX_ACTIVE_JOBS) {
      if (giver) T.say(giver, 'You\'ve got enough on your plate. Come back when you\'re done.', { big: true });
      return;
    }
    startJob(j);
    if (giver) T.say(giver, 'Thank you! Come back when it\'s done.', { big: true });
    T.feedLine(`Job taken: ${j.title}`);
    T.questNote('job');
  };
  const dropJob = (j) => {
    T.jobs = T.jobs.filter((x) => x !== j);
  };
  const abandonJob = (j) => {
    dropJob(j);
    const giver = npcById(j.giverId);
    if (giver) {
      giver.attitude = Math.max(-1, giver.attitude - 0.05);
      T.say(giver, 'Oh. Never mind, then.', { big: true });
    }
    T.feedLine(`Dropped: ${j.title}`);
  };
  // A job's work is done: back to whoever gave it for the reward (paid at once if they're gone)
  const markDone = (j, text = null) => {
    const giver = npcById(j.giverId);
    if (!giver) { completeJob(j, { text }); return; }
    j.status = 'done';
    T.feedLine(`${text ?? j.title} — see ${firstName(giver.name)} for your reward.`);
    T.save();
  };
  // What a job was, as the giver remembers it
  const helpedText = (j) => {
    switch (j.kind) {
      case 'nightThanks': return 'fighting off the bandits in the night';
      default: return 'that job';
    }
  };
  const completeJob = (j, { coins = j.reward.coins, text = null } = {}) => {
    T.jobs = T.jobs.filter((x) => x !== j);
    const giver = npcById(j.giverId);
    if (coins > 0) ctx.addCoins(coins);
    if (giver && j.reward.attitude) giver.attitude = Math.min(1, giver.attitude + j.reward.attitude);
    // (they'll remember it — townMemory.js)
    if (giver && coins > 0) T.remember(giver, 'helped', { what: helpedText(j) });
    if (j.reward.item) ctx.grantItem(j.reward.item);
    if (j.reward.town) for (const n of T.npcs) if (n.alive && !n.def.outlaw) n.attitude = Math.min(1, n.attitude + j.reward.town);
    if (giver?.body && !T.jobTalk.isOpen()) T.say(giver, 'Thank you!', { big: true });
    T.feedLine(text ?? `${j.title}${coins > 0 ? ` · +${coins} coins` : ''}`);
    T.save();
    return null;
  };
  // Someone died: jobs from them end (a reward waiting is paid out of their estate)
  const onJobDeath = (n, byPlayer) => {
    // (a bandit the player beat at night: the sheriff's thanks in the morning — townBandits.js)
    if (n.def.outlaw && byPlayer && T.isNight) T.noteNightKill(n);
    for (const j of [...T.jobs]) {
      if (n.id !== j.giverId) continue;
      if (j.status === 'done') completeJob(j);
      else {
        dropJob(j);
        if (j.status === 'active') T.feedLine(`${j.title}: ${firstName(n.name)} is dead.`);
      }
    }
  };
  // The acts a job puts on a townsperson the player is next to (none of the jobs now need any)
  const jobActsFor = () => [];
  // Per-tick job upkeep: postings, the tracker
  const updateJobs = () => {
    if (T.simT > T.jobsAt) { T.jobsAt = T.simT + JOB_REFRESH_S; offerJobs(); }
    // (the first day's goal / the job going on, on top — townQuests.js)
    const quest = T.defenseEntry() ?? T.questEntry();
    T.tracker.render([...(quest ? [quest] : []), ...takenJobs().map((j) => ({ title: j.title, progress: jobProgress(j), icon: j.status === 'done' ? '❓' : '📍' }))]);
  };
  const jobProgress = (j) => {
    const who = (id) => (npcById(id) ? firstName(npcById(id).name) : '?');
    if (j.status === 'done') return `Back to ${who(j.giverId)} for your reward`;
    return j.progress ?? '';
  };
  // Where a job's 📍 points (a job's own `target` — { x, z, h })
  const jobTarget = (j) => j.data?.target ?? null;
  // Markers: 📍 where a job's work is, ❗ over whoever has a job to give, ❓ over whoever has a
  // reward waiting (the Showdown village's quest marker)
  const GIVER_MARKER = { height: 0.42, bg: 'rgba(244, 196, 84, 0.92)', border: 'rgba(255,255,255,0.9)', pad: 14 };
  const markerFor = (j) => {
    if (j.status === 'active') {
      const t = jobTarget(j);
      return t ? { icon: '📍', ...t } : null;
    }
    const giver = npcById(j.giverId);
    if (!giver || giver.inside || giver.fighter || giver.jailedUntil > T.simT) return null;
    return { icon: j.status === 'done' ? '❓' : '❗', x: giver.x, z: giver.z, h: 1.7 * heightScale(giver.url) + 0.5 };
  };
  // (the town book's map: the same marks — { icon, x, z })
  const jobMarks = () => [...T.jobs.map(markerFor), ...T.questMarkers(), ...T.defenseMarkers()].filter(Boolean);
  const updateMarkers = () => {
    const live = new Set();
    const marks = T.jobs.map((j) => [j.id, markerFor(j)]);
    T.questMarkers().forEach((m, i) => marks.push([`quest${i}`, m]));
    T.defenseMarkers().forEach((m, i) => marks.push([`defense${i}`, m]));
    for (const [id, t] of marks) {
      if (!t) continue;
      const key = `${id}:${t.icon}`;
      live.add(key);
      let m = T.markers.get(key);
      if (!m) {
        m = t.icon === '📍' ? makeGoalPin() : makeTextSprite(t.icon, GIVER_MARKER);
        m.renderOrder = 8;
        T.root.add(m);
        T.markers.set(key, m);
      }
      // (someone in a room the player isn't in: over its house's door outside)
      const room = T.rooms.roomAt(t.x, t.z);
      const at = room && room !== T.inRoom ? { ...T.layout.places.rooms[room].door, h: 2.95 } : t;
      const bob = Math.sin(T.simT * 3) * 0.08;
      if (m.userData.place) {
        // (a goal's 📍: on the ground, its pin up at h with the halo and the beam — makeGoalPin)
        m.position.set(at.x, T.groundAt(at.x, at.z), at.z);
        m.userData.place(at.h + bob, Math.max(0, Math.min(1, T.nightLevel ?? 0)), T.simT);
      } else m.position.set(at.x, T.groundAt(at.x, at.z) + at.h + bob, at.z);
    }
    for (const [key, m] of T.markers) {
      if (live.has(key)) continue;
      m.parent?.remove(m);
      disposeMarker(m);
      T.markers.delete(key);
    }
  };
  // A townsperson's job (the one they'd talk about): a reward waiting, one to give, one on
  const jobOf = (n) => {
    const mine = T.jobs.filter((j) => j.giverId === n.id);
    return mine.find((j) => j.status === 'done') ?? mine.find((j) => j.status === 'open') ?? mine.find((j) => j.status === 'active') ?? null;
  };
  // Talking to someone with a job: take it / how it's going / the reward
  const openJobTalk = (n, j) => {
    const who = firstName(n.name);
    if (j.status === 'done') {
      const reward = rewardText(j.reward);
      const beaten = j.data.beaten ?? 0;
      const lines = {
        nightThanks: `${beaten === 1 ? 'That bandit' : `The ${beaten} bandits`} you took down in the night — word gets round, ${ctx.getPlayerName()}. Brindlewick owes you. Here.`,
      };
      T.jobTalk.open({
        who, sub: j.title, text: lines[j.kind] ?? 'You did it! Here, this is yours.', reward: `Reward: ${reward}`,
        choices: [{ label: 'Take the reward', primary: true, act: true, onClick: () => {
          completeJob(j);
        } }],
      });
      return;
    }
    if (j.status === 'open') {
      const full = takenJobs().length >= MAX_ACTIVE_JOBS;
      T.jobTalk.open({
        who, sub: j.title, text: j.desc, reward: `Reward: ${rewardText(j.reward)}`,
        choices: full
          ? [{ label: `You have ${MAX_ACTIVE_JOBS} jobs on — later`, primary: false, act: true }]
          : [{ label: 'I\'ll do it', primary: true, onClick: () => acceptJob(j) }, { label: 'Not right now', primary: false }],
      });
      return;
    }
    // On it: how it's going
    const choices = [{ label: 'I\'m on it', primary: true }];
    choices.push({ label: 'Drop the job', primary: false, act: true, onClick: () => abandonJob(j) });
    T.jobTalk.open({ who, sub: j.title, text: `How's it going? (${jobProgress(j)})`, choices });
  };
  // Saved jobs back (only the kinds there still are: the jobs handed out round town before —
  // deliveries, debts, bounties, the authored chains… — are gone)
  const KINDS = new Set(['nightThanks']);
  const restoreJobs = (state) => {
    T.jobs = Array.isArray(state?.jobs) ? state.jobs.filter((j) => j && KINDS.has(j.kind) && j.data) : [];
    T.jobs = T.jobs.filter((j) => j.status !== 'open' || npcById(j.giverId));
    T.nextJobId = Math.max(state?.nextJobId ?? 1, ...T.jobs.map((j) => j.id + 1), 1);
    T.jobsAt = 0;
  };

  Object.assign(T, {
    activeJobs, dropJob, makeJob, markDone, jobActsFor, jobOf, npcById, onJobDeath, openJobTalk, restoreJobs,
    jobMarks, updateJobs, updateMarkers,
  });
}
