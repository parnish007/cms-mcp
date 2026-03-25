# Configuration Reference

cms-mcp is configured via a single `cms-mcp.config.json` file. This document covers every field, all supported auth types, and complete example configs for common CMS stacks.

---

## Config file search order

When cms-mcp starts, it looks for the config file in this order:

1. `{current working directory}/cms-mcp.config.json`
2. `{home directory}/cms-mcp.config.json`

The first file found is used. If neither exists, the server exits with an error message pointing to this documentation.

**CWD takes precedence**, so you can have a project-specific config that overrides your global one.

---

## Top-level fields

### `name` (optional)

A human-readable label for your site. Appears in audit log entries and error messages.

```json
"name": "My Portfolio"
```

---

### `baseUrl` (required)

The base URL of your API. Used to resolve relative endpoint paths and as the base for OpenAPI discovery.

```json
"baseUrl": "https://my-portfolio.vercel.app/api"
```

---

### `auth` (required)

Authentication method for your CMS API. Supports four types via a discriminated union on `type`.

#### `bearer` — Authorization: Bearer token

```json
"auth": {
  "type": "bearer",
  "token": "env:CMS_API_TOKEN"
}
```

Sends `Authorization: Bearer <token>` on every request.

#### `api-key` — Custom header API key

```json
"auth": {
  "type": "api-key",
  "header": "X-API-Key",
  "token": "env:CMS_API_KEY"
}
```

`header` defaults to `X-API-Key` if omitted. Use this for Payload CMS, PocketBase admin tokens, or any API that uses a custom key header.

#### `basic` — HTTP Basic Auth

```json
"auth": {
  "type": "basic",
  "username": "admin",
  "password": "env:CMS_PASSWORD"
}
```

Encodes credentials as `Authorization: Basic base64(username:password)`.

#### `none` — No authentication

```json
"auth": {
  "type": "none"
}
```

Sends no `Authorization` header. Use only for locally-hosted CMSs behind a firewall.

---

### `endpoints` (required — at least one)

Maps resource keys to their API paths (relative to `baseUrl`) or full URLs.

```json
"endpoints": {
  "projects": "/projects",
  "posts":    "/posts",
  "media":    "/media",
  "tags":     "/tags",
  "authors":  "/authors"
}
```

**Every key (except `media`) generates 5 tools by default:**

| Tool | Description |
|------|-------------|
| `list_X` | List records with `limit`, `search`, and enum-field filters |
| `get_X` | Fetch a single record by ID |
| `create_X` | Create a record (preview → confirm flow) |
| `update_X` | Update a record by ID (auto-diff → confirm flow) |
| `delete_X` | Delete a record (warning → confirm flow) |

So `"projects"` → `list_projects`, `get_projects`, `create_projects`, `update_projects`, `delete_projects`.

The `media` key is reserved for dedicated upload/list/delete media tools. All other keys are handled by the generic resource factory.

When `legacyMode: true`, 3 tools are generated per endpoint instead: `list_X`, `get_X`, `mutate_X`.

---

### `adapters` (optional)

Per-endpoint configuration for field name mapping and HTTP method override. Keys must match keys in `endpoints`.

