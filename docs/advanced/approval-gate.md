# Human Approval Gate

The approval gate is a human-in-the-loop layer that intercepts write operations and requires a human click before anything executes. Designed for production sites where giving an AI unchecked write access is too risky.

## How it works

```
Claude calls mutate_projects({ action: "delete", id: "42", confirm: true })
  ↓
cms-mcp pauses execution
  ↓
Prints: "Approval required — open http://localhost:2323"
  ↓
You open the URL in your browser
  ↓
Browser shows: tool name + full diff preview + Approve/Reject buttons
  ↓
You click Approve → write executes → Claude gets the result
You click Reject → Claude is told the operation was rejected
```

The browser dashboard uses Server-Sent Events (SSE) for real-time updates — no polling, no manual refresh.

## Setup

**Via CLI flag (no config change needed):**
```bash
npx cms-mcp --config ./config.json --approval
```

**Via config (permanent):**
```json
{
  "approvals": {
    "port": 2323,
    "timeoutMs": 300000
  }
}
```

**Gate only specific tools:**
```json
{
  "approvals": {
    "port": 2323,
    "tools": ["mutate_projects", "mutate_posts"]
  }
}
```

If `tools` is omitted, **all write tools** (create, update, publish, delete) require approval.

## Dashboard

Open `http://localhost:2323` in any browser while cms-mcp is running.

The page shows all pending approvals in real time. Each card shows:
- Tool name (color-coded: blue for create/update, amber for publish, red for delete)
- Full diff preview — exactly what Claude intends to do
- Countdown timer until auto-rejection
- Approve and Reject buttons

Cards disappear automatically after resolution.

## Timeouts

If you don't respond within `timeoutMs` (default: 5 minutes), the operation is auto-rejected. Claude receives:

```
"mutate_projects" was rejected by the human operator via the approval gate.
```

Claude may ask you to approve manually and retry.

To change the timeout:
```json
{ "approvals": { "timeoutMs": 600000 } }
```

## Multiple concurrent approvals

If Claude makes multiple write calls simultaneously (uncommon but possible), each gets its own card in the dashboard. Approve or reject them independently.

## Production usage

- The dashboard only binds to `127.0.0.1` (localhost) — it is never exposed to the public internet
- No authentication on the dashboard — it's localhost-only by design
- All args displayed in the dashboard have credentials redacted (same rules as audit logging)

## Combining with policies

The approval gate and policy engine work together:

1. **Policy check** runs first — if the content violates rules, the write is blocked before the gate even shows
2. **Gate check** runs second — if policy passes, the human reviews the diff

This gives you both automated guardrails (policies) and human oversight (gate) on every write.
