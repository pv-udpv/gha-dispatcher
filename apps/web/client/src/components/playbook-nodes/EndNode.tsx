import { Handle, Position, type NodeProps } from 'reactflow';

export function EndNode({ selected }: NodeProps) {
  return (
    <div
      className={`flex items-center justify-center w-20 h-20 rounded-full bg-slate-700 text-white font-bold text-sm shadow-md border-2 border-slate-500
        ${selected ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`}
    >
      END
      <Handle type="target" position={Position.Top} id="in" className="!bg-slate-400" />
    </div>
  );
}
