/**
 * PlaybookCanvas.tsx — ReactFlow-based DAG builder for v7 Playbooks.
 */
import { useCallback, useMemo, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { StartNode } from './playbook-nodes/StartNode';
import { EndNode } from './playbook-nodes/EndNode';
import { DispatchNode } from './playbook-nodes/DispatchNode';
import { ConditionNode } from './playbook-nodes/ConditionNode';
import { WaitApprovalNode } from './playbook-nodes/WaitApprovalNode';
import { ParallelGroupNode } from './playbook-nodes/ParallelGroupNode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { Dag, DagNode, DagEdge, PlaybookRun, NodeState } from '@gha-dispatcher/shared';

// ---------------------------------------------------------------------------
// Node type registry
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = {
  start: StartNode,
  end: EndNode,
  dispatch: DispatchNode,
  condition: ConditionNode,
  wait_approval: WaitApprovalNode,
  parallel_group: ParallelGroupNode,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dagToFlow(dag: Dag, run?: PlaybookRun | null): { nodes: Node[]; edges: Edge[] } {
  const stateMap: Record<string, NodeState> = (run?.state ?? {}) as Record<string, NodeState>;
  const nodes: Node[] = dag.nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: n.position,
    data: { ...n.data, _state: stateMap[n.id] },
  }));
  const edges: Edge[] = dag.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.label,
    animated: stateMap[e.target]?.status === 'running',
    style: stateMap[e.target]?.status === 'succeeded'
      ? { stroke: '#22c55e' }
      : stateMap[e.target]?.status === 'failed'
        ? { stroke: '#ef4444' }
        : undefined,
  }));
  return { nodes, edges };
}

function flowToDag(nodes: Node[], edges: Edge[]): Dag {
  const dagNodes: DagNode[] = nodes.map((n) => {
    const { _state, ...cleanData } = (n.data ?? {}) as Record<string, unknown>;
    void _state; // unused
    return {
      id: n.id,
      kind: n.type as DagNode['kind'],
      position: n.position,
      data: cleanData,
    } as DagNode;
  });
  const dagEdges: DagEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    label: typeof e.label === 'string' ? e.label : undefined,
  }));
  return { nodes: dagNodes, edges: dagEdges };
}

let idCounter = Date.now();
function newId(prefix: string) { return `${prefix}-${++idCounter}`; }

// ---------------------------------------------------------------------------
// Inspector panel
// ---------------------------------------------------------------------------

