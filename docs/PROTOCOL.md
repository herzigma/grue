# Grue Protocol v1

This is the contract between **Grue** (game server) and any client, including
**Brass Lantern** (the LLM benchmark client). Both projects implement against
this document. If code and this document disagree, fix one of them.

Grue exposes three interfaces on top of one session core:

| Interface | Default address | Audience |
|---|---|---|
| HTTP REST API (JSON) | `http://localhost:8081/api/...` | Programs, LLM harnesses, `curl` (primary) |
| WebSocket JSON | `ws://localhost:8081/ws/v1` | Streaming clients |
| Legacy text (TCP + WS) | `nc localhost 8080`, `ws://localhost:8081/` | Humans, simple agents |

All three share the same sessions, replay logs, results, and metrics.

---

## 1. Concepts

- **Game**: a story file (Glulx `.ulx/.gblorb`, Z-machine `.z3/.z5/.z8/.zblorb`, plus anything else
  emglken supports) with catalog metadata. Identified by a stable string `id` (slug), e.g. `zork1`.
- **Session**: one isolated interpreter process playing one game for one client.
  Identified by `session_id` (UUID).
- **Turn**: one command sent by the client and the game's response to it.
  `turn` = number of commands the game has processed so far (0 right after start).
- **Observation**: the server's report of game state after start or after each command.
- **Result**: the final record of a finished session, persisted to disk and listed on the leaderboard.

## 2. Game catalog object

```json
{
  "id": "zork1",
  "title": "Zork I: The Great Underground Empire",
  "author": "Infocom",
  "format": "zcode",
  "filename": "zork1.z3",
  "max_score": 350,
  "difficulty": "hard",
  "suggested_turn_limit": 600,
  "tags": ["classic", "memorization-risk"],
  "description": "The classic underground treasure hunt.",
  "license": "MIT",
  "available": true
}
```

- `format`: `"glulx" | "zcode" | "tads" | "hugo" | "adrift" | "unknown"`.
- `max_score`: integer or `null` if the game has no score.
- `difficulty`: `"tutorial" | "easy" | "medium" | "hard"` or `null`.
- `available`: false when listed in the manifest but the file is not downloaded yet.
- `games/games.json` is the manifest (array of these objects plus `url` and optional `sha256`).
  Files dropped into `games/` without a manifest entry are auto-listed with `id` = slugified
  filename and null metadata.

## 3. Observation object

```json
{
  "session_id": "6f1c...",
  "game_id": "zork1",
  "turn": 3,
  "text": "West of House\nYou are standing in an open field west of a white house...",
  "status_line": "West of House                    Score: 0        Moves: 3",
  "location": "West of House",
  "score": 0,
  "max_score": 350,
  "moves": 3,
  "input_type": "line",
  "game_over": false,
  "ending": null,
  "notice": null
}
```

- `text`: plain text of everything the game printed since the previous command (main/buffer
  windows only), with the echoed prompt (`>`) stripped from the end. Paragraphs separated by `\n`.
- `status_line`: raw text of the status (grid) window, whitespace-trimmed, or `null`.
- `location`, `score`, `moves`: best-effort parse (see §7). `null` when unknown.
- `max_score`: from catalog, or parsed from game text ("out of a possible N"), else `null`.
- `input_type`: `"line"` (normal command), `"char"` (single keypress expected: menus,
  "press any key"), or `null` (game is not accepting input, i.e. over).
- `game_over`: true once the session has ended for any reason. No further commands are accepted.
- `ending`: `null` while playing; otherwise one of
  `"won" | "died" | "ended" | "turn_limit" | "quit" | "timeout" | "crashed" | "aborted"`.
- `notice`: optional server message for the client (e.g. "Game expects a single keypress; sent 'l'.").

## 4. HTTP REST API

All bodies are JSON. Errors: non-2xx with `{"error": "<code>", "message": "<human text>"}`.
If the server is started with `GRUE_API_KEYS` (comma-separated), every `/api/*` request must send
`Authorization: Bearer <key>`; otherwise 401 `{"error":"unauthorized"}`.

| Method & path | Body | Response |
|---|---|---|
| `GET /health` | – | `{"status":"ok","version":"2.0.0","active_sessions":N}` |
| `GET /metrics` | – | plain-text metrics |
| `GET /api/games` | – | `{"games":[Game,...]}` |
| `GET /api/games/:id` | – | `Game` |
| `POST /api/sessions` | `{"game":"zork1","max_turns":500,"meta":{...}}` | 201 `Observation` (turn 0) |
| `POST /api/sessions/:id/commands` | `{"command":"open mailbox"}` | 200 `Observation` |
| `GET /api/sessions/:id` | – | `{"session":SessionSummary,"observation":Observation}` (last obs) |
| `DELETE /api/sessions/:id` | – | 200 `Result` (ends with `ending:"aborted"` if still running) |
| `GET /api/sessions` | – | `{"sessions":[SessionSummary,...]}` (active only) |
| `GET /api/results` | query: `game`, `limit` | `{"results":[Result,...]}` newest first |
| `GET /api/results/:id` | – | `Result` |
| `GET /api/results/:id/transcript` | – | `{"entries":[ReplayEntry,...]}` |
| `GET /` | – | HTML dashboard (games, live sessions, leaderboard, transcript viewer) |

