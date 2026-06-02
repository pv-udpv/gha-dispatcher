import { Handle, Position, type NodeProps } from 'reactflow';
import { ShieldCheck } from 'lucide-react';
import type { NodeState } from '@gha-dispatcher/shared';

interface WaitApprovalData {
  message?: string;
  approvers?: string[];
  _state?: NodeState;
}

const statusColors: Record<string, string> = {
  pending: 'border-border',
  running: 'border-blue-400 animate-pulse',
  awaiting_approval: 'border-orange-400 animate-pulse',
  succeeded: 'border-green-500',
  failed: 'border-red-500',
  skipped: 'border-muted-foreground',
};

export function WaitApprovalNode({ data, selected }: NodeProps<WaitApprovalData>) {
  const ns = data._state;
  const borderClass = ns ? (statusColors[ns.status] ?? 'border-border') : 'border-border';

  return (
    <div
      className={`min-w-[160px] rounded-lg border-2 bg-card text-card-foreground shadow-sm p-3
        ${borderClass} ${selected ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="h-3.5 w-3.5 text-orange-400 shrink-0" />
        <span className="font-semibold text-xs">Approval Gate</span>
        {ns && ns.status === 'awaiting_approval' && (
          <span className="ml-auto text-[10px] font-mono px-1 rounded bg-orange-900/60 text-orange-300">
            waiting
          </span>
        )}
        {ns && ns.status === 'succeeded' && (
          <span className="ml-auto text-[10px] font-mono px-1 rounded bg-green-900/60 text-green-300">
            approved
          </span>
        )}
      </div>
      {data.message && (
        <p className="text-[11px] text-muted-foreground truncate">{data.message}</p>
      )}
      {data.approvers && data.approvers.length > 0 && (
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Approvers: {data.approvers.join(', ')}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}
