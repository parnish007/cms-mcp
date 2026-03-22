# Policy Engine

The policy engine is a governance layer that validates content before any write operation. It blocks actions that violate your team's rules — even when an LLM is doing the writing.

## Why

When multiple agents or team members can write to your CMS through Claude, you need guardrails. Policies prevent:

- Publishing posts without SEO fields
- Submitting content with placeholder text like "Lorem Ipsum"
- Projects with fewer than the required number of tags
- Accidental status transitions (e.g., draft → archived)

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
  "endpoints": { "projects": "/projects", "blogs": "/blogs" },
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
      "tools": ["publish_blog", "publish_project"],
      "fields": ["cover_image", "seo_title", "seo_description"],
      "message": "Cover image and SEO fields are required before publishing"
    },
    {
      "type": "min_tags",
      "tools": ["create_project", "publish_project"],
      "min": 3,
      "field": "tags",
      "message": "Projects must have at least 3 tags for discoverability"
    },
    {
      "type": "forbidden_words",
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
      "tools": ["publish_blog", "publish_project"],
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
      "tools": ["publish_blog", "publish_project"],
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

## Checking policies manually

```
Tool: check_policies
Args: {
  "tool": "publish_blog",
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

When a policy blocks a write, Claude sees a clear error with all violations listed. It can then ask the user for the missing fields before retrying.
