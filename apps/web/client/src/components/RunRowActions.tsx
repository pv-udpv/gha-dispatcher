import { useEffect } from "react";
import {
  MoreVertical,
  ExternalLink,
  RotateCcw,
  RefreshCw,
  XCircle,
  Copy,
  Hash,
  ScrollText,
  Lightbulb,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useRunActions } from "@/hooks/useRunActions";
import type { RunSummary } from "@gha-dispatcher/shared";

// Statuses where a run can be re-run.
const RERUN_CONCLUSIONS = new Set(["failure", "cancelled", "timed_out"]);
const CANCEL_STATUSES = new Set(["queued", "in_progress", "waiting", "pending"]);

interface RunRowActionsProps {
  run: RunSummary;
  /** Called when the user requests to open the log stream panel. */
  onViewLogs?: (run: RunSummary) => void;
  /** True when this row is currently hovered (for keyboard shortcut activation). */
  isHovered?: boolean;
}

export function RunRowActions({ run, onViewLogs, isHovered }: RunRowActionsProps) {
  const { toast } = useToast();
  const { rerun, rerunFailed, cancel, isPending } = useRunActions();

  const canRerun =
    run.status === "completed" &&
    run.conclusion != null &&
    RERUN_CONCLUSIONS.has(run.conclusion);

  const canCancel = run.status != null && CANCEL_STATUSES.has(run.status);

  function handleRerun() {
    rerun({ run_id: run.id, html_url: run.html_url });
  }

  function handleRerunFailed() {
    rerunFailed({ run_id: run.id, html_url: run.html_url });
  }

  function handleCancel() {
    cancel({ run_id: run.id, html_url: run.html_url });
  }

  function handleCopyUrl() {
    navigator.clipboard.writeText(run.html_url).then(() => {
      toast({ title: "Run URL copied." });
    });
  }

  function handleCopyId() {
    navigator.clipboard.writeText(String(run.id)).then(() => {
      toast({ title: `Run ID ${run.id} copied.` });
    });
  }

  function handleViewLogs() {
    onViewLogs?.(run);
  }

  // Keyboard shortcuts — "L" (view logs) and "I" (why did this fail?) when hovered
  useEffect(() => {
    if (!isHovered) return;
    function onKeyDown(e: KeyboardEvent) {
      // Ignore when focus is inside an input/textarea/button
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        handleViewLogs();
      }
      if ((e.key === "i" || e.key === "I") && run.conclusion === "failure") {
        e.preventDefault();
        // Open the log stream panel — the insight card will appear automatically
        handleViewLogs();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHovered, run.id, run.conclusion]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 data-[state=open]:opacity-100"
          aria-label="Run actions"
          disabled={isPending}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {/* View logs (live stream panel) */}
        <DropdownMenuItem onClick={handleViewLogs}>
          <ScrollText className="h-4 w-4" />
          View logs
          <DropdownMenuShortcut>L</DropdownMenuShortcut>
        </DropdownMenuItem>

        {/* v6: Why did this fail? — only for failed runs */}
        {run.conclusion === "failure" && (
          <DropdownMenuItem onClick={handleViewLogs}>
            <Lightbulb className="h-4 w-4" />
            Why did this fail?
            <DropdownMenuShortcut>I</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}

        {/* Open on GitHub */}
        <DropdownMenuItem
          onClick={() => window.open(run.html_url, "_blank", "noopener")}
        >
          <ExternalLink className="h-4 w-4" />
          Open on GitHub
          <DropdownMenuShortcut>O</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Re-run */}
        <DropdownMenuItem
          onClick={handleRerun}
          disabled={!canRerun || isPending}
        >
          <RotateCcw className="h-4 w-4" />
          Re-run
          <DropdownMenuShortcut>R</DropdownMenuShortcut>
        </DropdownMenuItem>

        {/* Re-run failed jobs */}
        <DropdownMenuItem
          onClick={handleRerunFailed}
          disabled={!canRerun || isPending}
        >
          <RefreshCw className="h-4 w-4" />
          Re-run failed jobs only
        </DropdownMenuItem>

        {/* Cancel */}
        <DropdownMenuItem
          onClick={handleCancel}
          disabled={!canCancel || isPending}
          className="text-destructive focus:text-destructive"
        >
          <XCircle className="h-4 w-4" />
          Cancel
          <DropdownMenuShortcut>C</DropdownMenuShortcut>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Copy run URL */}
        <DropdownMenuItem onClick={handleCopyUrl}>
          <Copy className="h-4 w-4" />
          Copy run URL
        </DropdownMenuItem>

        {/* Copy run ID */}
        <DropdownMenuItem onClick={handleCopyId}>
          <Hash className="h-4 w-4" />
          Copy run ID
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
