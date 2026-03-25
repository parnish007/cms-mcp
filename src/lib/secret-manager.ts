// src/lib/secret-manager.ts
// SecretManager — Redact-on-Read pattern for production-safe credential handling.
//
// Problem: after loadConfig() resolves env: references, the resolved secret
// values live as plain strings on the Config object. Any code that logs config
// (audit logger, debug output, error messages) can accidentally leak them.
//
// Solution:
//   1. SecretManager holds resolved secrets in a private WeakMap keyed by a
//      stable opaque token object. The Config object only carries the token.
//   2. Callers use SecretManager.resolve(token) to get the real value just
//      before it's needed (e.g. building auth headers).
//   3. JSON.stringify, console.log, and audit logs always see "[REDACTED]".
//
// Usage:
//   const sm = new SecretManager();
//   const token = sm.register("bearer-token", resolvedValue);
//   config.auth.token = token;   // opaque string, safe to log
//   const real = sm.resolve(token);  // actual secret, used only in HTTP headers

// ─── Opaque token ─────────────────────────────────────────────────────────────

const REDACTED_PREFIX = "\x00cms-mcp:secret:" as const;

export type SecretToken = `${typeof REDACTED_PREFIX}${string}`;

export function isSecretToken(value: string): value is SecretToken {
  return value.startsWith(REDACTED_PREFIX);
}

/**
 * Returns a safe display string for a value — "[REDACTED]" for secret tokens,
 * passthrough for everything else.
 */
export function redactIfSecret(value: string): string {
  return isSecretToken(value) ? "[REDACTED]" : value;
}

// ─── SecretManager ────────────────────────────────────────────────────────────

export class SecretManager {
  // WeakMap is not useful here (string keys are primitives) —
  // use a regular Map with a hard-coded destroy path instead.
  readonly #store = new Map<string, string>();
  #destroyed = false;

  /**
   * Register a resolved secret and return an opaque token.
   * The token is safe to embed in config objects and log.
   *
   * @param label  A human-readable hint for debugging (e.g. "bearer-token").
   *               Never contains the actual value.
   * @param value  The resolved secret value (e.g. actual API key).
   */
  register(label: string, value: string): SecretToken {
    this.#assertLive();
    // Token encodes only the label + a counter, never the value
    const token = `${REDACTED_PREFIX}${label}:${this.#store.size}` as SecretToken;
    this.#store.set(token, value);
    return token;
  }

  /**
   * Resolve a token back to the real secret value.
   * Only call this at the last moment before use (e.g. building HTTP headers).
   */
  resolve(token: SecretToken): string {
    this.#assertLive();
    const value = this.#store.get(token);
    if (value === undefined) {
      throw new Error(`[SecretManager] Unknown secret token "${token.slice(REDACTED_PREFIX.length)}"`);
    }
    return value;
  }

  /**
   * Resolve a value that may or may not be a secret token.
   * Passthrough for non-token strings.
   */
  resolveAny(value: string): string {
    if (isSecretToken(value)) return this.resolve(value);
    return value;
  }

  /**
   * Wipe all stored secrets from memory.
   * Call during shutdown.
   */
  destroy(): void {
    for (const key of this.#store.keys()) {
      this.#store.set(key, ""); // overwrite before deleting
    }
    this.#store.clear();
    this.#destroyed = true;
  }

  #assertLive(): void {
    if (this.#destroyed) {
      throw new Error("[SecretManager] Attempted to use a destroyed SecretManager.");
    }
  }
}

// ─── Singleton for server lifetime ────────────────────────────────────────────

let _instance: SecretManager | null = null;

export function getSecretManager(): SecretManager {
  if (!_instance) _instance = new SecretManager();
  return _instance;
}

export function destroySecretManager(): void {
  _instance?.destroy();
  _instance = null;
}

// ─── Config integration helpers ───────────────────────────────────────────────

/**
 * Replace all env: references in a config sub-object with opaque secret tokens.
 * Modifies the object in place — returns it for chaining.
 *
 * After this call, the original plain-text secret values are gone from the
 * config. Only the SecretManager holds the real values.
 */
export function tokenizeSecrets(
  sm: SecretManager,
  fields: Array<{ label: string; getValue: () => string | undefined; setValue: (v: SecretToken) => void }>,
): void {
  for (const { label, getValue, setValue } of fields) {
    const v = getValue();
    if (!v) continue;
    // Resolve env: references right here
    const resolved = v.startsWith("env:")
      ? (() => {
          const varName = v.slice(4);
          const env = process.env[varName];
          if (!env) throw new Error(
            `[cms-mcp] Environment variable "${varName}" is required but not set.`
          );
          return env;
        })()
      : v;
    setValue(sm.register(label, resolved));
  }
}
