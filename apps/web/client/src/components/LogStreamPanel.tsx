/**
 * LogStreamPanel — sliding right-side sheet that streams live GitHub Actions
 * run logs via the v5 SSE endpoint.
 */
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import AnsiToHtml from "ansi-to-html";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Download,
  X,
  ArrowDown,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { StatusIcon, resolveRunState } from "./StatusDot";
import { useLogStream } from "@/hooks/useLogStream";
import type { JobInfo } from "@/hooks/useLogStream";
import { FailureInsightCard } from "./FailureInsightCard";

// ---------------------------------------------------------------------------
// ANSI converter (singleton)
// ---------------------------------------------------------------------------
const ansiConverter = new AnsiToHtml({
  fg: "inherit",
  bg: "transparent",
  newline: false,
  escapeXML: true,
  stream: false,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse ##[group]title and ##[endgroup] lines for collapsible sections. */
interface LogSection {
  title: string;
  lines: string[];
  isGroup: boolean;
}

function parseLogSections(raw: string): LogSection[] {
  const sections: LogSection[] = [];
  let currentGroup: LogSection | null = null;
  let currentLines: string[] = [];

  for (const line of raw.split("\n")) {
    const groupMatch = line.match(/##\[group\](.*)/);
    const endGroup = /##\[endgroup\]/.test(line);

    if (groupMatch) {
      if (currentLines.length > 0) {
        sections.push({ title: "", lines: currentLines, isGroup: false });
        currentLines = [];
      }
      currentGroup = { title: groupMatch[1].trim(), lines: [], isGroup: true };
    } else if (endGroup && currentGroup) {
      sections.push(currentGroup);
      currentGroup = null;
    } else if (currentGroup) {
      currentGroup.lines.push(line);
    } else {
      currentLines.push(line);
    }
  }

  if (currentGroup) {
    sections.push(currentGroup);
  }
  if (currentLines.length > 0) {
    sections.push({ title: "", lines: currentLines, isGroup: false });
  }

  return sections;
}

/** Annotate GitHub special command lines with a CSS class. */
function annotateSpecialLines(html: string): string {
  return html
    .replace(/##\[error\]/g, '<span class="text-red-400">##[error]</span>')
    .replace(/##\[warning\]/g, '<span class="text-yellow-400">##[warning]</span>');
}

function renderAnsi(raw: string): string {
  try {
    const html = ansiConverter.toHtml(raw);
    return annotateSpecialLines(html);
  } catch {
    return raw;
  }
}

function formatDuration(
  startedAt: string | null,
  completedAt: string | null,
): string {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// ---------------------------------------------------------------------------
// LogBlock — renders a single log section with ANSI + group support
// ---------------------------------------------------------------------------
function LogBlock({
  section,
  isStreaming,
}: {
  section: LogSection;
  isStreaming: boolean;
}) {
  const [open, setOpen] = useState(isStreaming || !section.isGroup);

  // Auto-open when streaming, collapse when done
  useEffect(() => {
    if (!section.isGroup) return;
    if (isStreaming) setOpen(true);
  }, [isStreaming, section.isGroup]);

  const renderedLines = useMemo(
    () =>
      section.lines
        .map((l) => renderAnsi(l))
        .join("\n"),
    [section.lines],
  );

  if (!section.isGroup) {
    return (
      <pre
        className="font-mono text-[0.72rem] leading-relaxed text-foreground/90 whitespace-pre-wrap break-all"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: renderedLines }}
      />
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-1 px-0 py-0.5 text-left font-mono text-[0.72rem] text-muted-foreground hover:text-foreground transition-colors">
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span className="font-semibold">{section.title}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre
          className="ml-3 border-l border-border/50 pl-2 font-mono text-[0.72rem] leading-relaxed text-foreground/90 whitespace-pre-wrap break-all"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderedLines }}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// JobSection — one collapsible job block
// ---------------------------------------------------------------------------
function JobSection({
  job,
  logText,
  isStreaming,
  isFollowing,
}: {
  job: JobInfo;
  logText: string;
  isStreaming: boolean;
  isFollowing: boolean;
}) {
  const [open, setOpen] = useState(
    job.status === "in_progress" || job.status === "completed",
  );

  // Auto-open when job starts
  useEffect(() => {
    if (job.status === "in_progress") setOpen(true);
  }, [job.status]);

  const state = resolveRunState(job.status, job.conclusion);
  const duration = formatDuration(job.started_at, job.completed_at);
  const sections = useMemo(() => parseLogSections(logText), [logText]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-b border-border/50">
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors">
          <StatusIcon state={state} />
          <span className="flex-1 text-sm font-medium truncate">{job.name}</span>
          {duration && (
            <span className="shrink-0 font-mono text-[0.625rem] text-muted-foreground">
              {duration}
            </span>
          )}
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {logText ? (
          <div className="bg-[hsl(220_13%_9%)] p-3 space-y-0.5">
            {sections.map((section, i) => (
              <LogBlock
                key={i}
                section={section}
                isStreaming={isStreaming && job.status === "in_progress"}
              />
            ))}
          </div>
        ) : (
          <div className="px-4 py-3 text-xs text-muted-foreground italic">
            {job.status === "queued" || job.status === "waiting"
              ? "Waiting for runner…"
              : "No log output yet."}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
function StatusBadge({
  status,
  conclusion,
}: {
  status: string | null;
  conclusion: string | null;
}) {
  if (!status) return null;
  const label = conclusion ?? status;
  const variant =
    label === "success"
      ? "default"
      : label === "failure" || label === "timed_out"
        ? "destructive"
        : "secondary";
  return (
    <Badge variant={variant} className="uppercase text-[0.6rem] tracking-wider">
      {label.replace(/_/g, " ")}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface LogStreamPanelProps {
  runId: number | null;
  repoFull: string | null;
  runHtmlUrl: string | null;
  pat: string | null;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function LogStreamPanel({
  runId,
  repoFull,
  runHtmlUrl,
  pat,
  onClose,
}: LogStreamPanelProps) {
  const isOpen = runId !== null;

  const stream = useLogStream({
    runId,
    repoFull,
    pat,
    enabled: isOpen && !!repoFull && !!pat,
  });

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);

  // Follow-tail scroll logic
  const scrollToBottom = useCallback(() => {
    const el = scrollAreaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Auto-scroll when following
  useEffect(() => {
    if (stream.isFollowing && !isUserScrollingRef.current) {
      scrollToBottom();
    }
    isUserScrollingRef.current = false;
  }, [stream.logsByJob, stream.isFollowing, scrollToBottom]);

  // Detect manual scroll up
  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!atBottom && stream.isFollowing) {
      isUserScrollingRef.current = true;
      stream.setFollowing(false);
    }
  }, [stream]);

  // Download logs
  const handleDownload = useCallback(() => {
    const parts: string[] = [];
    for (const job of stream.jobs) {
      const log = stream.logsByJob.get(job.id) ?? "";
      parts.push(`=== ${job.name} ===\n${log}\n`);
    }
    const blob = new Blob([parts.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${runId}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stream.jobs, stream.logsByJob, runId]);

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          stream.close();
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        className="flex flex-col w-[720px] max-w-[95vw] p-0 gap-0"
      >
        {/* Header */}
        <SheetHeader className="flex-row items-center justify-between gap-2 border-b border-border px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <SheetTitle className="text-sm font-semibold truncate">
              Run #{runId}
            </SheetTitle>
            <StatusBadge
              status={stream.status}
              conclusion={stream.conclusion}
            />
            {stream.isConnected && (
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[0.625rem] text-muted-foreground font-mono">
                  live
                </span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Follow toggle */}
            <Button
              variant={stream.isFollowing ? "default" : "outline"}
              size="sm"
              className="h-6 px-2 text-[0.7rem]"
              onClick={() => {
                stream.setFollowing(!stream.isFollowing);
                if (!stream.isFollowing) scrollToBottom();
              }}
              title={stream.isFollowing ? "Following tail" : "Paused"}
            >
              {stream.isFollowing ? "▶ Following" : "⏸ Paused"}
            </Button>

            {/* Download */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleDownload}
              title="Download logs"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>

            {/* Open on GitHub */}
            {runHtmlUrl && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                asChild
                title="Open on GitHub"
              >
                <a
                  href={runHtmlUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}

            {/* Close */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => {
                stream.close();
                onClose();
              }}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </SheetHeader>

        {/* Error banner */}
        {stream.error && (
          <div className="shrink-0 bg-destructive/10 border-b border-destructive/20 px-4 py-2 text-xs text-destructive">
            {stream.error}
          </div>
        )}

        {/* Body — job sections */}
        <div
          ref={scrollAreaRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {stream.jobs.length === 0 && !stream.error && (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-muted-foreground animate-pulse" />
              Connecting to log stream…
            </div>
          )}

          {/* v6: Failure insight card — pinned above job sections */}
          {stream.isEnded && stream.conclusion === "failure" && repoFull && runId && (
            <div className="px-3 pt-3">
              <FailureInsightCard
                runId={runId}
                repoFull={repoFull}
                status={stream.status}
                conclusion={stream.conclusion}
                onClose={() => {
                  stream.close();
                  onClose();
                }}
              />
            </div>
          )}

          {stream.jobs.map((job) => (
            <JobSection
              key={job.id}
              job={job}
              logText={stream.logsByJob.get(job.id) ?? ""}
              isStreaming={stream.isConnected}
              isFollowing={stream.isFollowing}
            />
          ))}

          {stream.isEnded && (
            <div className="px-4 py-3 text-xs text-muted-foreground italic border-t border-border/50">
              Stream ended · conclusion: {stream.conclusion ?? "unknown"}
            </div>
          )}
        </div>

        {/* Jump-to-bottom button */}
        {!stream.isFollowing && (
          <div className="absolute bottom-4 right-4">
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 shadow-lg text-xs"
              onClick={() => {
                stream.setFollowing(true);
                scrollToBottom();
              }}
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Jump to latest
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
