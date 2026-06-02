/**
 * GroupRulesEditor.tsx — Dialog for viewing/editing group rules.
 *
 * Features:
 *  - Table of current rules with edit / delete
 *  - Add rule form (label, regex, sort_order)
 *  - Live preview pane showing how workflows would be grouped
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Trash2,
  Plus,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  GripVertical,
  Pencil,
  X,
} from "lucide-react";
import { useRepo } from "@/lib/repoContext";
import { useGithub } from "@/lib/github-context";
import { apiRequest } from "@/lib/queryClient";
import type { GroupRule, GroupedWorkflows } from "@gha-dispatcher/shared";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

interface RuleFormState {
  label: string;
  pattern_regex: string;
  sort_order: string;
}

const emptyForm = (): RuleFormState => ({
  label: "",
  pattern_regex: "",
  sort_order: "100",
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function GroupRulesEditor({ open, onOpenChange }: Props) {
  const { currentRepoFull, currentTab } = useRepo();
  const { authHeader } = useGithub();
  const qc = useQueryClient();

  const [owner, repo] = currentRepoFull.split("/");

  // Form state for adding a new rule
  const [addForm, setAddForm] = useState<RuleFormState>(emptyForm);
  const [addError, setAddError] = useState<string | null>(null);

  // Editing existing rule (in-line)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RuleFormState>(emptyForm);

  // Live preview
  const [preview, setPreview] = useState<GroupedWorkflows | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // -------------------------------------------------------------------------
  // Fetch rules
  // -------------------------------------------------------------------------
  const rulesQ = useQuery<GroupRule[]>({
    queryKey: ["/api/repos", currentRepoFull, "rules"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/repos/${owner}/${repo}/rules`,
        undefined,
        authHeader(),
      );
      const d = await res.json();
      return d.rules as GroupRule[];
    },
    enabled: open && !!currentRepoFull,
  });

  const rules = rulesQ.data ?? [];

  // -------------------------------------------------------------------------
  // Live preview — debounced
  // -------------------------------------------------------------------------
  const fetchPreview = useCallback(
    async (localRules: GroupRule[]) => {
      setPreviewLoading(true);
      try {
        const res = await apiRequest(
          "POST",
          `/api/repos/${owner}/${repo}/rules/preview`,
          { rules: localRules },
          authHeader(),
        );
        const d = await res.json();
        setPreview(d.groups as GroupedWorkflows);
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    },
    [owner, repo, authHeader],
  );

  useEffect(() => {
    if (!open || rules.length === 0) return;
    const tid = setTimeout(() => fetchPreview(rules), 300);
    return () => clearTimeout(tid);
  }, [open, rules, fetchPreview]);

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------
  const addMutation = useMutation({
    mutationFn: async (form: RuleFormState) => {
      const res = await apiRequest(
        "POST",
        `/api/repos/${owner}/${repo}/rules`,
        {
          label: form.label.trim(),
          pattern_regex: form.pattern_regex.trim(),
          sort_order: Number(form.sort_order) || 100,
        },
        authHeader(),
      );
      return res.json();
    },
    onSuccess: () => {
      setAddForm(emptyForm());
      setAddError(null);
      void qc.invalidateQueries({ queryKey: ["/api/repos", currentRepoFull, "rules"] });
    },
    onError: (e: any) => setAddError(e?.message || "Failed to add rule"),
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: RuleFormState }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/rules/${id}`,
        {
          label: form.label.trim(),
          pattern_regex: form.pattern_regex.trim(),
          sort_order: Number(form.sort_order) || 100,
        },
        authHeader(),
      );
      return res.json();
    },
    onSuccess: () => {
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ["/api/repos", currentRepoFull, "rules"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/rules/${id}`, undefined, authHeader());
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/repos", currentRepoFull, "rules"] });
    },
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  function startEdit(rule: GroupRule) {
    setEditingId(rule.id);
    setEditForm({
      label: rule.label,
      pattern_regex: rule.pattern_regex,
      sort_order: String(rule.sort_order),
    });
  }

  function handleAdd() {
    if (!addForm.label.trim()) {
      setAddError("Label is required");
      return;
    }
    if (!isValidRegex(addForm.pattern_regex)) {
      setAddError("Pattern is not a valid regular expression");
      return;
    }
    addMutation.mutate(addForm);
  }

  function handlePatch(id: string) {
    if (!editForm.label.trim() || !isValidRegex(editForm.pattern_regex)) return;
    patchMutation.mutate({ id, form: editForm });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Group Rules</DialogTitle>
          <DialogDescription>
            Define regex rules to classify workflows into labeled groups for{" "}
            <span className="font-mono text-foreground">{currentRepoFull}</span>.
            Rules are evaluated in sort-order; first match wins.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden">
          {/* ------------------------------------------------------------------ */}
          {/* Left: Rules table                                                   */}
          {/* ------------------------------------------------------------------ */}
          <div className="flex w-[55%] flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto rounded-md border border-border">
              {rulesQ.isLoading && (
                <p className="p-4 text-xs text-muted-foreground">Loading rules…</p>
              )}
              {!rulesQ.isLoading && rules.length === 0 && (
                <p className="p-4 text-xs text-muted-foreground">
                  No rules yet. Add one below.
                </p>
              )}

              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex items-start gap-2 border-b border-border p-2 last:border-0"
                >
                  <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />

                  {editingId === rule.id ? (
                    /* Inline edit form */
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Input
                        value={editForm.label}
                        onChange={(e) =>
                          setEditForm((p) => ({ ...p, label: e.target.value }))
                        }
                        placeholder="label"
                        className="h-7 font-mono text-xs"
                      />
                      <Input
                        value={editForm.pattern_regex}
                        onChange={(e) =>
                          setEditForm((p) => ({ ...p, pattern_regex: e.target.value }))
                        }
                        placeholder="regex pattern"
                        className={cn(
                          "h-7 font-mono text-xs",
                          !isValidRegex(editForm.pattern_regex) && editForm.pattern_regex
                            ? "border-destructive"
                            : "",
                        )}
                      />
                      <Input
                        value={editForm.sort_order}
                        onChange={(e) =>
                          setEditForm((p) => ({ ...p, sort_order: e.target.value }))
                        }
                        placeholder="sort order"
                        type="number"
                        className="h-7 font-mono text-xs"
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => handlePatch(rule.id)}
                          disabled={patchMutation.isPending}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-xs"
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* Read-only display */
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                      <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                        {rule.label}
                      </Badge>
                      <code className="flex-1 truncate text-xs text-muted-foreground">
                        {rule.pattern_regex}
                      </code>
                      <span className="shrink-0 text-[0.625rem] text-muted-foreground">
                        #{rule.sort_order}
                      </span>
                    </div>
                  )}

                  {editingId !== rule.id && (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => startEdit(rule)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(rule.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add rule form */}
            <div className="mt-3 space-y-2 rounded-md border border-dashed border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Add rule</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[0.65rem]">Label</Label>
                  <Input
                    value={addForm.label}
                    onChange={(e) =>
                      setAddForm((p) => ({ ...p, label: e.target.value }))
                    }
                    placeholder="e.g. deploy"
                    className="h-7 font-mono text-xs"
                    data-testid="input-rule-label"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.65rem]">Regex pattern</Label>
                  <Input
                    value={addForm.pattern_regex}
                    onChange={(e) =>
                      setAddForm((p) => ({ ...p, pattern_regex: e.target.value }))
                    }
                    placeholder="e.g. (?i)deploy"
                    className={cn(
                      "h-7 font-mono text-xs",
                      addForm.pattern_regex && !isValidRegex(addForm.pattern_regex)
                        ? "border-destructive"
                        : "",
                    )}
                    data-testid="input-rule-regex"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[0.65rem]">Sort order</Label>
                  <Input
                    value={addForm.sort_order}
                    onChange={(e) =>
                      setAddForm((p) => ({ ...p, sort_order: e.target.value }))
                    }
                    type="number"
                    placeholder="100"
                    className="h-7 font-mono text-xs"
                    data-testid="input-rule-order"
                  />
                </div>
              </div>
              {addError && (
                <p className="text-xs text-destructive">{addError}</p>
              )}
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleAdd}
                disabled={addMutation.isPending}
                data-testid="button-add-rule"
              >
                <Plus className="h-3.5 w-3.5" />
                Add rule
              </Button>
            </div>
          </div>

          <Separator orientation="vertical" className="shrink-0" />

          {/* ------------------------------------------------------------------ */}
          {/* Right: Live preview                                                 */}
          {/* ------------------------------------------------------------------ */}
          <div className="flex w-[45%] flex-col min-h-0">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Live preview
              {previewLoading && (
                <span className="ml-2 text-[0.65rem] text-muted-foreground/60">
                  updating…
                </span>
              )}
            </p>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 rounded-md border border-border p-2">
              {!preview && !previewLoading && (
                <p className="p-2 text-xs text-muted-foreground">
                  Preview will appear here once workflows are loaded for this repo.
                </p>
              )}

              {preview &&
                Object.entries(preview).map(([label, workflows]) => (
                  <div key={label}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {label === "_unmatched" ? (
                        <Badge
                          variant="outline"
                          className="border-yellow-500 text-yellow-600 dark:text-yellow-400 text-[0.65rem]"
                        >
                          <AlertTriangle className="mr-1 h-2.5 w-2.5" />
                          _unmatched
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="font-mono text-[0.65rem]">
                          {label}
                        </Badge>
                      )}
                      <span className="text-[0.625rem] text-muted-foreground">
                        {workflows.length} workflow{workflows.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <ul className="ml-2 space-y-0.5">
                      {workflows.slice(0, 8).map((wf) => (
                        <li key={wf.path} className="text-[0.65rem] text-muted-foreground truncate">
                          {wf.name}
                        </li>
                      ))}
                      {workflows.length > 8 && (
                        <li className="text-[0.65rem] text-muted-foreground/60">
                          +{workflows.length - 8} more…
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
