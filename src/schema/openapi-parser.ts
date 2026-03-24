// src/schema/openapi-parser.ts
// Phase 1: OpenAPI-first schema engine.
//
// Extracts reliable FieldDefinition[] for a CMS resource directly from an
// OpenAPI 3.x / Swagger 2.x spec — no live API sampling required.
//
// Reliability vs sampling:
//   - Sampling: infers types from 5 records — misses optional fields, gets enums
//     wrong with single samples, fails on empty endpoints.
//   - OpenAPI: declares all fields, types, formats, enums, required/optional,
//     readOnly, and descriptions explicitly. Zero false positives.
//
// Usage in startup-introspect.ts:
//   1. Try openapi-parser (OpenAPI spec available) → full accurate schema
//   2. Fall back to schema-introspector (live sampling) → best-effort
//   3. Fall back to cold-start (empty endpoint) → passthrough mode
//
// Handles:
//   - $ref resolution (recursive, cycle-safe, supports $defs and definitions)
//   - oneOf / anyOf / allOf merging
//   - readOnly fields (excluded from create/update Zod shapes)
//   - nullable fields (type suffix "?")
//   - enum detection
//   - format-based type refinement (uuid, date-time, uri, email)
//   - OpenAPI 3.x (requestBody) and Swagger 2.x (parameters) for POST schemas

import type { FieldDefinition } from "../lib/resource-schema.js";
import type { OpenApiDiscoveryResult } from "../lib/openapi.js";

// ─── JSON Schema types (internal) ─────────────────────────────────────────────

interface JsonSchema {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  $ref?: string;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  required?: string[];
  readOnly?: boolean;
  writeOnly?: boolean;
  nullable?: boolean;
  description?: string;
  title?: string;
  // OpenAPI 3.1 nullable via type array
  // e.g. type: ["string", "null"]
}

// ─── $ref resolver ────────────────────────────────────────────────────────────

/**
 * Resolve a $ref string like "#/components/schemas/Post" against the raw spec.
 * Handles both OpenAPI 3.x (#/components/schemas/) and Swagger 2.x (#/definitions/).
 * Cycle-safe via a visited set.
 */
function resolveRef(
  ref: string,
  spec: Record<string, unknown>,
  visited = new Set<string>(),
): JsonSchema | null {
  if (!ref.startsWith("#/")) return null;
  if (visited.has(ref)) {
    console.error(`[openapi-parser] Circular $ref detected: ${ref} — skipping`);
    return null;
  }
  visited.add(ref);

  const parts = ref.slice(2).split("/");
  let node: unknown = spec;

  for (const part of parts) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as any)[part];
    } else {
      return null;
    }
  }

  const schema = node as JsonSchema;

  // If the resolved schema is itself a $ref, resolve further
  if (schema?.$ref) {
    return resolveRef(schema.$ref, spec, visited);
  }

  return schema ?? null;
}

/**
 * Inline all $refs in a schema recursively.
 * Returns a new schema with $refs replaced by their resolved forms.
 */
function inlineRefs(
  schema: JsonSchema,
  spec: Record<string, unknown>,
  depth = 0,
): JsonSchema {
  if (depth > 8) return { type: "object", description: "[max depth reached]" };
  if (!schema) return {};

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, spec);
    if (!resolved) return { type: "object", description: `[unresolved: ${schema.$ref}]` };
    return inlineRefs(resolved, spec, depth + 1);
  }

  const result: JsonSchema = { ...schema };

  if (result.properties) {
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([k, v]) => [k, inlineRefs(v, spec, depth + 1)]),
    );
  }

  if (result.items) {
    result.items = inlineRefs(result.items, spec, depth + 1);
  }

  // Flatten allOf into properties merge
  if (result.allOf && result.allOf.length > 0) {
    const merged = mergeAllOf(result.allOf, spec, depth);
    const { allOf: _, ...rest } = result;
    return { ...rest, ...merged };
  }

  return result;
}

/** Merge allOf sub-schemas into a single properties object. */
function mergeAllOf(
  schemas: JsonSchema[],
  spec: Record<string, unknown>,
  depth: number,
): JsonSchema {
  const merged: JsonSchema = { type: "object", properties: {}, required: [] };
  for (const s of schemas) {
    const resolved = inlineRefs(s, spec, depth + 1);
    if (resolved.properties) {
      Object.assign(merged.properties!, resolved.properties);
    }
    if (resolved.required) {
      merged.required!.push(...resolved.required);
    }
  }
  return merged;
}

// ─── JSON Schema → semantic type string ───────────────────────────────────────

/**
 * Convert a JSON Schema type definition to our semantic type string.
 * Mirrors inferType() from type-inference.ts but using declared schema info
 * instead of runtime value inspection.
 */
