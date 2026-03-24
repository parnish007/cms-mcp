// src/lib/resource-schema.ts
// Runtime ResourceSchema type and Zod shape builder.
// This is the bridge between live endpoint introspection and MCP tool registration.
// Instead of hardcoded Zod schemas for "blogs" and "projects", every resource
// gets its own schema built at startup from whatever fields actually exist in
// the live CMS API — enabling cms-mcp to work with ANY REST CMS out of the box.

import { z } from "zod";
import { baseType } from "./type-inference.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single inferred field from a live CMS record. */
export interface FieldDefinition {
  name: string;
  /** Semantic type produced by inferType(): uuid, date, url, email, slug,
   *  string, number, boolean, array, object, null, mixed, enum(a|b|c),
   *  or any of the above with a trailing "?" for nullable. */
  type: string;
  /** True if the field was null/undefined in at least one sample. */
  nullable: boolean;
  /** True if the field was present and non-null in EVERY sample. */
  alwaysPresent: boolean;
  /** Short human-readable example value (truncated). */
  example: string;
}

/**
 * A machine-readable description of a CMS resource endpoint, built from
 * live API samples and cached in SQLite. Used by the generic tool factory
 * to build correct Zod shapes and display summaries at startup.
 */
export interface ResourceSchema {
  /** The endpoint key as written in cms-mcp.config.json (e.g. "blogs", "products"). */
  resourceKey: string;
  /** Fully-resolved endpoint URL. */
  endpointUrl: string;
  /** All fields discovered across up to 5 sample records. */
  fields: FieldDefinition[];
  /** Name of the ID field ("id", "_id", or first uuid-typed field). */
  idField: string;
  /** Name of the human-readable title field ("title", "name", etc.) if found. */
  titleField?: string;
  /** Name of the status/state enum field if found. */
  statusField?: string;
  /** Unix timestamp (ms) when the schema was last sampled. */
  sampledAt: number;
  /** How many records were used to build this schema. */
  recordCount: number;
  /**
   * Where this schema came from:
   * - "live"        — freshly introspected from the CMS API
   * - "cached"      — loaded from SQLite schema cache
   * - "cold-start"  — endpoint returned zero records; tools use passthrough mode
   */
  source: "live" | "cached" | "cold-start";
}

// ─── Cache key ────────────────────────────────────────────────────────────────

/**
 * Produces the SQLite cache key for a given resource schema.
 * Namespaced separately from OpenAPI cache keys.
 */
export function resourceSchemaCacheKey(baseUrl: string, resourceKey: string): string {
  return `resource-schema:${baseUrl}:${resourceKey}`;
}

// ─── Zod shape builder ────────────────────────────────────────────────────────

/**
 * Map an inferred type string to a Zod validator.
 * All validators are optional by default; the caller tightens required fields
 * based on mode and alwaysPresent.
 */
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
    if (raw.length >= 2) {
      return z.enum(raw as [string, ...string[]]);
    }
    return z.string();
  }

  if (bt === "null" || bt === "mixed") return z.unknown();

  // Default fallback — string
  return z.string();
}

/**
 * Names of fields that are always system-managed and should be excluded from
 * create payloads (server generates them automatically).
 */
const EXCLUDE_FROM_CREATE = new Set([
  "id", "_id", "uuid",
  "created_at", "updated_at", "createdAt", "updatedAt",
  "deleted_at", "deletedAt",
]);

/**
 * Build a Zod shape Record suitable for passing directly to server.tool().
 *
 * Modes:
 * - "create"  — writable fields only; required fields have .min(1) or no .optional()
 * - "update"  — all fields optional + id required
 * - "list"    — limit + search + any enum-typed status fields as optional filters
 */
export function buildZodShape(
  fields: FieldDefinition[],
  mode: "create" | "update" | "list",
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};

  if (mode === "list") {
    shape["limit"]  = z.number().int().min(1).max(100).default(20).describe("Max records to return");
    shape["search"] = z.string().optional().describe("Search query");

    // Expose any enum-typed fields (especially status) as optional filters
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
    // id is required; every other field is optional
    shape["id"] = z.string().min(1).describe("Record ID to update");
    for (const f of fields) {
      if (f.name === "id" || f.name === "_id") continue;
      shape[f.name] = inferredTypeToZod(f.type).optional().describe(`${f.name} (${f.type})`);
    }
    return shape;
  }

  // mode === "create"
  for (const f of fields) {
    if (EXCLUDE_FROM_CREATE.has(f.name)) continue;
    // Skip auto-id fields (uuid + alwaysPresent = server-generated)
    if (baseType(f.type) === "uuid" && f.alwaysPresent) continue;

    const base = inferredTypeToZod(f.type);
    const isRequired = f.alwaysPresent && !f.nullable;

    if (isRequired) {
      // Keep the validator as-is (required)
      shape[f.name] = base.describe(`${f.name} (${f.type}) — required`);
    } else {
      shape[f.name] = base.optional().describe(`${f.name} (${f.type})`);
    }
  }

  return shape;
}

/**
 * Build a passthrough shape for cold-start resources (zero records at introspection time).
 * Claude can still call the tool; it just won't have field-level hints.
 */
export function buildPassthroughShape(mode: "create" | "update" | "list"): Record<string, z.ZodTypeAny> {
  if (mode === "list") {
    return {
      limit:  z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
    };
  }
  if (mode === "update") {
    return {
      id:     z.string().min(1).describe("Record ID to update"),
      fields: z.record(z.unknown()).describe("Fields to update as a key-value object"),
    };
  }
  // create
  return {
    fields: z.record(z.unknown()).describe(
      "Fields to create as a key-value object. " +
      "Run inspect_endpoint_schema to discover available fields once records exist.",
    ),
  };
}
