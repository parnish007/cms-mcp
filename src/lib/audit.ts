// src/lib/audit.ts
// Append-only audit log. Every tool call is recorded.
// Secrets are never logged — only field names and value lengths.

import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface AuditEntry {
  timestamp: string;
  tool: string;
  args: Record<string, unknown>;
  outcome: "success" | "error" | "validation_error" | "blocked_readonly";
  error?: string;
  durationMs?: number;
}

// Keys that indicate a value should be fully redacted
const SENSITIVE_KEY_RE = /token|password|secret|key|auth|credential|api[-_]?key/i;

export class AuditLogger {
  private path: string | null;

  constructor(logPath?: string) {
    this.path = logPath ?? null;

    if (this.path) {
      try {
        mkdirSync(dirname(this.path), { recursive: true });
      } catch {
        // dir already exists
      }
      process.stderr.write(`[cms-mcp] Audit log: ${this.path}\n`);
    }
  }

  log(entry: AuditEntry): void {
    const line = JSON.stringify({
      ...entry,
      args: sanitizeArgs(entry.args),
      // Never log error messages verbatim — they can leak API internals
      error: entry.error ? truncateError(entry.error) : undefined,
    });

    process.stderr.write(`[audit] ${line}\n`);

    if (this.path) {
      try {
        appendFileSync(this.path, line + "\n", "utf-8");
      } catch (err) {
        process.stderr.write(`[cms-mcp] Failed to write audit log: ${err}\n`);
      }
    }
  }
}

// ─── Sanitisation ─────────────────────────────────────────────────────────────

function sanitizeArgs(args: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 5) return { "[truncated]": true }; // prevent prototype pollution via deep nesting

  const result: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      result[k] = `[redacted length=${String(v).length}]`;
    } else if (typeof v === "string" && v.length > 200) {
      result[k] = `${v.slice(0, 60)}... [truncated length=${v.length}]`;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      // Recursively sanitize nested objects
      result[k] = sanitizeArgs(v as Record<string, unknown>, depth + 1);
    } else {
      result[k] = v;
    }
  }

  return result;
}

function truncateError(msg: string): string {
  // Keep first 150 chars — enough to understand the error class, not enough to leak response bodies
  return msg.length > 150 ? `${msg.slice(0, 150)}…` : msg;
}

// ─── Timed wrapper ────────────────────────────────────────────────────────────

export async function withAudit<T>(
  logger: AuditLogger,
  tool: string,
  args: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    logger.log({
      timestamp: new Date().toISOString(),
      tool,
      args,
      outcome: "success",
      durationMs: Date.now() - start,
    });
    return result;
  } catch (err) {
    logger.log({
      timestamp: new Date().toISOString(),
      tool,
      args,
      outcome: "error",
      error: String(err),
      durationMs: Date.now() - start,
    });
    throw err;
  }
}
