// src/tools/generic-resource.ts
// Generic resource tool factory — v0.5.0 3-tool model.
//
// Registers exactly 3 MCP tools per configured endpoint:
//
//   list_{key}    — filter, paginate, full-text search
//   get_{key}     — fetch single record by ID
//   mutate_{key}  — create / update / delete / preview (action param)
//
// v0.4 compatibility aliases (deprecated, removed in v0.6):
//   preview_create_{key}  → mutate_{key}({ action: "preview" })
//   create_{key}          → mutate_{key}({ action: "create" })
//   preview_update_{key}  → mutate_{key}({ action: "preview", id })
//   update_{key}          → mutate_{key}({ action: "update" })
//   delete_{key}          → mutate_{key}({ action: "delete" })
//
// All tools follow the four-pillar security model:
//   1. Zod validation firewall (dynamic shapes from live schema)
//   2. Atomic transaction + rollback
//   3. Diff preview before any write
//   4. Human approval gate (if configured)
// Every call is wrapped with withAudit().

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
import { formatRelationHints } from "../lib/relation-detector.js";

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Register 3 MCP tools for a single CMS resource endpoint.
 * Called once per entry in config.endpoints at server startup.
 *
 * @param schema  ResourceSchema from startup introspection.
 *                source === "cold-start" → passthrough mode (no field hints).
 */
