// Town's quest beats, by kind — one registry for the quest runner (townQuests.js). A new kind of
// beat: a function here or a file of its own, given Town's quest world W.
import { peopleBeats } from './people.js';
import { goalBeats } from './goal.js';
import { cartBeats } from './cart.js';
import { sceneBeats } from './scene.js';
import { ambushBeats } from './ambush.js';
import { waveBeats } from './wave.js';
import { rewardsBeats } from './rewards.js';
import { craftBeats } from './craft.js';
import { seaBeats } from './sea.js';
import { diveBeats } from './dive.js';

export const townBeats = (W) => ({
  ...peopleBeats(W), ...goalBeats(W), ...cartBeats(W), ...sceneBeats(W), ...ambushBeats(W), ...waveBeats(W), ...rewardsBeats(W), ...craftBeats(W), ...seaBeats(W), ...diveBeats(W),
});
