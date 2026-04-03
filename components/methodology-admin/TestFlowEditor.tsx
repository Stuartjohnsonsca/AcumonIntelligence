'use client';

import { useState, useCallback, useRef, useMemo, DragEvent } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  useNodesState,
  useEdgesState,
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
import { X, Save, Loader2, GripVertical, Diamond, Play, CircleCheck, Bot, Users, User, Globe, FileInput, Calculator, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Types ───
export interface TestAction {
  id: string;
  name: string;
  description: string;
  actionType: 'client' | 'ai' | 'human' | 'review';
  isReusable: boolean;
  executionDef?: any;
}

export interface FlowData {
  nodes: Node[];
  edges: Edge[];
}

interface Props {
  testDescription: string;
  initialFlow: FlowData | null;
  testActions: TestAction[];
  onSave: (flow: FlowData) => Promise<void>;
  onClose: () => void;
}

// ─── Assignee config ───
const ASSIGNEES = [
  { value: 'ai', label: 'AI', icon: Bot, color: 'bg-purple-100 text-purple-700 border-purple-300' },
  { value: 'client', label: 'Client', icon: Users, color: 'bg-blue-100 text-blue-700 border-blue-300' },
  { value: 'team', label: 'Team', icon: User, color: 'bg-green-100 text-green-700 border-green-300' },
] as const;

// ─── Colour helpers ───
const ASSIGNEE_COLORS: Record<string, { bg: string; border: string; text: string; light: string; accent: string }> = {
  ai:     { bg: '#f3e8ff', border: '#a855f7', text: '#7e22ce', light: '#faf5ff', accent: '#c084fc' },
  client: { bg: '#dbeafe', border: '#3b82f6', text: '#1d4ed8', light: '#eff6ff', accent: '#60a5fa' },
  team:   { bg: '#dcfce7', border: '#22c55e', text: '#15803d', light: '#f0fdf4', accent: '#4ade80' },
};

const ASSIGNEE_LABELS: Record<string, string> = { ai: 'AI', client: 'Client', team: 'Team' };

const ASSIGNEE_ICONS: Record<string, typeof Bot> = { ai: Bot, client: Users, team: User };

// ─── Input types for action nodes ───
const INPUT_TYPES = [
  { value: 'none', label: 'No input' },
  { value: 'portal_request', label: 'Portal Request (to Client)' },
  { value: 'portal_upload', label: 'Portal Upload (from Client)' },
  { value: 'file_upload', label: 'File Upload' },
  { value: 'data_entry', label: 'Data Entry' },
  { value: 'sample_calculator', label: 'Sample Calculator' },
  { value: 'tb_reference', label: 'Trial Balance Reference' },
  { value: 'evidence_match', label: 'Evidence Matching' },
  { value: 'ai_analysis', label: 'AI Analysis' },
];

// ─── Custom Node: Action ───
function ActionNode({ data, selected }: NodeProps) {
  const assignee = (data as any).assignee || 'team';
  const colors = ASSIGNEE_COLORS[assignee] || ASSIGNEE_COLORS.team;
  const AssigneeIcon = ASSIGNEE_ICONS[assignee] || User;
  const inputType = (data as any).inputType || 'none';
  const hasPortal = inputType === 'portal_request' || inputType === 'portal_upload';
  const hasError = (data as any)._hasError;
  const hasWarning = (data as any)._hasWarning;

  const borderColor = hasError ? '#ef4444' : hasWarning ? '#f59e0b' : selected ? '#2563eb' : colors.border;
  const shadow = hasError ? '0 0 0 3px #fecaca' : hasWarning ? '0 0 0 3px #fef3c7' : selected ? '0 0 0 2px #93c5fd' : undefined;

  return (
    <div
      className="rounded-lg shadow-md border-2 min-w-[200px] max-w-[260px] transition-shadow relative"
      style={{
        background: colors.light,
        borderColor,
        boxShadow: shadow,
      }}
    >
      {/* Error/warning indicator */}
      {hasError && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center z-10" title="Has errors">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      )}
      {!hasError && hasWarning && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center z-10" title="Has warnings">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
      <div className="px-3 py-2">
        {/* Top row: assignee badge + portal indicator */}
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="inline-flex items-center gap-1 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded"
            style={{ background: colors.bg, color: colors.text }}
          >
            <AssigneeIcon className="h-2.5 w-2.5" />
            {ASSIGNEE_LABELS[assignee]}
          </span>
          {hasPortal && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
              <Globe className="h-2.5 w-2.5" /> Portal
            </span>
          )}
          {inputType === 'sample_calculator' && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
              <Calculator className="h-2.5 w-2.5" /> Sample
            </span>
          )}
          {(inputType === 'file_upload' || inputType === 'data_entry') && (
            <span className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              <FileInput className="h-2.5 w-2.5" /> Input
            </span>
          )}
        </div>
        {/* Label */}
        <div className="text-sm font-semibold text-slate-800 leading-tight">{(data as any).label}</div>
        {/* Description */}
        {(data as any).description && (
          <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">{(data as any).description}</div>
        )}
        {/* Execution def indicator */}
        {(data as any).executionDef && (
          <div className="mt-1 flex items-center gap-1">
            <span className="inline-flex items-center text-[8px] font-medium px-1 py-0.5 rounded bg-green-100 text-green-700">
              Execution configured
            </span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
    </div>
  );
}

// ─── Custom Node: Decision ──��
function DecisionNode({ data, selected }: NodeProps) {
  const hasError = (data as any)._hasError;
  const hasWarning = (data as any)._hasWarning;
  const strokeColor = hasError ? '#ef4444' : hasWarning ? '#f59e0b' : selected ? '#2563eb' : '#f59e0b';

  return (
    <div className="relative flex items-center justify-center" style={{ width: 180, height: 110 }}>
      {/* Error/warning indicator */}
      {hasError && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center z-10" title="Has errors">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      )}
      {!hasError && hasWarning && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center z-10" title="Has warnings">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-amber-500 !border-amber-400" style={{ top: -6 }} />
      <svg width="180" height="110" viewBox="0 0 180 110" className="absolute inset-0">
        <polygon
          points="90,4 176,55 90,106 4,55"
          fill={hasError ? '#fef2f2' : selected ? '#fef9c3' : '#fffbeb'}
          stroke={strokeColor}
          strokeWidth={hasError || selected ? 2.5 : 2}
        />
      </svg>
      <div className="relative z-10 text-center px-8">
        <div className="text-xs font-bold text-amber-800 leading-tight">{(data as any).label || 'Check'}</div>
        {(data as any).question && (
          <div className="text-[10px] text-amber-600 mt-0.5 leading-snug">{(data as any).question}</div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        className="!w-3 !h-3 !bg-green-500 !border-green-400"
        style={{ left: '30%', bottom: -6 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        className="!w-3 !h-3 !bg-red-500 !border-red-400"
        style={{ left: '70%', bottom: -6 }}
      />
      {/* Yes/No labels */}
      <span className="absolute text-[9px] font-bold text-green-600" style={{ left: '18%', bottom: -18 }}>Yes</span>
      <span className="absolute text-[9px] font-bold text-red-600" style={{ left: '62%', bottom: -18 }}>No</span>
    </div>
  );
}

// ─── Custom Node: Start ───
function StartNode({ data }: NodeProps) {
  return (
    <div className="rounded-full bg-green-100 border-2 border-green-500 px-5 py-2.5 shadow-sm">
      <div className="flex items-center gap-1.5">
        <Play className="h-3.5 w-3.5 text-green-600 fill-green-600" />
        <span className="text-sm font-semibold text-green-700">Start Test</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !bg-green-500 !border-green-400" />
    </div>
  );
}

// ─── Custom Node: End ───
function EndNode({ data }: NodeProps) {
  return (
    <div className="rounded-full bg-slate-100 border-2 border-slate-500 px-5 py-2.5 shadow-sm">
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-slate-400 !border-slate-300" />
      <div className="flex items-center gap-1.5">
        <CircleCheck className="h-3.5 w-3.5 text-slate-600" />
        <span className="text-sm font-semibold text-slate-700">{(data as any).label || 'Complete'}</span>
      </div>
    </div>
  );
}

// ─── Custom Node: For-Each Loop ───
function ForEachNode({ data, selected }: NodeProps) {
  const hasError = (data as any)._hasError;
  return (
    <div
      className="rounded-lg shadow-md border-2 min-w-[200px] max-w-[240px] relative"
      style={{
        background: '#f0fdfa',
        borderColor: hasError ? '#ef4444' : selected ? '#2563eb' : '#14b8a6',
        boxShadow: hasError ? '0 0 0 3px #fecaca' : selected ? '0 0 0 2px #93c5fd' : undefined,
      }}
    >
      {hasError && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center z-10">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-teal-400 !border-teal-300" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">For Each</span>
        </div>
        <div className="text-sm font-semibold text-slate-800 leading-tight">{(data as any).label || 'For Each Item'}</div>
        {(data as any).collection && (
          <div className="text-[11px] text-teal-600 mt-0.5">over: {(data as any).collection}</div>
        )}
      </div>
      {/* Loop body exit */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="body"
        className="!w-3 !h-3 !bg-teal-500 !border-teal-400"
        style={{ left: '35%', bottom: -6 }}
      />
      {/* Done exit */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="done"
        className="!w-3 !h-3 !bg-slate-400 !border-slate-300"
        style={{ left: '65%', bottom: -6 }}
      />
      <span className="absolute text-[9px] font-bold text-teal-600" style={{ left: '20%', bottom: -18 }}>Each</span>
      <span className="absolute text-[9px] font-bold text-slate-500" style={{ left: '56%', bottom: -18 }}>Done</span>
    </div>
  );
}

// ─── Custom Node: Loop Until ───
function LoopUntilNode({ data, selected }: NodeProps) {
  const hasError = (data as any)._hasError;
  return (
    <div
      className="rounded-lg shadow-md border-2 min-w-[200px] max-w-[240px] relative"
      style={{
        background: '#fefce8',
        borderColor: hasError ? '#ef4444' : selected ? '#2563eb' : '#eab308',
        boxShadow: hasError ? '0 0 0 3px #fecaca' : selected ? '0 0 0 2px #93c5fd' : undefined,
      }}
    >
      {hasError && (
        <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center z-10">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-yellow-400 !border-yellow-300" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">Loop Until</span>
        </div>
        <div className="text-sm font-semibold text-slate-800 leading-tight">{(data as any).label || 'Repeat Until'}</div>
        {(data as any).condition && (
          <div className="text-[11px] text-yellow-700 mt-0.5">until: {(data as any).condition}</div>
        )}
        {(data as any).maxIterations && (
          <div className="text-[10px] text-yellow-600 mt-0.5">max: {(data as any).maxIterations} iterations</div>
        )}
      </div>
      {/* Loop body (repeat) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="repeat"
        className="!w-3 !h-3 !bg-yellow-500 !border-yellow-400"
        style={{ left: '35%', bottom: -6 }}
      />
      {/* Condition met exit */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="done"
        className="!w-3 !h-3 !bg-slate-400 !border-slate-300"
        style={{ left: '65%', bottom: -6 }}
      />
      <span className="absolute text-[9px] font-bold text-yellow-600" style={{ left: '18%', bottom: -18 }}>Repeat</span>
      <span className="absolute text-[9px] font-bold text-slate-500" style={{ left: '56%', bottom: -18 }}>Done</span>
    </div>
  );
}

// ─── Node types registry ───
const nodeTypes: NodeTypes = {
  action: ActionNode,
  decision: DecisionNode,
  start: StartNode,
  end: EndNode,
  forEach: ForEachNode,
  loopUntil: LoopUntilNode,
};

// ─── Default edge style ───
const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
  style: { strokeWidth: 2, stroke: '#94a3b8' },
};

let nodeCounter = 0;
function nextId() { return `node_${Date.now()}_${++nodeCounter}`; }

// ─── Default flow for a new test ───
function createDefaultFlow(): FlowData {
  const startId = nextId();
  const endId = nextId();
  return {
    nodes: [
      { id: startId, type: 'start', position: { x: 280, y: 30 }, data: { label: 'Start Test' } },
      { id: endId, type: 'end', position: { x: 280, y: 600 }, data: { label: 'Complete' } },
    ],
    edges: [],
  };
}

// ─── Validation ───
interface FlowIssue {
  nodeId: string;
  nodeLabel: string;
  severity: 'error' | 'warning';
  message: string;
}

function validateFlow(nodes: Node[], edges: Edge[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const label = (n: Node) => (n.data as any).label || n.type || 'Unnamed';

  const startNodes = nodes.filter(n => n.type === 'start');
  const endNodes = nodes.filter(n => n.type === 'end');
  const actionNodes = nodes.filter(n => n.type === 'action');
  const decisionNodes = nodes.filter(n => n.type === 'decision');

  // 1. Must have a start node
  if (startNodes.length === 0) {
    issues.push({ nodeId: '', nodeLabel: 'Flow', severity: 'error', message: 'Flow must have a Start node' });
  }

  // 2. Must have at least one end node
  if (endNodes.length === 0) {
    issues.push({ nodeId: '', nodeLabel: 'Flow', severity: 'error', message: 'Flow must have at least one End node' });
  }

  // 3. Start node must have outgoing edge
  for (const start of startNodes) {
    const outgoing = edges.filter(e => e.source === start.id);
    if (outgoing.length === 0) {
      issues.push({ nodeId: start.id, nodeLabel: 'Start', severity: 'error', message: 'Start node is not connected to anything' });
    }
  }

  // 4. End nodes must have incoming edge
  for (const end of endNodes) {
    const incoming = edges.filter(e => e.target === end.id);
    if (incoming.length === 0) {
      issues.push({ nodeId: end.id, nodeLabel: label(end), severity: 'error', message: 'End node has no incoming connection' });
    }
  }

  // 5. Action nodes
  for (const action of actionNodes) {
    const incoming = edges.filter(e => e.target === action.id);
    const outgoing = edges.filter(e => e.source === action.id);
    const lbl = label(action);

    // Must have a name
    if (!(action.data as any).label?.trim()) {
      issues.push({ nodeId: action.id, nodeLabel: 'Action', severity: 'error', message: 'Action node has no name' });
    }

    // Must be connected (incoming)
    if (incoming.length === 0) {
      issues.push({ nodeId: action.id, nodeLabel: lbl, severity: 'error', message: `"${lbl}" has no incoming connection — it will never be reached` });
    }

    // Must have outgoing (not a dead end)
    if (outgoing.length === 0) {
      issues.push({ nodeId: action.id, nodeLabel: lbl, severity: 'error', message: `"${lbl}" has no outgoing connection — flow stops here` });
    }

    // Warn if no execution def
    if (!(action.data as any).executionDef) {
      issues.push({ nodeId: action.id, nodeLabel: lbl, severity: 'warning', message: `"${lbl}" has no execution definition configured` });
    }
  }

  // 6. Decision nodes
  for (const decision of decisionNodes) {
    const incoming = edges.filter(e => e.target === decision.id);
    const outgoingYes = edges.filter(e => e.source === decision.id && e.sourceHandle === 'yes');
    const outgoingNo = edges.filter(e => e.source === decision.id && e.sourceHandle === 'no');
    const lbl = label(decision);

    if (incoming.length === 0) {
      issues.push({ nodeId: decision.id, nodeLabel: lbl, severity: 'error', message: `Decision "${lbl}" has no incoming connection` });
    }

    if (outgoingYes.length === 0) {
      issues.push({ nodeId: decision.id, nodeLabel: lbl, severity: 'error', message: `Decision "${lbl}" is missing a Yes branch` });
    }

    if (outgoingNo.length === 0) {
      issues.push({ nodeId: decision.id, nodeLabel: lbl, severity: 'error', message: `Decision "${lbl}" is missing a No branch` });
    }

    if (!(decision.data as any).question?.trim() && !(decision.data as any).label?.trim()) {
      issues.push({ nodeId: decision.id, nodeLabel: lbl, severity: 'warning', message: `Decision "${lbl}" has no question defined` });
    }
  }

  // 7. For-Each nodes
  const forEachNodes = nodes.filter(n => n.type === 'forEach');
  for (const fe of forEachNodes) {
    const incoming = edges.filter(e => e.target === fe.id);
    const bodyEdges = edges.filter(e => e.source === fe.id && e.sourceHandle === 'body');
    const doneEdges = edges.filter(e => e.source === fe.id && e.sourceHandle === 'done');
    const lbl = label(fe);

    if (incoming.length === 0) issues.push({ nodeId: fe.id, nodeLabel: lbl, severity: 'error', message: `For-Each "${lbl}" has no incoming connection` });
    if (bodyEdges.length === 0) issues.push({ nodeId: fe.id, nodeLabel: lbl, severity: 'error', message: `For-Each "${lbl}" is missing an "Each" branch (loop body)` });
    if (doneEdges.length === 0) issues.push({ nodeId: fe.id, nodeLabel: lbl, severity: 'error', message: `For-Each "${lbl}" is missing a "Done" branch (exit)` });
  }

  // 8. Loop-Until nodes
  const loopUntilNodes = nodes.filter(n => n.type === 'loopUntil');
  for (const lu of loopUntilNodes) {
    const incoming = edges.filter(e => e.target === lu.id);
    const repeatEdges = edges.filter(e => e.source === lu.id && e.sourceHandle === 'repeat');
    const doneEdges = edges.filter(e => e.source === lu.id && e.sourceHandle === 'done');
    const lbl = label(lu);

    if (incoming.length === 0) issues.push({ nodeId: lu.id, nodeLabel: lbl, severity: 'error', message: `Loop-Until "${lbl}" has no incoming connection` });
    if (repeatEdges.length === 0) issues.push({ nodeId: lu.id, nodeLabel: lbl, severity: 'error', message: `Loop-Until "${lbl}" is missing a "Repeat" branch (loop body)` });
    if (doneEdges.length === 0) issues.push({ nodeId: lu.id, nodeLabel: lbl, severity: 'error', message: `Loop-Until "${lbl}" is missing a "Done" branch (exit)` });
    if (!(lu.data as any).condition?.trim()) issues.push({ nodeId: lu.id, nodeLabel: lbl, severity: 'warning', message: `Loop-Until "${lbl}" has no stop condition defined` });
  }

  // 9. Orphan detection — nodes with no edges at all (except start if it's the only node)
  for (const node of nodes) {
    if (node.type === 'start') continue;
    const hasEdge = edges.some(e => e.source === node.id || e.target === node.id);
    if (!hasEdge) {
      issues.push({ nodeId: node.id, nodeLabel: label(node), severity: 'error', message: `"${label(node)}" is completely disconnected from the flow` });
    }
  }

  return issues;
}

// ─── Main Component ───
export function TestFlowEditor({ testDescription, initialFlow, testActions, onSave, onClose }: Props) {
  const flow = initialFlow && initialFlow.nodes.length > 0 ? initialFlow : createDefaultFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  const [saving, setSaving] = useState(false);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);

  // Validation state
  const [issues, setIssues] = useState<FlowIssue[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const errorNodeIds = useMemo(() => new Set(issues.filter(i => i.severity === 'error').map(i => i.nodeId)), [issues]);
  const warningNodeIds = useMemo(() => new Set(issues.filter(i => i.severity === 'warning').map(i => i.nodeId)), [issues]);
  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warningCount = issues.filter(i => i.severity === 'warning').length;

  // Edit panel state
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAssignee, setEditAssignee] = useState('team');
  const [editInputType, setEditInputType] = useState('none');
  const [editQuestion, setEditQuestion] = useState('');
  const [editCollection, setEditCollection] = useState('');
  const [editCondition, setEditCondition] = useState('');
  const [editMaxIterations, setEditMaxIterations] = useState(3);

  // Clear stale validation when flow changes
  const onNodesChangeWrapped = useCallback((changes: any) => {
    onNodesChange(changes);
    if (issues.length > 0) setIssues([]);
  }, [onNodesChange, issues.length]);

  const onEdgesChangeWrapped = useCallback((changes: any) => {
    onEdgesChange(changes);
    if (issues.length > 0) setIssues([]);
  }, [onEdgesChange, issues.length]);

  const onConnect = useCallback((params: Connection) => {
    const handleLabels: Record<string, string> = { yes: 'Yes', no: 'No', body: 'Each', repeat: 'Repeat', done: 'Done' };
    const handleColors: Record<string, string> = { yes: '#22c55e', no: '#ef4444', body: '#14b8a6', repeat: '#eab308', done: '#94a3b8' };
    const handle = params.sourceHandle || '';
    const label = handleLabels[handle];
    const color = handleColors[handle];
    const style = color ? { stroke: color, strokeWidth: 2 } : undefined;
    setEdges((eds) => addEdge({ ...params, label, style, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 } }, eds));
  }, [setEdges]);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    const dataStr = event.dataTransfer.getData('application/reactflow');
    if (!dataStr || !reactFlowInstance) return;
    const nodeData = JSON.parse(dataStr);
    const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setNodes((nds) => [...nds, { id: nextId(), type: nodeData.nodeType, position, data: nodeData.data }]);
  }, [reactFlowInstance, setNodes]);

  // Double-click opens the full edit panel
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'start') return;
    setEditingNode(node.id);
    setEditLabel((node.data as any).label || '');
    setEditDescription((node.data as any).description || '');
    setEditAssignee((node.data as any).assignee || 'team');
    setEditInputType((node.data as any).inputType || 'none');
    setEditQuestion((node.data as any).question || '');
    setEditCollection((node.data as any).collection || '');
    setEditCondition((node.data as any).condition || '');
    setEditMaxIterations((node.data as any).maxIterations || 3);
  }, []);

  const saveNodeEdit = useCallback(() => {
    if (!editingNode) return;
    setNodes((nds) => nds.map((n) => {
      if (n.id !== editingNode) return n;
      if (n.type === 'decision') {
        return { ...n, data: { ...n.data, label: editLabel, question: editQuestion } };
      }
      if (n.type === 'end') {
        return { ...n, data: { ...n.data, label: editLabel } };
      }
      if (n.type === 'forEach') {
        return { ...n, data: { ...n.data, label: editLabel, collection: editCollection } };
      }
      if (n.type === 'loopUntil') {
        return { ...n, data: { ...n.data, label: editLabel, condition: editCondition, maxIterations: editMaxIterations } };
      }
      // action node
      return {
        ...n,
        data: {
          ...n.data,
          label: editLabel,
          description: editDescription,
          assignee: editAssignee,
          inputType: editInputType,
        },
      };
    }));
    setEditingNode(null);
  }, [editingNode, editLabel, editDescription, editAssignee, editInputType, editQuestion, setNodes]);

  const deleteSelected = useCallback(() => {
    setNodes((nds) => nds.filter((n) => !n.selected || n.type === 'start'));
    setEdges((eds) => eds.filter((e) => !e.selected));
  }, [setNodes, setEdges]);

  function runValidation() {
    const result = validateFlow(nodes, edges);
    setIssues(result);
    setShowValidation(true);
    return result;
  }

  async function handleSave() {
    const result = runValidation();
    const errors = result.filter(i => i.severity === 'error');
    if (errors.length > 0) {
      // Don't save — show validation panel
      return;
    }
    setSaving(true);
    try { await onSave({ nodes, edges }); } finally { setSaving(false); }
  }

  // Group test actions by type for sidebar
  const groupedActions = useMemo(() => {
    const groups: Record<string, TestAction[]> = { ai: [], client: [], human: [], review: [] };
    testActions.forEach((a) => { if (groups[a.actionType]) groups[a.actionType].push(a); });
    return groups;
  }, [testActions]);

  // Augment nodes with validation status for rendering
  const augmentedNodes = useMemo(() => {
    if (issues.length === 0) return nodes;
    return nodes.map(n => {
      const hasError = errorNodeIds.has(n.id);
      const hasWarning = warningNodeIds.has(n.id);
      if (!hasError && !hasWarning) return n;
      return { ...n, data: { ...n.data, _hasError: hasError, _hasWarning: hasWarning } };
    });
  }, [nodes, issues, errorNodeIds, warningNodeIds]);

  const editingNodeObj = editingNode ? nodes.find((n) => n.id === editingNode) : null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-[95vw] h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b bg-slate-50">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900 truncate">Test Flow Builder</h2>
            <p className="text-xs text-slate-500 truncate">{testDescription}</p>
          </div>
          <div className="flex items-center gap-2 ml-4">
            <span className="text-[10px] text-slate-400">{nodes.length - 2} steps</span>
            <button onClick={deleteSelected} className="text-xs px-3 py-1.5 border border-red-200 text-red-600 rounded-md hover:bg-red-50">
              Delete Selected
            </button>
            <button
              onClick={runValidation}
              className={`text-xs px-3 py-1.5 border rounded-md flex items-center gap-1 ${
                issues.length === 0 ? 'border-slate-200 text-slate-600 hover:bg-slate-50' :
                errorCount > 0 ? 'border-red-300 text-red-700 bg-red-50 hover:bg-red-100' :
                'border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100'
              }`}
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Validate
              {errorCount > 0 && <span className="bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">{errorCount}</span>}
              {errorCount === 0 && warningCount > 0 && <span className="bg-amber-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">{warningCount}</span>}
            </button>
            <Button onClick={handleSave} size="sm" disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save Flow
            </Button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-200 rounded-md">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left sidebar: drag palette */}
          <div className="w-56 border-r bg-slate-50 overflow-y-auto p-3 flex flex-col gap-3">
            <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Drag to Canvas</div>

            {/* Flow control */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-slate-500 uppercase">Flow Control</div>
              <DraggableItem
                label="Decision / Check"
                icon={<Diamond className="h-3.5 w-3.5 text-amber-600" />}
                color="border-amber-300 bg-amber-50"
                nodeType="decision"
                data={{ label: 'Agrees?', question: 'Does value match expected?' }}
              />
              <DraggableItem
                label="For Each"
                icon={<span className="text-teal-600 text-xs font-bold">&#x21BB;</span>}
                color="border-teal-300 bg-teal-50"
                nodeType="forEach"
                data={{ label: 'For Each Item', collection: 'sample_items' }}
              />
              <DraggableItem
                label="Loop Until"
                icon={<span className="text-yellow-600 text-xs font-bold">&#x27F3;</span>}
                color="border-yellow-300 bg-yellow-50"
                nodeType="loopUntil"
                data={{ label: 'Repeat Until Resolved', condition: 'All items satisfied', maxIterations: 3 }}
              />
              <DraggableItem
                label="End / Conclude"
                icon={<CircleCheck className="h-3.5 w-3.5 text-slate-500" />}
                color="border-slate-300 bg-slate-50"
                nodeType="end"
                data={{ label: 'Complete' }}
              />
            </div>

            {/* Test Actions from library */}
            {testActions.length === 0 && (
              <div className="text-[10px] text-slate-400 italic px-1 py-2">
                No Test Actions defined yet. Add them in Test Bank &rarr; Test Actions tab.
              </div>
            )}
            {Object.entries(groupedActions).map(([type, actions]) => {
              if (actions.length === 0) return null;
              const colors = ASSIGNEE_COLORS[type === 'human' ? 'team' : type === 'review' ? 'ai' : type];
              return (
                <div key={type} className="space-y-1.5">
                  <div className="text-[10px] font-semibold uppercase" style={{ color: colors?.text || '#475569' }}>
                    {type === 'human' ? 'Team Actions' : type === 'review' ? 'Review Actions' : type === 'ai' ? 'AI Actions' : 'Client Actions'}
                  </div>
                  {actions.map((action) => (
                    <DraggableItem
                      key={action.id}
                      label={action.name}
                      subtitle={action.description}
                      icon={<GripVertical className="h-3 w-3 text-slate-300" />}
                      color="bg-white border"
                      borderColor={colors?.border}
                      nodeType="action"
                      data={{
                        label: action.name,
                        description: action.description,
                        assignee: action.actionType === 'human' ? 'team' : action.actionType === 'review' ? 'ai' : action.actionType,
                        inputType: 'none',
                        actionId: action.id,
                        executionDef: action.executionDef || undefined,
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* Canvas */}
          <div className="flex-1 relative">
            <ReactFlow
              nodes={augmentedNodes}
              edges={edges}
              onNodesChange={onNodesChangeWrapped}
              onEdgesChange={onEdgesChangeWrapped}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onNodeDoubleClick={onNodeDoubleClick}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView
              deleteKeyCode="Delete"
              className="bg-white"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
              <Controls />
            </ReactFlow>

            {/* Hint overlay */}
            {nodes.length <= 2 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center text-slate-300">
                  <p className="text-lg font-medium">Drag actions from the left panel</p>
                  <p className="text-sm mt-1">Double-click a node to edit its properties</p>
                </div>
              </div>
            )}

            {/* Validation panel */}
            {showValidation && issues.length > 0 && (
              <div className="absolute bottom-3 left-3 right-3 z-20 max-h-[200px] overflow-y-auto bg-white rounded-lg shadow-xl border">
                <div className="flex items-center justify-between px-3 py-2 border-b bg-slate-50 sticky top-0">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-slate-600" />
                    <span className="text-xs font-semibold text-slate-700">
                      Flow Validation
                      {errorCount > 0 && <span className="ml-1.5 text-red-600">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>}
                      {warningCount > 0 && <span className="ml-1.5 text-amber-600">{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>}
                    </span>
                  </div>
                  <button onClick={() => setShowValidation(false)} className="text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {issues.map((issue, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 ${
                        issue.severity === 'error' ? 'bg-red-50/30' : ''
                      }`}
                      onClick={() => {
                        // Select the node to highlight it
                        if (issue.nodeId) {
                          setNodes(nds => nds.map(n => ({ ...n, selected: n.id === issue.nodeId })));
                        }
                      }}
                    >
                      {issue.severity === 'error' ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      )}
                      <span className={issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}>
                        {issue.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Validation success toast */}
            {showValidation && issues.length === 0 && (
              <div className="absolute bottom-3 left-3 z-20 bg-green-50 border border-green-200 rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-xs font-medium text-green-700">Flow is valid — no issues found</span>
                <button onClick={() => setShowValidation(false)} className="text-green-400 hover:text-green-600 ml-2">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Right panel: node editor (when a node is being edited) */}
          {editingNode && editingNodeObj && (
            <div className="w-72 border-l bg-white overflow-y-auto p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-bold text-slate-800">Edit Node</span>
                <button onClick={() => setEditingNode(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                {/* Label */}
                <div>
                  <label className="text-[10px] font-medium text-slate-500 uppercase">Name</label>
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5"
                    autoFocus
                  />
                </div>

                {editingNodeObj.type === 'decision' && (
                  <div>
                    <label className="text-[10px] font-medium text-slate-500 uppercase">Question / Condition</label>
                    <textarea
                      value={editQuestion}
                      onChange={(e) => setEditQuestion(e.target.value)}
                      className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5"
                      rows={2}
                      placeholder="e.g. Does response agree to TB?"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">Yes exits left, No exits right</p>
                  </div>
                )}

                {editingNodeObj.type === 'action' && (
                  <>
                    {/* Description */}
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 uppercase">Description</label>
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5"
                        rows={2}
                        placeholder="What does this step do?"
                      />
                    </div>

                    {/* Assignee */}
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 uppercase">Who performs this?</label>
                      <div className="flex gap-1.5 mt-1">
                        {ASSIGNEES.map((a) => {
                          const Icon = a.icon;
                          return (
                            <button
                              key={a.value}
                              onClick={() => setEditAssignee(a.value)}
                              className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                                editAssignee === a.value ? a.color + ' border-2' : 'bg-white text-slate-400 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <Icon className="h-3 w-3" />
                              {a.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Input Type */}
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 uppercase">Input / Interaction</label>
                      <select
                        value={editInputType}
                        onChange={(e) => setEditInputType(e.target.value)}
                        className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5 bg-white"
                      >
                        {INPUT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {editingNodeObj.type === 'forEach' && (
                  <div>
                    <label className="text-[10px] font-medium text-slate-500 uppercase">Iterate Over (collection)</label>
                    <select
                      value={editCollection}
                      onChange={(e) => setEditCollection(e.target.value)}
                      className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5 bg-white"
                    >
                      <option value="sample_items">Sample Items</option>
                      <option value="evidence_files">Evidence Files</option>
                      <option value="tb_rows">Trial Balance Rows</option>
                      <option value="par_rows">PAR Rows</option>
                      <option value="rmm_rows">RMM Rows</option>
                      <option value="uploaded_files">Uploaded Files</option>
                      <option value="client_responses">Client Responses</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">Each iteration provides <code className="bg-slate-100 px-1 rounded">{'{{loop.currentItem}}'}</code> and <code className="bg-slate-100 px-1 rounded">{'{{loop.index}}'}</code></p>
                  </div>
                )}

                {editingNodeObj.type === 'loopUntil' && (
                  <>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 uppercase">Condition (stop when true)</label>
                      <input
                        value={editCondition}
                        onChange={(e) => setEditCondition(e.target.value)}
                        className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5"
                        placeholder="e.g. All items satisfied, Client response accepted"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-slate-500 uppercase">Max Iterations (safety limit)</label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={editMaxIterations}
                        onChange={(e) => setEditMaxIterations(parseInt(e.target.value) || 3)}
                        className="w-full border rounded-md px-2.5 py-1.5 text-sm mt-0.5"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">Prevents infinite loops — escalates to team if exceeded</p>
                    </div>
                  </>
                )}

                <Button onClick={saveNodeEdit} size="sm" className="w-full mt-2">Apply Changes</Button>

                {/* Delete button */}
                {editingNodeObj.type !== 'start' && (
                  <button
                    onClick={() => {
                      setNodes((nds) => nds.filter((n) => n.id !== editingNode));
                      setEdges((eds) => eds.filter((e) => e.source !== editingNode && e.target !== editingNode));
                      setEditingNode(null);
                    }}
                    className="w-full text-xs text-red-500 hover:text-red-700 py-1.5 border border-red-200 rounded-md hover:bg-red-50 mt-1"
                  >
                    Delete This Node
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Draggable sidebar item ───
function DraggableItem({
  label,
  subtitle,
  icon,
  color,
  borderColor,
  nodeType,
  data,
}: {
  label: string;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  borderColor?: string;
  nodeType: string;
  data: Record<string, any>;
}) {
  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({ nodeType, data }));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`flex items-start gap-2 px-2.5 py-1.5 rounded-md border cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow ${color}`}
      style={borderColor ? { borderColor } : undefined}
    >
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-slate-700 leading-tight">{label}</div>
        {subtitle && <div className="text-[10px] text-slate-400 leading-tight truncate">{subtitle}</div>}
      </div>
    </div>
  );
}
