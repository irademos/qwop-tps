let _firstPerson = true;

export function isFirstPersonView() { return _firstPerson; }
export function setFirstPersonView(v) { _firstPerson = Boolean(v); }
