'use client';

import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Handle,
  Position,
  MarkerType,
  type Connection,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Trash2, Diamond, Circle, Square, X, FileText as FileIcon, User, ArrowDownToLine, ArrowUpFromLine, MapPin, Paperclip } from 'lucide-react';

// ─── Types ───
interface StepSignOff { name: string; at: string; status: 'blank' | 'red' | 'green'; }
interface FlowStep {
  id: string; label: string; type: 'start' | 'action' | 'decision' | 'end'; next: string[]; condition?: string;
  sourceDoc?: string; outputDoc?: string; responsible?: string; docLocation?: string;
  isSignificantControl?: boolean;
  attachments?: { id: string; name: string; storagePath: string }[];
  stepSignOffs?: { preparer?: StepSignOff; reviewer?: StepSignOff; ri?: StepSignOff };
}

interface WalkthroughFlowEditorProps {
  steps: FlowStep[];
  onStepsChange: (steps: FlowStep[]) => void;
  readOnly?: boolean;
}

// ─── Shared: Metadata badges + Sign-off dots ───

const SIGNOFF_COLORS = { blank: 'bg-slate-300', red: 'bg-red-500', green: 'bg-green-500' };

function StepSignOffDots({ data, nodeId }: { data: any; nodeId: string }) {
  const { setNodes } = useReactFlow();
  const readOnly = data._readOnly as boolean;
  const signOffs = (data.stepSignOffs || {}) as Record<string, StepSignOff | undefined>;

  function cycle(role: string) {
    if (readOnly) return;
    const current = signOffs[role]?.status || 'blank';
    const nextStatus = current === 'blank' ? 'red' : current === 'red' ? 'green' : 'blank';
    const updated = { ...signOffs, [role]: { name: 'Current User', at: new Date().toISOString(), status: nextStatus } };
    if (nextStatus === 'blank') updated[role] = undefined;
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, stepSignOffs: updated } } : n));
  }

  return (
    <div className="flex items-center gap-0.5 mt-1">
      {['preparer', 'reviewer', 'ri'].map(role => (
        <button key={role} onClick={(e) => { e.stopPropagation(); cycle(role); }}
          title={`${role === 'ri' ? 'RI' : role.charAt(0).toUpperCase() + role.slice(1)}${signOffs[role] ? ` — ${signOffs[role]!.name}, ${new Date(signOffs[role]!.at).toLocaleDateString('en-GB')}` : ''}`}
          className={`w-2.5 h-2.5 rounded-full ${SIGNOFF_COLORS[signOffs[role]?.status || 'blank']} hover:ring-2 hover:ring-offset-1 hover:ring-slate-400 transition-all`} />
      ))}
    </div>
  );
}

function MetadataBadges({ data }: { data: any }) {
  const src = data.sourceDoc as string;
  const out = data.outputDoc as string;
  const resp = data.responsible as string;
  const atts = (data.attachments as any[]) || [];
  if (!src && !out && !resp && atts.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {src && <span className="text-[7px] px-1 py-0 bg-blue-100 text-blue-600 rounded inline-flex items-center gap-0.5"><ArrowDownToLine className="h-2 w-2" />{src}</span>}
      {out && <span className="text-[7px] px-1 py-0 bg-green-100 text-green-600 rounded inline-flex items-center gap-0.5"><ArrowUpFromLine className="h-2 w-2" />{out}</span>}
      {resp && <span className="text-[7px] px-1 py-0 bg-purple-100 text-purple-600 rounded inline-flex items-center gap-0.5"><User className="h-2 w-2" />{resp}</span>}
      {atts.length > 0 && <span className="text-[7px] px-1 py-0 bg-amber-100 text-amber-600 rounded inline-flex items-center gap-0.5"><Paperclip className="h-2 w-2" />{atts.length}</span>}
    </div>
  );
}

