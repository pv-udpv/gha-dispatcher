/**
 * githubRepos.ts — v4 multi-repo GitHub helpers.
 * Provides listUserRepos and fetchWorkflowsForRepo.
 */

import yaml from "js-yaml";
import type { WorkflowMeta, RepoSummary } from "@gha-dispatcher/shared";

const GH_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// Internal GitHub fetch helper (mirrors the one in routes.ts).
// ---------------------------------------------------------------------------
async function ghFetch(
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

// ---------------------------------------------------------------------------
// List repos the authenticated user has access to.
// Returns up to 50 repos sorted by pushed_at desc.
// ---------------------------------------------------------------------------
export async function listUserRepos(pat: string): Promise<RepoSummary[]> {
  const { data } = await ghFetch(
    pat,
    "/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=pushed&direction=desc",
  );

  const repos: any[] = Array.isArray(data) ? data : [];
  return repos.slice(0, 50).map((r) => ({
    full_name: r.full_name as string,
    default_branch: (r.default_branch as string) || "main",
    private: Boolean(r.private),
  }));
}

// ---------------------------------------------------------------------------
// Extract workflow_dispatch inputs from a YAML string.
// ---------------------------------------------------------------------------
function extractDispatchInputs(
  rawYaml: string,
): import("@gha-dispatcher/shared").DispatchInput[] {
  try {
    const doc: any = yaml.load(rawYaml);
    const dispatchDef = doc?.on?.workflow_dispatch ?? doc?.["on"]?.workflow_dispatch;
    if (!dispatchDef || !dispatchDef.inputs) return [];

    return Object.entries(dispatchDef.inputs).map(([name, spec]: [string, any]) => {
      const type = spec?.type ?? "string";
      return {
        name,
        description: spec?.description ?? "",
        type: ["string", "boolean", "choice", "environment", "number"].includes(type)
          ? type
          : "string",
        required: Boolean(spec?.required),
        default: spec?.default ?? null,
        options: Array.isArray(spec?.options) ? spec.options.map(String) : [],
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fetch all workflow_dispatch workflows for a given repo.
// ---------------------------------------------------------------------------
export async function fetchWorkflowsForRepo(
  pat: string,
  repoFull: string,
  defaultBranch: string = "main",
): Promise<WorkflowMeta[]> {
  let workflows: any[] = [];

  try {
    const { data } = await ghFetch(pat, `/repos/${repoFull}/actions/workflows?per_page=100`);
    workflows = Array.isArray(data?.workflows) ? data.workflows : [];
  } catch {
    return [];
  }

  // Fetch YAML in parallel (capped concurrency at 8).
  const results: WorkflowMeta[] = [];

  async function processOne(wf: any): Promise<void> {
    const path: string = wf.path ?? "";
    const name: string = wf.name ?? path;
    const state: string = wf.state ?? "active";

    let dispatchInputs: import("@gha-dispatcher/shared").DispatchInput[] = [];
    let has_dispatch = false;

    try {
      const { data: content } = await ghFetch(
        pat,
        `/repos/${repoFull}/contents/${path}?ref=${encodeURIComponent(defaultBranch)}`,
      );
      if (content?.content && content?.encoding === "base64") {
        const rawYaml = Buffer.from(content.content, "base64").toString("utf-8");
        const doc: any = yaml.load(rawYaml);
        const onBlock = doc?.on ?? doc?.["on"];
        has_dispatch = !!(onBlock?.workflow_dispatch !== undefined);
        if (has_dispatch) {
          dispatchInputs = extractDispatchInputs(rawYaml);
        }
      }
    } catch {
      // Silently skip — workflow may have no YAML or be inaccessible
    }

    results.push({
      name,
      path,
      state,
      dispatch_inputs: dispatchInputs,
      has_dispatch,
    });
  }

  // Run in batches of 8
  const batchSize = 8;
  for (let i = 0; i < workflows.length; i += batchSize) {
    const batch = workflows.slice(i, i + batchSize);
    await Promise.all(batch.map(processOne));
  }

  // Only include workflows that have workflow_dispatch
  return results.filter((w) => w.has_dispatch);
}
