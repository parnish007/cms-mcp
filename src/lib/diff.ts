// src/lib/diff.ts
// Diff preview engine — Pillar 4.
// Before any write, fetches current state and computes a field-level diff.
// Claude renders this as a table so the user sees exactly what changes.

export interface DiffRow {
  field: string;
  current: string;
  proposed: string;
  changed: boolean;
}

export interface DiffPreview {
  summary: string;
  rows: DiffRow[];
  hasChanges: boolean;
  changeCount: number;
}

// ─── Core diff function ───────────────────────────────────────────────────────

export function computeDiff(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
  options: { omitUnchanged?: boolean } = {},
): DiffPreview {
  const allKeys = new Set([...Object.keys(current), ...Object.keys(proposed)]);
  const rows: DiffRow[] = [];

  for (const key of allKeys) {
    const cur = formatValue(current[key]);
    const prop = formatValue(proposed[key]);
    const changed = cur !== prop;

    if (options.omitUnchanged && !changed) continue;

    rows.push({ field: key, current: cur, proposed: prop, changed });
  }

  const changeCount = rows.filter((r) => r.changed).length;

  return {
    summary: changeCount === 0
      ? "No changes detected."
      : `${changeCount} field${changeCount === 1 ? "" : "s"} will change.`,
    rows,
    hasChanges: changeCount > 0,
    changeCount,
  };
}

// ─── Format as Claude-readable markdown table ─────────────────────────────────

export function formatDiffAsTable(diff: DiffPreview): string {
  if (!diff.hasChanges) {
    return "✅ No changes — current state matches proposed state.";
  }

  const changedRows = diff.rows.filter((r) => r.changed);
  const unchangedRows = diff.rows.filter((r) => !r.changed);

  const lines: string[] = [
    `## Proposed Changes (${diff.changeCount} field${diff.changeCount === 1 ? "" : "s"})`,
    "",
    "| Field | Current Value | Proposed Value |",
    "|-------|--------------|----------------|",
    ...changedRows.map((r) => `| **${r.field}** | ${r.current} | ${r.proposed} |`),
  ];

  if (unchangedRows.length > 0) {
    lines.push("", `*${unchangedRows.length} unchanged field${unchangedRows.length === 1 ? "" : "s"} omitted.*`);
  }

  lines.push("", "---", "Reply **confirm** to apply, or **cancel** to abort.");

  return lines.join("\n");
}

// ─── Format value for display ─────────────────────────────────────────────────

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "*(empty)*";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value.length === 0) return "*(empty)*";
    if (value.length > 120) return `${value.slice(0, 117)}...`;
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "*(empty array)*";
    return value.map((v) => String(v)).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value).slice(0, 120);
  }
  return String(value);
}

// ─── Diff builder for update operations ──────────────────────────────────────

/**
 * Given the current record from the API and the proposed update fields,
 * produces a formatted diff string ready to return to Claude.
 */
export function buildUpdatePreview(
  current: Record<string, unknown>,
  proposed: Record<string, unknown>,
): string {
  const diff = computeDiff(current, proposed, { omitUnchanged: true });
  return formatDiffAsTable(diff);
}

/**
 * For create operations — shows all proposed fields as "new".
 */
export function buildCreatePreview(proposed: Record<string, unknown>): string {
  const lines = [
    "## New Record Preview",
    "",
    "| Field | Value |",
    "|-------|-------|",
    ...Object.entries(proposed)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `| **${k}** | ${formatValue(v)} |`),
    "",
    "---",
    "Reply **confirm** to create, or **cancel** to abort.",
  ];

  return lines.join("\n");
}
