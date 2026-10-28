/**
 * Battle Narrator fallback: stock text that meets the prompts/03-battle-narrator.md length rules.
 * Captions never name enemy types or counts; only waves 10 and 20 mention the boss.
 */
import { TOWER_TYPES } from '../types';
import type { BossTauntSet, NarrationInput, NarrationResult, TauntKey } from '../types';

export const NARRATION_LIMITS = {
  introChars: 100,
  captionChars: 70,
  captionCount: 20,
  tauntChars: 80,
} as const;

const TAUNT_KEYS: readonly TauntKey[] = [...TOWER_TYPES, 'mixed'];

interface StockNarration {
  intro: string;
  introRetry: string;
  captions: string[];
  bossTaunts: { '10': BossTauntSet; '20': BossTauntSet };
}

/** Greenhollow Road (the Easy map). */
const EASY: StockNarration = {
  intro: 'Greenhollow Road falls tonight. Enjoy the view from your little keep.',
  introRetry: 'Back again? Greenhollow Road remembers you. So do we.',
  captions: [
    'A few scouts wander down Greenhollow Road. Just saying hello.',
    'The farmers noticed us. Now the rest of the camp is coming too.',
    'Dust on the road already. Your keep looks smaller from here.',
    'We counted your walls on the way in. It did not take long.',
    'The valley is quiet. Enjoy it while it lasts.',
    'Our drums carry over every field in Greenhollow now.',
    'Look up now and then. The sky is not on your side.',
    'The road grows crowded, and our patience grows thin.',
    'Hear that rumble? Something old is waking at the far end.',
    'Old Ironhide has heard about your little walls.',
    'You beat one champion. We brought the whole army.',
    'The harvest is over. The siege has only begun.',
    'Every fence post in the valley is ours. Only the keep remains.',
    'Your walls are cracking. We can hear it from the hills.',
    'Deep into the siege, and our banners keep coming.',
    'The wells are dry, the barns are empty, the road is ours.',
    'Your towers look tired. Our soldiers do not.',
    'Smoke over the keep. Shall we call it a sunset?',
    'One last breath before the storm. Make it count.',
    'The Greenhollow Warlord rides. The road ends at your gate.',
  ],
  bossTaunts: {
    '10': {
      Arrow: 'Arrows? Old Ironhide has had worse splinters from a fence post.',
      Frost: 'Chill all you like. Old Ironhide was forged in winter.',
      Cannon: 'Loud toys. Old Ironhide likes loud.',
      Sniper: 'Aim carefully. Old Ironhide only needs you to miss once.',
      mixed: 'A bit of everything, and not enough of anything.',
    },
    '20': {
      Arrow: 'The Warlord laughs at your arrows. So does his shield.',
      Frost: 'Freeze the road if you like. The Warlord walks on ice.',
      Cannon: 'Your cannons shake the valley. The Warlord does not shake.',
      Sniper: 'Every marksman misses eventually. The Warlord is patient.',
      mixed: 'A tower of every kind, and a gate about to fall.',
    },
  },
};

/** Any other map: the same voice with no place names. */
const GENERIC: StockNarration = {
  intro: 'This road falls tonight. Enjoy the view while it lasts.',
  introRetry: 'Back again? The road remembers you. So do we.',
  captions: [
    'A few scouts on the road. Just saying hello.',
    'You were noticed. Now the rest of the camp is coming.',
    'Dust on the road already. Your keep looks smaller from here.',
    'We counted your walls on the way in. It did not take long.',
    'Quiet out here. Enjoy it while it lasts.',
    'Our drums carry for miles now.',
    'Look up now and then. The sky is not on your side.',
    'The road grows crowded, and our patience grows thin.',
    'Hear that rumble? Something old is waking at the far end.',
    'Our first champion has heard about your little walls.',
    'You beat one champion. We brought the whole army.',
    'The scouting is over. The siege has only begun.',
    'Every field around you is ours. Only the keep remains.',
    'Your walls are cracking. We can hear it from the hills.',
    'Deep into the siege, and our banners keep coming.',
    'The wells are dry, the stores are empty, the road is ours.',
    'Your towers look tired. Our soldiers do not.',
    'Smoke over the keep. Shall we call it a sunset?',
    'One last breath before the storm. Make it count.',
    'The warlord rides at last. The road ends at your gate.',
  ],
  bossTaunts: {
    '10': {
      Arrow: 'Arrows? I have had worse splinters.',
      Frost: 'Chill all you like. I was born in winter.',
      Cannon: 'Loud toys. I like loud.',
      Sniper: 'Aim carefully. I only need you to miss once.',
      mixed: 'A bit of everything, and not enough of anything.',
    },
    '20': {
      Arrow: 'I laugh at your arrows. So does my shield.',
      Frost: 'Freeze the road if you like. I walk on ice.',
      Cannon: 'Your cannons shake the ground. I do not shake.',
      Sniper: 'Every marksman misses eventually. I am patient.',
      mixed: 'A tower of every kind, and a gate about to fall.',
    },
  },
};

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`);

const clipTaunts = (set: BossTauntSet): BossTauntSet => {
  const out = {} as BossTauntSet;
  for (const key of TAUNT_KEYS) out[key] = clip(set[key], NARRATION_LIMITS.tauntChars);
  return out;
};

export function fallbackNarration(input: NarrationInput): NarrationResult {
  const stock = input.id === 'easy' ? EASY : GENERIC;
  const intro = input.attempt_number > 1 ? stock.introRetry : stock.intro;
  return {
    intro: clip(intro, NARRATION_LIMITS.introChars),
    captions: stock.captions.map((text, i) => ({ wave: i + 1, text: clip(text, NARRATION_LIMITS.captionChars) })),
    bossTaunts: { '10': clipTaunts(stock.bossTaunts['10']), '20': clipTaunts(stock.bossTaunts['20']) },
  };
}

/** The Narrator hard rules that code can check (lengths, counts, all taunts). [] = valid. */
export function validateNarration(n: NarrationResult): string[] {
  const problems: string[] = [];
  if (typeof n.intro !== 'string' || n.intro.length > NARRATION_LIMITS.introChars) problems.push('intro too long or missing');
  if (!Array.isArray(n.captions) || n.captions.length !== NARRATION_LIMITS.captionCount) {
    problems.push('captions must have exactly 20 entries');
  } else {
    n.captions.forEach((c, i) => {
      if (c.wave !== i + 1) problems.push(`caption ${i + 1} has wave ${c.wave}`);
      if (typeof c.text !== 'string' || c.text.length > NARRATION_LIMITS.captionChars) problems.push(`caption ${i + 1} too long or missing`);
    });
  }
  for (const w of ['10', '20'] as const) {
    const set = n.bossTaunts?.[w];
    for (const key of TAUNT_KEYS) {
      const t = set?.[key];
      if (typeof t !== 'string' || t.length === 0 || t.length > NARRATION_LIMITS.tauntChars) problems.push(`taunt ${w}.${key} too long or missing`);
    }
  }
  return problems;
}