```json
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
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `updateMethod` | `"PATCH"` \| `"PUT"` | `"PATCH"` | HTTP method for update operations |
| `fieldMap` | `Record<string, string>` | — | Internal name (Claude sees) → external name (API receives). Responses are reverse-mapped. |

If an `adapters` key has no matching `endpoints` key, cms-mcp prints a warning at startup.

---

### `legacyMode` (optional, default: `false`)

When `true`, registers the v0.5-compatible `mutate_X` combined tool instead of the default v1.0.0 split tools (`create_X`, `update_X`, `delete_X`).

```json
"legacyMode": true
```

Use this if you have saved Claude prompts from v0.5 that reference `mutate_X`. See [Migration from v0.5](./migration-v0.5.md).

---

### `allowedPorts` (optional)

Ports that are explicitly allowed in outbound API URLs. By default only port 80 and 443 are permitted (SSRF protection). Add non-standard ports used by your local or staging API here.

```json
"allowedPorts": [3000, 8080, 4000]
```

See [Security guide](./security.md) for full SSRF protection details.

---

### `readOnly` (optional, default: `false`)

When `true`, all write operations are disabled. Claude receives a clear message instead of executing any create, update, or delete operation.

```json
"readOnly": true
```

Use this when sharing a Claude instance with team members who should be able to query content but not modify it.

---

### `auditLog` (optional)

Path to a file where every tool call is logged as newline-delimited JSON.

```json
"auditLog": "~/.cms-mcp/audit.log"
```

Each line is a JSON object:

```json
{
  "timestamp": "2026-03-22T14:30:00.000Z",
  "tool": "create_posts",
  "args": { "title": "My Post", "status": "draft", "confirm": true },
  "outcome": "success",
  "durationMs": 342
}
```

`outcome` is one of: `"success"`, `"error"`, `"validation_error"`, `"blocked_readonly"`. Secrets in args are automatically redacted. Long string values are truncated to 60 chars. The `~` prefix is expanded to your home directory on both Unix and Windows.

---

### `policies` (optional)

Path to a [policy engine configuration file](./advanced/policy-engine.md). Policies block writes that violate content governance rules before they reach the API.

```json
"policies": "./cms-mcp.policies.json"
```

Run `init_policies` to generate a starter file. See [Policy Engine](./advanced/policy-engine.md).

---

### `webhook` (optional)

Starts an HTTP server that listens for GitHub push events and auto-syncs repos to your CMS.

```json
"webhook": {
  "port": 3001,
  "secret": "env:WEBHOOK_SECRET",
  "path": "/webhook"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `port` | `3001` | Port for the webhook listener (1024–65535) |
| `secret` | required | HMAC secret for validating GitHub payloads |
| `path` | `"/webhook"` | URL path for the webhook endpoint |

See [Webhook Mode](./advanced/webhook-mode.md).

---

### `schemaCache` (optional)

Caches discovered schemas locally in SQLite to reduce startup round trips.

```json
"schemaCache": {
  "path": "~/.cms-mcp/schema-cache.db",
  "ttlMinutes": 60
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `path` | `"~/.cms-mcp/schema-cache.db"` | SQLite file location |
| `ttlMinutes` | `60` | Cache TTL in minutes |

See [Schema Cache](./advanced/schema-cache.md).

---

### `openapi` (optional)

Controls OpenAPI spec auto-discovery at startup.

```json
"openapi": {
  "autoDiscover": true,
  "discoveryUrl": "https://my-api.vercel.app/openapi.json"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `autoDiscover` | `true` | Probe common spec paths at startup |
| `discoveryUrl` | — | Skip discovery and fetch this URL directly |

When a spec is found, it is used as the authoritative schema source (Tier 2 in the 4-tier resolution chain). See [OpenAPI Discovery](./advanced/openapi-discovery.md).

---

### `github` (optional)

Enables the GitHub tools (`scan_repo`, `sync_repo_to_project`, `list_repos`).

```json
"github": {
  "token": "env:GITHUB_TOKEN",
  "defaultOwner": "your-github-username"
}
```

| Field | Description |
|-------|-------------|
| `token` | GitHub Personal Access Token. Needs `repo` scope for private repos, `public_repo` for public only. |
| `defaultOwner` | When you say "scan my repo foo", this username is used if no owner is specified. |

---

### `approvals` (optional)

Enables the human approval gate. Write operations pause until you approve in a browser UI.

```json
"approvals": {
  "port": 2323,
  "timeoutMs": 300000,
  "tools": ["delete_posts", "delete_projects"]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `port` | `2323` | Localhost port for the approval dashboard |
| `timeoutMs` | `300000` (5 min) | Auto-reject timeout in milliseconds |
| `tools` | all write tools | Specific tool names to gate; omit to gate all writes |

See [Approval Gate](./advanced/approval-gate.md).

---

### `embedding` (optional)

Enables semantic vector search via OpenAI embeddings.

```json
"embedding": {
  "provider": "openai",
  "apiKey": "env:OPENAI_API_KEY",
  "model": "text-embedding-3-small"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `provider` | required | Currently only `"openai"` |
| `apiKey` | required | OpenAI API key or `env:` reference |
| `model` | `"text-embedding-3-small"` | Embedding model name |

See [Vector Search](./advanced/vector-search.md).

---

## Environment variable (secret) references

Any string field that accepts sensitive data supports the `env:` prefix:

```
"env:VARIABLE_NAME"
```

At startup, cms-mcp resolves these values from the process environment. If the variable is not set, the server exits with a clear error:

```
[cms-mcp] Environment variable "CMS_API_TOKEN" is required but not set.
Add it to the "env" field in your Claude Desktop config.
```

**Supported fields for `env:` references:**
- `auth.token` (bearer and api-key)
- `auth.password` (basic)
- `github.token`
- `github.webhookSecret`
- `webhook.secret`
- `embedding.apiKey`

**Never put raw secrets directly in the JSON file** — the file may be committed to source control.

---

## Example configs

### Supabase + Next.js API routes

```json
{
  "name": "My Supabase Portfolio",
  "baseUrl": "https://my-portfolio.vercel.app/api",
  "auth": {
    "type": "bearer",
    "token": "env:SUPABASE_SERVICE_ROLE_KEY"
  },
  "endpoints": {
    "projects": "/projects",
    "posts":    "/posts",
    "media":    "/media"
  },
  "github": {
    "token": "env:GITHUB_TOKEN",
    "defaultOwner": "yourname"
  },
  "schemaCache": { "path": "~/.cms-mcp/schema-cache.db", "ttlMinutes": 60 },
  "auditLog": "~/.cms-mcp/audit.log"
}
```

---

### PocketBase

PocketBase uses a custom `Authorization` header with an admin token:

```json
{
  "name": "PocketBase Portfolio",
  "baseUrl": "https://pb.my-site.com",
  "auth": {
    "type": "api-key",
    "header": "Authorization",
    "token": "env:PB_ADMIN_TOKEN"
  },
  "endpoints": {
    "projects": "/api/collections/projects/records",
    "posts":    "/api/collections/blog_posts/records",
    "media":    "/api/collections/media/records"
  }
}
```

Get your admin token by calling `POST /api/admins/auth-with-password` and storing the returned `token`.

---

### Payload CMS

```json
{
  "name": "Payload Portfolio",
  "baseUrl": "https://payload.my-site.com",
  "auth": {
    "type": "api-key",
    "header": "Authorization",
    "token": "env:PAYLOAD_API_KEY"
  },
  "endpoints": {
    "projects": "/api/projects",
    "posts":    "/api/posts",
    "media":    "/api/media"
  },
  "adapters": {
    "posts": {
      "fieldMap": {
        "body":        "content",
        "coverImage":  "heroImage"
      }
    }
  }
}
```

In Payload, enable API key authentication in your collection config and set `useAPIKey: true`.

---

### Custom Next.js API (no external CMS)

```json
{
  "name": "Custom Portfolio",
  "baseUrl": "https://yourname.dev/api",
  "auth": {
    "type": "bearer",
    "token": "env:API_SECRET_KEY"
  },
  "endpoints": {
    "projects": "/projects",
    "posts":    "/posts",
    "media":    "/media"
  },
  "github": {
    "token": "env:GITHUB_TOKEN",
    "defaultOwner": "yourname"
  },
  "readOnly": false,
  "auditLog": "~/.cms-mcp/audit.log",
  "openapi": {
    "autoDiscover": true
  }
}
```

Your API route handler validates the token:

```typescript
// app/api/projects/route.ts
export async function GET(req: Request) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (token !== process.env.API_SECRET_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... your logic
}
```
