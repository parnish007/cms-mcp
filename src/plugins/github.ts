// src/plugins/github.ts
// GitHub plugin — wraps tool registration from src/tools/github.ts.
// Only loaded when config.github is present.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import type { AuditLogger } from "../lib/audit.js";
import { registerGitHubTools } from "../tools/github.js";

export function registerGitHubPlugin(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
): void {
  registerGitHubTools(server, config, audit);
}
