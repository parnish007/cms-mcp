// src/plugins/search.ts
// Semantic search plugin — wraps tool registration from src/tools/search.ts.
// Only loaded when config.schemaCache is present.
// Provides: semantic_search, sync_all_content, knowledge_status

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import type { AuditLogger } from "../lib/audit.js";
import type { VectorCache } from "../lib/vector-cache.js";
import type { CircuitBreaker } from "../lib/circuit-breaker.js";
import { registerSearchTools } from "../tools/search.js";

export function registerSearchPlugin(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  vectorCache: VectorCache | undefined,
  breaker: CircuitBreaker | undefined,
): void {
  registerSearchTools(server, config, audit, vectorCache, breaker);
}
