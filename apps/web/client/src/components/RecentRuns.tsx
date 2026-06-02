import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, ListChecks, Globe } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { RunSummary } from "@gha-dispatcher/shared";
import { useGithub } from "@/lib/github-context";
import { useRepo } from "@/lib/repoContext";
import { fetchRuns } from "@/lib/api";
import { StatusIcon, resolveRunState } from "./StatusDot";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RunRowActions } from "./RunRowActions";
import { cn } from "@/lib/utils";

function relTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
      .replace("about ", "")
      .replace("less than a minute ago", "just now");
  } catch {
    return iso;
  }
}

// Short repo label for the chip
function repoChip(repoFull: string): string {
  const parts = repoFull.split("/");
  return parts[1] || repoFull;
}

interface RecentRunsProps {
  onViewLogs?: (run: RunSummary) => void;
}

export function RecentRuns({ onViewLogs }: RecentRunsProps) {
  const { connected, authHeader } = useGithub();
  const { currentRepoFull } = useRepo();
  const [hoveredRunId, setHoveredRunId] = useState<number | null>(null);
  // v4: toggle to show all repos vs just the current one
  const [allRepos, setAllRepos] = useState(false);

  const repoFilter = allRepos ? undefined : currentRepoFull;

  const runsQ = useQuery<RunSummary[]>({
    queryKey: ["/api/runs", repoFilter],
    queryFn: () => fetchRuns(authHeader(), repoFilter),
    enabled: connected,
    refetchInterval: connected ? 15_000 : false,
    staleTime: 10_000,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Recent runs</h2>
          {connected && (
            <span className="font-mono text-[0.625rem] text-muted-foreground hidden sm:inline">
              {allRepos ? "all repos" : currentRepoFull}
            </span>
          )}
        </div>
        {connected && (
          <div className="flex items-center gap-2">
            {/* All repos toggle */}
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 gap-1 px-2 text-[0.625rem] font-mono",
                allRepos
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setAllRepos((v) => !v)}
              title={allRepos ? "Filter to current repo" : "Show all repos"}
            >
              <Globe className="h-3 w-3" />
              {allRepos ? "all" : "repo"}
            </Button>

            <span className="flex items-center gap-1 font-mono text-[0.625rem] text-muted-foreground">
              <RefreshCw
                className={`h-3 w-3 ${runsQ.isFetching ? "animate-spin" : ""}`}
              />
              15s
            </span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!connected && (
          <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <ListChecks className="h-6 w-6 opacity-40" />
            Connect a PAT to see recent runs.
          </div>
        )}

        {connected && runsQ.isLoading && (
          <ul className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex h-11 items-center gap-2 px-4">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-12" />
              </li>
            ))}
          </ul>
        )}

        {connected && runsQ.isError && (
          <div className="p-4 text-xs text-destructive" data-testid="text-runs-error">
            {(runsQ.error as Error)?.message || "Failed to load runs."}
          </div>
        )}

        {connected && runsQ.data && runsQ.data.length === 0 && (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No runs yet.
          </div>
        )}

        {connected && runsQ.data && runsQ.data.length > 0 && (
          <ul className="divide-y divide-border" data-testid="list-runs">
            {runsQ.data.map((run) => {
              const state = resolveRunState(run.status, run.conclusion);
              return (
                <li
                  key={run.id}
                  className="group/row"
                  onMouseEnter={() => setHoveredRunId(run.id)}
                  onMouseLeave={() => setHoveredRunId(null)}
                >
                  <div
                    className="hover-elevate flex h-11 items-center gap-2.5 px-4"
                    data-testid={`row-run-${run.id}`}
                  >
                    <StatusIcon state={state} />
                    <a
                      href={run.html_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="min-w-0 flex-1 flex items-center gap-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm leading-tight">{run.name}</p>
                        <div className="flex items-center gap-1.5">
                          <span className="truncate rounded bg-muted px-1 font-mono text-[0.625rem] text-muted-foreground">
                            {run.head_branch}
                          </span>
                          {/* v4: repo chip when viewing all repos */}
                          {allRepos && run.html_url && (
                            <Badge
                              variant="outline"
                              className="shrink-0 h-3.5 px-1 py-0 font-mono text-[0.55rem] text-muted-foreground border-border/60"
                            >
                              {run.html_url.includes("github.com/")
                                ? run.html_url
                                    .split("github.com/")[1]
                                    ?.split("/actions")[0] ?? ""
                                : ""}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {run.actor && (
                        <img
                          src={run.actor.avatar_url}
                          alt={run.actor.login}
                          title={run.actor.login}
                          className="h-5 w-5 shrink-0 rounded-full border border-border"
                          loading="lazy"
                        />
                      )}
                      <span className="shrink-0 whitespace-nowrap font-mono text-[0.625rem] text-muted-foreground">
                        {relTime(run.created_at)}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100" />
                    </a>
                    <RunRowActions
                      run={run}
                      onViewLogs={onViewLogs}
                      isHovered={hoveredRunId === run.id}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
