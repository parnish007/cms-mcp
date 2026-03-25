// src/lib/schema-introspector.ts
// v1.0.0 — Structured schema introspection with schema merging.
//
// Changes from v0.5.0:
//   - Default sample size increased from 5 → 20 records
//   - Schema merging: fields that appear in <100% of records get
//     `inconsistent: true`, causing Zod to use .optional() for them
//     rather than failing or silently excluding them
//   - This fixes the common case where optional fields are absent in
//     the first few records but exist in others (e.g. nullable metadata fields)

import type { ApiClient } from "./api-client.js";
import type { ResourceSchema, FieldDefinition } from "./resource-schema.js";
import {
  inferType,
  normalizeList,
  detectIdField,
  detectTitleField,
  detectStatusField,
} from "./type-inference.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Number of records to sample for schema inference. Increased from 5 in v0.5.0. */
export const SAMPLE_SIZE = 20;

/**
 * Threshold for marking a field as inconsistent.
 * If a field appears in fewer than this fraction of sampled records,
 * it's marked as `inconsistent: true` and always uses .optional() in Zod.
 */
const CONSISTENCY_THRESHOLD = 1.0; // field must be present in ALL records to be "consistent"

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
 * Fetch up to SAMPLE_SIZE records from a REST endpoint and return a structured
 * ResourceSchema with merged field definitions.
 *
 * Schema merging: all fields across ALL sampled records are collected.
 * Fields absent in some records are marked `inconsistent: true` and will
 * use .optional() validators in the generated Zod shape.
 *
 * Returns a cold-start schema if the endpoint returns zero records.
 * Never throws — errors are caught and returned as cold-start schemas.
 */
export async function introspectResourceSchema(
  client: ApiClient,
  resourceKey: string,
  endpointUrl: string,
): Promise<ResourceSchema> {
  let raw: unknown;

  try {
    raw = await client.get<unknown>(endpointUrl, {
      limit: SAMPLE_SIZE,
      page_size: SAMPLE_SIZE,
      per_page: SAMPLE_SIZE,
    });
  } catch (err) {
    process.stderr.write(
      `[cms-mcp] Schema introspection failed for "${resourceKey}" (${endpointUrl}): ` +
      `${(err as Error).message?.slice(0, 120) ?? "unknown error"}\n`,
    );
    return coldStart(resourceKey, endpointUrl);
  }

  const items = normalizeList(raw);

  if (items.length === 0) {
    process.stderr.write(
      `[cms-mcp] Schema introspection: "${resourceKey}" returned 0 records — cold-start mode.\n`,
    );
    return coldStart(resourceKey, endpointUrl);
  }

  process.stderr.write(
    `[cms-mcp] Sampled ${items.length} record(s) for "${resourceKey}" schema inference.\n`,
  );

  const totalRecords = items.length;

  // ── Schema merging ─────────────────────────────────────────────────────────
  //
  // Step 1: Collect every field name that appears in ANY record.
  //         This is the union of all fields across all records.
  //
  // Step 2: For each field, collect all non-null values across ALL records.
  //         Track how many records have the field present (even if null).
  //
  // Step 3: Infer type from collected values.
  //         Mark field as `inconsistent` if it doesn't appear in all records.

  // Map: fieldName → { values: unknown[], presentCount: number }
  const fieldData = new Map<string, { values: unknown[]; presentCount: number }>();

  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const record = item as Record<string, unknown>;

    // Track which fields we've seen in THIS record to count presence
    const seenInThisRecord = new Set<string>();

    for (const [key, value] of Object.entries(record)) {
      if (!fieldData.has(key)) {
        fieldData.set(key, { values: [], presentCount: 0 });
      }
      const entry = fieldData.get(key)!;
      entry.values.push(value);
      seenInThisRecord.add(key);
    }

    // For fields seen in previous records but not this one, we still need
    // to know they're absent here (for inconsistency detection)
    // We do this by NOT incrementing presentCount for missing fields
    for (const key of seenInThisRecord) {
      fieldData.get(key)!.presentCount++;
    }
  }

  // Build FieldDefinitions
  const fields: FieldDefinition[] = [];

  for (const [key, { values, presentCount }] of fieldData) {
    const allValues = values; // includes nulls
    const nullCount = allValues.filter((v) => v === null || v === undefined).length;
    const type = inferType(allValues);
    const firstNonNull = allValues.find((v) => v !== null && v !== undefined);

    // A field is "inconsistent" if it doesn't appear in every sampled record
    const presentFraction = presentCount / totalRecords;
    const inconsistent = presentFraction < CONSISTENCY_THRESHOLD;

    fields.push({
      name:          key,
      type,
      nullable:      nullCount > 0,
      alwaysPresent: !inconsistent && nullCount === 0,
      inconsistent,
      example:       formatExample(firstNonNull ?? null),
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

function coldStart(resourceKey: string, endpointUrl: string): ResourceSchema {
  return {
    resourceKey,
    endpointUrl,
    fields:      [],
    idField:     "id",
    titleField:  undefined,
    statusField: undefined,
    sampledAt:   Date.now(),
    recordCount: 0,
    source:      "cold-start",
  };
}
