/**
 * runIntelligence.ts — v6 Run Intelligence
 *
 * Fetches logs for failed jobs in a run, parses error signals, optionally
 * calls an LLM for root-cause analysis, and returns a FailureInsight.
 *
 * Env vars (all optional — never crash at startup):
 *   PPLX_PROXY_URL   — OpenAI-compatible base URL ending in /v1
 *   PPLX_PROXY_KEY   — Bearer token for the proxy
 *   PPLX_INTEL_MODEL — model name (default: claude-3-7-sonnet-latest)
 */

import { parseFailureSignals } from "./logErrorParser.js";
import type { Signal } from "./logErrorParser.js";
import type { FailureInsight, InsightAnalysis, SuggestedAction } from "@gha-dispatcher/shared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GH_API = "https://api.github.com";
const MAX_BYTES = 200 * 1024; // 200 KB per job log
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const PROMPT_MAX_BYTES = 8 * 1024; // 8 KB prompt

// ---------------------------------------------------------------------------
// In-process cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  insight: FailureInsight;
  ts: number;
}

const insightCache = new Map<string, CacheEntry>();

function cacheKey(runId: number, repoFull: string): string {
  return `${repoFull}::${runId}`;
}

function getCached(runId: number, repoFull: string): FailureInsight | null {
  const key = cacheKey(runId, repoFull);
  const entry = insightCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    insightCache.delete(key);
    return null;
  }
  return entry.insight;
}

function setCache(runId: number, repoFull: string, insight: FailureInsight): void {
  insightCache.set(cacheKey(runId, repoFull), { insight, ts: Date.now() });
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

interface GhOpts extends RequestInit {
  headers?: Record<string, string>;
}

async function ghFetch(
  pat: string,
  path: string,
  opts: GhOpts = {},
): Promise<{ status: number; data: any; text: string; ok: boolean }> {
  const url = path.startsWith("http") ? path : `${GH_API}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${pat}`,
      "User-Agent": "gha-dispatcher-v6",
      ...(opts.headers || {}),
    },
    redirect: "follow",
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data, text, ok: res.ok };
}

async function fetchJobLog(pat: string, repoFull: string, jobId: number): Promise<string> {
  // GitHub returns 302 → follow to presigned S3 URL
  const result = await ghFetch(pat, `/repos/${repoFull}/actions/jobs/${jobId}/logs`);
  if (!result.ok) return "";
  const raw = result.text;
  if (raw.length > MAX_BYTES) return raw.slice(raw.length - MAX_BYTES);
  return raw;
}

// ---------------------------------------------------------------------------
// Heuristic category + root-cause from signals
// ---------------------------------------------------------------------------

function heuristicAnalysis(
  signals: Signal[],
  jobNames: string[],
): Pick<InsightAnalysis, "root_cause" | "confidence" | "category"> {
  if (signals.length === 0) {
    return {
      root_cause: `Failure in job(s): ${jobNames.join(", ")}. No specific error pattern detected; check full logs.`,
      confidence: 0.2,
      category: "unknown",
    };
  }

  const top = signals[0];

  switch (top.kind) {
    case "oom":
      return {
        root_cause: `Out-of-memory condition detected: "${top.message}". The process was killed by the OS or Node.js heap was exhausted.`,
        confidence: 0.9,
        category: "oom",
      };
    case "timeout":
      return {
        root_cause: `Job timed out: "${top.message}". The action exceeded its maximum execution time.`,
        confidence: 0.9,
        category: "timeout",
      };
    case "python_tb": {
      const loc = top.file ? ` in ${top.file}${top.line ? `:${top.line}` : ""}` : "";
      return {
        root_cause: `Python exception${loc}: ${top.message}`,
        confidence: 0.8,
        category: "test",
      };
    }
    case "npm_err":
      return {
        root_cause: `npm error: ${top.message}`,
        confidence: 0.75,
        category: "dependency",
      };
    case "node_err":
      return {
        root_cause: `Node.js error: ${top.message}`,
        confidence: 0.7,
        category: "unknown",
      };
    case "gh_action":
      return {
        root_cause: `GitHub Actions step error: ${top.message}`,
        confidence: 0.7,
        category: "config",
      };
    default:
      return {
        root_cause: `Generic error detected: "${top.message}"`,
        confidence: 0.4,
        category: "unknown",
      };
  }
}

