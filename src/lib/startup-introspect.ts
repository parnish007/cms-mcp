// src/lib/startup-introspect.ts
// Startup orchestration — introspects every configured endpoint and registers
// generic resource tools for each one.
//
// Called once from index.ts during server boot, BEFORE the MCP transport
// connects (MCP tool schemas must be registered before the session handshake).
//
// === Schema resolution priority (OpenAPI-first) ===
//
//   Tier 1 — SQLite cache hit → use immediately (instant startup, no API calls)
//   Tier 2 — OpenAPI spec available → extract schema from spec ($ref-resolved)
//   Tier 3 — Live sampling → fetch 5 records, infer types from values
//   Tier 4 — Cold-start → passthrough mode (no schema, fields: Record<unknown>)
//
// Why OpenAPI first?
//   - Sampling infers types from up to 5 records. Optional fields that happen
//     to be null in all 5 samples are missed. Single-sample enum detection fails.
//     New/empty endpoints fall through to cold-start.
//   - OpenAPI declares every field, type, format, enum, required/optional, and
//     readOnly flag — zero false positives, no missing fields.
//
// "media" is skipped here because it has a dedicated upload handler (media-proxy)
// that requires custom tool logic beyond standard CRUD.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import type { AuditLogger } from "./audit.js";
import type { ApprovalGate } from "./approval-gate.js";
import type { SchemaCache } from "./schema-cache.js";
import { ApiClient } from "./api-client.js";
import { introspectResourceSchema } from "./schema-introspector.js";
import {
  resourceSchemaCacheKey,
  type ResourceSchema,
  type FieldDefinition,
} from "./resource-schema.js";
import {
  detectIdField,
  detectTitleField,
  detectStatusField,
} from "./type-inference.js";
import { registerGenericResourceTools } from "../tools/generic-resource.js";
import { openApiCacheKey } from "./schema-cache.js";
import type { OpenApiDiscoveryResult } from "./openapi.js";
import { extractSchemaFromOpenApi } from "../schema/openapi-parser.js";
import { detectRelations } from "./relation-detector.js";

// Keys that have dedicated tool files — skip the generic factory for these.
const RESERVED_KEYS = new Set(["media"]);

// ─── Summary ──────────────────────────────────────────────────────────────────

