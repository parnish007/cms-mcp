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
import { loadPolicies, runPolicies, buildExamplePolicies } from "../lib/policy.js";
import type { SchemaCache } from "../lib/schema-cache.js";
import { openApiCacheKey } from "../lib/schema-cache.js";
import { ApiClient } from "../lib/api-client.js";
import { inspectEndpoint } from "../lib/schema-inspector.js";
import { refreshResourceSchema } from "../lib/startup-introspect.js";

export function registerIntrospectTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  cache?: SchemaCache,
): void {
  const client = new ApiClient(config);

  // ── discover_api ──────────────────────────────────────────────────────────

  server.tool(
    "discover_api",
    {
      force_refresh: z.boolean().default(false)
        .describe("Bypass cache and re-fetch the OpenAPI spec"),
      base_url: z.string().url().optional()
        .describe("Override the baseUrl from config for discovery"),
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

  server.tool(
    "apply_discovered_endpoints",
    {
      config_path: z.string().describe("Path to the cms-mcp.config.json to update"),
      confirm:     z.literal(true).describe("Must be true to write changes to disk"),
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

  server.tool(
    "inspect_endpoint_schema",
    {
      endpoint: z.string()
        .describe(
          "Endpoint key from your config to inspect (e.g. \"blogs\", \"projects\", \"products\"). " +
          "Fetches live records and infers field types, enums, and required/optional status.",
        ),
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

  server.tool(
    "refresh_resource_schema",
    {
      resource_key: z.string()
        .describe(
          "The endpoint key to re-introspect (e.g. \"blogs\", \"products\"). " +
          "Invalidates the cached schema and fetches fresh field types from the live API.",
        ),
      confirm: z.literal(true)
        .describe("Must be true to proceed"),
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

  server.tool(
    "list_configured_endpoints",
    {},
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
          `\`list_X\`, \`get_X\`, \`preview_create_X\`, \`create_X\`, ` +
          `\`preview_update_X\`, \`update_X\`, \`delete_X\``,
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      });
    },
  );

  // ── check_policies ────────────────────────────────────────────────────────

  server.tool(
    "check_policies",
    {
      tool: z.string().describe("The write tool name to check against (e.g. 'publish_blogs')"),
      data: z.record(z.unknown()).describe("The data payload to validate against policies"),
    },
    async (args) => {
      return withAudit(audit, "check_policies", args as Record<string, unknown>, async () => {
        if (!config.policies) {
          return {
            content: [{
              type: "text" as const,
              text: "No policies file configured. Add `\"policies\": \"./cms-mcp.policies.json\"` to your config.",
            }],
          };
        }

        const policies = loadPolicies(config.policies);
        const result = runPolicies(policies, args.tool, args.data as Record<string, unknown>);

        return {
          content: [{ type: "text" as const, text: result.formatted }],
        };
      });
    },
  );

  // ── init_policies ─────────────────────────────────────────────────────────

  server.tool(
    "init_policies",
    {
      output_path: z.string().default("./cms-mcp.policies.json")
        .describe("Where to write the example policies file"),
      confirm: z.literal(true).describe("Must be true to write to disk"),
    },
    async (args) => {
      if (config.readOnly) {
        return { content: [{ type: "text" as const, text: "🔒 Disabled in read-only mode." }] };
      }

      return withAudit(audit, "init_policies", args as Record<string, unknown>, async () => {
        if (existsSync(args.output_path)) {
          return {
            content: [{
              type: "text" as const,
              text: `Policy file already exists at ${args.output_path}. Delete it first or edit it directly.`,
            }],
          };
        }

        const example = buildExamplePolicies();
        writeFileSync(args.output_path, JSON.stringify(example, null, 2) + "\n", "utf-8");

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ Example policies written to ${args.output_path}`,
              ``,
              `Add this to cms-mcp.config.json:`,
              `  "policies": "${args.output_path}"`,
              ``,
              `Then edit the rules to match your team's requirements.`,
              `Use \`check_policies\` to test rules before committing.`,
            ].join("\n"),
          }],
        };
      });
    },
  );

  // ── cache_stats ───────────────────────────────────────────────────────────

  server.tool(
    "cache_stats",
    {},
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

  server.tool(
    "clear_cache",
    {
      confirm: z.literal(true).describe("Must be true to clear all cache entries"),
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
