# Content Distillation

CMS API responses are often bloated with internal metadata, CSS classes, permissions, and nested IDs that waste Claude's context window. The content distiller cleans this up automatically.

## What it does

1. **Strips junk fields** — removes `_id`, `__v`, `__typename`, `cssClass`, `permissions`, `createdBy`, etc.
2. **Converts HTML → Markdown** — headings, lists, bold, italic, code blocks, links, images, tables
3. **Prepends metadata headers** — `[Source: CMS | ID: 42 | Status: published | Last Updated: 2025-01-15]`

## When it's used

- **MCP Resources** — when Claude reads `cms://projects/42` or `cms://blogs/my-post`, the response goes through the distiller before reaching Claude
- **Vector cache indexing** — content is cleaned before vectorization for better search quality

## Metadata Headers

Every distilled response gets a metadata header:

```
[Source: CMS | ID: 42 | Last Updated: 2025-01-15 | Author: Trilochan | Status: published]

# My Project Title

*A real-time analytics dashboard for financial data*

Built with React, D3.js, and FastAPI...
```

This helps Claude cite sources accurately and understand content freshness.

## HTML → Markdown

The built-in converter handles:

| HTML | Markdown |
|------|----------|
| `<h1>` – `<h6>` | `#` – `######` |
| `<strong>`, `<b>` | `**bold**` |
| `<em>`, `<i>` | `*italic*` |
| `<a href="...">` | `[text](url)` |
| `<code>` | `` `inline` `` |
| `<pre><code>` | ` ```code block``` ` |
| `<ul><li>` | `- item` |
| `<ol><li>` | `1. item` |
| `<blockquote>` | `> quoted` |
| `<img>` | `![alt](src)` |
| `<table>` | Markdown table |
| `<script>`, `<style>` | Stripped entirely |
| HTML entities | Decoded (`&amp;` → `&`) |

## Stripped Fields

The following fields are automatically removed from API responses:

```
_id, __v, __typename, _rev, _type, _createdAt, _updatedAt,
createdAt, created_at, updatedAt, updated_at,
contentType, content_type, sys, metadata,
locale, localeCode, localizations,
version, revision, publishedVersion,
cssClass, css_class, className, style, styles,
template, layout, theme, widget,
permissions, roles, acl, owner, ownerId,
createdBy, created_by, updatedBy, updated_by
```

Important fields like `id`, `title`, `body`, `status`, `tags`, `slug`, `tech_stack` are preserved.
