// src/tools/introspect.ts
// Introspection tools — OpenAPI discovery, policy management, cache control.
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

        // Try cache first
        if (cache && !args.force_refresh) {
          const cached = cache.get(cacheKey);
          if (cached) {
            const result = cached as any;
            return {
              content: [{
                type: "text" as const,
                text: `*(from cache)*\n\n${formatDiscoveryResult(result)}`,
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
                `Tried the following locations:`,
                `- \`/.well-known/openapi.json\``,
                `- \`/openapi.json\``,
                `- \`/openapi.yaml\``,
                `- \`/swagger.json\``,
                `- \`/api-docs/json\``,
                ``,
                `Your API may not expose an OpenAPI spec. You'll need to configure endpoints manually in \`cms-mcp.config.json\`.`,
                ``,
                `If your spec is at a custom URL, set \`openapi.discoveryUrl\` in your config.`,
              ].join("\n"),
            }],
          };
        }

        // Store in cache
        if (cache) {
          cache.set(cacheKey, result);
        }

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
      confirm: z.literal(true).describe("Must be true to write changes to disk"),
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

        if (!discoveryResult || Object.keys(discoveryResult.suggestedEndpointConfig).length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No endpoints could be discovered. Run `discover_api` first and check the output.",
            }],
          };
        }

        // Read and update config file
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
                ([k, v]) => `  • ${k}: ${v}`
              ),
              ``,
              `Restart cms-mcp to use the updated config.`,
            ].join("\n"),
          }],
        };
      });
    },
  );

  // ── check_policies ────────────────────────────────────────────────────────

  server.tool(
    "check_policies",
    {
      tool: z.string().describe("The write tool name to check against (e.g. 'publish_blog')"),
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
    async (args) => {
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
    async (args) => {
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
            text: `🗑️ Cleared ${cleared} cache entries. Next \`discover_api\` call will re-fetch live.`,
          }],
        };
      });
    },
  );

  // ── inspect_endpoint_schema ───────────────────────────────────────────────

  server.tool(
    "inspect_endpoint_schema",
    {
      endpoint: z.enum(["projects", "blogs", "media"])
        .describe("Which configured endpoint to inspect — fetches live records and infers field types"),
    },
    async (args) => {
      return withAudit(audit, "inspect_endpoint_schema", args as Record<string, unknown>, async () => {
        const endpointUrl = config.endpoints[args.endpoint as keyof typeof config.endpoints];

        if (!endpointUrl) {
          return {
            content: [{
              type: "text" as const,
              text: [
                `No \`${args.endpoint}\` endpoint configured.`,
                ``,
                `Add it to your cms-mcp.config.json:`,
                `\`\`\`json`,
                `"endpoints": { "${args.endpoint}": "/${args.endpoint}" }`,
                `\`\`\``,
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
}
