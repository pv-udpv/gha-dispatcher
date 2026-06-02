import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Workflow, Loader2, PencilLine, Settings2, AlertTriangle } from "lucide-react";
import type { WorkflowMeta } from "@gha-dispatcher/shared";
import { type DispatchResult } from "@/lib/api";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DispatchForm } from "./DispatchForm";
import { GroupRulesEditor } from "./GroupRulesEditor";
import { cn } from "@/lib/utils";
import { useGithub } from "@/lib/github-context";
import { useRepo } from "@/lib/repoContext";
import { apiRequest } from "@/lib/queryClient";
import type { WorkflowInventoryV2 } from "@gha-dispatcher/shared";

function fileBasename(path: string): string {
  return path.split("/").pop() || path;
}

interface Props {
  onDispatched: (result: DispatchResult, workflowName: string) => void;
}

// Fetch v2 inventory for a given repo
async function fetchRepoInventory(
  owner: string,
  repo: string,
  authHeader: Record<string, string>,
  refresh = false,
): Promise<WorkflowInventoryV2> {
  const res = await apiRequest(
    "GET",
    `/api/repos/${owner}/${repo}/workflows${refresh ? "?refresh=1" : ""}`,
    undefined,
    authHeader,
  );
  return res.json();
}

export function WorkflowTabs({ onDispatched }: Props) {
  const { setEditingWorkflow, authHeader, connected } = useGithub();
  const { currentRepoFull, currentTab, setCurrentTab } = useRepo();

  const [search, setSearch] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [rulesEditorOpen, setRulesEditorOpen] = useState(false);

  const [owner, repo] = currentRepoFull.split("/");

  // Fetch v2 inventory for the current repo
  const inventoryQ = useQuery<WorkflowInventoryV2>({
    queryKey: ["/api/repos", currentRepoFull, "workflows"],
    queryFn: () => fetchRepoInventory(owner, repo, authHeader()),
    enabled: connected && !!currentRepoFull,
    staleTime: 5 * 60_000, // 5 minutes
  });

  const groups = inventoryQ.data?.groups ?? {};
  const defaultBranch = inventoryQ.data?.default_branch ?? "main";

  // Ordered group labels: sorted by sort_order from API, _unmatched always last
  const groupLabels = useMemo(() => {
    const keys = Object.keys(groups);
    const regular = keys.filter((k) => k !== "_unmatched").sort();
    if (groups["_unmatched"]) regular.push("_unmatched");
    return regular;
  }, [groups]);

  // Default to first group if no tab selected or tab not available
  const activeTab = useMemo(() => {
    if (groupLabels.includes(currentTab)) return currentTab;
    return groupLabels[0] ?? "";
  }, [groupLabels, currentTab]);

  const list: WorkflowMeta[] = useMemo(() => {
    const items = groups[activeTab] ?? [];
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        fileBasename(w.path).toLowerCase().includes(q),
    );
  }, [groups, activeTab, search]);

  const selected = list.find((w) => w.path === selectedPath) ?? null;

  function handleTabChange(val: string) {
    setCurrentTab(val);
    setSelectedPath(null);
    setSearch("");
  }

  const isUnmatched = activeTab === "_unmatched";

  return (
    <div className="flex h-full flex-col">
      {/* Rules editor dialog */}
      <GroupRulesEditor
        open={rulesEditorOpen}
        onOpenChange={setRulesEditorOpen}
      />

      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex h-full flex-col"
      >
        <div className="shrink-0 border-b border-border px-4 pt-3 pb-0">
          <div className="flex items-center justify-between">
            <TabsList className="bg-transparent p-0 gap-1 flex-wrap">
              {inventoryQ.isLoading && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading…
                </div>
              )}

              {!inventoryQ.isLoading &&
                groupLabels.map((g) => (
                  <TabsTrigger
                    key={g}
                    value={g}
                    className={cn(
                      "gap-1.5 rounded-md px-3 py-1.5 font-mono text-xs data-[state=active]:bg-secondary",
                      g === "_unmatched" &&
                        "border border-yellow-500/40 text-yellow-600 dark:text-yellow-400",
                    )}
                    data-testid={`tab-${g}`}
                  >
                    {g === "_unmatched" ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : null}
                    {g}
                    <span className="rounded-full bg-muted px-1.5 text-[0.625rem] text-muted-foreground">
                      {groups[g]?.length ?? 0}
                    </span>
                  </TabsTrigger>
                ))}
            </TabsList>

            {/* Rules editor button */}
            {connected && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setRulesEditorOpen(true)}
                title="Edit group rules"
                data-testid="button-rules-editor"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Hint for unmatched tab */}
          {isUnmatched && (
            <p className="mb-1 text-[0.65rem] text-yellow-600 dark:text-yellow-400">
              These workflows matched no rule — click{" "}
              <button
                className="underline"
                onClick={() => setRulesEditorOpen(true)}
              >
                Edit rules
              </button>{" "}
              to classify them.
            </p>
          )}
        </div>

        {/* Search bar (all tabs) */}
        <div className="shrink-0 border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${(groups[activeTab]?.length ?? 0)} workflows…`}
              className="pl-9 text-sm"
              data-testid="input-workflow-search"
            />
          </div>
        </div>

        {/* List + form */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {inventoryQ.isLoading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading workflows for{" "}
              <span className="font-mono">{currentRepoFull}</span>…
            </div>
          )}

          {inventoryQ.isError && (
            <div className="p-4 text-xs text-destructive">
              Failed to load workflows:{" "}
              {(inventoryQ.error as Error)?.message}
            </div>
          )}

          {!inventoryQ.isLoading && !inventoryQ.isError && list.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <Workflow className="h-6 w-6 opacity-40" />
              {search ? "No workflows match your search." : "No workflows in this group."}
            </div>
          )}

          <ul className="divide-y divide-border" data-testid="list-workflows">
            {list.map((w) => {
              const isSelected = w.path === selectedPath;
              const file = fileBasename(w.path);
              return (
                <li key={w.path}>
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

                    {/* Edit icon */}
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
                      group={activeTab}
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
