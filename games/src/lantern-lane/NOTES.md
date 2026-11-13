# Lantern Lane: designer notes (SPOILERS)

Tutorial game, id `lantern-lane`, native format, `games/original/lantern-lane.js`.
Five rooms, max score 10, near-optimal solution 22 commands (`walkthrough.txt`).

## Map

```
Lamplight Square
      |
Lantern Lane (Bram, ladder)
      |
Pell's Doorstep --in--> Lamplighter's Kitchen --down--> Cellar (dark)
```

## Puzzles and solution logic

| # | Puzzle | Solution | Points (key) |
|---|---|---|---|
| 1 | Hidden key | `look under flowerpot` (also lift, move, search the pot), `take key` | 1 (`key`) |
| 2 | Locked front door | `unlock door` (implicit key), the door opens as you walk in | 1 (`door`) |
| 3 | Clue by reading | `read note` on the kitchen table: names the oil, the lantern, the matches and Bram's price | 1 (`note`) |
| 4 | Light source | `take matchbox`, `take lantern`, `light lantern` | 1 (`lantern`) |
| 5 | Dark room | Cellar is dark; with the lit lantern `take can` | 1 (`can`) |
| 6 | NPC trade | `open tin`, `take biscuit`, `give biscuit to bram`, then `take ladder` | 2 (`bram`) |
| 7 | Fill the lamp | In the square `drop ladder` (it props itself against the post), `fill lamp` | 1 (`fill`) |
| 8 | Light the lamp | `light lamp` (needs a flame: lit lantern or the matchbox) and the game is won | 2 (`light`) |

Total: 1 + 1 + 1 + 1 + 1 + 2 + 1 + 2 = 10.

## Red herrings and safety

No red herrings, no deaths, no unwinnable states (the box holds unlimited matches; nothing is consumed except the biscuit).
Alternatives understood: `pour can into lamp`, `put oil in lamp`, `use can on lamp`, `light lamp with lantern`.
