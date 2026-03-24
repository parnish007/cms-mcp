# Introspection Tools

These are the "meta" tools — they help Claude (and you) understand the CMS API itself.

## Tool list

| Tool | Description |
|------|-------------|
| `discover_api` | Scan for OpenAPI/Swagger spec at common locations |
| `apply_discovered_endpoints` | Write discovered endpoints back to your config file |
| `inspect_endpoint_schema` | Fetch live records and display field types as a markdown table |
| `refresh_resource_schema` | Invalidate cache + re-introspect an endpoint, then prompt restart |
| `list_configured_endpoints` | Show all configured endpoint keys, URLs, and cache status |
| `check_policies` | Validate a data payload against your policies file |
| `init_policies` | Write a starter `cms-mcp.policies.json` to disk |
| `cache_stats` | Show SQLite schema cache statistics |
| `clear_cache` | Delete all cache entries (forces full re-introspection on next start) |

---

## `inspect_endpoint_schema`

Accepts **any configured endpoint key** — not limited to blogs/projects.

The tool uses the same 4-tier schema resolution as startup:
1. **OpenAPI spec** — if `discover_api` has been run and the spec is cached, schema is sourced from the spec (most reliable — every field declared)
2. **Live sampling** — fetches up to 5 records, infers types from runtime values

```
"Inspect the schema of my products endpoint"
→ inspect_endpoint_schema({ endpoint: "products" })
```

**Output (OpenAPI-sourced):**
```
## Schema: /api/products

*Source: OpenAPI spec (path: /products) — 8 fields*

| Field      | Type              | Required | Notes            |
|------------|-------------------|----------|------------------|
| id         | uuid              | ✓        | (uuid)           |
| name       | string            | ✓        | —                |
| price      | number            | ✓        | 0                |
| status     | enum(draft|live)  | ✓        | "draft"          |
| sku        | string?           | —        | —                |
| image_url  | url?              | —        | (uri)            |
| tags       | array             | —        | []               |
| created_at | date              | ✓        | (date-time)      |

> Schema sourced from OpenAPI specification — authoritative field list.
```

**Output (live sampling fallback):**
```
## Schema: /api/products

Sampled 5 records — 8 fields detected

| Field      | Type              | Required | Example          |
|------------|-------------------|----------|------------------|
| id         | uuid              | ✓        | "abc123-..."     |
...
```

To get the most accurate schema, run `discover_api` first to cache the OpenAPI spec.

---

## `refresh_resource_schema`

When you add new fields to your CMS or when a cold-start endpoint finally has records:

```
"Refresh the schema for products"
→ refresh_resource_schema({ resource_key: "products", confirm: true })
```

This:
1. Invalidates the SQLite cache entry for `products`
2. Tries OpenAPI spec (if cached) — falls back to live sampling — falls back to cold-start
3. Re-builds and re-caches the `ResourceSchema`
4. Returns the updated field list
5. **Prompts you to restart** so tool input shapes update

> Note: Refreshing the cache does NOT hot-reload tool schemas. MCP tool shapes are fixed at connection time. You must restart cms-mcp for tool input changes to take effect.

---

## `list_configured_endpoints`

```
"What endpoints are configured?"
→ list_configured_endpoints()
```

Output:
```
## Configured Endpoints

| Key      | URL              | Schema Cached |
|----------|------------------|--------------|
| posts    | /api/posts       | ✓            |
| products | /api/products    | ✓            |
| authors  | /api/authors     | —            |
| media    | /api/uploads     | —            |

Tools generated per endpoint (except media): list_X, get_X, preview_create_X, create_X, preview_update_X, update_X, delete_X
```

---

## `discover_api`

Scans for an OpenAPI/Swagger spec at common locations:
- `/.well-known/openapi.json`
- `/openapi.json`, `/openapi.yaml`
- `/swagger.json`
- `/api-docs/json`

```
"Discover what APIs are available at my base URL"
→ discover_api({ force_refresh: false })
```

Results are cached. Use `force_refresh: true` to bypass cache.

---

## `apply_discovered_endpoints`

Writes the endpoints discovered by `discover_api` directly to your config file:

```
"Apply the discovered endpoints to my config"
→ apply_discovered_endpoints({ config_path: "./cms-mcp.config.json", confirm: true })
```

After this, restart cms-mcp to pick up the new endpoints and generate tools for them.

---

## `check_policies`

Test a payload against your policies before committing to a write:

```
"Check if this post data passes publishing policies"
→ check_policies({
    tool: "publish_posts",
    data: { title: "My Post", tags: ["one"], cover_image: null }
  })
```

---

## `cache_stats` / `clear_cache`

```
"How many entries are in the schema cache?"
→ cache_stats()

"Clear the schema cache and start fresh"
→ clear_cache({ confirm: true })
```

After `clear_cache`, restart cms-mcp to re-introspect all endpoints.
