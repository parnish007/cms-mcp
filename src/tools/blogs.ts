// src/tools/blogs.ts
// Blog CRUD tools with Zod validation + diff preview.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { AuditLogger, withAudit } from "../lib/audit.js";
import { buildCreatePreview, buildUpdatePreview } from "../lib/diff.js";
import { runWithTransaction, deleteRollback } from "../lib/transaction.js";
import { type ApprovalGate, checkGate } from "../lib/approval-gate.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const BlogCreateSchema = z.object({
  title: z.string().min(1).max(200).describe("Blog post title"),
  body: z.string().min(1).describe("Full post content in markdown"),
  excerpt: z.string().max(300).optional().describe("Short preview shown in listings"),
  slug: z.string().regex(/^[a-z0-9-]+$/).optional().describe("URL slug — auto-generated if omitted"),
  cover_image: z.string().url().optional().describe("Cover image URL"),
  tags: z.array(z.string()).optional(),
  status: z.enum(["draft", "published"]).default("draft"),
  published_at: z.string().datetime().optional().describe("ISO 8601 publish date"),
  reading_time: z.number().int().min(1).optional().describe("Estimated reading time in minutes"),
  seo_title: z.string().max(70).optional(),
  seo_description: z.string().max(160).optional(),
});

const BlogUpdateSchema = BlogCreateSchema.partial().extend({
  id: z.string().min(1).describe("Blog post ID to update"),
});

// ─── Register Tools ───────────────────────────────────────────────────────────