// ---------------------------------------------------------------------------
// LLM call via pplx-proxy (OpenAI-compatible)
// ---------------------------------------------------------------------------

interface LlmAnalysisRaw {
  root_cause?: string;
  confidence?: number;
  category?: string;
  suggested_actions?: Array<{ label: string; kind: string; body?: string }>;
}

const VALID_CATEGORIES = new Set([
  "config",
  "dependency",
  "test",
  "infra",
  "timeout",
  "oom",
  "permission",
  "unknown",
]);
const VALID_ACTION_KINDS = new Set(["rerun_debug", "rerun_failed_jobs", "open_fix_pr"]);

function sanitizeLlmResponse(raw: LlmAnalysisRaw): InsightAnalysis | null {
  try {
    const root_cause = typeof raw.root_cause === "string" ? raw.root_cause.trim() : "";
    if (!root_cause) return null;

    const confidence =
      typeof raw.confidence === "number"
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.5;

    const category = VALID_CATEGORIES.has(raw.category ?? "")
      ? (raw.category as InsightAnalysis["category"])
      : "unknown";

    const suggested_actions: SuggestedAction[] = (raw.suggested_actions ?? [])
      .filter((a) => VALID_ACTION_KINDS.has(a.kind))
      .map((a) => ({
        label: String(a.label || a.kind),
        kind: a.kind as SuggestedAction["kind"],
        body: typeof a.body === "string" ? a.body : undefined,
      }));

    // Always include at least rerun_debug + rerun_failed_jobs
    if (!suggested_actions.some((a) => a.kind === "rerun_debug")) {
      suggested_actions.unshift({ label: "Re-run with debug logging", kind: "rerun_debug" });
    }
    if (!suggested_actions.some((a) => a.kind === "rerun_failed_jobs")) {
      suggested_actions.splice(1, 0, { label: "Re-run failed jobs", kind: "rerun_failed_jobs" });
    }

    return { root_cause, confidence, category, llm_used: true, suggested_actions };
  } catch {
    return null;
  }
}

