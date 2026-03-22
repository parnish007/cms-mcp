# Schema Cache

SQLite-backed local cache that reduces API round-trips by storing OpenAPI specs and discovery results locally.

## Setup

```json
{
  "schemaCache": {
    "path": "~/.cms-mcp/schema-cache.db",
    "ttlMinutes": 60
  }
}
```

## What gets cached

- **OpenAPI discovery results** — the parsed spec, detected resources, and suggested endpoints
- **Endpoint metadata** — response shapes, field names

## TTL

Cache entries expire after `ttlMinutes` (default: 60 minutes). Expired entries are purged on startup.

Force a fresh discovery anytime:

```
Tool: discover_api
Args: { "force_refresh": true }
```

## Tools

### `cache_stats`

Shows cache health:

```
## Schema Cache Stats

| Metric | Value |
|--------|-------|
| Total entries | 3 |
| Expired (not yet purged) | 0 |
| Oldest entry | 12m ago |
```

### `clear_cache`

Wipes all cache entries:

```
Tool: clear_cache
Args: { "confirm": true }
```

## Semantic Vector Cache

When `schemaCache` is enabled, a companion vector database is automatically created at `{path}-vectors.db`. This powers the `semantic_search` tool.

### Populating the vector cache

```
Tool: sync_all_content
Args: { "types": ["projects", "blogs"] }
```

This pulls all content from your CMS and indexes it locally with TF-IDF vectors.

### Searching

```
Tool: semantic_search
Args: { "query": "fintech dashboard project", "limit": 5 }
```

Returns results ranked by cosine similarity — no API call needed.

## File locations

| File | Purpose |
|------|---------|
| `~/.cms-mcp/schema-cache.db` | OpenAPI spec cache |
| `~/.cms-mcp/schema-cache-vectors.db` | Semantic search vectors |

Both are SQLite databases. You can inspect them with any SQLite client.

## Clearing

```bash
rm ~/.cms-mcp/schema-cache*.db
```

Or use the `clear_cache` tool from Claude.
