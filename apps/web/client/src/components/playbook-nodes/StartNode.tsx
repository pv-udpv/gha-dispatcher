import { Handle, Position, type NodeProps } from 'reactflow';

export function StartNode({ selected }: NodeProps) {
  return (
    <div
      className={`flex items-center justify-center w-20 h-20 rounded-full bg-green-600 text-white font-bold text-sm shadow-md
        ${selected ? 'ring-2 ring-offset-2 ring-green-400' : ''}`}
    >
      START
      <Handle type="source" position={Position.Bottom} id="out" className="!bg-green-400" />
    </div>
  );
}
