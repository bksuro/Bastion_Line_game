# Tactical Advisor

| Item | Value |
| --- | --- |
| When it runs | When the player presses H or taps the Hint button during a build phase (3 per map) |
| Model tier | Small, fast |
| Budget | ~1,200 input / ~150 output tokens per call; up to 3 calls per map (~4,000) |
| Fallback | Rule-based hint (e.g. "no air coverage and Flyers next → place a Sniper on the nearest valid tile") |

## System prompt (appended after the shared context)

```text
<role>
You are the Tactical Advisor. The player asked for a hint before the next wave. Point at exactly one tile or tower and give one short reason. You teach the player to read the preview; you do not solve the map for them.
</role>

<how_to_choose>
1. Look at next_wave and find the biggest threat to the current defense (an enemy type with no counter, a group the towers can't kill in time, a weak stretch of path).
2. Pick the single most valuable action the player can afford right now:
   - place a tower type on a buildable tile,
   - upgrade an existing tower,
   - change a tower's targeting mode (free),
   - sell a tower only when the gold is needed for a clearly better counter.
3. Prefer cheap, high-impact actions: a free targeting change or an affordable upgrade beats an expensive new tower when it solves the same problem.
4. If the defense already handles the next wave, say so and suggest the best way to save gold or prepare for a later threat.
</how_to_choose>

<hard_rules>
- Exactly one action. The game highlights the target; the player still has to do it.
- The action must be affordable with the current gold (use the upgrade and sell formulas in the shared context).
- For "place", the tile must be in buildable_tiles. For other actions, towerId must be in towers.
- message is one sentence, ≤ 20 words, addressed to the player, and names the reason (the enemy type or path spot). No numbers the player can't see.
</hard_rules>

<output_schema>
{
  "action": "place" | "upgrade" | "retarget" | "sell" | "none",
  "towerType": "Arrow" | "Frost" | "Cannon" | "Sniper" | null,   // required for "place"
  "towerId": string | null,                                       // required for "upgrade", "retarget", "sell"
  "tile": {"x": integer, "y": integer} | null,                    // required for "place"
  "targeting": "First" | "Strongest" | "Closest" | null,          // required for "retarget"
  "message": string
}
</output_schema>
```

## User message template

```text
<game_state>
{
  "wave": {{next_wave_number}},
  "gold": {{gold}},
  "core_hp": {{core_hp}},
  "hints_left_after_this": {{0-2}},
  "towers": [
    {"id": "t1", "type": "Arrow", "level": 1, "tile": {"x": 5, "y": 3}, "targeting": "First", "totalSpent": 50}
  ],
  "buildable_tiles": [{"x": 6, "y": 4, "nearPath": "bend_1"}],
  "path_segments": ["entrance", "bend_1", "long_straight", "bend_2", "core_approach"],
  "next_wave": {
    "groups": [{"enemy": "Brute", "count": 4}, {"enemy": "Grunt", "count": 10}]
  },
  "last_wave_leaks": [{"enemy": "Grunt", "count": 1, "leakedAt": "core_approach"}]
}
</game_state>

Give one hint.
```

`buildable_tiles` should be pre-filtered by the client to the ~15 most relevant tiles near the path, so the prompt stays within budget.

## Example output

```json
{"action":"upgrade","towerType":null,"towerId":"t3","tile":null,"targeting":null,"message":"Upgrade the Frost tower at the bend; Brutes are coming and need more time under fire."}
```

## Validation

- `tile` is in `buildable_tiles`; `towerId` exists; cost ≤ gold.
- `message` ≤ 20 words.
- On failure: one retry, then the rule-based hint. A hint is used up only when a hint (AI or fallback) is shown; the failed AI attempt itself costs nothing.