function StepEditPanel({ data, nodeId, onClose, isDecision }: { data: any; nodeId: string; onClose: () => void; isDecision?: boolean }) {
  const { setNodes } = useReactFlow();
  const [label, setLabel] = useState((data.label as string) || '');
  const [sourceDoc, setSourceDoc] = useState((data.sourceDoc as string) || '');
  const [outputDoc, setOutputDoc] = useState((data.outputDoc as string) || '');
  const [responsible, setResponsible] = useState((data.responsible as string) || '');
  const [docLocation, setDocLocation] = useState((data.docLocation as string) || '');
  const [condition, setCondition] = useState((data.condition as string) || '');
  const [significantControl, setSignificantControl] = useState(!!(data.isSignificantControl));

  function save() {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: {
      ...n.data, label: label.trim() || data.label,
      sourceDoc: sourceDoc.trim() || undefined, outputDoc: outputDoc.trim() || undefined,
      responsible: responsible.trim() || undefined, docLocation: docLocation.trim() || undefined,
      condition: isDecision ? (condition.trim() || undefined) : n.data.condition,
      isSignificantControl: isDecision ? significantControl : n.data.isSignificantControl,
    } } : n));
    onClose();
  }

  return (
    <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-300 rounded-lg shadow-lg p-2 space-y-1.5 min-w-[220px]" onClick={e => e.stopPropagation()}>
      <div><label className="text-[8px] text-slate-500 block">Label</label><input value={label} onChange={e => setLabel(e.target.value)} className="w-full text-[10px] border rounded px-1.5 py-0.5" /></div>
      <div><label className="text-[8px] text-slate-500 block">Source Document / Action</label><input value={sourceDoc} onChange={e => setSourceDoc(e.target.value)} className="w-full text-[10px] border rounded px-1.5 py-0.5" placeholder="e.g. Purchase Order" /></div>
      <div><label className="text-[8px] text-slate-500 block">Output Document / Action</label><input value={outputDoc} onChange={e => setOutputDoc(e.target.value)} className="w-full text-[10px] border rounded px-1.5 py-0.5" placeholder="e.g. Invoice" /></div>
      <div><label className="text-[8px] text-slate-500 block">Responsible (Role)</label><input value={responsible} onChange={e => setResponsible(e.target.value)} className="w-full text-[10px] border rounded px-1.5 py-0.5" placeholder="e.g. AP Clerk" /></div>
      <div><label className="text-[8px] text-slate-500 block">Document Location</label><input value={docLocation} onChange={e => setDocLocation(e.target.value)} className="w-full text-[10px] border rounded px-1.5 py-0.5" placeholder="e.g. Section 3.2, Page 5" /></div>
      {isDecision && <div><label className="text-[8px] text-slate-500 block">Condition</label><input value={condition} onChange={e => setCondition(e.target.value)} className="w-full text-[10px] border rounded px-1.5 py-0.5 italic" /></div>}
      {isDecision && (
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={significantControl} onChange={e => setSignificantControl(e.target.checked)} className="w-3 h-3 rounded border-red-300 text-red-600 focus:ring-red-500" />
          <span className="text-[9px] text-red-700 font-medium">Significant Control</span>
        </label>
      )}
      <div className="flex gap-1 pt-1">
        <button onClick={save} className="text-[9px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
        <button onClick={onClose} className="text-[9px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">Cancel</button>
      </div>
    </div>
  );
}

// ─── Custom Nodes ───

function WtStartNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const readOnly = data._readOnly as boolean;

  const onDelete = useCallback(() => {
    setNodes(nds => nds.filter(n => n.id !== id));
  }, [id, setNodes]);

  return (
    <div className="relative px-6 py-2 rounded-full bg-green-100 border-2 border-green-400 text-green-800 text-xs font-semibold text-center min-w-[120px] group">
      {data.label as string || 'Process Start'}
      {!readOnly && (
        <button onClick={onDelete} className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] hidden group-hover:flex items-center justify-center hover:bg-red-600">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-green-500 !w-2.5 !h-2.5" />
    </div>
  );
}

