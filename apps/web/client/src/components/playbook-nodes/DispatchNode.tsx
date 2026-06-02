import { Handle, Position, type NodeProps } from 'reactflow';
import { Rocket } from 'lucide-react';
import type { NodeState } from '@gha-dispatcher/shared';

interface DispatchData {
  workflow_filename: string;
  branch: string;
  inputs: Record<string, string | boolean>;
  _state?: NodeState;
}

const statusColors: Record<string, string> = {
  pending: 'border-border',
  running: 'border-blue-400 animate-pulse',
  succeeded: 'border-green-500',
  failed: 'border-red-500',
  skipped: 'border-muted-foreground',
};

export function DispatchNode({ data, selected }: NodeProps<DispatchData>) {
  const ns = data._state;
  const borderClass = ns ? (statusColors[ns.status] ?? 'border-border') : 'border-border';

  return (
    <div
      className={`min-w-[180px] rounded-lg border-2 bg-card text-card-foreground shadow-sm p-3
        ${borderClass} ${selected ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <div className="flex items-center gap-2 mb-1">
        <Rocket className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="font-semibold text-xs truncate">Dispatch</span>
        {ns && (
          <span className={`ml-auto text-[10px] font-mono px-1 rounded ${
            ns.status === 'succeeded' ? 'bg-green-900/60 text-green-300' :
            ns.status === 'failed' ? 'bg-red-900/60 text-red-300' :
            ns.status === 'running' ? 'bg-blue-900/60 text-blue-300' :
            'bg-muted text-muted-foreground'
          }`}>{ns.status}</span>
        )}
      </div>
      <p className="text-[11px] font-mono text-muted-foreground truncate">
        {data.workflow_filename || 'no workflow'}
      </p>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        branch: {data.branch || 'main'}
      </p>
      {ns?.run_html_url && (
        <a
          href={ns.run_html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-blue-400 hover:underline mt-1 block"
          onClick={(e) => e.stopPropagation()}
        >
          View run #{ns.run_id}
        </a>
      )}
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}
