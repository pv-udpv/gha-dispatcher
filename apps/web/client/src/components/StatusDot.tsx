import {
  CheckCircle2,
  XCircle,
  CircleDashed,
  Loader2,
  Ban,
  CircleHelp,
} from "lucide-react";

// Maps a GitHub run (status + conclusion) to one of our semantic states.
export type RunState =
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "cancelled"
  | "unknown";

export function resolveRunState(
  status: string | null,
  conclusion: string | null,
): RunState {
  if (status === "queued" || status === "pending" || status === "waiting")
    return "queued";
  if (status === "in_progress") return "in_progress";
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "startup_failure")
      return "failure";
    if (conclusion === "cancelled" || conclusion === "skipped") return "cancelled";
    return "unknown";
  }
  return "unknown";
}

const META: Record<
  RunState,
  { label: string; color: string; dot: string; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  queued: {
    label: "QUEUED",
    color: "text-[hsl(38_92%_45%)] dark:text-[hsl(38_92%_58%)]",
    dot: "bg-[hsl(38_92%_45%)] dark:bg-[hsl(38_92%_58%)]",
    Icon: CircleDashed,
  },
  in_progress: {
    label: "RUNNING",
    color: "text-[hsl(38_92%_45%)] dark:text-[hsl(38_92%_58%)]",
    dot: "bg-[hsl(38_92%_45%)] dark:bg-[hsl(38_92%_58%)]",
    Icon: Loader2,
    spin: true,
  },
  success: {
    label: "SUCCESS",
    color: "text-primary",
    dot: "bg-primary",
    Icon: CheckCircle2,
  },
  failure: {
    label: "FAILED",
    color: "text-destructive",
    dot: "bg-destructive",
    Icon: XCircle,
  },
  cancelled: {
    label: "CANCELLED",
    color: "text-muted-foreground",
    dot: "bg-muted-foreground",
    Icon: Ban,
  },
  unknown: {
    label: "UNKNOWN",
    color: "text-muted-foreground",
    dot: "bg-muted-foreground",
    Icon: CircleHelp,
  },
};

// Dot + mono-caps label badge.
export function StatusDot({
  state,
  showLabel = true,
}: {
  state: RunState;
  showLabel?: boolean;
}) {
  const m = META[state];
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={`status-${state}`}>
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.dot}`}
        aria-hidden="true"
      />
      {showLabel && (
        <span className={`font-mono text-[0.625rem] font-semibold tracking-wider ${m.color}`}>
          {m.label}
        </span>
      )}
    </span>
  );
}

// Icon-only variant for compact rows.
export function StatusIcon({ state }: { state: RunState }) {
  const m = META[state];
  const { Icon } = m;
  return (
    <Icon
      className={`h-4 w-4 shrink-0 ${m.color} ${m.spin ? "animate-spin" : ""}`}
      aria-label={m.label}
    />
  );
}
