// src/plugins/policy-engine.ts
// v1.0.0 Policy Engine — Pillar 5 (governance layer).
//
// Wraps the policy rule library (src/lib/policy.ts) with:
//   - Tool alias resolution: create_X / update_X also match mutate_X rules,
//     and vice versa. delete_X is isolated — it does NOT inherit mutate_X rules.
//   - Hot-reload: reload() re-reads the policy file from disk without restart.
//   - MCP tool registration: check_policies + init_policies exposed to Claude.
//
// Policies always check INTERNAL (Claude-side) field names. The CMSAdapter
// field mapping runs AFTER policy enforcement, so policies see the same names
// that Claude sees.

import { z } from "zod";
import { writeFileSync, existsSync } from "fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { expandHome } from "../lib/config.js";
import type { AuditLogger } from "../lib/audit.js";
import { withAudit } from "../lib/audit.js";
import {
  loadPolicies,
  runPolicies,
  buildExamplePolicies,
  type PolicyFile,
  type PolicyResult,
} from "../lib/policy.js";

// ─── Tool alias resolution ────────────────────────────────────────────────────
//
// When a rule's `tools` array contains:
//   - "mutate_X"     → also applies to create_X and update_X (not delete_X)
//   - "create_X"     → also applies to mutate_X (for users still on legacy mode)
//   - "update_X"     → also applies to mutate_X
//   - "delete_X"     → no aliases; delete never inherits mutate_X coverage
//
// This means policy authors can write rules for either naming style and have
// them work with both v1.0.0 split tools and v0.5 legacy mutate_X.

function getToolAliases(toolName: string): string[] {
  const aliases: string[] = [toolName];

  const createMatch = toolName.match(/^create_(.+)$/);
  const updateMatch = toolName.match(/^update_(.+)$/);
  const mutateMatch = toolName.match(/^mutate_(.+)$/);

  if (createMatch) {
    aliases.push(`mutate_${createMatch[1]}`);
  } else if (updateMatch) {
    aliases.push(`mutate_${updateMatch[1]}`);
  } else if (mutateMatch) {
    aliases.push(`create_${mutateMatch[1]}`);
    aliases.push(`update_${mutateMatch[1]}`);
  }
  // delete_X: no aliases

  return aliases;
}

// ─── PolicyEngine ─────────────────────────────────────────────────────────────

export class PolicyEngine {
  private policyPath: string;
  private policies: PolicyFile;

  constructor(resolvedPath: string) {
    this.policyPath = resolvedPath;
    this.policies = loadPolicies(resolvedPath);
  }

  /**
   * Run all policy rules against the given tool call.
   * Alias resolution means rules written for mutate_X also apply to create_X / update_X.
   */
  enforce(
    toolName: string,
    data: Record<string, unknown>,
    currentData?: Record<string, unknown>,
  ): PolicyResult {
    const aliases = getToolAliases(toolName);

    // Expand each rule's `tools` array: if any alias matches, also include the
    // actual toolName so runPolicies can match it directly.
    const expandedPolicies: PolicyFile = {
      ...this.policies,
      rules: this.policies.rules.map((rule) => {
        if (!rule.tools || rule.tools.length === 0) return rule;
        const hasAlias = rule.tools.some((t) => aliases.includes(t));
        if (hasAlias && !rule.tools.includes(toolName)) {
          return { ...rule, tools: [...rule.tools, toolName] };
        }
        return rule;
      }),
    };

    return runPolicies(expandedPolicies, toolName, data, currentData);
  }

  /** Re-read the policy file from disk (hot-reload without server restart). */
  reload(): void {
    this.policies = loadPolicies(this.policyPath);
  }

  get ruleCount(): number {
    return this.policies.rules.length;
  }

  get description(): string {
    return this.policies.description ?? "";
  }
}

// ─── MCP tool registration ────────────────────────────────────────────────────

/**
 * Register check_policies and init_policies MCP tools.
 * Called from registerPolicyPlugin (src/plugins/policy.ts).
 */
export function registerPolicyTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  engine: PolicyEngine | null,
): void {
  // ── check_policies ──────────────────────────────────────────────────────────

  server.registerTool(
    "check_policies",
    {
      description:
        "Validate a data payload against your policies file before committing a write. " +
        "Returns pass/fail per rule. Use this before create_X or update_X to catch violations early.",
      inputSchema: {
        tool: z.string()
          .describe("The write tool name to check against (e.g. 'create_posts', 'update_posts')"),
        data: z.record(z.unknown())
          .describe("The data payload to validate against policies"),
      },
    },
    async (args) => {
      return withAudit(audit, "check_policies", args as Record<string, unknown>, async () => {
        if (!engine) {
          return {
            content: [{
              type: "text" as const,
              text: "No policies file configured. Add `\"policies\": \"./cms-mcp.policies.json\"` to your config.",
            }],
          };
        }

        const result = engine.enforce(args.tool, args.data as Record<string, unknown>);

        return {
          content: [{ type: "text" as const, text: result.formatted }],
        };
      });
    },
  );

  // ── init_policies ───────────────────────────────────────────────────────────

  server.registerTool(
    "init_policies",
    {
      description:
        "Generate a starter cms-mcp.policies.json with example rules for your endpoints. " +
        "Requires confirm: true.",
      inputSchema: {
        output_path: z.string().default("./cms-mcp.policies.json")
          .describe("Where to write the example policies file"),
        confirm: z.literal(true).describe("Must be true to write to disk"),
      },
    },
    async (args) => {
      if (config.readOnly) {
        return { content: [{ type: "text" as const, text: "🔒 Disabled in read-only mode." }] };
      }

      return withAudit(audit, "init_policies", args as Record<string, unknown>, async () => {
        if (existsSync(args.output_path)) {
          return {
            content: [{
              type: "text" as const,
              text: `Policy file already exists at ${args.output_path}. Delete it first or edit it directly.`,
            }],
          };
        }

        const example = buildExamplePolicies();
        writeFileSync(args.output_path, JSON.stringify(example, null, 2) + "\n", "utf-8");

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ Example policies written to ${args.output_path}`,
              ``,
              `Add this to cms-mcp.config.json:`,
              `  "policies": "${args.output_path}"`,
              ``,
              `Then edit the rules to match your team's requirements.`,
              `Use \`check_policies\` to test rules before committing.`,
            ].join("\n"),
          }],
        };
      });
    },
  );
}

// ─── Factory helper ───────────────────────────────────────────────────────────

/**
 * Create a PolicyEngine from config.policies (resolved path).
 * Returns null if no policies path is configured.
 */
export function createPolicyEngine(config: Config): PolicyEngine | null {
  if (!config.policies) return null;
  try {
    return new PolicyEngine(expandHome(config.policies));
  } catch (err) {
    process.stderr.write(
      `[cms-mcp] Policy engine failed to load: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}
