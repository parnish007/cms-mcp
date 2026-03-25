// src/tools/search.ts
// Semantic search and knowledge tools.
// Uses the local vector cache (TF-IDF or OpenAI embeddings) to answer
// natural-language queries without hitting the CMS API directly.
//
// sync_all_content is GENERIC — syncs every configured endpoint,
// not just hardcoded "projects" and "blogs".

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { AuditLogger, withAudit } from "../lib/audit.js";
import { ApiClient } from "../lib/api-client.js";
import type { VectorCache } from "../lib/vector-cache.js";
import type { CircuitBreaker } from "../lib/circuit-breaker.js";
import { normalizeList } from "../lib/type-inference.js";

export function registerSearchTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  vectorCache?: VectorCache,
  breaker?: CircuitBreaker,
): void {
  const client = new ApiClient(config);

  // ── semantic_search ──────────────────────────────────────────────────────

  server.registerTool(
    "semantic_search",
    {
      description: "Search your CMS content using natural language. Queries the local vector index built by sync_all_content. No live API call — instant results.",
      inputSchema: {
        query: z.string().min(1).max(500)
          .describe("Natural language query — e.g. 'dashboard project' or 'post about machine learning'"),
        type: z.string().optional()
          .describe("Filter by resource type (e.g. 'posts', 'projects'). Omit to search all."),
        limit: z.number().int().min(1).max(20).default(5)
          .describe("Maximum results to return"),
      },
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
                "Then index your content with `sync_all_content`.",
              ].join("\n"),
            }],
          };
        }

        const results = await vectorCache.search(args.query, args.limit, args.type ?? undefined);

        if (results.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: [
                `No results found for "${args.query}".`,
                "",
                "The vector index may be empty — run `sync_all_content` to index your CMS content.",
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
            `**Type:** ${r.type} | **ID:** \`${r.id}\`${meta?.status ? ` | **Status:** ${meta.status}` : ""}`,
          );
          if (meta?.summary || meta?.excerpt || meta?.description) {
            lines.push(`> ${(meta.summary ?? meta.excerpt ?? meta.description ?? "").toString().slice(0, 200)}`);
          }
          if (meta?.tech_stack && Array.isArray(meta.tech_stack)) {
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
  // Indexes ALL configured endpoints into the vector cache.
  // Generic — works with any endpoint key, not just hardcoded projects/blogs.

  server.registerTool(
    "sync_all_content",
    {
      description: "Index all CMS content into the local vector cache for semantic_search. Fetches from all configured endpoints (or a specific subset).",
      inputSchema: {
        endpoints: z.array(z.string()).optional()
          .describe(
            "Specific endpoint keys to sync (e.g. [\"posts\", \"projects\"]). " +
            "Omit to sync all configured endpoints.",
          ),
      },
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

        const allEndpoints = config.endpoints as Record<string, string | undefined>;
        const keysToSync = args.endpoints
          ? args.endpoints.filter((k) => allEndpoints[k])
          : Object.keys(allEndpoints).filter((k) => k !== "media" && allEndpoints[k]);

        if (keysToSync.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No endpoints to sync. Add entries to `endpoints` in your config.",
            }],
          };
        }

        let totalSynced = 0;
        const details: string[] = [];

        for (const key of keysToSync) {
          const url = allEndpoints[key];
          if (!url) continue;

          try {
            const fetchFn = () => client.get<unknown>(url);
            const data = breaker
              ? await breaker.execute(`${key}:list`, fetchFn)
              : await fetchFn();

            const items = normalizeList(data);
            let synced = 0;

            for (const item of items as any[]) {
              const id = String(item.id ?? item._id ?? "");
              if (!id) continue;

              // Build searchable text from common content fields
              const title = String(item.title ?? item.name ?? item.headline ?? item.subject ?? id);
              const contentParts: string[] = [title];

              for (const f of [
                "summary", "description", "excerpt", "body", "content",
                "tags", "tech_stack", "categories", "label",
              ]) {
                const v = item[f];
                if (!v) continue;
                if (Array.isArray(v)) contentParts.push(v.join(" "));
                else if (typeof v === "string") contentParts.push(v);
              }

              await vectorCache.store(id, key, title, contentParts.join(" "), item);
              synced++;
            }

            totalSynced += synced;
            details.push(`${key}: ${synced} indexed (${items.length} fetched)`);
          } catch (err) {
            details.push(`${key}: error — ${(err as Error).message?.slice(0, 80)}`);
          }
        }

        const stats = vectorCache.stats();

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ Content sync complete`,
              ``,
              `**Synced:** ${totalSynced} items across ${keysToSync.length} endpoint(s)`,
              ...details.map((d) => `  • ${d}`),
              ``,
              `**Cache stats:** ${stats.totalEntries} total entries, ${stats.vocabSize} vocabulary terms`,
              ``,
              `Use \`semantic_search\` for natural language queries across all indexed content.`,
            ].join("\n"),
          }],
        };
      });
    },
  );

  // ── knowledge_status ──────────────────────────────────────────────────────

  server.registerTool(
    "knowledge_status",
    {
      description: "Show the current state of the local vector index: entry count by type, vocabulary size, and circuit breaker status.",
    },
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
