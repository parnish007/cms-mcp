// src/plugins/policy.ts
// Policy plugin — thin wrapper that wires PolicyEngine into the plugin system.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import type { AuditLogger } from "../lib/audit.js";
import { createPolicyEngine, registerPolicyTools, type PolicyEngine } from "./policy-engine.js";

/** Returns true if the policy plugin is configured and active. */
export function isPolicyPluginActive(config: Config): boolean {
  return Boolean(config.policies);
}

/** Human-readable summary of the policy plugin state. */
export function policyPluginSummary(config: Config): string {
  if (!config.policies) return "policy: inactive (no config.policies path)";
  return `policy: active (rules file: ${config.policies})`;
}

/**
 * Register the policy plugin.
 * Creates a PolicyEngine (if config.policies is set), registers check_policies
 * and init_policies MCP tools, and returns the engine for use by write tools.
 */
export function registerPolicyPlugin(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
): PolicyEngine | null {
  const engine = createPolicyEngine(config);
  registerPolicyTools(server, config, audit, engine);
  return engine;
}
