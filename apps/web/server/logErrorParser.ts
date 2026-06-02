/**
 * logErrorParser.ts — v6 Run Intelligence
 *
 * Parses raw GitHub Actions job log text into structured failure signals.
 * No dependencies beyond the standard library.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalKind =
  | "python_tb"
  | "npm_err"
  | "gh_action"
  | "node_err"
  | "generic_stderr"
  | "oom"
  | "timeout";

export interface Signal {
  kind: SignalKind;
  file?: string;
  line?: number;
  message: string;
  /** Surrounding lines for context */
  context: string;
}

// ---------------------------------------------------------------------------
// Severity ordering (lower index = higher severity)
// ---------------------------------------------------------------------------
const SEVERITY_ORDER: SignalKind[] = [
  "oom",
  "timeout",
  "python_tb",
  "gh_action",
  "npm_err",
  "node_err",
  "generic_stderr",
];

function severityOf(kind: SignalKind): number {
  const idx = SEVERITY_ORDER.indexOf(kind);
  return idx === -1 ? SEVERITY_ORDER.length : idx;
}

// ---------------------------------------------------------------------------
// Cap input to last 200 KB
// ---------------------------------------------------------------------------
const MAX_BYTES = 200 * 1024; // 200 KB

function capInput(text: string): string {
  if (text.length <= MAX_BYTES) return text;
  return text.slice(text.length - MAX_BYTES);
}

// ---------------------------------------------------------------------------
// Helper: grab N lines of context around an index
// ---------------------------------------------------------------------------
function contextAround(lines: string[], idx: number, before = 3, after = 3): string {
  const start = Math.max(0, idx - before);
  const end = Math.min(lines.length - 1, idx + after);
  return lines.slice(start, end + 1).join("\n");
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

/** OOM: killed by kernel or JavaScript heap exhaustion. */
function detectOom(lines: string[]): Signal[] {
  const signals: Signal[] = [];
  const patterns = [
    /out of memory/i,
    /javascript heap out of memory/i,
    /\bKilled\b/,
    /MemoryError/,
    /Cannot allocate memory/i,
  ];
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      signals.push({
        kind: "oom",
        message: lines[i].trim(),
        context: contextAround(lines, i),
      });
      break; // one OOM signal is enough
    }
  }
  return signals;
}

/** Timeout: action / runner timed out. */
function detectTimeout(lines: string[]): Signal[] {
  const signals: Signal[] = [];
  const patterns = [
    /The action has timed out/i,
    /timeout exceeded/i,
    /TIMED_OUT/,
    /job was cancelled because it exceeded the maximum execution time/i,
  ];
  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((p) => p.test(lines[i]))) {
      signals.push({
        kind: "timeout",
        message: lines[i].trim(),
        context: contextAround(lines, i),
      });
      break;
    }
  }
  return signals;
}

/** Python tracebacks: capture frames and extract last frame file/line/message. */
function detectPythonTb(lines: string[]): Signal[] {
  const signals: Signal[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^Traceback \(most recent call last\):/.test(lines[i])) {
      const tbStart = i;
      const tbLines: string[] = [lines[i]];
      i++;
      // Collect indented frame lines + the final exception line
      while (i < lines.length) {
        if (/^\s/.test(lines[i]) || /^\w/.test(lines[i])) {
          tbLines.push(lines[i]);
          if (/^\w/.test(lines[i]) && !/^\s/.test(lines[i]) && i > tbStart + 1) {
            // Non-indented line = exception message — stop here
            i++;
            break;
          }
        } else {
          break;
        }
        i++;
      }

      // Extract last File frame
      let file: string | undefined;
      let line: number | undefined;
      for (let j = tbLines.length - 1; j >= 0; j--) {
        const m = tbLines[j].match(/File "([^"]+)", line (\d+)/);
        if (m) {
          file = m[1];
          line = parseInt(m[2], 10);
          break;
        }
      }

      // Last line = exception message
      const lastLine = tbLines[tbLines.length - 1]?.trim() ?? "";
      signals.push({
        kind: "python_tb",
        file,
        line,
        message: lastLine || "Python traceback",
        context: contextAround(lines, tbStart, 0, tbLines.length + 2),
      });
    } else {
      i++;
    }
  }
  return signals;
}

