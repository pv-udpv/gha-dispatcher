import { Handle, Position, type NodeProps } from 'reactflow';
import { Layers } from 'lucide-react';
import type { NodeState } from '@gha-dispatcher/shared';

interface ParallelGroupData {
  note?: string;
  _state?: NodeState;
}

export function ParallelGroupNode({ data, selected }: NodeProps<ParallelGroupData>) {
  const ns = data._state;
  const borderClass = ns?.status === 'succeeded'
    ? 'border-green-500'
    : ns?.status === 'failed'
      ? 'border-red-500'
      : 'border-purple-400';

  return (
    <div
      className={`min-w-[150px] rounded-lg border-2 border-dashed bg-card text-card-foreground shadow-sm p-3
        ${borderClass} ${selected ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      <div className="flex items-center gap-2 mb-1">
        <Layers className="h-3.5 w-3.5 text-purple-400 shrink-0" />
        <span className="font-semibold text-xs">Parallel Group</span>
      </div>
      {data.note && (
        <p className="text-[11px] text-muted-foreground">{data.note}</p>
      )}
      <Handle type="source" position={Position.Bottom} id="out" />
    </div>
  );
}
