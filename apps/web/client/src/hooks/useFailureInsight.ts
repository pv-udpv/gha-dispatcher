/**
 * useFailureInsight — v6 Run Intelligence
 *
 * React Query hook that fetches a FailureInsight for a completed+failed run.
 * Only fires when the run is completed with a failure conclusion.
 */
import { useQuery } from "@tanstack/react-query";
import { useGithub } from "@/lib/github-context";
import { apiRequest } from "@/lib/queryClient";
import type { FailureInsight } from "@gha-dispatcher/shared";

interface UseFailureInsightOptions {
  runId: number | null;
  repoFull: string | null;
  status: string | null;
  conclusion: string | null;
  /** Set to false to fully disable the query (e.g. panel is closed). */
  enabled?: boolean;
}

export function useFailureInsight({
  runId,
  repoFull,
  status,
  conclusion,
  enabled = true,
}: UseFailureInsightOptions) {
  const { authHeader } = useGithub();

  const isFailure =
    status === "completed" &&
    (conclusion === "failure" || conclusion === "timed_out");

  return useQuery<FailureInsight>({
    queryKey: ["insight", runId, repoFull],
    queryFn: async () => {
      const headers = authHeader();
      // Also send as x-github-pat for backend compatibility
      const pat = headers["Authorization"]?.replace(/^Bearer\s+/i, "") ?? "";
      const res = await apiRequest(
        "GET",
        `/api/runs/${runId}/insight?repo_full=${encodeURIComponent(repoFull ?? "")}`,
        undefined,
        { ...headers, "x-github-pat": pat },
      );
      return res.json() as Promise<FailureInsight>;
    },
    enabled: enabled && !!runId && !!repoFull && isFailure,
    staleTime: 30 * 60 * 1000, // 30 min — matches server cache
    retry: 1,
  });
}
