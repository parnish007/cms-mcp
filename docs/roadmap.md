# Roadmap

## Implemented (v0.2.0)

### Core
- [x] Zod validation firewall on all tool inputs
- [x] Atomic transactions with rollback on write failures
- [x] Binary media proxy with MIME detection from magic bytes
- [x] Diff preview engine — field-level change tables before writes
- [x] 23 MCP tools (Projects, Blogs, Media, GitHub, Introspection, Search)
- [x] Read-only mode
- [x] Audit logging with recursive secret redaction

### Security
- [x] SSRF protection — blocks private IPs, loopback, link-local, AWS metadata
- [x] 30-second request timeouts on all outbound calls
- [x] 50 MB media upload cap
- [x] No redirect following (`redirect: "error"`)
- [x] HMAC-SHA256 webhook signature verification
- [x] GitHub owner/repo name validation against character allowlists

### Advanced Features
- [x] OpenAPI/Swagger auto-discovery — scans for spec, suggests endpoint config
- [x] Policy engine — 10 rule types, governance layer for teams
- [x] GitHub webhook listener — auto-creates shadow drafts on push
- [x] SQLite schema cache with TTL-based invalidation
- [x] Semantic vector search — local TF-IDF, cosine similarity, zero API calls
- [x] MCP Resources — `cms://projects/{id}`, `cms://blogs/{id}`
- [x] Circuit breaker — graceful degradation when CMS API is down
- [x] Content distillation — HTML→Markdown, junk field stripping, metadata headers

### Developer Experience
- [x] 76 unit tests across 6 test suites
- [x] Docker + docker-compose support
- [x] Full documentation (getting-started, configuration, tools, advanced)
- [x] Example configs for Next.js + Supabase

---

## Phase 2 (Planned)

### Visual Diff Previews
Use Playwright to take headless screenshots of your CMS's preview URL. When `preview_update_project` is called, snap a before/after screenshot and send the image to Claude.

### Embedding-Based Vector Search
Replace TF-IDF with real embeddings from OpenAI, Cohere, or local models (sentence-transformers). Higher accuracy for semantic matching. Configurable: `embedding.provider: "openai" | "local"`.

### Vault / Secrets Manager
Enterprise-grade secret resolution:
```json
{ "token": "vault:secret/data/cms#api_token" }
{ "token": "aws-ssm:/cms-mcp/api-token" }
```

### AST-Based GitHub Scanning
Instead of regex-matching README keywords, parse `package.json` dependency trees, Python `import` statements, and Go `go.mod` files to detect actual technology usage.

### Cloudinary / S3 / Vercel Blob Optimization
Auto-convert uploaded images to WebP, resize to standard dimensions, generate thumbnails. Integrate directly with cloud storage APIs instead of proxying through the CMS.

---

## Phase 3 (Future)

### Multi-Tenant Support
Manage multiple sites from one cms-mcp instance:
```json
{
  "sites": {
    "portfolio": { "baseUrl": "...", "endpoints": {...} },
    "blog": { "baseUrl": "...", "endpoints": {...} }
  }
}
```

### Scheduled Publishing
`schedule_publish` tool — set a future date, cms-mcp publishes automatically.

### Content Versioning
Track revision history locally. Roll back to any previous version of a project or blog post.

### MCP Resource Subscriptions
Push `notifications/resources/updated` when CMS content changes. Requires a polling background worker or webhook integration.

### Sampling / Context Window Management
When a query returns 50+ results, use MCP sampling to ask Claude: "Based on our conversation, which 5 results are most relevant?" Prevents context window overflow.

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to add features. Open an issue first for anything in Phase 2/3 to discuss the approach.
