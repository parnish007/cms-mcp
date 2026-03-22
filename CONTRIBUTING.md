# Contributing

Thanks for your interest in contributing to cms-mcp.

## What to contribute

- **Bug fixes** — always welcome, open a PR directly
- **New tool groups** — open an issue first to discuss before building
- **New CMS adapters / examples** — PRs welcome with a working config example
- **Security findings** — see [SECURITY.md](./SECURITY.md) for the responsible disclosure process

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/cms-mcp
cd cms-mcp
npm install
npm run build   # TypeScript compile
```

## Project structure

```
src/
  index.ts          ← Entry point, CLI flag parsing, transport setup
  lib/
    config.ts       ← Config loader + Zod validation
    api-client.ts   ← Generic REST client (timeouts, auth, error handling)
    audit.ts        ← Append-only audit log with secret redaction
    transaction.ts  ← Atomic write wrapper with rollback support
    media-proxy.ts  ← URL → buffer → multipart upload (SSRF-protected)
    diff.ts         ← Field-level diff preview engine
  tools/
    projects.ts     ← Project CRUD tools
    blogs.ts        ← Blog CRUD tools
    media.ts        ← Media upload/list/delete tools
    github.ts       ← GitHub repo scanner + sync tools
```

## Adding a new tool group

1. Create `src/tools/your-feature.ts`
2. Export a `registerYourFeatureTools(server, config, audit)` function
3. Add your endpoint to the `Config` type in `src/lib/config.ts`
4. Call your register function in `src/index.ts`
5. Add the endpoint to the example config in `examples/`

### Tool conventions

- **All reads**: wrap in `withAudit(audit, "tool_name", args, async () => {...})`
- **All writes**: check `config.readOnly` first, then wrap in `runWithTransaction`
- **Destructive tools**: require `confirm: z.literal(true)` in the schema
- **Preview tools**: don't require confirm, should be safe to call freely
- **List normalization**: use the `normalizeList()` pattern from existing tools
- **Error messages**: don't include raw API response bodies or internal URLs

## TypeScript

Strict mode is on. No `any` escape hatches in new code without a comment explaining why.

```bash
npm run lint    # tsc --noEmit, zero warnings
npm run build   # full compile check
```

## Commit style

```
feat: add Directus adapter example
fix: handle 204 response in patch correctly
security: block data: URLs in media proxy
docs: add PocketBase config example
```

## Pull request checklist

- [ ] `npm run build` passes with zero errors
- [ ] New tools follow the audit/transaction/confirm conventions above
- [ ] Sensitive data is not logged anywhere in the new code
- [ ] If adding a new URL fetch, SSRF protection is applied
- [ ] README updated if new tools or config fields are added