export function registerBlogTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  gate?: ApprovalGate | null,
): void {
  const endpoint = config.endpoints.blogs;

  if (!endpoint) {
    console.error("[cms-mcp] No blogs endpoint — blog tools disabled.");
    return;
  }

  const client = new ApiClient(config);

  // ── list_blogs ─────────────────────────────────────────────────────────────

  server.tool(
    "list_blogs",
    {
      status: z.enum(["all", "draft", "published"]).default("all"),
      limit: z.number().int().min(1).max(100).default(20),
      search: z.string().optional(),
    },
    async (args) => {
      return withAudit(audit, "list_blogs", args, async () => {
        const data = await client.get<unknown>(endpoint, {
          status: args.status !== "all" ? args.status : undefined,
          limit: args.limit,
          search: args.search,
        });

        const items = normalizeList(data);
        const summary = items
          .map((b: any) => `• [${b.id ?? "?"}] ${b.title ?? "Untitled"} (${b.status ?? "?"})`)
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: items.length === 0 ? "No blog posts found." : `Found ${items.length} post(s):\n\n${summary}`,
          }],
        };
      });
    },
  );

  // ── get_blog ───────────────────────────────────────────────────────────────

  server.tool(
    "get_blog",
    { id: z.string().min(1).describe("Blog ID or slug") },
    async (args) => {
      return withAudit(audit, "get_blog", args, async () => {
        const data = await client.get<Record<string, unknown>>(`${endpoint}/${args.id}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      });
    },
  );

  // ── preview_create_blog ────────────────────────────────────────────────────

  server.tool(
    "preview_create_blog",
    { ...BlogCreateSchema.shape },
    async (args) => {
      return withAudit(audit, "preview_create_blog", args, async () => {
        const parsed = BlogCreateSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Validation error:\n${formatZodError(parsed.error)}`,
            }],
          };
        }
        const preview = buildCreatePreview(parsed.data as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: preview }] };
      });
    },
  );

  // ── create_blog ────────────────────────────────────────────────────────────

  server.tool(
    "create_blog",
    {
      ...BlogCreateSchema.shape,
      confirm: z.literal(true).describe("Must be true to create"),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("create_blog");

      return withAudit(audit, "create_blog", args, async () => {
        const { confirm: _, ...rest } = args;

        const parsed = BlogCreateSchema.safeParse(rest);
        if (!parsed.success) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Validation error:\n${formatZodError(parsed.error)}`,
            }],
          };
        }

        const preview = buildCreatePreview(parsed.data as Record<string, unknown>);
        const blocked = await checkGate(gate, "create_blog", args as Record<string, unknown>, preview, config.approvals?.tools);
        if (blocked) return blocked;

        const created = await runWithTransaction(async (tx) => {
          const result = await client.post<Record<string, unknown>>(endpoint, parsed.data);
          const id = String(result["id"] ?? result["_id"] ?? "");
          if (id) tx.addStep(`Created blog ${id}`, deleteRollback(client, endpoint, id));
          tx.commit();
          return result;
        });

        return {
          content: [{
            type: "text" as const,
            text: `✅ Blog post created!\n\nID: ${created["id"] ?? "(unknown)"}\nTitle: ${created["title"] ?? parsed.data.title}\nStatus: ${created["status"] ?? parsed.data.status}`,
          }],
        };
      });
    },
  );

  // ── preview_update_blog ────────────────────────────────────────────────────

  server.tool(
    "preview_update_blog",
    { ...BlogUpdateSchema.shape },
    async (args) => {
      return withAudit(audit, "preview_update_blog", args, async () => {
        const { id, ...updates } = args;
        const current = await client.get<Record<string, unknown>>(`${endpoint}/${id}`);
        const preview = buildUpdatePreview(current, updates as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: preview }] };
      });
    },
  );

  // ── update_blog ────────────────────────────────────────────────────────────

  server.tool(
    "update_blog",
    {
      ...BlogUpdateSchema.shape,
      confirm: z.literal(true),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("update_blog");

      return withAudit(audit, "update_blog", args, async () => {
        const { confirm: _, id, ...updates } = args;

        const parsed = BlogUpdateSchema.safeParse({ id, ...updates });
        if (!parsed.success) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Validation error:\n${formatZodError(parsed.error)}`,
            }],
          };
        }

        const current = await client.get<Record<string, unknown>>(`${endpoint}/${id}`);
        const preview = buildUpdatePreview(current, updates as Record<string, unknown>);
        const blocked = await checkGate(gate, "update_blog", args as Record<string, unknown>, preview, config.approvals?.tools);
        if (blocked) return blocked;

        await runWithTransaction(async (tx) => {
          tx.addStep(`Update blog ${id}`, async () => {
            await client.patch(`${endpoint}/${id}`, current);
          });
          await client.patch(`${endpoint}/${id}`, updates);
          tx.commit();
        });

        return {
          content: [{ type: "text" as const, text: `✅ Blog post ${id} updated successfully.` }],
        };
      });
    },
  );

  // ── publish_blog ───────────────────────────────────────────────────────────

  server.tool(
    "publish_blog",
    {
      id: z.string().min(1),
      confirm: z.literal(true),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("publish_blog");

      return withAudit(audit, "publish_blog", args, async () => {
        const preview = `Publish blog post ${args.id} — set status → "published"`;
        const blocked = await checkGate(gate, "publish_blog", args as Record<string, unknown>, preview, config.approvals?.tools);
        if (blocked) return blocked;

        await client.patch(`${endpoint}/${args.id}`, {
          status: "published",
          published_at: new Date().toISOString(),
        });
        return {
          content: [{ type: "text" as const, text: `✅ Blog post ${args.id} is now published.` }],
        };
      });
    },
  );

  // ── unpublish_blog ─────────────────────────────────────────────────────────

  server.tool(
    "unpublish_blog",
    { id: z.string().min(1), confirm: z.literal(true) },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("unpublish_blog");

      return withAudit(audit, "unpublish_blog", args, async () => {
        await client.patch(`${endpoint}/${args.id}`, { status: "draft" });
        return {
          content: [{ type: "text" as const, text: `↩️ Blog post ${args.id} moved back to draft.` }],
        };
      });
    },
  );

  // ── delete_blog ────────────────────────────────────────────────────────────

  server.tool(
    "delete_blog",
    { id: z.string().min(1), confirm: z.literal(true) },
    async (args) => {
      if (config.readOnly) return readOnlyBlock("delete_blog");

      return withAudit(audit, "delete_blog", args, async () => {
        const preview = `⚠️ DELETE blog post ${args.id} — this is irreversible`;
        const blocked = await checkGate(gate, "delete_blog", args as Record<string, unknown>, preview, config.approvals?.tools);
        if (blocked) return blocked;

        await client.delete(`${endpoint}/${args.id}`);
        return {
          content: [{ type: "text" as const, text: `🗑️ Blog post ${args.id} deleted.` }],
        };
      });
    },
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "results", "blogs", "posts", "articles", "records", "entries", "nodes", "collection", "content", "list"]) {
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
    content: [{ type: "text" as const, text: `🔒 "${tool}" is disabled — read-only mode.` }],
  };
}
