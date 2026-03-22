// src/lib/resources.ts
// MCP Resources — exposes CMS content as subscribable URIs.
// Instead of Claude calling tools, it can directly read cms://projects/my-project.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { ApiClient } from "./api-client.js";
import { distill } from "./content-distiller.js";
import type { VectorCache } from "./vector-cache.js";

// ─── Register Resources ──────────────────────────────────────────────────────

export function registerResources(
  server: McpServer,
  config: Config,
  vectorCache?: VectorCache,
): void {
  const client = new ApiClient(config);

  // ── Projects Resource Template ──────────────────────────────────────────

  if (config.endpoints.projects) {
    const projectsEndpoint = config.endpoints.projects;

    server.resource(
      "project",
      new ResourceTemplate("cms://projects/{id}", { list: undefined }),
      { description: "Portfolio project entry. Use when looking up project details, tech stacks, or metadata." },
      async (uri, variables) => {
        const id = String(variables.id ?? "");
        const raw = await client.get<Record<string, unknown>>(`${projectsEndpoint}/${id}`);

        const distilled = distill(raw, {
          source: "CMS",
          id,
          lastUpdated: String(raw["updated_at"] ?? raw["updatedAt"] ?? "unknown"),
          status: String(raw["status"] ?? "unknown"),
        });

        if (vectorCache) {
          vectorCache.store(
            id,
            "project",
            String(raw["title"] ?? ""),
            `${raw["title"] ?? ""} ${raw["summary"] ?? ""} ${raw["description"] ?? ""} ${(raw["tags"] as string[] ?? []).join(" ")}`,
            distilled.data,
          );
        }

        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/markdown",
            text: distilled.full,
          }],
        };
      },
    );

    // Projects list resource (static URI)
    server.resource(
      "projects-list",
      "cms://projects",
      { description: "List of all portfolio projects with titles, statuses, and IDs." },
      async (uri) => {
        const data = await client.get<unknown>(projectsEndpoint);
        const items = normalizeList(data);

        const text = items
          .map((p: any) => `- **${p.title ?? "Untitled"}** (${p.status ?? "?"}) — ID: \`${p.id ?? p._id ?? "?"}\``)
          .join("\n");

        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/markdown",
            text: `# Projects\n\n${text || "No projects found."}`,
          }],
        };
      },
    );
  }

  // ── Blogs Resource Template ─────────────────────────────────────────────

  if (config.endpoints.blogs) {
    const blogsEndpoint = config.endpoints.blogs;

    server.resource(
      "blog",
      new ResourceTemplate("cms://blogs/{id}", { list: undefined }),
      { description: "Blog post with full content, metadata, and SEO fields." },
      async (uri, variables) => {
        const id = String(variables.id ?? "");
        const raw = await client.get<Record<string, unknown>>(`${blogsEndpoint}/${id}`);

        const distilled = distill(raw, {
          source: "CMS",
          id,
          lastUpdated: String(raw["updated_at"] ?? raw["updatedAt"] ?? "unknown"),
          author: String(raw["author"] ?? "unknown"),
          status: String(raw["status"] ?? "unknown"),
        });

        if (vectorCache) {
          vectorCache.store(
            id,
            "blog",
            String(raw["title"] ?? ""),
            `${raw["title"] ?? ""} ${raw["excerpt"] ?? ""} ${raw["body"] ?? ""}`,
            distilled.data,
          );
        }

        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/markdown",
            text: distilled.full,
          }],
        };
      },
    );

    server.resource(
      "blogs-list",
      "cms://blogs",
      { description: "List of all blog posts with titles, statuses, dates, and IDs." },
      async (uri) => {
        const data = await client.get<unknown>(blogsEndpoint);
        const items = normalizeList(data);

        const text = items
          .map((b: any) => `- **${b.title ?? "Untitled"}** (${b.status ?? "?"}) — ID: \`${b.id ?? b._id ?? "?"}\``)
          .join("\n");

        return {
          contents: [{
            uri: uri.href,
            mimeType: "text/markdown",
            text: `# Blog Posts\n\n${text || "No posts found."}`,
          }],
        };
      },
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "results", "projects", "posts", "blogs"]) {
      const v = (data as any)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
