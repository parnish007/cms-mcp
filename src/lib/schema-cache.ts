// src/lib/schema-cache.ts
// SQLite-backed schema cache — reduces OpenAPI discovery round-trips.
// Stores discovered API specs and endpoint maps with TTL-based invalidation.

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { expandHome } from "./config.js";

const SCHEMA_VERSION = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CacheEntry {
  key: string;
  data: unknown;
  cachedAt: number;   // Unix timestamp ms
  ttlMs: number;
}

// ─── SchemaCache class ────────────────────────────────────────────────────────

export class SchemaCache {
  private db: Database.Database;
  private ttlMs: number;

  constructor(dbPath: string, ttlMinutes: number) {
    const resolvedPath = resolve(expandHome(dbPath));
    mkdirSync(dirname(resolvedPath), { recursive: true });

    this.db = new Database(resolvedPath);
    this.ttlMs = ttlMinutes * 60 * 1000;

    this.init();
    process.stderr.write(`[cms-mcp] Schema cache: ${resolvedPath} (TTL: ${ttlMinutes}m)\n`);
  }

  // ─── Init schema ───────────────────────────────────────────────────────────

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_cache (
        key        TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        cached_at  INTEGER NOT NULL,
        ttl_ms     INTEGER NOT NULL,
        version    INTEGER NOT NULL DEFAULT ${SCHEMA_VERSION}
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Purge expired entries on startup
    this.purgeExpired();
  }

  // ─── Get ───────────────────────────────────────────────────────────────────

  get<T = unknown>(key: string): T | null {
    const row = this.db
      .prepare("SELECT data, cached_at, ttl_ms FROM schema_cache WHERE key = ?")
      .get(key) as { data: string; cached_at: number; ttl_ms: number } | undefined;

    if (!row) return null;

    const age = Date.now() - row.cached_at;
    if (age > row.ttl_ms) {
      this.db.prepare("DELETE FROM schema_cache WHERE key = ?").run(key);
      return null;
    }

    try {
      return JSON.parse(row.data) as T;
    } catch {
      return null;
    }
  }

  // ─── Set ───────────────────────────────────────────────────────────────────

  set(key: string, data: unknown, ttlMs?: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO schema_cache (key, data, cached_at, ttl_ms, version)
      VALUES (?, ?, ?, ?, ?)
    `).run(key, JSON.stringify(data), Date.now(), ttlMs ?? this.ttlMs, SCHEMA_VERSION);
  }

  // ─── Invalidate ────────────────────────────────────────────────────────────

  invalidate(key: string): void {
    this.db.prepare("DELETE FROM schema_cache WHERE key = ?").run(key);
  }

  invalidateAll(): number {
    const result = this.db.prepare("DELETE FROM schema_cache").run();
    return result.changes;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  stats(): { totalEntries: number; expiredEntries: number; oldestEntryAge: string } {
    const now = Date.now();
    const total = (this.db.prepare("SELECT COUNT(*) as n FROM schema_cache").get() as any).n as number;
    const expired = (this.db.prepare(
      "SELECT COUNT(*) as n FROM schema_cache WHERE ? - cached_at > ttl_ms"
    ).get(now) as any).n as number;

    const oldest = this.db.prepare(
      "SELECT cached_at FROM schema_cache ORDER BY cached_at ASC LIMIT 1"
    ).get() as { cached_at: number } | undefined;

    const oldestAge = oldest
      ? `${Math.round((now - oldest.cached_at) / 60000)}m ago`
      : "n/a";

    return { totalEntries: total, expiredEntries: expired, oldestEntryAge: oldestAge };
  }

  // ─── Purge expired ─────────────────────────────────────────────────────────

  private purgeExpired(): number {
    const result = this.db.prepare(
      "DELETE FROM schema_cache WHERE ? - cached_at > ttl_ms"
    ).run(Date.now());
    if (result.changes > 0) {
      process.stderr.write(`[cms-mcp] Schema cache: purged ${result.changes} expired entries\n`);
    }
    return result.changes;
  }

  // ─── Close ─────────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }
}

// ─── Cache key builders ───────────────────────────────────────────────────────

export function openApiCacheKey(baseUrl: string): string {
  return `openapi:${baseUrl}`;
}

export function endpointCacheKey(baseUrl: string, resource: string): string {
  return `endpoint:${baseUrl}:${resource}`;
}
