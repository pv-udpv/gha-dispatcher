/**
 * prFlowV7.ts — GitHub PR-flow helpers extracted for v7 use.
 */

const GH_API = 'https://api.github.com';

async function ghFetch(
  token: string,
  path: string,
  opts: RequestInit = {},
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${GH_API}${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'gha-dispatcher',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
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
      (typeof data === 'string' ? data : '') ||
      res.statusText;
    const err: any = new Error(`GitHub ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  return { status: res.status, data };
}

export interface PrFlowResult {
  pr_url: string;
  pr_number: number;
}

/**
 * Opens a PR on `repoFull` that adds/updates `filePath` with `content`.
 * Branch name: `dispatcher/playbook/{branchSuffix}`
 */
export async function openPlaybookPr(
  token: string,
  repoFull: string,
  filePath: string,
  content: string,
  branchSuffix: string,
  prTitle: string,
  prBody: string,
): Promise<PrFlowResult> {
  // 1. Get default branch
  const { data: repoData } = await ghFetch(token, `/repos/${repoFull}`);
  const defaultBranch: string = repoData.default_branch ?? 'main';

  // 2. Get base SHA
  const { data: refData } = await ghFetch(
    token,
    `/repos/${repoFull}/git/refs/heads/${defaultBranch}`,
  );
  const baseSha: string = refData.object.sha;

  const branch = `dispatcher/playbook/${branchSuffix}`;

  // 3. Create branch (ignore 422 = already exists)
  try {
    await ghFetch(token, `/repos/${repoFull}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  } catch (err: any) {
    if (err.status !== 422) throw err;
  }

  // 4. Check for existing file SHA
  let currentSha: string | undefined;
  try {
    const { data: existing } = await ghFetch(
      token,
      `/repos/${repoFull}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
    );
    currentSha = existing.sha;
  } catch (err: any) {
    if (err.status !== 404) throw err;
  }

  // 5. Commit file
  const base64Content = Buffer.from(content, 'utf-8').toString('base64');
  const putBody: Record<string, string> = {
    message: `chore: update playbook ${branchSuffix} via gha-dispatcher`,
    content: base64Content,
    branch,
  };
  if (currentSha) putBody.sha = currentSha;

  await ghFetch(token, `/repos/${repoFull}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify(putBody),
  });

  // 6. Open PR (or find existing)
  try {
    const { data: prData } = await ghFetch(token, `/repos/${repoFull}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: prTitle,
        body: prBody,
        head: branch,
        base: defaultBranch,
        maintainer_can_modify: true,
      }),
    });
    return { pr_url: prData.html_url, pr_number: prData.number };
  } catch (err: any) {
    if (err.status === 422) {
      const { data: existing } = await ghFetch(
        token,
        `/repos/${repoFull}/pulls?head=${encodeURIComponent(branch)}&base=${defaultBranch}&state=open`,
      );
      if (Array.isArray(existing) && existing.length > 0) {
        return { pr_url: existing[0].html_url, pr_number: existing[0].number };
      }
    }
    throw err;
  }
}
