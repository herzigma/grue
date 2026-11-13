# Original games for Grue

These games are original works written for Grue's native engine (`lib/native/`). They are not derived from any
existing game. Copyright (c) 2026 Joshua Herzig-Marx.

| Id | Title | Difficulty | Max score | Where |
|---|---|---|---|---|
| `lantern-lane` | Lantern Lane | tutorial | 10 | public: `games/original/`, MIT License |
| `skerrin-light` | Skerrin Light | medium | 50 | held out: sealed in `games/sealed/`; source and walkthrough in the private games repo |

This folder holds the material for public games that is not served to players:

* `<id>/walkthrough.txt`: one command per line, reaching the maximum score and the win.
* `<id>/NOTES.md`: spoilers: map, puzzle list, solution logic, scoring table, optimal move count.
* `verify.mjs`: loads each game (held-out ones too, from `GRUE_PRIVATE_DIR`) through the engine, replays its walkthrough and asserts the win banner, the maximum
  score and the absence of parser failures (`That's not a verb I recognise.`, `You can't see any such thing.`,
  `I didn't understand that sentence.` and friends).

```
node games/src/verify.mjs        # replay the walkthroughs (set GRUE_PRIVATE_DIR for held-out games)
node --test test/native/         # engine, world, walkthrough and robustness tests
```

To write a new game, see `lib/native/AUTHORING.md`. A public game gets its walkthrough here and an entry in
`verify.mjs`; a held-out game lives in the private repo and is sealed (see the README, "Held-out games").
