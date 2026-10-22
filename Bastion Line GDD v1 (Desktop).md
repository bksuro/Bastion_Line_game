# Bastion Line GDD v1 (Desktop)

Oct 19, 2026 · @Subbarao Bellamkonda

## Executive Summary

Bastion Line is a single-player, fixed-path tower defense for PC. You build and upgrade towers to stop 20 waves before they reach your core, while four AI agents adapt the waves, coach you and narrate the match.

| Item | Value |
| --- | --- |
| Platform | Windows, Mac, Linux desktop (mouse + keyboard) |
| Session length | 15–25 minutes per map |
| View | 2D, top-down |
| Engine | Godot |

**AI approach:** the four in-game agents are the Wave Director, Tactical Advisor, Battle Narrator and Match Analyst. They act only between waves, so API latency never touches real-time combat. Enemy movement and tower targeting stay deterministic code, and scripted fallbacks keep the game fully playable offline.

**Budget and scope:** about 43,000 tokens per map, capped at 60,000. The MVP is about 4–6 weeks solo, plus 1–2 weeks for the AI layer and its backend proxy.

## Game Mechanics

Each map is 20 waves, and each wave alternates a build phase with a combat phase. You lose when core HP hits 0 and win after clearing wave 20.

### Player loop

1. **Build phase:** read the next-wave preview, spend gold to place, upgrade or sell towers, and optionally ask for a hint.
2. **Start the wave:** press Start, or press Space early for bonus gold.
3. **Combat phase:** enemies walk the path while towers fire automatically; adjust speed or pause as needed.
4. **Payout:** kills and the wave-clear bonus add gold, then the next build phase begins.
5. **Debrief:** after the map ends, review the match summary and retry or move on.

### Controls

| Input | Action |
| --- | --- |
| Left-click | Select a tower in the build bar, then click a tile to place it |
| Click placed tower | Open the upgrade/sell panel |
| H | Ask for a hint (3 per map) |
| Space | Start the next wave early (bonus gold) |
| 1 / 2 / 3 | Game speed 1× / 2× / 3× |
| Esc | Pause menu |

### Map, towers and enemies

The MVP ships 3 maps (Easy, Medium, Hard), each a 32×18 tile grid with one fixed enemy path; towers go only on buildable tiles.

| Tower | Role | Cost (gold) | Notes |
| --- | --- | --- | --- |
| Arrow | Cheap, fast single-target | 50 | Good all-rounder |
| Frost | Slows enemies 40% | 75 | Low damage, utility |
| Cannon | Splash damage, slow fire | 100 | Strong vs groups |
| Sniper | Long range, high damage | 150 | Can hit flying units |

- Each tower has 3 upgrade levels, about +40% damage or range per level, costing 60% / 100% / 150% of base cost.
- Selling refunds 70% of total spent. Targeting modes: First, Strongest, Closest.

| Enemy | Trait |
| --- | --- |
| Grunt | Baseline HP and speed |
| Runner | Fast, low HP |
| Brute | Slow, high HP |
| Flyer | Ignores ground-only towers |
| Boss (waves 10 and 20) | Huge HP, deals 5 core damage |

### Economy and difficulty

- Start with 200 gold and 20 core HP; all numbers are starting values to tune in playtesting.
- Each enemy pays by type; clearing a wave pays 25 + 5 × wave number.
- Each wave gets a threat budget that rises about 12% per wave; the AI Wave Director decides how to spend it.
- Stars: 3 for no core damage, 2 for at least 50% HP left, 1 for clearing. Stars unlock the next map.

### Presentation

- **HUD:** gold, core HP, wave counter, next-wave preview with a one-line narrator caption, hint counter, speed buttons.
- **Build bar and tower panel:** costs (greyed out when unaffordable), stats, upgrade and sell values, targeting mode.
- **Screens:** Main menu → Map select → Game → Debrief (win/lose summary with AI analysis).
- **Art and audio:** flat-color 2D top-down art with a distinct silhouette per unit; SFX for firing, hits, deaths and wave start; 1–2 music loops.

## AI Architecture

Four agents shape the match between waves. None of them control frame-by-frame combat: pathing, targeting and damage stay deterministic game code.