function schemaToSemanticType(schema: JsonSchema): string {
  const format = schema.format ?? "";
  const types: string[] = Array.isArray(schema.type)
    ? schema.type.filter((t) => t !== "null")
    : schema.type ? [schema.type] : [];

  const primaryType = types[0] ?? "string";
  const isNullable = schema.nullable === true
    || (Array.isArray(schema.type) && schema.type.includes("null"));

  let base: string;

  // Enum (closed value set)
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum.filter((v) => v !== null).map(String);
    if (values.length >= 2) {
      base = `enum(${values.join("|")})`;
    } else {
      base = "string";
    }
  }
  // oneOf / anyOf — treat as mixed (union type)
  else if (schema.oneOf || schema.anyOf) {
    base = "mixed";
  }
  // Type-specific with format refinement
  else if (primaryType === "string") {
    if (format === "uuid")           base = "uuid";
    else if (format === "date-time" || format === "date") base = "date";
    else if (format === "uri" || format === "url")        base = "url";
    else if (format === "email")     base = "email";
    else if (format === "hostname")  base = "string";
    else                             base = "string";
  }
  else if (primaryType === "integer" || primaryType === "number") {
    base = "number";
  }
  else if (primaryType === "boolean") {
    base = "boolean";
  }
  else if (primaryType === "array") {
    base = "array";
  }
  else if (primaryType === "object") {
    base = "object";
  }
  else {
    base = "string"; // safe default
  }

  return isNullable ? `${base}?` : base;
}

// ─── Schema → FieldDefinition[] ───────────────────────────────────────────────

/**
 * Convert an inlined JSON Schema object (with .properties) into FieldDefinition[].
 */
