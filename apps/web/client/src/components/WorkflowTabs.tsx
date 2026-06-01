import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Workflow, Loader2, PencilLine } from "lucide-react";
import type {
  WorkflowInventory,
  WorkflowMeta,
  WorkflowGroupKey,
} from "@gha-dispatcher/shared";
import { fetchWorkflows, type DispatchResult } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DispatchForm } from "./DispatchForm";
import { cn } from "@/lib/utils";
import { useGithub } from "@/lib/github-context";

const GROUP_ORDER: WorkflowGroupKey[] = ["pv-cargo", "pv-sandbox", "web"];

function fileBasename(path: string): string {
  return path.split("/").pop() || path;
}

interface Props {
  onDispatched: (result: DispatchResult, workflowName: string) => void;
}

export function WorkflowTabs({ onDispatched }: Props) {
  const [tab, setTab] = useState<WorkflowGroupKey>("pv-cargo");
  const [search, setSearch] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const { setEditingWorkflow } = useGithub();

  const wfQ = useQuery<WorkflowInventory>({
    queryKey: ["/api/workflows"],
    queryFn: fetchWorkflows,
    staleTime: Infinity,
  });

  const groups = wfQ.data?.groups;
  const defaultBranch = wfQ.data?.default_branch || "master";

  const list: WorkflowMeta[] = useMemo(() => {
    const items = groups?.[tab] || [];
    if (tab !== "web" || !search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        fileBasename(w.path).toLowerCase().includes(q),
    );
  }, [groups, tab, search]);

  const selected = list.find((w) => w.path === selectedPath) || null;

  const counts: Record<WorkflowGroupKey, number> = {
    "pv-cargo": groups?.["pv-cargo"]?.length ?? 0,
    "pv-sandbox": groups?.["pv-sandbox"]?.length ?? 0,
    web: groups?.web?.length ?? 0,
  };

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as WorkflowGroupKey);
          setSelectedPath(null);
        }}
        className="flex h-full flex-col"
      >
        <div className="shrink-0 border-b border-border px-4 pt-3 pb-0">
          <TabsList className="bg-transparent p-0 gap-1">
            {GROUP_ORDER.map((g) => (
              <TabsTrigger
                key={g}
                value={g}
                className="gap-1.5 rounded-md px-3 py-1.5 font-mono text-xs data-[state=active]:bg-secondary"
                data-testid={`tab-${g}`}
              >
                {g}
                <span className="rounded-full bg-muted px-1.5 text-[0.625rem] text-muted-foreground">
                  {counts[g]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Search (web tab only) */}
        {tab === "web" && (
          <div className="shrink-0 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search 55 web workflows…"
                className="pl-9 text-sm"
                data-testid="input-workflow-search"
              />
            </div>
          </div>
        )}

        {/* List + form share the scroll area */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {wfQ.isLoading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading workflows…
            </div>
          )}

          {!wfQ.isLoading && list.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Workflow className="h-6 w-6 opacity-40" />
              {tab === "web" && search
                ? "No workflows match your search."
                : "No workflows in this group."}
            </div>
          )}

          <ul className="divide-y divide-border" data-testid="list-workflows">
            {list.map((w) => {
              const isSelected = w.path === selectedPath;
              const file = fileBasename(w.path);
              return (
                <li key={w.path}>
                  {/* Row — group button and edit icon side by side */}
                  <div className="group relative flex items-center">
                    <button
                      onClick={() =>
                        setSelectedPath(isSelected ? null : w.path)
                      }
                      className={cn(
                        "hover-elevate flex h-9 flex-1 items-center gap-2 px-4 text-left",
                        isSelected && "bg-secondary",
                      )}
                      data-testid={`row-workflow-${file}`}
                    >
                      <Workflow
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isSelected ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span className="flex-1 truncate text-sm">{w.name}</span>
                      {w.dispatch_inputs.length > 0 && (
                        <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">
                          {w.dispatch_inputs.length} input
                          {w.dispatch_inputs.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </button>

                    {/* Edit icon — visible on row hover */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "absolute right-1 h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100",
                        "text-muted-foreground hover:text-foreground",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingWorkflow(w);
                      }}
                      aria-label={`Edit ${w.name}`}
                      data-testid={`button-edit-workflow-${file}`}
                    >
                      <PencilLine className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {isSelected && selected && (
                    <DispatchForm
                      workflow={selected}
                      group={tab}
                      defaultBranch={defaultBranch}
                      onDispatched={onDispatched}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Tabs>
    </div>
  );
}
