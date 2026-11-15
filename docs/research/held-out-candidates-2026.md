# Held-out game candidates: 2026 parser releases

Compiled 2026-11-14 from two web surveys (IFComp 2026, and other 2026 comps plus standalone releases).
Nothing was downloaded or played yet: formats, file names and max scores come from IFDB, the IF Archive,
the IFComp 2026 Guidebook, reviews and David Welbourn's walkthroughs (plover.net). Every row needs checking in
Grue before use: does the file load, does the status line or SCORE report the score, is the max right.

## What "held out" can mean here

Almost every 2026 parser game has a public walkthrough, often from release day (in the comp zip, on
Welbourn's site, or in a forum thread). So none of these stays secret. They are held out only from models
whose training data ends before the game's release. Current Claude models stop at about June 2026, so a
game released from July 2026 on is clean for them and dirty for the next generation. Treat the ranked set
as a yearly rotation, and run a memorization probe (ask the model, without playing, to write the
walkthrough) before ranking any game against a newer model.

IFComp 2026 ran from 1 Sep to about 20 Oct 2026 (results 24 Oct): 71 entries, about 23 Grue-compatible.
ParserComp 2026 games went public about 28 to 30 Jun 2026, right at the cutoff edge.

## Tier A: released after the cutoff, compatible, fixed max score

| Game | Author | Released | File / system | Max score | Length, notes |
|---|---|---|---|--:|---|
| Bob The Barbarian | Charles Moore, Jr. | Sep 2026, IFComp | `BTB_260909.z5` (Dialog) | 220 | About 2 h, puzzle-heavy, reviewers stuck at 50/220. Random combat, so runs are not deterministic |
| Meet the timesheet | Zeno Pillan | Sep 2026, IFComp | `mtt260827.z8` (PunyInform) | 128 | About 1 h; easy and hard modes (pick one and fix it) |
| Tableaux Vivants | Lamp Post Projects | Sep 2026, IFComp (2nd) | Glulx (Inform 7) | 100 | About 85 min; light puzzles; built-in hints (check they can't be abused) |
| The Last Voyage of the Warsaw Queen | Charles M Ball | Sep 2026, IFComp | `.gblorb` (Inform 7) | 85 | About 95 min; a reviewer took 2 h and "barely finished" |
| Lucrum Sanguinis: The Quaestor's Legacy | Ichiro Ota | 1 Jul 2026 | `.z3` (Inform 6) | 99? | "A few hours", Infocom style. Max from one player comment, unconfirmed. Commercial ($2.99) |

Cutoff-edge, ParserComp 2026 (about 30 Jun): The Most Valuable Card in the World (DC and mathbrush,
`.gblorb`, max 100, large, timed sequences, about 10 failure endings) and Grand Island Bank Robbery
(mathbrush, `.gblorb`, max 8, 1 to 2 h). Strong games, but a model trained to end of June may have seen
them; probe first.

## Tier B: after the cutoff and promising, but no usable fixed score

These need another progress measure (Grue's peak score reads the status line), so they cannot be ranked
as-is: Ryan Veeder's Agatha Christie's the Murder on the Orient Express (IFComp, about 3.5 h, counts clues),
Galilee Bones and the Juggernaut of Jordan (Phil Riley, 2 h, puzzle-focused), Out by Midnight (Arthur
DiBianca, graded out of 10 items, no undo), Ruined Temple (TADS 3, 2 h), The Rat and Forensic Necromancy
(Daniel M. Stelzer; The Rat scores in open-ended dollars), Wyrmward and Vanyar (Johan Berntsson, `.z5`),
Go Hunting and Descent (Ryan Veeder), An Unlikely Demon (Charles Moore Jr., about 2 h), The Cursed Planet
(bdb-project; adapts a 1987 Italian game).

## Tier C: scored, but released before the cutoff (contamination risk)

Ransack! (Charles Moore Jr., TALP, Apr 2026, max 120), Our Lady of Thorns (Joel Burton, Spring Thing,
Apr 2026, max 55, about 3 h), Within the Woods (BrownPants, Jan 2026, max 24), GET MANIFE$TO (Matt Bee,
Jun 2026, max 1000). Usable as a contamination comparison against Tier A.

## Not usable in Grue

Menu or keypress driven (The Count and the Communist, Ultraviolent Unicorn Deathmatch of Destiny 4),
Å-code only (Ḫattušumna Laḫḫa), Adventuron or custom web engines (Wait-Our-Way Tower, Caribbean Nightmare,
Tomb Any-Too-Many, This Island is Trying to Kill You), executables and cartridge images. WITHOUT corporation
is Z-code but uses keypresses, deliberate crashes and reboots.

## Hosting and permission

No parser entry states a license. ParserComp entrants grant archiving and online play to the IF Technology
Foundation, and comp files sit on the IF Archive (some are geoblocked from the UK). Before hosting a game on
grue.party, ask its author. Charles Moore Jr. (improvmonster on itch.io) wrote three of the candidates;
mathbrush wrote two. Lucrum Sanguinis is paid: buy a copy, and ask before hosting it.
Contacts: itch.io pages (improvmonster, zeno-pillan, charlesmball, lamppostprojects, pixlitch, mathbrush),
intfiction.org handles, and author sites listed on IFDB.

## Next checks, per Tier A game

1. Download the story file from the IF Archive or itch.io into an isolated folder.
2. Load it in a local Grue; confirm the score parses and the max matches.
3. Memorization probe: ask each benchmark model for the walkthrough without playing; score its overlap with
   the real one.
4. One cheap run (Haiku, low effort) to check difficulty is not at the ceiling, as Skerrin Light was.

## Vetting results, 2026-11-14

All four IF Archive games load on grue.party straight from the IF Archive's unbox links (no download):

| Game | Story file URL | Max (SCORE) |
|---|---|--:|
| Bob The Barbarian | `https://unbox.ifarchive.org/0pjaj4ofv3/BTB_260909.z5` | 220 |
| Meet the timesheet | `https://unbox.ifarchive.org/1wn03y6bjc/mtt260827.z8` | 128 |
| Tableaux Vivants | `https://unbox.ifarchive.org/1roirbwtf8/Tableaux%20Vivants.gblorb` | 100 |
| The Last Voyage of the Warsaw Queen | `https://unbox.ifarchive.org/1j1k9bn0nn/The%20Last%20Voyage%20of%20the%20Warsaw%20Q.gblorb` | 85 |

Lucrum Sanguinis is not on the IF Archive (paid, itch.io only), so it was not tested.

Haiku 5.5 at low effort, 3 runs per game, 400-turn limit, `--max-score` given (Brass Lantern 81fe2be).
Total cost about $0.53, probes included.

| Game | Probe (3 of 3) | Mean peak | Best | Ending | Notes |
|---|---|--:|--:|---|---|
| Bob The Barbarian | negative | 9% (2 runs) | 40/220 | 1 died at turn 18, 1 turn limit | Haiku declines to guess the solution. Random combat |
| Meet the timesheet | negative | 66% | 90/128 | all 3 died (turns 71 to 138) | Haiku always chose EASY. Too easy for a frontier model; HARD may help |
| Tableaux Vivants | negative | 15% | 17/100 | all 3 turn limit | Steady, slow progress: good headroom |
| Warsaw Queen | negative | 31% (1 run) | 26/85 | turn limit | A second run's interpreter crashed at turn 6; it did not reproduce on replay of the same commands |

Three runs are excluded: one Bob and one Warsaw Queen run lost the connection at 21:50 UTC on our side (the
server kept answering), and the Warsaw Queen crash. Brass Lantern now excludes runs that end `crashed`, since
the interpreter dying is a harness fault, not the model's.

Takeaways:
- No game is memorized by Haiku; frontier models still need probing.
- Bob, Tableaux Vivants and Warsaw Queen leave large headroom at the cheap end. Meet the timesheet does not on EASY.
- These games end the session on death even though they offer UNDO, so a single mistake ends a run.
