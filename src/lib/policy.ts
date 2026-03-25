// src/lib/policy.ts
// Policy engine — Pillar 5 (governance layer).
// Loads policies.json and runs them before any write operation.
// Reject the write if any rule is violated, returning human-readable violations.

import { readFileSync, existsSync } from "fs";
import { z } from "zod";

// ─── Policy rule schemas ──────────────────────────────────────────────────────

const BaseRule = z.object({
  tools: z.array(z.string()).optional().describe("Tool names this rule applies to. Omit for all write tools."),
  message: z.string().optional().describe("Custom violation message"),
});

const RequiredFieldsRule = BaseRule.extend({
  type: z.literal("required_fields"),
  fields: z.array(z.string()).describe("Fields that must be present and non-empty"),
});

const MinTagsRule = BaseRule.extend({
  type: z.literal("min_tags"),
  min: z.number().int().min(1),
  field: z.string().default("tags"),
});

const MaxTagsRule = BaseRule.extend({
  type: z.literal("max_tags"),
  max: z.number().int().min(1),
  field: z.string().default("tags"),
});

const MaxLengthRule = BaseRule.extend({
  type: z.literal("max_length"),
  field: z.string(),
  max: z.number().int().min(1),
});

const MinLengthRule = BaseRule.extend({
  type: z.literal("min_length"),
  field: z.string(),
  min: z.number().int().min(1),
});

const ForbiddenWordsRule = BaseRule.extend({
  type: z.literal("forbidden_words"),
  field: z.string().default("body"),
  words: z.array(z.string()).describe("Case-insensitive list of forbidden strings"),
});

const RequireCoverImageRule = BaseRule.extend({
  type: z.literal("require_cover_image"),
  field: z.string().default("cover_image"),
});

const SeoRequiredRule = BaseRule.extend({
  type: z.literal("seo_required"),
  fields: z.array(z.string()).default(["seo_title", "seo_description"]),
});

const RegexMatchRule = BaseRule.extend({
  type: z.literal("regex_match"),
  field: z.string(),
  pattern: z.string().describe("Regex pattern the field must match"),
  invert: z.boolean().default(false).describe("If true, field must NOT match the pattern"),
});

const StatusTransitionRule = BaseRule.extend({
  type: z.literal("status_transition"),
  allowedTransitions: z.array(z.tuple([z.string(), z.string()]))
    .describe("Allowed [from, to] status transitions. e.g. [[\"draft\",\"published\"]]"),
});

const PolicyRule = z.discriminatedUnion("type", [
  RequiredFieldsRule,
  MinTagsRule,
  MaxTagsRule,
  MaxLengthRule,
  MinLengthRule,
  ForbiddenWordsRule,
  RequireCoverImageRule,
  SeoRequiredRule,
  RegexMatchRule,
  StatusTransitionRule,
]);

const PolicyFileSchema = z.object({
  version: z.string().default("1"),
  description: z.string().optional(),
  rules: z.array(PolicyRule),
});

export type PolicyFile = z.infer<typeof PolicyFileSchema>;
export type PolicyRuleType = z.infer<typeof PolicyRule>;

// ─── Violation ────────────────────────────────────────────────────────────────

export interface PolicyViolation {
  rule: string;
  message: string;
}

export interface PolicyResult {
  allowed: boolean;
  violations: PolicyViolation[];
  formatted: string;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export function loadPolicies(policyPath: string): PolicyFile {
  if (!existsSync(policyPath)) {
    throw new Error(`[cms-mcp] Policy file not found: ${policyPath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(policyPath, "utf-8"));
  } catch {
    throw new Error(`[cms-mcp] Failed to parse policy file: ${policyPath}`);
  }

  const result = PolicyFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`[cms-mcp] Invalid policy file at ${policyPath}:\n${issues}`);
  }

  process.stderr.write(`[cms-mcp] Loaded ${result.data.rules.length} policy rules from ${policyPath}\n`);
  return result.data;
}

// ─── Rule Evaluators ──────────────────────────────────────────────────────────

function getField(data: Record<string, unknown>, field: string): unknown {
  return data[field];
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function evaluateRule(
  rule: PolicyRuleType,
  tool: string,
  data: Record<string, unknown>,
  currentData?: Record<string, unknown>,
): PolicyViolation | null {
  // Check if this rule applies to the given tool
  if (rule.tools && rule.tools.length > 0 && !rule.tools.includes(tool)) {
    return null;
  }

  switch (rule.type) {
    case "required_fields": {
      const missing = rule.fields.filter((f) => isEmpty(getField(data, f)));
      if (missing.length > 0) {
        return {
          rule: "required_fields",
          message: rule.message ?? `Required fields are missing: ${missing.map((f) => `\`${f}\``).join(", ")}`,
        };
      }
      return null;
    }

    case "min_tags": {
      const tags = getField(data, rule.field);
      const count = Array.isArray(tags) ? tags.length : 0;
      if (count < rule.min) {
        return {
          rule: "min_tags",
          message: rule.message ?? `At least ${rule.min} tag${rule.min === 1 ? "" : "s"} required (got ${count})`,
        };
      }
      return null;
    }

    case "max_tags": {
      const tags = getField(data, rule.field);
      const count = Array.isArray(tags) ? tags.length : 0;
      if (count > rule.max) {
        return {
          rule: "max_tags",
          message: rule.message ?? `Maximum ${rule.max} tag${rule.max === 1 ? "" : "s"} allowed (got ${count})`,
        };
      }
      return null;
    }

    case "max_length": {
      const val = getField(data, rule.field);
      if (typeof val === "string" && val.length > rule.max) {
        return {
          rule: "max_length",
          message: rule.message ?? `\`${rule.field}\` must be at most ${rule.max} characters (got ${val.length})`,
        };
      }
      return null;
    }

