import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { streamRouter } from "./routes-v5";
import { registerV4Routes } from "./routes-v4.js";
import { v6Router } from "./routes-v6.js";
import crypto from "node:crypto";
import {
  dispatchPayloadSchema,
  rerunRequestSchema,
  type WorkflowInventory,
  type RunSummary,
} from "@gha-dispatcher/shared";
import { supabase, DISPATCH_LOG_TABLE } from "./supabase";
// Bundle the workflow inventory directly into the build so enumeration works
// without any GitHub call and without a runtime file read.
import { workflowsCatalog as workflowsData } from "@gha-dispatcher/shared";

const REPO = process.env.GITHUB_REPO || "pv-udpv/pplx-lab";
const GH_API = "https://api.github.com";

const inventory = workflowsData as unknown as WorkflowInventory;

// ---------------------------------------------------------------------------
// GitHub helper — throws on non-2xx with a useful error body.
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
      "User-Agent": "gha-dispatcher",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });

  // 204 (No Content) has no body — common for workflow_dispatch.
  if (res.status === 204) return { status: 204, data: null };

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

// Extract the PAT from the Authorization: Bearer <pat> header.
function getToken(req: Request): string | null {
  const auth = req.header("authorization") || req.header("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function requireToken(req: Request, res: Response): string | null {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ message: "Missing GitHub PAT (Authorization: Bearer <pat>)" });
    return null;
  }
  return token;
}

