# Generic Resource Tools

cms-mcp v1.0.0 auto-generates **5 tools per endpoint** from your live CMS schema at startup.

## What gets generated

For every key in `config.endpoints` (except `media`), 5 tools are registered:

| Tool | What it does |
|------|-------------|
| `list_X` | List records with `limit`, `search`, and enum-field filters |
| `get_X` | Fetch a single record by ID |
| `create_X` | Create a record. `preview: true` shows field table — no write. Requires `confirm: true` to execute. |
| `update_X` | Update a record by `id`. Auto-shows diff if `confirm` is missing. `preview: true` for explicit preview. |
| `delete_X` | Delete a record by `id`. Shows warning without `confirm: true`. |

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
list_posts    get_posts    create_posts    update_posts    delete_posts
list_products get_products create_products update_products delete_products
list_authors  get_authors  create_authors  update_authors  delete_authors
```

### Legacy mode

Set `legacyMode: true` to register the v0.5 `mutate_X` combined tool instead:

```json
{ "legacyMode": true }
```

```
list_posts  get_posts  mutate_posts   (action: preview|create|update|delete)
```

---

## How schemas are built — 4-tier resolution

At startup, each endpoint resolves its schema through a priority chain:

| Tier | Source | When used |
|------|--------|-----------|
| **1 — Cache** | SQLite | Schema was cached from a previous run — instant startup |
| **2 — OpenAPI** | Spec | `discover_api` has been run and spec is cached — most reliable |
| **3 — Sampling** | Live API | No spec — fetches **20 records**, merges fields, infers types |
| **4 — Cold-start** | Passthrough | No records and no spec — tools registered with `fields: Record<unknown>` |

**Schema merging (Tier 3):**
All fields across all 20 sampled records are collected as a union. A field present in every record is `alwaysPresent: true`. A field absent in any record is flagged `inconsistent: true` and always gets `.optional()` in the generated Zod shape — preventing false "required field" errors on optional fields.

**OpenAPI schema extraction (Tier 2):**
- Resolves `$ref`, `allOf`, `oneOf`, `anyOf` recursively (cycle-safe)
- Detects `readOnly` fields (excluded from create/update inputs)
- Detects `nullable` / `type: ["string", "null"]`
- Derives enums from `enum:` arrays
- Refines types from `format`: `uuid`, `date-time`, `uri`, `email`
- Supports OpenAPI 3.x and Swagger 2.x

**Live sampling type inference (Tier 3):**

| Type | Detection criteria |
|------|-------------------|
| `uuid` | Matches UUID regex |
| `date` | Starts with YYYY-MM-DD or ISO 8601 |
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
- **create mode**: exclude `id`, `_id`, `created_at`, `updated_at`, `deletedAt`, etc; required fields have no `.optional()` unless `inconsistent`
- **update mode**: all fields optional + `id` required
- **list mode**: `limit` + `search` + any `enum(...)` fields as optional filters

After schema resolution, tools are registered and the schema is written to SQLite (Tier 1 for next startup).

---

## CMSAdapter — field mapping and HTTP method

Some CMS APIs use non-standard field names. The `adapters` config block handles bidirectional translation:

```json
{
  "adapters": {
    "posts": {
      "updateMethod": "PUT",
      "fieldMap": {
        "title":  "post_heading_1",
        "body":   "post_content_markdown",
        "status": "publication_state"
      }
    }
  }
}
```

- **`fieldMap`** — Claude uses the left-hand names; the API receives the right-hand names. Responses are reverse-mapped before returning to Claude.
- **`updateMethod`** — `"PATCH"` (default) or `"PUT"`. Applies to all `update_X` calls for that endpoint.

---

## List tool filtering

If your `posts` endpoint has a `status` field with values `draft|published|archived`, the `list_posts` tool includes `status` as an optional filter:

```
"List my published posts"
→ Claude calls list_posts({ status: "published", limit: 20 })
```

Any field inferred as `enum(...)` automatically becomes a filter in the list tool.

---

## Cold-start mode

If an endpoint returns zero records at startup, tools register in **passthrough mode**:

```
"Create a product"
→ Claude calls create_products({ fields: { name: "Widget", price: 29.99 }, confirm: true })
```

Once records exist:
1. Ask: `"Refresh the schema for products"`
2. Restart cms-mcp — typed `create_products`, `update_products` appear

---

## Preview and confirm flow

All write tools follow a consistent two-step pattern:

```
create_posts({ title: "Hello", status: "draft", preview: true })
→ Shows ## New Record Preview table — no API call

create_posts({ title: "Hello", status: "draft", confirm: true })
→ POSTs to /api/posts, shows ✅ posts created! ID: 123
```

```
update_posts({ id: "123", status: "published" })
→ Auto-shows diff (no confirm = safe preview mode)

update_posts({ id: "123", status: "published", confirm: true })
→ PATCHes /api/posts/123
```

```
delete_posts({ id: "123" })
→ ⚠️ Warning: add confirm: true to proceed

delete_posts({ id: "123", confirm: true })
→ DELETEs /api/posts/123
```

---

## Schema refresh

```
"Refresh the schema for posts"
→ Calls refresh_resource_schema({ resource_key: "posts", confirm: true })
→ Invalidates SQLite cache entry
→ Re-resolves: OpenAPI spec (if cached) → 20-record sampling → cold-start
→ Shows updated field list
→ Tells you to restart for tool shapes to update
```

Full workflow after a CMS schema change:
1. `discover_api` — re-fetch OpenAPI spec into cache
2. `refresh_resource_schema({ resource_key: "posts", confirm: true })` — re-resolve
3. Restart cms-mcp — tool shapes update

---

## Rollback on failure

Write operations run inside a `CompensatingTransaction`. If a write fails partway through, registered compensating steps (DELETE for created resources, PATCH for modified ones) are executed in reverse order.

If rollback itself fails, a `CriticalInconsistencyError` is surfaced with `orphanedIds` listing the resources that need manual cleanup.

---

## Audit logging

Every tool call is logged to the audit file:

```json
{
  "ts": "2024-01-15T10:30:00.000Z",
  "tool": "create_posts",
  "args": { "title": "Hello World", "status": "draft", "confirm": true },
  "outcome": "ok",
  "durationMs": 234
}
```

Secrets in args are automatically redacted.

---

## Approval gate

Generated tools respect the approval gate. To require human approval before certain operations:

```json
{
  "approvals": {
    "tools": ["delete_posts", "delete_products", "create_posts"]
  }
}
```

When Claude calls one of these tools, the operation pauses until you approve at `http://localhost:2323`.

---

## Reserved keys

The `media` key is reserved for the dedicated media upload tools (`upload_media_from_url`, `list_media`, `delete_media`). These require custom multipart upload handling not available in the generic factory.

All other keys are processed by the generic factory.
