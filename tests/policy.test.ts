// tests/policy.test.ts
// Policy engine unit tests — validate all 10 rule types.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPolicies, type PolicyFile } from "../src/lib/policy.js";

const basePolicies: PolicyFile = {
  version: "1",
  rules: [],
};

describe("Policy Engine", () => {

  // ── required_fields ───────────────────────────────────────────────────────

  describe("required_fields", () => {
    const policies: PolicyFile = {
      ...basePolicies,
      rules: [{
        type: "required_fields",
        fields: ["cover_image", "seo_title"],
        tools: ["publish_blog"],
      }],
    };

    it("passes when all required fields are present", () => {
      const result = runPolicies(policies, "publish_blog", {
        cover_image: "https://example.com/img.jpg",
        seo_title: "My Post",
      });
      assert.equal(result.allowed, true);
      assert.equal(result.violations.length, 0);
    });

    it("fails when required fields are missing", () => {
      const result = runPolicies(policies, "publish_blog", {
        title: "My Post",
      });
      assert.equal(result.allowed, false);
      assert.equal(result.violations.length, 1);
      assert.ok(result.violations[0].message.includes("cover_image"));
      assert.ok(result.violations[0].message.includes("seo_title"));
    });

    it("skips rule for non-matching tools", () => {
      const result = runPolicies(policies, "create_blog", { title: "No images needed" });
      assert.equal(result.allowed, true);
    });

    it("fails for empty string values", () => {
      const result = runPolicies(policies, "publish_blog", {
        cover_image: "",
        seo_title: "  ",
      });
      assert.equal(result.allowed, false);
    });
  });

  // ── min_tags ──────────────────────────────────────────────────────────────

  describe("min_tags", () => {
    const policies: PolicyFile = {
      ...basePolicies,
      rules: [{ type: "min_tags", min: 3, field: "tags" }],
    };

    it("passes with enough tags", () => {
      const result = runPolicies(policies, "create_project", {
        tags: ["react", "next", "typescript"],
      });
      assert.equal(result.allowed, true);
    });

    it("fails with too few tags", () => {
      const result = runPolicies(policies, "create_project", {
        tags: ["react"],
      });
      assert.equal(result.allowed, false);
      assert.ok(result.violations[0].message.includes("3"));
    });

    it("fails with no tags field", () => {
      const result = runPolicies(policies, "create_project", { title: "No tags" });
      assert.equal(result.allowed, false);
    });
  });

  // ── max_length ────────────────────────────────────────────────────────────

  describe("max_length", () => {
    const policies: PolicyFile = {
      ...basePolicies,
      rules: [{ type: "max_length", field: "seo_title", max: 70 }],
    };

    it("passes under the limit", () => {
      const result = runPolicies(policies, "create_blog", {
        seo_title: "Short title",
      });
      assert.equal(result.allowed, true);
    });

    it("fails over the limit", () => {
      const result = runPolicies(policies, "create_blog", {
        seo_title: "A".repeat(71),
      });
      assert.equal(result.allowed, false);
    });
  });

  // ── forbidden_words ───────────────────────────────────────────────────────

  describe("forbidden_words", () => {
    const policies: PolicyFile = {
      ...basePolicies,
      rules: [{
        type: "forbidden_words",
        field: "body",
        words: ["lorem ipsum", "TODO", "FIXME"],
      }],
    };

    it("passes with clean content", () => {
      const result = runPolicies(policies, "create_blog", {
        body: "This is a real blog post about Next.js.",
      });
      assert.equal(result.allowed, true);
    });

    it("fails with placeholder text (case-insensitive)", () => {
      const result = runPolicies(policies, "create_blog", {
        body: "Lorem Ipsum dolor sit amet...",
      });
      assert.equal(result.allowed, false);
      assert.ok(result.violations[0].message.includes("lorem ipsum"));
    });

    it("catches TODO markers", () => {
      const result = runPolicies(policies, "create_blog", {
        body: "Great post. TODO: add conclusion.",
      });
      assert.equal(result.allowed, false);
    });
  });

  // ── seo_required ──────────────────────────────────────────────────────────

  describe("seo_required", () => {
    const policies: PolicyFile = {
      ...basePolicies,
      rules: [{
        type: "seo_required",
        tools: ["publish_blog"],
        fields: ["seo_title", "seo_description"],
      }],
    };

    it("passes with all SEO fields", () => {
      const result = runPolicies(policies, "publish_blog", {
        seo_title: "My Post",
        seo_description: "A great post",
      });
      assert.equal(result.allowed, true);
    });

    it("fails without SEO fields on publish", () => {
      const result = runPolicies(policies, "publish_blog", { title: "oops" });
      assert.equal(result.allowed, false);
    });
  });

  // ── regex_match ───────────────────────────────────────────────────────────

  describe("regex_match", () => {
    it("validates slug format", () => {
      const policies: PolicyFile = {
        ...basePolicies,
        rules: [{
          type: "regex_match",
          field: "slug",
          pattern: "^[a-z0-9-]+$",
        }],
      };

      assert.equal(runPolicies(policies, "create_project", { slug: "my-project" }).allowed, true);
      assert.equal(runPolicies(policies, "create_project", { slug: "BAD SLUG!" }).allowed, false);
    });

    it("inverted match blocks patterns", () => {
      const policies: PolicyFile = {
        ...basePolicies,
        rules: [{
          type: "regex_match",
          field: "title",
          pattern: "test|demo|draft",
          invert: true,
          message: "Title must not contain 'test', 'demo', or 'draft'",
        }],
      };

      assert.equal(runPolicies(policies, "publish_project", { title: "Real Project" }).allowed, true);
      assert.equal(runPolicies(policies, "publish_project", { title: "test project" }).allowed, false);
    });
  });

  // ── status_transition ─────────────────────────────────────────────────────

  describe("status_transition", () => {
    const policies: PolicyFile = {
      ...basePolicies,
      rules: [{
        type: "status_transition",
        allowedTransitions: [
          ["draft", "published"],
          ["published", "draft"],
          ["draft", "archived"],
        ],
      }],
    };

    it("allows valid transitions", () => {
      const result = runPolicies(policies, "update_blog", { status: "published" }, { status: "draft" });
      assert.equal(result.allowed, true);
    });

    it("blocks invalid transitions", () => {
      const result = runPolicies(policies, "update_blog", { status: "archived" }, { status: "published" });
      assert.equal(result.allowed, false);
      assert.ok(result.violations[0].message.includes("not allowed"));
    });
  });

  // ── multiple rules ────────────────────────────────────────────────────────

  describe("multiple rules combined", () => {
    const policies: PolicyFile = {
      ...basePolicies,
      rules: [
        { type: "required_fields", fields: ["title"], tools: ["create_blog"] },
        { type: "min_tags", min: 2, field: "tags", tools: ["create_blog"] },
        { type: "forbidden_words", field: "body", words: ["lorem ipsum"] },
      ],
    };

    it("collects all violations at once", () => {
      const result = runPolicies(policies, "create_blog", {
        body: "Lorem Ipsum placeholder text",
        tags: ["one"],
      });
      assert.equal(result.allowed, false);
      assert.equal(result.violations.length, 3);
    });
  });
});
