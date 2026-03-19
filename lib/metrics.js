/**
 * Metrics — Simple in-memory metrics for observability.
 */

export class Metrics {
  constructor() {
    this.activeSessions = 0;
    this.totalSessions = 0;
    this.invalidCommands = 0;
    this.totalCommands = 0;
  }

  sessionStarted() {
    this.activeSessions++;
    this.totalSessions++;
  }

  sessionEnded() {
    this.activeSessions = Math.max(0, this.activeSessions - 1);
  }

  commandReceived() {
    this.totalCommands++;
  }

  commandInvalid() {
    this.invalidCommands++;
  }

  /**
   * Checks if a command looks like an LLM hallucination rather than
   * a valid interactive fiction command.
   * @param {string} command
   * @param {number} maxLength
   * @returns {boolean}
   */
  isLikelyInvalid(command, maxLength = 100) {
    if (command.length > maxLength) return true;
    // Multiple sentences suggest conversational text, not a game command
    if (/[.!?]\s+[A-Z]/.test(command)) return true;
    return false;
  }

  /**
   * Returns a plain-text summary of current metrics.
   * @returns {string}
   */
  getReport() {
    const invalidRate =
      this.totalCommands > 0
        ? ((this.invalidCommands / this.totalCommands) * 100).toFixed(1) + '%'
        : 'N/A';

    return [
      '── Grue Metrics ──',
      `  Active sessions : ${this.activeSessions}`,
      `  Total sessions  : ${this.totalSessions}`,
      `  Total commands  : ${this.totalCommands}`,
      `  Invalid commands: ${this.invalidCommands} (${invalidRate})`,
    ].join('\n');
  }
}
