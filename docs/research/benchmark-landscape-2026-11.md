# Grue + Brass Lantern in the LLM text-adventure benchmark landscape (November 2026)

Research note, 2026-11-13. Every external claim links to a page that was actually opened for this note. Claims about
Grue and Brass Lantern come from the code in `C:\Dev\grue` and `C:\Dev\brass-lantern`, the results in
`brass-lantern/docs/results/2026-11-13.md`, and the partial Haiku effort sweep in
`brass-lantern/runs/haiku-effort-2026-11-13`.

---

## 1. Bottom line

Putting LLMs into Zork-style games is a crowded field, not an open one. Microsoft's TALES and CAIS's TextQuests are
the reference academic benchmarks. A peer-reviewable Zork study appeared in January 2026, and there are at least four
hobby harnesses (zork-bench, Frotzmark and two blog series). Your **classic-game results duplicate that work**. They
also use weaker statistics and non-standard settings (150 turns, a 30-turn memory window, temperature 0.7, one run), so
nobody will cite them next to TALES or TextQuests.

Three things are genuinely distinctive:

- **A hosted, public, any-client game server** with open per-run data (CSV/JSONL export and transcripts). The other
  benchmarks are libraries you install, plus a leaderboard their authors curate.
- **Original games on your own engine,** where the engine reports the score itself.
- **Cost, tokens, effort, answer format and caching recorded on every run.** The academic benchmarks barely report cost.

The original-game idea is the right one, and others have reached it too: two independent bloggers built private games
for the same reason. But your version currently has serious validity problems:

- Only one original game separates models. That game, Skerrin Light, is already being won by Claude Haiku 5.5 at low
  effort once it gets 300 turns.
- Its full walkthrough and solution notes sit in a public GitHub repo.
- Your published rankings were taken at a 150-turn cap that mostly measures speed.

Fix those and it becomes a useful, distinctive benchmark: a live, contamination-resistant, cost-aware one. Leave them
and it is another Zork harness.

---

## 2. The landscape, verified

### 2.1 Benchmarks and harnesses

