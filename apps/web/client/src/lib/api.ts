import { apiRequest } from "./queryClient";
import type {
  WorkflowInventory,
  BranchSummary,
  RunSummary,
  DispatchPayload,
} from "@gha-dispatcher/shared";

export async function fetchWorkflows(): Promise<WorkflowInventory> {
  const res = await apiRequest("GET", "/api/workflows");
  return res.json();
}

export async function fetchBranches(
  q: string,
  authHeader: Record<string, string>,
  repoFull?: string,
): Promise<BranchSummary[]> {
  const params = new URLSearchParams({ q });
  if (repoFull) params.set("repo_full", repoFull);
  const res = await apiRequest(
    "GET",
    `/api/branches?${params.toString()}`,
    undefined,
    authHeader,
  );
  const data = await res.json();
  return data.branches as BranchSummary[];
}

export async function fetchRuns(
  authHeader: Record<string, string>,
  repoFull?: string,
): Promise<RunSummary[]> {
  const params = repoFull ? `?repo_full=${encodeURIComponent(repoFull)}` : "";
  const res = await apiRequest("GET", `/api/runs${params}`, undefined, authHeader);
  const data = await res.json();
  return data.runs as RunSummary[];
}

export interface DispatchResult {
  ok: boolean;
  dispatch_log_id: number | null;
  status: string;
}

export async function dispatchWorkflow(
  payload: DispatchPayload,
  authHeader: Record<string, string>,
): Promise<DispatchResult> {
  const res = await apiRequest(
    "POST",
    "/api/dispatch",
    payload,
    authHeader,
  );
  return res.json();
}
