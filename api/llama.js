const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.1-8b-instant';
const REQUEST_TIMEOUT_MS = 5_000;

function isAllowedMethod(method) {
  return method === 'POST' || method === 'OPTIONS';
}

function readJsonBody(body) {
  if (!body) return {};
  if (typeof body === 'object' && !Buffer.isBuffer(body)) return body;
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function clampNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function formatNearby(nearby = []) {
  if (!Array.isArray(nearby) || nearby.length === 0) return '- Nothing notable nearby';
  return nearby.slice(0, 10).map((entry) => {
    const type = typeof entry?.type === 'string' ? entry.type : 'Thing';
    const distance = clampNumber(entry?.distance, 0);
    const direction = typeof entry?.direction === 'string' ? entry.direction : 'nearby';
    const level = Number.isFinite(entry?.level) ? `level ${entry.level}` : 'level unknown';
    const hp = Number.isFinite(entry?.hp) ? `HP ${entry.hp}` : 'HP unknown';
    const id = typeof entry?.id === 'string' && entry.id ? ` id:${entry.id}` : '';
    return `- ${type} ${distance}m ${direction}, (${level}, ${hp})${id}`;
  }).join('\n');
}

function formatActions(actions = []) {
  if (!Array.isArray(actions) || actions.length === 0) return 'none';
  return actions.map((action) => {
    if (!action || typeof action !== 'object') return '';
    if (action.type === 'move') return `move:${action.direction || 'vector'}`;
    if (action.type === 'attack') return `attack:${action.targetId || 'nearest monster'}`;
    if (action.type === 'interact') return `interact:${action.targetId || 'target'}`;
    if (action.type === 'equip') return `equip:${action.item || 'item'}`;
    return action.type || '';
  }).filter(Boolean).join(' > ') || 'none';
}

function formatHistory(history = []) {
  if (!Array.isArray(history) || history.length === 0) return '- No recent turns yet';
  return history.slice(-5).map((entry) => {
    const turn = Number.isFinite(entry?.turn) ? `turn ${entry.turn}` : 'recent turn';
    const mode = typeof entry?.behaviorMode === 'string' && entry.behaviorMode ? entry.behaviorMode : 'unspecified';
    const speak = sanitizeText(entry?.speak, MAX_SPEAK_CHARS) || '(no speech)';
    const actions = formatActions(entry?.actions);
    const outcome = sanitizeText(entry?.outcome, 80) || 'unknown outcome';
    return `- ${turn} [${mode}] said: "${speak}" actions: ${actions}; outcome: ${outcome}`;
  }).join('\n');
}

function formatGoal(goal) {
  if (!goal || typeof goal !== 'object') return 'none';
  const text = sanitizeText(goal.text, 120);
  return text ? `${text} (started turn ${Number.isFinite(goal.startedTurn) ? goal.startedTurn : '?'})` : 'none';
}

function formatGoalHistory(goalHistory = []) {
  if (!Array.isArray(goalHistory) || goalHistory.length === 0) return '- No completed or failed goals yet';
  return goalHistory.slice(-8).map((goal) => {
    const text = sanitizeText(goal?.text, 120) || '(untitled goal)';
    const status = sanitizeText(goal?.status, 20) || 'unknown';
    const note = sanitizeText(goal?.note, 80);
    return `- ${text}: ${status}${note ? ` (${note})` : ''}`;
  }).join('\n');
}

function buildPrompt(state = {}, meta = {}) {
  const hp = clampNumber(state.hp, 0);
  const hunger = clampNumber(state.hunger, 40);
  const magic = clampNumber(state.magic, 30);
  const equipped = typeof state.equipped === 'string' && state.equipped.trim() ? state.equipped.trim() : 'sword';
  const nearby = formatNearby(state.nearby);
  const history = formatHistory(meta.history);
  const currentGoal = formatGoal(meta.currentGoal);
  const goalHistory = formatGoalHistory(meta.goalHistory);
  const turnNumber = Number.isFinite(meta.turnNumber) ? meta.turnNumber : 1;
  const shouldSetGoal = !!meta.shouldSetGoal;

  return `You are controlling an RPG character named Llama.

Primary objective:
maximize XP and survive.

State:
HP: ${hp}
Hunger: ${hunger}
Magic: ${magic}
Equipped: ${equipped}
Turn: ${turnNumber}
Current 5-turn goal: ${currentGoal}
Must choose a new 5-turn goal this turn: ${shouldSetGoal ? 'yes' : 'no'}

Nearby:
${nearby}

Recent history (last 5 turns):
${history}

Goal history:
${goalHistory}

Rules:
- Return ONLY JSON. Include a speak string every time.
- Do NOT repeat any speak string from recent history.
- Speak must be unique and context-specific each turn.
- Avoid repeating an identical action sequence from the previous turn.
- Choose a behaviorMode each turn: cautious | aggressive | exploratory | playful | tactical.
- behaviorMode must influence both speak and actions.
- Include one new observation or interpretation in speak each turn.
- If Must choose a new 5-turn goal is yes, include a concrete "goal" string that can be completed by attacking a Monster or interacting with Food.
- If Must choose a new 5-turn goal is no, keep pursuing the current 5-turn goal and omit "goal" unless the old goal is impossible.
- Players are allies; never attack Player ids such as host. Attack only Monster ids.
- To get food, interact with a Food targetId when nearby; do not merely say you will find food.
- To fight successfully, attack a nearby Monster targetId; do not claim to attack a Player.

Available actions:
move
attack (Monster only)
equip
jump
interact (Food pickup or other target)
speak
spells: fly (magic cost), shield (magic cost)

JSON template:
{
  "speak": "short in-character sentence with a fresh observation",
  "behaviorMode": "cautious|aggressive|exploratory|playful|tactical",
  "goal": "only on new-goal turns: concrete 5-turn goal",
  "actions": [
    { "type": "move", "direction": "north|south|east|west" },
    { "type": "attack", "targetId": "Monster id from nearby" },
    { "type": "equip", "item": "sword|ice gun|best available" },
    { "type": "jump" },
    { "type": "interact", "targetId": "Food id from nearby" },
    { "type": "shield" },
    { "type": "fly" }
  ]
}
Choose at most 2 non-speak actions.`;
}

const ACTION_TYPES = new Set(['move', 'attack', 'equip', 'jump', 'interact', 'fly', 'shield']);
const DIRECTIONS = new Set(['north', 'south', 'east', 'west']);
const MAX_ACTIONS = 2;
const MAX_SPEAK_CHARS = 96;
const MAX_ITEM_CHARS = 40;
const MAX_TARGET_ID_CHARS = 80;

function sanitizeText(value, maxChars) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function fallbackDecision() {
  return {
    speak: 'Thinking fast, staying alive.',
    actions: []
  };
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const type = sanitizeText(action.type || action.action, 20).toLowerCase();
  if (!ACTION_TYPES.has(type)) return null;

  if (type === 'move') {
    const direction = sanitizeText(action.direction, 12).toLowerCase();
    if (!DIRECTIONS.has(direction)) return null;
    return { type, direction };
  }

  if (type === 'attack') {
    const targetId = sanitizeText(action.targetId || action.target, MAX_TARGET_ID_CHARS);
    return targetId ? { type, targetId } : { type };
  }

  if (type === 'equip') {
    const item = sanitizeText(action.item || action.target, MAX_ITEM_CHARS);
    if (!item) return null;
    return { type, item };
  }

  if (type === 'interact') {
    const targetId = sanitizeText(action.targetId || action.target, MAX_TARGET_ID_CHARS);
    if (!targetId) return null;
    return { type, targetId };
  }

  return { type };
}

function normalizeDecision(value) {
  const base = fallbackDecision();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;

  const rawActions = Array.isArray(value.actions)
    ? value.actions
    : (value.action ? [{ ...value, type: value.action }] : []);
  const actions = rawActions
    .map(normalizeAction)
    .filter(Boolean)
    .slice(0, MAX_ACTIONS);

  const spell = sanitizeText(value.spell, 20).toLowerCase();
  if ((spell === 'fly' || spell === 'shield') && actions.length < MAX_ACTIONS) {
    actions.push({ type: spell });
  }

  return {
    speak: sanitizeText(value.speak || value.say || value.message, MAX_SPEAK_CHARS) || base.speak,
    behaviorMode: sanitizeText(value.behaviorMode || value.mode, 24).toLowerCase(),
    goal: sanitizeText(typeof value.goal === 'string' ? value.goal : (value.goal?.text || value.nextGoal), 120),
    actions
  };
}

export default async function handler(req, res) {
  if (!isAllowedMethod(req.method)) {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const apiKey = process.env.GROQ_KEY;
  if (!apiKey) {
    return res.status(200).json({ decision: fallbackDecision(), warning: 'GROQ_KEY is not configured.' });
  }

  const body = readJsonBody(req.body);
  const prompt = buildPrompt(body.state || {}, body);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const upstream = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.75,
        max_tokens: 180,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return only valid JSON for the RPG character controller. The JSON must always include speak.' },
          { role: 'user', content: prompt }
        ]
      }),
      signal: controller.signal
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(200).json({ decision: fallbackDecision(), warning: `Groq request failed with ${upstream.status}.`, detail: detail.slice(0, 240) });
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content;
    let decision = fallbackDecision();
    if (typeof content === 'string' && content.trim()) {
      try {
        decision = JSON.parse(content);
      } catch {
        decision = fallbackDecision();
      }
    }
    return res.status(200).json({ decision: normalizeDecision(decision) });
  } catch (error) {
    return res.status(200).json({
      decision: fallbackDecision(),
      warning: error?.name === 'AbortError' ? 'Groq request timed out.' : 'Groq request failed.'
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
