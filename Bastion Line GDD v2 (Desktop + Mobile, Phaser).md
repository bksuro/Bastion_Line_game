# Bastion Line GDD v2 (Desktop + Mobile, Phaser)

Oct 19, 2026 · @Subbarao Bellamkonda

## Executive Summary

Bastion Line is a single-player, fixed-path tower defense built once in Phaser and shipped to desktop, iOS, Android and web. You build and upgrade towers to stop 20 waves before they reach your core, while four AI agents adapt the waves, coach you and narrate the match.

| Item | Value |
| --- | --- |
| Platforms | Windows, Mac, Linux desktop; iOS; Android; web browser |
| Session length | 15–25 min per map on desktop; 8–12 min target on mobile |
| View | 2D, top-down, landscape only |
| Stack | Phaser + TypeScript + Vite; Electron or Tauri for desktop; Capacitor for mobile |

**AI approach:** the four in-game agents are the Wave Director, Tactical Advisor, Battle Narrator and Match Analyst. They act only between waves, so API latency never touches real-time combat. Enemy movement and tower targeting stay deterministic code, and scripted fallbacks keep the game fully playable offline, which matters most on mobile.

**Budget and scope:** about 43,000 tokens per map, capped at 60,000. Plan on about 6–9 weeks for desktop, web and mobile solo, plus 1–2 weeks for the AI layer and its backend proxy.

## Game Mechanics

Each map is 20 waves, and each wave alternates a build phase with a combat phase. The loop is the same on every platform; only the input changes. You lose when core HP hits 0 and win after clearing wave 20.

### Player loop

1. **Build phase:** read the next-wave preview, spend gold to place, upgrade or sell towers, and optionally ask for a hint.
2. **Start the wave:** start it, or start early for bonus gold.
3. **Combat phase:** enemies walk the path while towers fire automatically; adjust speed or pause as needed.
4. **Payout:** kills and the wave-clear bonus add gold. Mobile autosaves here, so you can quit and resume.
5. **Debrief:** after the map ends, review the match summary and retry or move on.

### Controls

| Action | Desktop | Touch (iOS / Android) |
| --- | --- | --- |
| Place tower | Select in build bar, click a tile | Tap in build bar, tap a tile; ghost tower + range shown with ✓ / ✕ to confirm |
| Upgrade / sell | Click placed tower | Tap placed tower |
| Ask for a hint (3 per map) | H | On-screen hint button |
| Start next wave early | Space | On-screen button |
| Game speed | 1 / 2 / 3 keys | On-screen speed toggle |
| Pause | Esc | On-screen button; auto-pause when the app is backgrounded |
| Move camera | Not needed | Pinch to zoom, drag to pan |

Touch targets are at least 44 pt (iOS) / 48 dp (Android). There is no hover on touch, so range previews show on selection.

### Map, towers and enemies

The MVP ships 3 maps (Easy, Medium, Hard), each with one fixed enemy path drawn in Tiled. A 32×18 grid is too small on phones, so either use about 20×12 with larger tiles or keep 32×18 with zoom (open decision). Layout is landscape only, from 4:3 tablets to about 20:9 phones, with the HUD inside the safe area.

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
- Sessions: 15–25 minutes on desktop; aim for 8–12 minutes on mobile.

### Presentation

- **HUD:** gold, core HP, wave counter, next-wave preview with a one-line narrator caption, hint counter, speed and pause buttons, anchored to screen edges.
- **Build bar and tower panel:** costs (greyed out when unaffordable, thumb-sized on mobile), stats, upgrade and sell values, targeting mode.
- **Screens:** Main menu → Map select → Game → Debrief (win/lose summary with AI analysis).
- **Art and audio:** flat-color 2D top-down art with a distinct silhouette per unit; SFX for firing, hits, deaths and wave start; 1–2 music loops; optional haptics on placement and boss hits.

## AI Architecture

Four agents shape the match between waves, identically on desktop, mobile and web. None of them control frame-by-frame combat: pathing, targeting and damage stay deterministic game code.

