/**
 * FailureInsightCard — v6 Run Intelligence
 *
 * Displays root-cause analysis, signal tags, and action buttons
 * for a failed GitHub Actions run.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertCircle,
  Brain,
  RefreshCw,
  RotateCcw,
  GitPullRequest,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useGithub } from "@/lib/github-context";
import { apiRequest } from "@/lib/queryClient";
import { useFailureInsight } from "@/hooks/useFailureInsight";
import type { FailureInsight, SuggestedAction } from "@gha-dispatcher/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function confidenceLabel(c: number): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  if (c >= 0.7) return { label: "high confidence", variant: "default" };
  if (c >= 0.4) return { label: "medium confidence", variant: "secondary" };
  return { label: "low confidence", variant: "outline" };
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    config: "Configuration",
    dependency: "Dependency",
    test: "Test failure",
    infra: "Infrastructure",
    timeout: "Timeout",
    oom: "Out of memory",
    permission: "Permission",
    unknown: "Unknown",
  };
  return map[cat] ?? cat;
}

const KIND_COLORS: Record<string, string> = {
  oom: "bg-red-500/20 text-red-300 border-red-500/30",
  timeout: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  python_tb: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  gh_action: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  npm_err: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  node_err: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  generic_stderr: "bg-muted text-muted-foreground border-border",
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

export function FailureInsightSkeleton() {
  return (
    <Card className="border-destructive/40 bg-destructive/5 mb-3 mx-0">
      <CardHeader className="pb-2 pt-3 px-4">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <Skeleton className="h-4 w-40" />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <p className="text-[0.65rem] text-muted-foreground italic animate-pulse">
          Analyzing failure…
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Patch confirm dialog
// ---------------------------------------------------------------------------

interface PatchDialogProps {
  open: boolean;
  patch: SuggestedAction | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function PatchDialog({ open, patch, onConfirm, onCancel, isPending }: PatchDialogProps) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open fix PR</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p className="mb-2 text-sm">
                This will fork the repo (if needed), commit the following patch, and open a pull request:
              </p>
              {patch?.body && (
                <pre className="text-xs bg-muted rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                  {patch.body}
                </pre>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isPending}>
            {isPending ? "Opening PR…" : "Open PR"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------------
// Action buttons
// ---------------------------------------------------------------------------

interface ActionButtonsProps {
  insight: FailureInsight;
  repoFull: string;
  onClose?: () => void;
}

function ActionButtons({ insight, repoFull, onClose }: ActionButtonsProps) {
  const { toast } = useToast();
  const { authHeader } = useGithub();
  const qc = useQueryClient();
  const [pendingPrAction, setPendingPrAction] = useState<SuggestedAction | null>(null);

  const actions = insight.analysis?.suggested_actions ?? [];

  const rerunDebugMutation = useMutation({
    mutationFn: async () => {
      const headers = authHeader();
      const pat = headers["Authorization"]?.replace(/^Bearer\s+/i, "") ?? "";
      const res = await apiRequest(
        "POST",
        `/api/runs/${insight.runId}/rerun-debug?repo_full=${encodeURIComponent(repoFull)}`,
        undefined,
        { ...headers, "x-github-pat": pat },
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Re-run with debug logging queued." });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      onClose?.();
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Rerun failed", description: e.message }),
  });

  const rerunFailedMutation = useMutation({
    mutationFn: async () => {
      const headers = authHeader();
      const res = await apiRequest(
        "POST",
        `/api/runs/${insight.runId}/rerun-failed-jobs`,
        { enable_debug_logging: false },
        headers,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Re-run failed jobs queued." });
      qc.invalidateQueries({ queryKey: ["/api/runs"] });
      onClose?.();
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Rerun failed", description: e.message }),
  });

  const openPrMutation = useMutation({
    mutationFn: async (action: SuggestedAction) => {
      // Parse patch from action.body
      // Expect body to be JSON with { path, content, message } OR plain text message
      let patch: { path: string; content: string; message: string };
      try {
        const parsed = JSON.parse(action.body ?? "{}");
        patch = {
          path: parsed.path ?? ".github/FIXME.md",
          content: parsed.content ?? action.body ?? "",
          message: parsed.message ?? action.label,
        };
      } catch {
        patch = {
          path: ".github/FIXME.md",
          content: action.body ?? action.label,
          message: action.label,
        };
      }

      const headers = authHeader();
      const pat = headers["Authorization"]?.replace(/^Bearer\s+/i, "") ?? "";
      const res = await apiRequest(
        "POST",
        `/api/runs/${insight.runId}/open-fix-pr?repo_full=${encodeURIComponent(repoFull)}`,
        { patch },
        { ...headers, "x-github-pat": pat },
      );
      return res.json() as Promise<{ pr_url: string; branch: string }>;
    },
    onSuccess: ({ pr_url }) => {
      toast({ title: "PR opened!", description: "Opening in new tab…" });
      window.open(pr_url, "_blank", "noopener,noreferrer");
    },
    onError: (e: Error) =>
      toast({ variant: "destructive", title: "Failed to open PR", description: e.message }),
  });

  const anyPending =
    rerunDebugMutation.isPending ||
    rerunFailedMutation.isPending ||
    openPrMutation.isPending;

  function handleAction(action: SuggestedAction) {
    switch (action.kind) {
      case "rerun_debug":
        rerunDebugMutation.mutate();
        break;
      case "rerun_failed_jobs":
        rerunFailedMutation.mutate();
        break;
      case "open_fix_pr":
        setPendingPrAction(action);
        break;
    }
  }

  function actionIcon(kind: string) {
    switch (kind) {
      case "rerun_debug":
        return <RotateCcw className="h-3 w-3" />;
      case "rerun_failed_jobs":
        return <RefreshCw className="h-3 w-3" />;
      case "open_fix_pr":
        return <GitPullRequest className="h-3 w-3" />;
      default:
        return null;
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {actions.map((action) => (
          <Button
            key={action.kind}
            variant={action.kind === "rerun_debug" ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[0.68rem] gap-1"
            disabled={anyPending}
            onClick={() => handleAction(action)}
          >
            {actionIcon(action.kind)}
            {action.label}
          </Button>
        ))}
      </div>

      <PatchDialog
        open={pendingPrAction !== null}
        patch={pendingPrAction}
        onConfirm={() => {
          if (pendingPrAction) {
            openPrMutation.mutate(pendingPrAction);
          }
          setPendingPrAction(null);
        }}
        onCancel={() => setPendingPrAction(null)}
        isPending={openPrMutation.isPending}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Insight card (loaded state)
// ---------------------------------------------------------------------------

interface InsightCardContentProps {
  insight: FailureInsight;
  repoFull: string;
  onClose?: () => void;
}

function InsightCardContent({ insight, repoFull, onClose }: InsightCardContentProps) {
  const { analysis, jobs } = insight;
  if (!analysis) return null;

  const conf = confidenceLabel(analysis.confidence);

  // Collect unique signal kinds
  const kindCounts = new Map<string, number>();
  for (const job of jobs) {
    for (const sig of job.signals) {
      kindCounts.set(sig.kind, (kindCounts.get(sig.kind) ?? 0) + 1);
    }
  }

  return (
    <Card className="border-destructive/50 bg-destructive/5 mb-3">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Run failed: {categoryLabel(analysis.category)}</span>
          {analysis.llm_used && (
            <Badge variant="outline" className="ml-auto text-[0.6rem] gap-0.5 h-4 px-1.5 shrink-0">
              <Brain className="h-2.5 w-2.5" />
              LLM
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 pb-3 space-y-2">
        {/* Root cause */}
        <p className="text-xs text-foreground/90 leading-relaxed">{analysis.root_cause}</p>

        {/* Confidence + signal tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={conf.variant} className="text-[0.6rem] h-4 px-1.5">
            {conf.label}
          </Badge>

          {Array.from(kindCounts.entries()).map(([kind, count]) => (
            <span
              key={kind}
              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.58rem] font-mono ${KIND_COLORS[kind] ?? KIND_COLORS.generic_stderr}`}
            >
              {kind} {count > 1 ? `×${count}` : ""}
            </span>
          ))}
        </div>

        {/* Action buttons */}
        <ActionButtons insight={insight} repoFull={repoFull} onClose={onClose} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

export interface FailureInsightCardProps {
  runId: number;
  repoFull: string;
  status: string | null;
  conclusion: string | null;
  /** Called after a successful rerun action to close the panel. */
  onClose?: () => void;
}

export function FailureInsightCard({
  runId,
  repoFull,
  status,
  conclusion,
  onClose,
}: FailureInsightCardProps) {
  const { data, isLoading, isError } = useFailureInsight({
    runId,
    repoFull,
    status,
    conclusion,
  });

  if (isLoading) {
    return <FailureInsightSkeleton />;
  }

  if (isError) {
    return (
      <Card className="border-destructive/30 bg-destructive/5 mb-3">
        <CardContent className="px-4 py-3 text-xs text-destructive">
          Could not load failure analysis. Check console for details.
        </CardContent>
      </Card>
    );
  }

  if (!data?.analysis) return null;

  return (
    <InsightCardContent insight={data} repoFull={repoFull} onClose={onClose} />
  );
}
