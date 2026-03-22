# Webhook Mode

cms-mcp can listen for GitHub webhook events and automatically create "shadow drafts" in your CMS when you push code.

## How it works

1. You push code to your repo's default branch
2. GitHub sends a POST to cms-mcp's webhook endpoint
3. cms-mcp verifies the HMAC-SHA256 signature
4. It creates a draft project entry with the repo's metadata and recent commits
5. Notification appears in Claude's sidebar: *"I saw your push to main. Want to publish?"*

## Setup

### 1. Add webhook config to `cms-mcp.config.json`

```json
{
  "baseUrl": "https://yoursite.com/api",
  "auth": { "type": "bearer", "token": "env:CMS_API_TOKEN" },
  "endpoints": { "projects": "/projects" },
  "github": {
    "token": "env:GITHUB_TOKEN",
    "webhookSecret": "env:GITHUB_WEBHOOK_SECRET"
  },
  "webhook": {
    "port": 3001,
    "secret": "env:GITHUB_WEBHOOK_SECRET",
    "path": "/webhook"
  }
}
```

### 2. Start cms-mcp with the `--webhook` flag

```bash
npx cms-mcp --config ./cms-mcp.config.json --webhook
```

You'll see:
```
[cms-mcp] Webhook listener: http://localhost:3001/webhook
[cms-mcp] GitHub → Settings → Webhooks → Add webhook
```

### 3. Configure the webhook in GitHub

Go to your repo → **Settings** → **Webhooks** → **Add webhook**:

| Field | Value |
|-------|-------|
| Payload URL | `http://YOUR_PUBLIC_IP:3001/webhook` |
| Content type | `application/json` |
| Secret | Same value as `GITHUB_WEBHOOK_SECRET` |
| Events | Just the **push** event |

### 4. Expose your webhook (development)

For local development, use [ngrok](https://ngrok.com) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/):

```bash
ngrok http 3001
# Copy the https://xxxx.ngrok.io URL to GitHub webhook settings
```

## Security

### HMAC-SHA256 Verification

Every incoming webhook is verified against the `X-Hub-Signature-256` header using constant-time comparison. Requests with invalid or missing signatures are rejected with `401`.

### Payload Size Limit

Bodies larger than 5 MB are rejected to prevent memory exhaustion.

### Read-Only Mode

If cms-mcp is running with `--readonly`, shadow drafts are not created, but events are still logged.

## Shadow Draft Format

When a push to the default branch is detected, cms-mcp creates a project entry:

```json
{
  "title": "repo-name",
  "slug": "repo-name",
  "summary": "Repo description from GitHub",
  "description": "## repo-name\n\n### Recent Changes\n- commit 1\n- commit 2\n...",
  "repo_url": "https://github.com/owner/repo",
  "live_url": "homepage from GitHub settings",
  "tags": ["topic1", "topic2"],
  "status": "draft",
  "_shadow": true,
  "_webhook_generated": true
}
```

The `_shadow` and `_webhook_generated` flags let you identify auto-generated entries.

## Health Check

```bash
curl http://localhost:3001/health
# {"status":"ok","server":"cms-mcp-webhook"}
```

## Docker Compose

```yaml
services:
  cms-mcp:
    build: .
    ports:
      - "3001:3001"
    command: ["node", "build/index.js", "--webhook"]
    environment:
      - CMS_API_TOKEN=${CMS_API_TOKEN}
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET}
```
