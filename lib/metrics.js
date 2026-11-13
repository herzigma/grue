/** Metrics: simple in-memory counters exposed as plain text at GET /metrics. */

export class Metrics {
  constructor() {
    this.activeSessions = 0;
    this.totalSessions = 0;
    this.totalCommands = 0;
    this.invalidCommands = 0;
    this.endings = {};
    this.startedAt = Date.now();
  }

  sessionStarted() {
    this.activeSessions++;
    this.totalSessions++;
  }

  sessionEnded(ending) {
    this.activeSessions = Math.max(0, this.activeSessions - 1);
    this.endings[ending] = (this.endings[ending] || 0) + 1;
  }

  command(invalid) {
    this.totalCommands++;
    if (invalid) this.invalidCommands++;
  }

  getReport() {
    const lines = [
      `grue_active_sessions ${this.activeSessions}`,
      `grue_sessions_total ${this.totalSessions}`,
      `grue_commands_total ${this.totalCommands}`,
      `grue_invalid_commands_total ${this.invalidCommands}`,
      `grue_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`,
    ];
    for (const [ending, n] of Object.entries(this.endings)) {
      lines.push(`grue_session_endings_total{ending="${ending}"} ${n}`);
    }
    return lines.join('\n') + '\n';
  }
}
