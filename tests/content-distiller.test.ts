// tests/content-distiller.test.ts
// Content distillation tests — HTML→MD, field stripping, metadata headers.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  htmlToMarkdown,
  stripJunkFields,
  buildMetadataHeader,
  distill,
} from "../src/lib/content-distiller.js";

describe("htmlToMarkdown", () => {

  it("converts headings", () => {
    assert.equal(htmlToMarkdown("<h1>Title</h1>").trim(), "# Title");
    assert.equal(htmlToMarkdown("<h3>Section</h3>").trim(), "### Section");
  });

  it("converts bold and italic", () => {
    assert.ok(htmlToMarkdown("<strong>bold</strong>").includes("**bold**"));
    assert.ok(htmlToMarkdown("<em>italic</em>").includes("*italic*"));
  });

  it("converts links", () => {
    const result = htmlToMarkdown('<a href="https://example.com">click</a>');
    assert.ok(result.includes("[click](https://example.com)"));
  });

  it("converts unordered lists", () => {
    const html = "<ul><li>One</li><li>Two</li></ul>";
    const md = htmlToMarkdown(html);
    assert.ok(md.includes("- One"));
    assert.ok(md.includes("- Two"));
  });

  it("converts code blocks", () => {
    const html = "<pre><code>const x = 1;</code></pre>";
    const md = htmlToMarkdown(html);
    assert.ok(md.includes("```"));
    assert.ok(md.includes("const x = 1;"));
  });

  it("converts inline code", () => {
    const md = htmlToMarkdown("Use <code>npm install</code> to install.");
    assert.ok(md.includes("`npm install`"));
  });

  it("strips script and style tags entirely", () => {
    const html = '<p>Hello</p><script>alert("xss")</script><style>.x{}</style>';
    const md = htmlToMarkdown(html);
    assert.ok(!md.includes("script"));
    assert.ok(!md.includes("alert"));
    assert.ok(!md.includes("style"));
    assert.ok(md.includes("Hello"));
  });

  it("decodes HTML entities", () => {
    const md = htmlToMarkdown("&amp; &lt;tag&gt; &quot;quoted&quot;");
    assert.ok(md.includes("&"));
    assert.ok(md.includes("<tag>"));
    assert.ok(md.includes('"quoted"'));
  });

  it("converts blockquotes", () => {
    const md = htmlToMarkdown("<blockquote>Quoted text</blockquote>");
    assert.ok(md.includes("> Quoted text"));
  });

  it("handles nested HTML gracefully", () => {
    const html = "<div><p>Paragraph with <strong>bold <em>and italic</em></strong></p></div>";
    const md = htmlToMarkdown(html);
    assert.ok(md.includes("**bold *and italic***"));
  });

  it("passes through plain text unchanged", () => {
    const text = "Just a plain string with no HTML.";
    assert.equal(htmlToMarkdown(text), text);
  });
});

describe("stripJunkFields", () => {

  it("removes internal metadata fields", () => {
    const data = {
      id: "123",
      title: "My Project",
      _id: "mongo_id",
      __v: 3,
      __typename: "Project",
      createdAt: "2025-01-01",
      updatedAt: "2025-06-01",
      cssClass: "project-card",
      permissions: ["read", "write"],
    };

    const cleaned = stripJunkFields(data);
    assert.equal(cleaned["id"], "123");
    assert.equal(cleaned["title"], "My Project");
    assert.equal(cleaned["_id"], undefined);
    assert.equal(cleaned["__v"], undefined);
    assert.equal(cleaned["__typename"], undefined);
    assert.equal(cleaned["createdAt"], undefined);
    assert.equal(cleaned["cssClass"], undefined);
    assert.equal(cleaned["permissions"], undefined);
  });

  it("recursively strips nested objects", () => {
    const data = {
      title: "Post",
      author: {
        name: "John",
        _id: "author_123",
        permissions: ["admin"],
      },
    };

    const cleaned = stripJunkFields(data);
    const author = cleaned["author"] as Record<string, unknown>;
    assert.equal(author["name"], "John");
    assert.equal(author["_id"], undefined);
    assert.equal(author["permissions"], undefined);
  });

  it("preserves arrays and non-junk fields", () => {
    const data = {
      title: "Post",
      tags: ["react", "nextjs"],
      tech_stack: ["Node.js"],
      status: "published",
    };

    const cleaned = stripJunkFields(data);
    assert.deepEqual(cleaned["tags"], ["react", "nextjs"]);
    assert.equal(cleaned["status"], "published");
  });
});

describe("buildMetadataHeader", () => {
  it("builds a formatted header", () => {
    const header = buildMetadataHeader({
      source: "CMS",
      id: "42",
      lastUpdated: "2025-01-15",
      status: "published",
    });
    assert.ok(header.includes("Source: CMS"));
    assert.ok(header.includes("ID: 42"));
    assert.ok(header.includes("Last Updated: 2025-01-15"));
    assert.ok(header.includes("Status: published"));
  });

  it("returns empty string for no metadata", () => {
    assert.equal(buildMetadataHeader({}), "");
  });
});

describe("distill", () => {
  it("converts HTML body and prepends metadata", () => {
    const result = distill(
      {
        id: "42",
        title: "Test Post",
        body: "<h2>Hello</h2><p>This is a <strong>test</strong>.</p>",
        _id: "mongo_internal",
        cssClass: "post-card",
        status: "published",
      },
      { source: "CMS", id: "42", status: "published" },
    );

    assert.ok(result.full.includes("[Source: CMS"));
    assert.ok(result.full.includes("# Test Post"));
    assert.ok(result.body.includes("## Hello"));
    assert.ok(result.body.includes("**test**"));
    assert.equal(result.data["_id"], undefined);
    assert.equal(result.data["cssClass"], undefined);
  });

  it("handles empty content gracefully", () => {
    const result = distill({ title: "Empty" }, {});
    assert.ok(result.body.includes("# Empty"));
  });
});
