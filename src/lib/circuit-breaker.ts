// src/lib/circuit-breaker.ts
// Circuit Breaker — production resilience pattern.
// If the CMS API goes down, serve cached responses gracefully instead of
// letting every request fail. Tracks consecutive failures and opens/closes
// the circuit automatically.

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;   // Consecutive failures before opening (default: 5)
  resetTimeoutMs: number;     // How long to stay open before trying again (default: 30s)
  name?: string;              // Label for logs
}

interface CachedResponse {
  data: unknown;
  cachedAt: number;
  endpoint: string;
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeout: number;
  private readonly name: string;
  private cache = new Map<string, CachedResponse>();

  constructor(options: CircuitBreakerOptions) {
    this.threshold = options.failureThreshold;
    this.resetTimeout = options.resetTimeoutMs;
    this.name = options.name ?? "default";
  }

  // ── Execute a request through the breaker ────────────────────────────────

  async execute<T>(
    cacheKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Check if circuit should transition from open → half-open
    if (this.state === "open") {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeout) {
        this.state = "half-open";
        this.log(`half-open — testing with next request`);
      } else {
        // Circuit is open — return cached data if available
        const cached = this.cache.get(cacheKey);
        if (cached) {
          const age = Math.round((Date.now() - cached.cachedAt) / 1000);
          this.log(`open — serving cached response (${age}s old)`);
          return cached.data as T;
        }
        throw new Error(
          `[circuit-breaker:${this.name}] API unavailable (circuit open, no cached data)`
        );
      }
    }

    // Execute the request
    try {
      const result = await fn();

      // Success — cache the response and reset failure count
      this.cache.set(cacheKey, {
        data: result,
        cachedAt: Date.now(),
        endpoint: cacheKey,
      });
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();

      // Try returning cached data on failure
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const age = Math.round((Date.now() - cached.cachedAt) / 1000);
        this.log(`request failed — serving cached response (${age}s old)`);
        return cached.data as T;
      }

      // No cache — propagate the error
      throw err;
    }
  }

  // ── State transitions ─────────────────────────────────────────────────────

  private onSuccess(): void {
    if (this.state === "half-open") {
      this.log(`closed — API recovered`);
    }
    this.failureCount = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      // Failed during half-open test — reopen
      this.state = "open";
      this.log(`re-opened — test request failed`);
    } else if (this.failureCount >= this.threshold) {
      this.state = "open";
      this.log(`opened — ${this.failureCount} consecutive failures`);
    }
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  getState(): CircuitState { return this.state; }
  getFailureCount(): number { return this.failureCount; }
  getCacheSize(): number { return this.cache.size; }

  getStatus(): Record<string, unknown> {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      cacheSize: this.cache.size,
      lastFailure: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
    };
  }

  // ── Manual controls ───────────────────────────────────────────────────────

  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.log("manually reset");
  }

  clearCache(): number {
    const size = this.cache.size;
    this.cache.clear();
    return size;
  }

  private log(msg: string): void {
    process.stderr.write(`[circuit-breaker:${this.name}] ${msg}\n`);
  }
}
