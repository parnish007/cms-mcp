// src/tools/generic-resource.ts
// v1.0.0 — Generic resource tool factory.
//
// Default mode (legacyMode: false): registers 5 tools per endpoint —
//   list_X, get_X, create_X, update_X, delete_X
//
// Legacy mode (legacyMode: true): registers 3 tools per endpoint —
//   list_X, get_X, mutate_X  (v0.5 combined tool)
//
// v1.0.0 additions:
//   - CMSAdapter: transforms request/response field names via fieldMap
//   - CMSAdapter: respects updateMethod (PATCH vs PUT) per endpoint
//   - create_X / update_X accept preview?: true to show diff without writing
//   - CompensatingTransaction replaces the old "atomic transaction" framing
//   - CriticalInconsistencyError surfaced when rollback also fails
//
// Security pillars (unchanged):
//   1. Zod validation firewall (dynamic shapes from live schema)
//   2. Compensating transaction + rollback
//   3. Diff preview before any write
//   4. Human approval gate (if configured)

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { getAdapterConfig } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { AuditLogger, withAudit } from "../lib/audit.js";
import { buildCreatePreview, buildUpdatePreview } from "../lib/diff.js";
import {
  runWithCompensation,
  deleteRollback,
  CriticalInconsistencyError,
} from "../lib/transaction.js";
import { type ApprovalGate, checkGate } from "../lib/approval-gate.js";
import type { ResourceSchema } from "../lib/resource-schema.js";
import { buildZodShape, buildPassthroughShape } from "../lib/resource-schema.js";
import { normalizeList } from "../lib/type-inference.js";
import { formatRelationHints } from "../lib/relation-detector.js";
import { createAdapter, type CMSAdapter } from "../lib/adapter.js";
import type { PolicyEngine } from "../plugins/policy-engine.js";

// ─── Factory ──────────────────────────────────────────────────────────────────

export function registerGenericResourceTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  gate: ApprovalGate | null | undefined,
  schema: ResourceSchema,
  policyEngine?: PolicyEngine | null,
): void {
  const { resourceKey, endpointUrl, fields, idField, titleField, statusField, source } = schema;
  const isCold = source === "cold-start";
  const client = new ApiClient(config);

  // Build CMSAdapter from per-endpoint config
  const adapterConf = getAdapterConfig(config, resourceKey);
  const adapter: CMSAdapter = createAdapter(adapterConf);

  const relationNote = schema.relationHints?.length
    ? `\nRelations: ${formatRelationHints(schema.relationHints)}`
    : "";

  const mappingNote = adapter.hasMapping
    ? `\nField mapping active: ${adapter.describeMapping().trim()}`
    : "";

  const coldNote = isCold
    ? `\n⚠️ Cold-start: no records at introspection — fields accepted as-is.`
    : "";

  // ── list_X ──────────────────────────────────────────────────────────────────

  const listShape = isCold ? buildPassthroughShape("list") : buildZodShape(fields, "list");

  server.registerTool(
    `list_${resourceKey}`,
    {
      description: `List ${resourceKey} records. Supports limit, search, and enum field filters.${relationNote}${coldNote}`,
      inputSchema: listShape,
    },
    async (args) => withAudit(audit, `list_${resourceKey}`, args as Record<string, unknown>, async () => {
      const { limit = 20, search, ...filters } = args as Record<string, unknown>;
      const params: Record<string, string | number | boolean | undefined> = { limit: limit as number };
      if (search) params["search"] = search as string;
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined) params[k] = v as string | number | boolean;
      }

      const raw   = await client.get<unknown>(endpointUrl, params);
      const items = normalizeList(adapter.transformResponse(raw));

      if (items.length === 0) {
        return { content: [{ type: "text" as const, text: `No ${resourceKey} found.` }] };
      }

      const summary = items
        .slice(0, limit as number)
        .map((item: Record<string, unknown>) => {
          const id     = item[idField] ?? "?";
          const title  = titleField  ? (item[titleField]  ?? "Untitled") : "(no title field)";
          const status = statusField ? ` (${item[statusField] ?? "?"})` : "";
          return `• [${id}] ${title}${status}`;
        })
        .join("\n");

      return {
        content: [{ type: "text" as const, text: `Found ${items.length} ${resourceKey} record(s):\n\n${summary}` }],
      };
    }),
  );

  // ── get_X ────────────────────────────────────────────────────────────────────

  server.registerTool(
    `get_${resourceKey}`,
    {
      description: `Fetch a single ${resourceKey} record by ID.${relationNote}`,
      inputSchema: { id: z.string().min(1).describe(`${resourceKey} ID or slug`) },
    },
    async (args) => withAudit(audit, `get_${resourceKey}`, args as Record<string, unknown>, async () => {
      const raw = await client.get<Record<string, unknown>>(`${endpointUrl}/${args.id}`);
      const data = adapter.transformResponse(raw) as Record<string, unknown>;
      return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
    }),
  );

  // ── Split tools (default v1.0.0) or mutate_X (legacy mode) ──────────────────

  if (config.legacyMode) {
    registerMutateX(server, config, audit, gate, schema, client, adapter, { relationNote, mappingNote, coldNote, isCold }, policyEngine);
  } else {
    registerSplitTools(server, config, audit, gate, schema, client, adapter, { relationNote, mappingNote, coldNote, isCold }, policyEngine);
  }
}

