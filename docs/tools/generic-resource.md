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

## How schemas are built

At startup, for each endpoint:

1. `GET /endpoint?limit=5` — fetch up to 5 live records
2. Collect all field names across all records
3. For each field, infer the type from sampled values:

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

4. Build Zod shapes:
   - **create mode**: exclude `id`, `_id`, `created_at`, `updated_at`; required fields have no `.optional()`
   - **update mode**: all fields optional + `id` required
   - **list mode**: `limit` + `search` + any enum-typed fields as optional filters

5. Register the 7 tools and cache the schema in SQLite

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
→ Re-introspects live API
→ Shows updated field list
→ Tells you to restart for tool shapes to update
```

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
