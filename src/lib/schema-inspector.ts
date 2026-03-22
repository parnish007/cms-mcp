// src/lib/schema-inspector.ts
// Auto-Schema Adapter — introspects a live REST endpoint and generates a schema report.
// Fetches up to 5 sample records, infers field types and patterns, and returns a
// markdown table Claude can use to understand the exact data shape of any CMS API.

import type { ApiClient } from "./api-client.js";

// ─── Type inference ───────────────────────────────────────────────────────────

const UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const URL_RE     = /^https?:\/\//i;
const SLUG_RE    = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inferType(values: unknown[]): string {
  const nonNull = values.filter((v) => v !== null && v !== undefined);
  if (nonNull.length === 0) return "null";

  const types = new Set(nonNull.map((v) => typeof v));

  if (types.size === 1) {
    const t = [...types][0];

    if (t === "boolean") return "boolean";
    if (t === "number")  return "number";
    if (t === "object") {
      if (nonNull.every(Array.isArray)) return "array";
      return "object";
    }

    if (t === "string") {
      const strings = nonNull as string[];

      // Detect closed enum (≤8 distinct values, all values are a known set)
      const distinct = new Set(strings);
      if (distinct.size <= 8 && strings.length >= 2) {
        return `enum(${[...distinct].join("|")})`;
      }

      // Pattern detection (priority order)
      if (strings.every((s) => UUID_RE.test(s)))     return "uuid";
      if (strings.every((s) => ISO_DATE_RE.test(s))) return "date";
      if (strings.every((s) => URL_RE.test(s)))      return "url";
      if (strings.every((s) => EMAIL_RE.test(s)))    return "email";
      if (strings.every((s) => SLUG_RE.test(s) && s.length < 80)) return "slug";

      return "string";
    }
  }

  // Mixed types — check if consistently nullable
  if (types.has("object") && nonNull.length < values.length) {
    const innerType = inferType(nonNull);
    return `${innerType}?`; // nullable
  }

  return "mixed";
}

function formatExample(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.slice(0, 3).map((v) => JSON.stringify(v)).join(", ")}${value.length > 3 ? "..." : ""}]`;
  }
  if (typeof value === "object") return "{...}";
  const s = JSON.stringify(value);
  return s.length > 45 ? s.slice(0, 42) + "..." : s;
}

// ─── List normalizer ──────────────────────────────────────────────────────────

function normalizeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "results", "records", "entries", "nodes", "collection", "content", "list"]) {
      const v = (data as any)[key];
      if (Array.isArray(v)) return v;
    }
    // If it's a single object, wrap it (single-record response)
    return [data];
  }
  return [];
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Fetches up to 5 records from a REST endpoint and generates a schema report.
 * Returns a markdown string with a field-type table and schema notes.
 */
export async function inspectEndpoint(
  client: ApiClient,
  endpoint: string,
): Promise<string> {
  let raw: unknown;

  try {
    raw = await client.get<unknown>(endpoint, { limit: 5, page_size: 5, per_page: 5 });
  } catch (err) {
    return [
      `## Schema Inspection Failed`,
      ``,
      `Could not fetch \`${endpoint}\`:`,
      `> ${(err as Error).message?.slice(0, 150) ?? "Unknown error"}`,
      ``,
      `The endpoint may be empty, require specific query parameters, or be unavailable.`,
    ].join("\n");
  }

  const items = normalizeList(raw);

  if (items.length === 0) {
    return [
      `## Schema Inspection: No Data`,
      ``,
      `The endpoint \`${endpoint}\` returned no records.`,
      ``,
      `This tool needs at least one record to infer the schema.`,
      `Create a record first, then run \`inspect_endpoint_schema\` again.`,
    ].join("\n");
  }

  // Collect all field names across all records
  const allKeys = new Set<string>();
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const key of Object.keys(item as object)) {
        allKeys.add(key);
      }
    }
  }

  // For each field, collect values across all sample records
  const fields: Array<{
    name: string;
    type: string;
    nullable: boolean;
    alwaysPresent: boolean;
    example: string;
  }> = [];

  for (const key of allKeys) {
    const values = items.map((item: any) => item?.[key]);
    const nullCount = values.filter((v) => v === null || v === undefined).length;
    const nullable = nullCount > 0;
    const alwaysPresent = nullCount === 0;
    const type = inferType(values);
    const firstNonNull = values.find((v) => v !== null && v !== undefined);
    const example = formatExample(firstNonNull ?? null);

    fields.push({ name: key, type, nullable, alwaysPresent, example });
  }

  // Sort: ID-like fields first, then common fields, then alphabetical
  const priority = ["id", "_id", "title", "name", "slug", "status", "body", "content", "description"];
  fields.sort((a, b) => {
    const pa = priority.indexOf(a.name);
    const pb = priority.indexOf(b.name);
    if (pa !== -1 && pb !== -1) return pa - pb;
    if (pa !== -1) return -1;
    if (pb !== -1) return 1;
    return a.name.localeCompare(b.name);
  });

  // Build markdown table
  const lines = [
    `## Schema: \`${endpoint}\``,
    ``,
    `*Sampled ${items.length} record${items.length === 1 ? "" : "s"} — ${fields.length} fields detected*`,
    ``,
    `| Field | Type | Required | Example |`,
    `|-------|------|----------|---------|`,
    ...fields.map((f) => {
      const req = f.alwaysPresent ? "✓" : "—";
      const type = f.nullable && !f.type.endsWith("?") ? `${f.type}?` : f.type;
      return `| \`${f.name}\` | ${type} | ${req} | ${f.example} |`;
    }),
    ``,
    `### Notes`,
    ``,
  ];

  // Identify likely key fields
  const idField = fields.find((f) => f.name === "id" || f.name === "_id");
  if (idField) lines.push(`- **ID field:** \`${idField.name}\` (${idField.type})`);

  const statusField = fields.find((f) => f.name === "status" && f.type.startsWith("enum("));
  if (statusField) lines.push(`- **Status values:** ${statusField.type}`);

  const titleField = fields.find((f) => ["title", "name"].includes(f.name));
  if (titleField) lines.push(`- **Title field:** \`${titleField.name}\``);

  const dateFields = fields.filter((f) => f.type === "date" || f.type === "date?");
  if (dateFields.length > 0) {
    lines.push(`- **Date fields:** ${dateFields.map((f) => `\`${f.name}\``).join(", ")}`);
  }

  lines.push(
    ``,
    `> This schema was inferred from ${items.length} live record${items.length === 1 ? "" : "s"}.`,
    `> Use these field names when creating or updating records.`,
  );

  return lines.join("\n");
}
