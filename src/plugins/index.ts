// src/plugins/index.ts
// Plugin loader — registers optional MCP tools based on config blocks.
//
// Each plugin is a thin wrapper around the existing tool-registration module.
// A plugin is only loaded when its required config key is present.
//
// Usage (from src/index.ts):
//
//   const { summary, policyEngine } = await loadPlugins(server, config, audit, { vectorCache, breaker });
//   // summary.active → string[] of active plugin names for the startup banner
//   // policyEngine   → PolicyEngine | null — passed to write tools for auto-enforcement

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import type { AuditLogger } from "../lib/audit.js";
import type { VectorCache } from "../lib/vector-cache.js";
import type { CircuitBreaker } from "../lib/circuit-breaker.js";
import type { PolicyEngine } from "./policy-engine.js";

export { startApprovalPlugin } from "./approval.js";
export { registerPolicyPlugin } from "./policy.js";
export { registerSearchPlugin } from "./search.js";
export { registerGitHubPlugin } from "./github.js";

// ─── Plugin dependencies ──────────────────────────────────────────────────────

export interface PluginDeps {
  vectorCache?: VectorCache;
  breaker?: CircuitBreaker;
}

export interface PluginSummary {
  active: string[];
  policyEngine: PolicyEngine | null;
}

// ─── Unified loader ───────────────────────────────────────────────────────────

/**
 * Load all configured optional plugins in one call.
 * Returns the list of active plugin names for the startup banner,
 * and the PolicyEngine instance (if policies are configured) for write tools.
 */
export async function loadPlugins(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  deps: PluginDeps,
): Promise<PluginSummary> {
  const active: string[] = [];
  let policyEngine: PolicyEngine | null = null;

  // Policy plugin — always registered so check_policies / init_policies are available.
  // Returns the engine even when config.policies is absent (engine will be null,
  // but the tools still respond with a helpful "not configured" message).
  {
    const { registerPolicyPlugin } = await import("./policy.js");
    policyEngine = registerPolicyPlugin(server, config, audit);
    if (policyEngine) active.push("policies");
  }

  // Lazy imports so plugin modules don't pollute startup if not needed
  if (config.github) {
    const { registerGitHubPlugin } = await import("./github.js");
    registerGitHubPlugin(server, config, audit);
    active.push("github");
  }

  if (config.schemaCache) {
    const { registerSearchPlugin } = await import("./search.js");
    registerSearchPlugin(server, config, audit, deps.vectorCache, deps.breaker);
    active.push(deps.vectorCache && (config.embedding?.provider === "openai") ? "openai-embeddings" : "tfidf-search");
  }

  return { active, policyEngine };
}