export interface IntrospectSummary {
  /** Endpoint keys successfully registered with full schema-driven tools. */
  registered: string[];
  /** Endpoint keys registered using OpenAPI spec (most reliable). */
  fromOpenApi: string[];
  /** Endpoint keys in cold-start mode (0 records, no OpenAPI schema). */
  coldStart: string[];
  /** Endpoint keys that were skipped (reserved or no URL configured). */
  skipped: string[];
  /** Endpoint keys that failed with an error. */
  failed: string[];
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Introspect all configured endpoints and register generic resource tools
 * for each one. Returns a summary for the startup banner.
 */
export async function introspectAndRegisterAll(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  gate: ApprovalGate | null | undefined,
  cache: SchemaCache | undefined,
): Promise<IntrospectSummary> {
  const summary: IntrospectSummary = {
    registered:  [],
    fromOpenApi:  [],
    coldStart:   [],
    skipped:     [],
    failed:      [],
  };

  const client = new ApiClient(config);
  const endpointEntries = Object.entries(config.endpoints as Record<string, string | undefined>);

  if (endpointEntries.length === 0) {
    console.error("[cms-mcp] No endpoints configured — generic tools disabled.");
    return summary;
  }

  // Load cached OpenAPI discovery result (if available) for tier-2 schema extraction
  const openApiCached = cache?.get<OpenApiDiscoveryResult>(openApiCacheKey(config.baseUrl)) ?? null;

  for (const [key, url] of endpointEntries) {
    if (!url) {
      summary.skipped.push(key);
      continue;
    }
    if (RESERVED_KEYS.has(key)) {
      summary.skipped.push(key);
      continue;
    }

    try {
      const { schema, tier } = await resolveSchema(
        client, key, url, config.baseUrl, cache, openApiCached,
      );

      // Attach relation hints (cross-endpoint FK detection)
      const allKeys = endpointEntries.map(([k]) => k);
      schema.relationHints = detectRelations(schema.fields, allKeys, key);

      registerGenericResourceTools(server, config, audit, gate, schema);

      if (schema.source === "cold-start") {
        summary.coldStart.push(key);
      } else {
        summary.registered.push(key);
        if (tier === "openapi") summary.fromOpenApi.push(key);
      }

      console.error(
        `[cms-mcp] Registered tools for "${key}" ` +
        `[tier: ${tier}, source: ${schema.source}, fields: ${schema.fields.length}, records: ${schema.recordCount}]`,
      );
    } catch (err) {
      console.error(
        `[cms-mcp] Failed to register tools for "${key}": ` +
        `${(err as Error).message?.slice(0, 120) ?? "unknown error"}`,
      );
      summary.failed.push(key);
    }
  }

  return summary;
}

// ─── Schema resolution tiers ──────────────────────────────────────────────────

type SchemaTier = "cache" | "openapi" | "sampling" | "cold-start";

async function resolveSchema(
  client: ApiClient,
  resourceKey: string,
  endpointUrl: string,
  baseUrl: string,
  cache: SchemaCache | undefined,
  openApi: OpenApiDiscoveryResult | null,
): Promise<{ schema: ResourceSchema; tier: SchemaTier }> {

  // ── Tier 1: SQLite cache ──────────────────────────────────────────────────
  const cacheKey = resourceSchemaCacheKey(baseUrl, resourceKey);
  if (cache) {
    const cached = cache.get<ResourceSchema>(cacheKey);
    if (cached) {
      console.error(`[cms-mcp] Schema for "${resourceKey}" loaded from cache.`);
      return { schema: { ...cached, source: "cached" }, tier: "cache" };
    }
  }

  // ── Tier 2: OpenAPI spec ──────────────────────────────────────────────────
  if (openApi?.rawSpec) {
    const result = extractSchemaFromOpenApi(openApi, baseUrl, endpointUrl);
    if (result && result.fields.length > 0) {
      const schema: ResourceSchema = {
        resourceKey,
        endpointUrl,
        fields:      result.fields,
        idField:     detectIdField(result.fields),
        titleField:  detectTitleField(result.fields),
        statusField: detectStatusField(result.fields),
        sampledAt:   Date.now(),
        recordCount: 0, // not sampled — came from spec
        source:      "live", // "live" = reliably sourced (spec counts as live)
      };
      cache?.set(cacheKey, schema);
      console.error(`[cms-mcp] Schema for "${resourceKey}" extracted from OpenAPI spec (${result.fields.length} fields via ${result.sourcePath}).`);
      return { schema, tier: "openapi" };
    }
    console.error(`[cms-mcp] OpenAPI spec found but no schema for "${resourceKey}" — falling back to sampling.`);
  }

  // ── Tier 3: Live sampling ─────────────────────────────────────────────────
  const schema = await introspectResourceSchema(client, resourceKey, endpointUrl);
  cache?.set(cacheKey, schema);

  const tier: SchemaTier = schema.source === "cold-start" ? "cold-start" : "sampling";
  return { schema, tier };
}

// ─── On-demand schema refresh ─────────────────────────────────────────────────

/**
 * Invalidate and re-introspect a single resource schema.
 * Used by the refresh_resource_schema tool in introspect.ts.
 *
 * Follows the same tier priority: OpenAPI → sampling → cold-start.
 * NOTE: registered MCP tool shapes are NOT updated — restart required.
 */
export async function refreshResourceSchema(
  client: ApiClient,
  resourceKey: string,
  endpointUrl: string,
  baseUrl: string,
  cache: SchemaCache | undefined,
): Promise<ResourceSchema> {
  const cacheKey = resourceSchemaCacheKey(baseUrl, resourceKey);

  // Invalidate stale entry
  cache?.invalidate(cacheKey);

  // Try OpenAPI from cache (if available)
  const openApi = cache?.get<OpenApiDiscoveryResult>(openApiCacheKey(baseUrl)) ?? null;

  const { schema } = await resolveSchema(
    client, resourceKey, endpointUrl, baseUrl, cache, openApi,
  );

  return schema;
}
