# Roadmap

## Implemented (v0.5.0 — current)

### Core
- [x] 3 tools per endpoint: `list_X`, `get_X`, `mutate_X` — small, predictable tool surface
- [x] `mutate_X` covers create / update / delete / preview with `action` param
- [x] Zod validation firewall on all tool inputs (dynamic shapes built at startup)
- [x] Atomic transactions with rollback on write failures
- [x] Diff preview engine — field-level change tables before any API call
- [x] Read-only mode (`--readonly`)
- [x] Audit logging with recursive secret redaction

### Schema
- [x] 4-tier schema resolution: cache → OpenAPI (JSON/YAML) → sampling → cold-start passthrough
- [x] OpenAPI 3.x + Swagger 2.x parsing — `$ref` resolution, `oneOf`/`anyOf`/`allOf`, `readOnly` exclusion
- [x] OpenAPI YAML support via `js-yaml` — `.yaml`/`.yml` URLs parsed natively
- [x] Relation hints — FK fields (`author_id`, `tag_ids`) auto-detected and surfaced in tool descriptions
- [x] SQLite schema cache with TTL-based invalidation — instant restarts after first run
- [x] `refresh_resource_schema` — on-demand schema refresh per endpoint
- [x] `list_configured_endpoints` — endpoint table with cache tier status

### Developer Experience
- [x] `npx cms-mcp init --base-url <url>` — detects CMS type, writes starter config in seconds
- [x] v0.4 backward-compat aliases (`create_X`, `update_X`, `delete_X`) forwarding to `mutate_X`
- [x] Plugin-conditional tool registration (GitHub, search only registered when configured)
- [x] 78 unit tests across 6 test suites — Node native test runner, no Jest/Vitest
- [x] Docker + docker-compose support

### Security
- [x] SSRF protection — private IPs (RFC 1918), loopback, link-local, AWS metadata, IPv6 ULA blocked
- [x] 30-second request timeouts on all outbound calls
- [x] 50 MB media upload cap
- [x] No redirect following (`redirect: "error"`)
- [x] HMAC-SHA256 webhook signature verification
- [x] Approval gate — human click required before any write executes

### Optional Plugins
- [x] OpenAPI auto-discovery — scans API for spec, suggests endpoint config
- [x] Policy engine — 10 rule types, governance layer for teams
- [x] GitHub webhook listener — auto-creates shadow drafts on push
- [x] Semantic vector search — local TF-IDF and OpenAI embeddings, cosine similarity
- [x] MCP Resources — `cms://X/{id}` per endpoint, HTML distilled to Markdown
- [x] Circuit breaker — graceful degradation when CMS API is down
- [x] Content distillation — HTML→Markdown, junk field stripping, metadata headers
- [x] Binary media proxy — MIME detection, Cloudinary/S3 compatible

---

## Phase 2 (Planned)

### Schema drift detection
Automatically detect when your CMS schema has changed (new fields, removed fields, type changes) and alert Claude. Run `refresh_resource_schema` automatically on a configurable schedule.

### OpenAI Structured Outputs
Use OpenAI's structured outputs mode to generate create/update payloads that are guaranteed to conform to the exact Zod schema of each endpoint — zero hallucinated fields.

### Visual diff previews
Use Playwright to take headless screenshots of your CMS preview URL. When `mutate_X` is called with `action: "preview"`, snap a before/after screenshot and send the image to Claude.

### Vault / Secrets Manager
Enterprise-grade secret resolution:
```json
{ "token": "vault:secret/data/cms#api_token" }
{ "token": "aws-ssm:/cms-mcp/api-token" }
```

### AST-based GitHub scanning
Instead of regex-matching README keywords, parse `package.json` dependency trees, Python `import` statements, and Go `go.mod` files to detect actual technology usage.

---

## Phase 3 (Future)

### Multi-tenant support
Manage multiple sites from one cms-mcp instance:
```json
{
  "sites": {
    "portfolio": { "baseUrl": "...", "endpoints": {...} },
    "blog":      { "baseUrl": "...", "endpoints": {...} }
  }
}
```

### Scheduled publishing
`schedule_publish` tool — set a future date, cms-mcp publishes automatically.

### Pagination cursor abstraction
Transparent multi-page iteration: `list_X({ all: true })` fetches all pages, streams results back to Claude in batches to avoid context overflow.

### MCP Resource subscriptions
Push `notifications/resources/updated` when CMS content changes — requires a polling background worker or webhook integration.

### Production hardening
Rate limiting, Docker image <50 MB target, MCP registry submission.

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to add features. Open an issue first for anything in Phase 2/3 to discuss the approach.
