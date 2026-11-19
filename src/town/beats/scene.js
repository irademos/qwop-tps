// Town's quest beats — People who aren't townsfolk (actors — the wizard's son): walk out (actor), throw a bomb at the cart (bomb), run off (actorLeave); a building torn down / rebuilt (ruin).
// Part of townQuests.js' registry (beats/index.js): each beat type's hooks get the runner's
// context `c` (src/quest/questRunner.js); `W` is Town's quest world (townQuests.js).

export const sceneBeats = (W) => {
  const { T, ctx, THREE, placeOf, cartAt, actors, spawnActor, actorSay, glbCharacterConfig, ACTOR_TIMEOUT_S, ACTOR_RUN, BOMB_THROW_AT_S, BOMB_AFTER_S } = W;
  return {
    // Someone who isn't a townsperson walks out to meet the cart
    actor: {
      start: (c) => {
        const { beat: b } = c;
        const from = placeOf(b.from);
        const to = placeOf(b.to);
        const dx = from.x - to.x;
        const dz = from.z - to.z;
        const d = Math.hypot(dx, dz) || 1;
        const a = spawnActor(b, { x: from.x + 1.5, z: from.z + 1.5 });
        a.to = { x: to.x + (dx / d) * b.gap, z: to.z + (dz / d) * b.gap };
        a.face = to;
        c.s.a = a;
      },
      update: (c) => {
        const a = c.s.a;
        if (!actors.has(a.id)) return true;
        if (a.arrived) { a.to = null; return true; }
        if (a.t > ACTOR_TIMEOUT_S) { a.x = a.to.x; a.z = a.to.z; a.arrived = true; }
        return false;
      },
      entry: (c) => c.beat.text ?? null,
    },
    // An actor throws a bomb at the cart: it's knocked over, everyone in it thrown out
    bomb: {
      start: (c) => { c.s.t = 0; },
      update: (c, dt) => {
        const { beat: b, s } = c;
        const a = actors.get(b.from);
        const cp = cartAt();
        s.t += dt;
        if (!s.thrown) {
          if (!a || !cp) return true;
          a.face = cp;
          if (!s.wound) { s.wound = true; a.inst?.character.playAction(glbCharacterConfig.throwClip); }
          if (s.t < BOMB_THROW_AT_S) return false;
          s.thrown = true;
          const yaw = Math.atan2(cp.x - a.x, cp.z - a.z);
          const from = new THREE.Vector3(a.x + Math.sin(yaw) * 0.4, T.groundAt(a.x, a.z) + 1.4, a.z + Math.cos(yaw) * 0.4);
          // (just short of it, on his side: it goes over away from him)
          const to = new THREE.Vector3(cp.x - Math.sin(yaw) * 0.9, T.groundAt(cp.x, cp.z), cp.z - Math.cos(yaw) * 0.9);
          ctx.throwBomb?.(from, to, (at) => {
            s.blastAt = T.simT;
            T.knockCart?.({ x: at.x, z: at.z });
            // (standing beside it: thrown too)
            if (!T.inCart() && T.distToPlayer({ x: at.x, z: at.z }) < 3.5) {
              const p = T.playerPos();
              const d = Math.hypot(p.x - at.x, p.z - at.z) || 1;
              ctx.throwPlayer?.({ x: (p.x - at.x) / d, z: (p.z - at.z) / d });
            }
          });
          if (!ctx.throwBomb) { s.blastAt = T.simT; T.knockCart?.({ x: to.x, z: to.z }); }
          return false;
        }
        if (s.blastAt == null) return s.t > 6; // (lost somewhere: on anyway)
        return T.simT - s.blastAt > BOMB_AFTER_S;
      },
    },
    // A building torn down (on — the bandits' revenge on the wizard's cabin) or built back up
    // (`when: 'morning'` — the next morning); it happens out of the player's sight (townRuins.js)
    ruin: {
      start: (c) => {
        const { beat: b } = c;
        if (b.on) T.ruinBuilding?.(b.key);
        else T.rebuildBuilding?.(b.key, { when: b.when });
        return true;
      },
    },
    actorLeave: {
      start: (c) => {
        const a = actors.get(c.beat.id);
        if (!a) return true;
        if (c.beat.shout) actorSay(a, c.beat.shout);
        a.to = placeOf(c.beat.to);
        a.face = null;
        a.speed = ACTOR_RUN;
        a.arrived = false;
        a.leaving = true;
        return true;
      },
    },
  };
};
