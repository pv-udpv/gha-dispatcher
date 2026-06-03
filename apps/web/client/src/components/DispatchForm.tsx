import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Send, GitBranch, Loader2, AlertTriangle, Info } from "lucide-react";
import type { WorkflowMeta, DispatchInput, AuditFinding } from "@gha-dispatcher/shared";
import { workflowSchemas } from "@gha-dispatcher/shared";
import { useGithub } from "@/lib/github-context";
import { useRepo } from "@/lib/repoContext";
import { fetchBranches, dispatchWorkflow, type DispatchResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { cn } from "@/lib/utils";

// GitHub stores booleans as the strings "true"/"True"/"false"/"False".
function coerceBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return false;
}

function fileBasename(path: string): string {
  return path.split("/").pop() || path;
}

// Derive the audit "id" key used in workflow-schemas.json — same stem the
// audit script uses: basename without .yml/.yaml suffix.
function workflowId(path: string): string {
  return fileBasename(path).replace(/\.(ya?ml)$/i, "");
}

// Pull audit findings for this workflow from the bundled schema package.
// Returns a map keyed by input name (plus a "_workflow" bucket for whole-file issues).
function findingsForWorkflow(path: string): {
  byInput: Record<string, AuditFinding[]>;
  workflow: AuditFinding[];
  schemaRef: Record<string, unknown> | null;
} {
  const id = workflowId(path);
  const bundle = workflowSchemas as unknown as {
    workflows: Record<string, { findings: AuditFinding[]; schema: Record<string, unknown> | null }>;
  };
  const rec = bundle.workflows[id];
  if (!rec) return { byInput: {}, workflow: [], schemaRef: null };
  const byInput: Record<string, AuditFinding[]> = {};
  const workflowLevel: AuditFinding[] = [];
  for (const f of rec.findings || []) {
    if (f.input) {
      (byInput[f.input] ||= []).push(f);
    } else {
      workflowLevel.push(f);
    }
  }
  return { byInput, workflow: workflowLevel, schemaRef: rec.schema };
}

function buildInitialValues(inputs: DispatchInput[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const inp of inputs) {
    if (inp.type === "boolean") out[inp.name] = coerceBool(inp.default);
    else out[inp.name] = inp.default != null ? String(inp.default) : "";
  }
  return out;
}

interface Props {
  workflow: WorkflowMeta;
  group: string;
  defaultBranch: string;
  onDispatched: (result: DispatchResult, workflowName: string) => void;
}

