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
): Promise<BranchSummary[]> {
  const res = await apiRequest(
    "GET",
    `/api/branches?q=${encodeURIComponent(q)}`,
    undefined,
    authHeader,
  );
  const data = await res.json();
  return data.branches as BranchSummary[];
}

export async function fetchRuns(
  authHeader: Record<string, string>,
): Promise<RunSummary[]> {
  const res = await apiRequest("GET", "/api/runs", undefined, authHeader);
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
