# Migration Guide: v0.4 → v0.5

v0.5.0 consolidates the 7 per-endpoint tools from v0.4 into 3 tools per endpoint (`list_X`, `get_X`, `mutate_X`). The v0.4 tools still work in v0.5 as deprecated aliases — they will be removed in v0.6.

---

## What changed

| v0.4.0 | v0.5.0 |
|--------|--------|
| 7 tools per endpoint | 3 tools per endpoint |
| `create_X`, `update_X`, `delete_X` as separate tools | Single `mutate_X` with `action` param |
| `preview_create_X`, `preview_update_X` as separate tools | `mutate_X({ action: "preview" })` |
| No relation hints | FK fields auto-detected and surfaced in tool descriptions |
| JSON OpenAPI only | JSON and YAML OpenAPI specs fully parsed |
| No first-run wizard | `npx cms-mcp init --base-url <url>` auto-detects CMS |
| `registerGitHubTools` always registered | Only registered when `config.github` is present |
| `registerSearchTools` always registered | Only registered when `config.schemaCache` is present |

---

## Tool name mapping

### Write operations → `mutate_X`

| v0.4 tool | v0.5 equivalent |
|-----------|-----------------|
| `preview_create_posts` | `mutate_posts({ action: "preview", data: {...} })` |
| `create_posts` | `mutate_posts({ action: "create", data: {...}, confirm: true })` |
| `preview_update_posts` | `mutate_posts({ action: "preview", id: "...", data: {...} })` |
| `update_posts` | `mutate_posts({ action: "update", id: "...", data: {...}, confirm: true })` |
| `delete_posts` | `mutate_posts({ action: "delete", id: "...", confirm: true })` |

The same pattern applies for any endpoint key — replace `posts` with your endpoint name.

### Read operations — unchanged

| v0.4 tool | v0.5 equivalent |
|-----------|-----------------|
| `list_posts` | `list_posts` (unchanged) |
| `get_posts` | `get_posts` (unchanged) |

---

## Config changes

### No config changes required

Your existing `cms-mcp.config.json` works without modification. Endpoints, auth, and schema cache config are all forward-compatible.

### Approval gate `tools` list

If you configured `approvals.tools` with v0.4 tool names, update them to `mutate_X`:

**Before (v0.4):**
```json
{
  "approvals": {
    "tools": ["delete_posts", "delete_projects", "update_posts"]
  }
}
```

**After (v0.5):**
```json
{
  "approvals": {
    "tools": ["mutate_posts", "mutate_projects"]
  }
}
```

`mutate_X` covers all write operations (create, update, delete) so you only need one entry per endpoint.

### Policy engine `tools` list

Same pattern — replace specific v0.4 tool names with `mutate_X`:

**Before (v0.4):**
```json
{
  "type": "required_fields",
  "fields": ["cover_image"],
  "tools": ["create_posts", "update_posts"]
}
```

**After (v0.5):**
```json
{
  "type": "required_fields",
  "fields": ["cover_image"],
  "tools": ["mutate_posts"]
}
```

---

## Backward-compatible aliases

The v0.4 tool names still work in v0.5 — they forward to `mutate_X` internally:

| Deprecated alias | Forwards to |
|------------------|-------------|
| `preview_create_X` | `mutate_X({ action: "preview" })` |
| `create_X` | `mutate_X({ action: "create" })` |
| `preview_update_X` | `mutate_X({ action: "preview" })` |
| `update_X` | `mutate_X({ action: "update" })` |
| `delete_X` | `mutate_X({ action: "delete" })` |

These aliases will be removed in v0.6. Update your Claude conversations and any saved prompts to use `mutate_X` directly.

---

## New features in v0.5

### Relation hints

Foreign-key fields (`author_id`, `tag_ids`, `categoryId`, etc.) are now auto-detected and surfaced in tool descriptions:

```
mutate_posts — ... Relations: author_id → get_authors | tag_ids[] → list_tags
```

No config required — detection runs automatically at startup.

### OpenAPI YAML support

YAML specs (`.yaml`, `.yml`) are now fully parsed using `js-yaml`. If you were previously converting specs to JSON as a workaround, you can stop — point `openapi.discoveryUrl` directly at the YAML URL.

Additional discovery paths are now probed: `/openapi.yml`, `/swagger.yaml`, `/api/openapi.yaml`, `/docs/openapi.yaml`.

### `npx cms-mcp init`

New first-run wizard that probes your API for CMS signatures and writes a starter config:

```bash
npx cms-mcp init --base-url https://your-api.com/api
```

Detects: Supabase/PostgREST, Strapi v4/v5, Directus, PocketBase, Payload CMS.

---

## Checklist

- [ ] Update `approvals.tools` list: `delete_X` / `update_X` → `mutate_X`
- [ ] Update `policies` rule `tools` lists: `create_X` / `update_X` → `mutate_X`
- [ ] Update any saved Claude prompts that reference `create_X`, `update_X`, `delete_X`
- [ ] Optionally remove YAML-to-JSON workaround if you had one
