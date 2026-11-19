// Quest actions — what a talk or a choice does when it ends, shared by Story (storyMode.js) and
// Town's jobs (townQuests.js). An action is a string 'kind:arg:arg2' (or a function, called as
// is); each game gives its own handlers: { kind: (arg, arg2) => … }.
//   runActions(['step:fish', 'note:findRod', 'giveSword'], handlers)

export function runActions(actions, handlers, { warn = '[quest]' } = {}) {
  for (const a of actions ?? []) {
    if (typeof a === 'function') { a(); continue; }
    if (!a) continue;
    const [kind, arg, arg2] = String(a).split(':');
    const h = handlers[kind];
    if (h) h(arg, arg2);
    else console.warn(warn, 'unknown action', a);
  }
}
