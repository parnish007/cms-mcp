# Semantic Vector Search

cms-mcp includes a local-first semantic search engine that indexes your CMS content and lets Claude find items by meaning, not just keywords.

## How it works

1. **Indexing**: `sync_all_content` pulls all projects and blogs from your CMS
2. **Tokenization**: Text is tokenized, stop words removed
3. **TF-IDF Vectorization**: Each document gets a vector representing its term importance
4. **Storage**: Vectors are stored in a local SQLite database
5. **Search**: Queries are vectorized and matched using cosine similarity

No external embedding API is needed — everything runs locally.

## Setup

Enable the schema cache in your config (the vector cache piggybacks on it):

```json
{
  "schemaCache": {
    "path": "~/.cms-mcp/schema-cache.db",
    "ttlMinutes": 60
  }
}
```

## Populating the index

Ask Claude: *"Sync all my content for search"*

Or call the tool:

```
Tool: sync_all_content
Args: { "types": ["projects", "blogs"] }
```

Output:
```
✅ Content sync complete

Synced: 23 items
  • Projects: 15 indexed
  • Blogs: 8 indexed

Cache stats: 23 total entries, 847 vocabulary terms
```

## Searching

Ask Claude: *"What did we build for the fintech client?"*

Claude uses `semantic_search` under the hood:

```
Tool: semantic_search
Args: { "query": "fintech dashboard analytics", "limit": 5 }
```

Output:
```
## Search Results for "fintech dashboard analytics"
*3 matches found*

### FinTrack Dashboard (87.3% match)
**Type:** project | **ID:** `proj-42` | **Status:** published
> Real-time financial analytics dashboard with D3.js charts
**Tech:** React, D3.js, FastAPI, PostgreSQL

### Banking API Integration (62.1% match)
**Type:** project | **ID:** `proj-38` | **Status:** draft
> REST API wrapper for banking data aggregation

### Data Viz Deep Dive (41.8% match)
**Type:** blog | **ID:** `blog-12` | **Status:** published
> How we built interactive charts for financial data
```

## How scores work

| Score | Meaning |
|-------|---------|
| > 80% | Strong match — shares many important terms |
| 50–80% | Related content — shared domain terms |
| 20–50% | Tangentially related |
| < 20% | Filtered out (below threshold) |

## Knowledge status

Check what's indexed:

```
Tool: knowledge_status
```

Output:
```
## Knowledge Base Status

| Metric | Value |
|--------|-------|
| Total entries | 23 |
| project entries | 15 |
| blog entries | 8 |
| Vocabulary size | 847 terms |

## Circuit Breaker
| Metric | Value |
|--------|-------|
| State | closed |
| Failure count | 0 |
| Cached responses | 3 |
```

## MCP Resources

Content is also exposed as MCP Resources that Claude can read directly:

```
cms://projects          → List all projects
cms://projects/{id}     → Read a specific project
cms://blogs             → List all blog posts
cms://blogs/{id}        → Read a specific blog post
```

When Claude reads a resource, it's automatically indexed in the vector cache.

## Technical details

- **Tokenizer**: Splits on whitespace/punctuation, filters words < 3 chars, removes English stop words
- **Vocabulary**: Top 2,000 most frequent terms across all documents
- **Vector size**: Matches vocabulary size (up to 2,000 dimensions)
- **Similarity**: Cosine similarity on L2-normalized TF-IDF vectors
- **Storage**: SQLite with JSON-serialized vectors
- **Re-indexing**: Vocabulary and all vectors are rebuilt when new content is added (first 5 entries, then every 20)
