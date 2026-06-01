import { Suspense, lazy } from "react";
import { TopBar } from "@/components/TopBar";
import { PatPanel } from "@/components/PatPanel";
import { WorkflowTabs } from "@/components/WorkflowTabs";
import { RecentRuns } from "@/components/RecentRuns";
import { useGithub } from "@/lib/github-context";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { DispatchResult } from "@/lib/api";

// Lazy-load EditorDrawer to keep the main bundle small (Monaco = ~4 MB)
const EditorDrawer = lazy(() =>
  import("@/components/EditorDrawer").then((m) => ({ default: m.EditorDrawer })),
);

export default function Home() {
  const { connected } = useGithub();
  const { toast } = useToast();

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
            <RecentRuns />
          </section>
        </main>
      )}

      {/* EditorDrawer — lazy-loaded, rendered at root so it overlays everything */}
      <Suspense fallback={null}>
        <EditorDrawer />
      </Suspense>
    </div>
  );
}
