#!/usr/bin/env node
// src/index.ts
// cms-mcp v0.3.0 entry point.
// Wires all tools, resources, circuit breaker, vector cache, schema cache,
// OpenAPI discovery, webhook server, approval gate, and stdio transport.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

import { loadConfig, expandHome } from "./lib/config.js";
import { AuditLogger } from "./lib/audit.js";
import { CircuitBreaker } from "./lib/circuit-breaker.js";
import { SchemaCache, openApiCacheKey } from "./lib/schema-cache.js";
import { VectorCache } from "./lib/vector-cache.js";
import { createOpenAIEmbedFn } from "./lib/embeddings.js";
import { ApprovalGate } from "./lib/approval-gate.js";
import { discoverOpenApi } from "./lib/openapi.js";
import { startWebhookServer } from "./lib/webhook.js";
import { registerResources } from "./lib/resources.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerBlogTools } from "./tools/blogs.js";
import { registerMediaTools } from "./tools/media.js";
import { registerGitHubTools } from "./tools/github.js";
import { registerIntrospectTools } from "./tools/introspect.js";
import { registerSearchTools } from "./tools/search.js";

// ─── Parse CLI flags ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const readOnlyFlag   = args.includes("--readonly") || args.includes("--read-only");
const webhookFlag    = args.includes("--webhook");
const noDiscoverFlag = args.includes("--no-discover");
const approvalFlag   = args.includes("--approval");

const configFlag = (() => {
  const idx = args.findIndex((a) => a === "--config" || a === "-c");
  return idx !== -1 ? args[idx + 1] : undefined;
})();

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function main() {
  let explicitConfigPath: string | undefined;
  if (configFlag) {
    const abs = resolve(configFlag);
    if (existsSync(abs)) {
      process.chdir(abs.replace(/[/\\][^/\\]+$/, ""));
      explicitConfigPath = abs;
    }
  }

  // ── Config ─────────────────────────────────────────────────────────────────
  let config;
  try {
    config = loadConfig(explicitConfigPath);
  } catch (err: unknown) {
    process.stderr.write(`[cms-mcp] Config error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  if (readOnlyFlag) config.readOnly = true;

  // ── Audit ──────────────────────────────────────────────────────────────────
  const audit = new AuditLogger(config.auditLog ? expandHome(config.auditLog) : undefined);

  // ── Circuit Breaker ────────────────────────────────────────────────────────
  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    name: "cms-api",
  });

  // ── Schema Cache (SQLite) ──────────────────────────────────────────────────
  let schemaCache: SchemaCache | undefined;
  if (config.schemaCache) {
    schemaCache = new SchemaCache(config.schemaCache.path, config.schemaCache.ttlMinutes);
  }

  // ── Embedding provider (optional OpenAI) ───────────────────────────────────
  const embedFn = config.embedding?.provider === "openai"
    ? createOpenAIEmbedFn(config.embedding.apiKey, config.embedding.model)
    : undefined;

  // ── Vector Cache (Semantic Search) ─────────────────────────────────────────
  let vectorCache: VectorCache | undefined;
  if (config.schemaCache) {
    const vectorPath = config.schemaCache.path.replace(/\.db$/, "-vectors.db");
    vectorCache = new VectorCache(vectorPath, embedFn);
  }

  // ── Approval Gate (Human-in-the-loop) ─────────────────────────────────────
  let gate: ApprovalGate | null = null;
  if (approvalFlag || config.approvals) {
    const port      = config.approvals?.port ?? 2323;
    const timeoutMs = config.approvals?.timeoutMs ?? 300_000;
    gate = new ApprovalGate(port, timeoutMs);
    try {
      await gate.start();
    } catch (err) {
      process.stderr.write(
        `  [approval-gate] Failed to start: ${err instanceof Error ? err.message : String(err)}\n` +
        `  [approval-gate] Continuing without approval gate.\n\n`,
      );
      gate = null;
    }
  }

  // ── MCP Server ─────────────────────────────────────────────────────────────
  const server = new McpServer({
    name: "cms-mcp",
    version: "0.3.0",
    description: "Universal agentic CMS server — manage blogs, projects, and media through Claude. " +
                 "Supports semantic search, OpenAPI discovery, policy enforcement, GitHub sync, " +
                 "and human-in-the-loop approval gates.",
  });

  // ── Register MCP Resources ─────────────────────────────────────────────────
  registerResources(server, config, vectorCache);

  // ── Register Tools ─────────────────────────────────────────────────────────
  registerProjectTools(server, config, audit, gate);
  registerBlogTools(server, config, audit, gate);
  registerMediaTools(server, config, audit);
  registerGitHubTools(server, config, audit);
  registerIntrospectTools(server, config, audit, schemaCache);
  registerSearchTools(server, config, audit, vectorCache, breaker);

  // ── Startup Banner ─────────────────────────────────────────────────────────
  const mode = config.readOnly ? " [READ-ONLY]" : "";
  const features: string[] = [];
  if (schemaCache)          features.push("schema-cache");
  if (vectorCache && embedFn) features.push("openai-embeddings");
  else if (vectorCache)     features.push("vector-search");
  if (config.policies)      features.push("policies");
  if (gate)                 features.push("approval-gate");
  if (config.webhook)       features.push("webhook-ready");

  process.stderr.write(`\n`);
  process.stderr.write(`  ┌─────────────────────────────────┐\n`);
  process.stderr.write(`  │  cms-mcp v0.3.0${mode.padEnd(17)}│\n`);
  process.stderr.write(`  └─────────────────────────────────┘\n`);
  process.stderr.write(`  Base URL:  ${config.baseUrl}\n`);
  if (features.length > 0)  process.stderr.write(`  Features:  ${features.join(", ")}\n`);
  if (gate)                 process.stderr.write(`  Approvals: http://127.0.0.1:${config.approvals?.port ?? 2323}\n`);
  if (config.auditLog)      process.stderr.write(`  Audit log: ${config.auditLog}\n`);
  process.stderr.write(`\n`);

  // ── OpenAPI Auto-Discovery ─────────────────────────────────────────────────
  if (!noDiscoverFlag && config.openapi?.autoDiscover !== false) {
    const cacheKey = openApiCacheKey(config.baseUrl);
    const cached = schemaCache?.get(cacheKey);

    if (!cached) {
      discoverOpenApi(config.baseUrl, config.openapi?.discoveryUrl).then((result) => {
        if (result) {
          process.stderr.write(
            `  [discovery] Found: ${result.title} (${result.rawPathCount} paths)\n` +
            `  [discovery] Resources: ${result.resources.map((r) => r.name).join(", ") || "none detected"}\n\n`
          );
          schemaCache?.set(cacheKey, result);
        }
      }).catch(() => {});
    } else {
      process.stderr.write(`  [discovery] OpenAPI spec loaded from cache\n\n`);
    }
  }

  // ── Webhook Server (optional) ──────────────────────────────────────────────
  let closeWebhook: (() => Promise<void>) | undefined;
  if (webhookFlag && config.webhook) {
    const wh = startWebhookServer(config, audit);
    closeWebhook = wh.close;
  } else if (webhookFlag && !config.webhook) {
    process.stderr.write(`  [webhook] --webhook flag set but no webhook config found.\n\n`);
  }

  // ── Transport ──────────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();

  // ── Shutdown ───────────────────────────────────────────────────────────────
  async function shutdown() {
    process.stderr.write("[cms-mcp] Shutting down…\n");
    await gate?.close();
    await closeWebhook?.();
    schemaCache?.close();
    vectorCache?.close();
    await server.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  process.stderr.write("  [ready] Waiting for MCP messages.\n\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`[cms-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
