// src/lib/type-inference.ts
// Shared field-type inference logic used by both the human-readable schema inspector
// and the machine-readable schema introspector (generic tool factory).
// Extracted so both can share the same regex patterns and inferType algorithm
// without coupling their output formats together.

// ─── Regex patterns ───────────────────────────────────────────────────────────

export const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
export const URL_RE      = /^https?:\/\//i;
export const SLUG_RE     = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const EMAIL_RE    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Type inference ───────────────────────────────────────────────────────────

/**
 * Infer a semantic type string from an array of sampled values for a single field.
 * Returns one of: uuid, date, url, email, slug, string, number, boolean, array,
 * object, null, mixed, or enum(a|b|c).
 * A trailing "?" indicates the field was nullable in at least one sample.
 */
export function inferType(values: unknown[]): string {
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

      // Detect closed enum (≤8 distinct values, at least 2 samples)
      const distinct = new Set(strings);
      if (distinct.size <= 8 && strings.length >= 2) {
        return `enum(${[...distinct].join("|")})`;
      }

      // Pattern detection — priority order matters
      if (strings.every((s) => UUID_RE.test(s)))                          return "uuid";
      if (strings.every((s) => ISO_DATE_RE.test(s)))                      return "date";
      if (strings.every((s) => URL_RE.test(s)))                           return "url";
      if (strings.every((s) => EMAIL_RE.test(s)))                         return "email";
      if (strings.every((s) => SLUG_RE.test(s) && s.length < 80))        return "slug";

      return "string";
    }
  }

  // Mixed types — mark as nullable if the non-null subset has a consistent type
  if (types.has("object") && nonNull.length < values.length) {
    const innerType = inferType(nonNull);
    return `${innerType}?`;
  }

  return "mixed";
}

// ─── List normalizer ──────────────────────────────────────────────────────────

/**
 * Normalise a raw API response into a flat array.
 * Handles the 10+ common REST list wrapper shapes used by popular CMSes.
 */
export function normalizeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const wrappers = [
      "items", "data", "results", "records", "entries",
      "nodes", "collection", "content", "list",
      // Resource-specific named wrappers (blogs, projects, posts, etc.)
      ...Object.keys(data as object).filter((k) => Array.isArray((data as any)[k])),
    ];
    for (const key of wrappers) {
      const v = (data as any)[key];
      if (Array.isArray(v)) return v;
    }
    // Single-object response — wrap it
    return [data];
  }
  return [];
}

// ─── System field detection ───────────────────────────────────────────────────

const SYSTEM_ID_NAMES   = new Set(["id", "_id", "uuid"]);
const SYSTEM_DATE_NAMES = new Set(["created_at", "updated_at", "createdAt", "updatedAt", "deleted_at"]);

/** Returns true if a field is a system-managed ID (should be excluded from create payloads). */
export function isSystemId(fieldName: string, fieldType: string): boolean {
  return SYSTEM_ID_NAMES.has(fieldName) || (fieldType === "uuid" && fieldName.endsWith("_id") === false);
}

/** Returns true if a field is a system-managed timestamp (should be excluded from create/update payloads). */
export function isSystemTimestamp(fieldName: string, fieldType: string): boolean {
  return SYSTEM_DATE_NAMES.has(fieldName) && (fieldType === "date" || fieldType === "date?");
}

/** Strips trailing "?" from a nullable type string, returns the base type. */
export function baseType(t: string): string {
  return t.endsWith("?") ? t.slice(0, -1) : t;
}

/** Returns the canonical identifier field name from a list of field names.
 *  Priority: "id" > "_id" > first field whose type is "uuid". */
export function detectIdField(fields: Array<{ name: string; type: string }>): string {
  if (fields.find((f) => f.name === "id"))  return "id";
  if (fields.find((f) => f.name === "_id")) return "_id";
  const uuidField = fields.find((f) => baseType(f.type) === "uuid");
  return uuidField?.name ?? "id";
}

/** Detects the most likely human-readable title field. */
export function detectTitleField(fields: Array<{ name: string; type: string }>): string | undefined {
  const candidates = ["title", "name", "label", "headline", "subject"];
  for (const c of candidates) {
    if (fields.find((f) => f.name === c)) return c;
  }
  // Fallback: first long string field that isn't a slug/url/email
  return fields.find(
    (f) => baseType(f.type) === "string" && !["slug", "url", "email"].includes(baseType(f.type)),
  )?.name;
}

/** Detects the status/state enum field if present. */
export function detectStatusField(fields: Array<{ name: string; type: string }>): string | undefined {
  const candidates = ["status", "state", "published_status", "visibility"];
  for (const c of candidates) {
    const f = fields.find((fd) => fd.name === c);
    if (f && baseType(f.type).startsWith("enum(")) return c;
  }
  return undefined;
}
