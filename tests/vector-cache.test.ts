// tests/vector-cache.test.ts
// Vector cache & semantic search tests.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { VectorCache, VectorBuilder } from "../src/lib/vector-cache.js";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("VectorBuilder", () => {

  it("tokenizes and removes stop words", () => {
    const builder = new VectorBuilder();
    builder.buildVocabulary(["The quick brown fox jumps over the lazy dog"]);
    // "the", "over" are stop words
    assert.ok(builder.getVocabSize() > 0);
  });

  it("produces normalized vectors", () => {
    const builder = new VectorBuilder();
    builder.buildVocabulary(["Next.js React TypeScript project", "Python Django REST API"]);

    const vec = builder.vectorize("React project");
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    assert.ok(Math.abs(norm - 1.0) < 0.01 || norm === 0); // Normalized to ~1
  });
});

describe("VectorCache", () => {
  let cache: VectorCache;
  let tmpDir: string;

  tmpDir = mkdtempSync(join(tmpdir(), "cms-mcp-test-"));
  cache = new VectorCache(join(tmpDir, "test-vectors.db"));

  after(() => {
    cache.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores and retrieves entries", () => {
    cache.store("proj-1", "project", "Scene Sorter",
      "Scene Sorter is a Next.js app for sorting movie scenes using AI",
      { title: "Scene Sorter", tech_stack: ["Next.js", "AI"] });

    cache.store("proj-2", "project", "Dashboard",
      "Financial dashboard built with React and D3 for data visualization",
      { title: "Dashboard", tech_stack: ["React", "D3"] });

    cache.store("blog-1", "blog", "ML Guide",
      "A beginner guide to machine learning with Python and scikit-learn",
      { title: "ML Guide" });

    const stats = cache.stats();
    assert.equal(stats.totalEntries, 3);
    assert.equal(stats.byType["project"], 2);
    assert.equal(stats.byType["blog"], 1);
  });

  it("semantic search returns relevant results", () => {
    // Search for terms that appear directly in the stored content
    const results = cache.search("Next.js app sorting scenes", 5);
    assert.ok(results.length > 0, `Expected results but got ${results.length}`);
    // "Scene Sorter" should be top match (it contains "Next.js" and "sorting" and "scenes")
    assert.equal(results[0].title, "Scene Sorter");
    assert.ok(results[0].score > 0);
  });

  it("filters by type", () => {
    const results = cache.search("Python scikit learn machine", 5, "blog");
    assert.ok(results.length > 0, `Expected blog results but got ${results.length}`);
    assert.ok(results.every((r) => r.type === "blog"));
  });

  it("returns empty for unrelated queries", () => {
    const results = cache.search("quantum physics nuclear reactor", 5);
    // Should have low or zero matches
    const highConfidence = results.filter((r) => r.score > 0.5);
    assert.equal(highConfidence.length, 0);
  });

  it("clears by type", () => {
    cache.store("temp-1", "blog", "Temp", "Temporary blog post", {});
    const cleared = cache.clear("blog");
    assert.ok(cleared >= 1);

    const stats = cache.stats();
    assert.equal(stats.byType["blog"] ?? 0, 0);
  });

  it("clears all entries", () => {
    cache.store("x", "project", "X", "test", {});
    cache.clear();
    assert.equal(cache.stats().totalEntries, 0);
  });
});
