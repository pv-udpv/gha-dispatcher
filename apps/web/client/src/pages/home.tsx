import { useState, Suspense, lazy } from "react";
import { TopBar } from "@/components/TopBar";
import { PatPanel } from "@/components/PatPanel";
import { WorkflowTabs } from "@/components/WorkflowTabs";
import { RecentRuns } from "@/components/RecentRuns";
import { LogStreamPanel } from "@/components/LogStreamPanel";
import { useGithub } from "@/lib/github-context";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { DispatchResult } from "@/lib/api";
import type { RunSummary } from "@gha-dispatcher/shared";

// Lazy-load EditorDrawer to keep the main bundle small (Monaco = ~4 MB)
const EditorDrawer = lazy(() =>
  import("@/components/EditorDrawer").then((m) => ({ default: m.EditorDrawer })),
);

/** Minimal run info needed to open the log stream panel. */
interface StreamTarget {
  runId: number;
  repoFull: string;
  htmlUrl: string;
}

export default function Home() {
  const { connected, pat } = useGithub();
  const { toast } = useToast();

  // Log stream panel state — null means closed
  const [streamTarget, setStreamTarget] = useState<StreamTarget | null>(null);

  const handleDispatched = (result: DispatchResult, workflowName: string) => {
    toast({
      title: "Dispatched ↗",
      description: `${workflowName} — queued. Watching recent runs…`,
    });
    // Nudge the runs list to refresh so the new run surfaces quickly.
    setTimeout(
      () => queryClient.invalidateQueries({ queryKey: ["/api/runs"] }),
      2500,
    );
    setTimeout(
      () => queryClient.invalidateQueries({ queryKey: ["/api/runs"] }),
      6000,
    );
  };

  /** Open the log stream panel for a specific run. */
  const handleViewLogs = (run: RunSummary) => {
    // Extract owner/repo from the html_url (https://github.com/owner/repo/actions/runs/…)
    // or fall back to the REPO env (server only knows one repo for now).
    // The html_url pattern is: https://github.com/<owner>/<repo>/actions/runs/<id>
    const match = run.html_url.match(/github\.com\/([^/]+\/[^/]+)\/actions/);
    const repoFull = match ? match[1] : null;

    if (!repoFull) {
      toast({
        title: "Cannot open log stream",
        description: "Could not determine repo from run URL.",
        variant: "destructive",
      });
      return;
    }

    setStreamTarget({ runId: run.id, repoFull, htmlUrl: run.html_url });
  };

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <TopBar />

      {!connected ? (
        <main className="min-h-0 flex-1">
          <PatPanel />
        </main>
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[3fr_2fr]">
          {/* Left 60% — workflow groups + dispatch form */}
          <section className="min-h-0 overflow-hidden border-b border-border lg:border-b-0 lg:border-r">
            <WorkflowTabs onDispatched={handleDispatched} />
          </section>
          {/* Right 40% — recent runs */}
          <section className="min-h-0 overflow-hidden">
            <RecentRuns onViewLogs={handleViewLogs} />
          </section>
        </main>
      )}

      {/* EditorDrawer — lazy-loaded, rendered at root so it overlays everything */}
      <Suspense fallback={null}>
        <EditorDrawer />
      </Suspense>

      {/* Log Stream Panel — rendered at root so it overlays everything */}
      <LogStreamPanel
        runId={streamTarget?.runId ?? null}
        repoFull={streamTarget?.repoFull ?? null}
        runHtmlUrl={streamTarget?.htmlUrl ?? null}
        pat={pat}
        onClose={() => setStreamTarget(null)}
      />
    </div>
  );
}
