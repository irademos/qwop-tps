// Town's quest beats — Bandits come at the player, the job's allies fighting beside them (ambush):
// spawned round the player, on the side of `from`. (For a fight out on the walk, the player
// auto-walking along it, see the `wave` beat — beats/wave.js.)
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js). The allies
// are townAllies.js' (W.joinAllies / leaveAllies).

export const ambushBeats = (W) => {
  const { T, ctx, fill, placeOf, foes, liveFoes, clearFoes, joinAllies, leaveAllies, glbCharacterConfig, BANDIT_NAMES, pickOf, dist2, FOE_HEARTS, FOE_SPAWN_DIST, FOE_GEAR, FOE_COINS } = W;
  return {
    // Bandits come at the player; the job's allies fight beside them
    ambush: {
      start: (c) => {
        const { beat: b } = c;
        clearFoes();
        const p = T.playerPos();
        const from = placeOf(b.from) ?? p;
        const base = Math.atan2(from.x - p.x, from.z - p.z);
        const allies = joinAllies(c, b.allies ?? []);
        const url = glbCharacterConfig.frogManUrl;
        const used = new Set();
        for (let i = 0; i < b.count; i++) {
          const a = base + (i - (b.count - 1) / 2) * 0.32;
          const r = FOE_SPAWN_DIST[0] + Math.random() * (FOE_SPAWN_DIST[1] - FOE_SPAWN_DIST[0]);
          let x = p.x + Math.sin(a) * r;
          let z = p.z + Math.cos(a) * r;
          const cell = T.layout.nav.nearestWalkable(x, z);
          if (cell >= 0 && dist2(T.layout.nav.cellX(cell), T.layout.nav.cellZ(cell), x, z) < 4) { x = T.layout.nav.cellX(cell); z = T.layout.nav.cellZ(cell); }
          const ally = i < (b.onAlly ?? 0) ? allies[i % Math.max(1, allies.length)] ?? null : null;
          let name = pickOf(BANDIT_NAMES);
          for (let k = 0; k < 5 && used.has(name); k++) name = pickOf(BANDIT_NAMES);
          used.add(name);
          const e = ctx.spawnFighter({
            x, z, yaw: Math.atan2(p.x - x, p.z - z), url, hearts: FOE_HEARTS, swingChance: 0.32,
            gear: ally ? null : FOE_GEAR[i % FOE_GEAR.length], name,
          });
          if (!e) continue;
          e._fightFoe = true;
          // (the ones going for an ally: at them while they're up — townAllies.js; the rest may too)
          if (ally) T.allyAssign(e, ally);
          else if (!FOE_GEAR[i % FOE_GEAR.length]) e.questTarget = () => T.allyTargetFor(e);
          foes.list.push({ e, paid: false });
        }
        c.s.total = foes.list.length;
        ctx.playSfx?.('unsheath');
      },
      update: (c) => {
        if (ctx.isPlayerDead()) { c.fail(fill(c.quest.downText ?? 'You went down — {wizard} limps back up the mountain. {wizard.He}\'ll ask again.', c.q)); return false; }
        for (const f of foes.list) {
          if (f.e.isDead && !f.paid) {
            f.paid = true;
            const at = f.e.group.position.clone();
            at.y += 0.3;
            ctx.dropCoins(at, FOE_COINS);
          }
        }
        return foes.list.length > 0 && !liveFoes().length;
      },
      end: (c) => leaveAllies(c),
      entry: (c) => `${fill(c.beat.text, c.q)} (${c.s.total - liveFoes().length} / ${c.s.total})`,
      icon: '⚔️',
    },
  };
};
