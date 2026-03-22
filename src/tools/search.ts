// src/tools/search.ts
// Semantic search and knowledge tools.
// Uses the local vector cache to answer "what did we build for X?" queries
// without hitting the CMS API — fuzzy matching via TF-IDF cosine similarity.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { AuditLogger, withAudit } from "../lib/audit.js";
import { ApiClient } from "../lib/api-client.js";
import type { VectorCache } from "../lib/vector-cache.js";
import type { CircuitBreaker } from "../lib/circuit-breaker.js";

export function registerSearchTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  vectorCache?: VectorCache,
  breaker?: CircuitBreaker,
): void {
  const client = new ApiClient(config);

  // ── semantic_search ──────────────────────────────────────────────────────

  server.tool(
    "semantic_search",
    {
      query: z.string().min(1).max(500)
        .describe("Natural language query — e.g. 'fintech dashboard project' or 'post about machine learning'"),
      type: z.enum(["all", "project", "blog"]).default("all")
        .describe("Filter by content type"),
      limit: z.number().int().min(1).max(20).default(5)
        .describe("Maximum results to return"),
    },
    async (args) => {
      return withAudit(audit, "semantic_search", args as Record<string, unknown>, async () => {
        if (!vectorCache) {
          return {
            content: [{
              type: "text" as const,
              text: [
                "Semantic search requires the vector cache to be enabled.",
                "",
                "Add to your config:",
                "```json",
                `"schemaCache": { "path": "~/.cms-mcp/schema-cache.db", "ttlMinutes": 60 }`,
                "```",
                "",
                "Then sync content with `sync_all_content` to populate the index.",
              ].join("\n"),
            }],
          };
        }

        const typeFilter = args.type === "all" ? undefined : args.type;
        const results = await vectorCache.search(args.query, args.limit, typeFilter);

        if (results.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: [
                `No results found for "${args.query}".`,
                "",
                "The vector cache may be empty. Run `sync_all_content` to index your CMS content.",
              ].join("\n"),
            }],
          };
        }

        const lines = [
          `## Search Results for "${args.query}"`,
          `*${results.length} match${results.length === 1 ? "" : "es"} found*`,
          "",
        ];

        for (const r of results) {
          const score = (r.score * 100).toFixed(1);
          const meta = r.metadata as any;
          lines.push(
            `### ${r.title} (${score}% match)`,
            `**Type:** ${r.type} | **ID:** \`${r.id}\` | **Status:** ${meta.status ?? "?"}`,
          );
          if (meta.summary || meta.excerpt) {
            lines.push(`> ${(meta.summary ?? meta.excerpt ?? "").slice(0, 200)}`);
          }
          if (meta.tech_stack && Array.isArray(meta.tech_stack)) {
            lines.push(`**Tech:** ${meta.tech_stack.join(", ")}`);
          }
          lines.push("");
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      });
    },
  );

  // ── sync_all_content ─────────────────────────────────────────────────────
  // Pulls all projects and blogs from CMS and indexes them in the vector cache

  server.tool(
    "sync_all_content",
    {
      types: z.array(z.enum(["projects", "blogs"])).default(["projects", "blogs"])
        .describe("Which content types to sync"),
    },
    async (args) => {
      return withAudit(audit, "sync_all_content", args as Record<string, unknown>, async () => {
        if (!vectorCache) {
          return {
            content: [{
              type: "text" as const,
              text: "Vector cache not enabled. Add `schemaCache` to your config.",
            }],
          };
        }

        let totalSynced = 0;
        const details: string[] = [];

        // Sync projects
        if (args.types.includes("projects") && config.endpoints.projects) {
          try {
            const fetchFn = () => client.get<unknown>(config.endpoints.projects!);
            const data = breaker
              ? await breaker.execute("projects:list", fetchFn)
              : await fetchFn();

            const items = normalizeList(data);
            for (const item of items as any[]) {
              const id = String(item.id ?? item._id ?? "");
              if (!id) continue;
              await vectorCache.store(
                id,
                "project",
                String(item.title ?? ""),
                `${item.title ?? ""} ${item.summary ?? ""} ${item.description ?? ""} ${(item.tags ?? []).join(" ")} ${(item.tech_stack ?? []).join(" ")}`,
                item,
              );
              totalSynced++;
            }
            details.push(`Projects: ${items.length} indexed`);
          } catch (err) {
            details.push(`Projects: error — ${(err as Error).message?.slice(0, 80)}`);
          }
        }

        // Sync blogs
        if (args.types.includes("blogs") && config.endpoints.blogs) {
          try {
            const fetchFn = () => client.get<unknown>(config.endpoints.blogs!);
            const data = breaker
              ? await breaker.execute("blogs:list", fetchFn)
              : await fetchFn();

            const items = normalizeList(data);
            for (const item of items as any[]) {
              const id = String(item.id ?? item._id ?? "");
              if (!id) continue;
              await vectorCache.store(
                id,
                "blog",
                String(item.title ?? ""),
                `${item.title ?? ""} ${item.excerpt ?? ""} ${item.body ?? ""} ${(item.tags ?? []).join(" ")}`,
                item,
              );
              totalSynced++;
            }
            details.push(`Blogs: ${items.length} indexed`);
          } catch (err) {
            details.push(`Blogs: error — ${(err as Error).message?.slice(0, 80)}`);
          }
        }

        const stats = vectorCache.stats();

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ Content sync complete`,
              ``,
              `**Synced:** ${totalSynced} items`,
              ...details.map((d) => `  • ${d}`),
              ``,
              `**Cache stats:** ${stats.totalEntries} total entries, ${stats.vocabSize} vocabulary terms`,
              ``,
              `You can now use \`semantic_search\` for fuzzy queries across all content.`,
            ].join("\n"),
          }],
        };
      });
    },
  );

  // ── knowledge_status ──────────────────────────────────────────────────────

  server.tool(
    "knowledge_status",
    {},
    async () => {
      return withAudit(audit, "knowledge_status", {}, async () => {
        if (!vectorCache) {
          return {
            content: [{
              type: "text" as const,
              text: "Vector cache not enabled.",
            }],
          };
        }

        const stats = vectorCache.stats();
        const breakerStatus = breaker?.getStatus();

        const lines = [
          `## Knowledge Base Status`,
          ``,
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Total entries | ${stats.totalEntries} |`,
          ...Object.entries(stats.byType).map(([t, n]) => `| ${t} entries | ${n} |`),
          `| Vocabulary size | ${stats.vocabSize} terms |`,
        ];

        if (breakerStatus) {
          lines.push(
            ``,
            `## Circuit Breaker`,
            `| Metric | Value |`,
            `|--------|-------|`,
            `| State | ${breakerStatus.state} |`,
            `| Failure count | ${breakerStatus.failureCount} |`,
            `| Cached responses | ${breakerStatus.cacheSize} |`,
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      });
    },
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "results", "projects", "blogs", "posts"]) {
      const v = (data as any)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
