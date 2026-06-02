/**
 * v5 Live Log Stream — SSE endpoint
 * GET /api/runs/:id/stream?repo_full=owner/repo
 * PAT via x-github-pat header
 */
import { Router } from "express";
import type { Request, Response } from "express";

const GH_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// Concurrent stream cap: per-PAT max 5 active streams
// ---------------------------------------------------------------------------
const streamCounts = new Map<string, number>();

function incrementStream(pat: string): boolean {
  const current = streamCounts.get(pat) ?? 0;
  if (current >= 5) return false;
  streamCounts.set(pat, current + 1);
  return true;
}

function decrementStream(pat: string): void {
  const current = streamCounts.get(pat) ?? 0;
  const next = Math.max(0, current - 1);
  if (next === 0) streamCounts.delete(pat);
  else streamCounts.set(pat, next);
}

// ---------------------------------------------------------------------------
// SSE write helper — per spec:
//   string data → split on \n, prefix each line with `data:`
//   object data → JSON.stringify into single data: line
// ---------------------------------------------------------------------------
function sse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  if (typeof data === "string") {
    for (const line of data.split("\n")) {
      res.write(`data: ${line}\n`);
    }
  } else {
    res.write(`data: ${JSON.stringify(data)}\n`);
  }
  res.write("\n");
}