    case "min_length": {
      const val = getField(data, rule.field);
      if (typeof val === "string" && val.length < rule.min) {
        return {
          rule: "min_length",
          message: rule.message ?? `\`${rule.field}\` must be at least ${rule.min} characters (got ${val.length})`,
        };
      }
      return null;
    }

    case "forbidden_words": {
      const val = String(getField(data, rule.field) ?? "").toLowerCase();
      const found = rule.words.filter((w) => val.includes(w.toLowerCase()));
      if (found.length > 0) {
        return {
          rule: "forbidden_words",
          message: rule.message ?? `\`${rule.field}\` contains forbidden content: ${found.map((w) => `"${w}"`).join(", ")}`,
        };
      }
      return null;
    }

    case "require_cover_image": {
      if (isEmpty(getField(data, rule.field))) {
        return {
          rule: "require_cover_image",
          message: rule.message ?? `A cover image is required (\`${rule.field}\` is missing)`,
        };
      }
      return null;
    }

    case "seo_required": {
      const missing = rule.fields.filter((f) => isEmpty(getField(data, f)));
      if (missing.length > 0) {
        return {
          rule: "seo_required",
          message: rule.message ?? `SEO fields required: ${missing.map((f) => `\`${f}\``).join(", ")}`,
        };
      }
      return null;
    }

    case "regex_match": {
      const val = String(getField(data, rule.field) ?? "");
      const regex = new RegExp(rule.pattern);
      const matches = regex.test(val);
      if (rule.invert ? matches : !matches) {
        return {
          rule: "regex_match",
          message: rule.message ?? (rule.invert
            ? `\`${rule.field}\` must not match pattern /${rule.pattern}/`
            : `\`${rule.field}\` must match pattern /${rule.pattern}/`),
        };
      }
      return null;
    }

    case "status_transition": {
      if (!currentData) return null;
      const from = String(currentData["status"] ?? "");
      const to   = String(data["status"] ?? "");
      if (!to || to === from) return null; // no change

      const allowed = rule.allowedTransitions.some(([f, t]) => f === from && t === to);
      if (!allowed) {
        return {
          rule: "status_transition",
          message: rule.message ?? `Status transition from "${from}" to "${to}" is not allowed by policy`,
        };
      }
      return null;
    }
  }
}

// ─── Main Policy Runner ───────────────────────────────────────────────────────

export function runPolicies(
  policies: PolicyFile,
  tool: string,
  data: Record<string, unknown>,
  currentData?: Record<string, unknown>,
): PolicyResult {
  const violations: PolicyViolation[] = [];

  for (const rule of policies.rules) {
    const violation = evaluateRule(rule, tool, data, currentData);
    if (violation) violations.push(violation);
  }

  const allowed = violations.length === 0;
  const formatted = allowed
    ? "✅ All policy checks passed."
    : [
        `❌ Policy violations (${violations.length}):`,
        ...violations.map((v) => `  • [${v.rule}] ${v.message}`),
        ``,
        `Fix the above before this operation can proceed.`,
      ].join("\n");

  return { allowed, violations, formatted };
}

// ─── Example policy file builder ─────────────────────────────────────────────

export function buildExamplePolicies(): PolicyFile {
  return {
    version: "1",
    description: "Example cms-mcp policies — customize for your team",
    rules: [
      {
        type: "required_fields",
        tools: ["update_posts", "update_projects"],
        fields: ["cover_image", "seo_title", "seo_description"],
        message: "Cover image and SEO fields are required before publishing",
      },
      {
        type: "min_tags",
        tools: ["create_projects", "update_projects"],
        min: 2,
        field: "tags",
        message: "Projects must have at least 2 tags",
      },
      {
        type: "max_length",
        field: "seo_title",
        max: 70,
      },
      {
        type: "max_length",
        field: "seo_description",
        max: 160,
      },
      {
        type: "forbidden_words",
        tools: ["create_posts", "update_posts", "create_projects", "update_projects"],
        field: "body",
        words: ["lorem ipsum", "placeholder", "TODO", "FIXME"],
        message: "Content contains placeholder text — replace before saving",
      },
      {
        type: "seo_required",
        tools: ["update_posts", "update_projects"],
        fields: ["seo_title", "seo_description"],
      },
    ],
  };
}
