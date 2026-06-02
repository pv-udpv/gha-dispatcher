/**
 * routes-v4.ts — v4 multi-repo API routes.
 *
 * Registers:
 *   GET  /api/repos
 *   GET  /api/repos/:owner/:repo/workflows?refresh=0|1
 *   GET  /api/repos/:owner/:repo/rules
 *   POST /api/repos/:owner/:repo/rules
 *   PATCH  /api/rules/:id
 *   DELETE /api/rules/:id
 *   POST /api/repos/:owner/:repo/rules/preview
 *
 * Also patches /api/dispatches (recent dispatch logs) to support ?repo_full filter.
 */

import type { Express, Request, Response, NextFunction } from "express";
import {
  repoFullSchema,
  createGroupRuleSchema,
  patchGroupRuleSchema,
  previewRulesSchema,
  dispatchPayloadSchema,
} from "@gha-dispatcher/shared";
import { listUserRepos, fetchWorkflowsForRepo } from "./githubRepos.js";
import { getRules, applyRules, upsertRule, patchRule, deleteRule } from "./groupRules.js";
import { getCachedInventory, cacheInventory } from "./repoCache.js";
import { supabase, DISPATCH_LOG_TABLE } from "./supabase.js";

// ---------------------------------------------------------------------------
// Helper — extract PAT from Authorization: Bearer <pat> header.
// ---------------------------------------------------------------------------
function getToken(req: Request): string | null {
  const auth = req.header("authorization") || req.header("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function requireToken(req: Request, res: Response): string | null {
  const token = getToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing GitHub PAT (Authorization: Bearer <pat>)" });
    return null;
  }
  return token;
}

