// src/plugins/policy.ts
// Policy engine plugin — re-exports policy tools registration.
// The policy engine tools (check_policies, init_policies) are registered
// directly via registerIntrospectTools in the always-on tools section,
// but policy enforcement runs inside mutate_X handlers through the
// policies config key.
//
// This module exists for completeness in the plugin architecture — it
// documents the plugin boundary and provides a typed check for whether
// the policy plugin is active.

import type { Config } from "../lib/config.js";

/** Returns true if the policy plugin is configured and active. */
export function isPolicyPluginActive(config: Config): boolean {
  return Boolean(config.policies);
}

/** Human-readable summary of the policy plugin state. */
export function policyPluginSummary(config: Config): string {
  if (!config.policies) return "policy: inactive (no config.policies path)";
  return `policy: active (rules file: ${config.policies})`;
}
