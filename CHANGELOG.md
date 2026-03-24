# Changelog

All notable changes to cms-mcp are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] — 2026-03-24

### Added

**Generic schema-driven tool factory**
- `src/tools/generic-resource.ts` — `registerGenericResourceTools()` generates 7 tools per endpoint: `list_X`, `get_X`, `preview_create_X`, `create_X`, `preview_update_X`, `update_X`, `delete_X`
- All 4 pillars preserved: Zod validation firewall, atomic transactions + rollback, diff preview, approval gate
- Every write tool guarded by read-only mode check and `withAudit()`

**OpenAPI-first schema engine (4-tier resolution)**
- `src/schema/openapi-parser.ts` — extracts `FieldDefinition[]` from OpenAPI 3.x / Swagger 2.x specs
  - Full `$ref` resolution: recursive, cycle-safe (visited Set), handles `$defs` and `definitions`
  - `oneOf` / `anyOf` / `allOf` merging
  - `readOnly` fields excluded from create/update shapes
  - Nullable detection via `nullable: true` or `type: ["string", "null"]`
  - Format-based type refinement: `uuid`, `date-time`, `uri`, `email`
  - Enum detection → `enum(a|b|c)` semantic type
  - Unwraps common list wrappers: `data`, `items`, `results`, `records`, `entries`, `nodes`, `collection`
  - Supports OpenAPI 3.x (`requestBody`) and Swagger 2.x (`parameters[].in === "body"`)
  - Path matching: strips baseUrl, tries multiple candidate paths including API prefix variants
- `src/lib/startup-introspect.ts` — 4-tier schema resolution: cache → OpenAPI → sampling → cold-start
  - `IntrospectSummary` extended with `fromOpenApi[]` array
  - `refreshResourceSchema()` follows same tier priority on-demand
  - Startup banner shows tier stats

**Type inference library**
- `src/lib/type-inference.ts` — shared inference utilities extracted from schema-inspector.ts:
  - `inferType(values)` → semantic type string: `uuid`, `date`, `url`, `email`, `slug`, `enum(a|b|c)`, `string`, `number`, `boolean`, `array`, `object`, `mixed`
  - `normalizeList(data)` — unwraps 8 common list response shapes
  - `detectIdField()`, `detectTitleField()`, `detectStatusField()`
  - `isSystemId()`, `isSystemTimestamp()`, `baseType()` utilities

**Resource schema model**
- `src/lib/resource-schema.ts` — `FieldDefinition` and `ResourceSchema` interfaces
  - `buildZodShape(fields, mode)` — builds Zod validators from inferred types at runtime
  - `buildPassthroughShape(mode)` — cold-start fallback: `z.record(z.unknown())`
  - `resourceSchemaCacheKey(baseUrl, key)` — stable SQLite cache key

**Schema introspector**
- `src/lib/schema-introspector.ts` — `introspectResourceSchema()` returns machine-readable `ResourceSchema` (vs markdown from schema-inspector.ts)
  - Returns cold-start schema on errors or zero records
  - Uses shared `inferType`, `normalizeList` from type-inference.ts

**New introspection tools**
- `refresh_resource_schema` — invalidate cache for one endpoint, re-introspect (OpenAPI → sampling → cold-start), prompt restart
- `list_configured_endpoints` — table of all configured endpoints with cache status

**OpenAPI discovery upgrades**
- `rawSpec` field added to `OpenApiDiscoveryResult` — raw parsed spec object passed to openapi-parser.ts
- `suggestedEndpointConfig` now includes ALL discovered resources (unknown names use their own name as key)

**Generic semantic search**
- `sync_all_content` now iterates ALL configured endpoints (not hardcoded to projects/blogs)
- `semantic_search` `type` param is now a free string (not hardcoded enum)

### Changed

- `config.endpoints` schema changed from `z.object({projects, blogs, media, ...})` to `z.record(z.string(), z.string())` — accepts any endpoint key
- `inspect_endpoint_schema` `endpoint` param changed from hardcoded `z.enum([...])` to `z.string()` — any configured key
- `inspect_endpoint_schema` now checks OpenAPI spec first, falls back to live sampling
- `src/lib/resources.ts` — fixed `config.endpoints.projects/blogs` dot-access to bracket-access `config.endpoints["projects"]`
- `src/tools/media.ts` — fixed `config.endpoints.media` to `config.endpoints["media"]`
- `src/lib/schema-inspector.ts` — now imports `inferType`, `normalizeList` from type-inference.ts; updated empty-endpoint message
- `src/lib/openapi.ts` — `suggestedEndpointConfig` includes all resources; `rawSpec` populated in return value
- Startup banner shows `registered`, `fromOpenApi`, `coldStart`, `failed`, `skipped` per-endpoint status
- Version bumped to `0.4.0`

### Removed

- `src/tools/projects.ts` — replaced by generic tool factory
- `src/tools/blogs.ts` — replaced by generic tool factory
- Hardcoded `projects`/`blogs`-specific tool registrations from `src/index.ts`

### Fixed

- `generic-resource.ts` TypeScript: explicit type casts for `client.get()` params (`limit as number`, `v as string | number | boolean`)
- `resources.ts` TypeScript: bracket-access for dynamic `Record<string,string>` config

### Security

- All 4 security pillars maintained across the rewrite:
  1. **Zod validation firewall** — dynamic Zod shapes from `buildZodShape()` passed to `server.tool()` — MCP SDK validates before handler runs
  2. **Atomic transactions + rollback** — `runWithTransaction()` + `deleteRollback()` + manual restore in update tools
  3. **Approval gate** — `checkGate()` in all write tools (create, update, delete)
  4. **SSRF protection** — unchanged in media-proxy.ts, blocks RFC 1918 + loopback + IPv6 ULA
- `withAudit()` wraps every tool call — tool, args (secrets redacted), outcome, duration
- `if (config.readOnly) return readOnlyBlock(...)` guards on all write tools

---

## [0.3.x] — Prior releases

Pre-generic architecture. Tools were hardcoded to `projects` and `blogs` endpoints with fixed Zod schemas. See [`docs/migration-v0.4.md`](./docs/migration-v0.4.md) for upgrade instructions.

---

## Roadmap

- **Phase 2** — Reduce to 3 smart tools per endpoint (`list_X`, `create_or_update_X`, `delete_X`)
- **Phase 3** — Modular plugins for approvals, policies, webhooks, embeddings
- **Phase 4** — Docker Compose examples for Supabase / Payload / Strapi / Directus
- **Phase 5** — Production hardening: rate limiting, schema drift detection, pagination cursor abstraction
- **Phase 6** — Trust & distribution: telemetry opt-in, Docker image <50MB, MCP registry submission
