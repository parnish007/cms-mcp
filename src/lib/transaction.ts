// src/lib/transaction.ts
// Compensating Transaction engine.
//
// Terminology note: this is deliberately called a "Compensating Transaction"
// rather than an "Atomic Transaction" to be honest about what it actually is.
//
// True atomicity means "all-or-nothing at the database level." Over REST APIs,
// we cannot guarantee that. What we CAN do is:
//   1. Track every side effect (created/modified resource)
//   2. If the operation fails, attempt to reverse those side effects
//   3. If reversal also fails, surface a CRITICAL_INCONSISTENCY with the
//      IDs of orphaned resources so a human can clean up manually
//
// This is the definition of a "compensating transaction" in distributed systems.
// No lying about atomicity.

import type { ApiClient } from "./api-client.js";

export type RollbackFn = () => Promise<void>;

export interface CompensatingStep {
  description: string;
  rollback: RollbackFn;
}

// ─── CRITICAL_INCONSISTENCY ───────────────────────────────────────────────────

/**
 * Thrown when both the original operation AND the rollback fail.
 * This means the system is in an unknown state — some resources may have
 * been created/modified and cannot be automatically reversed.
 *
 * The `orphanedIds` field lists resources that need manual cleanup.
 */
export class CriticalInconsistencyError extends Error {
  readonly code = "CRITICAL_INCONSISTENCY" as const;

  constructor(
    readonly orphanedIds: string[],
    readonly rollbackFailures: Array<{ step: string; error: string }>,
    readonly originalError: string,
  ) {
    const idList = orphanedIds.length > 0
      ? `Orphaned resource IDs requiring manual cleanup: ${orphanedIds.join(", ")}.`
      : "No resource IDs could be extracted.";

    super(
      `[CRITICAL_INCONSISTENCY] Operation failed AND rollback failed. ` +
      `${idList} ` +
      `Rollback failures: ${rollbackFailures.map((f) => `${f.step} (${f.error})`).join("; ")}. ` +
      `Original error: ${originalError}`
    );
  }
}

// ─── CompensatingTransaction ──────────────────────────────────────────────────

export class CompensatingTransaction {
  readonly #steps: CompensatingStep[] = [];
  readonly #orphanedIds: string[] = [];
  #committed = false;

  /**
   * Register a compensating step. Call this IMMEDIATELY after each
   * successful side effect so the rollback has what it needs.
   *
   * @param description  Human-readable description for logs and error messages.
   * @param rollback     Async function that reverses the side effect.
   * @param resourceId   Optional: the ID of the resource created/modified.
   *                     Captured for CRITICAL_INCONSISTENCY reporting.
   */
  addStep(description: string, rollback: RollbackFn, resourceId?: string): void {
    if (this.#committed) {
      throw new Error("[CompensatingTransaction] Cannot add steps after commit.");
    }
    this.#steps.push({ description, rollback });
    if (resourceId) this.#orphanedIds.push(resourceId);
    process.stderr.write(`[compensating-tx] Step registered: ${description}\n`);
  }

  /**
   * Mark the transaction as successfully completed.
   * After commit, rollback is a no-op.
   */
  commit(): void {
    this.#committed = true;
    process.stderr.write(`[compensating-tx] Committed (${this.#steps.length} steps).\n`);
  }

  /**
   * Attempt to reverse all registered steps in reverse order.
   * If all rollbacks succeed → returns a clean RollbackReport.
   * If any rollback fails → returns a report with failures (caller decides).
   */
  async rollback(reason: string): Promise<RollbackReport> {
    if (this.#committed) {
      return { reason, rolled_back: [], failed: [], orphanedIds: [] };
    }

    process.stderr.write(
      `[compensating-tx] Compensating ${this.#steps.length} step(s). Reason: ${reason}\n`
    );

    const reversed = [...this.#steps].reverse();
    const rolledBack: string[] = [];
    const failed: Array<{ step: string; error: string }> = [];

    for (const step of reversed) {
      try {
        await step.rollback();
        rolledBack.push(step.description);
        process.stderr.write(`[compensating-tx] ✅ Compensated: ${step.description}\n`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failed.push({ step: step.description, error: errMsg });
        process.stderr.write(
          `[compensating-tx] ❌ Compensation failed for "${step.description}": ${errMsg}\n`
        );
      }
    }

    return { reason, rolled_back: rolledBack, failed, orphanedIds: [...this.#orphanedIds] };
  }
}

export interface RollbackReport {
  reason: string;
  rolled_back: string[];
  failed: Array<{ step: string; error: string }>;
  orphanedIds: string[];
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Creates a compensating step that DELETEs a resource by ID.
 * Use when you've just created a resource and need to be able to undo it.
 */
export function deleteRollback(client: ApiClient, endpoint: string, id: string): RollbackFn {
  return async () => {
    await client.delete(`${endpoint}/${id}`);
  };
}

/**
 * Creates a compensating step that PATCHes a resource back to its original state.
 * Use when you've just modified a resource and need to be able to undo it.
 */
export function restoreRollback(
  client: ApiClient,
  endpoint: string,
  id: string,
  originalData: Record<string, unknown>,
): RollbackFn {
  return async () => {
    await client.patch(`${endpoint}/${id}`, originalData);
  };
}

// ─── runWithCompensation ──────────────────────────────────────────────────────

/**
 * Runs an async function with a CompensatingTransaction.
 *
 * On success: commits and returns the result.
 *
 * On failure: attempts rollback.
 *   - If rollback succeeds: throws with clean error message.
 *   - If rollback partially fails: throws CriticalInconsistencyError with
 *     orphaned resource IDs for manual cleanup.
 */
export async function runWithCompensation<T>(
  fn: (tx: CompensatingTransaction) => Promise<T>,
): Promise<T> {
  const tx = new CompensatingTransaction();

  try {
    const result = await fn(tx);
    tx.commit();
    return result;
  } catch (err) {
    const originalError = err instanceof Error ? err.message : String(err);
    const report = await tx.rollback(originalError);

    if (report.failed.length > 0) {
      // Rollback itself failed — we're in an inconsistent state
      throw new CriticalInconsistencyError(
        report.orphanedIds,
        report.failed,
        originalError,
      );
    }

    // Rollback succeeded — surface a clean error
    const rolledBackSummary = report.rolled_back.length > 0
      ? ` Rolled back: ${report.rolled_back.join(", ")}.`
      : "";

    throw new Error(`${originalError}${rolledBackSummary}`);
  }
}

// ─── Backward-compatible aliases ──────────────────────────────────────────────
// Keep old names working so existing callers don't break immediately.

/** @deprecated Use CompensatingTransaction */
export const Transaction = CompensatingTransaction;

/** @deprecated Use runWithCompensation */
export const runWithTransaction = runWithCompensation;
