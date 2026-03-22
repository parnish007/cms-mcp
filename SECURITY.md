# Security Policy

## Threat Model

cms-mcp runs locally as a subprocess of Claude Desktop or Claude Code. It holds credentials for your CMS API and optionally GitHub. The attack surface is:

1. **Malicious tool inputs** — Claude (or a prompt injection in content Claude reads) passes unexpected values to a tool
2. **SSRF via media proxy** — an attacker tricks the media upload tool into fetching internal endpoints
3. **Credential leakage** — secrets end up in logs, error messages, or audit files
4. **Oversized payloads** — unbounded file downloads exhaust memory

## Implemented Mitigations

### SSRF Protection
`upload_media_from_url` runs every source URL through `assertSafeUrl()` before any network request. Blocked ranges:

- `127.x.x.x` / `::1` (loopback)
- `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x` (RFC 1918 private)
- `169.254.x.x` (link-local, AWS/GCP instance metadata)
- `fc00::/7`, `fe80::/10` (IPv6 ULA / link-local)
- `javascript:`, `data:`, `file:` — non-HTTP schemes blocked

### No Redirect Following
All `fetch()` calls in the codebase use `redirect: "error"`. This prevents an attacker from using HTTP 3xx redirects to bypass the SSRF allowlist or leak auth headers to a different host.

### Request Timeouts
Every outbound request (CMS API, GitHub API, media fetch, media upload) has a hard 30-second `AbortController` timeout. This prevents slow-loris style hangs from locking the server.

### File Size Cap
The media proxy rejects files larger than **50 MB**, checked both via `Content-Length` header (early exit) and post-download buffer size (hard cap). This prevents memory exhaustion from unbounded `arrayBuffer()` reads.

### Credential Redaction
The audit logger uses a regex (`/token|password|secret|key|auth|credential|api[-_]?key/i`) that covers both exact matches and common variants. Nested objects are recursively sanitized up to 5 levels deep. Error messages are truncated at 150 characters.

### Input Validation
Every tool runs inputs through a Zod schema before any API call. GitHub owner/repo names are validated against `[a-zA-Z0-9][a-zA-Z0-9\-._]{0,99}` — null bytes, unicode, and path separators are rejected.

### Confirm Guards
All destructive operations (`delete_*`, `publish_*`, `sync_repo_to_project`) require the caller to pass `confirm: true`. This makes it harder for an LLM to accidentally trigger a destructive action without an explicit user instruction.

### Read-Only Mode
Pass `--readonly` to disable all write tools at startup. Useful for read-access MCP configs shared with less-trusted Claude instances.

## Known Limitations

- **DNS rebinding** — hostname validation happens at fetch time, not after DNS resolution. A DNS rebinding attack could bypass IP range checks on some platforms.
- **No rate limiting** — there is no built-in rate limiter on API calls. Rely on your CMS API's own rate limiting.
- **Config file permissions** — cms-mcp does not validate config file permissions. Ensure your `cms-mcp.config.json` is not world-readable (`chmod 600`).
- **Audit log not encrypted** — the audit log is plain-text JSON. Protect it with filesystem permissions.

## Reporting Vulnerabilities

Please **do not** open a public GitHub issue for security vulnerabilities.

Email: [your-email@example.com]

Include:
- A description of the vulnerability
- Steps to reproduce
- Affected versions
- Your assessment of severity

You'll receive a response within 72 hours. We'll coordinate a fix and disclose publicly after a patch is available.
