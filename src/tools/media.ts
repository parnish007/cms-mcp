// src/tools/media.ts
// Media tools — Pillar 3 (binary proxy) in action.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { AuditLogger, withAudit } from "../lib/audit.js";
import { proxyUpload } from "../lib/media-proxy.js";
import { ApiClient } from "../lib/api-client.js";

export function registerMediaTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
): void {
  const client = new ApiClient(config);

  // ── upload_media_from_url ──────────────────────────────────────────────────

  server.tool(
    "upload_media_from_url",
    {
      url: z.string().url().describe("Public URL of the image or file to upload"),
      alt_text: z.string().optional().describe("Accessible alt text for images"),
      folder: z.string().optional().describe("Destination folder/path in your media library"),
    },
    async (args) => {
      if (config.readOnly) {
        return { content: [{ type: "text" as const, text: "🔒 Disabled in read-only mode." }] };
      }

      return withAudit(audit, "upload_media_from_url", args, async () => {
        const extraFields: Record<string, string> = {};
        if (args.alt_text) extraFields["alt_text"] = args.alt_text;
        if (args.folder) extraFields["folder"] = args.folder;

        const result = await proxyUpload(config, args.url, extraFields);

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ Media uploaded successfully!`,
              ``,
              `URL: ${result.url}`,
              `Filename: ${result.filename}`,
              `Type: ${result.mimeType}`,
              `Size: ${(result.sizeBytes / 1024).toFixed(1)} KB`,
              result.id ? `ID: ${result.id}` : "",
            ].filter(Boolean).join("\n"),
          }],
        };
      });
    },
  );

  // ── list_media ─────────────────────────────────────────────────────────────

  server.tool(
    "list_media",
    {
      limit: z.number().int().min(1).max(100).default(20),
      search: z.string().optional().describe("Search by filename"),
    },
    async (args) => {
      return withAudit(audit, "list_media", args, async () => {
        if (!config.endpoints.media) {
          return { content: [{ type: "text" as const, text: "No media endpoint configured." }] };
        }

        const data = await client.get<unknown>(config.endpoints.media, {
          limit: args.limit,
          search: args.search,
        });

        const items = normalizeList(data);
        const summary = items
          .map((m: any) => `• ${m.filename ?? m.name ?? "?"} — ${m.url ?? m.secure_url ?? "no URL"}`)
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: items.length === 0 ? "No media found." : `Found ${items.length} item(s):\n\n${summary}`,
          }],
        };
      });
    },
  );

  // ── delete_media ───────────────────────────────────────────────────────────

  server.tool(
    "delete_media",
    {
      id: z.string().min(1).describe("Media asset ID"),
      confirm: z.literal(true).describe("Must be true — irreversible"),
    },
    async (args) => {
      if (config.readOnly) {
        return { content: [{ type: "text" as const, text: "🔒 Disabled in read-only mode." }] };
      }

      return withAudit(audit, "delete_media", args, async () => {
        if (!config.endpoints.media) {
          return { content: [{ type: "text" as const, text: "No media endpoint configured." }] };
        }
        await client.delete(`${config.endpoints.media}/${args.id}`);
        return { content: [{ type: "text" as const, text: `🗑️ Media ${args.id} deleted.` }] };
      });
    },
  );
}

function normalizeList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["items", "data", "results", "assets", "files", "media"]) {
      const v = (data as any)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}
