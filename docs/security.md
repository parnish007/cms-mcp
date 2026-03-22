# Security Guide

This guide is for operators deploying cms-mcp in production or shared environments.

## Credential Management

### Environment variable references

Never put raw tokens in `cms-mcp.config.json`. Use `env:` references:

```json
{
  "auth": { "type": "bearer", "token": "env:CMS_API_TOKEN" },
  "github": { "token": "env:GITHUB_TOKEN" }
}
```

### Claude Desktop

Set secrets in the `env` block:

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "npx",
      "args": ["cms-mcp"],
      "env": {
        "CMS_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Config file permissions

```bash
chmod 600 cms-mcp.config.json
```

## Network Security

### SSRF Protection

The media proxy blocks requests to:

| Range | Purpose |
|-------|---------|
| `127.0.0.0/8` | Loopback |
| `10.0.0.0/8` | Private (RFC 1918) |
| `172.16.0.0/12` | Private (RFC 1918) |
| `192.168.0.0/16` | Private (RFC 1918) |
| `169.254.0.0/16` | Link-local / AWS metadata |
| `::1`, `fc00::/7`, `fe80::/10` | IPv6 private |
| `file://`, `data://`, `javascript://` | Non-HTTP schemes |

### No Redirect Following

All `fetch()` calls use `redirect: "error"`. This prevents:
- Auth header leakage via redirect to attacker-controlled server
- SSRF bypass via HTTP 3xx to private IP

### Request Timeouts

Every outbound request (CMS API, GitHub API, media proxy) has a 30-second `AbortController` timeout.

### Media Size Cap

Files larger than 50 MB are rejected before buffering to prevent memory exhaustion.

## Audit Logging

### What's logged

Every tool call, including:
- Tool name and arguments
- Outcome (success/error)
- Duration in milliseconds
- Timestamp

### What's redacted

Fields matching `/token|password|secret|key|auth|credential|api[-_]?key/i` are replaced with `[redacted length=N]`.

Nested objects are recursively sanitized. Error messages are truncated at 150 characters.

### Protecting the log file

```bash
chmod 600 ~/.cms-mcp/audit.log
```

## Read-Only Mode

For shared Claude instances or exploratory sessions:

```bash
npx cms-mcp --config ./config.json --readonly
```

All create/update/delete/publish tools return a friendly "disabled" message. Safe for read-only MCP integrations.

## Policy Engine as Governance

For teams with multiple agents writing to the same CMS, the policy engine prevents:

- Publishing without required fields (SEO, cover images)
- Content with placeholder text
- Invalid status transitions
- Projects with insufficient tags

See [Policy Engine](./advanced/policy-engine.md) for setup.

## Webhook Security

### HMAC Verification

GitHub webhooks are verified using `X-Hub-Signature-256` with constant-time comparison to prevent timing attacks.

### Payload Size

Bodies larger than 5 MB are rejected at the HTTP level.

### Network Exposure

The webhook server listens on a configurable port. In production:
- Put it behind a reverse proxy (nginx, Caddy)
- Use TLS termination at the proxy
- Restrict inbound to GitHub's IP ranges

## Reporting Vulnerabilities

See [SECURITY.md](../SECURITY.md) in the project root.
