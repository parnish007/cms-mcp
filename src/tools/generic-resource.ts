// src/tools/generic-resource.ts
// Generic resource tool factory.
//
// Replaces the hardcoded projects.ts and blogs.ts with a single factory that
// registers 7 MCP tools per configured endpoint at startup, using whatever
// field schema the live CMS API actually has:
//
//   list_{key}             — list records with dynamic filters
//   get_{key}              — fetch a single record by ID
//   preview_create_{key}   — show diff before creating
//   create_{key}           — create a record (confirm required)
//   preview_update_{key}   — show diff before updating
//   update_{key}           — update a record (confirm required)
//   delete_{key}           — delete a record (confirm + approval gate)
//
// For resources in cold-start mode (zero records at introspection time), tools
// are registered with a passthrough shape so Claude can still operate on them —
// just without field-level hints.
//
// All tools follow the same four-pillar pattern established in the original
// projects.ts / blogs.ts:
//   1. Zod validation firewall
//   2. Atomic transaction + rollback
//   3. Diff preview
//   4. Human approval gate (if configured)
// Plus audit logging on every tool call.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { AuditLogger, withAudit } from "../lib/audit.js";
import { buildCreatePreview, buildUpdatePreview } from "../lib/diff.js";
import { runWithTransaction, deleteRollback } from "../lib/transaction.js";
import { type ApprovalGate, checkGate } from "../lib/approval-gate.js";
import type { ResourceSchema } from "../lib/resource-schema.js";
import {
  buildZodShape,
  buildPassthroughShape,
} from "../lib/resource-schema.js";
import { normalizeList } from "../lib/type-inference.js";

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Register 7 MCP tools for a single CMS resource endpoint.
 * Called once per entry in config.endpoints at server startup.
 *
 * @param schema  The ResourceSchema produced by schema-introspector at startup.
 *                If source === "cold-start", tools use passthrough mode.
 */
