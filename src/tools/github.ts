// src/tools/github.ts
// GitHub repo scanner — reads README, detects tech stack, extracts timeline.
// The killer feature: give Claude a repo URL and it auto-fills your portfolio.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { AuditLogger, withAudit } from "../lib/audit.js";

const GITHUB_API = "https://api.github.com";

// ─── Tech stack detection patterns ───────────────────────────────────────────

const TECH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /next\.?js/i, label: "Next.js" },
  { pattern: /react/i, label: "React" },
  { pattern: /vue/i, label: "Vue.js" },
  { pattern: /svelte/i, label: "Svelte" },
  { pattern: /angular/i, label: "Angular" },
  { pattern: /typescript/i, label: "TypeScript" },
  { pattern: /python/i, label: "Python" },
  { pattern: /fastapi/i, label: "FastAPI" },
  { pattern: /django/i, label: "Django" },
  { pattern: /flask/i, label: "Flask" },
  { pattern: /node\.?js/i, label: "Node.js" },
  { pattern: /express/i, label: "Express" },
  { pattern: /supabase/i, label: "Supabase" },
  { pattern: /postgres/i, label: "PostgreSQL" },
  { pattern: /mongodb/i, label: "MongoDB" },
  { pattern: /redis/i, label: "Redis" },
  { pattern: /docker/i, label: "Docker" },
  { pattern: /kubernetes/i, label: "Kubernetes" },
  { pattern: /tailwind/i, label: "Tailwind CSS" },
  { pattern: /prisma/i, label: "Prisma" },
  { pattern: /graphql/i, label: "GraphQL" },
  { pattern: /langchain/i, label: "LangChain" },
  { pattern: /openai/i, label: "OpenAI" },
  { pattern: /hugging.?face/i, label: "HuggingFace" },
  { pattern: /pytorch/i, label: "PyTorch" },
  { pattern: /tensorflow/i, label: "TensorFlow" },
  { pattern: /scikit.?learn/i, label: "scikit-learn" },
  { pattern: /pandas/i, label: "Pandas" },
  { pattern: /vercel/i, label: "Vercel" },
  { pattern: /aws/i, label: "AWS" },
  { pattern: /gcp|google cloud/i, label: "Google Cloud" },
];

function detectTechStack(text: string): string[] {
  const found = new Set<string>();
  for (const { pattern, label } of TECH_PATTERNS) {
    if (pattern.test(text)) found.add(label);
  }
  return [...found];
}

// ─── Parse repo URL ───────────────────────────────────────────────────────────

// GitHub usernames/org names: 1-39 chars, alphanumeric + hyphens (no leading hyphen)
// Repo names: 1-100 chars, alphanumeric + hyphens + dots + underscores
const GITHUB_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-]{0,38}$/;
const GITHUB_REPO_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-._]{0,99}$/;

function parseRepoUrl(input: string): { owner: string; repo: string } {
  // Handle: https://github.com/owner/repo, owner/repo, github.com/owner/repo
  const cleaned = input.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const match = cleaned.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s]+)/);
  if (!match) throw new Error(`Cannot parse GitHub repo from input`);

  const owner = match[1];
  const repo = match[2];

  if (!GITHUB_NAME_RE.test(owner)) throw new Error(`Invalid GitHub owner name`);
  if (!GITHUB_REPO_RE.test(repo)) throw new Error(`Invalid GitHub repo name`);

  return { owner, repo };
}

// ─── GitHub API helper ────────────────────────────────────────────────────────

const GITHUB_TIMEOUT_MS = 20_000;

