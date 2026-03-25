// src/lib/resource-schema.ts
// v1.0.0 — Runtime ResourceSchema type and Zod shape builder.
//
// Changes from v0.5.0:
//   - FieldDefinition gains `inconsistent?: boolean` flag (from schema merging)
//   - buildZodShape respects `inconsistent`: always uses .optional() for
//     fields not present in all sampled records
//   - buildPassthroughShape extended with "delete" mode

import { z } from "zod";
import { baseType } from "./type-inference.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FieldDefinition {
  name: string;
  /**
   * Semantic type: uuid, date, url, email, slug, string, number, boolean,
   * array, object, null, mixed, enum(a|b|c).
   */
  type: string;
  nullable: boolean;
  alwaysPresent: boolean;
  /**
   * v1.0.0: true when the field was absent in at least one sampled record.
   * Inconsistent fields always use .optional() in Zod shapes regardless of mode.
   */
  inconsistent?: boolean;
  example: string;
}

export interface RelationHint {
  field: string;
  targetKey: string;
  cardinality: "one" | "many";
}

export interface ResourceSchema {
  resourceKey: string;
  endpointUrl: string;
  fields: FieldDefinition[];
  idField: string;
  titleField?: string;
  statusField?: string;
  relationHints?: RelationHint[];
  sampledAt: number;
  recordCount: number;
  source: "live" | "cached" | "cold-start";
}

// ─── Cache key ────────────────────────────────────────────────────────────────

export function resourceSchemaCacheKey(baseUrl: string, resourceKey: string): string {
  return `resource-schema:${baseUrl}:${resourceKey}`;
}

// ─── Zod type mapping ─────────────────────────────────────────────────────────

function inferredTypeToZod(type: string): z.ZodTypeAny {
  const bt = baseType(type);

  if (bt === "uuid")    return z.string().uuid();
  if (bt === "date")    return z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/));
  if (bt === "url")     return z.string().url();
  if (bt === "email")   return z.string().email();
  if (bt === "slug")    return z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200);
  if (bt === "number")  return z.number();
  if (bt === "boolean") return z.boolean();
  if (bt === "array")   return z.array(z.unknown());
  if (bt === "object")  return z.record(z.unknown());

  if (bt.startsWith("enum(")) {
    const raw = bt.slice(5, -1).split("|").map((s) => s.trim()).filter(Boolean);
    if (raw.length >= 2) return z.enum(raw as [string, ...string[]]);
    return z.string();
  }

  if (bt === "null" || bt === "mixed") return z.unknown();
  return z.string(); // default fallback
}

// System-managed fields excluded from create payloads
const EXCLUDE_FROM_WRITE = new Set([
  "id", "_id", "uuid",
  "created_at", "updated_at", "createdAt", "updatedAt",
  "deleted_at", "deletedAt",
]);

// ─── buildZodShape ────────────────────────────────────────────────────────────

/**
 * Build a Zod shape from a ResourceSchema's field definitions.
 *
 * Modes:
 * - "create"  — writable fields; required if alwaysPresent && !nullable && !inconsistent
 * - "update"  — all fields optional + id required
 * - "mutate"  — all writable fields optional (legacy mutate_X data param)
 * - "list"    — limit + search + enum filter fields
 *
 * v1.0.0: `inconsistent` fields always get .optional() regardless of mode.
 */
export function buildZodShape(
  fields: FieldDefinition[],
  mode: "create" | "update" | "mutate" | "list",
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};

  if (mode === "list") {
    shape["limit"]  = z.number().int().min(1).max(100).default(20);
    shape["search"] = z.string().optional();
    for (const f of fields) {
      if (baseType(f.type).startsWith("enum(") && f.name !== "id") {
        const raw = baseType(f.type).slice(5, -1).split("|").map((s) => s.trim()).filter(Boolean);
        if (raw.length >= 2) {
          shape[f.name] = z.enum(raw as [string, ...string[]]).optional()
            .describe(`Filter by ${f.name}`);
        }
      }
    }
    return shape;
  }

  if (mode === "update") {
    shape["id"] = z.string().min(1).describe("Record ID to update");
    for (const f of fields) {
      if (f.name === "id" || f.name === "_id") continue;
      shape[f.name] = inferredTypeToZod(f.type).optional()
        .describe(`${f.name} (${f.type})${f.inconsistent ? " [optional — inconsistent across records]" : ""}`);
    }
    return shape;
  }

  if (mode === "mutate") {
    for (const f of fields) {
      if (EXCLUDE_FROM_WRITE.has(f.name)) continue;
      if (baseType(f.type) === "uuid" && f.alwaysPresent) continue;
      shape[f.name] = inferredTypeToZod(f.type).optional()
        .describe(`${f.name} (${f.type})`);
    }
    return shape;
  }

  // mode === "create"
  for (const f of fields) {
    if (EXCLUDE_FROM_WRITE.has(f.name)) continue;
    if (baseType(f.type) === "uuid" && f.alwaysPresent) continue;

    const base = inferredTypeToZod(f.type);

    // v1.0.0: inconsistent fields are always optional (schema merging result)
    const isRequired = f.alwaysPresent && !f.nullable && !f.inconsistent;

    if (isRequired) {
      shape[f.name] = base.describe(`${f.name} (${f.type}) — required`);
    } else {
      shape[f.name] = base.optional()
        .describe(`${f.name} (${f.type})${f.inconsistent ? " [inconsistent — present in some records]" : ""}`);
    }
  }

  return shape;
}

// ─── buildPassthroughShape ───────────────────────────────────────────────────

export function buildPassthroughShape(
  mode: "create" | "update" | "mutate" | "list" | "delete",
): Record<string, z.ZodTypeAny> {
  if (mode === "list") {
    return {
      limit:  z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
    };
  }
  if (mode === "update" || mode === "delete") {
    return {
      id:     z.string().min(1).describe("Record ID"),
      fields: z.record(z.unknown()).optional().describe("Fields to update"),
    };
  }
  // create / mutate
  return {
    fields: z.record(z.unknown()).describe(
      "Fields as a key-value object. Run inspect_endpoint_schema once records exist.",
    ),
  };
}
