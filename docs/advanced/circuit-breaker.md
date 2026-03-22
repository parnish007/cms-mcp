# Circuit Breaker

cms-mcp includes a circuit breaker pattern that provides graceful degradation when your CMS API goes down.

## How it works

```
CLOSED → (5 consecutive failures) → OPEN → (30s cooldown) → HALF-OPEN → (test request)
                                                                           ↓
                                                                    success → CLOSED
                                                                    failure → OPEN
```

### States

| State | Behavior |
|-------|----------|
| **Closed** | Normal operation. Requests go through. Failures counted. |
| **Open** | API assumed down. Returns cached responses immediately (no API call). |
| **Half-Open** | After cooldown, one test request is allowed through. |

### Cached responses

Every successful API response is cached by endpoint. When the circuit opens, cached data is served instead of errors:

```
[circuit-breaker:cms-api] request failed — serving cached response (45s old)
```

If no cached data exists for a given endpoint, the error propagates normally.

## Configuration

The circuit breaker is always active with sensible defaults:

| Parameter | Value | Description |
|-----------|-------|-------------|
| Failure threshold | 5 | Consecutive failures before opening |
| Reset timeout | 30 seconds | How long to stay open before testing |

## Monitoring

Use `knowledge_status` to see the circuit breaker state:

```
## Circuit Breaker
| Metric | Value |
|--------|-------|
| State | closed |
| Failure count | 0 |
| Cached responses | 3 |
```

## What this means in practice

If your CMS API goes down:

1. First 5 requests fail normally with error messages
2. On the 5th failure, the circuit **opens**
3. Subsequent requests instantly return the last known good response
4. Claude sees: `"CMS API is currently unavailable. Here's the latest cached data."`
5. After 30 seconds, one test request is sent
6. If it succeeds, normal operation resumes
7. If it fails, the circuit stays open for another 30 seconds

Your users never see a blank page or a stack trace — they get slightly stale but valid data.
