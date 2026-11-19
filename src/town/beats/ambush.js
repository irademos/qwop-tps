// Town's quest beats — Bandits come at the player, the job's allies fighting beside them (ambush).
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

export const ambushBeats = (W) => {
  const { T, ctx, roleNpc, control, stand, fill, placeOf, foes, liveFoes, clearFoes, unseat, hitAlly, glbCharacterConfig, BANDIT_NAMES, pickOf, dist2, ALLY_HP, FOE_HEARTS, FOE_SPAWN_DIST, FOE_GEAR, FOE_COINS } = W;
  return {
    // Bandits come at the player; the job's allies fight beside them
    ambush: {
      start: (c) => {
        const { beat: b, q } = c;
        clearFoes();
        const p = T.playerPos();
        const from = placeOf(b.from) ?? p;
        const base = Math.atan2(from.x - p.x, from.z - p.z);
        const allies = (b.allies ?? []).map((r) => roleNpc(q, r)).filter(Boolean);
        q.allyHp = Object.fromEntries(allies.map((n) => [n.id, ALLY_HP]));
        for (const n of allies) {
          if (n.qmode?.kind === 'seated') unseat(n);
          if (n.qmode?.kind !== 'knocked') control(n, 'fight');
          else n.qmode.after = 'fight';
        }
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
          e._questFoe = true;
          // (the ones going for an ally: at them while they're up)
          if (ally) {
            e.questTarget = () => {
              if (!ally.alive || !ally.body || (q.allyHp[ally.id] ?? 0) <= 0 || ally.qmode?.kind === 'knocked') return null;
              return {
                model: ally.body.container,
                onHit: (_m, dir) => { hitAlly(c, ally, dir); return 'hit'; },
              };
            };
          }
          foes.list.push({ e, paid: false });
        }
        c.s.total = foes.list.length;
        ctx.playSfx?.('unsheath');
      },
      update: (c) => {
        if (ctx.isPlayerDead()) { c.fail(fill('You went down — {wizard} limps back up the mountain. {wizard.He}\'ll ask again.', c.q)); return false; }
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
      end: (c) => {
        // (the allies: back to standing by)
        for (const id of Object.keys(c.q.allyHp ?? {})) {
          const n = T.npcById(+id);
          if (n?.questing && n.qmode?.kind === 'fight') control(n, 'stand');
        }
      },
      entry: (c) => `${fill(c.beat.text, c.q)} (${c.s.total - liveFoes().length} / ${c.s.total})`,
      icon: '⚔️',
    },
  };
};
