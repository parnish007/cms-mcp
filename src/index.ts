#!/usr/bin/env node
// src/index.ts
// cms-mcp entry point — wires all tools, starts stdio transport, optional webhook.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, expandHome } from "./lib/config.js";
import { AuditLogger } from "./lib/audit.js";
import { SchemaCache } from "./lib/schema-cache.js";
import { discoverOpenApi } from "./lib/openapi.js";
import { openApiCacheKey } from "./lib/schema-cache.js";
import { startWebhookServer } from "./lib/webhook.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerBlogTools } from "./tools/blogs.js";
import { registerMediaTools } from "./tools/media.js";
import { registerGitHubTools } from "./tools/github.js";
import { registerIntrospectTools } from "./tools/introspect.js";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

// ─── Parse CLI flags ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const readOnlyFlag   = args.includes("--readonly") || args.includes("--read-only");
const webhookFlag    = args.includes("--webhook");
const noDiscoverFlag = args.includes("--no-discover");

const configFlag = (() => {
  const idx = args.findIndex((a) => a === "--config" || a === "-c");
  return idx !== -1 ? args[idx + 1] : undefined;
})();

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function main() {
  // If --config points to a specific file, resolve it and cd to its dir
  let explicitConfigPath: string | undefined;
  if (configFlag) {
    const abs = resolve(configFlag);
    if (existsSync(abs)) {
      process.chdir(abs.replace(/[/\\][^/\\]+$/, "")); // dirname
      explicitConfigPath = abs;
    }
  }

  // ── Load config ────────────────────────────────────────────────────────────
  let config;
  try {
    config = loadConfig(explicitConfigPath);
  } catch (err: unknown) {
    process.stderr.write(`[cms-mcp] Config error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  if (readOnlyFlag) config.readOnly = true;

  // ── Audit logger ───────────────────────────────────────────────────────────
  const audit = new AuditLogger(config.auditLog ? expandHome(config.auditLog) : undefined);

  // ── Schema cache (optional) ────────────────────────────────────────────────
  let cache: SchemaCache | undefined;
  if (config.schemaCache) {
    cache = new SchemaCache(
      config.schemaCache.path,
      config.schemaCache.ttlMinutes,
    );
  }

  // ── MCP Server ─────────────────────────────────────────────────────────────
  const server = new McpServer({ name: "cms-mcp", version: "0.2.0" });

  // ── Register tools ─────────────────────────────────────────────────────────
  registerProjectTools(server, config, audit);
  registerBlogTools(server, config, audit);
  registerMediaTools(server, config, audit);
  registerGitHubTools(server, config, audit);
  registerIntrospectTools(server, config, audit, cache);

  // ── Startup banner ─────────────────────────────────────────────────────────
  const mode = config.readOnly ? " [READ-ONLY]" : "";
  process.stderr.write(`\n[cms-mcp] v0.2.0 starting${mode}\n`);
  process.stderr.write(`[cms-mcp] Base URL: ${config.baseUrl}\n`);
  if (config.auditLog) process.stderr.write(`[cms-mcp] Audit log: ${config.auditLog}\n`);
  if (config.policies) process.stderr.write(`[cms-mcp] Policies: ${config.policies}\n`);
  if (config.schemaCache) process.stderr.write(`[cms-mcp] Schema cache: enabled\n`);

  // ── OpenAPI auto-discovery ─────────────────────────────────────────────────
  const shouldDiscover = !noDiscoverFlag && (config.openapi?.autoDiscover !== false);
  if (shouldDiscover) {
    const cacheKey = openApiCacheKey(config.baseUrl);
    const cached = cache?.get(cacheKey);

    if (!cached) {
      // Non-blocking background discovery
      discoverOpenApi(config.baseUrl, config.openapi?.discoveryUrl).then((result) => {
        if (result) {
          process.stderr.write(
            `[cms-mcp] OpenAPI spec discovered: ${result.title} (${result.rawPathCount} paths at ${result.specUrl})\n`
          );
          if (result.resources.length > 0) {
            process.stderr.write(
              `[cms-mcp] Detected resources: ${result.resources.map((r) => r.name).join(", ")}\n`
            );
          }
          cache?.set(cacheKey, result);
        }
      }).catch(() => {
        // Silently ignore — discovery is best-effort
      });
    } else {
      process.stderr.write(`[cms-mcp] OpenAPI spec loaded from cache\n`);
    }
  }

  // ── Webhook server (optional) ──────────────────────────────────────────────
  let closeWebhook: (() => Promise<void>) | undefined;
  if (webhookFlag && config.webhook) {
    const wh = startWebhookServer(config, audit);
    closeWebhook = wh.close;
  } else if (webhookFlag && !config.webhook) {
    process.stderr.write(
      `[cms-mcp] --webhook flag set but no "webhook" config found. Add webhook.port and webhook.secret.\n`
    );
  }

  // ── Stdio transport ────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  async function shutdown() {
    process.stderr.write("[cms-mcp] Shutting down…\n");
    await closeWebhook?.();
    cache?.close();
    await server.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  process.stderr.write("[cms-mcp] Ready. Waiting for MCP messages.\n\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`[cms-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