Notes:
- `max_turns` optional; default = game's `suggested_turn_limit`, else server `DEFAULT_MAX_TURNS` (1000).
  When `turn` reaches `max_turns`, the observation for that command has `game_over:true, ending:"turn_limit"`.
- `meta` is free-form JSON (≤ 4 KB) the client attaches, e.g.
  `{"agent":"brass-lantern/0.2.0","model":"openrouter:anthropic/claude-haiku-4.5","run_id":"..."}`.
  It is copied verbatim into the Result.
- A command is processed when the game asks for input again (or exits). The server waits up to
  `COMMAND_TIMEOUT_MS` (default 10 000) for the game to respond; on timeout it returns what it has
  with `notice` set. If the interpreter dies, `ending:"crashed"`.
- Commands: max 256 chars (`400 command_too_long` beyond). Empty string is allowed (sends a blank line).
- Commands to a finished session: `409 {"error":"game_over"}`. Unknown session: `404`.
- Errors codes: `bad_request`, `unknown_game`, `game_unavailable`, `unknown_session`, `game_over`,
  `command_too_long`, `too_many_sessions` (429), `unauthorized` (401), `internal`.

### Char-input mode

When `input_type` is `"char"`, the command is interpreted as one keypress:
- special names (case-insensitive, with or without leading `\`): `return`/`enter`, `space`,
  `escape`/`esc`, `up`, `down`, `left`, `right`, `pageup`, `pagedown`, `tab`, `backspace`, `delete`;
- empty string → `return`;
- otherwise the first character of the command; `notice` tells the client what was sent.
A keypress counts as a turn.

## 5. SessionSummary and Result

```json
SessionSummary = {
  "session_id": "...", "game_id": "zork1", "started_at": "ISO-8601", "turn": 12,
  "max_turns": 500, "score": 10, "max_score": 350, "game_over": false, "ending": null,
  "meta": {...}
}

Result = SessionSummary + {
  "ended_at": "ISO-8601",
  "duration_ms": 123456,
  "invalid_commands": 3,        // commands the game rejected (see §7 parser-failure heuristics)
  "unique_locations": 9,        // distinct `location` values seen
  "max_score_reached": 15,      // highest score observed during play
  "transcript": "replays/<file>.jsonl"
}
```

`score` in the Result is the final observed score; `max_score_reached` is the peak.
Results are persisted as `results/<session_id>.json`.

## 6. WebSocket JSON (`/ws/v1`)

Client → server messages and the server reply:

| Client sends | Server replies |
|---|---|
| `{"type":"list_games"}` | `{"type":"games","games":[...]}` |
| `{"type":"start","game":"zork1","max_turns":500,"meta":{}}` | `{"type":"observation", ...Observation}` |
| `{"type":"command","command":"look"}` | `{"type":"observation", ...Observation}` |
| `{"type":"end"}` | `{"type":"result", ...Result}` then close |

Errors: `{"type":"error","error":"<code>","message":"..."}`. One session per socket; closing the
socket aborts the session.

## 7. Parsing heuristics (server side)

- **Status line**: the RemGlk grid window. Score/moves parsed from patterns like
  `Score: 10  Moves: 20`, `Score: 10/350`, `10/20` at line end (Inform 7 shows `score/turns`),
  `Turns: 5`. Location = leftmost text segment of the status line.
- **Score from text**: `[Your score has just gone up by N points.]`, `You have scored N out of a
  possible M`, `Your score is N (total of M points)` / `... of a possible M`, `scored N points`.
- **Ending**: game exit → `ended` (or `quit` if the last command was `quit`). Inform-style endings
  `*** You have won ***`, `*** You have died ***`, `*** <other> ***`, Zork-style `**** You have died ****`
  followed by a RESTART/RESTORE/QUIT question → session ends; ending = `won` if the banner contains
  win/won/victory or score == max_score, `died` if it contains died/dead/killed, else `ended`.
  Zork I's death-with-reincarnation (play continues) is **not** an ending.
- **Invalid command** (parser failure): responses like "I don't know the word", "That's not a verb I
  recognise", "I didn't understand that sentence", "You can't see any such thing", "I beg your
  pardon?", "There was no verb in that sentence". Counted in `invalid_commands`.

## 8. Replay entries (JSONL in `replays/`)

```json
{"ts":"...","type":"start","session_id":"...","game_id":"zork1","meta":{}}
{"ts":"...","type":"output","turn":0,"text":"...","status_line":"...","score":0}
{"ts":"...","type":"command","turn":1,"text":"open mailbox"}
{"ts":"...","type":"output","turn":1,"text":"Opening the small mailbox reveals a leaflet.","status_line":"...","score":0}
{"ts":"...","type":"end","ending":"won","score":7,"turn":42}
```

---

## 9. Implementation notes (Grue 2.0.0)

Clarifications made while implementing; none of them change the shapes above.

**HTTP status codes.** `bad_request` 400 (also malformed JSON, 413 for bodies over 64 KB),
`command_too_long` 400, `unauthorized` 401, `unknown_game` 404, `unknown_session` 404 (also used for
unknown results/transcripts), `game_over` 409, `game_unavailable` 409 (in the catalog but the file is not
installed), `too_many_sessions` 429, `internal` 500. Wrong method on a known route is 405
`method_not_allowed`; unknown route is 404 `not_found`.

**Auth.** `GRUE_API_KEYS` protects `/api/*` and `/ws/v1`. `/health`, `/metrics` and `/` stay open. For
`/ws/v1` the key may be sent as the `Authorization: Bearer` header or, for browsers, as `?api_key=<key>`.
The legacy text interface has no authentication, so it is disabled when keys are set unless
`LEGACY_ENABLED=true`.

**Commands.** Line commands are flattened before reaching the game: newlines, tabs and control
characters become spaces, whitespace runs collapse, ends are trimmed. The 256-character limit applies to
the raw string. If the game's input limit (RemGlk `maxlen`, e.g. 119 for Zork) is shorter, the command is
truncated and `notice` says so. Commands on one session are processed strictly in order, even if sent
concurrently. If a previous command timed out (`COMMAND_TIMEOUT_MS`) and the game is still busy, the next
command is not sent: the response carries the late output and a `notice` ("...command was not sent..."), and
`turn` does not advance.

**Char mode.** The key names are the RemGlk ones: `return`, `escape`, `up`, `down`, `left`, `right`,
`pageup`, `pagedown`, `tab`, `delete`, `home`, `end`; `space` sends a space; `backspace` maps to `delete`. When the
game draws a menu in the status window (two or more non-blank lines) in char mode, that text is appended to
`text` and `location`/`score`/`moves` keep their previous values instead of being re-parsed.

**Files.** Save/restore/transcript file prompts are cancelled; `notice` says "...not supported...". The
game continues (typically printing "Save failed.").

**Endings.** `quit` means the interpreter exited and `quit`/`q`/`exit`/`bye` was one of the last two commands
(Zork needs `quit` then `y`). An ending banner (`*** ... ***` or `**** ... ****`) is only an ending when a
RESTART/RESTORE/QUIT/UNDO question follows it, otherwise (Zork I reincarnation) play continues. On
interpreter exit the last banner, if any, classifies the ending; a final `score >= max_score` also counts as
`won`. `timeout` is the idle timeout only (`IDLE_TIMEOUT_MS`, default 10 minutes, measured between
commands). Server shutdown ends live sessions as `aborted`.

**Scores.** The status line wins; then absolute scores in the text ("Your score is 35 (total of 350
points)"); then "gone up by N points" deltas applied to the last known score. `max_score` is the catalog
value, else the first value parsed from the status line or text. `max_score_reached` is `null` if no score was
ever observed.

**Sessions after they end.** Finished sessions stay addressable in memory (last 200): `GET
/api/sessions/:id` returns the final summary, commands get 409, `DELETE` returns the Result again. After a server
restart only `/api/results/:id` knows them (commands still get 409, `GET /api/sessions/:id` is 404).

**Files on disk.** Results: `results/<session_id>.json`. Replays: `replays/<game_id>_<session_id>.jsonl`
(`Result.transcript` holds the `replays/...` relative path). Directories are configurable
(`RESULTS_DIR`, `REPLAYS_DIR`).

**Metrics.** `GET /metrics` is Prometheus-style plain text (`grue_active_sessions 1`, ...).

**WebSocket JSON.** Messages on one socket are handled in order. A second `start` on a socket is
`bad_request`. After `game_over` the socket stays open; `command` then returns `error: game_over`; `end`
returns the Result and closes.

**Legacy text.** Lobby shows installed games; reply with a number or the game id. Blank lines are ignored in
line mode and sent as `return` in char mode. Output is the observation text plus a one-line footer
(`[Location: ... | Score: 5/350 | Moves: 4 | Turn: 6]`) and a `> ` prompt; the connection closes at game over.
Sessions started this way carry `meta.agent = "grue-legacy-tcp"` / `"grue-legacy-ws"`.
