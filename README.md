# Grue

Grue is a game server for interactive fiction (text adventures), built so that LLM agents can play them
and be compared. It runs real story files (Glulx, Z-machine, TADS, Hugo, ADRIFT) through the
[emglken](https://github.com/curiousdannii/emglken) interpreters and exposes each game as a session you can
drive over a simple JSON API. Every session is scored, logged and ranked.

> It is pitch black. You are likely to be eaten by a grue.

Grue is the server half of a benchmark. The client half, **Brass Lantern**, plays the games with LLMs.
The contract between them is [docs/PROTOCOL.md](docs/PROTOCOL.md).

What you get:

- **REST API** and **WebSocket JSON API** for programs and harnesses (primary interfaces).
- **Legacy text interface** (`nc localhost 8080`, or a plain WebSocket) for humans and simple agents.
- **Parsed observations**: status line, location, score, move count, game-over detection.
- **Per-session records**: replay transcript (JSONL) and a result (score, peak score, turns, invalid
  commands, rooms visited, ending) written to disk.
- **Dashboard** at `/`: game catalog, live sessions, leaderboard by game, transcript viewer.
- Concurrent isolated sessions, idle timeouts, turn limits, optional API keys. Node built-ins plus `ws`.

## Quickstart

Requires Node.js 20 or newer.

```bash
npm install
npm run setup     # downloads the games listed in games/games.json (checksum-verified)
npm start         # HTTP + WebSocket on :8081, legacy text on :8080
```

Open http://localhost:8081 for the dashboard, then play a game:

```bash
# list games
curl -s localhost:8081/api/games

# start a session (returns the first observation, including session_id)
curl -s -X POST localhost:8081/api/sessions -H 'Content-Type: application/json' \
  -d '{"game":"zork1","max_turns":200,"meta":{"model":"my-model","agent":"curl"}}'

# send commands
curl -s -X POST localhost:8081/api/sessions/$ID/commands -H 'Content-Type: application/json' \
  -d '{"command":"open mailbox"}'

# end it early and get the result
curl -s -X DELETE localhost:8081/api/sessions/$ID
```

Or just `nc localhost 8080`, pick a game by number, and type commands.

Run the tests with `npm test` (about 20 seconds; game-dependent tests skip if the files are not installed).

## Interfaces

All three share the same sessions, replays and results.

| Interface | Address | For |
|---|---|---|
| REST | `http://localhost:8081/api/...` | harnesses, `curl` |
| WebSocket JSON | `ws://localhost:8081/ws/v1` | streaming clients |
| Legacy text | `nc localhost 8080`, `ws://localhost:8081/` (any path but `/ws/v1`) | humans, simple agents |

### REST

| Method and path | Purpose |
|---|---|
| `GET /health`, `GET /metrics` | liveness; plain-text counters |
| `GET /api/games`, `GET /api/games/:id` | catalog |
| `POST /api/sessions` | `{"game","max_turns","meta"}` -> 201 Observation (turn 0) |
| `POST /api/sessions/:id/commands` | `{"command"}` -> Observation |
| `GET /api/sessions/:id`, `GET /api/sessions` | session state; active sessions |
| `DELETE /api/sessions/:id` | end (`aborted`) and return the Result |
| `GET /api/results?game=&limit=`, `GET /api/results/:id`, `GET /api/results/:id/transcript` | finished runs |
| `GET /` | dashboard |

An Observation looks like this:

```json
{
  "session_id": "6f1c...", "game_id": "zork1", "turn": 3,
  "text": "West of House\nYou are standing in an open field...",
  "status_line": "West of House      Score: 0   Moves: 3",
  "location": "West of House", "score": 0, "max_score": 350, "moves": 3,
  "input_type": "line", "game_over": false, "ending": null, "notice": null
}
```

`input_type` is `"char"` when the game wants a single keypress (menus, "press any key"); then `command` is
read as one key (`return`, `space`, `escape`, `up`, `down`, a letter...). Endings are `won`, `died`, `ended`,
`turn_limit`, `quit`, `timeout`, `crashed` or `aborted`. The full field list, error codes and parsing rules are in
[docs/PROTOCOL.md](docs/PROTOCOL.md).

### WebSocket JSON

Connect to `/ws/v1` and send `{"type":"list_games"}`, `{"type":"start","game":"zork1","meta":{}}`,
`{"type":"command","command":"look"}` or `{"type":"end"}`. Replies are `games`, `observation`, `result` and
`error` messages. One session per socket; closing the socket aborts it.

### Authentication

Set `GRUE_API_KEYS=key1,key2` and every `/api/*` and `/ws/v1` request needs `Authorization: Bearer <key>`
(WebSocket clients that cannot set headers may use `?api_key=`). The dashboard asks for the key when needed.
The legacy text interface cannot authenticate, so it is turned off when keys are set unless you also set
`LEGACY_ENABLED=true`.

With keys set, each session belongs to the key that created it: `GET /api/sessions` lists only your own, and
commands, `GET` and `DELETE` on another key's session return `404 unknown_session`. Results and transcripts
(`/api/results...`) stay readable to every valid key, so the leaderboard is shared.

### Security notes

- Grue binds to `127.0.0.1` by default. To serve beyond this machine set `HOST=0.0.0.0` **and** `GRUE_API_KEYS`;
  Grue logs a warning at startup if it is bound to a non-loopback address with no keys.
- Keys travel in a header, so put TLS in front (a reverse proxy) before exposing it. `/health`, `/metrics` and
  the dashboard page itself are not key-protected.
- Bodies over 64 KB get `413` and the connection is closed. The legacy text interface has no authentication
  (and no per-key scoping); leave it off on a public server.
- Idle HTTP connections are kept open for 65 s so clients that think for a few seconds between commands do not
  hit a closing socket.

## Configuration

Environment variables (or a `.env` file; see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | `127.0.0.1` | bind address; set `0.0.0.0` (with `GRUE_API_KEYS`) to serve other machines |
| `HTTP_PORT` | `8081` | REST, dashboard, WebSocket (`WS_PORT` still works) |
| `TCP_PORT` | `8080` | legacy text over TCP |
| `LEGACY_ENABLED` | `true` (`false` if keys set) | serve the legacy text interface |
| `GRUE_API_KEYS` | empty | comma-separated bearer keys; empty means no auth |
| `MAX_SESSIONS` | `16` | concurrent sessions; more get `429` |
| `IDLE_TIMEOUT_MS` | `600000` | no command for this long ends the session with `timeout` |
| `COMMAND_TIMEOUT_MS` | `10000` | max wait for the game to answer one command |
| `DEFAULT_MAX_TURNS` | `1000` | turn limit when neither request nor catalog gives one |
| `MAX_COMMAND_LENGTH` | `256` | longest accepted command |
| `GAMES_DIR` / `REPLAYS_DIR` / `RESULTS_DIR` | `games/`, `replays/`, `results/` | data directories |

Each interpreter is a separate Node process; budget some memory per concurrent session.

## Games and adding more

The catalog is `games/games.json` merged with whatever story files are on disk. Grue looks in `games/`
and `games/original/` for `.ulx .gblorb .z3 .z4 .z5 .z8 .zblorb .hex .taf .gam .t3`. A file with no manifest
entry is still listed, with an id made from the filename and empty metadata.

Manifest entry (all fields except `filename` optional):

```json
{
  "id": "zork1",
  "title": "Zork I: The Great Underground Empire",
  "author": "Infocom",
  "format": "zcode",
  "filename": "zork1.z3",
  "url": "https://raw.githubusercontent.com/historicalsource/zork1/master/COMPILED/zork1.z3",
  "sha256": "3708...",
  "max_score": 350,
  "difficulty": "hard",
  "suggested_turn_limit": 600,
  "tags": ["classic", "memorization-risk"],
  "description": "The classic underground treasure hunt.",
  "license": "MIT"
}
```

`npm run setup` downloads every entry that has a `url` (skipping files already present), and verifies `sha256`
when given. Downloaded binaries are git-ignored; files under `games/original/` are meant to be committed.

**Add a game from the IF Archive:** add a manifest entry with `id`, `filename` and `url` (add `sha256` from
`sha256sum` after the first download), then run `npm run setup`.

**Add a novel game** (recommended for benchmarking, since classics are in training data). There are two ways.

*With Grue's built-in engine (no toolchain).* Write the game as a plain JavaScript module in `games/original/`
(rooms, objects, puzzle hooks, NPC topics, scoring) and give it a manifest entry with `"format": "native"`. The
engine supplies a full parser (synonyms, disambiguation, pronouns, containers, light and darkness, locks, undo)
with classic Inform wording, so scoring and ending detection work like any other game.
[lib/native/AUTHORING.md](lib/native/AUTHORING.md) is the guide. Two original games ship this way:

| id | difficulty | max score | notes |
|---|---|---|---|
| `lantern-lane` | tutorial | 10 | 5 rooms, about 22 moves; good for smoke tests and cheap runs |
| `skerrin-light` | medium | 50 | 17 rooms, about 76 moves; the main memorization-free benchmark game |

Walkthroughs and spoiler notes are in `games/src/<id>/`, and `node games/src/verify.mjs` checks that each
game is winnable at full score. Native game files are executed in-process, so only install ones you trust.

*With a standard IF system.*

1. Write it in Inform 7, Inform 6, TADS or similar and compile to a story file Grue can run
   (`.ulx`/`.gblorb` for Glulx, `.z5`/`.z8` for the Z-machine).
2. Put the file in `games/original/` and add a manifest entry (no `url`) with a unique `id`, `max_score`,
   `difficulty` and a `suggested_turn_limit` roughly 2-3x the shortest winning walkthrough.
3. To get good scores and endings: give the game a status line with score and turns (the default Inform
   one works), award points as the player progresses, and finish with the standard
   `*** You have won ***` banner so the ending is classified as `won`.
4. Play it once through `npm start` and `nc localhost 8080` to check the transcript reads well.

## Architecture

```
index.js                  startServer(options): HTTP + WebSocket upgrade routing + TCP; run directly to listen
config.js                 environment-driven defaults
lib/interpreterSession.js one emglken process in RemGlk JSON mode; send(command) -> Turn
lib/nativeSession.js      same interface for games on the built-in engine (lib/native/)
lib/parse.js              status line, score, ending and invalid-command heuristics (pure functions)
lib/gameSession.js        one play-through: observations, score/ending logic, limits, replay, result
lib/sessionManager.js     session registry (MAX_SESSIONS, lookup, shutdown) and result store
lib/gameLibrary.js        manifest + disk scan -> catalog
lib/httpApi.js            REST routes, auth, dashboard
lib/wsJson.js             /ws/v1 handler
lib/legacy.js             line-based text interface for TCP and WebSocket
lib/replayLogger.js       JSONL transcripts      lib/metrics.js   counters for /metrics
public/index.html         dashboard (single file, no build step)
scripts/download-games.js `npm run setup`
tests/                    node --test suites
```

How a command flows: the transport hands a string to `GameSession.command()`, which queues it and calls
`InterpreterSession.send()`. That writes a RemGlk `line` (or `char`) event to the child process and waits until
the interpreter's next update asks for input again. Buffer-window text becomes the observation `text`; the grid
window is the status line. `parse.js` extracts location and score from it, and the session decides whether the
game has ended. The interpreter runs in the story file's directory with a bare filename, because emglken's
virtual filesystem cannot open absolute Windows paths.

Interpreters are killed when a session ends, when the server shuts down, and, as a last resort, when the
server process exits.

## Known limitations

- Save, restore and transcript files are not supported (the prompt is cancelled and the game is told so).
  Use `undo` where a game offers it.
- Timers and graphics are not advertised, so games relying on them degrade or refuse to run.
- Score, location and ending detection are heuristics tuned for Inform and Infocom conventions; unusual games
  may report `null` for some fields.
- Results are stored as one JSON file per session and scanned on read: fine for thousands of runs, not millions.

## License

MIT. emglken (GPL-2.0 and others) is used as a separate dependency; Zork I is MIT-licensed by its publisher
and downloaded, not bundled.
