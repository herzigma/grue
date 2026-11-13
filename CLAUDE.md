# CLAUDE.md -- Agent Guide for Grue

You are connected to **Grue**, an interactive fiction server. Your job is to play a text adventure by
sending valid parser commands, one at a time, and to score as many points as you can before the game or
turn limit ends. Everything you need is below; the formal spec is `docs/PROTOCOL.md`.

## Connect (pick one)

### REST (preferred)

```bash
# 1. What can I play?
curl -s localhost:8081/api/games

# 2. Start a session. The reply is the first observation; keep its session_id.
curl -s -X POST localhost:8081/api/sessions -H 'Content-Type: application/json' \
  -d '{"game":"zork1","meta":{"agent":"claude-code"}}'

# 3. Play, one command per request.
curl -s -X POST localhost:8081/api/sessions/SESSION_ID/commands -H 'Content-Type: application/json' \
  -d '{"command":"open mailbox"}'

# 4. Stop early (returns your final result).
curl -s -X DELETE localhost:8081/api/sessions/SESSION_ID
```

If the server needs a key, add `-H 'Authorization: Bearer YOUR_KEY'` to every `/api` request.

Each reply is an observation:

| Field | Meaning |
|---|---|
| `text` | what the game just printed (read all of it) |
| `location`, `score`, `max_score`, `moves` | parsed from the status line; `null` if unknown |
| `turn` | commands processed so far; the session ends at `max_turns` |
| `input_type` | `"line"` for a normal command, `"char"` for a single keypress (see below) |
| `game_over`, `ending` | `true` plus `won`, `died`, `ended`, `turn_limit`, `quit`, `timeout`, `crashed`, `aborted` |
| `notice` | a message from the server about your last input; always read it |

Errors are `{"error": "<code>", "message": "..."}`. Common ones: `game_over` (409, start a new session),
`command_too_long` (max 256 characters), `too_many_sessions` (429, wait and retry), `unknown_session` (404).

A session with no commands for 10 minutes is ended with `timeout`.

### Legacy text mode

```bash
nc localhost 8080
```

You see a game list; answer with a number (or the game id). Then each line you send is one command, and
the reply is the game text plus a footer like `[Location: West of House | Score: 0/350 | Moves: 0 | Turn: 0]`
and a `> ` prompt. The connection closes when the game ends. The same works over a plain WebSocket at
`ws://localhost:8081/`. Saving is not available in any mode.

## How to play interactive fiction

The parser understands short imperative English commands.

### Core commands
- `look` (`l`): describe the room again
- `inventory` (`i`): list what you carry
- `examine [thing]` (`x [thing]`): look closely at something
- `n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`, `up`, `down`, `in`, `out`: move (`go north` also works)
- `take [thing]`, `take all`, `drop [thing]`
- `open [thing]`, `close [thing]`, `unlock [thing] with [key]`
- `read [thing]`, `search [thing]`, `push/pull/turn [thing]`
- `put [thing] in/on [thing]`, `give [thing] to [person]`
- `ask [person] about [topic]`, `tell [person] about [topic]`
- `wait` (`z`), `again` (`g`), `undo`, `score`
- Do not use `save`/`restore`: the server cancels the prompt.

### Rules that matter
1. **One command per turn.** `go north, then take the lamp` is invalid; send them separately.
2. **Imperative mood.** `open the door`, not `I would like to open the door`.
3. **Be specific.** When several objects match, name one: `take the red key`.
4. **Explore methodically.** `look` in new rooms, `examine` every noun the room mentions, read signs and books.
5. **Map as you go.** Note exits and what lies beyond them.
6. **Watch the score.** It tells you which actions mattered. Peak score is recorded, but the final state counts too.
7. **Parser errors still cost a turn.** "I don't know the word", "I didn't understand that sentence" and
   "You can't see any such thing" are counted as invalid commands. Use the verbs the game uses.

Mistakes to avoid: explaining your reasoning inside the command, sending sentences, repeating the same failed
command, inventing objects that were never mentioned.

### Single-keypress mode (`input_type: "char"`)
Menus and "press any key" screens want one key, not a line. When `input_type` is `"char"`, your `command` is
read as one keypress:

- named keys: `return` (or `enter`), `space`, `escape`, `up`, `down`, `left`, `right`, `pageup`, `pagedown`,
  `tab`, `delete`. A leading backslash is optional (`\enter` works too).
- a single character such as `q`, `n` or `1`.
- an empty command sends `return`.

If you send a longer string, only its first character is used and `notice` says so. Do not send words like
`talk salesman` here; send the key that the menu text tells you to press (for example `q` to quit a menu).
Pressing a key counts as a turn.

## Strategy
1. Score comes from solving puzzles and collecting treasures. Pick up what is portable and look for what is not.
2. In the dark, find a light source before moving more than one room; otherwise you may be eaten by a grue.
3. If stuck, `examine` everything again, try every exit, and reread the last room description for details.
4. A death is not always the end (some games reincarnate you), but it usually costs points. Avoid obvious risks.
5. You have a turn budget (`max_turns`). Do not waste turns on `look` and `inventory` more than needed.
