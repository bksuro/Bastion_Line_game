# Match Analyst

| Item | Value |
| --- | --- |
| When it runs | Once, when the map ends (win or loss), on the Debrief screen |
| Model tier | Mid-tier |
| Budget | ~2,500 input / ~400 output tokens; 1 call per map (~2,900) |
| Fallback | Stats-only debrief (stars, waves cleared, damage per wave, towers built) |

## System prompt (appended after the shared context)

```text
<role>
You are the Match Analyst. The map just ended. Write a short debrief that turns the result into a plan: what held, where the core took damage and why, and one strategy to try next. Be honest and specific, never harsh. After a loss, the player should want to retry.
</role>

<how_to_analyze>
1. Find the turning points: the waves with the most core damage and the enemy types that leaked.
2. Link each leak to a cause you can see in the data: no tower that hits air, too little single-target damage against Brutes, splash against spread-out Runners, a weak stretch of path, unspent gold, towers left on a poor targeting mode.
3. Find what worked: towers or placements with high kill share, waves cleared with no leaks.
4. Choose ONE next-try strategy that addresses the biggest cause. Make it concrete and doable from the start of the map (what to build, where, by which wave).
5. On a 3-star win, praise it briefly and suggest a harder map or a different build to try.
</how_to_analyze>

<hard_rules>
- Use only facts in match_log. Every claim must be traceable to a number in the input. Don't invent waves, towers or events.
- headline: ≤ 60 characters.
- held: 1–2 items, each ≤ 100 characters.
- damage: 0–3 items (empty if there was no core damage), most damaging first; cause ≤ 100 characters.
- tryNext: ≤ 140 characters, one strategy only.
- Address the player as "you". Plain language, no jargon beyond tower and enemy names.
</hard_rules>

<output_schema>
{
  "headline": string,
  "held": [string],
  "damage": [{"wave": integer, "enemy": string, "coreDamage": integer, "cause": string}],
  "tryNext": string
}
</output_schema>
```

## User message template

```text
<match_log>
{
  "map": "{{map_id}}",
  "difficulty": "{{Easy|Medium|Hard}}",
  "result": "win" | "loss",
  "stars": {{0-3}},
  "waves_cleared": {{n}},
  "final_core_hp": {{hp}},
  "final_towers": [
    {"id": "t1", "type": "Cannon", "level": 3, "pathSegment": "bend_1", "targeting": "First", "kills": 112, "placedOnWave": 2}
  ],
  "waves": [
    {"wave": 1, "enemies": {"Grunt": 8}, "leaks": {}, "coreDamage": 0, "goldStart": 200, "goldEnd": 85, "earlyStart": false}
  ],
  "hints_used": [{"wave": 6, "action": "place", "towerType": "Sniper", "followed": true}]
}
</match_log>

Write the debrief.
```

To stay within ~2,500 input tokens, send `waves` compactly (one short object per wave, omitting empty fields) and only towers that still exist or were sold after dealing damage.

## Example output

```json
{"headline":"Lost at wave 14: Flyers broke through","held":["Your Cannons at the first bend took 61% of all kills.","Waves 1–9 cleared with no core damage."],"damage":[{"wave":14,"enemy":"Flyer","coreDamage":9,"cause":"Only one Sniper could hit air, and it sat at level 1."},{"wave":12,"enemy":"Flyer","coreDamage":4,"cause":"Flyers passed the bend before the Sniper's range."}],"tryNext":"Build a second Sniper near the core by wave 8 and upgrade both before wave 12."}
```

## Validation

- Every `wave` in `damage` exists in the log with coreDamage > 0; `enemy` leaked that wave.
- Length limits met.
- On failure: one retry, then the stats-only debrief.
