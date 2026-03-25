// src/tools/introspect.ts
// Introspection tools — OpenAPI discovery, policy management, cache control,
// schema inspection, and on-demand schema refresh.
// These are the "meta" tools: they help Claude understand the CMS API itself.

import { z } from "zod";
import { writeFileSync, existsSync } from "fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { AuditLogger, withAudit } from "../lib/audit.js";
import { discoverOpenApi, formatDiscoveryResult } from "../lib/openapi.js";
import type { SchemaCache } from "../lib/schema-cache.js";
import { openApiCacheKey } from "../lib/schema-cache.js";
import { ApiClient } from "../lib/api-client.js";
import { inspectEndpoint } from "../lib/schema-inspector.js";
import { refreshResourceSchema } from "../lib/startup-introspect.js";
import { extractSchemaFromOpenApi, formatOpenApiSchema } from "../schema/openapi-parser.js";
import type { OpenApiDiscoveryResult } from "../lib/openapi.js";

export function registerIntrospectTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  cache?: SchemaCache,
): void {
  const client = new ApiClient(config);

  // ── discover_api ──────────────────────────────────────────────────────────

  server.registerTool(
    "discover_api",
    {
      description: "Probe your API for an OpenAPI/Swagger spec at common paths. Returns discovered resources, endpoint paths, and a suggested endpoints config block. Results are cached; use force_refresh: true to re-fetch.",
      inputSchema: {
        force_refresh: z.boolean().default(false)
          .describe("Bypass cache and re-fetch the OpenAPI spec"),
        base_url: z.string().url().optional()
          .describe("Override the baseUrl from config for discovery"),
      },
    },
    async (args) => {
      return withAudit(audit, "discover_api", args as Record<string, unknown>, async () => {
        const baseUrl = args.base_url ?? config.baseUrl;
        const cacheKey = openApiCacheKey(baseUrl);

        if (cache && !args.force_refresh) {
          const cached = cache.get(cacheKey);
          if (cached) {
            return {
              content: [{
                type: "text" as const,
                text: `*(from cache)*\n\n${formatDiscoveryResult(cached as any)}`,
              }],
            };
          }
        }

        const overrideUrl = config.openapi?.discoveryUrl;
        const result = await discoverOpenApi(baseUrl, overrideUrl);

        if (!result) {
          return {
            content: [{
              type: "text" as const,
              text: [
                `## No OpenAPI Spec Found`,
                ``,
                `Tried common locations (openapi.json, swagger.json, api-docs/json, etc.).`,
                ``,
                `Your API may not expose an OpenAPI spec. Configure endpoints manually in \`cms-mcp.config.json\`.`,
                `If your spec is at a custom URL, set \`openapi.discoveryUrl\` in your config.`,
              ].join("\n"),
            }],
          };
        }

        if (cache) cache.set(cacheKey, result);

        return {
          content: [{ type: "text" as const, text: formatDiscoveryResult(result) }],
        };
      });
    },
  );

  // ── apply_discovered_endpoints ────────────────────────────────────────────

  server.registerTool(
    "apply_discovered_endpoints",
    {
      description: "Write the endpoints discovered by discover_api into your cms-mcp.config.json. Merges with existing endpoints. Requires confirm: true.",
      inputSchema: {
        config_path: z.string().describe("Path to the cms-mcp.config.json to update"),
        confirm:     z.literal(true).describe("Must be true to write changes to disk"),
      },
    },
    async (args) => {
      if (config.readOnly) {
        return { content: [{ type: "text" as const, text: "🔒 Disabled in read-only mode." }] };
      }

      return withAudit(audit, "apply_discovered_endpoints", args as Record<string, unknown>, async () => {
        const cacheKey = openApiCacheKey(config.baseUrl);
        let discoveryResult = cache?.get<any>(cacheKey);

        if (!discoveryResult) {
          discoveryResult = await discoverOpenApi(config.baseUrl, config.openapi?.discoveryUrl);
          if (discoveryResult && cache) cache.set(cacheKey, discoveryResult);
        }

        if (!discoveryResult || Object.keys(discoveryResult.suggestedEndpointConfig ?? {}).length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No endpoints could be discovered. Run `discover_api` first and check the output.",
            }],
          };
        }

        if (!existsSync(args.config_path)) {
          return {
            content: [{ type: "text" as const, text: `Config file not found: ${args.config_path}` }],
          };
        }

        let currentConfig: Record<string, unknown>;
        try {
          const { readFileSync } = await import("fs");
          currentConfig = JSON.parse(readFileSync(args.config_path, "utf-8"));
        } catch {
          return {
            content: [{ type: "text" as const, text: "Failed to read config file." }],
          };
        }

        const merged = {
          ...currentConfig,
          endpoints: {
            ...(currentConfig.endpoints as Record<string, unknown> ?? {}),
            ...discoveryResult.suggestedEndpointConfig,
          },
        };

        writeFileSync(args.config_path, JSON.stringify(merged, null, 2) + "\n", "utf-8");

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ Endpoints applied to ${args.config_path}`,
              ``,
              `Added:`,
              ...Object.entries(discoveryResult.suggestedEndpointConfig).map(
                ([k, v]) => `  • ${k}: ${v}`,
              ),
              ``,
              `Restart cms-mcp to use the updated config.`,
            ].join("\n"),
          }],
        };
      });
    },
  );

  // ── inspect_endpoint_schema ───────────────────────────────────────────────
  // Now accepts ANY configured endpoint key — not limited to a hardcoded enum.

  server.registerTool(
    "inspect_endpoint_schema",
    {
      description: "Show the full schema for a configured endpoint — field names, types, required/optional status, examples. Uses OpenAPI spec if available (authoritative), otherwise samples up to 20 live records.",
      inputSchema: {
        endpoint: z.string()
          .describe(
            "Endpoint key from your config to inspect (e.g. \"blogs\", \"projects\", \"products\"). " +
            "Fetches live records and infers field types, enums, and required/optional status.",
          ),
      },
    },
    async (args) => {
      return withAudit(audit, "inspect_endpoint_schema", args as Record<string, unknown>, async () => {
        const endpoints = config.endpoints as Record<string, string | undefined>;
        const endpointUrl = endpoints[args.endpoint];

        if (!endpointUrl) {
          const configured = Object.keys(endpoints).join(", ") || "(none)";
          return {
            content: [{
              type: "text" as const,
              text: [
                `No \`${args.endpoint}\` endpoint configured.`,
                ``,
                `Currently configured endpoints: ${configured}`,
                ``,
                `Add it to your cms-mcp.config.json:`,
                `\`\`\`json`,
                `"endpoints": { "${args.endpoint}": "/${args.endpoint}" }`,
                `\`\`\``,
                ``,
                `Then restart cms-mcp.`,
              ].join("\n"),
            }],
          };
        }

        // Try OpenAPI spec first (most reliable — declared schema, not sampled)
        if (cache) {
          const discovery = cache.get<OpenApiDiscoveryResult>(openApiCacheKey(config.baseUrl));
          if (discovery?.rawSpec) {
            const openApiResult = extractSchemaFromOpenApi(discovery, config.baseUrl, endpointUrl);
            if (openApiResult && openApiResult.fields.length > 0) {
              return {
                content: [{ type: "text" as const, text: formatOpenApiSchema(openApiResult, endpointUrl) }],
              };
            }
          }
        }

        // Fall back to live sampling
        const report = await inspectEndpoint(client, endpointUrl);
        return {
          content: [{ type: "text" as const, text: report }],
        };
      });
    },
  );

  // ── refresh_resource_schema ───────────────────────────────────────────────
  // Invalidates the cached schema for a resource and re-introspects it.
  // Useful when records have been added since the cold-start, or when the
  // CMS schema has changed. Note: registered MCP tool shapes do NOT change
  // until the server is restarted — this only updates the SQLite cache.

  server.registerTool(
    "refresh_resource_schema",
    {
      description: "Invalidate the SQLite cache for one endpoint and re-introspect: cache → OpenAPI → 20-record sampling → cold-start. Restart cms-mcp after to apply updated tool shapes.",
      inputSchema: {
        resource_key: z.string()
          .describe(
            "The endpoint key to re-introspect (e.g. \"blogs\", \"products\"). " +
            "Invalidates the cached schema and fetches fresh field types from the live API.",
          ),
        confirm: z.literal(true)
          .describe("Must be true to proceed"),
      },
    },
    async (args) => {
      return withAudit(audit, "refresh_resource_schema", args as Record<string, unknown>, async () => {
        const endpoints = config.endpoints as Record<string, string | undefined>;
        const endpointUrl = endpoints[args.resource_key];

        if (!endpointUrl) {
          const configured = Object.keys(endpoints).join(", ") || "(none)";
          return {
            content: [{
              type: "text" as const,
              text: [
                `No \`${args.resource_key}\` endpoint configured.`,
                `Configured endpoints: ${configured}`,
              ].join("\n"),
            }],
          };
        }

        const schema = await refreshResourceSchema(
          client,
          args.resource_key,
          endpointUrl,
          config.baseUrl,
          cache,
        );

        if (schema.source === "cold-start") {
          return {
            content: [{
              type: "text" as const,
              text: [
                `⚠️ "${args.resource_key}" still has no records — schema remains in cold-start mode.`,
                ``,
                `Create at least one record in your CMS, then run \`refresh_resource_schema\` again.`,
                `Once the cache is warm, restart cms-mcp so tool shapes update.`,
              ].join("\n"),
            }],
          };
        }

        const fieldSummary = schema.fields
          .slice(0, 20)
          .map((f) => `  • \`${f.name}\` — ${f.type}${f.alwaysPresent ? "" : "?"}`)
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ Schema refreshed for "${args.resource_key}"`,
              ``,
              `Sampled ${schema.recordCount} record(s) — ${schema.fields.length} fields detected:`,
              fieldSummary,
              schema.fields.length > 20 ? `  … and ${schema.fields.length - 20} more` : "",
              ``,
              `**Restart cms-mcp** to apply the updated schema to tool input shapes.`,
            ].filter(Boolean).join("\n"),
          }],
        };
      });
    },
  );

  // ── list_configured_endpoints ─────────────────────────────────────────────
  // Quick overview of what endpoints are configured and which have schemas cached.

  server.registerTool(
    "list_configured_endpoints",
    {
      description: "Show a table of all configured endpoints with URL and schema cache status.",
    },
    async (_args) => {
      return withAudit(audit, "list_configured_endpoints", {}, async () => {
        const endpoints = config.endpoints as Record<string, string | undefined>;
        const keys = Object.keys(endpoints);

        if (keys.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No endpoints configured. Add entries to `endpoints` in cms-mcp.config.json.",
            }],
          };
        }

        const lines = [
          `## Configured Endpoints`,
          ``,
          `| Key | URL | Schema Cached |`,
          `|-----|-----|--------------|`,
        ];

        for (const key of keys) {
          const url = endpoints[key] ?? "(not set)";
          let cached = "—";
          if (cache) {
            const { resourceSchemaCacheKey } = await import("../lib/resource-schema.js");
            const entry = cache.get(resourceSchemaCacheKey(config.baseUrl, key));
            cached = entry ? "✓" : "—";
          }
          lines.push(`| \`${key}\` | \`${url}\` | ${cached} |`);
        }

        lines.push(
          ``,
          `Tools generated per endpoint (except \`media\`): ` +
          `\`list_X\`, \`get_X\`, \`create_X\`, \`update_X\`, \`delete_X\`` +
          ` (or \`mutate_X\` when \`legacyMode: true\`)`,
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      });
    },
  );

  // ── cache_stats ───────────────────────────────────────────────────────────

  server.registerTool(
    "cache_stats",
    {
      description: "Show SQLite schema cache statistics: entry count, expired count, and oldest entry age.",
    },
    async (_args) => {
      return withAudit(audit, "cache_stats", {}, async () => {
        if (!cache) {
          return {
            content: [{
              type: "text" as const,
              text: "Schema cache is not enabled. Add `schemaCache` to your config to enable it.",
            }],
          };
        }

        const stats = cache.stats();
        return {
          content: [{
            type: "text" as const,
            text: [
              `## Schema Cache Stats`,
              ``,
              `| Metric | Value |`,
              `|--------|-------|`,
              `| Total entries | ${stats.totalEntries} |`,
              `| Expired (not yet purged) | ${stats.expiredEntries} |`,
              `| Oldest entry | ${stats.oldestEntryAge} |`,
            ].join("\n"),
          }],
        };
      });
    },
  );

  // ── clear_cache ───────────────────────────────────────────────────────────

  server.registerTool(
    "clear_cache",
    {
      description: "Delete all SQLite schema cache entries. Forces full re-introspection on next startup. Requires confirm: true.",
      inputSchema: {
        confirm: z.literal(true).describe("Must be true to clear all cache entries"),
      },
    },
    async (_args) => {
      return withAudit(audit, "clear_cache", {}, async () => {
        if (!cache) {
          return {
            content: [{ type: "text" as const, text: "Schema cache is not enabled." }],
          };
        }

        const cleared = cache.invalidateAll();
        return {
          content: [{
            type: "text" as const,
            text: [
              `🗑️ Cleared ${cleared} cache entries.`,
              ``,
              `Next startup will re-introspect all endpoints.`,
              `Restart cms-mcp to pick up fresh schemas.`,
            ].join("\n"),
          }],
        };
      });
    },
  );
}
