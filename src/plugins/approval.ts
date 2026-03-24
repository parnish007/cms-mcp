// src/plugins/approval.ts
// Approval gate plugin — lifecycle helper for the ApprovalGate class.
// The gate itself intercepts writes inside generic-resource.ts via checkGate().
// This module handles startup / shutdown and provides a factory with config validation.

import { ApprovalGate } from "../lib/approval-gate.js";
import type { Config } from "../lib/config.js";

export interface ApprovalPluginResult {
  gate: ApprovalGate | null;
  port: number;
}

/**
 * Start the approval gate if configured.
 * Returns null gate on startup failure (non-fatal — server continues without gate).
 */
export async function startApprovalPlugin(
  config: Config,
  forceEnable = false,
): Promise<ApprovalPluginResult> {
  if (!forceEnable && !config.approvals) {
    return { gate: null, port: 2323 };
  }

  const port      = config.approvals?.port ?? 2323;
  const timeoutMs = config.approvals?.timeoutMs ?? 300_000;
  const gate      = new ApprovalGate(port, timeoutMs);

  try {
    await gate.start();
    return { gate, port };
  } catch (err) {
    process.stderr.write(
      `  [approval-gate] Failed to start on port ${port}: ` +
      `${err instanceof Error ? err.message : String(err)}\n` +
      `  [approval-gate] Continuing without approval gate.\n\n`,
    );
    return { gate: null, port };
  }
}
