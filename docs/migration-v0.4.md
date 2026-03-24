# Migration Guide: v0.3.x → v0.4.0

## What changed

v0.4.0 replaces the hardcoded `projects.ts` and `blogs.ts` tool files with a **generic tool factory** that introspects your live CMS schema at startup and generates tools from whatever fields actually exist.

### Key benefits of v0.4.0

- **Any CMS field structure works** — no more silent field drops if your API uses `headline` instead of `title`
- **Any endpoint key** — `products`, `authors`, `events`, `orders` — not just `blogs`/`projects`
- **Schema-accurate Zod validation** — validators match your actual field types (uuid, date, enum, etc.)
- **Zero code changes needed** when your CMS schema evolves

---

## Config migration

Your existing config works as-is. No changes required.

```json
{
  "endpoints": {
    "projects": "/projects",
    "blogs":    "/posts",
    "media":    "/uploads"
  }
}
```

This still generates the same tools — they're just now schema-driven.

To add new resources, simply add keys:
```json
{
  "endpoints": {
    "projects": "/projects",
    "blogs":    "/posts",
    "products": "/products",
    "authors":  "/authors",
    "media":    "/uploads"
  }
}
```

---

## Tool name changes

The tool factory names tools as `verb_key` where `key` is the endpoint key (plural usually recommended).

| v0.3.x | v0.4.0 | Notes |
|--------|--------|-------|
| `list_projects` | `list_projects` | Same if key = "projects" |
| `get_project` | `get_projects` | Singular → plural (key-based) |
| `create_project` | `create_projects` | |
| `update_project` | `update_projects` | |
| `publish_project` | Use `update_projects` with `status: "published"` | Merged into update |
| `delete_project` | `delete_projects` | |
| `preview_create_project` | `preview_create_projects` | |
| `preview_update_project` | `preview_update_projects` | |
| `list_blogs` | `list_blogs` | Same if key = "blogs" |
| `get_blog` | `get_blogs` | |
| `create_blog` | `create_blogs` | |
| `update_blog` | `update_blogs` | |
| `publish_blog` | Use `update_blogs` with `status: "published"` | |
| `unpublish_blog` | Use `update_blogs` with `status: "draft"` | |
| `delete_blog` | `delete_blogs` | |

### Want the old singular names?

Set endpoint keys to the singular form:
```json
{
  "endpoints": {
    "project": "/projects",
    "blog":    "/posts"
  }
}
```
This generates `create_project`, `list_blog`, etc.

---

## Approval gate config

If you had `approvals.tools` pointing to old tool names, update them:

```json
{
  "approvals": {
    "tools": [
      "delete_projects",
      "delete_blogs",
      "update_projects",
      "update_blogs"
    ]
  }
}
```

---

## First-run behavior

On first startup after upgrade:

1. cms-mcp will introspect each endpoint (fetches 5 live records)
2. Schemas are cached in SQLite
3. Tools are registered with field types matching your actual CMS
4. Startup banner shows which resources were registered and which are in cold-start mode

Example banner:
```
  ┌──────────────────────────────────────┐
  │  cms-mcp v0.4.0                      │
  └──────────────────────────────────────┘
  Base URL:  https://your-api.com/api
  Features:  schema-cache, vector-search
  Resources: projects, blogs (schema-driven)
  Cold-start: products (no records yet — passthrough mode)
  Skipped:   media (reserved)
```

---

## Schema cache

On first boot, schemas are always fetched live (cache is empty). After that, restarts are instant — schemas load from SQLite until the TTL expires (default: 60 minutes).

To force a fresh introspection:
```
"Clear the schema cache"
→ clear_cache({ confirm: true })
→ restart cms-mcp
```

---

## Policies

If you had policies referencing old tool names like `publish_blog`, update them to the new names:

```json
{
  "rules": [
    {
      "type": "required_fields",
      "fields": ["cover_image"],
      "tools": ["update_blogs"]
    }
  ]
}
```

---

## Removed tools

These tools no longer exist as separate tools — use `update_X` instead:

| Removed | Replacement |
|---------|-------------|
| `publish_project` | `update_projects` with `{ status: "published" }` |
| `publish_blog` | `update_blogs` with `{ status: "published", published_at: "<iso date>" }` |
| `unpublish_blog` | `update_blogs` with `{ status: "draft" }` |

---

## New tools in v0.4.0

| Tool | Purpose |
|------|---------|
| `refresh_resource_schema` | Invalidate cache + re-introspect a single endpoint |
| `list_configured_endpoints` | Show all configured keys, URLs, and cache status |
