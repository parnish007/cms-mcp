// tests/circuit-breaker.test.ts
// Circuit Breaker pattern tests — closed → open → half-open → closed lifecycle.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CircuitBreaker } from "../src/lib/circuit-breaker.js";

describe("CircuitBreaker", () => {

  it("starts in closed state", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
    assert.equal(cb.getState(), "closed");
    assert.equal(cb.getFailureCount(), 0);
  });

  it("passes through successful requests", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
    const result = await cb.execute("test", async () => "hello");
    assert.equal(result, "hello");
    assert.equal(cb.getState(), "closed");
  });

  it("caches successful responses", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
    await cb.execute("test", async () => ({ data: [1, 2, 3] }));
    assert.equal(cb.getCacheSize(), 1);
  });

  it("opens after reaching failure threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100_000 });
    const fail = async () => { throw new Error("API down"); };

    for (let i = 0; i < 3; i++) {
      await cb.execute("key", fail).catch(() => {});
    }

    assert.equal(cb.getState(), "open");
    assert.equal(cb.getFailureCount(), 3);
  });

  it("returns cached data when circuit is open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100_000 });

    // First: successful call, gets cached
    await cb.execute("key", async () => "cached_value");

    // Then: failures to open the circuit
    const fail = async () => { throw new Error("API down"); };
    await cb.execute("key", fail).catch(() => {});
    await cb.execute("key", fail).catch(() => {});

    assert.equal(cb.getState(), "open");

    // Now: should return cached value without calling the function
    const result = await cb.execute("key", async () => "should_not_reach");
    assert.equal(result, "cached_value");
  });

  it("throws when open with no cache", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100_000 });
    const fail = async () => { throw new Error("down"); };

    await cb.execute("key", fail).catch(() => {});
    assert.equal(cb.getState(), "open");

    await assert.rejects(
      () => cb.execute("no-cache-key", async () => "never"),
      /circuit open/,
    );
  });

  it("transitions to half-open after reset timeout", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    const fail = async () => { throw new Error("down"); };

    await cb.execute("key", fail).catch(() => {});
    assert.equal(cb.getState(), "open");

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    // Next call should be in half-open — and succeed
    const result = await cb.execute("key", async () => "recovered");
    assert.equal(result, "recovered");
    assert.equal(cb.getState(), "closed"); // Successful call closes it
  });

  it("re-opens from half-open on failure", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
    const fail = async () => { throw new Error("still down"); };

    await cb.execute("key", fail).catch(() => {});
    assert.equal(cb.getState(), "open");

    await new Promise((r) => setTimeout(r, 60));

    // Half-open test fails — should re-open
    await cb.execute("key", fail).catch(() => {});
    assert.equal(cb.getState(), "open");
  });

  it("resets manually", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 100_000 });
    const fail = async () => { throw new Error("down"); };

    await cb.execute("key", fail).catch(() => {});
    assert.equal(cb.getState(), "open");

    cb.reset();
    assert.equal(cb.getState(), "closed");
    assert.equal(cb.getFailureCount(), 0);
  });

  it("returns status object", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000, name: "test-api" });
    const status = cb.getStatus();
    assert.equal(status.name, "test-api");
    assert.equal(status.state, "closed");
    assert.equal(status.failureCount, 0);
  });
});
