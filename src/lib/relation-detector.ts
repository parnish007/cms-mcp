// src/lib/relation-detector.ts
// Detects likely foreign-key relationships between configured endpoints by
// scanning field names for _id / _ids / Id / Ids suffixes and cross-referencing
// them against the set of configured endpoint keys.
//
// Example: if the "posts" resource has a field "author_id" and "authors" is a
// configured endpoint key, a RelationHint { field: "author_id", targetKey: "authors",
// cardinality: "one" } is returned.
//
// These hints are:
//   1. Stored on ResourceSchema.relationHints
//   2. Surfaced in list_X / get_X tool descriptions so Claude knows to call
//      get_authors to resolve author details rather than guessing
//   3. Never used for automatic joins — they are informational only

import type { FieldDefinition, RelationHint } from "./resource-schema.js";

// ─── Normalisation helpers ─────────────────────────────────────────────────────

/**
 * Strip common FK suffixes to get the candidate resource name.
 * "author_id"  → "author"
 * "category_id" → "category"
 * "tag_ids"     → "tag"
 * "authorId"    → "author"
 */
function stripFkSuffix(fieldName: string): string | null {
  // snake_case: author_id, category_id, parent_id
  const snakeOne  = fieldName.match(/^(.+?)_id$/i);
  if (snakeOne) return snakeOne[1].toLowerCase();

  // snake_case array: tag_ids, post_ids
  const snakeMany = fieldName.match(/^(.+?)_ids$/i);
  if (snakeMany) return snakeMany[1].toLowerCase();

  // camelCase: authorId, categoryId
  const camelOne  = fieldName.match(/^(.+?)Id$/);
  if (camelOne) return camelOne[1].toLowerCase();

  // camelCase array: tagIds, postIds
  const camelMany = fieldName.match(/^(.+?)Ids$/);
  if (camelMany) return camelMany[1].toLowerCase();

  return null;
}

function isArrayFk(fieldName: string): boolean {
  return /_ids$/i.test(fieldName) || /Ids$/.test(fieldName);
}

// ─── Endpoint key matching ─────────────────────────────────────────────────────

/**
 * Given a candidate root name (e.g. "author"), find the best matching
 * configured endpoint key (e.g. "authors").
 *
 * Tries: exact, plural (+s), singular (-s), case-insensitive variants.
 */
function matchEndpointKey(
  candidateRoot: string,
  configKeys: string[],
): string | null {
  const lc = candidateRoot.toLowerCase();
  const candidates = [
    lc,
    `${lc}s`,       // author  → authors
    `${lc}es`,      // category → categories (approximate)
    lc.endsWith("s") ? lc.slice(0, -1) : null,   // tags → tag
    lc.endsWith("ies") ? `${lc.slice(0, -3)}y` : null, // categories → category
  ].filter(Boolean) as string[];

  const keysLc = new Map(configKeys.map((k) => [k.toLowerCase(), k]));

  for (const c of candidates) {
    if (keysLc.has(c)) return keysLc.get(c)!;
  }

  return null;
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Scan a resource's fields for foreign-key patterns and return hints about
 * likely relationships to other configured endpoints.
 *
 * @param fields         The FieldDefinition[] for the resource being checked.
 * @param configEndpointKeys  All keys from config.endpoints (e.g. ["posts","authors","tags"]).
 * @param selfKey        The key of the resource being checked — excludes self-references.
 */
export function detectRelations(
  fields: FieldDefinition[],
  configEndpointKeys: string[],
  selfKey: string,
): RelationHint[] {
  const hints: RelationHint[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const root = stripFkSuffix(field.name);
    if (!root) continue;

    // Skip self-references (e.g. parent_id on a categories resource)
    const targetKey = matchEndpointKey(root, configEndpointKeys.filter((k) => k !== selfKey));
    if (!targetKey) continue;

    // De-duplicate (same target from different field names is unusual but possible)
    const dedupeKey = `${field.name}:${targetKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    hints.push({
      field:       field.name,
      targetKey,
      cardinality: isArrayFk(field.name) ? "many" : "one",
    });
  }

  return hints;
}

/**
 * Format relation hints as a short string for tool descriptions.
 * Example: "author_id → get_authors | tag_ids[] → list_tags"
 */
export function formatRelationHints(hints: RelationHint[]): string {
  return hints
    .map((h) => {
      const suffix = h.cardinality === "many" ? "[]" : "";
      const tool   = h.cardinality === "many" ? `list_${h.targetKey}` : `get_${h.targetKey}`;
      return `${h.field}${suffix} → ${tool}`;
    })
    .join(" | ");
}