| Agent | When it acts | Effect on gameplay |
| --- | --- | --- |
| Wave Director | Each build phase | Spends the wave's threat budget on a mix of enemies that tests your current defense. If you have no Sniper, Flyers appear; if you stack Cannons, Runners spread out. Every run plays differently, and the challenge stays close to "almost lost." |
| Tactical Advisor | When you press Hint (3 per map) | Highlights one tile or tower and gives a one-sentence reason, such as "Upgrade the Frost tower at the bend; Brutes are coming." It teaches without solving the map. |
| Battle Narrator | At map start, shown each wave | Writes a one-line intro per wave and boss taunts that react to your build. Purely cosmetic; it never changes stats. |
| Match Analyst | When the map ends | Writes a short debrief: what held, where the core took damage, and one strategy to try next. It turns a loss into a plan for the retry. |

### Fairness rules

- The Wave Director can only use enemies unlocked for that wave and cannot exceed the threat budget.
- The next wave is always shown in the preview before it starts, so you can counter it.
- Hints suggest; they never place or upgrade towers for you.

### When AI is unavailable

If the network, API or token budget is unavailable, each agent falls back to scripted content: hand-authored wave lists, a rule-based hint, stock wave captions and a stats-only debrief. The game stays fully playable offline.

## Technical Strategy

Every agent call goes through a small backend proxy, returns validated JSON, and has a scripted fallback. That keeps a map at about 43,000 tokens with a hard cap of 60,000.

### Agent roles and token budget

Token counts are planning estimates per map of 20 waves; measure them in the first playable build.

| Agent | Model tier | Input tokens / call | Output tokens / call | Calls / map | Tokens / map |
| --- | --- | --- | --- | --- | --- |
| Wave Director | Mid-tier | \~1,500 | \~250 | 20 | \~35,000 |
| Match Analyst | Mid-tier | \~2,500 | \~400 | 1 | \~2,900 |
| Tactical Advisor | Small, fast | \~1,200 | \~150 | up to 3 | \~4,000 |
| Battle Narrator | Small, fast | \~800 | \~600 | 1 (all 20 lines at once) | \~1,400 |
| **Total** |  |  |  |  | **\~43,000** |

- **Prompt caching:** the shared system prompt (rules, tower and enemy stats, output schema) is cached, so repeated Wave Director calls pay mostly for the changing game state.
- **Compact state:** the client sends a short JSON summary (towers, gold, HP, last wave's leaks), never the full scene.
- **Caps:** 60,000 tokens per map and a daily per-player cap set by the proxy. Past a cap, agents switch to fallbacks.
- **Dev-time agent (not shipped):** a Balance Tester runs headless simulations in CI and proposes stat changes as a pull request for human review. It uses a separate developer budget.

### Request flow

1. While the current wave runs, the client sends the game-state summary to the backend proxy, so the next wave is ready before the build phase.
2. The proxy authenticates the player, checks caps and calls the model with the cached system prompt.
3. The response is checked against a JSON schema: known enemy types only, within the threat budget, valid tiles only.
4. A valid response is applied and saved with the run. An invalid response gets one retry, then the scripted fallback.

### API constraints

- **No key in the client:** Godot and Unity builds can be decompiled, so the API key lives only on the backend (for example, a serverless function).
- **Latency:** calls take a few seconds, so they never block combat. A 5-second timeout triggers the fallback.
- **Rate limits:** the API limits requests and tokens per minute. The proxy queues requests and falls back when a request is rate-limited (HTTP 429).
- **Determinism and replays:** each agent's JSON is stored in the save, so a run can be replayed without new calls.
- **Cost:** AI cost recurs every session. A one-time purchase price needs the per-player caps; price it at current published API rates.
- **Privacy:** only game state is sent, with no personal data. Disclose the third-party AI service in the privacy policy.
- **Engine:** HTTPRequest in Godot or UnityWebRequest in Unity calls the proxy; no engine-side AI SDK is needed.

### Scope

- **MVP (about 4–6 weeks + 1–2 weeks for AI):** 3 maps, 4 towers, 5 enemies, 20 waves per map, save/load, the 4 agents, the proxy and the fallbacks.
- **Later:** endless mode with an AI-generated daily map, level-3 tower abilities, a map editor, Steam achievements.
