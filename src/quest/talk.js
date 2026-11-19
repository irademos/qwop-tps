// A quest talk — several lines, one at a time, the last one ending in choices — over Town's
// subtitle talk box (createJobTalk in townJobs.js). Shared by Story (storyMode.js) and Town's
// jobs (townQuests.js), so a talk is written the same way in both:
//   { lines: [[who, text], …], choices?: [{ label, then?, act? }], then?, reward? }
// who: a speaker key the game turns into a name (`name(who)`); 'you' is the player (a line of
// theirs is read out in their voice). `then` runs when it ends (before a choice's own `then`).
// Lines go on with 'Go on'; no choices → 'Okay'. reward: a line under the last one ('Reward: 🪙 30').
//
// createTalkRunner({ box, name?, fill?, onLine?, run })
//   box     — a createJobTalk box
//   name    — who → the name shown (default: who as is)
//   fill    — text → text with {placeholders} filled (default: as is)
//   onLine  — (who, text) as each line shows (a caw, the tree waking…)
//   run     — (actions) the game's action runner (runActions with its handlers)
// → { say(def), isOpen(), advance(), close(), speaker(), firstLabel() }

export function createTalkRunner({ box, name = (w) => w, fill = (t) => t, onLine = null, run }) {
  let talk = null; // { lines, i, choices, then }
  const end = (actions) => {
    talk = null;
    box.close();
    run(actions);
  };
  const show = () => {
    const [who, raw] = talk.lines[talk.i];
    const text = fill(raw);
    const last = talk.i >= talk.lines.length - 1;
    const then = talk.then;
    const choices = !last
      ? [{ label: 'Go on', primary: true, act: true, onClick: () => { talk.i += 1; show(); } }]
      : talk.choices
        ? talk.choices.map((c, i) => ({
          label: fill(c.label), primary: i === 0, act: c.act,
          onClick: () => end([...(then ?? []), ...(c.then ?? [])]),
        }))
        : [{ label: 'Okay', primary: true, act: true, onClick: () => end(then) }];
    talk.who = who;
    talk.first = choices[0].label;
    onLine?.(who, text);
    box.open({ who: name(who), text, choices, reward: last && talk.reward ? fill(talk.reward) : null });
  };
  const say = (def) => {
    if (!def?.lines?.length) { run(def?.then); return; }
    talk = { lines: def.lines, i: 0, choices: def.choices ?? null, then: def.then ?? null, reward: def.reward ?? null };
    show();
  };
  return {
    say,
    isOpen: () => !!talk && box.isOpen(),
    advance: () => box.pressFirst(),
    // (closed from outside — walked off: the talk's over, nothing run)
    close: () => { talk = null; box.close(); },
    speaker: () => talk?.who ?? null,
    // (the first button's label — the phone's interact bar reads it)
    firstLabel: () => talk?.first ?? null,
  };
}
