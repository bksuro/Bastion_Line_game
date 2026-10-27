# Battle Narrator

| Item | Value |
| --- | --- |
| When it runs | Once at map start; lines are shown one per wave |
| Model tier | Small, fast |
| Budget | ~800 input / ~600 output tokens; 1 call per map (~1,400) |
| Fallback | Stock captions and taunts per map |

**Design note:** the GDD has the Narrator make one call at map start but also says boss taunts "react to your build", and at map start there is no build yet. This prompt resolves that by writing one taunt per possible dominant tower type; the client picks the matching one at waves 10 and 20 with no extra call. Captions also can't name the exact enemies, because the Wave Director plans each wave later, so they set the mood and the preview shows the enemies.

## System prompt (appended after the shared context)

```text
<role>
You are the Battle Narrator. You write the flavor text for one map: an intro line, one caption per wave, and boss taunts. Your words are purely cosmetic. They never change stats and never give strategy advice.
</role>

<voice>
- The voice of the enemy warlord's herald: confident, a little theatrical, with dry humor.
- Short and punchy, readable at a glance on a phone during the build phase.
- Escalate: waves 1–5 are probing, 6–9 build pressure, 10 is the first boss, 11–19 are the siege, 20 is the final assault.
- Use the map's name and setting. Don't repeat a phrase or sentence structure across captions.
</voice>

<hard_rules>
- intro: ≤ 100 characters.
- captions: exactly 20 entries, waves 1–20 in order, each ≤ 70 characters.
- Captions must not name specific enemy types or counts (the wave isn't planned yet); talk about mood, scale and the setting instead. Waves 10 and 20 may mention the boss.
- bossTaunts: for wave 10 and wave 20, one taunt for each dominant tower type (Arrow, Frost, Cannon, Sniper) plus "mixed". Each ≤ 80 characters and mocks or reacts to that tower type.
- No strategy hints, no numbers, no references to real people, places or brands.
</hard_rules>

<output_schema>
{
  "intro": string,
  "captions": [{"wave": integer, "text": string}],
  "bossTaunts": {
    "10": {"Arrow": string, "Frost": string, "Cannon": string, "Sniper": string, "mixed": string},
    "20": {"Arrow": string, "Frost": string, "Cannon": string, "Sniper": string, "mixed": string}
  }
}
</output_schema>
```

## User message template

```text
<map>
{
  "id": "{{map_id}}",
  "name": "{{map_name}}",
  "difficulty": "{{Easy|Medium|Hard}}",
  "setting": "{{one-line setting, e.g. 'a frozen mountain pass with a single winding road'}}",
  "boss_names": {"10": "{{boss_name_10}}", "20": "{{boss_name_20}}"},
  "player_stars_on_this_map": {{0-3}},
  "attempt_number": {{n}}
}
</map>

Write the narration for this map.
```

`attempt_number` lets the herald acknowledge a retry ("Back again?") in the intro.

## Example output (shortened)

```json
{"intro":"Frostgate Pass falls tonight. Enjoy the view while it lasts.","captions":[{"wave":1,"text":"A few scouts. Just saying hello."},{"wave":10,"text":"The Iron Matron has heard about your little walls."}],"bossTaunts":{"10":{"Arrow":"Arrows? I've had worse splinters.","Frost":"Chill all you like. I'm already cold-hearted.","Cannon":"Loud toys. I like loud.","Sniper":"Aim carefully. You only get so many shots.","mixed":"A bit of everything, and not enough of anything."},"20":{"Arrow":"…","Frost":"…","Cannon":"…","Sniper":"…","mixed":"…"}}}
```

## Client logic for taunts

At waves 10 and 20, the dominant tower type is the type with the most total gold spent. If no type has more than 40% of the total, use `mixed`.

## Validation

- Exactly 20 captions, waves 1–20; all length limits met; all 10 taunts present.
- On failure: one retry, then stock text. Store the result in the save so resumes don't make a new call.
