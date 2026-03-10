/**
 * Idle timer with active request tracking.
 * Fires a shutdown callback after configurable inactivity timeout,
 * but only when no requests are in-flight.
 */

export class IdleTimer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeCount = 0;

  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: () => void,
  ) {}

  /** Reset the idle countdown. Starts a new timer from now. */
  touch(): void {
    // timeoutMs === 0 means idle timer is disabled (e.g., TCP mode)
    if (this.timeoutMs <= 0) return;

    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onIdle();
    }, this.timeoutMs);
  }

  /** Cancel the idle timer entirely. */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Mark a request as started. Cancels idle timer while requests are active. */
  onRequestStart(): void {
    this.activeCount++;
    this.cancel();
  }

  /** Mark a request as ended. Restarts idle timer when all requests complete. */
  onRequestEnd(): void {
    // Guard: don't go negative
    if (this.activeCount <= 0) return;

    this.activeCount--;
    if (this.activeCount === 0) {
      this.touch();
    }
  }
}