// ─── v1.0.0 split tools ───────────────────────────────────────────────────────

function registerSplitTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  gate: ApprovalGate | null | undefined,
  schema: ResourceSchema,
  client: ApiClient,
  adapter: CMSAdapter,
  notes: { relationNote: string; mappingNote: string; coldNote: string; isCold: boolean },
  policyEngine?: PolicyEngine | null,
): void {
  const { resourceKey, endpointUrl, fields, idField, titleField, statusField, source } = schema;
  const { relationNote, mappingNote, coldNote, isCold } = notes;
  const updateMethod = adapter.updateMethod;

  // create_X ──────────────────────────────────────────────────────────────────
  // Accepts `preview: true` to show diff without writing.
  // Requires `confirm: true` to execute.

  const createShape = isCold
    ? { ...buildPassthroughShape("create"), preview: z.boolean().optional(), confirm: z.literal(true).optional() }
    : { ...buildZodShape(fields, "create"), preview: z.boolean().optional(), confirm: z.literal(true).optional() };

  server.registerTool(
    `create_${resourceKey}`,
    {
      description: [
        `Create a new ${resourceKey} record.`,
        `• Add preview: true to see the diff before writing.`,
        `• Add confirm: true to execute the write.`,
        mappingNote, coldNote, relationNote,
      ].filter(Boolean).join("\n"),
      inputSchema: createShape,
    },
    async (args) => withAudit(audit, `create_${resourceKey}`, args as Record<string, unknown>, async () => {
      const { preview, confirm: _confirm, ...rawData } = args as Record<string, unknown>;
      const payload = isCold ? ((rawData as any).fields ?? rawData) : rawData;
      const apiPayload = adapter.transformRequest(payload as Record<string, unknown>);

      if (preview) {
        return { content: [{ type: "text" as const, text: buildCreatePreview(payload as Record<string, unknown>) + coldNote }] };
      }

      if (!args.confirm) {
        return {
          content: [{ type: "text" as const, text: `Add preview: true to see the diff, or confirm: true to create the ${resourceKey}.` }],
        };
      }

      if (config.readOnly) return readOnlyBlock(`create_${resourceKey}`);

      if (policyEngine) {
        const policyResult = policyEngine.enforce(`create_${resourceKey}`, payload as Record<string, unknown>);
        if (!policyResult.allowed) {
          return { content: [{ type: "text" as const, text: policyResult.formatted }] };
        }
      }

      const previewText = buildCreatePreview(payload as Record<string, unknown>);
      const blocked = await checkGate(gate, `create_${resourceKey}`, args, previewText, config.approvals?.tools);
      if (blocked) return blocked;

      try {
        const created = await runWithCompensation(async (tx) => {
          const result = await client.post<Record<string, unknown>>(endpointUrl, apiPayload);
          const newId  = String(result[idField] ?? result["id"] ?? result["_id"] ?? "");
          if (newId) tx.addStep(`created ${resourceKey} ${newId}`, deleteRollback(client, endpointUrl, newId), newId);
          tx.commit();
          return adapter.transformResponse(result) as Record<string, unknown>;
        });

        const createdId    = created[idField] ?? created["id"] ?? "(unknown)";
        const createdTitle = titleField ? (created[titleField] ?? payload[titleField] ?? "") : "";
        const statusVal    = statusField ? (created[statusField] ?? (payload as any)[statusField] ?? "") : "";

        return {
          content: [{
            type: "text" as const,
            text: [`✅ ${resourceKey} created!`, `ID: ${createdId}`,
              createdTitle ? `${titleField}: ${createdTitle}` : "",
              statusVal    ? `${statusField}: ${statusVal}` : ""].filter(Boolean).join("\n"),
          }],
        };
      } catch (err) {
        if (err instanceof CriticalInconsistencyError) {
          return { content: [{ type: "text" as const, text: err.message }] };
        }
        throw err;
      }
    }),
  );

  // update_X ──────────────────────────────────────────────────────────────────

  const updateShape = isCold
    ? { ...buildPassthroughShape("update"), preview: z.boolean().optional(), confirm: z.literal(true).optional() }
    : { ...buildZodShape(fields, "update"), preview: z.boolean().optional(), confirm: z.literal(true).optional() };

  server.registerTool(
    `update_${resourceKey}`,
    {
      description: [
        `Update an existing ${resourceKey} record by ID (${updateMethod}).`,
        `• Add preview: true to see the diff before writing.`,
        `• Add confirm: true to execute the write.`,
        mappingNote, coldNote, relationNote,
      ].filter(Boolean).join("\n"),
      inputSchema: updateShape,
    },
    async (args) => withAudit(audit, `update_${resourceKey}`, args as Record<string, unknown>, async () => {
      const { id, preview, confirm: _confirm, ...rawUpdates } = args as Record<string, unknown>;
      if (!id) return missingParam("id", "update");

      const payload = isCold ? ((rawUpdates as any).fields ?? rawUpdates) : rawUpdates;
      const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
      const currentMapped = adapter.transformResponse(current) as Record<string, unknown>;

      if (preview) {
        return { content: [{ type: "text" as const, text: buildUpdatePreview(currentMapped, payload as Record<string, unknown>) }] };
      }

      if (!args.confirm) {
        const autoPreview = buildUpdatePreview(currentMapped, payload as Record<string, unknown>);
        return { content: [{ type: "text" as const, text: `${autoPreview}\n\nAdd confirm: true to apply these changes.` }] };
      }

      if (config.readOnly) return readOnlyBlock(`update_${resourceKey}`);

      if (policyEngine) {
        const policyResult = policyEngine.enforce(
          `update_${resourceKey}`,
          payload as Record<string, unknown>,
          currentMapped,
        );
        if (!policyResult.allowed) {
          return { content: [{ type: "text" as const, text: policyResult.formatted }] };
        }
      }

      const previewText = buildUpdatePreview(currentMapped, payload as Record<string, unknown>);
      const blocked = await checkGate(gate, `update_${resourceKey}`, args, previewText, config.approvals?.tools);
      if (blocked) return blocked;

      const apiPayload = adapter.transformRequest(payload as Record<string, unknown>);

      try {
        await runWithCompensation(async (tx) => {
          tx.addStep(`restore ${resourceKey} ${id}`, async () => {
            await (updateMethod === "PUT"
              ? client.put(`${endpointUrl}/${id}`, current)
              : client.patch(`${endpointUrl}/${id}`, current));
          });
          await (updateMethod === "PUT"
            ? client.put(`${endpointUrl}/${id}`, apiPayload)
            : client.patch(`${endpointUrl}/${id}`, apiPayload));
          tx.commit();
        });
      } catch (err) {
        if (err instanceof CriticalInconsistencyError) {
          return { content: [{ type: "text" as const, text: err.message }] };
        }
        throw err;
      }

      return { content: [{ type: "text" as const, text: `✅ ${resourceKey} ${id} updated.` }] };
    }),
  );

  // delete_X ──────────────────────────────────────────────────────────────────

  server.registerTool(
    `delete_${resourceKey}`,
    {
      description: `Permanently delete a ${resourceKey} record. Requires confirm: true. Irreversible.`,
      inputSchema: {
        id:      z.string().min(1).describe("Record ID to delete"),
        confirm: z.literal(true).optional().describe("Must be true to execute the delete"),
      },
    },
    async (args) => withAudit(audit, `delete_${resourceKey}`, args as Record<string, unknown>, async () => {
      if (!args.confirm) {
        return {
          content: [{ type: "text" as const, text: `⚠️ This will permanently delete ${resourceKey} ${args.id}. Add confirm: true to proceed.` }],
        };
      }

      if (config.readOnly) return readOnlyBlock(`delete_${resourceKey}`);

      if (policyEngine) {
        const policyResult = policyEngine.enforce(`delete_${resourceKey}`, { id: args.id });
        if (!policyResult.allowed) {
          return { content: [{ type: "text" as const, text: policyResult.formatted }] };
        }
      }

      const preview = `⚠️ DELETE ${resourceKey} ${args.id} — permanent and irreversible`;
      const blocked = await checkGate(gate, `delete_${resourceKey}`, args, preview, config.approvals?.tools);
      if (blocked) return blocked;

      await client.delete(`${endpointUrl}/${args.id}`);
      return { content: [{ type: "text" as const, text: `🗑️ ${resourceKey} ${args.id} deleted.` }] };
    }),
  );
}

