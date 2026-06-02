import { Handle, Position, type NodeProps } from 'reactflow';
import { GitBranch } from 'lucide-react';
import type { NodeState } from '@gha-dispatcher/shared';

interface ConditionData {
  expr: 'all_success' | 'any_success' | 'always' | 'on_failure';
  _state?: NodeState;
}

const exprLabels: Record<string, string> = {
  all_success: 'All succeed',
  any_success: 'Any succeeds',
  always: 'Always',
  on_failure: 'On failure',
};

const statusColors: Record<string, string> = {
  pending: 'border-border',
  running: 'border-blue-400 animate-pulse',
  succeeded: 'border-green-500',
  failed: 'border-red-500',
  skipped: 'border-yellow-500',
};

export function ConditionNode({ data, selected }: NodeProps<ConditionData>) {
  const ns = data._state;
  const borderClass = ns ? (statusColors[ns.status] ?? 'border-border') : 'border-border';

  return (
    <div
      className={`min-w-[150px] rounded-lg border-2 bg-card text-card-foreground shadow-sm p-3
        ${borderClass} ${selected ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
        <span className="font-semibold text-xs">Condition</span>
        {ns && (
          <span className={`ml-auto text-[10px] font-mono px-1 rounded ${
            ns.status === 'succeeded' ? 'bg-green-900/60 text-green-300' :
            ns.status === 'skipped' ? 'bg-yellow-900/60 text-yellow-300' :
            'bg-muted text-muted-foreground'
          }`}>{ns.status}</span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {exprLabels[data.expr] ?? data.expr}
      </p>
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}