| Benchmark | What's played | Scaffold / memory | Scoring | Contamination stance | Top results (as found) | Maintained? |
|---|---|---|---|---|---|---|
| **Jericho** (2019, AAAI 2020) | 57 human-written Z-machine games ([game list](https://github.com/BYU-PCCL/z-machine-games/tree/master/jericho-game-suite)), including zork1, advent, balances, curses, detective and lostpig | A Gym-style library. Optional "handicaps": fixed seed, save/load, templates, object tree, valid-action detection ([paper](https://ar5iv.labs.arxiv.org/html/1909.05398)) | The game's own score, read from the interpreter | Not addressed (pre-LLM) | RL baselines: DRRN 10.7% normalized average, Zork I 32.6/350 | Library maintained, v3.3.1 latest ([releases](https://github.com/microsoft/jericho/releases)) |
| **TALES** (Microsoft et al., 2025) | 122 games: TextWorld, TextWorld Express, ALFWorld, ScienceWorld and Jericho (55 IF games) ([site](https://microsoft.github.io/tale-suite)) | Zero-shot. Observations go in as user turns and history grows. **100-step cap** ([paper](https://arxiv.org/html/2504.14128v4)) | Normalized game score. The leaderboard uses the **highest score reached** in the run ([HF card](https://huggingface.co/datasets/PEARLS-Lab/TALES-Trajectories/blob/main/README.md)) | Authors "very strongly suspect" Zork I playthroughs are in training data ([paper](https://arxiv.org/html/2504.14128v4)) | Jericho 15.7% for o3 (medium) on the site. Claude Opus 4.5/4.6 (high) reach 16.2-16.8% on the HF card. Synthetic suites 88-100% | Leaderboard updated in 2026 on HF. Repo active ([GitHub](https://github.com/microsoft/tale-suite)) |
| **TextQuests** (CAIS, 2025) | 25 Infocom games ([paper v2](https://arxiv.org/html/2507.23701v2)) | No tools. **Full history, no truncation** (>100K tokens, cached). Restore-to-any-step allowed. 500-step cap | Max percentage of hand-labelled checkpoints reached, plus a "harm" score | Uses public classics. Epoch: 100% of tasks and solutions public | No clues: GPT-5 37.8%, Claude Opus 4.1 33.9%. With InvisiClues: GPT-5 71.2% ([paper v2](https://arxiv.org/html/2507.23701v2)) | Epoch rated it **"Flawed"** on 2026-08-10 ([review](https://epoch.ai/benchmarks/textquests/review)). Live leaderboard could not be read |
| **Gerrits, "Playing With AI"** (Jan 2026) | Zork I only ([arXiv 2602.15867](https://arxiv.org/html/2602.15867)) | Python script relays game output to the chatbot. Minimal vs manual-based prompt. Thinking on/off. 500 moves | Game score /350 | Acknowledged, not controlled | Best was Claude Opus 4.5, about 75/350. All models averaged <10% | One-off paper |
| **zork-bench** (J. Aiken, Apr 2026) | Zork I by default. Docker image ships 40 Infocom titles ([repo](https://github.com/mnky9800n/zork-bench)) | Tools: `record_room`, `look_up_room`, `find_path` (BFS), `add_note`, `update_inventory`. Map modes none/explore/full. 200 turns by default | Rooms, treasures, score, turns to first death | Plans fact-altering variants ([post](https://www.lowimpactfruit.com/p/zork-bench-an-llm-reasoning-eval)) | No score table. Charts only | Reported dormant since about April 2026 ([LessWrong comments](https://www.lesswrong.com/posts/rWiXxHGggxZKxyGEq/claude-opus-5-just-beat-my-text-based-adventure-game)) |
| **Frotzmark** (hobby, 2025-26) | Zork I ([repo](https://github.com/Pondsiders/Frotzmark)) | No tools. Effort/temperature/seed knobs via OpenRouter | Game score | Not addressed | GPT-5: 92 (minimal effort) vs 44 (low effort), apparently single runs | Small, research code |
| **BALROG** (ICLR 2025) | BabyAI, Crafter, TextWorld, Baba Is AI, MiniHack, NetHack ([arXiv](https://arxiv.org/html/2411.13543v1)) | Standard agent prompt. Long context | % progress, with ± error bars | Procedural environments | GPT-6-Astra-Max 68.3 ± 2.0 overall. Latest entry dated 2026-09-20 ([site](https://balrogai.com/)) | **Active, weekly updates** |
| **TextArena** (2025) | 57-74 competitive games: logic, board, social ([arXiv](https://arxiv.org/html/2504.11442v1)) | Model vs model | TrueSkill | Mostly procedural | Live leaderboard (not checked in detail) | Active (per paper) |
| **AgentBench** (2023) | 8 environments, three of them text-game-like: ALFWorld household, lateral-thinking puzzles, digital card game ([repo](https://github.com/THUDM/AgentBench)) | Multi-turn agent | Task success | n/a | Leaderboard is a Google Sheet. Last news 2025-10 | Slow |
| **Private hand-made games** (derelict5432 / Derek James, 2026) | One 10-room original dungeon each, kept private ([LessWrong](https://www.lesswrong.com/posts/rWiXxHGggxZKxyGEq/claude-opus-5-just-beat-my-text-based-adventure-game), [Substack](https://derekjames.substack.com/p/text-adventure-benchmarks-revisited)) | Heavy scaffold: map, hypotheses, causal map | Solved or not | Private by design | **Claude Opus 5 solved it in 76 turns (48 optimal). The author declared it saturated in Aug 2026** | Abandoned after saturation |
| **Blog studies** (Bahgat, hamonk, 2026) | Zork I through Jericho, local models ([variance study](https://www.abahgat.com/blog/same-agent-different-score/), [maze post](https://dev.to/abahgat/stuck-in-the-maze-why-ai-agents-cant-hold-the-map-2fjm), [hamonk](https://hamonk.github.io/2026/02/18/zork.html)) | ReAct / MCP tools | Score | n/a | Gemma 4 26B scored 25, 25, 0, 40, 5 across five identical runs | One-offs |

Agent methods the ChatGPT report cites as "what worked":

| Method | What it is | Verified headline |
|---|---|---|
| CALM (EMNLP 2020) | An LM trained on human transcripts proposes actions and RL re-ranks them | 69% relative improvement over the previous state of the art on Jericho ([MSR](https://www.microsoft.com/en-us/research/?p=751255)) |
| Q\*BERT / MC!Q\*BERT (2020) | Knowledge-graph exploration that detects bottlenecks | First learning agent past the Zork grue bottleneck ([arXiv](https://arxiv.org/pdf/2006.07409)) |
| MPRC-DQN (EMNLP 2020) | IF framed as reading comprehension with object-centric retrieval | State of the art on 25 of 33 Jericho games ([arXiv](https://arxiv.org/pdf/2010.02386)) |
| ReAct (2022) | Interleaves reasoning and acting | ALFWorld with PaLM-540B: 71% best-of-6 (57% average) vs 45% act-only vs 37% BUTLER ([paper](https://ar5iv.labs.arxiv.org/html/2210.03629)) |
| Reflexion (2023) | Verbal self-reflection across trials | +22 points absolute on ALFWorld over 12 trials, 130/134 tasks ([paper](https://arxiv.org/html/2303.11366)) |
| ReflAct (EMNLP 2025) | Goal-state reflection | 93.3% on ALFWorld with GPT-4o ([arXiv](https://arxiv.org/abs/2505.15182v2)) |
| MC-DML (ICLR 2025) | LLM plus MCTS with in-trial and cross-trial memory | Matches or beats LLM/MCTS baselines on 8 of 9 Jericho games ([arXiv](https://arxiv.org/pdf/2504.16855)) |

### 2.2 The ChatGPT report, claim by claim

| Claim | Verdict | Notes |
|---|---|---|
| Jericho baselines: random 1.8%, NAIL 4.9%, TDQN 6.1%, DRRN 10.7%; Zork I DRRN 32.6, TDQN 9.9; several games zero for all | **Confirmed** | Five games zero for all agents. The paper text says 32 games but its table lists 33 ([paper](https://ar5iv.labs.arxiv.org/html/1909.05398)) |
| TALES: o3-medium 100 / 91.9 / 88.3 / 93.0 / 15.7%; frontier ~13-17% on Jericho | **Confirmed, missing context** | TALES caps runs at **100 steps**, and only **57% of Jericho's total score is reachable in 100 steps** even with the walkthrough (Zork I: 29.1%) ([paper](https://arxiv.org/html/2504.14128v4)). "16% of the max" is roughly 28% of what is reachable. Newer HF snapshot: Claude Opus 4.6 (high) 0.604 overall |
| TextQuests: 25 Infocom games, ≤500 actions, full history >100K tokens, checkpoints, with/without InvisiClues | **Confirmed** | It also allows restore to any step, which the report omits ([paper v2](https://arxiv.org/html/2507.23701v2)) |
| Epoch audit (Aug 2026): 100% public; 74/327 checkpoints (22.6%) flawed; Trinity 604-step walkthrough vs 500 cap; feelies missing | **Confirmed** | Also: one run per model (Epoch recommends ≥5), and checkpoint detection is text string-matching ([review](https://epoch.ai/benchmarks/textquests/review)) |
| Gerrits 2026: Zork I, Claude Opus 4.5 ~75/350, <10% average, no gain from detailed instructions or extended thinking | **Confirmed** | The paper's run count is internally inconsistent: it says "40 runs" for a design that implies 60 ([arXiv](https://arxiv.org/html/2602.15867)) |
| zork-bench: tools `record_room`, BFS pathfinding, notes; no/self-built/preloaded map | **Confirmed** | ([repo](https://github.com/mnky9800n/zork-bench)) |
| zork-bench is "active" with a "growing Infocom set" | **Corrected** | The image ships 40 Infocom titles, but the work is Zork-I-centric, has no leaderboard and was reported dormant since about April 2026 |
| zork-bench: "self-built map beats full map"; "more tokens per turn doesn't monotonically help" | **Unverifiable** | The post says only that the full map produced "wide disparity", possibly due to token cost. Neither claim appears as stated |
| CALM +69% relative; Q\*BERT/MC!Q\*BERT first past the grue; MPRC-DQN; KG-A2C | **Confirmed** | See the table above |
| ReAct 71% vs 45% act-only vs 37% BUTLER, PaLM-540B | **Confirmed** | 71% is best-of-6. The average is 57% |
| Reflexion +22 points on ALFWorld | **Confirmed** | Over 12 trials |
| ReflAct 93.3% on ALFWorld | **Confirmed** | GPT-4o |
| MC-DML at ICLR 2025 | **Confirmed** | |
| "Jericho seed policy matters (4.0 stochastic default)" | **Wrong or unverifiable** | No Jericho 4.0 exists (latest is 3.3.1). The original paper ran **unseeded**, and only a few games (Zork I, Anchorhead) are stochastic. TALES gives each model its own 5 seeds, so seeds differ across models |
| "More chain-of-thought does not reliably help" | **Contested, not settled** | Gerrits and Frotzmark found no gain or a loss. TextQuests found more test-time compute "generally" helps, with diminishing returns. TALES found mixed effects by environment |
| "A precomputed map does not reliably help"; "admissible-action oracles create misleading progress" | **Weakly supported** | Only the zork-bench blog speaks to maps. Jericho asks authors to report handicaps, but no source opened here measured "misleading progress" |
| TextWorld (2018), ALFWorld, ScienceWorld, TWX dates | **Not re-checked** | Well established; low risk |

What the report missed: BALROG (active, with error bars), Frotzmark (effort hurt Zork), Bahgat's variance study, and the
two private-game efforts that were **saturated by Claude Opus 5 within months**. That last point is directly relevant
to your plan.

---

## 3. Grue + Brass Lantern vs the field, dimension by dimension

| Dimension | Verdict | Why |
|---|---|---|
| Game sources and contamination | **Ahead in idea, behind in execution** | See 3.1 |
| Scoring method | **Ahead of TextQuests, on par with Jericho/TALES** | See 3.2 |
| Turn budgets | **Behind** in the published results | See 3.3 |
| Memory / history | **Different, not comparable** | See 3.4 |
| Scaffolding / tools | **Behind as a research axis, fine as a baseline** | See 3.5 |
| Effort, cost and time reporting | **Ahead** | See 3.6 |
| Repeat runs and variance | **Behind** | See 3.7 |
| Openness | **Clearly ahead** | See 3.8 |
| Provider neutrality | **Ahead, with confounds** | See 3.9 |

### 3.1 Game sources and contamination

You split the games into originals (Lantern Lane, Skerrin Light) and classics tagged `memorization-risk`. That is a
better stance than TextQuests (all public) or TALES (contamination acknowledged, not handled).

**Execution falls short in three ways:**

- **The solutions are public.** `games/src/skerrin-light/walkthrough.txt` and `NOTES.md` (map, puzzle logic, scoring
  table) are in `herzigma/grue`, a **public** GitHub repo (`gh repo view` confirms it). So is the game's JS source,
  which encodes every puzzle. Any crawl after publication can include the full solution. Today the games are
  "memorization-free". Over a model generation or two, they won't be.
- **There is effectively one test game.** Lantern Lane is a smoke test: every working model wins it in about 30 turns.
- **Skerrin Light is close to saturation.** In the running Haiku 5.5 sweep at its 300-turn limit, Haiku won it 50/50 at
  low effort (254 turns) and at xhigh (253), and scored 41 at medium and high. That is the cheapest Claude model. The
  private-game bloggers saw the same pattern: a small hand-made game lasts months, not years.

### 3.2 Scoring method

For classic games Grue takes the game's own score. It tries the status line first, then score sentences in the text,
then "+N points" deltas (`lib/parse.js`). For Z-machine v3 games like Zork I, the interpreter itself draws the status
line from game variables, so this is close to reading interpreter state. For native games the engine writes the
status line, so the score is authoritative.

That beats TextQuests, whose checkpoint string-matching Epoch found wrong on 22.6% of checkpoints. It is roughly on par
with Jericho/TALES, which read the score from interpreter memory.

The weaker parts are the heuristics around the score:

- **Endings** are detected from `*** ... ***` banners followed by a RESTART/RESTORE/QUIT question. "Won" is inferred
  from banner words or `score >= max_score`.
- **Invalid commands** are matched against a fixed list of Infocom and Inform phrasings (see section 4).
- **Brass Lantern ranks on the final score, not the peak.** TALES uses the highest score reached and TextQuests the
  highest checkpoint. Grue stores both (`score` and `max_score_reached`), but the leaderboard uses `score`. In games
  where a death costs points (Zork I), your numbers will read lower than theirs for the same play.

### 3.3 Turn budgets

The published 2026-11-13 results ran everything at **150 turns**. The catalog's suggested limits are 300 for Skerrin
Light and Lost Pig, and 600 for Zork I. The results note itself says Sonnet and Gemini "were still scoring in their last
five turns".

The Haiku sweep shows how much this matters:

| Haiku 5.5 on Skerrin Light | Turn cap | Score |
|---|---|---|
| 2026-11-13 results, low effort via OpenRouter | 150 | 19, 19, 21 |
| Haiku effort sweep, low effort via Anthropic direct | 300 | 50 (won) |

That rerun also changed provider route and temperature, so it isn't a clean A/B, but the size of the jump is hard to
explain any other way. At 150 turns, the head-to-head ranking (Haiku 7th of 9) mostly measures how fast a model scores,
not whether it can solve the game.

For reference, TALES uses 100 steps but publishes how much score a perfect player can reach in that budget.
TextQuests and Gerrits use 500. Epoch criticised TextQuests because its 500-step cap is shorter than one game's
walkthrough (Trinity, 604 steps). You have the same problem in a stronger form: a cap below what decent models need.

### 3.4 Memory and history policy

Brass Lantern shows the model **the last 30 turns** (30-39 with cache stepping), with past reasoning trimmed to about
300 characters, and **no notes by default**. TextQuests keeps the full history. TALES grows the history. Gerrits and
Frotzmark appear to pass the whole conversation.

Your default is a defensible, cheaper "bounded memory" condition, but it is a different test. On Zork I or Lost Pig,
the model forgets the map after 30 moves. So a low score measures memory loss as much as reasoning, and your numbers
can't be set beside the full-history ones.

You already have the knobs (`--history`, `--notes`). What's missing is reporting memory as an explicit, named condition.

### 3.5 Scaffolding and tools

There is one `act` tool or a `> COMMAND` line, plus an optional notes scratchpad. No map tool, no restore, no
valid-action list. That is a clean minimal baseline, close to TextQuests' "no tools" setup. It is less than zork-bench
(map + BFS + notes) and less than the restore-anywhere feature TextQuests gives.

That's fine as a baseline. As a research axis, the field is ahead of you on tool conditions, but nobody has settled
them either.

### 3.6 Effort, cost and time reporting

Every run records the effort sent, answer format, caching, cache hit rate, input/output/cache tokens, cost, wall time
and model time. It all goes into a 36-column public export.

TextQuests reports tokens and cache hit rates. TALES and the Zork papers report no cost at all. **Cost per point and
time per point are where you are genuinely ahead.** Two small caveats:

- Some costs come from a user-supplied price file. The sweep shows `cost_source: "prices"`, not the provider's bill.
- Effort labels are not comparable across vendors. OpenRouter's `reasoning.effort`, Anthropic's `output_config.effort`
  and OpenAI's `reasoning_effort` are different dials.

### 3.7 Repeat runs and variance

The published results use n=1 for frontier models and n=3 for budget models on Skerrin Light only. They report means,
with no spread, intervals or significance test. Gemini Flash Lite scored 23, 30 and 41 on identical settings. Ranks 4
through 8 in your head-to-head table (81% down to 69%) are within that spread.

TALES uses 5 game seeds and BALROG reports ± error bars. Epoch's rubric asks for at least 5 runs. Bahgat's study saw one
model score 0 to 40 on Zork I across five runs. You are behind the better practice, though level with TextQuests and
Gerrits.

### 3.8 Openness

Nothing else in this survey offers all of these together:

- a live hosted server (REST, WebSocket and TCP) that any client can play;
- per-run transcripts;
- a public CSV/JSONL export;
- a client-side cost report attached to the server's result.

TALES, TextQuests, Jericho and zork-bench are code you run yourself, and their leaderboards are curated by the authors.

**This is your most distinctive asset.** It has a matching risk. The model name and settings in `meta` are
self-reported by the client, and anyone with a key can post a run, including a walkthrough replayer labelled with any
model name. If the public leaderboard is meant to be trusted, it needs a "verified" tier.

### 3.9 Provider neutrality

Brass Lantern supports any provider (direct APIs or OpenRouter) and handles each one's quirks for temperature, effort
and tool calls. It records what was actually sent. That's ahead of most hobby harnesses, which are tied to one SDK.

The cost of neutrality is confounds:

- **Temperature isn't uniform.** The published table sent temperature 0.7 through OpenRouter to every model. Direct
  Anthropic runs send none, and reasoning models ignore it.
- **Rows aren't comparable across routes.** OpenRouter vs direct changes routing, caching and sometimes the effort
  mapping.

You record all of this, which is good, but the published tables mix these settings without flagging it.

---

## 4. Validity risks specific to your current setup

1. **The turn cap is the dominant variable** in the published rankings (section 3.3). The headline table can't
   separate "slower" from "worse".

2. **There is one discriminating original game, and it is nearly saturated.** Skerrin Light has 17 rooms, 22 scored
   steps and a 76-move optimal solution. A low-effort budget model already wins it at 300 turns.

3. **The original games' solutions are public** on GitHub (walkthrough, NOTES.md and the game source). The
   "memorization-free" property has a shelf life that started the day the repo went public.

4. **Overall scores are averaged across games,** and Lantern Lane (100% for 8 of 9 models) is weighted equally:

   - In the head-to-head table it is half the "Overall" column, which halves every real difference.
   - In the budget table it is a quarter of the score.
   - Zork I compresses every model into 11-15%.

   So most of the "Overall" signal comes from one game.

5. **Final score vs peak.** You rank on the final score, while TALES and TextQuests use the peak. A Zork I death after
   scoring lowers your number but not theirs.

6. **Invalid-command detection depends on the game.** `isInvalidCommandResponse` only knows Infocom, Inform and native
   phrasings. Lost Pig uses its own voice. In the Haiku low-effort Lost Pig run, "Grunk not see that there." appears 5
   times, yet `invalid_commands` is **0**. Invalid % is therefore not comparable across games, and on Lost Pig it is
   simply wrong.

7. **Ending and win detection is heuristic.** It relies on banner regexes, a RESTART/RESTORE/QUIT question, and banner
   keywords or `score >= max_score`. That suits Inform games. Games without banners end as `ended` or `turn_limit`, so
   the win rate is only meaningful on games you have checked by hand.

8. **The 30-turn window without notes** makes long games a memory test (section 3.4). Effort comparisons on Zork I and
   Lost Pig are partly comparisons of how well a model plays while forgetting.

9. **Settings are confounded across tables.** These differ between the 9-model table and the Haiku sweep:

   - temperature (0.7 vs none);
   - provider route (OpenRouter vs direct);
   - turn cap (150 vs 300);
   - max tokens.

   The effort sweep's partial results are not monotonic. Skerrin went 50, 41, 41, 50 from low to xhigh, and Lost Pig
   3, 2, 2. With one run per cell that is noise until shown otherwise. Frotzmark saw *lower* Zork scores at higher
   effort, also on single runs.

10. **The sample is small.** n=1 to 3 per cell, no intervals, and rankings presented as ordered lists.

11. **Unverified submissions.** The public leaderboard accepts self-described runs (section 3.8).

12. **Classic-game versions differ from the references.** Grue's `zork1.z3` comes from historicalsource. Jericho uses
    `zork1.z5`, and TextQuests uses its own files. Small release differences matter if you claim comparability.

---

## 5. Recommendations, ranked by impact per effort

| # | Recommendation | Effort | Why |
|--:|---|---|---|
| 1 | **Never publish at a cap below the game's suggested limit.** Report score-by-turn curves (score at turns 50, 100, 150, 300 and area under the curve) from the per-turn scores you already log. Re-run the head-to-head at 300 | **cheap** | Turns your biggest validity hole into a distinctive metric, exploration efficiency, without new runs for the curve itself |
| 2 | **Move walkthroughs, NOTES.md and future original game sources out of the public repo.** Keep a public dev set and a private held-out set served only by grue.party. Add a canary string to anything public | **cheap** (repo hygiene); **moderate** for a private game-loading path | Otherwise "memorization-free" expires. Treat Skerrin Light as a public dev game from now on |
| 3 | **Build harder originals, and make the engine generate variants.** Randomize names, room layout, codes and item placement per seed from one puzzle graph, so each run gets a fresh instance | **big** | One small game is saturated within months (derelict5432's experience matches yours). Seeded variants give many test instances per authored game and defeat memorization structurally. No benchmark surveyed here does this for IF; TextWorld does it only for synthetic cooking games |
| 4 | **At least 5 runs per published cell. Report mean ± 95% CI (or min-max) and don't order models whose intervals overlap** | **cheap** in code, moderate in API spend (still a few dollars at budget prices) | Meets Epoch's bar and BALROG's practice. Ranks 4-8 today are noise |
| 5 | **Drop Lantern Lane from the overall score** (keep it as a pass/fail smoke test). Report per-game results first and the overall second | **cheap** | Stops a saturated game diluting every comparison |
| 6 | **Pin settings per published table:** temperature none (or 0) everywhere, one provider route per table, and a column for effort as sent | **cheap** | Removes the confounds in section 4.9 |
| 7 | **Report peak and final scores side by side.** Use peak when comparing with TALES/TextQuests | **cheap** | Grue already stores both |
| 8 | **Fix or label invalid-command detection.** Add per-game patterns to the catalog (e.g. Lost Pig's "Grunk not ..."), or mark invalid % as "Inform/Infocom phrasing only" | **cheap** | The metric is currently wrong on at least one catalog game |
| 9 | **Run a "comparability" bench and publish it once.** (a) TALES-style: the 6 games Grue shares with Jericho (zork1, advent, balances, curses, detective, lostpig), 100 steps, full history, peak score, 5 runs. (b) TextQuests/Gerrits-style: Zork I, 500 steps, full history, no tools | **moderate** | If your harness reproduces their numbers on the same models, your original-game numbers inherit credibility. That's what makes them citable alongside TALES/TextQuests. Note that TextQuests also allows restore, which Grue doesn't |
| 10 | **Make memory an explicit axis:** window 30 vs full history vs window 30 + notes, at matched token budgets | **moderate** | You already have the knobs. "How much does bounded memory cost, and what does it save?" is a question your cost tracking answers well and the field hasn't |
| 11 | **Add a "verified" tier to the leaderboard:** runs from your own keys, or from known harness versions, kept separate from open submissions | **moderate** | Protects the public leaderboard, your most distinctive asset |
| 12 | **Lead with what's distinctive:** live hosted server, open data, cost per point, original games. Present Zork I and the other classics as calibration only | **cheap** | Your classic-game numbers duplicate existing work. Your positioning should not rest on them |

---

## 6. Open questions

- **Current TextQuests leaderboard.** The textquests.ai and Hugging Face Space pages didn't render their tables, so
  only the paper's August 2025 numbers are cited. Whether CAIS fixed the Epoch findings is unknown.
- **TALES history policy.** The paper implies a growing history but doesn't say whether it is full or truncated. The
  leaderboard's step cap for newer models (2026 entries) isn't stated on the HF card.
- **Gerrits' interface.** The paper doesn't say clearly whether it used chat UIs or APIs, and its run count is
  inconsistent. Treat it as directional.
- **zork-bench activity.** Repo signals (48 commits, no dates visible) neither confirm nor refute the "dormant since
  April" comment.
- **Whether Grue's win detection works on every catalog game.** Only the native games and banner-style Inform endings
  are clearly covered. Zork I's actual win ending was not checked here.
- **Whether the effort sweep shows a real effect.** That needs at least 5 runs per effort level. The partial data
  can't say.
- **Cost accuracy** for runs costed from a local price file rather than the provider's reported cost.
