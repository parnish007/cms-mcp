# Policy Engine

The policy engine is a governance layer that validates content before any write operation. It blocks actions that violate your team's rules — even when an LLM is doing the writing.

## Why

When multiple agents or team members can write to your CMS through Claude, you need guardrails. Policies prevent:

- Publishing posts without SEO fields
- Submitting content with placeholder text like "Lorem Ipsum"
- Projects with fewer than the required number of tags
- Accidental status transitions (e.g., draft → archived)

## How auto-enforcement works

Starting in v1.0.0, policies are **automatically enforced** on every write call — no manual `check_policies` step needed.

**Enforcement order on every `create_X`, `update_X`, `delete_X` (or legacy `mutate_X`):**

1. Zod input validation (tool schema)
2. ✅ **Policy engine** — if any rule is violated, the write is blocked and violations are returned
3. Diff preview shown (if requested)
4. Approval gate (if configured)
5. API call

If policies are violated, Claude receives the full violation list and can ask the user for the missing fields before retrying.

## Setup

**1. Generate an example policy file:**

Ask Claude: `"Initialize a policies file for me"`

Or use the tool directly:
```
Tool: init_policies
Args: { "output_path": "./cms-mcp.policies.json", "confirm": true }
```

**2. Add the policy path to your config:**

```json
{
  "baseUrl": "https://yoursite.com/api",
  "auth": { "type": "bearer", "token": "env:CMS_API_TOKEN" },
  "endpoints": { "projects": "/projects", "posts": "/posts" },
  "policies": "./cms-mcp.policies.json"
}
```

**3. Restart cms-mcp.** Policies are loaded at startup.

## Policy File Format

```json
{
  "version": "1",
  "description": "Content quality rules for the portfolio CMS",
  "rules": [
    {
      "type": "required_fields",
      "tools": ["update_posts", "update_projects"],
      "fields": ["cover_image", "seo_title", "seo_description"],
      "message": "Cover image and SEO fields are required before publishing"
    },
    {
      "type": "min_tags",
      "tools": ["create_projects", "update_projects"],
      "min": 3,
      "field": "tags",
      "message": "Projects must have at least 3 tags for discoverability"
    },
    {
      "type": "forbidden_words",
      "tools": ["create_posts", "update_posts", "create_projects", "update_projects"],
      "field": "body",
      "words": ["lorem ipsum", "TODO", "FIXME", "placeholder"],
      "message": "Content contains placeholder text — replace before saving"
    },
    {
      "type": "max_length",
      "field": "seo_title",
      "max": 70
    },
    {
      "type": "max_length",
      "field": "seo_description",
      "max": 160
    },
    {
      "type": "seo_required",
      "tools": ["update_posts", "update_projects"],
      "fields": ["seo_title", "seo_description"]
    },
    {
      "type": "regex_match",
      "field": "slug",
      "pattern": "^[a-z0-9][a-z0-9-]*[a-z0-9]$",
      "message": "Slug must be lowercase, hyphenated, and start/end with alphanumeric"
    },
    {
      "type": "regex_match",
      "field": "title",
      "pattern": "test|demo|draft",
      "invert": true,
      "tools": ["update_posts", "update_projects"],
      "message": "Title must not contain 'test', 'demo', or 'draft' when publishing"
    },
    {
      "type": "status_transition",
      "allowedTransitions": [
        ["draft", "published"],
        ["published", "draft"],
        ["draft", "archived"]
      ],
      "message": "This status transition is not allowed by policy"
    }
  ]
}
```

## Rule Types Reference

| Type | Description | Key fields |
|------|-------------|------------|
| `required_fields` | Block if specified fields are empty/missing | `fields: string[]` |
| `min_tags` | Block if tag count is below minimum | `min: number`, `field: string` |
| `max_tags` | Block if tag count exceeds maximum | `max: number`, `field: string` |
| `max_length` | Block if field exceeds character limit | `field: string`, `max: number` |
| `min_length` | Block if field is shorter than minimum | `field: string`, `min: number` |
| `forbidden_words` | Block if field contains banned strings | `field: string`, `words: string[]` |
| `require_cover_image` | Block if cover image is missing | `field: string` (default: `cover_image`) |
| `seo_required` | Block if SEO fields are missing | `fields: string[]` |
| `regex_match` | Block if field doesn't match regex | `field`, `pattern`, `invert` |
| `status_transition` | Block invalid status changes | `allowedTransitions: [from, to][]` |

## Common fields

All rules support:

- **`tools`** — Array of tool names this rule applies to. Omit to apply to all write tools.
- **`message`** — Custom violation message shown to Claude.

## Tool name aliases

The `tools` array accepts both v1.0.0 split-tool names and the v0.5 legacy `mutate_X` name interchangeably. The policy engine resolves them automatically:

| Name in `tools` array | Also matches |
|----------------------|--------------|
| `create_posts` | `mutate_posts` (legacy) |
| `update_posts` | `mutate_posts` (legacy) |
| `mutate_posts` | `create_posts` and `update_posts` |
| `delete_posts` | *(no aliases — delete never inherits mutate rules)* |

This means you can write one set of rules and they work whether users are on v1.0.0 split tools or legacy `mutate_X` mode.

## Field names in policies

Policies always check **internal (Claude-side) field names** — the left-hand side of any `adapters.X.fieldMap` you have configured. The CMSAdapter transformation runs *after* policy enforcement, so you never need to use the external API field names in your policy rules.

## Checking policies manually

`check_policies` is always available (even without `"policies"` configured). Use it to dry-run a payload before committing a write:

```
Tool: check_policies
Args: {
  "tool": "update_posts",
  "data": {
    "title": "My Post",
    "body": "Content here...",
    "tags": ["react"]
  }
}
```

Output:
```
❌ Policy violations (2):
  • [required_fields] Cover image and SEO fields are required before publishing
  • [min_tags] At least 3 tags required (got 1)

Fix the above before this operation can proceed.
```

## How violations look to Claude

When a policy blocks a write, Claude receives a structured violation list:

```
❌ Policy violations (2):
  • [required_fields] Cover image and SEO fields are required before publishing
  • [seo_required] SEO fields required: `seo_title`, `seo_description`

Fix the above before this operation can proceed.
```

Claude will then ask the user for the missing fields and retry the write once they're provided.

## Hot-reload

Ask Claude: `"Reload the policy rules"` — or use the `reload()` method if building custom tooling. No restart required to pick up policy file changes.
