import { useState, useCallback } from "react";
import { useGithub } from "@/lib/github-context";
import type { EditorSource } from "@/lib/github-context";

export type PrStatus =
  | "idle"
  | "forking"
  | "committing"
  | "opening"
  | "success"
  | "error";

interface PrFlowState {
  status: PrStatus;
  prUrl: string | null;
  error: string | null;
}

interface OpenPrArgs {
  sourceRepo: string;
  filePath: string;
  newContent: string;
  title: string;
  body: string;
  baseBranch: string;
}

async function apiPost<T>(url: string, body: unknown, auth: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...auth,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// Deterministic branch name from filePath + timestamp
async function makeBranchName(filePath: string): Promise<string> {
  const raw = filePath + Date.now();
  const buf = new TextEncoder().encode(raw);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  const hex = hashArr.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `dispatcher/edit/${hex.slice(0, 8)}`;
}

export function usePrFlow() {
  const { authHeader } = useGithub();
  const [state, setState] = useState<PrFlowState>({
    status: "idle",
    prUrl: null,
    error: null,
  });

  const reset = useCallback(() => {
    setState({ status: "idle", prUrl: null, error: null });
  }, []);

  const openPr = useCallback(
    async ({ sourceRepo, filePath, newContent, title, body, baseBranch }: OpenPrArgs) => {
      const auth = authHeader();
      setState({ status: "forking", prUrl: null, error: null });

      try {
        // 1. Ensure fork
        const forkRes = await apiPost<{ fork: string; existing: boolean }>(
          "/api/pr/ensure-fork",
          { upstream: sourceRepo },
          auth,
        );
        const { fork } = forkRes;

        // 2. Build branch name
        const branch = await makeBranchName(filePath);

        setState({ status: "committing", prUrl: null, error: null });

        // 3. Commit file
        await apiPost<{ commitSha: string; branch: string; fork: string }>(
          "/api/pr/commit",
          {
            fork,
            upstream: sourceRepo,
            branch,
            baseBranch,
            filePath,
            newContent,
            message: `Edit ${filePath}`,
          },
          auth,
        );

        setState({ status: "opening", prUrl: null, error: null });

        // 4. Open PR
        const prRes = await apiPost<{ number: number; html_url: string }>(
          "/api/pr/open",
          {
            upstream: sourceRepo,
            fork,
            branch,
            baseBranch,
            title,
            body,
          },
          auth,
        );

        setState({ status: "success", prUrl: prRes.html_url, error: null });
      } catch (e: any) {
        setState({ status: "error", prUrl: null, error: e?.message || "Unknown error" });
      }
    },
    [authHeader],
  );

  return { ...state, openPr, reset };
}
