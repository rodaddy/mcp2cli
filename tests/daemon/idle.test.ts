import { describe, test, expect, afterEach } from "bun:test";
import { IdleTimer } from "../../src/daemon/idle.ts";

describe("IdleTimer", () => {
  let timer: IdleTimer | null = null;

  afterEach(() => {
    timer?.cancel();
    timer = null;
  });

  test("fires callback after timeout", async () => {
    let fired = false;
    timer = new IdleTimer(50, () => {
      fired = true;
    });
    timer.touch();

    // Should not have fired yet
    expect(fired).toBe(false);

    // Wait for timeout + buffer
    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toBe(true);
  });

  test("touch() resets countdown", async () => {
    let fired = false;
    timer = new IdleTimer(50, () => {
      fired = true;
    });
    timer.touch();

    // Touch again at ~30ms, resetting the countdown
    await new Promise((r) => setTimeout(r, 30));
    timer.touch();

    // At ~55ms from start (25ms after second touch), should NOT have fired
    await new Promise((r) => setTimeout(r, 25));
    expect(fired).toBe(false);

    // At ~85ms from start (55ms after second touch), should have fired
    await new Promise((r) => setTimeout(r, 30));
    expect(fired).toBe(true);
  });

  test("cancel() prevents firing", async () => {
    let fired = false;
    timer = new IdleTimer(50, () => {
      fired = true;
    });
    timer.touch();

    await new Promise((r) => setTimeout(r, 20));
    timer.cancel();

    await new Promise((r) => setTimeout(r, 60));
    expect(fired).toBe(false);
  });

  test("onRequestStart cancels timer, onRequestEnd restarts it", async () => {
    let fired = false;
    timer = new IdleTimer(50, () => {
      fired = true;
    });
    timer.touch();

    // Start a request -- should cancel timer
    timer.onRequestStart();
    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toBe(false);

    // End request -- should restart timer
    timer.onRequestEnd();
    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toBe(true);
  });

  test("timer does not fire while active request count > 0", async () => {
    let fired = false;
    timer = new IdleTimer(50, () => {
      fired = true;
    });
    timer.touch();

    // Start two requests
    timer.onRequestStart();
    timer.onRequestStart();

    // End one -- still one active, timer should NOT restart
    timer.onRequestEnd();
    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toBe(false);

    // End second -- now timer restarts
    timer.onRequestEnd();
    await new Promise((r) => setTimeout(r, 80));
    expect(fired).toBe(true);
  });

  test("multiple rapid touch() calls don't stack timeouts (only fires once)", async () => {
    let fireCount = 0;
    timer = new IdleTimer(50, () => {
      fireCount++;
    });

    // Rapid touches
    timer.touch();
    timer.touch();
    timer.touch();
    timer.touch();
    timer.touch();

    await new Promise((r) => setTimeout(r, 100));
    expect(fireCount).toBe(1);
  });
});
