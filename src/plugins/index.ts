// src/plugins/index.ts
// Plugin loader — registers optional MCP tools based on config blocks.
//
// Each plugin is a thin wrapper around the existing tool-registration module.
// A plugin is only loaded when its required config key is present.
//
// Usage (from src/index.ts):
//
//   const pluginSummary = loadPlugins(server, config, audit, { vectorCache, breaker });
//   // pluginSummary.active → string[] of active plugin names for the startup banner

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import type { AuditLogger } from "../lib/audit.js";
import type { VectorCache } from "../lib/vector-cache.js";
import type { CircuitBreaker } from "../lib/circuit-breaker.js";

export { registerApprovalPlugin } from "./approval.js";
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
}

// ─── Unified loader ───────────────────────────────────────────────────────────

/**
 * Load all configured optional plugins in one call.
 * Returns the list of active plugin names for the startup banner.
 */
export async function loadPlugins(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  deps: PluginDeps,
): Promise<PluginSummary> {
  const active: string[] = [];

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

  return { active };
}
