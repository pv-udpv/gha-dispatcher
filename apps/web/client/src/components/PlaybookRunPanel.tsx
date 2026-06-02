/**
 * PlaybookRunPanel.tsx — v7: Side panel showing live playbook run status.
 * Polls GET /api/playbook-runs/:id every 2s.
 */
import { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Clock, Loader2, ShieldCheck, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiRequest } from '@/lib/queryClient';
import { useGithub } from '@/lib/github-context';
import type { PlaybookRun, NodeState } from '@gha-dispatcher/shared';
import type { Dag } from '@gha-dispatcher/shared';

interface PlaybookRunPanelProps {
  runId: string;
  dag: Dag;
  onClose: () => void;
  onRunUpdate?: (run: PlaybookRun) => void;
}

const STATUS_TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function NodeStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'succeeded': return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case 'failed': return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'running': return <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />;
    case 'awaiting_approval': return <ShieldCheck className="h-3.5 w-3.5 text-orange-400 animate-pulse" />;
    case 'skipped': return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function RunStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'succeeded' ? 'default' :
    status === 'failed' ? 'destructive' :
    status === 'running' ? 'secondary' :
    status === 'cancelled' ? 'outline' : 'outline';
  return <Badge variant={variant} className="text-[10px]">{status}</Badge>;
}

export function PlaybookRunPanel({ runId, dag, onClose, onRunUpdate }: PlaybookRunPanelProps) {
  const { pat } = useGithub();
  const [run, setRun] = useState<PlaybookRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));

  const fetchRun = useCallback(async () => {
    try {
      const res = await apiRequest('GET', `/api/playbook-runs/${runId}`);
      const data = await res.json();
      const fetchedRun: PlaybookRun = data.run;
      setRun(fetchedRun);
      setError(null);
      onRunUpdate?.(fetchedRun);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load run');
    }
  }, [runId, onRunUpdate]);

  useEffect(() => {
    fetchRun();
    const interval = setInterval(() => {
      if (run && STATUS_TERMINAL.has(run.status)) return;
      fetchRun();
    }, 2_000);
    return () => clearInterval(interval);
  }, [fetchRun, run?.status]);

  const handleCancel = async () => {
    if (!pat) {
      setError('PAT required to cancel');
      return;
    }
    try {
      await apiRequest('POST', `/api/playbook-runs/${runId}/cancel`, undefined, {
        'x-github-pat': pat,
      });
      await fetchRun();
    } catch (e: any) {
      setError(e?.message ?? 'Cancel failed');
    }
  };

  const handleApprove = async (nodeId: string) => {
    if (!pat) {
      setError('PAT required to approve');
      return;
    }
    try {
      await apiRequest('POST', `/api/playbook-runs/${runId}/approve/${nodeId}`, undefined, {
        'x-github-pat': pat,
      });
      await fetchRun();
    } catch (e: any) {
      setError(e?.message ?? 'Approve failed');
    }
  };

  return (
    <div className="w-80 shrink-0 border-l border-border bg-card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-semibold text-sm">Run Status</span>
        <Button size="icon" variant="ghost" onClick={onClose} className="h-6 w-6">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {error && (
        <div className="mx-3 mt-2 rounded bg-red-900/40 border border-red-700 text-red-300 text-xs px-2 py-1">
          {error}
        </div>
      )}

      {!run && !error && (
        <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
        </div>
      )}

      {run && (
        <>
          <div className="px-3 py-2 border-b border-border space-y-1">
            <div className="flex items-center gap-2">
              <RunStatusBadge status={run.status} />
              {run.triggered_by && (
                <span className="text-xs text-muted-foreground">by {run.triggered_by}</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground font-mono">
              Started: {new Date(run.started_at).toLocaleTimeString()}
              {run.completed_at && ` · Done: ${new Date(run.completed_at).toLocaleTimeString()}`}
            </p>
            {!STATUS_TERMINAL.has(run.status) && (
              <Button size="sm" variant="destructive" className="h-6 text-xs w-full mt-1" onClick={handleCancel}>
                Cancel run
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="px-3 py-2 space-y-2">
              {(dag.nodes
                .filter((n) => n.kind !== 'start' && n.kind !== 'end') as any[])
                .map((n: any) => {
                  const ns: NodeState | undefined = run.state?.[n.id];
                  const status = ns?.status ?? 'pending';
                  const kindLabel =
                    n.kind === 'dispatch' ? ((n.data as any).workflow_filename || 'Dispatch') :
                    n.kind === 'condition' ? `Condition: ${(n.data as any).expr}` :
                    n.kind === 'wait_approval' ? 'Approval Gate' :
                    n.kind === 'parallel_group' ? 'Parallel Group' :
                    n.kind;

                  return (
                    <div key={n.id} className="rounded border border-border bg-background p-2 text-xs space-y-1">
                      <div className="flex items-center gap-1.5">
                        <NodeStatusIcon status={status} />
                        <span className="font-medium truncate">{kindLabel}</span>
                        <span className={`ml-auto text-[10px] font-mono ${
                          status === 'succeeded' ? 'text-green-400' :
                          status === 'failed' ? 'text-red-400' :
                          status === 'running' ? 'text-blue-400' :
                          status === 'awaiting_approval' ? 'text-orange-400' :
                          'text-muted-foreground'
                        }`}>{status}</span>
                      </div>

                      {ns?.run_html_url && (
                        <a
                          href={ns.run_html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-blue-400 hover:underline text-[10px]"
                        >
                          <ExternalLink className="h-2.5 w-2.5" /> Run #{ns.run_id}
                        </a>
                      )}

                      {ns?.error && (
                        <p className="text-red-400 text-[10px] font-mono">{ns.error}</p>
                      )}

                      {status === 'awaiting_approval' && (
                        <Button
                          size="sm"
                          className="h-6 text-xs w-full mt-1 bg-orange-600 hover:bg-orange-700"
                          onClick={() => handleApprove(n.id)}
                        >
                          Approve
                        </Button>
                      )}
                    </div>
                  );
                })}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
