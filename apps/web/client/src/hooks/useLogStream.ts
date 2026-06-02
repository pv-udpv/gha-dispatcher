/**
 * useLogStream — streams GitHub Actions run logs via the v5 SSE endpoint.
 *
 * Uses fetch + ReadableStream (not native EventSource) so we can send the
 * x-github-pat header. Implements a minimal SSE parser over the byte stream.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/lib/queryClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface JobStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

export interface JobInfo {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: JobStep[];
}

export interface LogStreamState {
  /** Current run status (queued / in_progress / completed / …) */
  status: string | null;
  conclusion: string | null;
  jobs: JobInfo[];
  /** Raw log text per jobId */
  logsByJob: Map<number, string>;
  isConnected: boolean;
  isEnded: boolean;
  error: string | null;
  isFollowing: boolean;
  setFollowing: (v: boolean) => void;
  close: () => void;
}

interface UseLogStreamOptions {
  runId: number | string | null;
  repoFull: string | null;
  pat: string | null;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Tiny SSE event parser
// ---------------------------------------------------------------------------
interface SseEvent {
  event: string;
  data: string;
}

function parseSseBlock(raw: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5)); // keep leading space if any
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useLogStream({
  runId,
  repoFull,
  pat,
  enabled,
}: UseLogStreamOptions): LogStreamState {
  const [status, setStatus] = useState<string | null>(null);
  const [conclusion, setConclusion] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [logsByJob, setLogsByJob] = useState<Map<number, string>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setFollowing] = useState(true);

  const abortRef = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!enabled || !runId || !repoFull || !pat) return;

    // Reset state for new stream
    setStatus(null);
    setConclusion(null);
    setJobs([]);
    setLogsByJob(new Map());
    setIsConnected(false);
    setIsEnded(false);
    setError(null);
    setFollowing(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const url = `${API_BASE}/api/runs/${runId}/stream?repo_full=${encodeURIComponent(repoFull)}`;

    (async () => {
      let resp: Response;
      try {
        resp = await fetch(url, {
          headers: { "x-github-pat": pat },
          signal: controller.signal,
        });
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setError(e?.message ?? "Connection failed");
        return;
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        setError(`HTTP ${resp.status}: ${text}`);
        return;
      }

      if (!resp.body) {
        setError("No response body");
        return;
      }

      setIsConnected(true);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // Event handler
      const handleEvent = (ev: SseEvent) => {
        switch (ev.event) {
          case "hello": {
            // Initial ack — no state changes needed
            break;
          }

          case "status": {
            try {
              const d = JSON.parse(ev.data);
              setStatus(d.status ?? null);
              setConclusion(d.conclusion ?? null);
            } catch {
              /* ignore */
            }
            break;
          }

          case "job": {
            try {
              const job: JobInfo = JSON.parse(ev.data);
              setJobs((prev) => {
                const idx = prev.findIndex((j) => j.id === job.id);
                if (idx === -1) return [...prev, job];
                const next = [...prev];
                next[idx] = job;
                return next;
              });
            } catch {
              /* ignore */
            }
            break;
          }

          case "log": {
            // Server emits:
            //   data: {"jobId":123,"jobName":"Build"}
            //   data: <log line 1>
            //   data: <log line 2>
            //   ...
            // After parseSseBlock, ev.data = those lines joined with \n
            const lines = ev.data.split("\n");
            const firstLine = lines[0] ?? "";
            let jobId: number | null = null;
            let chunkStart = 0;

            // Try to parse the metadata header line
            try {
              const meta = JSON.parse(firstLine);
              if (typeof meta === "object" && meta !== null && "jobId" in meta) {
                jobId = Number(meta.jobId);
                chunkStart = 1; // rest of lines are the log chunk
              }
            } catch {
              // No JSON header — treat whole block as chunk; skip
            }

            if (jobId !== null) {
              const chunk = lines.slice(chunkStart).join("\n");
              setLogsByJob((prev) => {
                const next = new Map(prev);
                const existing = next.get(jobId as number) ?? "";
                next.set(jobId as number, existing + chunk);
                return next;
              });
            }
            break;
          }

          case "end": {
            try {
              const d = JSON.parse(ev.data);
              setConclusion(d.conclusion ?? null);
            } catch {
              /* ignore */
            }
            setIsEnded(true);
            setIsConnected(false);
            controller.abort();
            break;
          }

          case "error": {
            try {
              const d = JSON.parse(ev.data);
              setError(d.message ?? "Stream error");
            } catch {
              setError("Stream error");
            }
            setIsConnected(false);
            break;
          }
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          // Process complete SSE blocks (separated by \n\n)
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (raw.trim()) {
              const ev = parseSseBlock(raw);
              if (ev) handleEvent(ev);
            }
          }
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          setError(e?.message ?? "Stream read error");
        }
      } finally {
        setIsConnected(false);
      }
    })();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, runId, repoFull, pat]);

  return {
    status,
    conclusion,
    jobs,
    logsByJob,
    isConnected,
    isEnded,
    error,
    isFollowing,
    setFollowing,
    close,
  };
}
