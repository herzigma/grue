# Grue

> *It is pitch black. You are likely to be eaten by a grue.*

Grue is a backend service that allows AI agents (or human developers) to connect and play interactive fiction games through a raw text socket. It acts as a headless game master — spinning up isolated Glulx interpreters for each session and piping the narrative text to connected clients.

## Prerequisites

- **Node.js** 18+
- **dumb-glulxe** — A command-line Glulx interpreter compiled with CheapGlk. This is the headless interpreter that runs the game files.

### Installing dumb-glulxe

You need a copy of `glulxe` compiled with the CheapGlk library:

1. Clone [glulxe](https://github.com/erkyrath/glulxe) and [cheapglk](https://github.com/erkyrath/cheapglk)
2. Build CheapGlk: `cd cheapglk && make`
3. Build Glulxe with CheapGlk: `cd glulxe && make GLKINCLUDEDIR=../cheapglk GLKLIBDIR=../cheapglk GLKMAKEFILE=Make.cheapglk`
4. The resulting `glulxe` binary is your interpreter

Set the `INTERPRETER_BIN` environment variable (or edit `config.js`) to point to the binary.

## Quickstart

```bash
# Clone and install
git clone <repo-url> grue
cd grue
npm install

# Download game files from the IF Archive
npm run setup

# Start the server
node index.js

# In another terminal, connect:
nc localhost 8080
```

### Special Macros

If the game enters a single-character input mode (like a Help menu), the server will automatically detect it and append a `[System: The game is waiting for a key press...]` warning.

When in this mode, sending standard words (`exit`) will result in character-by-character processing, causing rapid menu redraws. You can use the following special macros to emulate special keypresses:

- `\up`, `\down`, `\left`, `\right` (Arrow keys)
- `\enter`, `\return`
- `\space`
- `\esc`, `\escape`

You can also send a single character (e.g. `q` to quit the menu, `1` for option 1).

---

## Architecture

```
┌──────────────┐     TCP :8080     ┌─────────────────┐
│  AI Agent /  │────────────────── │                 │     ┌──────────────────┐
│  Developer   │                   │   Grue Server   │────▸│  dumb-glulxe     │
│              │────────────────── │                 │     │  (child process) │
└──────────────┘     WS :8081      └─────────────────┘     └──────────────────┘
                                          │
                                     ┌────┴─────┐
                                     │ replays/ │
                                     │ saves/   │
                                     └──────────┘
```

Each client connection gets its own isolated interpreter process. The server handles:

- **Output buffering** — Detects the `>` input prompt before flushing text to the client
- **Difficulty modes** — Hard (raw text) or Easy (template-scaffolded with hints)
- **Session timeouts** — 5-minute idle auto-save and disconnect
- **Replay logging** — JSONL transcripts of every session
- **Metrics** — concurrent sessions, invalid command rate

## Configuration

All settings can be overridden via environment variables:

| Variable | Default | Description |
|---|---|---|
| `TCP_PORT` | `8080` | TCP server port |
| `WS_PORT` | `8081` | WebSocket server port |
| `GAMES_DIR` | `./games` | Directory containing game files |
| `REPLAYS_DIR` | `./replays` | Directory for session transcripts |
| `SAVES_DIR` | `./saves` | Directory for auto-saved game states |
| `INTERPRETER_BIN` | `glulxe` | Path to the interpreter binary |
| `IDLE_TIMEOUT_MS` | `300000` | Idle timeout before auto-save (ms) |
| `DEFAULT_MODE` | `hard` | Default difficulty: `hard` or `easy` |
| `MAX_COMMAND_LENGTH` | `100` | Commands longer than this are flagged as invalid |

## Easy Mode Templates

In Easy Mode, the server wraps each turn's output with a configurable template before sending it to the client. Templates use [Nunjucks](https://mozilla.github.io/nunjucks/) syntax and are stored in `templates/`.

### Available variables in templates:
- `{{ output }}` — The raw game output for this turn
- `{{ turnNumber }}` — The current turn number

### Creating a custom template

Create a `.njk` file in `templates/`:

```
{{ output }}

--- MY CUSTOM HINTS ---
Turn {{ turnNumber }}
Remember to check your inventory frequently!
> 
```

When connecting, select `easy` mode and then enter your template name (without the `.njk` extension).

## Replay Logs

Every session generates a JSONL transcript in `replays/`. Each line is a JSON object:

```jsonl
{"ts":"2024-01-15T10:30:00.000Z","type":"start","gameId":"1","clientId":"abc-123"}
{"ts":"2024-01-15T10:30:01.000Z","type":"output","text":"West of House\nYou are standing in an open field..."}
{"ts":"2024-01-15T10:30:05.000Z","type":"command","text":"go north"}
{"ts":"2024-01-15T10:30:06.000Z","type":"output","text":"North of House\nYou are facing the north side..."}
{"ts":"2024-01-15T10:30:45.000Z","type":"end"}
```

## HTTP Endpoints

The WebSocket port also serves two HTTP endpoints:

- `GET /health` — Returns `{ "status": "ok", "activeSessions": N }`
- `GET /metrics` — Returns a plain-text metrics report

## Agent Integration

See [CLAUDE.md](./CLAUDE.md) for instructions on connecting an AI agent to Grue.

## Adding Games

Games are managed through a manifest file at `games/games.json`. To add a game:

1. Find a `.gblorb` or `.ulx` file on the [IF Archive](https://ifarchive.org/indexes/if-archive/games/glulx/)
2. Add an entry to `games/games.json`:
   ```json
   {
     "filename": "MyGame.gblorb",
     "url": "https://www.ifarchive.org/if-archive/games/glulx/MyGame.gblorb",
     "description": "My Game by Some Author"
   }
   ```
3. Run `npm run setup` to download it

You can also place `.gblorb` or `.ulx` files directly into the `games/` directory — Grue scans it automatically on startup.

## License

MIT
