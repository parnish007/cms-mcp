// src/lib/startup-introspect.ts
// Startup orchestration — introspects every configured endpoint and registers
// generic resource tools for each one.
//
// Called once from index.ts during server boot, BEFORE the MCP transport
// connects. This is required because MCP tool schemas must be registered before
// the session handshake — Claude receives the tool list at connection time.
//
// Flow for each endpoint key:
//   1. Check SQLite schema cache (avoids API calls on every restart)
//   2. Cache miss → introspect live endpoint → populate cache
//   3. Register generic tools via registerGenericResourceTools()
//   4. Errors in one endpoint do NOT block others (isolated try/catch)
//
// "media" is skipped here because it has a special upload handler (media-proxy)
// that requires custom tool logic beyond standard CRUD.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import type { AuditLogger } from "./audit.js";
import type { ApprovalGate } from "./approval-gate.js";
import type { SchemaCache } from "./schema-cache.js";
import { ApiClient } from "./api-client.js";
import { introspectResourceSchema } from "./schema-introspector.js";
import { resourceSchemaCacheKey, type ResourceSchema } from "./resource-schema.js";
import { registerGenericResourceTools } from "../tools/generic-resource.js";

// Keys that have their own dedicated tool files and should NOT go through
// the generic factory (they need custom multipart/proxy logic).
const RESERVED_KEYS = new Set(["media"]);

// ─── Main export ──────────────────────────────────────────────────────────────

export interface IntrospectSummary {
  /** Endpoint keys successfully registered as generic tools. */
  registered: string[];
  /** Endpoint keys in cold-start mode (0 records found). */
  coldStart: string[];
  /** Endpoint keys that were skipped (reserved or no URL configured). */
  skipped: string[];
  /** Endpoint keys that failed with an error. */
  failed: string[];
}

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
    registered: [],
    coldStart:  [],
    skipped:    [],
    failed:     [],
  };

  const client = new ApiClient(config);
  const endpointEntries = Object.entries(config.endpoints as Record<string, string | undefined>);

  if (endpointEntries.length === 0) {
    console.error("[cms-mcp] No endpoints configured — generic tools disabled.");
    return summary;
  }

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
      const schema = await resolveSchema(client, key, url, config.baseUrl, cache);
      registerGenericResourceTools(server, config, audit, gate, schema);

      if (schema.source === "cold-start") {
        summary.coldStart.push(key);
      } else {
        summary.registered.push(key);
      }

      console.error(
        `[cms-mcp] Registered tools for "${key}" ` +
        `(${schema.source}, ${schema.fields.length} fields, ${schema.recordCount} records sampled)`,
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

// ─── Schema resolution (cache-first) ─────────────────────────────────────────

async function resolveSchema(
  client: ApiClient,
  resourceKey: string,
  endpointUrl: string,
  baseUrl: string,
  cache: SchemaCache | undefined,
): Promise<ResourceSchema> {
  const cacheKey = resourceSchemaCacheKey(baseUrl, resourceKey);

  // 1. Try cache first
  if (cache) {
    const cached = cache.get<ResourceSchema>(cacheKey);
    if (cached) {
      console.error(`[cms-mcp] Schema for "${resourceKey}" loaded from cache.`);
      return { ...cached, source: "cached" };
    }
  }

  // 2. Cache miss — introspect live
  const schema = await introspectResourceSchema(client, resourceKey, endpointUrl);

  // 3. Cache the result (even cold-starts, so we don't hammer an empty endpoint on every restart)
  if (cache) {
    cache.set(cacheKey, schema);
  }

  return schema;
}

// ─── On-demand schema refresh ─────────────────────────────────────────────────

/**
 * Invalidate and re-introspect a single resource schema.
 * Used by the refresh_resource_schema tool in introspect.ts.
 * Returns the new schema (but NOTE: the registered MCP tools are NOT updated —
 * the user must restart the server for tool shapes to reflect the new schema).
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

  // Introspect fresh
  const schema = await introspectResourceSchema(client, resourceKey, endpointUrl);

  // Re-cache
  if (cache) {
    cache.set(cacheKey, schema);
  }

  return schema;
}
