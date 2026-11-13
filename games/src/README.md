# Original games for Grue

These games are original works written for Grue's native engine (`lib/native/`). They are not derived from any
existing game. Both are released under the MIT License, copyright (c) 2026 Joshua Herzig-Marx.

| Id | Title | Difficulty | Max score |
|---|---|---|---|
| `lantern-lane` | Lantern Lane | tutorial | 10 |
| `skerrin-light` | Skerrin Light | medium | 50 |

The playable game files live in `games/original/`. This folder holds the material that is not served to players:

* `<id>/walkthrough.txt`: one command per line, reaching the maximum score and the win.
* `<id>/NOTES.md`: spoilers: map, puzzle list, solution logic, scoring table, optimal move count.
* `verify.mjs`: loads each game through the engine, replays its walkthrough and asserts the win banner, the maximum
  score and the absence of parser failures (`That's not a verb I recognise.`, `You can't see any such thing.`,
  `I didn't understand that sentence.` and friends).

```
node games/src/verify.mjs        # replay both walkthroughs
node --test test/native/         # engine, world, walkthrough and robustness tests
```

To write a new game, see `lib/native/AUTHORING.md`. Add its walkthrough and register it in `verify.mjs`.
