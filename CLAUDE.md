# CLAUDE.md — Agent Integration Guide for Grue

You are connected to **Grue**, an interactive fiction server. Your goal is to play the text adventure game by sending valid interactive fiction commands.

## Protocol

1. **On connect**, you will see a game list. Send the number of the game you want to play.
2. **Mode selection**: Type `hard` (raw text) or `easy` (with hints). Default is `hard`.
3. **Gameplay**: You will receive narrative text describing your surroundings. Send a single command per turn.

## How to Play Interactive Fiction

Interactive fiction uses a parser that understands imperative English commands. Here are the essentials:

### Core Commands
- `look` — Describe the current room
- `inventory` (or `i`) — List what you're carrying
- `examine [thing]` (or `x [thing]`) — Look closely at something
- `go [direction]` — Move (n, s, e, w, ne, nw, se, sw, up, down)
- `take [thing]` / `drop [thing]` — Pick up or put down objects
- `open [thing]` / `close [thing]`
- `read [thing]`
- `talk to [person]` / `ask [person] about [topic]`
- `use [thing]` / `put [thing] on [thing]`
- `save` / `restore` / `undo`

### Critical Rules
1. **One command per turn.** Do not send paragraphs or conversational text.
2. **Use imperative mood.** Say `open the door`, not `I would like to open the door`.
3. **Be specific.** If there are multiple objects, specify which one: `take the red key`.
4. **Explore thoroughly.** Always `examine` interesting objects and `look` when entering new rooms.
5. **Map your surroundings.** Track which directions lead where.
6. **Read everything.** Signs, books, notes, and inscriptions often contain clues.

### Common Mistakes
- ❌ `"I think I should go north because..."` — Don't explain your reasoning in the command.
- ❌ `go north, then take the lamp` — One command at a time.
- ✅ `go north`
- ✅ `take lamp`

### Special Macros (Char-Mode / Menus)
Sometimes games output a menu or prompt that expects a **single keypress** instead of a full line of text. The server will detect these and append a `[System: The game is waiting for a key press...]` hint to the output.
When you see this, you **MUST NOT** send full word commands like `talk salesman` or `exit`, as they will be processed character-by-character and cause the menu to rapidly redraw.

Instead, send **one of the following macros** or a single valid mode character (e.g. `q` for quit, `1` for option 1):
- `\up` / `\down` / `\left` / `\right` — Arrow keys
- `\enter` or `\return` — Select option
- `\space` — Next page
- `\esc` or `\escape` — Escape

## Connection Details
- **TCP**: `nc localhost 8080`
- **WebSocket**: `ws://localhost:8081`
- **Idle timeout**: 5 minutes (auto-saves before disconnect)

## Strategy Tips
1. Make a mental map of the game world as you explore.
2. Pick up everything that isn't nailed down.
3. If stuck, try `examine` on every noun mentioned in the room description.
4. Save frequently before attempting risky actions.
5. Pay attention to the status line for score and move count.