| Agent | When it acts | Effect on gameplay |
| --- | --- | --- |
| Wave Director | Each build phase | Spends the wave's threat budget on a mix of enemies that tests your current defense. If you have no Sniper, Flyers appear; if you stack Cannons, Runners spread out. Every run plays differently, and the challenge stays close to "almost lost." |
| Tactical Advisor | When you tap or press Hint (3 per map) | Highlights one tile or tower and gives a one-sentence reason, such as "Upgrade the Frost tower at the bend; Brutes are coming." On mobile the highlight pulses so it reads on a small screen. It teaches without solving the map. |
| Battle Narrator | At map start, shown each wave | Writes a one-line intro per wave and boss taunts that react to your build. Purely cosmetic; it never changes stats. |
| Match Analyst | When the map ends | Writes a short debrief: what held, where the core took damage, and one strategy to try next. It turns a loss into a plan for the retry. |

### Fairness rules

- The Wave Director can only use enemies unlocked for that wave and cannot exceed the threat budget.
- The next wave is always shown in the preview before it starts, so you can counter it.
- Hints suggest; they never place or upgrade towers for you.

### When AI is unavailable

If the network, API or token budget is unavailable, each agent falls back to scripted content: hand-authored wave lists, a rule-based hint, stock wave captions and a stats-only debrief. The game stays fully playable offline, which matters most for mobile players on planes or weak connections.

## Technical Strategy

One Phaser codebase builds to every platform. Every agent call goes through a small backend proxy, returns validated JSON, and has a scripted fallback. That keeps a map at about 43,000 tokens with a hard cap of 60,000.

### Tech stack

| Layer | Choice |
| --- | --- |
| Game framework | Phaser + TypeScript (WebGL renderer) |
| Build tool | Vite |
| Map editor | Tiled (JSON loaded directly by Phaser) |
| Scaling and input | Phaser Scale Manager in FIT mode; pointer events for mouse and touch |
| Desktop build | Electron or Tauri (Electron is the common route to Steam) |
| Mobile build | Capacitor (native iOS and Android projects) |
| Saves | localStorage on web; Capacitor Preferences on mobile |
| AI backend | Serverless proxy that holds the API key and calls the model |

- **Performance:** cap at 60 fps (30 when paused), pool enemies and projectiles, use texture atlases, and test early on a low-end Android device.
- Phaser has no visual scene editor, and iOS builds need a Mac with Xcode and an Apple Developer account ($99 per year).

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
- **Compact state:** the client sends a short JSON summary (towers, gold, HP, last wave's leaks), never the full scene. This also keeps mobile data use low.
- **Caps:** 60,000 tokens per map and a daily per-player cap set by the proxy. Past a cap, agents switch to fallbacks.
- **Dev-time agent (not shipped):** a Balance Tester runs headless simulations in CI and proposes stat changes as a pull request for human review. It uses a separate developer budget.

### Request flow

1. While the current wave runs, the client sends the game-state summary to the backend proxy, so the next wave is ready before the build phase.
2. The proxy authenticates the player, checks caps and calls the model with the cached system prompt.
3. The response is checked against a JSON schema: known enemy types only, within the threat budget, valid tiles only.
4. A valid response is applied and saved with the run. An invalid response gets one retry, then the scripted fallback.

### API constraints

- **No key in the client:** a Phaser build is plain JavaScript that anyone can inspect in a browser, Electron or the app bundle, so the API key lives only on the backend.
- **Latency:** calls take a few seconds, so they never block combat. A 5-second timeout triggers the fallback, and mobile networks make this timeout more likely.
- **Rate limits:** the API limits requests and tokens per minute. The proxy queues requests and falls back when a request is rate-limited (HTTP 429).
- **Determinism and replays:** each agent's JSON is stored in the save, so a run can be replayed or resumed after a mobile app restart without new calls.
- **Cost and monetization:** AI cost recurs every session. A premium price needs the per-player caps; free with ads or IAP can fund ongoing calls. Price it at current published API rates.
- **Privacy and stores:** only game state is sent, with no personal data. Disclose the third-party AI service in the privacy policy and in the App Store and Google Play data-safety forms.

### Store and milestones

Store submission needs a privacy policy, data-safety disclosures, an age rating, and icons and screenshots for each platform.

1. **Milestone 1: Desktop + web (about 4–6 weeks).** 3 maps, 4 towers, 5 enemies, 20 waves per map, save/load; build and balance here.
2. **Milestone 2: AI layer (about 1–2 weeks).** The 4 agents, the backend proxy, schemas, caps and fallbacks.
3. **Milestone 3: Mobile (about 2–3 weeks).** Touch controls, layout and safe areas, lifecycle and autosave, Capacitor builds, store submission.

**Later:** endless mode with an AI-generated daily map, level-3 tower abilities, a map editor, cloud save, Steam achievements.