interface InspectorProps {
  node: Node | null;
  onChange: (nodeId: string, data: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
}

function Inspector({ node, onChange, onDelete }: InspectorProps) {
  if (!node) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Select a node to inspect. Click palette buttons above to add nodes.
      </div>
    );
  }

  const kind = node.type!;
  const data = (node.data ?? {}) as Record<string, unknown>;

  return (
    <div className="p-4 space-y-3 overflow-y-auto text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold capitalize">{kind.replace('_', ' ')} node</span>
        {kind !== 'start' && kind !== 'end' && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onDelete(node.id)}
            className="h-6 text-xs"
          >
            Delete
          </Button>
        )}
      </div>

      {kind === 'dispatch' && (
        <>
          <div>
            <Label className="text-xs">Workflow filename</Label>
            <Input
              className="h-7 text-xs mt-1"
              value={(data.workflow_filename as string) ?? ''}
              onChange={(e) => onChange(node.id, { ...data, workflow_filename: e.target.value })}
              placeholder="e.g. deploy.yml"
            />
          </div>
          <div>
            <Label className="text-xs">Branch</Label>
            <Input
              className="h-7 text-xs mt-1"
              value={(data.branch as string) ?? 'main'}
              onChange={(e) => onChange(node.id, { ...data, branch: e.target.value })}
              placeholder="main"
            />
          </div>
          <div>
            <Label className="text-xs">Inputs (JSON)</Label>
            <Input
              className="h-7 text-xs font-mono mt-1"
              value={JSON.stringify(data.inputs ?? {})}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  onChange(node.id, { ...data, inputs: parsed });
                } catch { /* ignore invalid JSON while typing */ }
              }}
              placeholder="{}"
            />
          </div>
        </>
      )}

      {kind === 'condition' && (
        <div>
          <Label className="text-xs">Expression</Label>
          <Select
            value={(data.expr as string) ?? 'all_success'}
            onValueChange={(v) => onChange(node.id, { ...data, expr: v })}
          >
            <SelectTrigger className="h-7 text-xs mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_success">All succeed</SelectItem>
              <SelectItem value="any_success">Any succeeds</SelectItem>
              <SelectItem value="always">Always</SelectItem>
              <SelectItem value="on_failure">On failure</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {kind === 'wait_approval' && (
        <>
          <div>
            <Label className="text-xs">Message</Label>
            <Input
              className="h-7 text-xs mt-1"
              value={(data.message as string) ?? ''}
              onChange={(e) => onChange(node.id, { ...data, message: e.target.value })}
              placeholder="Approval required…"
            />
          </div>
          <div>
            <Label className="text-xs">Approvers (comma-separated)</Label>
            <Input
              className="h-7 text-xs mt-1"
              value={((data.approvers as string[]) ?? []).join(', ')}
              onChange={(e) =>
                onChange(node.id, {
                  ...data,
                  approvers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                })
              }
              placeholder="user1, user2"
            />
          </div>
        </>
      )}

      {kind === 'parallel_group' && (
        <div>
          <Label className="text-xs">Note</Label>
          <Input
            className="h-7 text-xs mt-1"
            value={(data.note as string) ?? ''}
            onChange={(e) => onChange(node.id, { ...data, note: e.target.value })}
            placeholder="Optional note…"
          />
        </div>
      )}

      {(kind === 'start' || kind === 'end') && (
        <p className="text-xs text-muted-foreground">
          {kind === 'start' ? 'Entry point of the playbook.' : 'Terminal node of the playbook.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const PALETTE_ITEMS: { kind: string; label: string; color: string }[] = [
  { kind: 'dispatch', label: 'Dispatch', color: 'bg-blue-900/60 border-blue-400' },
  { kind: 'condition', label: 'Condition', color: 'bg-yellow-900/60 border-yellow-400' },
  { kind: 'wait_approval', label: 'Approval Gate', color: 'bg-orange-900/60 border-orange-400' },
  { kind: 'parallel_group', label: 'Parallel Group', color: 'bg-purple-900/60 border-purple-400' },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface PlaybookCanvasProps {
  initialDag: Dag;
  run?: PlaybookRun | null;
  onChange?: (dag: Dag) => void;
}

export function PlaybookCanvas({ initialDag, run, onChange }: PlaybookCanvasProps) {
  const { toast } = useToast();
  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => dagToFlow(initialDag, run),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialDag],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Apply run state overlays
  const displayNodes = useMemo(() => {
    if (!run) return nodes;
    return nodes.map((n) => ({
      ...n,
      data: { ...n.data, _state: (run.state as Record<string, NodeState>)?.[n.id] },
    }));
  }, [nodes, run]);

  const displayEdges = useMemo(() => {
    if (!run) return edges;
    const stateMap = run.state as Record<string, NodeState>;
    return edges.map((e) => ({
      ...e,
      animated: stateMap?.[e.target]?.status === 'running',
      style: stateMap?.[e.target]?.status === 'succeeded'
        ? { stroke: '#22c55e' }
        : stateMap?.[e.target]?.status === 'failed'
          ? { stroke: '#ef4444' }
          : undefined,
    }));
  }, [edges, run]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge({ ...params, id: newId('edge') }, eds),
      ),
    [setEdges],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const handleNodeDataChange = useCallback(
    (nodeId: string, newData: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: newData } : n)),
      );
      if (selectedNode?.id === nodeId) {
        setSelectedNode((prev) => prev ? { ...prev, data: newData } : prev);
      }
    },
    [setNodes, selectedNode],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNode(null);
    },
    [setNodes, setEdges],
  );

  const addNode = useCallback(
    (kind: string) => {
      const id = newId(kind);
      const defaultData: Record<string, unknown> = ({
        dispatch: { workflow_filename: '', branch: 'main', inputs: {} },
        condition: { expr: 'all_success' },
        wait_approval: { message: '', approvers: [] },
        parallel_group: { note: '' },
      } as Record<string, Record<string, unknown>>)[kind] ?? {} as Record<string, unknown>;

      const newNode: Node = {
        id,
        type: kind,
        position: { x: Math.random() * 300 + 50, y: Math.random() * 200 + 100 },
        data: defaultData,
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  const validate = useCallback(() => {
    const dag = flowToDag(nodes, edges);
    const starts = dag.nodes.filter((n) => n.kind === 'start');
    const ends = dag.nodes.filter((n) => n.kind === 'end');
    if (starts.length !== 1) {
      toast({ title: 'Validation error', description: 'DAG must have exactly one Start node.', variant: 'destructive' });
      return false;
    }
    if (ends.length !== 1) {
      toast({ title: 'Validation error', description: 'DAG must have exactly one End node.', variant: 'destructive' });
      return false;
    }
    const dispatches = dag.nodes.filter((n) => n.kind === 'dispatch');
    for (const d of dispatches) {
      if (!(d.data as { workflow_filename?: string }).workflow_filename) {
        toast({ title: 'Validation error', description: `Dispatch node ${d.id} has no workflow filename.`, variant: 'destructive' });
        return false;
      }
    }
    toast({ title: 'Valid', description: 'DAG structure looks good.' });
    return true;
  }, [nodes, edges, toast]);

  const handleSave = useCallback(() => {
    if (!validate()) return;
    const dag = flowToDag(nodes, edges);
    onChange?.(dag);
  }, [nodes, edges, validate, onChange]);

  return (
    <div className="flex h-full">
      {/* Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          className="bg-background"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-30" />
          <Controls className="[&>button]:bg-card [&>button]:border-border [&>button]:text-foreground" />
          <MiniMap className="!bg-card !border-border" nodeColor="#334155" />
        </ReactFlow>

        {/* Toolbar */}
        <div className="absolute top-2 left-2 z-10 flex gap-1 flex-wrap max-w-[260px]">
          {PALETTE_ITEMS.map((item) => (
            <button
              key={item.kind}
              onClick={() => addNode(item.kind)}
              className={`text-[10px] px-2 py-1 rounded border font-medium cursor-pointer hover:opacity-80 transition-opacity ${item.color}`}
            >
              + {item.label}
            </button>
          ))}
        </div>

        {/* Validate + Save */}
        <div className="absolute bottom-2 left-2 z-10 flex gap-2">
          <Button size="sm" variant="outline" onClick={validate} className="h-7 text-xs">
            Validate
          </Button>
          <Button size="sm" onClick={handleSave} className="h-7 text-xs">
            Save DAG
          </Button>
        </div>
      </div>

      {/* Inspector */}
      <div className="w-56 shrink-0 border-l border-border bg-card overflow-y-auto">
        <div className="px-3 py-2 border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Inspector
        </div>
        <Inspector
          node={selectedNode}
          onChange={handleNodeDataChange}
          onDelete={handleDeleteNode}
        />
      </div>
    </div>
  );
}
