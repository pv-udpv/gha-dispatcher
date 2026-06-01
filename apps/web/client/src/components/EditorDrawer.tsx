import { useEffect, useRef, useState, Suspense, lazy } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useGithub, type EditorSource } from "@/lib/github-context";
import { usePrFlow } from "@/hooks/usePrFlow";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

// CDN loader — configured in a separate static import so Vite doesn't
// see a collision between the static loader import and the dynamic Editor import.
import "@/lib/monaco-loader";

// Lazy-load the Monaco Editor to keep main bundle small
const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((m) => ({ default: m.default })),
);

const SOURCE_REPOS: Record<EditorSource, { repo: string; label: string; defaultBranch: string }> = {
  "pplx-lab": {
    repo: "pv-udpv/pplx-lab",
    label: "pplx-lab",
    defaultBranch: "master",
  },
  "gha-dispatcher": {
    repo: "pv-udpv/gha-dispatcher",
    label: "gha-dispatcher",
    defaultBranch: "main",
  },
};

function EditorSkeleton() {
  return (
    <div className="flex h-[70vh] w-full flex-col gap-2 rounded-md border border-border bg-[#1e1e1e] p-4">
      <Skeleton className="h-4 w-2/3 bg-[#2d2d2d]" />
      <Skeleton className="h-4 w-1/2 bg-[#2d2d2d]" />
      <Skeleton className="h-4 w-3/4 bg-[#2d2d2d]" />
      <Skeleton className="h-4 w-1/3 bg-[#2d2d2d]" />
    </div>
  );
}

function StatusBadge({
  status,
  error,
  prUrl,
}: {
  status: string;
  error: string | null;
  prUrl: string | null;
}) {
  if (status === "idle") return null;
  if (status === "forking")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Forking repo…
      </span>
    );
  if (status === "committing")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Committing file…
      </span>
    );
  if (status === "opening")
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening PR…
      </span>
    );
  if (status === "success" && prUrl)
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> PR opened
      </a>
    );
  if (status === "error")
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertTriangle className="h-3.5 w-3.5" /> {error || "Error opening PR"}
      </span>
    );
  return null;
}

export function EditorDrawer() {
  const {
    editingWorkflow,
    setEditingWorkflow,
    editorSource,
    setEditorSource,
    authHeader,
    connected,
    hasRepoScope,
    pat,
  } = useGithub();

  const { theme } = useTheme();
  const editorTheme = theme === "dark" ? "vs-dark" : "vs";

  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [prTitle, setPrTitle] = useState("");
  const contentRef = useRef(content);
  contentRef.current = content;

  const { status, prUrl, error: prError, openPr, reset } = usePrFlow();

  const sourceInfo = SOURCE_REPOS[editorSource];
  const filePath = editingWorkflow?.path || "";

  // Fetch file content whenever workflow or source changes
  useEffect(() => {
    if (!editingWorkflow || !connected) return;
    setLoading(true);
    setFetchError(null);
    setContent("");
    reset();

    const params = new URLSearchParams({
      repo: sourceInfo.repo,
      path: filePath,
      ref: sourceInfo.defaultBranch,
    });

    fetch(`/api/file?${params}`, { headers: authHeader() })
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d?.message || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((d) => {
        // Content from GitHub Contents API is base64-encoded
        const decoded =
          d.encoding === "base64"
            ? atob(d.content.replace(/\n/g, ""))
            : d.content;
        setContent(decoded);
      })
      .catch((e) => setFetchError(e?.message || "Failed to load file"))
      .finally(() => setLoading(false));
  }, [editingWorkflow, editorSource, connected]);

  // Default PR title from workflow name
  useEffect(() => {
    if (editingWorkflow) {
      setPrTitle(`Edit ${filePath}`);
    }
  }, [editingWorkflow, filePath]);

  const isOpen = !!editingWorkflow;
  const isBusy = ["forking", "committing", "opening"].includes(status);

  const handleOpenPr = () => {
    if (!filePath || !connected) return;
    const body = `Edited via [GHA Dispatcher](https://github.com/pv-udpv/gha-dispatcher).

**File:** \`${filePath}\`
**Source repo:** \`${sourceInfo.repo}\`

<sub>This PR was opened from the dispatcher UI. Review the diff carefully before merging.</sub>`;

    openPr({
      sourceRepo: sourceInfo.repo,
      filePath,
      newContent: contentRef.current,
      title: prTitle || `Edit ${filePath}`,
      body,
      baseBranch: sourceInfo.defaultBranch,
    });
  };

  const handleClose = () => {
    setEditingWorkflow(null);
    reset();
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent
        side="right"
        className="flex w-[min(900px,90vw)] flex-col p-0 gap-0"
        data-testid="editor-drawer"
      >
        {/* Header */}
        <SheetHeader className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-sm font-semibold leading-tight truncate">
                {editingWorkflow?.name || "Edit Workflow"}
              </SheetTitle>
              <p className="mt-0.5 font-mono text-xs text-muted-foreground truncate">
                {filePath}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">
                Source:
              </Label>
              <Select
                value={editorSource}
                onValueChange={(v) => setEditorSource(v as EditorSource)}
              >
                <SelectTrigger
                  className="h-7 w-[140px] text-xs font-mono"
                  data-testid="select-editor-source"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pplx-lab" className="font-mono text-xs">
                    pplx-lab
                  </SelectItem>
                  <SelectItem value="gha-dispatcher" className="font-mono text-xs">
                    gha-dispatcher
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleClose}
                aria-label="Close editor"
                data-testid="button-close-editor"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* PAT scope warning */}
          {connected && !hasRepoScope && (
            <div
              className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-600 dark:text-amber-400"
              data-testid="chip-pat-scope-warning"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              PAT lacks PR scopes — fork/PR may fail. Add <code className="font-mono">repo</code> scope.
            </div>
          )}
        </SheetHeader>

        {/* Body — Monaco editor */}
        <div className="min-h-0 flex-1 overflow-hidden p-4">
          {!connected && (
            <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
              Connect a PAT to edit workflows.
            </div>
          )}

          {connected && fetchError && (
            <div className="flex h-[70vh] flex-col items-center justify-center gap-2 text-sm">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <p className="text-destructive">{fetchError}</p>
              <p className="text-xs text-muted-foreground">
                The file may not exist in{" "}
                <span className="font-mono">{sourceInfo.repo}</span>.
              </p>
            </div>
          )}

          {connected && !fetchError && (
            <Suspense fallback={<EditorSkeleton />}>
              {loading ? (
                <EditorSkeleton />
              ) : (
                <MonacoEditor
                  height="70vh"
                  language="yaml"
                  theme={editorTheme}
                  value={content}
                  onChange={(v) => setContent(v ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    tabSize: 2,
                    renderLineHighlight: "line",
                    smoothScrolling: true,
                  }}
                  data-testid="monaco-editor"
                />
              )}
            </Suspense>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-4 py-3">
          {/* PR title input */}
          <div className="mb-3 flex items-center gap-2">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">
              PR title:
            </Label>
            <Input
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              className="h-7 flex-1 font-mono text-xs"
              placeholder={`Edit ${filePath}`}
              data-testid="input-pr-title"
              disabled={isBusy}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClose}
              disabled={isBusy}
              data-testid="button-cancel-editor"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleOpenPr}
              disabled={!connected || isBusy || !content || status === "success"}
              className="gap-1.5"
              data-testid="button-open-pr"
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Open PR
            </Button>
            <div className="flex-1">
              <StatusBadge status={status} error={prError} prUrl={prUrl} />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
