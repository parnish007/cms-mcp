# OpenAPI Auto-Discovery

cms-mcp can automatically discover your API's OpenAPI (Swagger) specification at startup. When a spec is found, it becomes Tier 2 in the 4-tier schema resolution chain — authoritative field definitions, required/optional status, enum values, and format constraints, without sampling live records.

---

## Enabling auto-discovery

In your `cms-mcp.config.json`:

```json
{
  "name": "My Portfolio",
  "baseUrl": "https://my-api.vercel.app/api",
  "auth": { "type": "bearer", "token": "env:API_TOKEN" },
  "endpoints": {},
  "openapi": {
    "autoDiscover": true
  }
}
```

When `autoDiscover` is `true`, cms-mcp probes well-known URLs on startup to find your spec. Both JSON and YAML specs are fully supported.

---

## Discovery URL order

cms-mcp tries these URLs in order, stopping at the first successful response:

| Priority | URL |
|----------|-----|
| 1 | `{baseUrl}/.well-known/openapi.json` |
| 2 | `{baseUrl}/openapi.json` |
| 3 | `{baseUrl}/openapi.yaml` |
| 4 | `{baseUrl}/openapi.yml` |
| 5 | `{baseUrl}/swagger.json` |
| 6 | `{baseUrl}/swagger.yaml` |
| 7 | `{baseUrl}/swagger/v1/swagger.json` |
| 8 | `{baseUrl}/api-docs/json` |
| 9 | `{baseUrl}/api-docs` |
| 10 | `{baseUrl}/api/openapi.json` |
| 11 | `{baseUrl}/api/openapi.yaml` |
| 12 | `{baseUrl}/api/swagger.json` |
| 13 | `{baseUrl}/docs/openapi.json` |
| 14 | `{baseUrl}/docs/openapi.yaml` |

A "successful response" means HTTP 200 with a parseable JSON or YAML body containing an `openapi` or `swagger` version field.

If none succeed, cms-mcp logs a warning and falls back to Tier 3 (live sampling) or Tier 4 (cold-start passthrough).

---

## Manual override

To skip the auto-probe and point directly at your spec:

```json
"openapi": {
  "autoDiscover": true,
  "discoveryUrl": "https://my-api.vercel.app/api/docs/openapi.yaml"
}
```

When `discoveryUrl` is set, only that URL is fetched — the probe sequence is skipped entirely. Works for both JSON and YAML URLs.

---

## JSON and YAML support

Both formats are fully parsed:

- **JSON** — parsed directly via `JSON.parse`
- **YAML** — detected by `.yaml`/`.yml` URL extension or `content-type: yaml` response header, parsed with `js-yaml`

No conversion or workaround needed. Point `discoveryUrl` at your YAML spec URL if that's what your API serves.

---

## How endpoints are extracted from the spec

Once the spec is fetched, cms-mcp parses the `paths` object:

1. **Path grouping** — Routes are grouped by their root segment (`/posts`, `/posts/{id}` → root `posts`).

2. **Resource detection** — Each group with a `GET` collection route or `POST` route is treated as a resource. The root segment becomes the suggested config key.

3. **Key mapping** — Common names are mapped to canonical keys: `posts`/`articles`/`entries` → `blogs`; `projects`/`works`/`portfolio` → `projects`; `media`/`uploads`/`images` → `media`. Unknown names use their own name as the key.

4. **Schema extraction** — For each matched endpoint, cms-mcp reads `requestBody` schemas (POST/PATCH) and `responses[200]` schemas (GET). Supports:
   - Full `$ref` resolution (recursive, cycle-safe)
   - `oneOf` / `anyOf` / `allOf` merging
   - `readOnly` fields excluded from create/update shapes
   - Nullable detection via `nullable: true` or `type: ["string", "null"]`
   - Format-based refinement: `uuid`, `date-time`, `uri`, `email`
   - Enum detection → `z.enum([...])`
   - Common list wrapper unwrapping: `data`, `items`, `results`, `records`, `entries`, `nodes`, `collection`

5. **Relation hints** — After schema extraction, FK fields (`author_id`, `tag_ids`, etc.) are cross-referenced against configured endpoint keys and surfaced in tool descriptions.

---

## What Claude knows with discovery enabled

Without discovery (sampling-only, Tier 3):

```
Inferred 6 fields from 5 sampled records.
Fields: id (uuid), title (string), status (enum: draft|published), created_at (date)
Warning: optional fields may be missing — only 5 records sampled.
```

With discovery (Tier 2, OpenAPI spec):

```
Extracted 14 fields from OpenAPI spec.
Required: title (string), content (string)
Optional: slug (string), cover_image (url), tags (array), status (enum: draft|published),
          published_at (date-time), seo_title (string), seo_description (string),
          author_id (uuid, → get_authors), reading_time (number)
ReadOnly (excluded from writes): id, created_at, updated_at
```

---

## Example: minimal OpenAPI spec for cms-mcp

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Portfolio API", "version": "1.0.0" },
  "paths": {
    "/posts": {
      "get": {
        "summary": "List posts",
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": { "type": "array", "items": { "$ref": "#/components/schemas/Post" } }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create a post",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": { "schema": { "$ref": "#/components/schemas/PostCreate" } }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "Post": {
        "type": "object",
        "properties": {
          "id":         { "type": "string", "format": "uuid", "readOnly": true },
          "title":      { "type": "string", "maxLength": 200 },
          "content":    { "type": "string" },
          "status":     { "type": "string", "enum": ["draft", "published"] },
          "author_id":  { "type": "string", "format": "uuid" },
          "created_at": { "type": "string", "format": "date-time", "readOnly": true }
        }
      },
      "PostCreate": {
        "type": "object",
        "required": ["title", "content"],
        "properties": {
          "title":   { "type": "string", "maxLength": 200 },
          "content": { "type": "string" },
          "status":  { "type": "string", "enum": ["draft", "published"] }
        }
      }
    }
  }
}
```

cms-mcp extracts from this:
- `posts` endpoint with 6 fields
- Required on create: `title`, `content`
- `id` and `created_at` excluded from write shapes (`readOnly: true`)
- `status` becomes an enum filter param on `list_posts`
- `author_id` detected as FK → relation hint: `author_id → get_authors`

---

## Serving an OpenAPI spec from Next.js

```typescript
// app/api/openapi.json/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: { title: "My API", version: "1.0.0" },
    paths: {
      "/posts": {
        get: { summary: "List posts", responses: { "200": { description: "Array of posts" } } },
        post: {
          summary: "Create post",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title:  { type: "string" },
                    body:   { type: "string" },
                    status: { type: "string", enum: ["draft", "published"] }
                  }
                }
              }
            }
          }
        }
      }
    }
  });
}
```

---

## Caching discovered specs

OpenAPI specs are cached in SQLite to avoid re-fetching on every startup:

```json
"schemaCache": {
  "path": "~/.cms-mcp/schema.db",
  "ttlMinutes": 60
}
```

To force re-discovery: run `discover_api` in Claude, or delete the cache file and restart.

---

## Interaction with manual `endpoints`

Discovery and manual `endpoints` work together:

- If `endpoints.posts` is set, that URL is used — the discovered URL is ignored for posts.
- If `endpoints.posts` is not set but the spec reveals a `/posts` path, the discovered URL is used.

This lets you override specific endpoints while still benefiting from discovery for the rest.