// ─── v0.5 legacy mutate_X (registered when legacyMode: true) ─────────────────

function registerMutateX(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
  gate: ApprovalGate | null | undefined,
  schema: ResourceSchema,
  client: ApiClient,
  adapter: CMSAdapter,
  notes: { relationNote: string; mappingNote: string; coldNote: string; isCold: boolean },
  policyEngine?: PolicyEngine | null,
): void {
  const { resourceKey, endpointUrl, fields, idField, titleField, statusField } = schema;
  const { relationNote, mappingNote, coldNote, isCold } = notes;
  const updateMethod = adapter.updateMethod;

  const dataShape = isCold
    ? z.record(z.unknown()).optional()
    : z.object(buildZodShape(fields, "mutate")).partial().optional();

  server.registerTool(
    `mutate_${resourceKey}`,
    {
      description: [
        `[Legacy mode] Create, update, delete, or preview a ${resourceKey} record.`,
        `action: "preview" | "create" | "update" | "delete"`,
        mappingNote, coldNote, relationNote,
      ].filter(Boolean).join("\n"),
      inputSchema: {
        action:  z.enum(["create", "update", "delete", "preview"]),
        id:      z.string().min(1).optional(),
        data:    dataShape,
        confirm: z.literal(true).optional(),
      },
    },
    async (args) => withAudit(audit, `mutate_${resourceKey}`, args as Record<string, unknown>, async () => {
      const { action, id, data: rawData } = args as any;
      const payload = rawData ?? {};
      const apiPayload = adapter.transformRequest(payload);

      if (action === "preview") {
        if (id) {
          const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
          return { content: [{ type: "text" as const, text: buildUpdatePreview(adapter.transformResponse(current) as Record<string, unknown>, payload) }] };
        }
        return { content: [{ type: "text" as const, text: buildCreatePreview(payload) }] };
      }

      if (!args.confirm) {
        return { content: [{ type: "text" as const, text: `Add confirm: true to proceed with ${action}.` }] };
      }

      if (config.readOnly) return readOnlyBlock(`mutate_${resourceKey}`);

      if (action === "create") {
        if (policyEngine) {
          const policyResult = policyEngine.enforce(`mutate_${resourceKey}`, payload);
          if (!policyResult.allowed) {
            return { content: [{ type: "text" as const, text: policyResult.formatted }] };
          }
        }
        const previewText = buildCreatePreview(payload);
        const blocked = await checkGate(gate, `mutate_${resourceKey}`, args, previewText, config.approvals?.tools);
        if (blocked) return blocked;

        try {
          const created = await runWithCompensation(async (tx) => {
            const result = await client.post<Record<string, unknown>>(endpointUrl, apiPayload);
            const newId = String(result[idField] ?? result["id"] ?? "");
            if (newId) tx.addStep(`created ${resourceKey} ${newId}`, deleteRollback(client, endpointUrl, newId), newId);
            tx.commit();
            return adapter.transformResponse(result) as Record<string, unknown>;
          });
          const createdId = created[idField] ?? created["id"] ?? "(unknown)";
          return { content: [{ type: "text" as const, text: `✅ ${resourceKey} created! ID: ${createdId}` }] };
        } catch (err) {
          if (err instanceof CriticalInconsistencyError) return { content: [{ type: "text" as const, text: err.message }] };
          throw err;
        }
      }

      if (action === "update") {
        if (!id) return missingParam("id", "update");
        const current = await client.get<Record<string, unknown>>(`${endpointUrl}/${id}`);
        const currentMapped = adapter.transformResponse(current) as Record<string, unknown>;
        if (policyEngine) {
          const policyResult = policyEngine.enforce(`mutate_${resourceKey}`, payload, currentMapped);
          if (!policyResult.allowed) {
            return { content: [{ type: "text" as const, text: policyResult.formatted }] };
          }
        }
        const previewText = buildUpdatePreview(currentMapped, payload);
        const blocked = await checkGate(gate, `mutate_${resourceKey}`, args, previewText, config.approvals?.tools);
        if (blocked) return blocked;

        try {
          await runWithCompensation(async (tx) => {
            tx.addStep(`restore ${resourceKey} ${id}`, async () => {
              await (updateMethod === "PUT" ? client.put(`${endpointUrl}/${id}`, currentMapped) : client.patch(`${endpointUrl}/${id}`, currentMapped));
            });
            await (updateMethod === "PUT" ? client.put(`${endpointUrl}/${id}`, apiPayload) : client.patch(`${endpointUrl}/${id}`, apiPayload));
            tx.commit();
          });
        } catch (err) {
          if (err instanceof CriticalInconsistencyError) return { content: [{ type: "text" as const, text: err.message }] };
          throw err;
        }
        return { content: [{ type: "text" as const, text: `✅ ${resourceKey} ${id} updated.` }] };
      }

      if (action === "delete") {
        if (!id) return missingParam("id", "delete");
        const preview = `⚠️ DELETE ${resourceKey} ${id}`;
        const blocked = await checkGate(gate, `mutate_${resourceKey}`, args, preview, config.approvals?.tools);
        if (blocked) return blocked;
        await client.delete(`${endpointUrl}/${id}`);
        return { content: [{ type: "text" as const, text: `🗑️ ${resourceKey} ${id} deleted.` }] };
      }

      return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }] };
    }),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readOnlyBlock(tool: string) {
  return {
    content: [{ type: "text" as const, text: `🔒 "${tool}" is disabled — server is running in read-only mode.` }],
  };
}

function missingParam(param: string, action: string) {
  return {
    content: [{ type: "text" as const, text: `\`${param}\` is required for action "${action}".` }],
  };
}
