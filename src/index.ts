#!/usr/bin/env node
// src/index.ts
// cms-mcp v1.0.0 entry point.
//
// v1.0.0 changes:
//   - 5-tool model per endpoint: list_X, get_X, create_X, update_X, delete_X
//   - legacyMode: true keeps v0.5 mutate_X combined tool
//   - CMSAdapter: per-endpoint fieldMap and updateMethod (PATCH/PUT)
//   - SecretManager: secrets tokenized after loadConfig() — never plain-text
//   - CompensatingTransaction: honest rollback with CriticalInconsistencyError
//   - SSRF v2: explicit port whitelist, cloud metadata block, null-byte detection
//   - Schema merging: 20-record sampling, inconsistent fields always .optional()
//   - Full interactive `npx cms-mcp init` wizard (readline/promises)

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
import { introspectAndRegisterAll } from "./lib/startup-introspect.js";
import { registerMediaTools } from "./tools/media.js";
import { registerIntrospectTools } from "./tools/introspect.js";
import { runInit } from "./cli/init.js";
import { loadPlugins } from "./plugins/index.js";

// ─── Parse CLI flags ──────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

// `npx cms-mcp init` — run setup wizard and exit
if (argv[0] === "init") {
  const configIdx  = argv.findIndex((a) => a === "--config" || a === "-c");
  const baseUrlIdx = argv.findIndex((a) => a === "--base-url" || a === "-u");
  runInit({
    config:  configIdx  !== -1 ? argv[configIdx  + 1] : undefined,
    baseUrl: baseUrlIdx !== -1 ? argv[baseUrlIdx + 1] : argv[1] && !argv[1].startsWith("-") ? argv[1] : undefined,
  }).catch((err: unknown) => {
    process.stderr.write(`[cms-mcp] init error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else {
  main().catch((err: unknown) => {
    process.stderr.write(`[cms-mcp] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}

const readOnlyFlag   = argv.includes("--readonly") || argv.includes("--read-only");
const webhookFlag    = argv.includes("--webhook");
const noDiscoverFlag = argv.includes("--no-discover");
const approvalFlag   = argv.includes("--approval");

const configFlag = (() => {
  const idx = argv.findIndex((a) => a === "--config" || a === "-c");
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  // Guard: next token must exist and not be another flag
  return next && !next.startsWith("-") ? next : undefined;
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
    process.stderr.write(`[cms-mcp] Tip: Run \`npx cms-mcp init --base-url <url>\` to generate a starter config.\n`);
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

  // ── Vector Cache (Semantic Search — optional) ───────────────────────────────
  let vectorCache: VectorCache | undefined;
  if (config.schemaCache) {
    const vectorPath = config.schemaCache.path.replace(/\.db$/, "-vectors.db");
    vectorCache = new VectorCache(vectorPath, embedFn);
  }

  // ── Approval Gate (optional) ───────────────────────────────────────────────
  let gate: ApprovalGate | null = null;
  if (approvalFlag || config.approvals) {
    const port      = config.approvals?.port ?? 2323;
    const timeoutMs = config.approvals?.timeoutMs ?? 300_000;
    gate = new ApprovalGate(port, timeoutMs);
    try {
      await gate.start();
    } catch (err) {
      process.stderr.write(
        `  [approval-gate] Failed to start on port ${config.approvals?.port ?? 2323}: ` +
        `${err instanceof Error ? err.message : String(err)}\n` +
        `  [approval-gate] Continuing without approval gate.\n\n`,
      );
      gate = null;
    }
  }

  // ── MCP Server ─────────────────────────────────────────────────────────────
  const server = new McpServer({
    name:    "cms-mcp",
    version: "1.0.0",
    description:
      "Universal CMS bridge for any REST API. 5 schema-driven tools per endpoint " +
      "(list, get, create, update, delete), built from OpenAPI spec or 20-record live " +
      "introspection with schema merging. CMSAdapter field mapping, SecretManager, " +
      "CompensatingTransaction rollback, SSRF v2. Optional plugins: approval gate, " +
      "policies, semantic search, GitHub sync.",
  });

  // ── MCP Resources ──────────────────────────────────────────────────────────
  registerResources(server, config, vectorCache);

  // ── Optional plugin tools (registered only when config block present) ───────
  // Must run BEFORE introspectAndRegisterAll so the PolicyEngine can be passed
  // to write tools during endpoint registration.
  const pluginSummary = await loadPlugins(server, config, audit, { vectorCache, breaker });
  const { policyEngine } = pluginSummary;

  // ── Generic resource tools (schema-driven, 5 per endpoint) ──────────────────
  const introspectSummary = await introspectAndRegisterAll(server, config, audit, gate, schemaCache, policyEngine);

  // ── Always-on tools ────────────────────────────────────────────────────────
  registerMediaTools(server, config, audit);
  registerIntrospectTools(server, config, audit, schemaCache);

  // ── Startup Banner ─────────────────────────────────────────────────────────
  const mode = config.readOnly ? " [READ-ONLY]" : "";
  const plugins: string[] = [];
  if (schemaCache)      plugins.push("schema-cache");
  if (config.policies)  plugins.push("policies");
  if (gate)             plugins.push("approval-gate");
  if (config.webhook)   plugins.push("webhook");
  plugins.push(...pluginSummary.active);

  process.stderr.write(`\n`);
  process.stderr.write(`  ┌──────────────────────────────────────┐\n`);
  process.stderr.write(`  │  cms-mcp v1.0.0${mode.padEnd(21)}│\n`);
  process.stderr.write(`  └──────────────────────────────────────┘\n`);
  process.stderr.write(`  Base URL:  ${config.baseUrl}\n`);
  if (plugins.length > 0)
    process.stderr.write(`  Plugins:   ${plugins.join(", ")}\n`);
  if (gate)
    process.stderr.write(`  Approvals: http://127.0.0.1:${config.approvals?.port ?? 2323}\n`);
  if (config.auditLog)
    process.stderr.write(`  Audit log: ${config.auditLog}\n`);

  // Per-endpoint schema tier summary
  if (introspectSummary.fromOpenApi.length > 0)
    process.stderr.write(`  OpenAPI:   ${introspectSummary.fromOpenApi.join(", ")} (spec-sourced)\n`);
  if (introspectSummary.registered.filter((k) => !introspectSummary.fromOpenApi.includes(k)).length > 0) {
    const sampled = introspectSummary.registered.filter((k) => !introspectSummary.fromOpenApi.includes(k));
    process.stderr.write(`  Sampled:   ${sampled.join(", ")} (live introspection)\n`);
  }
  if (introspectSummary.coldStart.length > 0)
    process.stderr.write(`  Cold-start:${introspectSummary.coldStart.join(", ")} (passthrough mode)\n`);
  if (introspectSummary.failed.length > 0)
    process.stderr.write(`  Failed:    ${introspectSummary.failed.join(", ")} (tools not registered)\n`);
  if (introspectSummary.skipped.length > 0)
    process.stderr.write(`  Skipped:   ${introspectSummary.skipped.join(", ")} (reserved)\n`);

  process.stderr.write(`\n`);

  // ── OpenAPI Auto-Discovery (background) ────────────────────────────────────
  if (!noDiscoverFlag && config.openapi?.autoDiscover !== false) {
    const cacheKey = openApiCacheKey(config.baseUrl);
    const cached = schemaCache?.get(cacheKey);

    if (!cached) {
      discoverOpenApi(config.baseUrl, config.openapi?.discoveryUrl).then((result) => {
        if (result) {
          process.stderr.write(
            `  [discovery] Found: ${result.title} (${result.rawPathCount} paths, ` +
            `${result.resources.length} resources)\n\n`,
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

  process.on("SIGINT",  shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  process.stderr.write("  [ready] Waiting for MCP messages.\n\n");
}
