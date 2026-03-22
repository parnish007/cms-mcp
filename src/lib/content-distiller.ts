// src/lib/content-distiller.ts
// Content Distillation — the "LLM-Friendly" layer.
// Cleans CMS responses: strips junk fields, converts HTML→Markdown,
// prepends metadata headers so Claude can cite sources accurately.

// ─── Metadata header ─────────────────────────────────────────────────────────

export interface ContentMetadata {
  source?: string;
  lastUpdated?: string;
  author?: string;
  id?: string;
  status?: string;
  relevanceHint?: string;
}

export function buildMetadataHeader(meta: ContentMetadata): string {
  const parts: string[] = [];
  if (meta.source) parts.push(`Source: ${meta.source}`);
  if (meta.id) parts.push(`ID: ${meta.id}`);
  if (meta.lastUpdated) parts.push(`Last Updated: ${meta.lastUpdated}`);
  if (meta.author) parts.push(`Author: ${meta.author}`);
  if (meta.status) parts.push(`Status: ${meta.status}`);
  if (meta.relevanceHint) parts.push(`Relevance: ${meta.relevanceHint}`);

  return parts.length > 0 ? `[${parts.join(" | ")}]` : "";
}

// ─── HTML → Markdown conversion ──────────────────────────────────────────────
// Lightweight, zero-dependency conversion for common CMS HTML patterns.
// Not a full parser — handles the 90% case (headings, paragraphs, lists,
// links, bold, italic, code, images, blockquotes, tables).

export function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove scripts, styles, comments
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");

  // Block elements first (order matters)
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n");
  md = md.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n");

  // Blockquotes
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return "\n" + content.trim().split("\n").map((l: string) => `> ${l.trim()}`).join("\n") + "\n";
  });

  // Code blocks
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");

  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    return "\n" + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n") + "\n";
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    let i = 0;
    return "\n" + content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => `${++i}. `) + "\n";
  });

  // Tables
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, content) => {
    const rows: string[] = [];
    content.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_: string, row: string) => {
      const cells: string[] = [];
      row.replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, (_: string, cell: string) => {
        cells.push(cell.trim());
        return "";
      });
      rows.push(`| ${cells.join(" | ")} |`);
      return "";
    });
    if (rows.length > 0) {
      // Insert separator after header row
      const sep = `| ${rows[0].split("|").slice(1, -1).map(() => "---").join(" | ")} |`;
      rows.splice(1, 0, sep);
    }
    return "\n" + rows.join("\n") + "\n";
  });

  // Paragraphs and line breaks
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
  md = md.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "\n$1\n");

  // Inline elements
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  // Horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, "\n---\n");

  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Clean up whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  return md.trim();
}

// ─── JSON field stripping ─────────────────────────────────────────────────────
// CMS responses are bloated with internal metadata, CSS classes, IDs the
// LLM doesn't need. Strip them for cleaner context.

const JUNK_FIELDS = new Set([
  // Internal IDs / metadata
  "_id", "__v", "__typename", "_rev", "_type", "_createdAt", "_updatedAt",
  // Timestamps the LLM rarely needs
  "createdAt", "created_at", "updatedAt", "updated_at",
  // CMS-specific noise
  "contentType", "content_type", "sys", "metadata",
  "locale", "localeCode", "localizations",
  "version", "revision", "publishedVersion",
  // UI-specific fields
  "cssClass", "css_class", "className", "style", "styles",
  "template", "layout", "theme", "widget",
  // Permission / auth fields
  "permissions", "roles", "acl", "owner", "ownerId",
  "createdBy", "created_by", "updatedBy", "updated_by",
]);

export function stripJunkFields(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (JUNK_FIELDS.has(key)) continue;

    // Recursively clean nested objects
    if (value && typeof value === "object" && !Array.isArray(value)) {
      cleaned[key] = stripJunkFields(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

// ─── Full distillation pipeline ───────────────────────────────────────────────

export interface DistilledContent {
  header: string;
  body: string;         // Cleaned markdown
  data: Record<string, unknown>; // Stripped JSON fields
  full: string;         // Header + body combined
}

export function distill(
  rawData: Record<string, unknown>,
  meta: ContentMetadata,
  htmlFields: string[] = ["body", "content", "description"],
): DistilledContent {
  const cleaned = stripJunkFields(rawData);
  const header = buildMetadataHeader(meta);

  // Convert any HTML fields to Markdown
  for (const field of htmlFields) {
    const val = cleaned[field];
    if (typeof val === "string" && looksLikeHtml(val)) {
      cleaned[field] = htmlToMarkdown(val);
    }
  }

  // Build a readable body from the important fields
  const bodyParts: string[] = [];
  const title = cleaned["title"] ?? cleaned["name"];
  if (title) bodyParts.push(`# ${title}`);

  const summary = cleaned["summary"] ?? cleaned["excerpt"];
  if (summary) bodyParts.push(`*${summary}*`);

  const bodyText = cleaned["body"] ?? cleaned["content"] ?? cleaned["description"];
  if (typeof bodyText === "string") bodyParts.push(bodyText);

  const body = bodyParts.join("\n\n");
  const full = header ? `${header}\n\n${body}` : body;

  return { header, body, data: cleaned, full };
}

function looksLikeHtml(text: string): boolean {
  return /<[a-z][^>]*>/i.test(text);
}
