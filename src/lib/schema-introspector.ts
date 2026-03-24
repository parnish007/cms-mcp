// src/lib/schema-introspector.ts
// Structured schema introspection — wraps the raw API call and type-inference
// logic and returns a machine-readable ResourceSchema instead of markdown text.
//
// Unlike schema-inspector.ts (which produces a human-readable markdown table
// for the inspect_endpoint_schema tool), this module produces a structured
// ResourceSchema that the generic tool factory can use to build Zod shapes
// and register tools at server startup.

import type { ApiClient } from "./api-client.js";
import type { ResourceSchema, FieldDefinition } from "./resource-schema.js";
import {
  inferType,
  normalizeList,
  detectIdField,
  detectTitleField,
  detectStatusField,
} from "./type-inference.js";

// ─── Format example value ─────────────────────────────────────────────────────

function formatExample(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.slice(0, 3).map((v) => JSON.stringify(v)).join(", ")}${value.length > 3 ? "…" : ""}]`;
  }
  if (typeof value === "object") return "{…}";
  const s = JSON.stringify(value);
  return s.length > 45 ? s.slice(0, 42) + "…" : s;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch up to 5 records from a REST endpoint and return a structured
 * ResourceSchema describing the field names, types, and metadata.
 *
 * Returns a "cold-start" schema with empty fields if the endpoint returns
 * zero records (e.g. a brand-new CMS with no content yet).
 *
 * Never throws — all errors are caught and returned as cold-start schemas
 * with an attached errorMessage, so one failing endpoint never blocks others.
 */
export async function introspectResourceSchema(
  client: ApiClient,
  resourceKey: string,
  endpointUrl: string,
): Promise<ResourceSchema> {
  let raw: unknown;

  try {
    raw = await client.get<unknown>(endpointUrl, { limit: 5, page_size: 5, per_page: 5 });
  } catch (err) {
    console.error(
      `[cms-mcp] Schema introspection failed for "${resourceKey}" (${endpointUrl}): ` +
      `${(err as Error).message?.slice(0, 120) ?? "unknown error"}`,
    );
    return coldStart(resourceKey, endpointUrl, "cold-start");
  }

  const items = normalizeList(raw);

  if (items.length === 0) {
    console.error(
      `[cms-mcp] Schema introspection: "${resourceKey}" returned 0 records — cold-start mode.`,
    );
    return coldStart(resourceKey, endpointUrl, "cold-start");
  }

  // Collect all field names across all sampled records
  const allKeys = new Set<string>();
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item as object)) {
        allKeys.add(key);
      }
    }
  }

  // For each field, collect values and infer type
  const fields: FieldDefinition[] = [];

  for (const key of allKeys) {
    const values = items.map((item: any) => item?.[key]);
    const nullCount = values.filter((v) => v === null || v === undefined).length;
    const type = inferType(values);
    const firstNonNull = values.find((v) => v !== null && v !== undefined);

    fields.push({
      name:         key,
      type,
      nullable:     nullCount > 0,
      alwaysPresent: nullCount === 0,
      example:      formatExample(firstNonNull ?? null),
    });
  }

  // Sort: ID fields first, then priority fields, then alphabetical
  const priority = ["id", "_id", "title", "name", "slug", "status", "body", "content", "description"];
  fields.sort((a, b) => {
    const pa = priority.indexOf(a.name);
    const pb = priority.indexOf(b.name);
    if (pa !== -1 && pb !== -1) return pa - pb;
    if (pa !== -1) return -1;
    if (pb !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    resourceKey,
    endpointUrl,
    fields,
    idField:     detectIdField(fields),
    titleField:  detectTitleField(fields),
    statusField: detectStatusField(fields),
    sampledAt:   Date.now(),
    recordCount: items.length,
    source:      "live",
  };
}

// ─── Cold-start schema ────────────────────────────────────────────────────────

function coldStart(
  resourceKey: string,
  endpointUrl: string,
  source: "cold-start",
): ResourceSchema {
  return {
    resourceKey,
    endpointUrl,
    fields:      [],
    idField:     "id",
    titleField:  undefined,
    statusField: undefined,
    sampledAt:   Date.now(),
    recordCount: 0,
    source,
  };
}
