// src/lib/transaction.ts
// Atomic transaction engine with automatic rollback.
// Tracks every created/modified resource. On failure, reverses all steps.

import type { ApiClient } from "./api-client.js";

export type RollbackFn = () => Promise<void>;

export interface TransactionStep {
  description: string;
  rollback: RollbackFn;
}

export class Transaction {
  private steps: TransactionStep[] = [];
  private committed = false;

  /**
   * Register a step and its rollback. Call this immediately after each
   * successful operation so rollback has what it needs.
   */
  addStep(description: string, rollback: RollbackFn): void {
    if (this.committed) {
      throw new Error("[transaction] Cannot add steps after commit.");
    }
    this.steps.push({ description, rollback });
    console.error(`[transaction] Step registered: ${description}`);
  }

  /**
   * Mark the transaction as fully successful. Disables rollback.
   */
  commit(): void {
    this.committed = true;
    console.error(`[transaction] Committed (${this.steps.length} steps).`);
  }

  /**
   * Walk steps in reverse order and execute each rollback.
   * Continues even if individual rollbacks fail — logs errors.
   */
  async rollback(reason: string): Promise<RollbackReport> {
    if (this.committed) {
      return { reason, rolled_back: [], failed: [] };
    }

    console.error(`[transaction] Rolling back ${this.steps.length} steps. Reason: ${reason}`);

    const reversed = [...this.steps].reverse();
    const rolledBack: string[] = [];
    const failed: Array<{ step: string; error: string }> = [];

    for (const step of reversed) {
      try {
        await step.rollback();
        rolledBack.push(step.description);
        console.error(`[transaction] ✅ Rolled back: ${step.description}`);
      } catch (err) {
        failed.push({ step: step.description, error: String(err) });
        console.error(`[transaction] ❌ Rollback failed for "${step.description}": ${err}`);
      }
    }

    return { reason, rolled_back: rolledBack, failed };
  }
}

export interface RollbackReport {
  reason: string;
  rolled_back: string[];
  failed: Array<{ step: string; error: string }>;
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Creates a rollback that DELETEs a resource by ID.
 */
export function deleteRollback(client: ApiClient, endpoint: string, id: string): RollbackFn {
  return async () => {
    await client.delete(`${endpoint}/${id}`);
  };
}

/**
 * Creates a rollback that PATCHes a resource back to its original state.
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

// ─── Run-with-transaction wrapper ─────────────────────────────────────────────

/**
 * Runs an async function with a Transaction. If it throws, automatically
 * rolls back all registered steps and re-throws with rollback info attached.
 */
export async function runWithTransaction<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = new Transaction();

  try {
    const result = await fn(tx);
    tx.commit();
    return result;
  } catch (err) {
    const report = await tx.rollback(String(err));

    const details = [
      `Original error: ${String(err)}`,
      `Rolled back: ${report.rolled_back.join(", ") || "none"}`,
      report.failed.length
        ? `Rollback failures: ${report.failed.map((f) => `${f.step} (${f.error})`).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    throw new Error(details);
  }
}