export function DispatchForm({ workflow, group, defaultBranch, onDispatched }: Props) {
  const { connected, authHeader } = useGithub();
  const { currentRepoFull } = useRepo();
  const inputs = workflow.dispatch_inputs || [];
  const { byInput: findingsByInput, workflow: workflowFindings, schemaRef } =
    useMemo(() => findingsForWorkflow(workflow.path), [workflow.path]);

  const [ref, setRef] = useState(defaultBranch);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [environment, setEnvironment] = useState("");
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    buildInitialValues(inputs),
  );
  const [error, setError] = useState<string | null>(null);

  // Branch autocomplete — only fetch once the PAT exists.
  const branchesQ = useQuery({
    queryKey: ["/api/branches", branchQuery, currentRepoFull],
    queryFn: () => fetchBranches(branchQuery, authHeader(), currentRepoFull),
    enabled: connected && branchOpen,
    staleTime: 30_000,
  });

  const setVal = (name: string, v: string | boolean) =>
    setValues((prev) => ({ ...prev, [name]: v }));

  const missingRequired = useMemo(() => {
    return inputs.some((inp) => {
      if (!inp.required) return false;
      const v = values[inp.name];
      if (inp.type === "boolean") return false; // boolean always has a value
      return v == null || String(v).trim() === "";
    });
  }, [inputs, values]);

  const mutation = useMutation({
    mutationFn: () =>
      dispatchWorkflow(
        {
          workflow_file: fileBasename(workflow.path),
          workflow_name: workflow.name,
          group,
          ref: ref.trim() || defaultBranch,
          environment: environment.trim(),
          inputs: values,
          repo_full: currentRepoFull,
        },
        authHeader(),
      ),
    onSuccess: (result) => {
      setError(null);
      onDispatched(result, workflow.name);
    },
    onError: (e: any) => setError(e?.message || "Dispatch failed"),
  });

  const dispatchDisabled = !connected || missingRequired || mutation.isPending;

  return (
    <div className="border-t border-border bg-background/50 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-medium text-foreground" data-testid="text-selected-workflow">
            {workflow.name}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {fileBasename(workflow.path)}
          </p>
        </div>
        {schemaRef && (
          <a
            href={`/api/workflows/${workflowId(workflow.path)}/schema`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded border border-border bg-muted/40 px-2 py-1 font-mono text-[10px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
            data-testid="link-workflow-schema"
            title="View JSON Schema (Draft 2020-12)"
          >
            schema
          </a>
        )}
      </div>

      {workflowFindings.length > 0 && (
        <div className="mb-3 space-y-1">
          {workflowFindings.map((f, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300"
              data-testid={`finding-workflow-${f.kind}`}
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span><span className="font-mono">{f.kind}</span> — {f.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Branch autocomplete */}
        <div className="space-y-1.5">
          <Label className="text-xs">Branch</Label>
          <Popover open={branchOpen} onOpenChange={setBranchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={branchOpen}
                className="w-full justify-between font-mono text-sm font-normal"
                data-testid="button-branch-select"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{ref || defaultBranch}</span>
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Search branches..."
                  value={branchQuery}
                  onValueChange={setBranchQuery}
                  data-testid="input-branch-search"
                />
                <CommandList>
                  {branchesQ.isLoading && (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading branches…
                    </div>
                  )}
                  {!branchesQ.isLoading && (branchesQ.data?.length ?? 0) === 0 && (
                    <CommandEmpty>No branches found.</CommandEmpty>
                  )}
                  <CommandGroup>
                    {(branchesQ.data || []).map((b) => (
                      <CommandItem
                        key={b.name}
                        value={b.name}
                        onSelect={() => {
                          setRef(b.name);
                          setBranchOpen(false);
                        }}
                        className="font-mono text-sm"
                        data-testid={`option-branch-${b.name}`}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-3.5 w-3.5",
                            ref === b.name ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {b.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Environment free-text */}
        <div className="space-y-1.5">
          <Label htmlFor="env" className="text-xs">
            Environment
          </Label>
          <Input
            id="env"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
            placeholder="(optional)"
            className="font-mono text-sm"
            data-testid="input-environment"
          />
        </div>

        {/* Dynamic dispatch inputs */}
        {inputs.map((inp) => (
          <div
            key={inp.name}
            className={cn(
              "space-y-1.5",
              inp.type === "boolean" && "sm:col-span-2",
            )}
          >
            <Label htmlFor={`inp-${inp.name}`} className="flex items-center gap-1 text-xs">
              <span className="font-mono">{inp.name}</span>
              {inp.required && <span className="text-destructive">*</span>}
              {(findingsByInput[inp.name] || []).map((f) => {
                const isInfo = f.severity === "info";
                return (
                  <span
                    key={f.kind}
                    className={cn(
                      "ml-1 inline-flex items-center gap-0.5 rounded border px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide",
                      isInfo
                        ? "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                    )}
                    title={f.message}
                    data-testid={`finding-input-${inp.name}-${f.kind}`}
                  >
                    {isInfo ? <Info className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                    {f.kind.replace(/_/g, " ")}
                  </span>
                );
              })}
            </Label>

            {inp.type === "boolean" ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <Switch
                  id={`inp-${inp.name}`}
                  checked={coerceBool(values[inp.name])}
                  onCheckedChange={(c) => setVal(inp.name, c)}
                  data-testid={`switch-input-${inp.name}`}
                />
                <span className="text-xs text-muted-foreground">
                  {inp.description || (coerceBool(values[inp.name]) ? "true" : "false")}
                </span>
              </div>
            ) : inp.type === "choice" && inp.options.length > 0 ? (
              <Select
                value={String(values[inp.name] ?? "")}
                onValueChange={(v) => setVal(inp.name, v)}
              >
                <SelectTrigger
                  id={`inp-${inp.name}`}
                  className="font-mono text-sm"
                  data-testid={`select-input-${inp.name}`}
                >
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {inp.options.map((opt) => (
                    <SelectItem key={opt} value={opt} className="font-mono text-sm">
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`inp-${inp.name}`}
                value={String(values[inp.name] ?? "")}
                onChange={(e) => setVal(inp.name, e.target.value)}
                placeholder={inp.description || inp.name}
                className="font-mono text-sm"
                data-testid={`input-input-${inp.name}`}
              />
            )}
            {inp.description && inp.type !== "boolean" && (
              <p className="text-xs text-muted-foreground">{inp.description}</p>
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-dispatch-error">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          onClick={() => mutation.mutate()}
          disabled={dispatchDisabled}
          className="gap-1.5 active:scale-[0.98]"
          data-testid="button-dispatch"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Dispatch
        </Button>
        {!connected && (
          <span className="text-xs text-muted-foreground">Connect a PAT to dispatch</span>
        )}
        {connected && missingRequired && (
          <span className="text-xs text-muted-foreground">Fill required fields (*)</span>
        )}
      </div>
    </div>
  );
}
