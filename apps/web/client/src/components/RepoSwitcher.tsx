/**
 * RepoSwitcher.tsx — combobox to switch between GitHub repos.
 * Uses shadcn Command + Popover.
 */

import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, RefreshCw, Lock } from "lucide-react";
import { useRepo } from "@/lib/repoContext";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";

export function RepoSwitcher() {
  const { currentRepoFull, setCurrentRepoFull, repos, reposLoading, refreshRepos } =
    useRepo();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((r) => r.full_name.toLowerCase().includes(q));
  }, [repos, search]);

  function selectRepo(fullName: string) {
    setCurrentRepoFull(fullName);
    setOpen(false);
    setSearch("");
    // Invalidate per-repo workflow cache so the new repo loads
    void queryClient.invalidateQueries({ queryKey: ["/api/repos", fullName] });
  }

  // Short label for the trigger button
  const label = currentRepoFull || "Select repo";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="max-w-[220px] justify-between font-mono text-xs font-normal"
          data-testid="button-repo-switcher"
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="end">
        <Command shouldFilter={false}>
          <div className="flex items-center border-b border-border">
            <CommandInput
              placeholder="Search repos…"
              value={search}
              onValueChange={setSearch}
              className="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              className="mr-1 h-8 w-8 shrink-0"
              onClick={() => refreshRepos()}
              title="Refresh repo list"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", reposLoading && "animate-spin")}
              />
            </Button>
          </div>

          <CommandList className="max-h-72">
            {!reposLoading && filtered.length === 0 && (
              <CommandEmpty>No repos found.</CommandEmpty>
            )}

            <CommandGroup>
              {filtered.map((repo) => (
                <CommandItem
                  key={repo.full_name}
                  value={repo.full_name}
                  onSelect={() => selectRepo(repo.full_name)}
                  className="flex items-center gap-2 font-mono text-xs"
                  data-testid={`repo-option-${repo.full_name}`}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      currentRepoFull === repo.full_name
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  <span className="flex-1 truncate">{repo.full_name}</span>
                  {repo.private && (
                    <Badge
                      variant="secondary"
                      className="h-4 px-1 py-0 text-[0.55rem] font-normal"
                    >
                      <Lock className="mr-0.5 h-2.5 w-2.5" />
                      private
                    </Badge>
                  )}
                </CommandItem>
              ))}

              {/* Always show current repo even if not in list */}
              {currentRepoFull &&
                !filtered.find((r) => r.full_name === currentRepoFull) && (
                  <CommandItem
                    key={currentRepoFull}
                    value={currentRepoFull}
                    onSelect={() => selectRepo(currentRepoFull)}
                    className="font-mono text-xs text-muted-foreground"
                  >
                    <Check className="mr-2 h-3.5 w-3.5 opacity-100" />
                    {currentRepoFull}
                    <Badge variant="outline" className="ml-auto text-[0.55rem]">
                      current
                    </Badge>
                  </CommandItem>
                )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
