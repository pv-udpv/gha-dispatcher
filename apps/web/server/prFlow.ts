/**
 * prFlow.ts — v6 shared PR flow helpers
 *
 * Extracted from routes.ts so both the existing PR endpoints and the new
 * v6 open-fix-pr endpoint can share the same GitHub orchestration logic.
 *
 * These are pure functions — they take a PAT and repo parameters and call
 * the GitHub API directly. They do NOT register any Express routes.
 */

const GH_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// Internal GitHub helper (mirrors the one in routes.ts — kept local to avoid
// circular imports and coupling to the Express request/response cycle).
// ---------------------------------------------------------------------------

async function github(
  token: string,
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; data: any }> {
  const url = path.startsWith("http") ? path : `${GH_API}${path}`;
  const res = await fetch(url, {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Ensure a fork of `upstream` exists under the authenticated user.
 * Creates it if missing and polls until ready (up to 30s).
 * Returns the fork slug (owner/repo).
 */
export async function ensureFork(
  token: string,
  upstream: string,
): Promise<string> {
  const { data: me } = await github(token, "/user");
  const login: string = me.login;
  const repoName = upstream.split("/")[1];
  const forkSlug = `${login}/${repoName}`;

  // Check if fork already exists
  try {
    await github(token, `/repos/${forkSlug}`);
    return forkSlug;
  } catch (err: any) {
    if (err.status !== 404) throw err;
  }

  // Create fork
  await github(token, `/repos/${upstream}/forks`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  // Poll until ready
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      await github(token, `/repos/${forkSlug}`);
      return forkSlug;
    } catch (err: any) {
      if (err.status !== 404) throw err;
    }
  }

  throw Object.assign(
    new Error("Fork creation timed out after 30s. It may still be initializing — try again shortly."),
    { status: 504 },
  );
}

/**
 * Commit a single file to a new branch on a fork.
 * Creates the branch from `baseBranch` (or the fork's default) if it doesn't
 * already exist.
 */
export async function commitFileToBranch(
  token: string,
  opts: {
    fork: string;
    upstream: string;
    branch: string;
    baseBranch: string;
    filePath: string;
    newContent: string;
    message: string;
  },
): Promise<{ commitSha: string; branch: string; fork: string }> {
  const { fork, branch, baseBranch, filePath, newContent, message } = opts;

  // Get base ref SHA
  const { data: refData } = await github(
    token,
    `/repos/${fork}/git/refs/heads/${baseBranch}`,
  );
  const baseSha: string = refData.object.sha;

  // Create branch (ignore 422 = already exists)
  try {
    await github(token, `/repos/${fork}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  } catch (err: any) {
    if (err.status !== 422) throw err;
  }

  // Get current file SHA if it exists
  let currentFileSha: string | undefined;
  try {
    const { data: existing } = await github(
      token,
      `/repos/${fork}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
    );
    currentFileSha = existing.sha;
  } catch (err: any) {
    if (err.status !== 404) throw err;
  }

  // PUT new content
  const base64Content = Buffer.from(newContent, "utf-8").toString("base64");
  const putBody: Record<string, string> = { message, content: base64Content, branch };
  if (currentFileSha) putBody.sha = currentFileSha;

  const { data: commitData } = await github(
    token,
    `/repos/${fork}/contents/${filePath}`,
    { method: "PUT", body: JSON.stringify(putBody) },
  );

  return { commitSha: commitData.commit?.sha ?? "", branch, fork };
}

/**
 * Open a pull request from a fork branch to the upstream base branch.
 * Returns the PR number and html_url.
 */
export async function openPullRequest(
  token: string,
  opts: {
    upstream: string;
    fork: string;
    branch: string;
    baseBranch: string;
    title: string;
    body: string;
  },
): Promise<{ number: number; html_url: string }> {
  const { upstream, fork, branch, baseBranch, title, body } = opts;
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

  return { number: data.number, html_url: data.html_url };
}