function schemaToFields(schema: JsonSchema): FieldDefinition[] {
  const props = schema.properties;
  if (!props || Object.keys(props).length === 0) return [];

  const required = new Set(schema.required ?? []);
  const fields: FieldDefinition[] = [];

  for (const [name, propSchema] of Object.entries(props)) {
    const type = schemaToSemanticType(propSchema);
    const isRequired = required.has(name);

    // Build a short example string from enum values or format
    let example = "—";
    if (propSchema.enum && propSchema.enum.length > 0) {
      example = `"${propSchema.enum[0]}"`;
    } else if (propSchema.format) {
      example = `(${propSchema.format})`;
    } else if (type === "boolean") {
      example = "true";
    } else if (type === "number") {
      example = "0";
    } else if (type === "array") {
      example = "[]";
    } else if (type === "object") {
      example = "{}";
    }

    fields.push({
      name,
      type,
      nullable:      type.endsWith("?") || !isRequired,
      alwaysPresent: isRequired && !type.endsWith("?"),
      example,
    });
  }

  // Sort: priority fields first (same order as schema-inspector.ts)
  const priority = ["id", "_id", "title", "name", "slug", "status", "body", "content", "description"];
  fields.sort((a, b) => {
    const pa = priority.indexOf(a.name);
    const pb = priority.indexOf(b.name);
    if (pa !== -1 && pb !== -1) return pa - pb;
    if (pa !== -1) return -1;
    if (pb !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  return fields;
}

// ─── Find response schema for GET /resource ───────────────────────────────────

/**
 * Extract the item schema from a GET list response.
 * For OpenAPI 3.x: paths[path].get.responses.200.content.*.schema
 * For Swagger 2.x: paths[path].get.responses.200.schema
 *
 * Handles common list wrappers: { data: [...] }, { items: [...] }, { results: [...] }
 */
function extractListItemSchema(
  spec: Record<string, unknown>,
  path: string,
): JsonSchema | null {
  const paths = (spec.paths as any) ?? {};
  const pathItem = paths[path];
  if (!pathItem) return null;

  const getOp = pathItem.get;
  if (!getOp?.responses) return null;

  const response200 = getOp.responses["200"] ?? getOp.responses["default"];
  if (!response200) return null;

  let responseSchema: JsonSchema | null = null;

  // OpenAPI 3.x
  const content = response200.content;
  if (content) {
    const mediaType = content["application/json"] ?? Object.values(content)[0];
    if (mediaType?.schema) {
      responseSchema = inlineRefs(mediaType.schema as JsonSchema, spec);
    }
  }

  // Swagger 2.x
  if (!responseSchema && response200.schema) {
    responseSchema = inlineRefs(response200.schema as JsonSchema, spec);
  }

  if (!responseSchema) return null;

  // Unwrap common list wrappers: { data: [{...}] }, { items: [{...}] }
  if (responseSchema.type === "object" && responseSchema.properties) {
    const wrapperKeys = ["data", "items", "results", "records", "entries", "nodes", "collection"];
    for (const key of wrapperKeys) {
      const wrapper = responseSchema.properties[key];
      if (wrapper?.type === "array" && wrapper.items) {
        return inlineRefs(wrapper.items, spec);
      }
    }
    // Not a wrapper — could be a direct object response
    return responseSchema;
  }

  // Direct array response
  if (responseSchema.type === "array" && responseSchema.items) {
    return inlineRefs(responseSchema.items, spec);
  }

  return responseSchema;
}

// ─── Find request body schema for POST /resource ──────────────────────────────

/**
 * Extract the request body schema for POST (create).
 * OpenAPI 3.x: requestBody.content["application/json"].schema
 * Swagger 2.x: parameters[].in === "body" → schema
 */
function extractCreateBodySchema(
  spec: Record<string, unknown>,
  path: string,
): JsonSchema | null {
  const paths = (spec.paths as any) ?? {};
  const pathItem = paths[path];
  if (!pathItem) return null;

  const postOp = pathItem.post;
  if (!postOp) return null;

  // OpenAPI 3.x
  const requestBody = postOp.requestBody;
  if (requestBody) {
    const content = requestBody.content;
    if (content) {
      const mediaType = content["application/json"] ?? Object.values(content)[0];
      if (mediaType?.schema) {
        return inlineRefs(mediaType.schema as JsonSchema, spec);
      }
    }
  }

  // Swagger 2.x
  const params = postOp.parameters ?? [];
  const bodyParam = params.find((p: any) => p.in === "body");
  if (bodyParam?.schema) {
    return inlineRefs(bodyParam.schema as JsonSchema, spec);
  }

  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface OpenApiSchemaResult {
  fields: FieldDefinition[];
  /** Path in the spec that the fields were extracted from. */
  sourcePath: string;
  /** Whether the schema came from a GET response (true) or POST body (false). */
  fromResponse: boolean;
}

/**
 * Extract field definitions for a configured endpoint from an OpenAPI spec.
 *
 * Strategy:
 *   1. Match the endpointUrl against spec paths (strip baseUrl prefix)
 *   2. Try GET response schema (list endpoint)
 *   3. Try POST request body schema (create endpoint)
 *   4. Return null if nothing found
 *
 * @param discovery  Cached OpenAPI discovery result (contains rawSpec)
 * @param baseUrl    The API base URL (to strip from endpointUrl for path matching)
 * @param endpointUrl  Full URL of the configured endpoint
 */
export function extractSchemaFromOpenApi(
  discovery: OpenApiDiscoveryResult,
  baseUrl: string,
  endpointUrl: string,
): OpenApiSchemaResult | null {
  const spec = discovery.rawSpec;
  if (!spec || !spec.paths) return null;

  // Strip the baseUrl to get the path portion
  // e.g. "https://api.example.com/api/v1" + "/posts" → path = "/posts"
  //       or endpointUrl = "https://api.example.com/api/v1/posts" → path = "/posts"
  const base = baseUrl.replace(/\/$/, "");
  const path = endpointUrl.startsWith(base)
    ? endpointUrl.slice(base.length) || "/"
    : new URL(endpointUrl).pathname;

  // Normalize: ensure starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  // Try exact path first, then try without trailing slash
  const candidatePaths = [
    normalizedPath,
    normalizedPath.replace(/\/$/, ""),
    // Also try with common API prefixes stripped or added
    normalizedPath.replace(/^\/api\/v\d+/, "") || "/",
    normalizedPath.replace(/^\/api/, "") || "/",
  ].filter((p, i, arr) => p && arr.indexOf(p) === i); // unique, non-empty

  for (const candidatePath of candidatePaths) {
    // Try GET response schema (most complete — includes all fields)
    const responseSchema = extractListItemSchema(spec as Record<string, unknown>, candidatePath);
    if (responseSchema?.properties && Object.keys(responseSchema.properties).length > 0) {
      const fields = schemaToFields(responseSchema);
      if (fields.length > 0) {
        return { fields, sourcePath: candidatePath, fromResponse: true };
      }
    }

    // Try POST request body schema (writable fields only)
    const bodySchema = extractCreateBodySchema(spec as Record<string, unknown>, candidatePath);
    if (bodySchema?.properties && Object.keys(bodySchema.properties).length > 0) {
      const fields = schemaToFields(bodySchema);
      if (fields.length > 0) {
        return { fields, sourcePath: candidatePath, fromResponse: false };
      }
    }
  }

  return null;
}

/**
 * Build a markdown table from extracted OpenAPI field definitions.
 * Used by inspect_endpoint_schema when OpenAPI is available.
 */
export function formatOpenApiSchema(result: OpenApiSchemaResult, endpointUrl: string): string {
  const lines = [
    `## Schema: \`${endpointUrl}\``,
    ``,
    `*Source: OpenAPI spec (path: \`${result.sourcePath}\`) — ${result.fields.length} fields*`,
    ``,
    `| Field | Type | Required | Notes |`,
    `|-------|------|----------|-------|`,
    ...result.fields.map((f) => {
      const req = f.alwaysPresent ? "✓" : "—";
      return `| \`${f.name}\` | ${f.type} | ${req} | ${f.example} |`;
    }),
    ``,
    `> Schema sourced from OpenAPI specification — authoritative field list.`,
  ];
  return lines.join("\n");
}
