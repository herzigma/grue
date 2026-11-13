/**
 * Legacy text interface for humans and simple agents (TCP: `nc host 8080`, and WebSocket on any
 * path other than /ws/v1). One line in = one command; plain text out. Built on the same
 * SessionManager as the REST API, so sessions, replays and results are identical.
 */

const BANNER = [
  '',
  '  G R U E',
  '  Interactive fiction server for AI agents',
  '  "It is pitch black. You are likely to be eaten by a grue."',
  '',
].join('\n');

const KEY_HELP = 'The game is waiting for a single keypress. Send one character, or ' + ['enter', 'space', 'esc', 'up', 'down', 'left', 'right'].map((k) => String.fromCharCode(92) + k).join(' ') + '.';

/**
 * @param {{cfg: object, library: object, manager: object}} ctx
 * @param {{write: (text: string) => void, close: () => void}} io
 * @param {string} via 'tcp' | 'ws'
 * @returns {{onLine: (line: string) => void, onClose: () => void}}
 */
export function createLegacyConnection(ctx, io, via) {
  const { cfg, library, manager } = ctx;
  let games = [];
  let session = null;
  let busy = Promise.resolve();
  let closed = false;
  let inflight = 0;

  const write = (text) => { if (!closed) io.write(text); };
  const close = () => { if (!closed) { closed = true; io.close(); } };

  function footer(obs) {
    const bits = [];
    if (obs.location) bits.push(`Location: ${obs.location}`);
    if (obs.score !== null) bits.push(`Score: ${obs.score}${obs.max_score ? `/${obs.max_score}` : ''}`);
    if (obs.moves !== null) bits.push(`Moves: ${obs.moves}`);
    bits.push(`Turn: ${obs.turn}`);
    return `[${bits.join(' | ')}]`;
  }

  function render(obs) {
    const parts = [obs.text];
    if (obs.notice) parts.push(`[Note: ${obs.notice}]`);
    if (obs.game_over) {
      parts.push(`[Game over: ${obs.ending}]`, footer(obs));
    } else {
      parts.push(footer(obs));
      if (obs.input_type === 'char') parts.push(`[${KEY_HELP}]`);
    }
    return parts.filter(Boolean).join('\n\n') + (obs.game_over ? '\n' : '\n> ');
  }

  function lobbyPrompt() {
    games = library.entries().filter((e) => e.path).map((e) => e.game);
    if (!games.length) {
      return 'No games are installed. Run "npm run setup" or add story files to games/.\n';
    }
    const lines = ['Available games:', ''];
    games.forEach((g, i) => lines.push(`  ${i + 1}. ${g.title}${g.author ? ` (${g.author})` : ''}  [${g.id}]`));
    lines.push('', 'Enter a game number or id to begin: ');
    return lines.join('\n');
  }

  async function lobby(line) {
    const pick = line.trim();
    if (!pick) return;
    const n = /^\d+$/.test(pick) ? parseInt(pick, 10) : NaN;
    const game = games[n - 1] || games.find((g) => g.id === pick.toLowerCase());
    if (!game) {
      write(`Unknown game "${pick.slice(0, 40)}". Enter a number between 1 and ${games.length}: `);
      return;
    }
    write(`\nStarting "${game.title}"...\n\n`);
    try {
      const created = await manager.create({ game: game.id, meta: { agent: `grue-legacy-${via}`, interface: via } });
      session = created.session;
      if (closed) { session.end('aborted'); return; }
      write(render(created.observation));
      if (created.observation.game_over) { close(); return; }
      session.onEnded((result) => {
        if (inflight === 0) { // ended by idle timeout / abort, not by a command we are answering
          write(`\n[Session ended: ${result.ending}]\n`);
          close();
        }
      });
    } catch (err) {
      write(`[Error: ${err.message}]\n`);
      close();
    }
  }

  async function play(line) {
    if (line.length > cfg.MAX_COMMAND_LENGTH) {
      write(`[Command too long (max ${cfg.MAX_COMMAND_LENGTH} characters); not sent.]\n> `);
      return;
    }
    const last = session.lastObservation;
    if (line.trim() === '' && last?.input_type !== 'char') return; // ignore stray blank lines
    inflight++;
    try {
      const obs = await session.command(line);
      write(render(obs));
      if (obs.game_over) close();
    } catch (err) {
      write(`[Error: ${err.message}]\n`);
      close();
    } finally {
      inflight--;
    }
  }

  write(`${BANNER}\n${lobbyPrompt()}`);
  if (!games.length) close();

  return {
    onLine(line) {
      // Serialize: lines that arrive while a command is running are processed in order.
      busy = busy.then(() => (session ? play(line) : lobby(line)));
    },
    onClose() {
      closed = true;
      if (session && !session.gameOver) session.end('aborted');
    },
  };
}