// ---------------------------------------------------------------------------
// GitHub fetch helper
// ---------------------------------------------------------------------------
async function ghFetch(
  pat: string,
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; text: string; ok: boolean }> {
  try {
    const res = await fetch(`${GH_API}${path}`, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${pat}`,
        "User-Agent": "gha-dispatcher-v5",
        ...(opts.headers || {}),
      },
      redirect: "follow",
    });
    const text = await res.text();
    return { status: res.status, text, ok: res.ok };
  } catch (e) {
    return { status: 0, text: String(e), ok: false };
  }
}

async function ghJson(
  pat: string,
  path: string,
): Promise<{ status: number; data: any; ok: boolean }> {
  const { status, text, ok } = await ghFetch(pat, path);
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status, data, ok };
}

// ---------------------------------------------------------------------------
// Terminal run conclusions
// ---------------------------------------------------------------------------
const TERMINAL = new Set([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "neutral",
  "stale",
]);

function isTerminal(status: string | null, conclusion: string | null): boolean {
  return status === "completed" && conclusion != null && TERMINAL.has(conclusion);
}

// ---------------------------------------------------------------------------
// Emit a log chunk as multi-line SSE per spec:
//   event: log
//   data: jobId:<id>
//   data: jobName:<name>
//   data: ---
//   data: <line 1 of chunk>
//   data: <line 2 of chunk>
//   ...
//   (blank line)
// The client parseSSE will reconstruct `data` as the joined lines.
// ---------------------------------------------------------------------------
function sseLog(
  res: Response,
  jobId: number,
  jobName: string,
  chunk: string,
): void {
  res.write("event: log\n");
  res.write(`data: {"jobId":${jobId},"jobName":${JSON.stringify(jobName)}}\n`);
  // Emit chunk lines — client will parse the full data block
  for (const line of chunk.split("\n")) {
    res.write(`data: ${line}\n`);
  }
  res.write("\n");
}

// ---------------------------------------------------------------------------
// SSE route
// ---------------------------------------------------------------------------
export const streamRouter = Router();

streamRouter.get(
  "/api/runs/:id/stream",
  async (req: Request, res: Response) => {
    const pat = (req.header("x-github-pat") || "").trim();
    const runId = req.params.id;
    const repoFull = ((req.query.repo_full as string) || "").trim();

    if (!pat) {
      res.status(401).json({ message: "Missing x-github-pat header" });
      return;
    }
    if (!repoFull || !repoFull.includes("/")) {
      res
        .status(400)
        .json({ message: "repo_full query param required (owner/repo)" });
      return;
    }

    // Check stream cap
    if (!incrementStream(pat)) {
      res
        .status(429)
        .json({ message: "Too many active streams for this PAT (max 5)" });
      return;
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let closed = false;
    req.on("close", () => {
      closed = true;
      decrementStream(pat);
    });

    // Hello event
    sse(res, "hello", { runId, repo: repoFull });

    // State tracking
    let lastStatus: string | null = null;
    let lastConclusion: string | null = null;
    // jobId -> byte cursor (length of last fetched log text)
    const jobCursors = new Map<number, number>();
    // jobId -> last known status
    const jobLastStatus = new Map<number, string>();

    const MAX_POLLS = Math.ceil((30 * 60 * 1000) / 2000); // 30 min / 2s
    let pollCount = 0;

    const poll = async (): Promise<void> => {
      if (closed) return;

      if (pollCount++ > MAX_POLLS) {
        sse(res, "end", { conclusion: "stream_timeout" });
        res.end();
        return;
      }

      // 1. Fetch run status
      const runResult = await ghJson(
        pat,
        `/repos/${repoFull}/actions/runs/${runId}`,
      );
      if (closed) return;

      if (runResult.ok && runResult.data) {
        const run = runResult.data;
        const newStatus: string | null = run.status ?? null;
        const newConclusion: string | null = run.conclusion ?? null;

        if (
          newStatus !== lastStatus ||
          newConclusion !== lastConclusion
        ) {
          lastStatus = newStatus;
          lastConclusion = newConclusion;
          sse(res, "status", {
            status: newStatus,
            conclusion: newConclusion,
            updated_at: run.updated_at,
          });
        }
      }

      // 2. Fetch jobs
      const jobsResult = await ghJson(
        pat,
        `/repos/${repoFull}/actions/runs/${runId}/jobs?per_page=100`,
      );
      if (closed) return;

      const jobs: any[] =
        jobsResult.ok && jobsResult.data?.jobs ? jobsResult.data.jobs : [];

      for (const job of jobs) {
        if (closed) break;

        const jobId: number = job.id;
        const jobName: string = job.name;
        const curJobStatus: string = job.status;
        const prevJobStatus = jobLastStatus.get(jobId);

        // Emit job metadata event
        sse(res, "job", {
          id: jobId,
          name: jobName,
          status: curJobStatus,
          conclusion: job.conclusion ?? null,
          started_at: job.started_at ?? null,
          completed_at: job.completed_at ?? null,
          steps: (job.steps || []).map((s: any) => ({
            name: s.name,
            status: s.status,
            conclusion: s.conclusion ?? null,
            number: s.number,
          })),
        });

        jobLastStatus.set(jobId, curJobStatus);

        // Fetch logs when job is active or just completed
        const wantLogs =
          curJobStatus === "in_progress" || curJobStatus === "completed";
        const statusChanged = prevJobStatus !== curJobStatus;

        if (wantLogs && (statusChanged || curJobStatus === "in_progress")) {
          const logResult = await ghFetch(
            pat,
            `/repos/${repoFull}/actions/jobs/${jobId}/logs`,
          );
          if (closed) break;

          if (logResult.ok && logResult.text) {
            const fullLog = logResult.text;
            const cursor = jobCursors.get(jobId) ?? 0;

            if (fullLog.length > cursor) {
              const chunk = fullLog.slice(cursor);
              jobCursors.set(jobId, fullLog.length);
              sseLog(res, jobId, jobName, chunk);
            } else if (!jobCursors.has(jobId)) {
              jobCursors.set(jobId, 0);
            }
          }
        }
      }

      // 3. Check terminal state
      if (isTerminal(lastStatus, lastConclusion)) {
        sse(res, "end", { conclusion: lastConclusion });
        res.end();
        return;
      }

      // Schedule next poll if still open
      if (!closed) {
        setTimeout(poll, 2000);
      }
    };

    // Kick off first poll
    poll().catch((err) => {
      if (!closed) {
        sse(res, "error", { message: String(err) });
        res.end();
      }
    });
  },
);
