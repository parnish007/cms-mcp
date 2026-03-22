# OpenAPI Auto-Discovery

cms-mcp can automatically discover your API's OpenAPI (Swagger) specification at startup. When a spec is found, Claude gains precise knowledge of your API's available endpoints, field shapes, required vs. optional fields, and data types — without you having to configure each endpoint URL manually.

---

## Enabling auto-discovery

In your `cms-mcp.config.json`:

```json
{
  "name": "My Portfolio",
  "baseUrl": "https://my-api.vercel.app",
  "auth": { "type": "bearer", "token": "env:API_TOKEN" },
  "endpoints": {},
  "openapi": {
    "autoDiscover": true
  }
}
```

When `autoDiscover` is `true`, cms-mcp probes well-known URLs on startup to find your spec.

---

## Discovery URL order

cms-mcp tries these URLs in order, stopping at the first successful response:

| Priority | URL |
|----------|-----|
| 1 | `{baseUrl}/.well-known/openapi.json` |
| 2 | `{baseUrl}/openapi.json` |
| 3 | `{baseUrl}/swagger.json` |
| 4 | `{baseUrl}/api-docs/json` |
| 5 | `{baseUrl}/api/openapi.json` |

A "successful response" means HTTP 200 with a `Content-Type` of `application/json` and a body containing an `openapi` or `swagger` version field.

If none of the probed URLs succeed, cms-mcp logs a warning and falls back to the manually configured `endpoints`.

---

## Manual override

To skip the auto-probe and point directly at your spec:

```json
"openapi": {
  "autoDiscover": true,
  "discoveryUrl": "https://my-api.vercel.app/api/openapi.json"
}
```

When `discoveryUrl` is set, only that URL is fetched — the probe sequence is skipped entirely.

---

## How endpoints are extracted from the spec

Once the spec is fetched, cms-mcp parses the `paths` object and maps HTTP routes to tool endpoints:

1. **Path matching** — Routes are matched against resource patterns using heuristics:
   - Paths containing `/projects` → `endpoints.projects`
   - Paths containing `/blog` or `/posts` → `endpoints.blogs`
   - Paths containing `/media` or `/uploads` → `endpoints.media`

2. **Base URL resolution** — If the spec includes a `servers` array, the first entry's URL is used as the API base. This overrides `baseUrl` for endpoint construction.

3. **Field discovery** — For each matched endpoint, cms-mcp reads the `requestBody` schema (for POST/PATCH) and `responses[200].content` schema (for GET) to learn field names, types, and constraints.

4. **fieldMap auto-population** — If your spec uses non-standard field names (e.g., `post_title` instead of `title`), the discovered schema is used to auto-populate the `fieldMap`. You can still override specific mappings in your config.

---

## Example: what Claude knows with discovery enabled

Without discovery:

```
Claude: I can create, update, and publish blog posts. The fields I accept are:
title, body, excerpt, slug, cover_image, tags, status, published_at, reading_time,
seo_title, seo_description.
```

With discovery (for a custom Payload CMS instance):

```
Claude: Your API uses "content" for the body field and "heroImage" for cover images.
The "category" field is required on creation (not optional like standard tags).
The slug is auto-generated server-side — you don't need to provide it.
The API enforces a max body length of 100,000 characters.
```

---

## Example discovered spec

A minimal OpenAPI spec that cms-mcp can discover:

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Portfolio API", "version": "1.0.0" },
  "servers": [{ "url": "https://my-portfolio.vercel.app/api" }],
  "paths": {
    "/blogs": {
      "get": {
        "summary": "List blog posts",
        "parameters": [
          { "name": "status", "in": "query", "schema": { "type": "string", "enum": ["draft", "published"] } },
          { "name": "limit", "in": "query", "schema": { "type": "integer", "default": 20 } }
        ],
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/BlogPost" }
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create a blog post",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/BlogPostCreate" }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "BlogPost": {
        "type": "object",
        "properties": {
          "id":          { "type": "string" },
          "title":       { "type": "string", "maxLength": 200 },
          "content":     { "type": "string" },
          "heroImage":   { "type": "string", "format": "uri" },
          "status":      { "type": "string", "enum": ["draft", "published"] },
          "publishedAt": { "type": "string", "format": "date-time" }
        }
      },
      "BlogPostCreate": {
        "type": "object",
        "required": ["title", "content"],
        "properties": {
          "title":     { "type": "string", "maxLength": 200 },
          "content":   { "type": "string" },
          "heroImage": { "type": "string", "format": "uri" }
        }
      }
    }
  }
}
```

cms-mcp would extract from this:
- blogs endpoint: `https://my-portfolio.vercel.app/api/blogs`
- `fieldMap.body` → `content`
- `fieldMap.coverImage` → `heroImage`
- Required fields on create: `title`, `content`

---

## Serving an OpenAPI spec from Next.js

A minimal Next.js route handler to serve your spec at `/api/openapi.json`:

```typescript
// app/api/openapi.json/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    openapi: "3.1.0",
    info: { title: "Portfolio API", version: "1.0.0" },
    servers: [{ url: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000/api" }],
    paths: {
      "/blogs": {
        get: {
          summary: "List blog posts",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "limit",  in: "query", schema: { type: "integer", default: 20 } }
          ],
          responses: { "200": { description: "Array of blog posts" } }
        },
        post: {
          summary: "Create a blog post",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { "$ref": "#/components/schemas/BlogPostCreate" } } }
          },
          responses: { "201": { description: "Created blog post" } }
        }
      }
    },
    components: {
      schemas: {
        BlogPostCreate: {
          type: "object",
          required: ["title", "body"],
          properties: {
            title:    { type: "string", maxLength: 200 },
            body:     { type: "string" },
            excerpt:  { type: "string", maxLength: 300 },
            tags:     { type: "array", items: { type: "string" } },
            status:   { type: "string", enum: ["draft", "published"] }
          }
        }
      }
    }
  });
}
```

---

## Caching discovered specs

OpenAPI specs are cached locally in SQLite to avoid re-fetching on every startup. Configure the cache with the `schemaCache` option:

```json
"schemaCache": {
  "path": "~/.cms-mcp/schema.db",
  "ttlMinutes": 60
}
```

See [Schema Cache](./schema-cache.md) for full details.

---

## Interaction with manual `endpoints`

Discovery and manual `endpoints` work together. Manual endpoints always take precedence:

- If `endpoints.blogs` is set, that URL is used — the discovered value is ignored for blogs.
- If `endpoints.blogs` is not set but the spec reveals a `/blogs` path, the discovered URL is used.

This lets you override specific endpoints while still benefiting from discovery for the rest.
