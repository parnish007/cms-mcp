# Migrating from v0.5.x to v1.0.0

v1.0.0 is a significant architectural release. The **default tool model changes**, secrets are handled differently, and several internal APIs are renamed. Most users need only one config change.

---

## Breaking changes at a glance

| Area | v0.5.x | v1.0.0 |
|------|--------|--------|
| Write tools | `mutate_X({ action, data, confirm })` | `create_X`, `update_X`, `delete_X` (separate tools) |
| Schema sampling | 5 records | 20 records + field merging |
| Approval gate `tools` | `["mutate_posts"]` | `["delete_posts", "create_posts"]` |
| Policy `tools` | `["mutate_posts"]` | `["create_posts", "update_posts", "delete_posts"]` |
| `Transaction` class | exported as `Transaction` | renamed `CompensatingTransaction` |
| `runWithTransaction` | exported name | renamed `runWithCompensation` |
| Config: plain-text secrets | held in Config object | tokenized at load time — never plain-text after startup |

---

## 1. Tool name migration

### Option A — Add `legacyMode: true` (zero code changes)

```json
{
  "legacyMode": true
}
```

This registers `mutate_X` exactly as before. Use this if you have saved Claude prompts, custom MCP clients, or policy/approval configs that reference `mutate_X` by name. You can migrate at your own pace.

### Option B — Update tool references (recommended)

Replace `mutate_X` references with the appropriate split tool:

| v0.5 call | v1.0 equivalent |
|-----------|----------------|
| `mutate_posts({ action: "create", data: {...}, confirm: true })` | `create_posts({ ...fields, confirm: true })` |
| `mutate_posts({ action: "update", id: "42", data: {...}, confirm: true })` | `update_posts({ id: "42", ...fields, confirm: true })` |
| `mutate_posts({ action: "delete", id: "42", confirm: true })` | `delete_posts({ id: "42", confirm: true })` |
| `mutate_posts({ action: "preview", data: {...} })` | `create_posts({ ...fields, preview: true })` |

---

## 2. Approval gate config

Update the `tools` list — `mutate_X` no longer exists by default:

```json
// v0.5
{ "approvals": { "tools": ["mutate_posts", "mutate_products"] } }

// v1.0 — gate only destructive operations
{ "approvals": { "tools": ["delete_posts", "delete_products", "create_posts"] } }
```

---

## 3. Policy engine config

Same change — replace `mutate_X` in rule `tools` arrays:

```json
// v0.5
{ "type": "required_fields", "fields": ["seo_title"], "tools": ["mutate_posts"] }

// v1.0
{ "type": "required_fields", "fields": ["seo_title"], "tools": ["create_posts", "update_posts"] }
```

---

## 4. CMSAdapter — field mapping (new in v1.0)

If your CMS uses non-standard field names, you previously had to rename them in Claude prompts or custom code. Now use `adapters`:

```json
{
  "adapters": {
    "posts": {
      "updateMethod": "PUT",
      "fieldMap": {
        "title":  "post_heading_1",
        "body":   "post_content_markdown"
      }
    }
  }
}
```

- `fieldMap` — internal names Claude sees → external names your API expects. Responses are reverse-mapped automatically.
- `updateMethod` — `"PATCH"` (default) or `"PUT"`. This replaces the previous workaround of wrapping PATCH-incompatible APIs.

---

## 5. SecretManager (automatic — no action required)

Secrets in your `cms-mcp.config.json` (token values, passwords, API keys) are now tokenized immediately after `loadConfig()`. The `Config` object your code receives never contains plain-text credentials after startup.

**If you access `config.auth.token` directly in custom plugins**, use `buildAuthHeaders(config)` instead — it resolves the token automatically:

```typescript
// ❌ v0.5 — accesses plain-text token directly
const headers = { Authorization: `Bearer ${config.auth.token}` };

// ✅ v1.0 — SecretManager resolves at call time
import { buildAuthHeaders } from "./lib/config.js";
const headers = buildAuthHeaders(config);
```

---

## 6. CompensatingTransaction rename

The `Transaction` class and `runWithTransaction` helper are renamed:

```typescript
// v0.5
import { Transaction, runWithTransaction } from "./lib/transaction.js";

// v1.0 (preferred)
import { CompensatingTransaction, runWithCompensation } from "./lib/transaction.js";

// v0.5 names still work — backward-compat aliases are exported
import { Transaction, runWithTransaction } from "./lib/transaction.js"; // ✅ still valid
```

**New:** `CriticalInconsistencyError` is thrown when rollback itself fails. Catch it to access `orphanedIds` — the IDs of records that were created but could not be rolled back:

```typescript
import { runWithCompensation, CriticalInconsistencyError } from "./lib/transaction.js";

try {
  await runWithCompensation(async (tx) => { /* ... */ });
} catch (err) {
  if (err instanceof CriticalInconsistencyError) {
    console.error("Orphaned records — manual cleanup needed:", err.orphanedIds);
  }
}
```

---

## 7. Schema sampling increase (automatic)

The sampler now fetches 20 records (up from 5) and merges fields across all records. Fields absent in any record are marked `inconsistent: true` and always use `.optional()` in Zod shapes. This means:

- Fewer "missing required field" validation errors on optional fields
- Better schema coverage for APIs with heterogeneous records
- **Slightly slower** first-run schema inference on endpoints with many records

No config change needed — the behavior is automatic.

---

## 8. SSRF v2 — port whitelist (opt-in)

By default, only ports 80 and 443 are allowed in outbound API and media URLs. If your API runs on a non-standard port (e.g. `localhost:3000` in dev, `api.internal:8080` in prod), add it:

```json
{ "allowedPorts": [3000, 8080] }
```

---

## Checklist

- [ ] Choose `legacyMode: true` or update tool names in approval/policy configs
- [ ] Update `approvals.tools` — replace `mutate_X` with `create_X`/`update_X`/`delete_X`
- [ ] Update policy rule `tools` arrays
- [ ] If using custom plugins that access `config.auth.token` directly — switch to `buildAuthHeaders(config)`
- [ ] If catching `Transaction` errors — add handling for `CriticalInconsistencyError`
- [ ] If API runs on a non-standard port — add `allowedPorts` to config
- [ ] If using `adapters.X.fieldMap` — remove any manual field renaming from prompts or code