export function registerGenericResourceTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  gate: ApprovalGate | null | undefined,
  schema: ResourceSchema,
): void {
  const { resourceKey, endpointUrl, fields, idField, titleField, statusField, source } = schema;
  const client = new ApiClient(config);
  const isCold = source === "cold-start";

  const relationNote = schema.relationHints && schema.relationHints.length > 0
    ? `\nRelations: ${formatRelationHints(schema.relationHints)}`
    : "";

  const coldNote = isCold
    ? `\n⚠️ Cold-start: no records at introspection time — fields accepted as-is. ` +
      `Run refresh_resource_schema once records exist.`
    : "";

  // ── list_X ──────────────────────────────────────────────────────────────────

  const listShape = isCold ? buildPassthroughShape("list") : buildZodShape(fields, "list");

  server.tool(
    `list_${resourceKey}`,
    `List ${resourceKey} records. Supports limit, search, and enum field filters.${relationNote}${coldNote}`,
    listShape,
    async (args) => {
      return withAudit(audit, `list_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { limit = 20, search, ...filters } = args as any;
        const params: Record<string, string | number | boolean | undefined> = { limit: limit as number };
        if (search) params["search"] = search as string;
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

  // ── get_X ────────────────────────────────────────────────────────────────────

  server.tool(
    `get_${resourceKey}`,
    `Fetch a single ${resourceKey} record by ID.${relationNote}`,
    { id: z.string().min(1).describe(`${resourceKey} ID or slug`) },
    async (args) => {
      return withAudit(audit, `get_${resourceKey}`, args as Record<string, unknown>, async () => {
        const data = await client.get<Record<string, unknown>>(`${endpointUrl}/${args.id}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      });
    },
  );

  // ── mutate_X ─────────────────────────────────────────────────────────────────

  // Build the data sub-shape: all writable fields optional
  const dataShape = isCold
    ? z.record(z.unknown()).optional().describe("Fields as a key-value object")
    : z.object(buildZodShape(fields, "mutate")).partial().optional()
        .describe("Fields to write. All optional — include only what should change.");

  const mutateDescription = [
    `Create, update, delete, or preview changes to a ${resourceKey} record.`,
    `Actions:`,
    `  "preview" — show diff without writing (no confirm needed)`,
    `  "create"  — create a new record (confirm: true required)`,
    `  "update"  — patch existing record by id (confirm: true required)`,
    `  "delete"  — delete record by id (confirm: true required)`,
    coldNote,
    relationNote,
  ].filter(Boolean).join("\n");

  server.tool(
    `mutate_${resourceKey}`,
    mutateDescription,
    {
      action:  z.enum(["create", "update", "delete", "preview"])
                 .describe("What to do"),
      id:      z.string().min(1).optional()
                 .describe("Record ID — required for update, delete, and preview-update"),
      data:    dataShape,
      confirm: z.literal(true).optional()
                 .describe("Must be true for create / update / delete"),
    },
    async (args) => {
      return withAudit(audit, `mutate_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { action, id, data: rawData, confirm: _confirm } = args as any;
        const payload = isCold ? (rawData ?? {}) : (rawData ?? {});

        // ── preview ─────────────────────────────────────────────────────────
        if (action === "preview") {
          if (id) {
            const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
            return { content: [{ type: "text" as const, text: buildUpdatePreview(current, payload) + coldNote }] };
          }
          return { content: [{ type: "text" as const, text: buildCreatePreview(payload) + coldNote }] };
        }

        // ── guard: writes require confirm ───────────────────────────────────
        if (!args.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `Add \`"confirm": true\` to proceed with ${action}.`,
            }],
          };
        }

        if (config.readOnly) return readOnlyBlock(`mutate_${resourceKey}`);

        // ── create ───────────────────────────────────────────────────────────
        if (action === "create") {
          const preview = buildCreatePreview(payload);
          const blocked = await checkGate(gate, `mutate_${resourceKey}`, args, preview, config.approvals?.tools);
          if (blocked) return blocked;

          const created = await runWithTransaction(async (tx) => {
            const result = await client.post<Record<string, unknown>>(endpointUrl, payload);
            const newId  = String(result[idField] ?? result["id"] ?? result["_id"] ?? "");
            if (newId) tx.addStep(`created ${resourceKey} ${newId}`, deleteRollback(client, endpointUrl, newId));
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
                `ID: ${createdId}`,
                createdTitle ? `${titleField}: ${createdTitle}` : "",
                statusVal    ? `${statusField}: ${statusVal}`   : "",
              ].filter(Boolean).join("\n"),
            }],
          };
        }

        // ── update ───────────────────────────────────────────────────────────
        if (action === "update") {
          if (!id) return missingParam("id", "update");

          const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
          const preview = buildUpdatePreview(current, payload);
          const blocked = await checkGate(gate, `mutate_${resourceKey}`, args, preview, config.approvals?.tools);
          if (blocked) return blocked;

          await runWithTransaction(async (tx) => {
            tx.addStep(`restore ${resourceKey} ${id}`, async () => {
              await client.patch(`${endpointUrl}/${id}`, current);
            });
            await client.patch(`${endpointUrl}/${id}`, payload);
            tx.commit();
          });

          return { content: [{ type: "text" as const, text: `✅ ${resourceKey} ${id} updated.` }] };
        }

        // ── delete ───────────────────────────────────────────────────────────
        if (action === "delete") {
          if (!id) return missingParam("id", "delete");

          const preview = `⚠️ DELETE ${resourceKey} ${id} — irreversible`;
          const blocked = await checkGate(gate, `mutate_${resourceKey}`, args, preview, config.approvals?.tools);
          if (blocked) return blocked;

          await client.delete(`${endpointUrl}/${id}`);
          return { content: [{ type: "text" as const, text: `🗑️ ${resourceKey} ${id} deleted.` }] };
        }

        return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }] };
      });
    },
  );

  // ── v0.4 backward-compat aliases (deprecated — removed in v0.6) ────────────
  // These forward to mutate_X so existing prompts and approval configs
  // that reference the old tool names continue to work.

  const createShape = isCold ? buildPassthroughShape("create") : buildZodShape(fields, "create");
  const updateShape = isCold ? buildPassthroughShape("update") : buildZodShape(fields, "update");

  // preview_create_X
  server.tool(
    `preview_create_${resourceKey}`,
    `[Deprecated — use mutate_${resourceKey}({ action: "preview" })] Preview create diff.`,
    createShape,
    async (args) => {
      return withAudit(audit, `preview_create_${resourceKey}`, args as Record<string, unknown>, async () => {
        const payload = isCold ? ((args as any).fields ?? {}) : args;
        return { content: [{ type: "text" as const, text: buildCreatePreview(payload as Record<string, unknown>) + coldNote }] };
      });
    },
  );

  // create_X
  server.tool(
    `create_${resourceKey}`,
    `[Deprecated — use mutate_${resourceKey}({ action: "create" })] Create a ${resourceKey} record.`,
    { ...createShape, confirm: z.literal(true) },
    async (args) => {
      if (config.readOnly) return readOnlyBlock(`create_${resourceKey}`);
      return withAudit(audit, `create_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { confirm: _c, ...rest } = args as any;
        const payload = isCold ? (rest.fields ?? rest) : rest;
        const preview = buildCreatePreview(payload);
        const blocked = await checkGate(gate, `create_${resourceKey}`, args, preview, config.approvals?.tools);
        if (blocked) return blocked;
        const created = await runWithTransaction(async (tx) => {
          const result = await client.post<Record<string, unknown>>(endpointUrl, payload);
          const newId  = String(result[idField] ?? result["id"] ?? result["_id"] ?? "");
          if (newId) tx.addStep(`created ${resourceKey} ${newId}`, deleteRollback(client, endpointUrl, newId));
          tx.commit();
          return result;
        });
        const createdId = created[idField] ?? created["id"] ?? "(unknown)";
        return { content: [{ type: "text" as const, text: `✅ ${resourceKey} created! ID: ${createdId}` }] };
      });
    },
  );

  // preview_update_X
  server.tool(
    `preview_update_${resourceKey}`,
    `[Deprecated — use mutate_${resourceKey}({ action: "preview", id })] Preview update diff.`,
    updateShape,
    async (args) => {
      return withAudit(audit, `preview_update_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { id, ...updates } = args as any;
        const payload = isCold ? (updates.fields ?? updates) : updates;
        const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
        return { content: [{ type: "text" as const, text: buildUpdatePreview(current, payload) + coldNote }] };
      });
    },
  );

  // update_X
  server.tool(
    `update_${resourceKey}`,
    `[Deprecated — use mutate_${resourceKey}({ action: "update" })] Update a ${resourceKey} record.`,
    { ...updateShape, confirm: z.literal(true) },
    async (args) => {
      if (config.readOnly) return readOnlyBlock(`update_${resourceKey}`);
      return withAudit(audit, `update_${resourceKey}`, args as Record<string, unknown>, async () => {
        const { confirm: _c, id, ...updates } = args as any;
        const payload = isCold ? (updates.fields ?? updates) : updates;
        const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
        const preview = buildUpdatePreview(current, payload);
        const blocked = await checkGate(gate, `update_${resourceKey}`, args, preview, config.approvals?.tools);
        if (blocked) return blocked;
        await runWithTransaction(async (tx) => {
          tx.addStep(`restore ${resourceKey} ${id}`, async () => { await client.patch(`${endpointUrl}/${id}`, current); });
          await client.patch(`${endpointUrl}/${id}`, payload);
          tx.commit();
        });
        return { content: [{ type: "text" as const, text: `✅ ${resourceKey} ${id} updated.` }] };
      });
    },
  );

  // delete_X
  server.tool(
    `delete_${resourceKey}`,
    `[Deprecated — use mutate_${resourceKey}({ action: "delete" })] Delete a ${resourceKey} record.`,
    { id: z.string().min(1), confirm: z.literal(true) },
    async (args) => {
      if (config.readOnly) return readOnlyBlock(`delete_${resourceKey}`);
      return withAudit(audit, `delete_${resourceKey}`, args as Record<string, unknown>, async () => {
        const preview = `⚠️ DELETE ${resourceKey} ${args.id}`;
        const blocked = await checkGate(gate, `delete_${resourceKey}`, args, preview, config.approvals?.tools);
        if (blocked) return blocked;
        await client.delete(`${endpointUrl}/${args.id}`);
        return { content: [{ type: "text" as const, text: `🗑️ ${resourceKey} ${args.id} deleted.` }] };
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

function missingParam(param: string, action: string) {
  return {
    content: [{
      type: "text" as const,
      text: `\`${param}\` is required for action "${action}".`,
    }],
  };
}
