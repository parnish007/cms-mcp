// src/tools/projects.ts
// Project CRUD tools with Zod validation firewall (Pillar 1) + diff preview (Pillar 4).

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { AuditLogger, withAudit } from "../lib/audit.js";
import { buildCreatePreview, buildUpdatePreview } from "../lib/diff.js";
import { runWithTransaction, deleteRollback } from "../lib/transaction.js";

// ─── Shared Schemas ───────────────────────────────────────────────────────────

const ProjectCreateSchema = z.object({
  title: z.string().min(1).max(200).describe("Project title"),
  summary: z.string().max(500).optional().describe("One-line tagline shown in cards"),
  description: z.string().optional().describe("Full project description (markdown supported)"),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional().describe("URL slug — auto-generated if omitted"),
  tech_stack: z.array(z.string()).optional().describe("Technologies used e.g. ['Next.js', 'Supabase']"),
  live_url: z.string().url().optional().describe("Live demo URL"),
  repo_url: z.string().url().optional().describe("GitHub/GitLab repository URL"),
  cover_image: z.string().url().optional().describe("Cover image URL"),
  tags: z.array(z.string()).optional().describe("Tags for filtering"),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  is_featured: z.boolean().default(false),
  seo_title: z.string().max(70).optional(),
  seo_description: z.string().max(160).optional(),
});

const ProjectUpdateSchema = ProjectCreateSchema.partial().extend({
  id: z.string().min(1).describe("Project ID to update"),
});

// ─── Register Tools ───────────────────────────────────────────────────────────

export function registerProjectTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
): void {
  const endpoint = config.endpoints.projects;

  if (!endpoint) {
    console.error("[cms-mcp] No projects endpoint — project tools disabled.");
    return;
  }

  const client = new ApiClient(config);

  // ── list_projects ──────────────────────────────────────────────────────────

  server.tool(
    "list_projects",
    {
      status: z.enum(["all", "draft", "published", "archived"]).default("all").describe("Filter by status"),
      limit: z.number().int().min(1).max(100).default(20),
      search: z.string().optional().describe("Search query"),
    },
    async (args) => {
      return withAudit(audit, "list_projects", args, async () => {
        const data = await client.get<unknown>(endpoint, {
          status: args.status !== "all" ? args.status : undefined,
          limit: args.limit,
          search: args.search,
        });

        const items = normalizeList(data);
        const summary = items
          .slice(0, args.limit)
          .map((p: any) => `• [${p.id ?? "?"}] ${p.title ?? "Untitled"} (${p.status ?? "?"})`)
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: items.length === 0
              ? "No projects found."
              : `Found ${items.length} project(s):\n\n${summary}`,
          }],
        };
      });
    },
  );

  // ── get_project ────────────────────────────────────────────────────────────

  server.tool(
    "get_project",
    {
      id: z.string().min(1).describe("Project ID or slug"),
    },
    async (args) => {
      return withAudit(audit, "get_project", args, async () => {
        const data = await client.get<Record<string, unknown>>(`${endpoint}/${args.id}`);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(data, null, 2),
          }],
        };
      });
    },
  );

  // ── preview_create_project ─────────────────────────────────────────────────

  server.tool(
    "preview_create_project",
    {
      ...ProjectCreateSchema.shape,
    },
    async (args) => {
      return withAudit(audit, "preview_create_project", args, async () => {
        // Validation firewall — runs before anything hits the API
        const parsed = ProjectCreateSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Validation error — fix these before creating:\n${formatZodError(parsed.error)}`,
            }],
          };
        }

        const preview = buildCreatePreview(parsed.data as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: preview }] };
      });
    },
  );

  // ── create_project ─────────────────────────────────────────────────────────

  server.tool(
    "create_project",
    {
      ...ProjectCreateSchema.shape,
      confirm: z.literal(true).describe("Must be true to actually create"),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("create_project");

      return withAudit(audit, "create_project", args, async () => {
        const { confirm: _, ...rest } = args;

        const parsed = ProjectCreateSchema.safeParse(rest);
        if (!parsed.success) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Validation error:\n${formatZodError(parsed.error)}`,
            }],
          };
        }

        const created = await runWithTransaction(async (tx) => {
          const result = await client.post<Record<string, unknown>>(endpoint, parsed.data);
          const id = String(result["id"] ?? result["_id"] ?? "");
          if (id) {
            tx.addStep(`Created project ${id}`, deleteRollback(client, endpoint, id));
          }
          tx.commit();
          return result;
        });

        return {
          content: [{
            type: "text" as const,
            text: `✅ Project created!\n\nID: ${created["id"] ?? "(unknown)"}\nTitle: ${created["title"] ?? parsed.data.title}\nStatus: ${created["status"] ?? parsed.data.status}`,
          }],
        };
      });
    },
  );

  // ── preview_update_project ─────────────────────────────────────────────────

  server.tool(
    "preview_update_project",
    {
      ...ProjectUpdateSchema.shape,
    },
    async (args) => {
      return withAudit(audit, "preview_update_project", args, async () => {
        const { id, ...updates } = args;
        const current = await client.get<Record<string, unknown>>(`${endpoint}/${id}`);
        const preview = buildUpdatePreview(current, updates as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: preview }] };
      });
    },
  );

  // ── update_project ─────────────────────────────────────────────────────────

  server.tool(
    "update_project",
    {
      ...ProjectUpdateSchema.shape,
      confirm: z.literal(true).describe("Must be true to apply changes"),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("update_project");

      return withAudit(audit, "update_project", args, async () => {
        const { confirm: _, id, ...updates } = args;

        const parsed = ProjectUpdateSchema.safeParse({ id, ...updates });
        if (!parsed.success) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Validation error:\n${formatZodError(parsed.error)}`,
            }],
          };
        }

        const current = await client.get<Record<string, unknown>>(`${endpoint}/${id}`);

        await runWithTransaction(async (tx) => {
          tx.addStep(`Update project ${id}`, async () => {
            await client.patch(`${endpoint}/${id}`, current);
          });
          await client.patch(`${endpoint}/${id}`, updates);
          tx.commit();
        });

        return {
          content: [{
            type: "text" as const,
            text: `✅ Project ${id} updated successfully.`,
          }],
        };
      });
    },
  );

  // ── publish_project ────────────────────────────────────────────────────────

  server.tool(
    "publish_project",
    {
      id: z.string().min(1).describe("Project ID to publish"),
      confirm: z.literal(true),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("publish_project");

      return withAudit(audit, "publish_project", args, async () => {
        await client.patch(`${endpoint}/${args.id}`, { status: "published" });
        return {
          content: [{
            type: "text" as const,
            text: `✅ Project ${args.id} is now published and live.`,
          }],
        };
      });
    },
  );

  // ── delete_project ─────────────────────────────────────────────────────────

  server.tool(
    "delete_project",
    {
      id: z.string().min(1).describe("Project ID to delete"),
      confirm: z.literal(true).describe("Must be true — this is irreversible"),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("delete_project");

      return withAudit(audit, "delete_project", args, async () => {
        await client.delete(`${endpoint}/${args.id}`);
        return {
          content: [{
            type: "text" as const,
            text: `🗑️ Project ${args.id} deleted.`,
          }],
        };
      });
    },
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "results", "projects", "records", "entries", "nodes", "collection", "content", "list"]) {
      const v = (data as any)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `  • ${i.path.join(".")}: ${i.message}`).join("\n");
}

function readOnlyBlock(tool: string) {
  return {
    content: [{
      type: "text" as const,
      text: `🔒 "${tool}" is disabled — server is running in read-only mode.`,
    }],
  };
}