async function callLlm(
  runName: string,
  workflow: string,
  branch: string,
  jobEntries: Array<{ jobName: string; signals: Signal[]; logTail: string }>,
): Promise<InsightAnalysis | null> {
  const proxyUrl = process.env.PPLX_PROXY_URL;
  const proxyKey = process.env.PPLX_PROXY_KEY;
  if (!proxyUrl || !proxyKey) return null;

  const model = process.env.PPLX_INTEL_MODEL ?? "claude-3-7-sonnet-latest";

  // Build compact prompt
  const jobSummaries = jobEntries
    .map(({ jobName, signals, logTail }) => {
      const topSignals = signals.slice(0, 5);
      const signalLines = topSignals
        .map((s) => `  [${s.kind}] ${s.message}${s.file ? ` (${s.file}:${s.line ?? "?"})` : ""}`)
        .join("\n");
      const tail = logTail.split("\n").slice(-50).join("\n");
      return `--- Job: ${jobName} ---\nSignals:\n${signalLines || "  (none)"}\n\nLog tail:\n${tail}`;
    })
    .join("\n\n");

  const systemPrompt = `You are a CI/CD failure analysis expert. Analyze the GitHub Actions run failure and return ONLY a JSON object (no markdown, no explanation) matching this schema:
{
  "root_cause": "string — concise 1-2 sentence explanation",
  "confidence": 0.0-1.0,
  "category": "config"|"dependency"|"test"|"infra"|"timeout"|"oom"|"permission"|"unknown",
  "suggested_actions": [
    {"label": "string", "kind": "rerun_debug"|"rerun_failed_jobs"|"open_fix_pr", "body": "optional patch or fix instructions"}
  ]
}`;

  const userContent = `Run: ${runName}\nWorkflow: ${workflow}\nBranch: ${branch}\n\nFailed jobs:\n${jobSummaries}`;

  // Enforce 8 KB prompt cap
  const cappedContent =
    userContent.length > PROMPT_MAX_BYTES
      ? userContent.slice(0, PROMPT_MAX_BYTES) + "\n...(truncated)"
      : userContent;

  try {
    const res = await fetch(`${proxyUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${proxyKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: cappedContent },
        ],
        temperature: 0.2,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`[v6 intel] LLM proxy returned ${res.status}`);
      return null;
    }

    const body = await res.json();
    const content: string = body?.choices?.[0]?.message?.content ?? "";
    if (!content) return null;

    // Strip possible markdown fences
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    const parsed: LlmAnalysisRaw = JSON.parse(cleaned);
    return sanitizeLlmResponse(parsed);
  } catch (e) {
    console.warn("[v6 intel] LLM call failed:", (e as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface AnalyzeRunOpts {
  pat: string;
  repoFull: string;
  runId: number;
  forceRefresh?: boolean;
}

/**
 * Analyze a failed run and return a FailureInsight.
 * Returns { runId, repoFull, conclusion, jobs: [], analysis: null } if run is
 * not in a failure state.
 */
export async function analyzeRun({
  pat,
  repoFull,
  runId,
  forceRefresh = false,
}: AnalyzeRunOpts): Promise<FailureInsight> {
  // Cache check
  if (!forceRefresh) {
    const cached = getCached(runId, repoFull);
    if (cached) return cached;
  }

  // 1. Fetch run metadata
  const runResult = await ghFetch(pat, `/repos/${repoFull}/actions/runs/${runId}`);
  const run = runResult.data ?? {};
  const conclusion: string = run.conclusion ?? "unknown";

  // If not failure, return early (no analysis)
  if (conclusion !== "failure" && conclusion !== "timed_out") {
    const insight: FailureInsight = {
      runId,
      repoFull,
      conclusion,
      jobs: [],
      analysis: null,
    };
    setCache(runId, repoFull, insight);
    return insight;
  }

  // 2. Fetch jobs
  const jobsResult = await ghFetch(
    pat,
    `/repos/${repoFull}/actions/runs/${runId}/jobs?per_page=100`,
  );
  const allJobs: any[] = jobsResult.data?.jobs ?? [];

  // 3. Filter failed jobs
  const failedJobs = allJobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out");

  // 4. Fetch logs + parse signals for each failed job
  const jobEntries: Array<{
    jobId: number;
    jobName: string;
    signals: Signal[];
    logTail: string;
  }> = [];

  for (const job of failedJobs) {
    const logText = await fetchJobLog(pat, repoFull, job.id);
    const signals = parseFailureSignals(logText);
    const logTail = logText.split("\n").slice(-50).join("\n");
    jobEntries.push({
      jobId: job.id,
      jobName: job.name,
      signals,
      logTail,
    });
  }

  // 5. Try LLM analysis
  const runName: string = run.name ?? String(runId);
  const workflowName: string = run.path ?? run.name ?? "unknown";
  const branch: string = run.head_branch ?? "unknown";

  let analysis: InsightAnalysis | null = null;

  if (jobEntries.length > 0) {
    analysis = await callLlm(runName, workflowName, branch, jobEntries);
  }

  // 6. Heuristic fallback
  if (!analysis) {
    const allSignals = jobEntries.flatMap((j) => j.signals);
    const jobNames = jobEntries.map((j) => j.jobName);
    const heuristic = heuristicAnalysis(allSignals, jobNames);

    const defaultActions: SuggestedAction[] = [
      { label: "Re-run with debug logging", kind: "rerun_debug" },
      { label: "Re-run failed jobs", kind: "rerun_failed_jobs" },
    ];

    analysis = {
      ...heuristic,
      llm_used: false,
      suggested_actions: defaultActions,
    };
  }

  const insight: FailureInsight = {
    runId,
    repoFull,
    conclusion,
    jobs: jobEntries.map((j) => ({
      jobId: j.jobId,
      jobName: j.jobName,
      signals: j.signals,
    })),
    analysis,
  };

  setCache(runId, repoFull, insight);
  return insight;
}