export function registerGenericResourceTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  gate: ApprovalGate | null | undefined,
  schema: ResourceSchema,
): void {
  const { resourceKey, endpointUrl, fields, idField, titleField, statusField, source } = schema;
  const client  = new ApiClient(config);
  const isCold  = source === "cold-start";
  const coldNote = isCold
    ? `\n\n⚠️ Cold-start: no records were found at introspection time. ` +
      `Fields are accepted as-is. Run \`inspect_endpoint_schema\` once records exist to see the real schema.`
    : "";

  // ── list ──────────────────────────────────────────────────────────────────

  const listShape = isCold ? buildPassthroughShape("list") : buildZodShape(fields, "list");

  server.tool(
    `list_${resourceKey}`,
    listShape,
    async (args) => {
      return withAudit(audit, `list_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { limit = 20, search, ...filters } = args as any;

        const params: Record<string, string | number | boolean | undefined> = { limit: limit as number };
        if (search) params["search"] = search as string;
        // Pass any enum filter (e.g. status=published) directly to the API
        for (const [k, v] of Object.entries(filters)) {
          if (v !== undefined) params[k] = v as string | number | boolean;
        }

        const data  = await client.get<unknown>(endpointUrl, params);
        const items = normalizeList(data);

        if (items.length === 0) {
          return { content: [{ type: "text" as const, text: `No ${resourceKey} found.` }] };
        }

        const summary = items
          .slice(0, limit)
          .map((item: any) => {
            const id     = item[idField] ?? "?";
            const title  = titleField  ? (item[titleField]  ?? "Untitled") : "(no title field)";
            const status = statusField ? ` (${item[statusField] ?? "?"})` : "";
            return `• [${id}] ${title}${status}`;
          })
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: `Found ${items.length} ${resourceKey} record(s):\n\n${summary}`,
          }],
        };
      });
    },
  );

  // ── get ───────────────────────────────────────────────────────────────────

  server.tool(
    `get_${resourceKey}`,
    { id: z.string().min(1).describe(`${resourceKey} ID or slug`) },
    async (args) => {
      return withAudit(audit, `get_${resourceKey}`, args as Record<string, unknown>, async () => {
        const data = await client.get<Record<string, unknown>>(`${endpointUrl}/${args.id}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      });
    },
  );

  // ── preview_create ────────────────────────────────────────────────────────

  const createShape = isCold ? buildPassthroughShape("create") : buildZodShape(fields, "create");

  server.tool(
    `preview_create_${resourceKey}`,
    createShape,
    async (args) => {
      return withAudit(audit, `preview_create_${resourceKey}`, args as Record<string, unknown>, async () => {
        const payload = isCold ? ((args as any).fields ?? {}) : args;
        const preview = buildCreatePreview(payload as Record<string, unknown>);
        return {
          content: [{
            type: "text" as const,
            text: preview + coldNote,
          }],
        };
      });
    },
  );

  // ── create ────────────────────────────────────────────────────────────────

  server.tool(
    `create_${resourceKey}`,
    {
      ...createShape,
      confirm: z.literal(true).describe("Must be true to create the record"),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock(`create_${resourceKey}`);

      return withAudit(audit, `create_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { confirm: _confirm, ...rest } = args as any;
        const payload = isCold ? (rest.fields ?? rest) : rest;

        const preview = buildCreatePreview(payload as Record<string, unknown>);
        const blocked = await checkGate(
          gate,
          `create_${resourceKey}`,
          args as Record<string, unknown>,
          preview,
          config.approvals?.tools,
        );
        if (blocked) return blocked;

        const created = await runWithTransaction(async (tx) => {
          const result = await client.post<Record<string, unknown>>(endpointUrl, payload);
          const id = String(result[idField] ?? result["id"] ?? result["_id"] ?? "");
          if (id) tx.addStep(`Created ${resourceKey} ${id}`, deleteRollback(client, endpointUrl, id));
          tx.commit();
          return result;
        });

        const createdId    = created[idField] ?? created["id"] ?? "(unknown)";
        const createdTitle = titleField ? (created[titleField] ?? payload[titleField] ?? "") : "";
        const statusVal    = statusField ? (created[statusField] ?? payload[statusField] ?? "") : "";

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ ${resourceKey} created!`,
              ``,
              `ID: ${createdId}`,
              createdTitle ? `${titleField}: ${createdTitle}` : "",
              statusVal    ? `${statusField}: ${statusVal}`   : "",
            ].filter(Boolean).join("\n"),
          }],
        };
      });
    },
  );

  // ── preview_update ────────────────────────────────────────────────────────

  const updateShape = isCold ? buildPassthroughShape("update") : buildZodShape(fields, "update");

  server.tool(
    `preview_update_${resourceKey}`,
    updateShape,
    async (args) => {
      return withAudit(audit, `preview_update_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { id, ...updates } = args as any;
        const payload = isCold ? (updates.fields ?? updates) : updates;
        const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
        const preview = buildUpdatePreview(current, payload as Record<string, unknown>);
        return {
          content: [{
            type: "text" as const,
            text: preview + coldNote,
          }],
        };
      });
    },
  );

  // ── update ────────────────────────────────────────────────────────────────

  server.tool(
    `update_${resourceKey}`,
    {
      ...updateShape,
      confirm: z.literal(true).describe("Must be true to apply updates"),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock(`update_${resourceKey}`);

      return withAudit(audit, `update_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { confirm: _confirm, id, ...updates } = args as any;
        const payload = isCold ? (updates.fields ?? updates) : updates;

        const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
        const preview = buildUpdatePreview(current, payload as Record<string, unknown>);
        const blocked = await checkGate(
          gate,
          `update_${resourceKey}`,
          args as Record<string, unknown>,
          preview,
          config.approvals?.tools,
        );
        if (blocked) return blocked;

        await runWithTransaction(async (tx) => {
          tx.addStep(`Update ${resourceKey} ${id}`, async () => {
            await client.patch(`${endpointUrl}/${id}`, current);
          });
          await client.patch(`${endpointUrl}/${id}`, payload);
          tx.commit();
        });

        return {
          content: [{
            type: "text" as const,
            text: `✅ ${resourceKey} ${id} updated successfully.`,
          }],
        };
      });
    },
  );

  // ── delete ────────────────────────────────────────────────────────────────

  server.tool(
    `delete_${resourceKey}`,
    {
      id:      z.string().min(1).describe(`${resourceKey} ID to delete`),
      confirm: z.literal(true).describe("Must be true — this is irreversible"),
    },
    async (args) => {
      if (config.readOnly) return readOnlyBlock(`delete_${resourceKey}`);

      return withAudit(audit, `delete_${resourceKey}`, args as Record<string, unknown>, async () => {
        const preview = `⚠️ DELETE ${resourceKey} ${args.id} — this is irreversible`;
        const blocked = await checkGate(
          gate,
          `delete_${resourceKey}`,
          args as Record<string, unknown>,
          preview,
          config.approvals?.tools,
        );
        if (blocked) return blocked;

        await client.delete(`${endpointUrl}/${args.id}`);
        return {
          content: [{
            type: "text" as const,
            text: `🗑️ ${resourceKey} ${args.id} deleted.`,
          }],
        };
      });
    },
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readOnlyBlock(tool: string) {
  return {
    content: [{
      type: "text" as const,
      text: `🔒 "${tool}" is disabled — server is running in read-only mode.`,
    }],
  };
}
