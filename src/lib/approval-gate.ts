// src/lib/approval-gate.ts
// Human-in-the-loop approval gate for CMS write operations.
//
// When enabled, write tools (create/update/delete/publish) pause execution
// and wait for a human to approve or reject via a local browser UI.
//
// Flow:
//   Claude calls create_project
//     → tool calls gate.request()
//     → pending approval stored + URL printed to stderr
//     → Promise waits (up to timeoutMs)
//   Human opens http://localhost:PORT, clicks Approve
//     → HTTP POST /api/approve/:id
//     → Promise resolves true
//   Tool proceeds with the write

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingApproval {
  id: string;
  toolName: string;
  preview: string;
  sanitizedArgs: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
  timeoutAt: number;
}

// ─── Secret redaction ─────────────────────────────────────────────────────────

const SENSITIVE_RE = /token|password|secret|key|auth|credential|api[-_]?key/i;

function sanitizeForDisplay(obj: unknown, depth = 0): unknown {
  if (depth > 4 || obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj.length > 120 ? obj.slice(0, 117) + "..." : obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.slice(0, 10).map((v) => sanitizeForDisplay(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = SENSITIVE_RE.test(k) ? `[redacted]` : sanitizeForDisplay(v, depth + 1);
  }
  return out;
}

// ─── Embedded HTML UI ─────────────────────────────────────────────────────────

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>cms-mcp · Approval Gate</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background: #080810; font-family: ui-monospace, monospace; }
    .card-enter { animation: slideIn 0.2s ease-out; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
  </style>
</head>
<body class="text-gray-100 min-h-screen">
  <div class="max-w-2xl mx-auto p-6">

    <div class="flex items-center gap-3 mb-8 pt-4">
      <div class="relative">
        <div class="w-2.5 h-2.5 rounded-full bg-emerald-400" id="dot"></div>
        <div class="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-60" id="dotPing"></div>
      </div>
      <h1 class="text-lg font-bold tracking-tight text-white">cms-mcp <span class="text-gray-500 font-normal">/ approval gate</span></h1>
    </div>

    <div id="list" class="space-y-4"></div>

    <div id="empty" class="text-center py-20 text-gray-600">
      <div class="text-5xl mb-4">⏳</div>
      <p class="text-gray-500 text-sm">No pending approvals</p>
      <p class="text-gray-700 text-xs mt-1">Waiting for Claude to make a write request...</p>
    </div>

  </div>

  <script>
    const state = new Map();

    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function timeLeft(timeoutAt) {
      const s = Math.max(0, Math.floor((timeoutAt - Date.now()) / 1000));
      const m = Math.floor(s / 60);
      return m + ':' + String(s % 60).padStart(2, '0');
    }

    function toolBadgeColor(name) {
      if (name.startsWith('delete')) return 'bg-red-900/40 text-red-300 border-red-700/50';
      if (name.startsWith('publish')) return 'bg-amber-900/40 text-amber-300 border-amber-700/50';
      return 'bg-blue-900/40 text-blue-300 border-blue-700/50';
    }

    function renderCard(a) {
      return \`<div class="card-enter border border-gray-800/60 rounded-xl p-5 bg-gray-900/50 backdrop-blur" id="card-\${a.id}">
        <div class="flex justify-between items-center mb-4">
          <span class="border rounded-md px-2.5 py-0.5 text-xs font-bold \${toolBadgeColor(a.toolName)}">\${esc(a.toolName)}</span>
          <span class="text-gray-600 text-xs font-mono" id="timer-\${a.id}">\${timeLeft(a.timeoutAt)}</span>
        </div>
        <pre class="text-xs text-gray-300 bg-gray-950 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap leading-relaxed border border-gray-800/50 mb-4">\${esc(a.preview)}</pre>
        <div class="flex gap-2">
          <button onclick="decide('\${a.id}', true)" id="btn-approve-\${a.id}"
            class="flex-1 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed">
            Approve
          </button>
          <button onclick="decide('\${a.id}', false)" id="btn-reject-\${a.id}"
            class="flex-1 py-2.5 rounded-lg bg-red-800/80 hover:bg-red-700 text-white text-sm font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed">
            Reject
          </button>
        </div>
      </div>\`;
    }

    function render() {
      const list = document.getElementById('list');
      const empty = document.getElementById('empty');
      if (state.size === 0) {
        list.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';
      // Only re-render cards that don't exist yet
      for (const [id, a] of state) {
        if (!document.getElementById('card-' + id)) {
          list.insertAdjacentHTML('afterbegin', renderCard(a));
        }
      }
    }

    function updateTimers() {
      for (const [id, a] of state) {
        const el = document.getElementById('timer-' + id);
        if (el) el.textContent = timeLeft(a.timeoutAt);
      }
    }

    async function decide(id, approved) {
      const ab = document.getElementById('btn-approve-' + id);
      const rb = document.getElementById('btn-reject-' + id);
      if (ab) ab.disabled = true;
      if (rb) rb.disabled = true;
      const action = approved ? 'approve' : 'reject';
      try {
        await fetch('/api/' + action + '/' + id, { method: 'POST' });
      } catch {}
    }

    const es = new EventSource('/events');
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'state') {
        state.clear();
        for (const a of msg.approvals) state.set(a.id, a);
      } else if (msg.type === 'new') {
        state.set(msg.approval.id, msg.approval);
      } else if (['approved', 'rejected', 'timeout'].includes(msg.type)) {
        state.delete(msg.id);
        const card = document.getElementById('card-' + msg.id);
        if (card) {
          card.style.opacity = '0.4';
          card.style.transition = 'opacity 0.3s';
          setTimeout(() => card.remove(), 350);
        }
      }
      render();
    };

    setInterval(updateTimers, 1000);
    render();
  </script>
</body>
</html>`;

// ─── ApprovalGate class ───────────────────────────────────────────────────────

export class ApprovalGate {
  private pending = new Map<string, PendingApproval>();
  private sseClients = new Set<ServerResponse>();
  private server: ReturnType<typeof createServer>;
  private port: number;
  private timeoutMs: number;

  constructor(port = 2323, timeoutMs = 300_000) {
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.server = this.buildServer();
  }

  // ── Start / Stop ───────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          reject(new Error(`Port ${this.port} is already in use. Set a different port in config.approvals.port`));
        } else {
          reject(err);
        }
      });
      this.server.listen(this.port, "127.0.0.1", () => {
        process.stderr.write(`  [approval-gate] Dashboard: http://127.0.0.1:${this.port}\n`);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    // Reject all pending approvals so tool calls don't hang forever
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve(false);
    }
    this.pending.clear();

    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  // ── Request approval ───────────────────────────────────────────────────────

  /**
   * Pauses the calling tool until a human approves or rejects via the browser UI.
   * Returns true if approved, false if rejected or timed out.
   */
  async request(
    toolName: string,
    args: Record<string, unknown>,
    preview: string,
  ): Promise<boolean> {
    const id = randomUUID();
    const now = Date.now();

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.broadcast({ type: "timeout", id });
        process.stderr.write(`  [approval-gate] "${toolName}" auto-rejected (timeout)\n`);
        resolve(false);
      }, this.timeoutMs);

      const approval: PendingApproval = {
        id,
        toolName,
        preview,
        sanitizedArgs: sanitizeForDisplay(args) as Record<string, unknown>,
        resolve,
        timer,
        createdAt: now,
        timeoutAt: now + this.timeoutMs,
      };

      this.pending.set(id, approval);

      process.stderr.write(
        `\n  [approval-gate] Approval required for "${toolName}"\n` +
        `  Open: http://127.0.0.1:${this.port}\n\n`,
      );

      this.broadcast({ type: "new", approval: this.serialize(id) });
    });
  }

  // ── HTTP Server ────────────────────────────────────────────────────────────

  private buildServer(): ReturnType<typeof createServer> {
    return createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";

      // ─ Dashboard HTML ─────────────────────────────────────────────────────
      if (method === "GET" && url === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML_PAGE);
        return;
      }

      // ─ SSE stream ─────────────────────────────────────────────────────────
      if (method === "GET" && url === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no", // disable nginx buffering
        });
        res.write("retry: 3000\n\n");

        // Send current state immediately on connect
        const current = [...this.pending.keys()].map((id) => this.serialize(id));
        res.write(`data: ${JSON.stringify({ type: "state", approvals: current })}\n\n`);

        this.sseClients.add(res);
        req.on("close", () => this.sseClients.delete(res));
        return;
      }

      // ─ Approve / Reject ───────────────────────────────────────────────────
      if (method === "POST" && (url.startsWith("/api/approve/") || url.startsWith("/api/reject/"))) {
        const parts = url.split("/");
        const id = parts[3];
        const approved = parts[2] === "approve";

        const pending = this.pending.get(id);
        if (!pending) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found — may have already been resolved or timed out" }));
          return;
        }

        clearTimeout(pending.timer);
        this.pending.delete(id);
        this.broadcast({ type: approved ? "approved" : "rejected", id });

        const action = approved ? "approved" : "rejected";
        process.stderr.write(`  [approval-gate] "${pending.toolName}" ${action} by human\n`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, action }));

        pending.resolve(approved);
        return;
      }

      // ─ Favicon (avoid 404 noise) ──────────────────────────────────────────
      if (method === "GET" && url === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    });
  }

  // ── SSE broadcast ──────────────────────────────────────────────────────────

  private broadcast(event: unknown): void {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(msg);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  // ── Serialize pending for UI ───────────────────────────────────────────────

  private serialize(id: string): object {
    const p = this.pending.get(id)!;
    return {
      id: p.id,
      toolName: p.toolName,
      preview: p.preview,
      createdAt: p.createdAt,
      timeoutAt: p.timeoutAt,
    };
  }
}

// ─── Gate check helper ────────────────────────────────────────────────────────

/**
 * Shared helper used by write tools to check the approval gate.
 * Returns a rejection response object if blocked, or null to proceed.
 */
export async function checkGate(
  gate: ApprovalGate | null | undefined,
  toolName: string,
  args: Record<string, unknown>,
  preview: string,
  toolsFilter?: string[],
): Promise<{ content: [{ type: "text"; text: string }] } | null> {
  if (!gate) return null;
  if (toolsFilter && !toolsFilter.includes(toolName)) return null;

  const approved = await gate.request(toolName, args, preview);
  if (!approved) {
    return {
      content: [{
        type: "text" as const,
        text: `🚫 "${toolName}" was rejected by the human operator via the approval gate.`,
      }],
    };
  }
  return null;
}
