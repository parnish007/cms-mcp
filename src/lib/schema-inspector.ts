// src/lib/schema-inspector.ts
// Human-readable schema inspector — fetches up to 5 live records from a REST
// endpoint and produces a markdown table describing field types.
//
// Used by the inspect_endpoint_schema MCP tool to show Claude (and the admin)
// what fields a CMS endpoint actually has. For the machine-readable version
// used by the generic tool factory, see schema-introspector.ts.
//
// Type inference logic lives in type-inference.ts so both this file and
// schema-introspector.ts share the same regex/algorithm without duplication.

import type { ApiClient } from "./api-client.js";
import { inferType, normalizeList } from "./type-inference.js";

// ─── Format example value ─────────────────────────────────────────────────────

function formatExample(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.slice(0, 3).map((v) => JSON.stringify(v)).join(", ")}${value.length > 3 ? "..." : ""}]`;
  }
  if (typeof value === "object") return "{...}";
  const s = JSON.stringify(value);
  return s.length > 45 ? s.slice(0, 42) + "..." : s;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetches up to 5 records from a REST endpoint and generates a schema report.
 * Returns a markdown string with a field-type table and schema notes,
 * suitable for display to Claude via the inspect_endpoint_schema tool.
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
      ``,
      `Once the schema is refreshed, run \`refresh_resource_schema\` and restart cms-mcp`,
      `to apply updated field types to the generated tools.`,
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

  // For each field, collect values and infer type
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
    const type = inferType(values);
    const firstNonNull = values.find((v) => v !== null && v !== undefined);

    fields.push({
      name:          key,
      type,
      nullable:      nullCount > 0,
      alwaysPresent: nullCount === 0,
      example:       formatExample(firstNonNull ?? null),
    });
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
      const req  = f.alwaysPresent ? "✓" : "—";
      const type = f.nullable && !f.type.endsWith("?") ? `${f.type}?` : f.type;
      return `| \`${f.name}\` | ${type} | ${req} | ${f.example} |`;
    }),
    ``,
    `### Notes`,
    ``,
  ];

  // Key field callouts
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
    `> Use \`refresh_resource_schema\` + restart to apply changes to tool shapes.`,
  );

  return lines.join("\n");
}
