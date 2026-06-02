/**
 * routes-v6.ts — v6 Run Intelligence API routes.
 *
 * Registers:
 *   GET  /api/runs/:id/insight?repo_full=owner/repo&refresh=0|1
 *   POST /api/runs/:id/rerun-debug?repo_full=owner/repo
 *   POST /api/runs/:id/open-fix-pr?repo_full=owner/repo
 *
 * Mount: in routes.ts — `app.use(v6Router)`
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { analyzeRun } from "./runIntelligence.js";
import { ensureFork, commitFileToBranch, openPullRequest } from "./prFlow.js";

const GH_API = "https://api.github.com";
const REPO = process.env.GITHUB_REPO || "pv-udpv/pplx-lab";

export const v6Router = Router();

// ---------------------------------------------------------------------------
// Auth helpers (mirrors routes.ts — kept local to avoid circular import)
// ---------------------------------------------------------------------------

function getToken(req: Request): string | null {
  const xpat = req.header("x-github-pat");
  if (xpat) return xpat.trim();
  const auth = req.header("authorization") || req.header("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function requireToken(req: Request, res: Response): string | null {
  const token = getToken(req);
  if (!token) {
    res
      .status(401)
      .json({ message: "Missing GitHub PAT (x-github-pat or Authorization: Bearer <pat>)" });
    return null;
  }
  return token;
}

// ---------------------------------------------------------------------------
// GitHub helper — used only for rerun-debug
// ---------------------------------------------------------------------------

async function github(
  token: string,
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${GH_API}${path}`, {
    ...opts,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      "User-Agent": "gha-dispatcher-v6",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });

  if (res.status === 204 || res.status === 201) {
    return { status: res.status, data: null };
  }

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) ||
      (typeof data === "string" ? data : "") ||
      res.statusText;
    const err: any = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return { status: res.status, data };
}

// ---------------------------------------------------------------------------
// GET /api/runs/:id/insight
// ---------------------------------------------------------------------------

v6Router.get(
  "/api/runs/:id/insight",
  async (req: Request, res: Response, next: NextFunction) => {
    const token = requireToken(req, res);
    if (!token) return;

    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      return res.status(400).json({ message: "Invalid run id" });
    }

    const repoFull = String(req.query.repo_full || REPO);
    if (!repoFull.includes("/")) {
      return res
        .status(400)
        .json({ message: "repo_full query param required (owner/repo)" });
    }

    const forceRefresh = req.query.refresh === "1";

    try {
      const insight = await analyzeRun({
        pat: token,
        repoFull,
        runId,
        forceRefresh,
      });
      res.json(insight);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/runs/:id/rerun-debug
// ---------------------------------------------------------------------------

v6Router.post(
  "/api/runs/:id/rerun-debug",
  async (req: Request, res: Response) => {
    const token = requireToken(req, res);
    if (!token) return;

    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      return res.status(400).json({ ok: false, message: "Invalid run id" });
    }

    const repoFull = String(req.query.repo_full || REPO);

    try {
      const { status } = await github(
        token,
        `/repos/${repoFull}/actions/runs/${runId}/rerun`,
        {
          method: "POST",
          body: JSON.stringify({ enable_debug_logging: true }),
        },
      );

      if (status === 201 || status === 204) {
        return res.status(200).json({ ok: true, run_id: runId });
      }
      return res
        .status(200)
        .json({ ok: false, status, message: "Unexpected GitHub status" });
    } catch (e: any) {
      const msg = e?.body?.message || e?.message || "GitHub error";
      return res
        .status(200)
        .json({ ok: false, status: e?.status ?? 500, message: msg });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/runs/:id/open-fix-pr
// ---------------------------------------------------------------------------

interface OpenFixPrBody {
  patch: {
    path: string;
    content: string;
    message: string;
  };
  branch_base?: string;
}

v6Router.post(
  "/api/runs/:id/open-fix-pr",
  async (req: Request, res: Response, next: NextFunction) => {
    const token = requireToken(req, res);
    if (!token) return;

    const runId = Number(req.params.id);
    if (!Number.isFinite(runId)) {
      return res.status(400).json({ message: "Invalid run id" });
    }

    const repoFull = String(req.query.repo_full || REPO);
    if (!repoFull.includes("/")) {
      return res
        .status(400)
        .json({ message: "repo_full query param required (owner/repo)" });
    }

    const body = req.body as OpenFixPrBody;
    if (!body?.patch?.path || body?.patch?.content == null || !body?.patch?.message) {
      return res
        .status(400)
        .json({ message: "Body must include patch.path, patch.content, patch.message" });
    }

    const { patch, branch_base } = body;
    const branch = `dispatcher/fix-run-${runId}`;

    try {
      // 1. Determine base branch
      let baseBranch = branch_base;
      if (!baseBranch) {
        try {
          const repoData = await github(token, `/repos/${repoFull}`);
          baseBranch = repoData.data?.default_branch ?? "main";
        } catch {
          baseBranch = "main";
        }
      }

      // 2. Ensure fork
      const fork = await ensureFork(token, repoFull);

      // 3. Commit file
      await commitFileToBranch(token, {
        fork,
        upstream: repoFull,
        branch,
        baseBranch,
        filePath: patch.path,
        newContent: patch.content,
        message: patch.message,
      });

      // 4. Open PR
      const { html_url } = await openPullRequest(token, {
        upstream: repoFull,
        fork,
        branch,
        baseBranch,
        title: `fix: ${patch.message} (run #${runId})`,
        body: `Automated fix proposed by Run Intelligence for run #${runId}.\n\n${patch.message}`,
      });

      res.json({ pr_url: html_url, branch });
    } catch (e: any) {
      next(e);
    }
  },
);
