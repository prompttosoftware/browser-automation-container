// ContainerTimer.js
const fs = require('fs').promises;
const path = require('path');

class ContainerTimer {
  /**
   * @param {Object} opts
   * @param {string} opts.startTimeFile    Path to the .txt file storing last start timestamp
   * @param {number} opts.thresholdMinutes Minutes uptime before scheduling a crash-&-restart
   * @param {number} [opts.killDelayMs=60000] Millis to wait once threshold passed
   */
  constructor({
    startTimeFile,
    thresholdMinutes,
    killDelayMs = 60_000,
  }) {
    if (!thresholdMinutes) {
        throw new Error("You must supply thresholdMinutes");
    }

    if (!startTimeFile) {
        startTimeFile = '/start-time.txt';
    }

    this.startTimeFile = path.resolve(startTimeFile);
    this.thresholdMs   = thresholdMinutes * 60_000;
    this.killDelayMs   = killDelayMs;
    this.killTimer     = null;
  }

  // Read or initialize the timestamp file
  async _getOrInitStartTime() {
    try {
      const txt = await fs.readFile(this.startTimeFile, 'utf8');
      const ts  = parseInt(txt, 10);
      if (!isNaN(ts)) return ts;
      throw new Error('Bad timestamp');
    } catch {
      const now = Date.now();
      await this._writeStartTime(now);
      return now;
    }
  }

  async _writeStartTime(ms) {
    await fs.mkdir(path.dirname(this.startTimeFile), { recursive: true });
    await fs.writeFile(this.startTimeFile, String(ms), 'utf8');
  }

  _clearKillTimer() {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
  }

  /**
   * Call this right after your container (or main service) starts.
   */
  async setStartTimeToNow() {
    await this._writeStartTime(Date.now());
    this._clearKillTimer();
  }

  /**
   * Check whether threshold has passed; if so, schedule a delayed kill.
   * Does nothing if threshold not yet reached.
   */
  async startTimer() {
    const startTs = await this._getOrInitStartTime();
    const elapsed = Date.now() - startTs;

    if (elapsed >= this.thresholdMs && !this.killTimer) {
      console.log(`Uptime ≥ ${this.thresholdMs}ms → scheduling container crash in ${this.killDelayMs}ms`);
      this.killTimer = setTimeout(() => this._crashContainer(), this.killDelayMs);
    } else {
      console.log(`Uptime ${elapsed}ms < ${this.thresholdMs}ms → no action`);
    }
  }

  /**
   * On each “batch used” event, clear any pending crash and re-check immediately.
   */
  async restartTimer() {
    this._clearKillTimer();
    await this.startTimer();
  }

  /**
   * The most generic “kill container” you can do: 
   *   - If we ourselves *are* PID 1, exit(1). 
   *   - Otherwise send SIGTERM to PID 1.
   */
  _crashContainer() {
    console.warn('>>> Crashing container now (exit code 1) <<<');
    if (process.pid === 1) {
      // we *are* container main
      process.exit(1);
    } else {
      // try to kill the init process inside the container
      try {
        process.kill(1, 'SIGTERM');
      } catch (err) {
        console.error('Failed to signal PID 1; falling back to process.exit:', err);
        process.exit(1);
      }
    }
  }
}

module.exports = ContainerTimer;