async function githubGet<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cms-mcp",
      },
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`GitHub API request failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Don't include path in error — it may contain repo names the user considers private
    throw new Error(`GitHub API returned ${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function getFileContent(owner: string, repo: string, path: string, token: string): Promise<string | null> {
  try {
    const data = await githubGet<{ content?: string; encoding?: string }>(
      `/repos/${owner}/${repo}/contents/${path}`,
      token,
    );
    if (data.content && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Extract summary from README ──────────────────────────────────────────────

function extractSummary(readme: string): string {
  const lines = readme.split("\n").filter((l) => l.trim());
  // Skip the title line (starts with #)
  const contentLines = lines.filter((l) => !l.startsWith("#"));
  const firstParagraph = contentLines.slice(0, 3).join(" ");
  return firstParagraph.slice(0, 280).trim();
}

// ─── Register Tools ───────────────────────────────────────────────────────────

export function registerGitHubTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
): void {
  const token = config.github?.token;

  if (!token) {
    console.error("[cms-mcp] No GitHub token — GitHub tools disabled.");
    return;
  }

  const client = new ApiClient(config);

  // ── scan_repo ──────────────────────────────────────────────────────────────

  server.tool(
    "scan_repo",
    {
      repo_url: z.string().min(1).describe("GitHub repo URL or owner/repo (e.g. 'parnish007/scene-sorter')"),
    },
    async (args) => {
      return withAudit(audit, "scan_repo", args, async () => {
        const { owner, repo } = parseRepoUrl(args.repo_url);

        // Fetch in parallel
        const [repoData, readme, packageJson, requirements, commits] = await Promise.all([
          githubGet<any>(`/repos/${owner}/${repo}`, token),
          getFileContent(owner, repo, "README.md", token).then((r) =>
            r ?? getFileContent(owner, repo, "readme.md", token)
          ),
          getFileContent(owner, repo, "package.json", token),
          getFileContent(owner, repo, "requirements.txt", token),
          githubGet<any[]>(`/repos/${owner}/${repo}/commits?per_page=10`, token).catch(() => []),
        ]);

        // Detect tech stack from all sources
        const allText = [
          readme ?? "",
          packageJson ?? "",
          requirements ?? "",
          repoData.description ?? "",
          (repoData.topics ?? []).join(" "),
        ].join("\n");

        const techStack = detectTechStack(allText);

        // Parse package.json for deps
        let packageDeps: string[] = [];
        if (packageJson) {
          try {
            const pkg = JSON.parse(packageJson);
            packageDeps = [
              ...Object.keys(pkg.dependencies ?? {}),
              ...Object.keys(pkg.devDependencies ?? {}),
            ].slice(0, 20);
          } catch {}
        }

        // Build timeline from commits
        const timeline = commits.slice(0, 5).map((c: any) => ({
          date: c.commit?.author?.date?.slice(0, 10) ?? "?",
          message: c.commit?.message?.split("\n")[0] ?? "?",
        }));

        const summary = readme ? extractSummary(readme) : (repoData.description ?? "");

        const result = {
          title: repoData.name ?? repo,
          description: repoData.description ?? "",
          summary,
          repo_url: repoData.html_url,
          live_url: repoData.homepage ?? null,
          stars: repoData.stargazers_count ?? 0,
          language: repoData.language ?? null,
          topics: repoData.topics ?? [],
          tech_stack: techStack.length ? techStack : packageDeps.slice(0, 8),
          timeline,
          last_commit: repoData.updated_at?.slice(0, 10) ?? null,
          license: repoData.license?.spdx_id ?? null,
          readme_preview: readme?.slice(0, 800) ?? null,
        };

        return {
          content: [{
            type: "text" as const,
            text: [
              `## Scanned: ${result.title}`,
              ``,
              `**Description:** ${result.description || "(none)"}`,
              `**Summary:** ${result.summary || "(none)"}`,
              `**Language:** ${result.language ?? "?"}`,
              `**Stars:** ${result.stars}`,
              `**Tech Stack:** ${result.tech_stack.join(", ") || "(not detected)"}`,
              `**Topics:** ${result.topics.join(", ") || "(none)"}`,
              `**Live URL:** ${result.live_url ?? "(none)"}`,
              `**Repo URL:** ${result.repo_url}`,
              `**Last Commit:** ${result.last_commit ?? "?"}`,
              ``,
              `### Recent Commits`,
              ...result.timeline.map((t) => `- ${t.date}: ${t.message}`),
              ``,
              `---`,
              `Use \`sync_repo_to_project\` with this data to create a portfolio entry, or \`preview_create_project\` to review first.`,
            ].join("\n"),
          }],
        };
      });
    },
  );

  // ── sync_repo_to_project ───────────────────────────────────────────────────

  server.tool(
    "sync_repo_to_project",
    {
      repo_url: z.string().min(1).describe("GitHub repo URL or owner/repo"),
      status: z.enum(["draft", "published"]).default("draft"),
      confirm: z.literal(true).describe("Must be true to create the project entry"),
    },
    async (args) => {
      if (config.readOnly) {
        return { content: [{ type: "text" as const, text: "🔒 Disabled in read-only mode." }] };
      }

      if (!config.endpoints.projects) {
        return { content: [{ type: "text" as const, text: "No projects endpoint configured." }] };
      }

      return withAudit(audit, "sync_repo_to_project", args, async () => {
        const { owner, repo } = parseRepoUrl(args.repo_url);

        const [repoData, readme, packageJson, requirements] = await Promise.all([
          githubGet<any>(`/repos/${owner}/${repo}`, token),
          getFileContent(owner, repo, "README.md", token),
          getFileContent(owner, repo, "package.json", token),
          getFileContent(owner, repo, "requirements.txt", token),
        ]);

        const allText = [readme ?? "", packageJson ?? "", requirements ?? "", repoData.description ?? ""].join("\n");
        const techStack = detectTechStack(allText);
        const summary = readme ? extractSummary(readme) : (repoData.description ?? "");

        const slug = repoData.name?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? repo;

        const projectData = {
          title: repoData.name ?? repo,
          slug,
          summary: summary.slice(0, 280),
          description: readme?.slice(0, 2000) ?? repoData.description ?? "",
          repo_url: repoData.html_url,
          live_url: repoData.homepage || undefined,
          tech_stack: techStack,
          tags: repoData.topics ?? [],
          status: args.status,
          seo_title: `${repoData.name} — ${repoData.description?.slice(0, 40) ?? "Project"}`,
          seo_description: summary.slice(0, 160),
        };

        const created = await client.post<Record<string, unknown>>(
          config.endpoints.projects!,
          projectData,
        );

        return {
          content: [{
            type: "text" as const,
            text: [
              `✅ Project synced from GitHub!`,
              ``,
              `**Title:** ${projectData.title}`,
              `**ID:** ${created["id"] ?? "(unknown)"}`,
              `**Status:** ${args.status}`,
              `**Tech Stack:** ${techStack.join(", ") || "(none detected)"}`,
              `**Repo:** ${projectData.repo_url}`,
              args.status === "draft" ? `\nPost is saved as draft. Use \`publish_project\` to go live.` : `\nProject is now live!`,
            ].join("\n"),
          }],
        };
      });
    },
  );

  // ── list_repos ─────────────────────────────────────────────────────────────

  server.tool(
    "list_repos",
    {
      username: z.string().optional().describe("GitHub username (defaults to token owner)"),
      limit: z.number().int().min(1).max(50).default(10),
      sort: z.enum(["updated", "stars", "created"]).default("updated"),
    },
    async (args) => {
      return withAudit(audit, "list_repos", args, async () => {
        const user = args.username ?? config.github?.defaultOwner;
        const path = user
          ? `/users/${user}/repos?per_page=${args.limit}&sort=${args.sort}`
          : `/user/repos?per_page=${args.limit}&sort=${args.sort}`;

        const repos = await githubGet<any[]>(path, token);

        const summary = repos
          .map((r) => `• ${r.full_name} ⭐${r.stargazers_count} — ${r.description ?? "(no description)"}`)
          .join("\n");

        return {
          content: [{
            type: "text" as const,
            text: `Found ${repos.length} repo(s):\n\n${summary}\n\nUse \`scan_repo\` on any of these to extract full project data.`,
          }],
        };
      });
    },
  );
}
