// tests/openapi.test.ts
// OpenAPI discovery logic tests (parsing only — no live HTTP).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDiscoveryResult, type OpenApiDiscoveryResult } from "../src/lib/openapi.js";

describe("formatDiscoveryResult", () => {

  it("formats a discovery result with resources", () => {
    const result: OpenApiDiscoveryResult = {
      specUrl: "https://example.com/openapi.json",
      title: "My CMS API",
      version: "1.0.0",
      description: "A CMS API for portfolio sites",
      endpoints: [
        { path: "/projects", methods: ["GET", "POST"], summary: "List or create projects" },
        { path: "/projects/{id}", methods: ["GET", "PATCH", "DELETE"] },
        { path: "/blogs", methods: ["GET", "POST"] },
        { path: "/blogs/{id}", methods: ["GET", "PATCH", "DELETE"] },
      ],
      resources: [
        {
          name: "projects",
          listPath: "/projects",
          itemPath: "/projects/{id}",
          createPath: "/projects",
          updatePath: "/projects/{id}",
          deletePath: "/projects/{id}",
          suggestedKey: "projects",
        },
        {
          name: "blogs",
          listPath: "/blogs",
          itemPath: "/blogs/{id}",
          createPath: "/blogs",
          updatePath: "/blogs/{id}",
          deletePath: "/blogs/{id}",
          suggestedKey: "blogs",
        },
      ],
      suggestedEndpointConfig: {
        projects: "/projects",
        blogs: "/blogs",
      },
      rawPathCount: 4,
    };

    const formatted = formatDiscoveryResult(result);
    assert.ok(formatted.includes("My CMS API"));
    assert.ok(formatted.includes("v1.0.0"));
    assert.ok(formatted.includes("projects"));
    assert.ok(formatted.includes("blogs"));
    assert.ok(formatted.includes("Suggested"));
    assert.ok(formatted.includes('"endpoints"'));
  });

  it("handles empty resources gracefully", () => {
    const result: OpenApiDiscoveryResult = {
      specUrl: "https://example.com/openapi.json",
      title: "Empty API",
      version: "0.1",
      endpoints: [],
      resources: [],
      suggestedEndpointConfig: {},
      rawPathCount: 0,
    };

    const formatted = formatDiscoveryResult(result);
    assert.ok(formatted.includes("Empty API"));
    assert.ok(formatted.includes("no standard CRUD resources detected"));
  });
});