function WtActionNode({ id, data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const { setNodes } = useReactFlow();
  const readOnly = data._readOnly as boolean;

  const onDelete = useCallback(() => {
    setNodes(nds => nds.filter(n => n.id !== id));
  }, [id, setNodes]);

  return (
    <div className={`relative px-4 py-2 rounded-lg bg-blue-50 border-2 text-blue-800 text-xs text-center min-w-[180px] max-w-[280px] group ${selected ? 'border-blue-500 shadow-md' : 'border-blue-300'}`}>
      <Handle type="target" position={Position.Top} className="!bg-blue-400 !w-2.5 !h-2.5" />
      <div onDoubleClick={() => !readOnly && setEditing(true)} className="cursor-text">
        {data.label as string}
      </div>
      <MetadataBadges data={data} />
      <div className="flex items-center justify-between">
        <StepSignOffDots data={data} nodeId={id} />
        {data.docLocation ? <span className="text-[7px] text-slate-400 inline-flex items-center gap-0.5"><MapPin className="h-2 w-2" />{String(data.docLocation)}</span> : null}
      </div>
      {!readOnly && (
        <button onClick={onDelete} className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] hidden group-hover:flex items-center justify-center hover:bg-red-600">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      {editing && <StepEditPanel data={data} nodeId={id} onClose={() => setEditing(false)} />}
      <Handle type="source" position={Position.Bottom} className="!bg-blue-400 !w-2.5 !h-2.5" />
    </div>
  );
}

function WtDecisionNode({ id, data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const { setNodes } = useReactFlow();
  const readOnly = data._readOnly as boolean;

  const onDelete = useCallback(() => {
    setNodes(nds => nds.filter(n => n.id !== id));
  }, [id, setNodes]);

  return (
    <div className={`relative px-4 py-2 rounded-lg bg-amber-50 border-dashed text-amber-800 text-xs text-center min-w-[200px] max-w-[300px] group ${data.isSignificantControl ? 'border-[3px] border-red-600 shadow-red-100 shadow-md' : `border-2 ${selected ? 'border-amber-500 shadow-md' : 'border-amber-400'}`}`}>
      <Handle type="target" position={Position.Top} className="!bg-amber-500 !w-2.5 !h-2.5" />
      <div className="flex items-center justify-center gap-1">
        <span className="text-[8px] text-amber-500 font-bold">DECISION</span>
        {data.isSignificantControl ? <span className="text-[7px] px-1 bg-red-100 text-red-700 rounded font-bold">SIGNIFICANT CONTROL</span> : null}
      </div>
      <div onDoubleClick={() => !readOnly && setEditing(true)} className="cursor-text">
        {data.label as string}
        {data.condition ? <div className="text-[9px] text-amber-600 mt-0.5 italic">{String(data.condition)}</div> : null}
      </div>
      <MetadataBadges data={data} />
      <div className="flex items-center justify-between">
        <StepSignOffDots data={data} nodeId={id} />
        {data.docLocation ? <span className="text-[7px] text-slate-400 inline-flex items-center gap-0.5"><MapPin className="h-2 w-2" />{String(data.docLocation)}</span> : null}
      </div>
      {!readOnly && (
        <button onClick={onDelete} className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] hidden group-hover:flex items-center justify-center hover:bg-red-600">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      {editing && <StepEditPanel data={data} nodeId={id} onClose={() => setEditing(false)} isDecision />}
      <Handle type="source" position={Position.Bottom} id="yes" className="!bg-green-500 !w-2.5 !h-2.5" style={{ left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="no" className="!bg-red-500 !w-2.5 !h-2.5" style={{ left: '70%' }} />
    </div>
  );
}

function WtEndNode({ id, data, selected }: NodeProps) {
  const [editing, setEditing] = useState(false);
  const { setNodes } = useReactFlow();
  const readOnly = data._readOnly as boolean;

  return (
    <div className={`relative px-6 py-2 rounded-full bg-red-100 border-2 text-red-800 text-xs font-semibold text-center min-w-[120px] ${selected ? 'border-red-500 shadow-md' : 'border-red-300'}`}>
      <Handle type="target" position={Position.Top} className="!bg-red-400 !w-2.5 !h-2.5" />
      <div onDoubleClick={() => !readOnly && setEditing(true)} className="cursor-text">
        {data.label as string || 'Process End'}
      </div>
      <StepSignOffDots data={data} nodeId={id} />
      {editing && <StepEditPanel data={data} nodeId={id} onClose={() => setEditing(false)} />}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  start: WtStartNode,
  action: WtActionNode,
  decision: WtDecisionNode,
  end: WtEndNode,
};

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  style: { strokeWidth: 2, stroke: '#94a3b8' },
};

// ─── Layout: convert FlowStep[] ↔ ReactFlow nodes/edges ───

function flowStepsToReactFlow(steps: FlowStep[]): { nodes: Node[]; edges: Edge[] } {
  if (!steps.length) return { nodes: [], edges: [] };

  const stepMap = new Map(steps.map(s => [s.id, s]));
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // BFS for top-down layout
  const startStep = steps.find(s => s.type === 'start') || steps[0];
  const visited = new Set<string>();
  const levels: string[][] = [];
  const queue: { id: string; level: number }[] = [{ id: startStep.id, level: 0 }];
  visited.add(startStep.id);

  while (queue.length > 0) {
    const { id, level } = queue.shift()!;
    if (!levels[level]) levels[level] = [];
    levels[level].push(id);

    const step = stepMap.get(id);
    if (!step) continue;
    for (const nextId of step.next) {
      if (!visited.has(nextId) && stepMap.has(nextId)) {
        visited.add(nextId);
        queue.push({ id: nextId, level: level + 1 });
      }
    }
  }

  // Add any orphan nodes not reached by BFS
  for (const step of steps) {
    if (!visited.has(step.id)) {
      const lastLevel = levels.length;
      if (!levels[lastLevel]) levels[lastLevel] = [];
      levels[lastLevel].push(step.id);
    }
  }

  // Position nodes
  const Y_GAP = 130;
  const X_GAP = 260;
  const CENTER_X = 400;

  for (let lvl = 0; lvl < levels.length; lvl++) {
    const ids = levels[lvl];
    const totalWidth = (ids.length - 1) * X_GAP;
    const startX = CENTER_X - totalWidth / 2;

    for (let col = 0; col < ids.length; col++) {
      const step = stepMap.get(ids[col])!;
      nodes.push({
        id: step.id,
        type: step.type,
        position: { x: startX + col * X_GAP, y: lvl * Y_GAP },
        data: { label: step.label, condition: step.condition, sourceDoc: step.sourceDoc, outputDoc: step.outputDoc, responsible: step.responsible, docLocation: step.docLocation, isSignificantControl: step.isSignificantControl, attachments: step.attachments, stepSignOffs: step.stepSignOffs },
      });
    }
  }

  // Create edges
  for (const step of steps) {
    if (step.type === 'decision' && step.next.length >= 2) {
      edges.push({
        id: `e-${step.id}-${step.next[0]}`,
        source: step.id,
        target: step.next[0],
        sourceHandle: 'yes',
        label: 'Yes',
        ...defaultEdgeOptions,
        style: { ...defaultEdgeOptions.style, stroke: '#22c55e' },
      });
      edges.push({
        id: `e-${step.id}-${step.next[1]}`,
        source: step.id,
        target: step.next[1],
        sourceHandle: 'no',
        label: 'No',
        ...defaultEdgeOptions,
        style: { ...defaultEdgeOptions.style, stroke: '#ef4444' },
      });
      // Additional branches beyond yes/no
      for (let i = 2; i < step.next.length; i++) {
        edges.push({
          id: `e-${step.id}-${step.next[i]}`,
          source: step.id,
          target: step.next[i],
          ...defaultEdgeOptions,
        });
      }
    } else {
      for (const nextId of step.next) {
        edges.push({
          id: `e-${step.id}-${nextId}`,
          source: step.id,
          target: nextId,
          ...defaultEdgeOptions,
        });
      }
    }
  }

  return { nodes, edges };
}

function reactFlowToFlowSteps(nodes: Node[], edges: Edge[]): FlowStep[] {
  return nodes.map(node => {
    const outgoing = edges.filter(e => e.source === node.id);
    // For decisions, order yes before no
    const yesEdges = outgoing.filter(e => e.sourceHandle === 'yes');
    const noEdges = outgoing.filter(e => e.sourceHandle === 'no');
    const otherEdges = outgoing.filter(e => e.sourceHandle !== 'yes' && e.sourceHandle !== 'no');

    const next = node.type === 'decision'
      ? [...yesEdges.map(e => e.target), ...noEdges.map(e => e.target), ...otherEdges.map(e => e.target)]
      : outgoing.map(e => e.target);

    return {
      id: node.id,
      label: (node.data.label as string) || '',
      type: node.type as FlowStep['type'],
      next,
      condition: (node.data.condition as string) || undefined,
      sourceDoc: (node.data.sourceDoc as string) || undefined,
      outputDoc: (node.data.outputDoc as string) || undefined,
      responsible: (node.data.responsible as string) || undefined,
      docLocation: (node.data.docLocation as string) || undefined,
      isSignificantControl: (node.data.isSignificantControl as boolean) || undefined,
      attachments: (node.data.attachments as any[]) || undefined,
      stepSignOffs: (node.data.stepSignOffs as any) || undefined,
    };
  });
}

// ─── ID Generator ───
let _idCounter = 0;
function nextId(prefix = 'step') {
  return `${prefix}_${Date.now()}_${++_idCounter}`;
}

// ─── Main Editor (inner, needs ReactFlowProvider) ───

function FlowEditorInner({ steps, onStepsChange, readOnly = false }: WalkthroughFlowEditorProps) {
  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => flowStepsToReactFlow(steps), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const reactFlowInstance = useReactFlow();
  const changeTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Inject readOnly flag into all node data
  const enrichedNodes = useMemo(() =>
    nodes.map(n => ({ ...n, data: { ...n.data, _readOnly: readOnly } })),
    [nodes, readOnly]
  );

  // Propagate changes back (debounced, flush on unmount)
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  nodesRef.current = nodes;
  edgesRef.current = edges;

  useEffect(() => {
    clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(() => {
      const flowSteps = reactFlowToFlowSteps(nodes, edges);
      onStepsChange(flowSteps);
    }, 800);
    return () => {
      clearTimeout(changeTimerRef.current);
      // Flush on unmount so changes aren't lost when switching tabs
      const flowSteps = reactFlowToFlowSteps(nodesRef.current, edgesRef.current);
      onStepsChange(flowSteps);
    };
  }, [nodes, edges]);

  const onConnect = useCallback((params: Connection) => {
    if (readOnly) return;
    const handleLabels: Record<string, string> = { yes: 'Yes', no: 'No' };
    const handleColors: Record<string, string> = { yes: '#22c55e', no: '#ef4444' };
    const handle = params.sourceHandle || '';
    const label = handleLabels[handle];
    const color = handleColors[handle];
    const style = color ? { stroke: color, strokeWidth: 2 } : undefined;
    setEdges(eds => addEdge({ ...params, label, style, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }, eds));
  }, [readOnly, setEdges]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    if (readOnly) return;
    event.preventDefault();
    const dataStr = event.dataTransfer.getData('application/reactflow');
    if (!dataStr || !reactFlowInstance) return;
    const nodeData = JSON.parse(dataStr);
    const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setNodes(nds => [...nds, { id: nextId(nodeData.nodeType), type: nodeData.nodeType, position, data: nodeData.data }]);
  }, [readOnly, reactFlowInstance, setNodes]);

  // Delete selected nodes AND edges on key press
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (readOnly) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // Delete selected edges
      setEdges(eds => eds.filter(e => !e.selected));
      // Delete selected nodes and their connected edges
      setNodes(nds => {
        const toDelete = nds.filter(n => n.selected).map(n => n.id);
        if (toDelete.length === 0) return nds;
        setEdges(eds => eds.filter(e => !toDelete.includes(e.source) && !toDelete.includes(e.target)));
        return nds.filter(n => !toDelete.includes(n.id));
      });
    }
  }, [readOnly, setNodes, setEdges]);

  // Click on edge to delete it
  const onEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    if (readOnly) return;
    if (window.confirm(`Delete connection from "${nodes.find(n => n.id === edge.source)?.data?.label || edge.source}" to "${nodes.find(n => n.id === edge.target)?.data?.label || edge.target}"?`)) {
      setEdges(eds => eds.filter(e => e.id !== edge.id));
    }
  }, [readOnly, nodes, setEdges]);

  return (
    <div className="flex gap-2" style={{ height: 450 }}>
      {/* Toolbar */}
      {!readOnly && (
        <div className="w-36 shrink-0 bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1.5 overflow-y-auto">
          <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Add Nodes</p>
          <DraggableItem label="Start" icon={<Circle className="h-3 w-3 text-green-500" />} color="bg-green-50 border-green-200"
            nodeType="start" data={{ label: 'Process Start' }} />
          <DraggableItem label="Action" icon={<Square className="h-3 w-3 text-blue-500" />} color="bg-blue-50 border-blue-200"
            nodeType="action" data={{ label: 'New Action' }} />
          <DraggableItem label="Decision" icon={<Diamond className="h-3 w-3 text-amber-500" />} color="bg-amber-50 border-amber-200"
            nodeType="decision" data={{ label: 'New Decision', condition: '' }} />
          <DraggableItem label="End" icon={<Circle className="h-3 w-3 text-red-500" />} color="bg-red-50 border-red-200"
            nodeType="end" data={{ label: 'Process End' }} />
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 border border-slate-200 rounded-lg overflow-hidden bg-white" onKeyDown={onKeyDown} tabIndex={0}>
        <ReactFlow
          nodes={enrichedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={readOnly ? undefined : onNodesChange}
          onEdgesChange={readOnly ? undefined : onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          onDragOver={onDragOver}
          onDrop={onDrop}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          edgesFocusable={!readOnly}
          elementsSelectable={!readOnly}
          panOnScroll
          zoomOnScroll
          minZoom={0.3}
          maxZoom={2}
          deleteKeyCode={null}
        >
          <Controls showInteractive={false} />
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e2e8f0" />
        </ReactFlow>
      </div>
    </div>
  );
}

// ─── Draggable Palette Item ───

function DraggableItem({ label, icon, color, nodeType, data }: {
  label: string;
  icon: React.ReactNode;
  color: string;
  nodeType: string;
  data: Record<string, any>;
}) {
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({ nodeType, data }));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div draggable onDragStart={onDragStart}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow ${color}`}>
      {icon}
      <span className="text-[10px] font-medium text-slate-700">{label}</span>
    </div>
  );
}

// ─── Exported Wrapper (with ReactFlowProvider) ───

export function WalkthroughFlowEditor(props: WalkthroughFlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