/** npm ERR! — group consecutive lines. */
function detectNpmErr(lines: string[]): Signal[] {
  const signals: Signal[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^npm ERR!/.test(lines[i]) || /^npm error/i.test(lines[i])) {
      const groupStart = i;
      const group: string[] = [lines[i]];
      i++;
      while (i < lines.length && (/^npm ERR!/.test(lines[i]) || /^npm error/i.test(lines[i]))) {
        group.push(lines[i]);
        i++;
      }
      signals.push({
        kind: "npm_err",
        message: group[0].replace(/^npm (ERR!|error)\s*/i, "").trim() || group[0],
        context: group.join("\n"),
      });
    } else {
      i++;
    }
  }
  return signals;
}

/** Node.js: uncaught exception + stack frames. */
function detectNodeErr(lines: string[]): Signal[] {
  const signals: Signal[] = [];
  // Look for patterns like: "at <fn> (<file>:<line>:<col>)" or throw statements
  const throwPattern = /^(Error|TypeError|ReferenceError|SyntaxError|RangeError):/;
  let i = 0;
  while (i < lines.length) {
    if (throwPattern.test(lines[i].trim())) {
      const errLine = lines[i].trim();
      // Collect stack frames
      const frames: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+at\s/.test(lines[j])) {
        frames.push(lines[j].trim());
        j++;
      }
      // Parse first meaningful frame
      let file: string | undefined;
      let lineNum: number | undefined;
      if (frames.length > 0) {
        const m = frames[0].match(/\((.+):(\d+):\d+\)$/);
        if (m) {
          file = m[1];
          lineNum = parseInt(m[2], 10);
        }
      }
      signals.push({
        kind: "node_err",
        file,
        line: lineNum,
        message: errLine,
        context: contextAround(lines, i, 1, Math.min(frames.length + 1, 6)),
      });
      i = j;
    } else {
      i++;
    }
  }
  return signals;
}

/** GitHub Actions: ##[error] and step Error: lines. */
function detectGhAction(lines: string[]): Signal[] {
  const signals: Signal[] = [];
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    // ##[error]message or ::error::message
    const errAnnotation = stripped.match(/^(?:##\[error\]|::error::)(.*)/i);
    if (errAnnotation) {
      const msg = errAnnotation[1].trim();
      signals.push({
        kind: "gh_action",
        message: msg || stripped,
        context: contextAround(lines, i),
      });
      continue;
    }
    // Action-level "Error: ..." not inside a node stack (doesn't start with spaces)
    const actionErr = stripped.match(/^Error: (.+)/);
    if (actionErr && !/^\s+at\s/.test(lines[i])) {
      // Skip if it's already captured as a Node error
      signals.push({
        kind: "gh_action",
        message: actionErr[1].trim(),
        context: contextAround(lines, i),
      });
    }
  }
  return signals;
}

/** Generic stderr: lines containing "error" (case-insensitive) not caught above. */
function detectGenericStderr(lines: string[]): Signal[] {
  const signals: Signal[] = [];
  const genericPattern = /\berror\b/i;
  // Skip patterns already caught by other detectors
  const skipPattern =
    /^(Traceback|npm ERR!|npm error|##\[error\]|::error::|Error:\s|TypeError:|ReferenceError:|SyntaxError:|RangeError:)/i;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l && genericPattern.test(l) && !skipPattern.test(l) && l.length < 300) {
      signals.push({
        kind: "generic_stderr",
        message: l,
        context: contextAround(lines, i),
      });
      if (signals.length >= 5) break; // cap generic signals
    }
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse a raw job log text into an array of Signals, sorted by severity.
 * Caps input to the last 200 KB.
 */
export function parseFailureSignals(logText: string): Signal[] {
  const capped = capInput(logText);
  const lines = capped.split("\n");

  const oom = detectOom(lines);
  const timeout = detectTimeout(lines);
  const pythonTb = detectPythonTb(lines);
  const ghAction = detectGhAction(lines);
  const npmErr = detectNpmErr(lines);
  const nodeErr = detectNodeErr(lines);

  // Only emit generic_stderr if no higher-specificity signals found
  const specificSignals = [...oom, ...timeout, ...pythonTb, ...ghAction, ...npmErr, ...nodeErr];
  const generic = specificSignals.length === 0 ? detectGenericStderr(lines) : [];

  const all = [...specificSignals, ...generic];

  // Sort by severity
  all.sort((a, b) => severityOf(a.kind) - severityOf(b.kind));

  return all;
}