function slimRun(r: any): RunSummary {
  return {
    id: r.id,
    name: r.name,
    head_branch: r.head_branch,
    status: r.status ?? null,
    conclusion: r.conclusion ?? null,
    actor: r.actor
      ? { login: r.actor.login, avatar_url: r.actor.avatar_url }
      : null,
    html_url: r.html_url,
    created_at: r.created_at,
    updated_at: r.updated_at,
    run_started_at: r.run_started_at ?? null,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// In-memory PAT-hash → user login cache (60s TTL).
// ---------------------------------------------------------------------------
const userLoginCache = new Map<string, { login: string; expiresAt: number }>();

function hashPat(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}

async function getCachedLogin(token: string): Promise<string | null> {
  const key = hashPat(token);
  const cached = userLoginCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.login;
  try {
    const { data } = await github(token, "/user");
    const login: string = data?.login ?? null;
    if (login) {
      userLoginCache.set(key, { login, expiresAt: Date.now() + 60_000 });
    }
    return login;
  } catch {
    return null;
  }
}

// Log a rerun/cancel action to dispatch_log (best-effort, non-blocking).
async function logRunAction(
  token: string,
  run_id: number,
  repo_slug: "_rerun" | "_cancel",
  workflow_name: string,
  run_url: string,
): Promise<void> {
  if (!supabase) return;
  const user_login = await getCachedLogin(token);
  void supabase
    .from(DISPATCH_LOG_TABLE)
    .insert({
      repo_slug,
      repo_full: REPO,
      workflow_name,
      run_id,
      run_url,
      status: "resolved",
      user_login,
    })
    .then(({ error }) => {
      if (error) console.error(`[${repo_slug}] supabase log error`, error.message);
    });
}

// Fetch a run's name for logging (best-effort).
async function fetchRunName(token: string, run_id: number): Promise<{ name: string; html_url: string }> {
  try {
    const { data } = await github(token, `/repos/${REPO}/actions/runs/${run_id}`);
    return { name: data?.name ?? String(run_id), html_url: data?.html_url ?? "" };
  } catch {
    return { name: String(run_id), html_url: "" };
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // -- v5 SSE log stream ---------------------------------------------------
  app.use(streamRouter);

  // -- v4 Multi-repo routes (repos, rules, cached inventories) -----------
  registerV4Routes(app);

  // -- v6 Run Intelligence (insight, rerun-debug, open-fix-pr) -----------
  app.use(v6Router);

  // -- Health --------------------------------------------------------------
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, repo: REPO });
  });

  // -- Workflows (bundled, no GitHub call) --------------------------------
  app.get("/api/workflows", (_req, res) => {
    res.json({
      owner: inventory.owner,
      repo: inventory.repo,
      default_branch: inventory.default_branch || "master",
      groups: inventory.groups,
    });
  });

  // -- Branches ------------------------------------------------------------
  app.get("/api/branches", async (req, res, next) => {
    const token = requireToken(req, res);
    if (!token) return;
    const q = String(req.query.q || "").toLowerCase();
    // v4: optional repo_full override
    const branchRepo = String(req.query.repo_full || REPO);
    try {
      const { data } = await github(
        token,
        `/repos/${branchRepo}/branches?per_page=100`,
      );
      const names: string[] = (Array.isArray(data) ? data : []).map(
        (b: any) => b.name,
      );
      const filtered = q
        ? names.filter((n) => n.toLowerCase().includes(q))
        : names;
      res.json({ branches: filtered.map((name) => ({ name })) });
    } catch (e) {
      next(e);
    }
  });

  // -- Recent runs ---------------------------------------------------------
  app.get("/api/runs", async (req, res, next) => {
    const token = requireToken(req, res);
    if (!token) return;
    // v4: optional repo_full override
    const runsRepo = String(req.query.repo_full || REPO);
    try {
      const { data } = await github(
        token,
        `/repos/${runsRepo}/actions/runs?per_page=20`,
      );
      const runs = (data?.workflow_runs || []).map(slimRun);
      res.json({ runs });
    } catch (e) {
      next(e);
    }
  });

  // -- Dispatch ------------------------------------------------------------
  app.post("/api/dispatch", async (req, res, next) => {
    const token = requireToken(req, res);
    if (!token) return;

    const parsed = dispatchPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ message: "Invalid dispatch payload", errors: parsed.error.flatten() });
    }
    const { workflow_file, workflow_name, group, ref, environment, inputs, repo_full: bodyRepo } =
      parsed.data;

    // v4: use repo from body if provided, fall back to env REPO.
    const targetRepo = bodyRepo || REPO;

    // GitHub workflow_dispatch only accepts string inputs declared in the
    // workflow; merge environment in only if the caller passed it.
    const ghInputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(inputs)) {
      ghInputs[k] = typeof v === "boolean" ? String(v) : String(v);
    }

    try {
      // Fire the dispatch. 204 = accepted.
      await github(
        token,
        `/repos/${targetRepo}/actions/workflows/${encodeURIComponent(workflow_file)}/dispatches`,
        {
          method: "POST",
          body: JSON.stringify({ ref, inputs: ghInputs }),
        },
      );

      // Look up the dispatching user (best-effort) for the log + run poll.
      let login: string | null = null;
      try {
        const me = await github(token, `/user`);
        login = me.data?.login ?? null;
      } catch {
        /* ignore */
      }

      // Write the queued row immediately.
      let logId: number | null = null;
      if (supabase) {
        const { data, error } = await supabase
          .from(DISPATCH_LOG_TABLE)
          .insert({
            user_login: login,
            repo_slug: group || null,
            repo_full: targetRepo,
            workflow_id: workflow_file,
            workflow_name: workflow_name || null,
            ref,
            environment: environment || null,
            inputs: ghInputs,
            status: "queued",
          })
          .select("id")
          .single();
        if (error) {
          console.error("[dispatch] supabase insert error", error.message);
        } else {
          logId = data?.id ?? null;
        }
      }

      // Respond immediately with the log id.
      res.json({ ok: true, dispatch_log_id: logId, status: "queued" });

      // Async-poll for the resolved run (10s x 1s), then update the row.
      if (logId && supabase) {
        void (async () => {
          for (let i = 0; i < 10; i++) {
            await sleep(1000);
            try {
              const actorQ = login ? `&actor=${encodeURIComponent(login)}` : "";
              const { data } = await github(
                token,
                `/repos/${targetRepo}/actions/runs?event=workflow_dispatch&per_page=10${actorQ}`,
              );
              const runs: any[] = data?.workflow_runs || [];
              const match = runs.find(
                (r) =>
                  r.head_branch === ref &&
                  (workflow_name ? r.name === workflow_name : true),
              );
              if (match) {
                await supabase
                  .from(DISPATCH_LOG_TABLE)
                  .update({
                    run_id: match.id,
                    run_url: match.html_url,
                    status: match.status || "queued",
                  })
                  .eq("id", logId);
                return;
              }
            } catch (e: any) {
              console.error("[dispatch] run poll error", e?.message);
            }
          }
        })();
      }
    } catch (e) {
      next(e);
    }
  });

  // -- File fetch (raw content from GitHub Contents API) -------------------
  app.get("/api/file", async (req, res, next) => {
    const token = requireToken(req, res);
    if (!token) return;

    const repo = String(req.query.repo || "");
    const path = String(req.query.path || "");
    const ref = String(req.query.ref || "master");

    if (!repo || !path) {
      return res.status(400).json({ message: "repo and path are required" });
    }

    try {
      const { data } = await github(
        token,
        `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      );
      res.json({
        content: data.content,
        sha: data.sha,
        encoding: data.encoding,
      });
    } catch (e) {
      next(e);
    }
  });

  // -- PR: ensure fork ------------------------------------------------------
  app.post("/api/pr/ensure-fork", async (req, res, next) => {
    const token = requireToken(req, res);
    if (!token) return;

    const { upstream } = req.body as { upstream: string };
    if (!upstream) return res.status(400).json({ message: "upstream is required" });

    try {
      // 1. Get the authenticated user's login
      const { data: me } = await github(token, "/user");
      const login: string = me.login;

      // 2. Derive the expected fork name (same as upstream repo name)
      const repoName = upstream.split("/")[1];
      const forkSlug = `${login}/${repoName}`;

      // 3. Check if the fork already exists
      try {
        await github(token, `/repos/${forkSlug}`);
        return res.json({ fork: forkSlug, existing: true });
      } catch (err: any) {
        if (err.status !== 404) throw err;
        // Fork doesn't exist — create it
      }

      // 4. Create the fork (GitHub responds with 202 Accepted)
      await github(token, `/repos/${upstream}/forks`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      // 5. Poll until the fork repo is ready (up to 30s)
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        try {
          await github(token, `/repos/${forkSlug}`);
          return res.json({ fork: forkSlug, existing: false });
        } catch (err: any) {
          if (err.status !== 404) throw err;
          // still not ready, continue polling
        }
      }

      return res.status(504).json({
        message: "Fork creation timed out after 30s. It may still be initializing — try again shortly.",
      });
    } catch (e) {
      next(e);
    }
  });

  // -- PR: commit file to fork branch ---------------------------------------
  app.post("/api/pr/commit", async (req, res, next) => {
    const token = requireToken(req, res);
    if (!token) return;

    const { fork, upstream, branch, baseBranch, filePath, newContent, message } =
      req.body as {
        fork: string;
        upstream: string;
        branch: string;
        baseBranch: string;
        filePath: string;
        newContent: string;
        message: string;
      };

    if (!fork || !upstream || !branch || !baseBranch || !filePath || newContent == null) {
      return res.status(400).json({ message: "Missing required commit fields" });
    }

    try {
      // 1. Get base ref SHA from the fork's default branch
      const { data: refData } = await github(
        token,
        `/repos/${fork}/git/refs/heads/${baseBranch}`,
      );
      const baseSha: string = refData.object.sha;

      // 2. Create new branch on fork (ignore 422 = already exists)
      try {
        await github(token, `/repos/${fork}/git/refs`, {
          method: "POST",
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
        });
      } catch (err: any) {
        if (err.status !== 422) throw err;
        // Branch already exists — proceed
      }

      // 3. Get current file SHA on the branch (may not exist)
      let currentFileSha: string | undefined;
      try {
        const { data: existing } = await github(
          token,
          `/repos/${fork}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
        );
        currentFileSha = existing.sha;
      } catch (err: any) {
        if (err.status !== 404) throw err;
        // File doesn't exist yet — no sha needed
      }

      // 4. PUT the new file content (base64-encode)
      const base64Content = Buffer.from(newContent, "utf-8").toString("base64");
      const putBody: Record<string, string> = {
        message,
        content: base64Content,
        branch,
      };
      if (currentFileSha) putBody.sha = currentFileSha;

      const { data: commitData } = await github(
        token,
        `/repos/${fork}/contents/${filePath}`,
        { method: "PUT", body: JSON.stringify(putBody) },
      );

      res.json({
        commitSha: commitData.commit?.sha || null,
        branch,
        fork,
      });
    } catch (e) {
      next(e);
    }
  });

  // -- PR: open pull request ------------------------------------------------
  app.post("/api/pr/open", async (req, res, next) => {
    const token = requireToken(req, res);
    if (!token) return;

    const { upstream, fork, branch, baseBranch, title, body } = req.body as {
      upstream: string;
      fork: string;
      branch: string;
      baseBranch: string;
      title: string;
      body: string;
    };

    if (!upstream || !fork || !branch || !baseBranch || !title) {
      return res.status(400).json({ message: "Missing required PR fields" });
    }

    try {
      const forkOwner = fork.split("/")[0];

      const { data } = await github(token, `/repos/${upstream}/pulls`, {
        method: "POST",
        body: JSON.stringify({
          title,
          body: body || "",
          head: `${forkOwner}:${branch}`,
          base: baseBranch,
          maintainer_can_modify: true,
        }),
      });

      const prNumber: number = data.number;
      const prUrl: string = data.html_url;

      // Log to dispatch_log (best-effort)
      if (supabase) {
        void supabase
          .from(DISPATCH_LOG_TABLE)
          .insert({
            repo_slug: "_pr",
            repo_full: upstream,
            workflow_id: branch,
            workflow_name: title,
            ref: baseBranch,
            run_url: prUrl,
            status: "resolved",
          })
          .then(({ error }) => {
            if (error) console.error("[pr/open] supabase log error", error.message);
          });
      }

      res.json({ number: prNumber, html_url: prUrl });
    } catch (e) {
      next(e);
    }
  });

  // -- Rerun all jobs in a run ---------------------------------------------
  app.post("/api/runs/:run_id/rerun", async (req, res) => {
    const token = requireToken(req, res);
    if (!token) return;
    const run_id = Number(req.params.run_id);
    if (!Number.isFinite(run_id)) {
      return res.status(400).json({ ok: false, message: "Invalid run_id" });
    }
    const parsed = rerunRequestSchema.safeParse(req.body);
    const enable_debug_logging = parsed.success ? parsed.data.enable_debug_logging : false;
    try {
      const { status } = await github(
        token,
        `/repos/${REPO}/actions/runs/${run_id}/rerun`,
        { method: "POST", body: JSON.stringify({ enable_debug_logging }) },
      );
      if (status === 201 || status === 204) {
        // Fire-and-forget log
        void fetchRunName(token, run_id).then(({ name, html_url }) =>
          logRunAction(token, run_id, "_rerun", name, html_url),
        );
        return res.status(200).json({ ok: true, run_id });
      }
      return res.status(200).json({ ok: false, status, message: "Unexpected GitHub status" });
    } catch (e: any) {
      const msg = e?.body?.message || e?.message || "GitHub error";
      return res.status(200).json({ ok: false, status: e?.status ?? 500, message: msg });
    }
  });

  // -- Rerun only failed jobs -----------------------------------------------
  app.post("/api/runs/:run_id/rerun-failed-jobs", async (req, res) => {
    const token = requireToken(req, res);
    if (!token) return;
    const run_id = Number(req.params.run_id);
    if (!Number.isFinite(run_id)) {
      return res.status(400).json({ ok: false, message: "Invalid run_id" });
    }
    const parsed = rerunRequestSchema.safeParse(req.body);
    const enable_debug_logging = parsed.success ? parsed.data.enable_debug_logging : false;
    try {
      const { status } = await github(
        token,
        `/repos/${REPO}/actions/runs/${run_id}/rerun-failed-jobs`,
        { method: "POST", body: JSON.stringify({ enable_debug_logging }) },
      );
      if (status === 201 || status === 204) {
        void fetchRunName(token, run_id).then(({ name, html_url }) =>
          logRunAction(token, run_id, "_rerun", name, html_url),
        );
        return res.status(200).json({ ok: true, run_id });
      }
      return res.status(200).json({ ok: false, status, message: "Unexpected GitHub status" });
    } catch (e: any) {
      const msg = e?.body?.message || e?.message || "GitHub error";
      return res.status(200).json({ ok: false, status: e?.status ?? 500, message: msg });
    }
  });

  // -- Cancel a run ---------------------------------------------------------
  app.post("/api/runs/:run_id/cancel", async (req, res) => {
    const token = requireToken(req, res);
    if (!token) return;
    const run_id = Number(req.params.run_id);
    if (!Number.isFinite(run_id)) {
      return res.status(400).json({ ok: false, message: "Invalid run_id" });
    }
    try {
      const { status } = await github(
        token,
        `/repos/${REPO}/actions/runs/${run_id}/cancel`,
        { method: "POST" },
      );
      if (status === 202) {
        void fetchRunName(token, run_id).then(({ name, html_url }) =>
          logRunAction(token, run_id, "_cancel", name, html_url),
        );
        return res.status(200).json({ ok: true, run_id });
      }
      return res.status(200).json({ ok: false, status, message: "Unexpected GitHub status" });
    } catch (e: any) {
      const msg = e?.body?.message || e?.message || "GitHub error";
      return res.status(200).json({ ok: false, status: e?.status ?? 500, message: msg });
    }
  });

  return httpServer;
}