// ---------------------------------------------------------------------------
// Register all v4 routes onto the Express app.
// ---------------------------------------------------------------------------
export function registerV4Routes(app: Express): void {

  // -------------------------------------------------------------------------
  // GET /api/repos — list user's repos (up to 50)
  // -------------------------------------------------------------------------
  app.get("/api/repos", async (req: Request, res: Response, next: NextFunction) => {
    const token = requireToken(req, res);
    if (!token) return;
    try {
      const repos = await listUserRepos(token);
      res.json({ repos });
    } catch (e) {
      next(e);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/repos/:owner/:repo/workflows?refresh=0|1
  // Returns WorkflowInventoryV2 (cached unless refresh=1).
  // -------------------------------------------------------------------------
  app.get(
    "/api/repos/:owner/:repo/workflows",
    async (req: Request, res: Response, next: NextFunction) => {
      const token = requireToken(req, res);
      if (!token) return;

      const { owner, repo } = req.params;
      const repoFull = `${owner}/${repo}`;
      const rfParse = repoFullSchema.safeParse(repoFull);
      if (!rfParse.success) {
        return res.status(400).json({ error: "Invalid repo" });
      }

      const forceRefresh = req.query.refresh === "1";

      try {
        // Try cache first
        const cached = await getCachedInventory(repoFull, forceRefresh);
        if (cached) {
          return res.json(cached);
        }

        // Fetch from GitHub
        // We need default_branch — fetch repo metadata first
        let defaultBranch = "main";
        try {
          const ghRes = await fetch(
            `https://api.github.com/repos/${repoFull}`,
            {
              headers: {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                Authorization: `Bearer ${token}`,
                "User-Agent": "gha-dispatcher",
              },
            },
          );
          if (ghRes.ok) {
            const meta = await ghRes.json();
            defaultBranch = meta.default_branch || "main";
          }
        } catch {
          // ignore, use default
        }

        const workflows = await fetchWorkflowsForRepo(token, repoFull, defaultBranch);
        const rules = await getRules(repoFull);
        const groups = applyRules(workflows, rules);

        const inventory = {
          repo_full: repoFull,
          fetched_at: new Date().toISOString(),
          default_branch: defaultBranch,
          workflows,
          groups,
        };

        // Cache async (non-blocking)
        void cacheInventory(repoFull, inventory);

        res.json(inventory);
      } catch (e) {
        next(e);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/repos/:owner/:repo/rules
  // -------------------------------------------------------------------------
  app.get(
    "/api/repos/:owner/:repo/rules",
    async (req: Request, res: Response, next: NextFunction) => {
      const { owner, repo } = req.params;
      const repoFull = `${owner}/${repo}`;
      const rfParse = repoFullSchema.safeParse(repoFull);
      if (!rfParse.success) {
        return res.status(400).json({ error: "Invalid repo" });
      }

      try {
        const rules = await getRules(repoFull);
        res.json({ rules });
      } catch (e) {
        next(e);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/repos/:owner/:repo/rules — create a rule
  // -------------------------------------------------------------------------
  app.post(
    "/api/repos/:owner/:repo/rules",
    async (req: Request, res: Response, next: NextFunction) => {
      const token = requireToken(req, res);
      if (!token) return;

      const { owner, repo } = req.params;
      const repoFull = `${owner}/${repo}`;
      const rfParse = repoFullSchema.safeParse(repoFull);
      if (!rfParse.success) {
        return res.status(400).json({ error: "Invalid repo" });
      }

      const parsed = createGroupRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid rule body", details: parsed.error.flatten() });
      }

      const { label, pattern_regex, sort_order } = parsed.data;

      // Validate regex compiles
      try {
        new RegExp(pattern_regex);
      } catch {
        return res.status(400).json({ error: "pattern_regex is not a valid regular expression" });
      }

      try {
        const rule = await upsertRule(repoFull, label, pattern_regex, sort_order ?? 100);
        if (!rule) return res.status(500).json({ error: "Failed to create rule" });
        res.status(201).json({ rule });
      } catch (e) {
        next(e);
      }
    },
  );

  // -------------------------------------------------------------------------
  // PATCH /api/rules/:id — update a rule
  // -------------------------------------------------------------------------
  app.patch(
    "/api/rules/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      const token = requireToken(req, res);
      if (!token) return;

      const id = String(req.params.id);
      const parsed = patchGroupRuleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid patch body", details: parsed.error.flatten() });
      }

      // Validate regex if provided
      if (parsed.data.pattern_regex) {
        try {
          new RegExp(parsed.data.pattern_regex);
        } catch {
          return res.status(400).json({ error: "pattern_regex is not a valid regular expression" });
        }
      }

      try {
        const rule = await patchRule(id, parsed.data);
        if (!rule) return res.status(404).json({ error: "Rule not found" });
        res.json({ rule });
      } catch (e) {
        next(e);
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /api/rules/:id
  // -------------------------------------------------------------------------
  app.delete(
    "/api/rules/:id",
    async (req: Request, res: Response, next: NextFunction) => {
      const token = requireToken(req, res);
      if (!token) return;

      const id = String(req.params.id);
      try {
        const ok = await deleteRule(id);
        if (!ok) return res.status(404).json({ error: "Rule not found or delete failed" });
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/repos/:owner/:repo/rules/preview
  // In-memory grouping preview (does not persist anything).
  // -------------------------------------------------------------------------
  app.post(
    "/api/repos/:owner/:repo/rules/preview",
    async (req: Request, res: Response, next: NextFunction) => {
      const { owner, repo } = req.params;
      const repoFull = `${owner}/${repo}`;
      const rfParse = repoFullSchema.safeParse(repoFull);
      if (!rfParse.success) {
        return res.status(400).json({ error: "Invalid repo" });
      }

      const parsed = previewRulesSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid preview body", details: parsed.error.flatten() });
      }

      try {
        // Get cached inventory for workflow list (no GitHub call needed for preview)
        const cached = await getCachedInventory(repoFull, false);
        const workflows = cached?.workflows ?? [];

        const groups = applyRules(workflows, parsed.data.rules);
        res.json({ groups });
      } catch (e) {
        next(e);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/dispatches — recent dispatch log rows, filterable by repo_full
  // -------------------------------------------------------------------------
  app.get(
    "/api/dispatches",
    async (req: Request, res: Response, next: NextFunction) => {
      if (!supabase) return res.json({ dispatches: [] });

      const repoFullFilter = req.query.repo_full as string | undefined;
      const limit = Math.min(Number(req.query.limit || "50"), 200);

      try {
        let query = supabase
          .from(DISPATCH_LOG_TABLE)
          .select("*")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (repoFullFilter) {
          const rfParse = repoFullSchema.safeParse(repoFullFilter);
          if (!rfParse.success) {
            return res.status(400).json({ error: "Invalid repo_full filter" });
          }
          query = query.eq("repo_full", rfParse.data);
        }

        const { data, error } = await query;
        if (error) throw new Error(error.message);
        res.json({ dispatches: data || [] });
      } catch (e) {
        next(e);
      }
    },
  );
}
