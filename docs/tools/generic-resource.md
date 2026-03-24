# Generic Resource Tools

cms-mcp v0.4.0 replaces all hardcoded blog/project tools with a **generic tool factory** that auto-generates tools from your live CMS schema at startup.

## What gets generated

For every key in `config.endpoints` (except `media`), 7 tools are registered:

| Tool | What it does |
|------|-------------|
| `list_X` | List records with `limit`, `search`, and any enum-field filters |
| `get_X` | Fetch a single record by ID |
| `preview_create_X` | Show a diff table of what would be created — no API call |
| `create_X` | Create a record (`confirm: true` required) |
| `preview_update_X` | Show a diff table of changes — fetches current record first |
| `update_X` | Update a record (`id` + `confirm: true` required) |
| `delete_X` | Delete a record (`id` + `confirm: true` required) |

### Example

Config:
```json
{
  "endpoints": {
    "posts":    "/api/posts",
    "products": "/api/products",
    "authors":  "/api/authors"
  }
}
```

Generated tools:
```
list_posts    get_posts    preview_create_posts    create_posts    preview_update_posts    update_posts    delete_posts
list_products get_products preview_create_products create_products preview_update_products update_products delete_products
list_authors  get_authors  preview_create_authors  create_authors  preview_update_authors  update_authors  delete_authors
```

## How schemas are built — 4-tier resolution

At startup, each endpoint resolves its schema through a priority chain:

| Tier | Source | When used |
|------|--------|-----------|
| **1 — Cache** | SQLite | Schema was cached from a previous run — instant startup |
| **2 — OpenAPI** | Spec | `discover_api` has been run and spec is cached — most reliable |
| **3 — Sampling** | Live API | No spec available — fetches 5 records and infers types |
| **4 — Cold-start** | Passthrough | No records and no spec — tools registered with `Record<unknown>` |

**OpenAPI schema extraction** (Tier 2):
- Resolves `$ref`, `allOf`, `oneOf`, `anyOf` recursively
- Detects `readOnly` fields (excluded from create/update inputs)
- Detects `nullable` / `type: ["string", "null"]`
- Derives enums from `enum:` arrays
- Refines types from `format`: `uuid`, `date-time`, `uri`, `email`
- Supports OpenAPI 3.x and Swagger 2.x

**Live sampling type inference** (Tier 3):

| Type | Detection criteria |
|------|-------------------|
| `uuid` | Matches UUID regex |
| `date` | Starts with YYYY-MM-DD |
| `url` | Starts with http:// or https:// |
| `email` | Matches email pattern |
| `slug` | Lowercase alphanumeric + hyphens only, <80 chars |
| `enum(a\|b\|c)` | ≤8 distinct values across ≥2 samples |
| `number` | typeof === "number" |
| `boolean` | typeof === "boolean" |
| `array` | Array.isArray() |
| `object` | typeof === "object", not array |
| `string` | Everything else |
| `*?` suffix | Field was null/undefined in at least one sample |

**Zod shape modes:**
- **create mode**: exclude `id`, `_id`, `created_at`, `updated_at`; required fields have no `.optional()`
- **update mode**: all fields optional + `id` required
- **list mode**: `limit` + `search` + any enum-typed fields as optional filters

After schema resolution, tools are registered and the schema is written to SQLite (Tier 1 for next startup).

## List tool filtering

If your `posts` endpoint has a `status` field with values `draft|published|archived`, the `list_posts` tool will include `status` as an optional filter parameter:

```
"List my published posts"
→ Claude calls list_posts({ status: "published", limit: 20 })
```

Any field inferred as `enum(...)` becomes a filter in the list tool.

## Cold-start mode

If an endpoint returns zero records at startup, tools are registered in **passthrough mode**:

```
"Create a product"
→ Claude calls create_products({ fields: { name: "...", price: 29.99 }, confirm: true })
```

The `fields` parameter accepts any key-value object. Once records exist:
1. Ask: `"Refresh the schema for products"`
2. Restart cms-mcp

## Schema refresh

```
"Refresh the schema for posts"
→ Calls refresh_resource_schema({ resource_key: "posts", confirm: true })
→ Invalidates SQLite cache entry
→ Re-resolves: OpenAPI spec (if cached) → live sampling → cold-start
→ Shows updated field list
→ Tells you to restart for tool shapes to update
```

To get the best schema after changing your CMS:
1. `discover_api` — re-fetch OpenAPI spec into cache
2. `refresh_resource_schema({ resource_key: "posts", confirm: true })` — re-resolve schema
3. Restart cms-mcp — tool shapes update

## Audit logging

Every tool call — including all generated tools — is logged to the audit file:

```json
{
  "ts": "2024-01-15T10:30:00.000Z",
  "tool": "create_products",
  "args": { "name": "Widget Pro", "price": 29.99, "confirm": true },
  "outcome": "ok",
  "durationMs": 234
}
```

Secrets in args are automatically redacted.

## Approval gate

Generated tools respect the approval gate. To require human approval before publishing or deleting:

```json
{
  "approvals": {
    "tools": ["delete_posts", "delete_products", "update_posts"]
  }
}
```

When Claude calls one of these tools, the operation pauses until you approve at `http://localhost:2323`.

## Rollback on failure

All write operations (create, update, delete) run inside an atomic transaction. If a write fails partway through, the previous state is automatically restored.

## Reserved keys

The `media` key is reserved for the dedicated media upload tools (`upload_media_from_url`, `list_media`, `delete_media`). These require custom multipart upload handling not available in the generic factory.

All other keys are processed by the generic factory.
